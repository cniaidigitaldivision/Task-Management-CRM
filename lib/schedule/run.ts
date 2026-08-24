import 'server-only';

import { getProject } from '@/lib/db/queries/projects';
import { tallyContentTasks } from '@/lib/db/queries/schedule';
import { createTask } from '@/lib/db/queries/tasks';
import { cadenceProblem, monthPlan, type Cadence, type Weekday } from '@/lib/domain/cadence';
import { monthsSpanning, scheduleShortfall, type ScheduledTask } from '@/lib/domain/schedule';

/* ============================================================================
 * RUNNING THE SCHEDULE GENERATOR — THE ONE PATH, WITH TWO CALLERS
 * ----------------------------------------------------------------------------
 * `app/actions/schedule.ts` is a person pressing a button.
 * `app/api/schedule/route.ts` is a cron at 02:00.
 *
 * ── ⚠️ WHY THIS IS A SEPARATE MODULE AND NOT THE ACTION THE ROUTE IMPORTS ────
 * The action begins with `requireUser()`, which reads a session cookie. A cron
 * request has no cookie and never will, so a route importing the action would
 * have to fake a session or the action would have to make its identity optional
 * — and an entry point whose authentication is optional is one refactor away
 * from being an open one.
 *
 * So identity is a PARAMETER here and each caller proves it its own way: the
 * action from the signed-in user, the route from `CRON_SECRET` plus the
 * project's owner. Neither can borrow the other's proof by accident.
 *
 * ── EVERY WRITE STILL GOES THROUGH RLS ───────────────────────────────────────
 * `createTask` runs inside `withUser(actorId)`, so the cron is not an elevated
 * identity writing wherever it likes. It acts AS the project owner, and the
 * `tasks_insert` policy is what actually permits the row — which it does because
 * generated tasks are unassigned, and that policy admits an unassigned task from
 * anybody who can see the project. If a project's owner were ever deactivated,
 * their inserts would start failing rather than silently succeeding as somebody
 * else, which is the right way round.
 * ========================================================================= */

export interface GenerateOutcome {
  readonly projectId: string;
  readonly projectName: string;
  readonly created: number;
  /** Set when nothing was created for a reason worth reporting. */
  readonly skipped?: string;
}

/**
 * Top a project's calendar up to its agreed rhythm across `[from, to]`.
 *
 * Idempotent by construction — see `lib/domain/schedule.ts`. Running it twice
 * over the same window creates nothing the second time.
 */
export async function generateForProject(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<GenerateOutcome> {
  const project = await getProject(actorId, projectId);
  if (!project) {
    return { projectId, projectName: '(not visible)', created: 0, skipped: 'not visible' };
  }

  const name = project.name;

  if (from > to) {
    return { projectId, projectName: name, created: 0, skipped: 'window closed before it opened' };
  }

  const cadence: Cadence = {
    staticPostsPerDay: project.staticPostsPerDay,
    reelsPerWeek: project.reelsPerWeek,
    reelDays: project.reelDays as readonly Weekday[],
    postingDays: project.postingDays as readonly Weekday[],
  };

  if (cadence.staticPostsPerDay === null && cadence.reelsPerWeek === null) {
    return { projectId, projectName: name, created: 0, skipped: 'no posting rhythm set' };
  }

  const problem = cadenceProblem(cadence);
  if (problem) {
    return { projectId, projectName: name, created: 0, skipped: `incoherent rhythm — ${problem}` };
  }

  /* One tally for the whole window, not one per month: it is a single indexed
     read either way, and splitting it would mean a round trip per month. */
  const existing = await tallyContentTasks(actorId, projectId, from, to);

  /* A window can straddle a month boundary — the 25th plus a fortnight does.
     Each month contributes its own plan, clamped to the window. */
  const wanted: ScheduledTask[] = [];
  for (const monthStart of monthsSpanning(from, to)) {
    wanted.push(
      ...scheduleShortfall({ plan: monthPlan(cadence, monthStart), existing, from, to }),
    );
  }

  /* ── SEQUENTIAL, NOT Promise.all ────────────────────────────────────────
     Every `createTask` takes a reference from a per-prefix counter row. Firing
     them together serialises on that row anyway, while each holds a pooled
     connection waiting — and `max: 3` in production means the pool empties
     before the work finishes. Slower here is genuinely faster, and the
     references come out in date order. */
  let created = 0;
  for (const task of wanted) {
    await createTask(actorId, {
      title: task.title,
      projectId,
      assigneeId: null,
      status: 'backlog',
      priority: 'medium',
      effortSize: task.effortSize,
      effortPoints: task.effortPoints,
      dueDate: task.date,
      contentKind: task.contentKind,
    });
    created += 1;
  }

  return { projectId, projectName: name, created };
}
