import type { Metadata } from 'next';

import { TasksWorkspace } from '@/components/task/tasks-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { nowMs } from '@/lib/now';
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
      />
    </div>
  );
}
