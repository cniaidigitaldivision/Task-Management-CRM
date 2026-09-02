import type { Metadata } from 'next';

import { TasksWorkspace } from '@/components/task/tasks-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks, taskTotals } from '@/lib/db/queries/tasks';
import { isoDateIn, nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';
import { resolveTaskWindow } from '@/lib/view/task-window';

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
  searchParams: Promise<{
    q?: string;
    project?: string;
    assignee?: string;
    task?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  /* ── ⚠️ THE BOARD OPENS ON TODAY, NOT ON EVERYTHING ───────────────────────
     Owner, 2026-09-02: *"by default it should show only today's tasks not the
     whole month's tasks. When I want to see all the tasks, I will put the All
     filter."*

     Measured on the live database the same day: 318 tasks, of which 293 are due
     in the FUTURE. So the board was drawing a month and a half of work nobody
     had asked to see yet, at 275 kB of payload for the 25 cards that mattered.

     ── WHY THE DEFAULT IS `to = today` WITH NO `from` ────────────────────────
     A window of exactly today (`from = to = today`) would ALSO hide overdue
     work, which is the one thing on this page nobody can afford to miss - and
     the page has an Overdue card that would have started contradicting the
     board. An open-ended start reads as "everything up to and including today":
     due today, everything late, and undated work. That is the question somebody
     opening a task board is actually asking.

     It is expressed as a real, editable range rather than a hidden mode, so the
     toolbar's own date control shows it and can widen it - and `?range=all`
     is the All the owner asked for. */
  const today = isoDateIn();
  /* The rules, and the reasoning, live in lib/view/task-window.ts with a test
     per case — including the absent-versus-cleared one this got wrong first. */
  const { dueFrom, dueTo, showAll } = resolveTaskWindow(params, today);

  const [rows, people, projects, totals] = await Promise.all([
    listTasks(user.id, {
      includeClosed: true,
      projectId: params.project,
      assigneeId: params.assignee,
      dueFrom,
      dueTo,
    }),
    listAssignablepeople(user.id),
    listProjects(user.id),
    /* ⚠️ The summary strip stays division-wide while the board is scoped — see
       `taskTotals`. Without this the cards would silently start describing only
       the visible window and change every time the date filter moved. */
    taskTotals(user.id, { projectId: params.project, assigneeId: params.assignee }),
  ]);

  /* `Date.now()` once, on the server, for every due label. Computing it per card
     in the browser would make the server and client disagree about today and
     produce a hydration mismatch. */
  const now = nowMs();
  const tasks = rows.map((row) => toTaskView(row, now));

  /* ⚠️ FROM `taskTotals`, NOT FROM `tasks`. The array is now one due window, so
     counting it would label 25 visible cards "Open tasks" and make every figure
     move when the date filter moved. These four are the whole division. */
  const { open, done, overdue, activeProjects } = totals;
  const projectCount = activeProjects;

  /* ── ⚠️ THESE WERE COUNTED IN MEMORY, AND THAT STOPPED BEING RIGHT ────────
     Owner, 2026-08-23: *"cards that show how many open projects, how many open
     tasks, how many completed tasks… Just four or five cards are more than
     enough."*

     The original note here argued against querying for them: `listTasks`
     already returned every row, so four `count(*)` round trips to Singapore
     would have been the most expensive thing on the page. True then. The board
     is scoped to a due window now (2026-09-02), so in-memory counting would
     describe only what is already on screen.

     It is ONE round trip, not four - a single pass with `count(*) filter`,
     measured at 0.75 ms.

     FOUR cards, not five. The owner named three things and set the ceiling at
     five; overdue is the fourth because it is the only one of these that anybody
     acts on today. A fifth would be a number nobody had asked a question about. */

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
        today={today}
        /* ⚠️ What the SERVER applied, so the toolbar's date control states the
           truth. Passing it makes the window URL-owned on this page; /my-work
           omits it and keeps the old in-browser filter. */
        dueWindow={{ from: dueFrom ?? '', to: dueTo ?? '', showAll }}
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
