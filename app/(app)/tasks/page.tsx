import type { Metadata } from 'next';

import { TasksWorkspace } from '@/components/task/tasks-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { isoDateIn, nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';

export const metadata: Metadata = { title: 'Tasks' };

/* ============================================================================
 * TASKS — doc 10 §3 · FR-081 (list, filter, sort) · FR-082 (board)
 * ----------------------------------------------------------------------------
 * A Server Component that reads and hands off. Every interactive part lives in
 * <TasksWorkspace/>, and every write goes through a server action.
 *
 * ── WHAT A MEMBER SEES HERE, AND WHY NO CODE SAYS SO ─────────────────────────
 * `listTasks()` is called with no assignee filter, for everybody. A Coordinator
 * gets the whole team's work; a Member gets only their own. Nothing on this page
 * branches on role to achieve that — migration 013's policies mean the other
 * rows do not exist for them.
 *
 * ADR-003 is therefore a property of the system rather than a habit of this
 * file, and it stays true for any query anybody writes later.
 * ========================================================================= */

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string; assignee?: string; task?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [rows, people, projects] = await Promise.all([
    listTasks(user.id, {
      includeClosed: true,
      projectId: params.project,
      assigneeId: params.assignee,
    }),
    listAssignablepeople(user.id),
    listProjects(user.id),
  ]);

  /* `Date.now()` once, on the server, for every due label. Computing it per card
     in the browser would make the server and client disagree about today and
     produce a hydration mismatch. */
  const now = nowMs();
  const tasks = rows.map((row) => toTaskView(row, now));

  const open = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled',
  ).length;
  const overdue = tasks.filter((t) => t.overdue).length;
  const projectCount = new Set(tasks.map((t) => t.projectId)).size;

  /* ── ⚠️ COUNTED FROM ROWS ALREADY LOADED, NOT FROM FOUR MORE QUERIES ───────
     Owner, 2026-08-23: *"I want there to be cards that show how many open
     projects, how many open tasks, how many completed tasks… in a very
     beautiful and very sleek way, not filled with too many cards. Just four or
     five cards are more than enough."*

     `listTasks` above already returns the whole visible set with
     `includeClosed`, so every figure here is a filter over an array in memory.
     Four `count(*)` round trips to Singapore to draw four small numbers would
     be the most expensive part of this page.

     FOUR cards, not five. The owner named three things and set the ceiling at
     five; overdue is the fourth because it is the only one of these that anybody
     acts on today. A fifth would be a number nobody had asked a question about. */
  const done = tasks.filter((t) => t.status === 'done').length;
  const activeProjects = new Set(
    tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').map((t) => t.projectId),
  ).size;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <PageHeader
        eyebrow={user.role === 'member' ? 'Your work' : 'All work'}
        title="Tasks"
        description={
          <>
            <span className="tabular font-semibold text-text-primary">{open}</span> open across{' '}
            {projectCount} {projectCount === 1 ? 'project' : 'projects'}
            {overdue > 0 && (
              <>
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                  {overdue} overdue
                </span>
              </>
            )}
            . Drag a card between columns to change its status — every move is saved, and an
            illegal one tells you why it was refused.
          </>
        }
      />

      {/* Sleek by being few and quiet: no icons, no borders competing with the
          board below, one accent colour reserved for the one figure that is bad
          news. The number is the loud thing; the label is not. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat value={open} label="Open tasks" />
        <Stat value={done} label="Completed" tone="var(--feedback-success)" />
        <Stat value={overdue} label="Overdue" tone={overdue > 0 ? 'var(--feedback-error)' : undefined} />
        <Stat value={activeProjects} label={activeProjects === 1 ? 'Active project' : 'Active projects'} />
      </div>

      <TasksWorkspace
        initialTasks={tasks}
        currentUser={{ id: user.id, name: user.fullName, role: user.role }}
        people={people.map((p) => ({ id: p.id, name: p.fullName, roleTitle: p.roleTitle }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name, type: p.type, code: p.code }))}
        initialSearch={params.q ?? ''}
        initialOpenTaskId={params.task ?? null}
        /* So the toolbar shows the filter that is actually applied, and a task
           created here defaults to the person whose row you came from. */
        initialAssignee={params.assignee ?? null}
        /* `?project=` is what a project's Tasks tab links here with. It was
           never read, so that link landed on every task in the system. */
        initialProject={params.project ?? null}
        /* The division's day, so "This week" on the range filter means the same
           week the daily board and the reports mean. */
        today={isoDateIn()}
      />
    </div>
  );
}

/* One figure and its name. Deliberately not the dashboard's `StatCard` — that
   one carries an icon, a trend and a sublabel, which is three more things than
   this row wants and is why a strip of them stops reading as a summary. */
function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface px-3.5 py-3 shadow-xs">
      <p
        className="text-display leading-none font-semibold tabular-nums"
        style={{ color: tone ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
      <p className="mt-1 text-caption text-text-secondary">{label}</p>
    </div>
  );
}
