import 'server-only';

import type { Priority, TaskStatus } from '@/lib/domain/constants';
import { taskLoad } from '@/lib/domain/task-machine';
import { weekWindow } from '@/lib/domain/workload';

import { withUser } from '../client';

/* ============================================================================
 * RECOMMENDATION INPUTS — LAYER 1
 * ----------------------------------------------------------------------------
 * Everything doc 07's six dimensions need, for every assignable person, in one
 * round trip. No scoring happens here — this file gathers, `lib/domain/
 * recommendation.ts` decides.
 *
 * ── ONE QUERY, NOT SIX PER PERSON ────────────────────────────────────────────
 * The obvious shape is a loop: for each candidate, count their tasks, their
 * recent assignments, their completions. Seven people is 42 round trips on a
 * pooled connection, which is several seconds before the panel can draw
 * anything — and the number grows with the team.
 *
 * Instead each dimension's raw material is one aggregate over the whole team,
 * and they are stitched together in TypeScript. Reading it takes a moment
 * longer; running it takes one trip.
 *
 * ── HISTORY COMES FROM `tasks`, NOT `activity_log` ───────────────────────────
 * On-time and revision rates could be derived from the activity trail, which is
 * append-only and therefore authoritative. They are not, because that trail
 * records transitions rather than outcomes: a task moved to Done twice — closed,
 * reopened, closed again — appears as two completions. `tasks.completed_at`
 * against `tasks.due_date` is the state, and the state is what "did this land
 * on time" means.
 * ========================================================================= */

export interface CandidateInput {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly skills: Array<{ skillId: string; proficiency: number }>;
  readonly currentLoadPoints: number;
  readonly effectiveCapacityPoints: number;
  readonly activeTaskCount: number;
  readonly maxConcurrentTasks: number;
  readonly committedBeforeDuePoints: number;
  readonly recentAssignments: number;
  readonly completedCount: number;
  readonly onTimeRate: number;
  readonly revisionRate: number;
  readonly openTasksInProject: number;
  readonly hasWorkedOnProject: boolean;
}

export interface RecommendationInputs {
  readonly candidates: CandidateInput[];
  readonly totalRecentAssignments: number;
  readonly teamSize: number;
}

export async function gatherCandidates(
  actorId: string,
  input: { projectId: string; dueDate: string | null; nowMs: number },
): Promise<RecommendationInputs> {
  const window = weekWindow(input.nowMs);

  return withUser(actorId, async (tx) => {
    const [people, skills, load, dueLoad, recent, history, familiarity, leave] = await Promise.all([
      /* ── ⚠️ ONLY PEOPLE THIS ACTOR MAY ACTUALLY ASSIGN TO ──────────────────
         Owner, 2026-08-23, looking at the panel as a Coordinator: *"you can see
         that the admin and the super admin suggestion is also coming. It
         couldn't be like that… The suggestion should also be very intelligent.
         It should know to whom he can assign it or to whom he could not."*

         `listAssignablepeople` had already been given this rule; this query is a
         second, separate list and did not get it — so the dropdown was correct
         while the panel beside it recommended the Super Admin, complete with a
         score and an "Assign to Ammar" button that the server would then refuse.
         A suggestion that cannot be acted on is worse than no suggestion.

         The comparison is `canAssignTo` from lib/domain/permissions.ts, written
         in SQL because the filter has to happen before scoring — ranking people
         who will be discarded wastes the work and, worse, pushes real
         candidates down the list. */
      tx`
        select id, full_name, role_title, weekly_capacity_points, max_concurrent_tasks
          from public.users u
         where u.is_active
           and u.account_state = 'active'
           and app.role_rank(u.role) <= app.role_rank(app.current_user_role())
         order by u.full_name
      `,
      tx`select user_id, skill_id, proficiency from public.user_skills`,
      /* ── THE WEIGHTS ARE NOT REPEATED IN SQL ─────────────────────────────
         The first draft of this query summed effort × priority × status weight
         in a pair of CASE expressions. It was already wrong when it was
         written — `revisions` as 0.75 where STATUS_META says 1, `blocked` as
         0.25 where it says 1 — and nothing would have failed. The
         recommendations would simply have ranked people against a slightly
         different definition of "busy" than the workload screen sitting next
         to them, and the two would have quietly disagreed forever.

         So the rows come back raw and `taskLoad()` does the arithmetic, the
         same function the capacity engine and the workload page call. One
         definition, one place to change it. */
      tx`
        select t.assignee_id as user_id, t.effort_points, t.priority, t.status
          from public.tasks t
         where t.assignee_id is not null
           and not t.is_deleted
           and t.status not in ('done', 'cancelled')
      `,
      /* Committed points falling due on or before this task's date — S3. With
         no due date this is empty and the dimension scores everybody 100. */
      input.dueDate
        ? tx`
            select t.assignee_id as user_id, coalesce(sum(t.effort_points), 0) as points
              from public.tasks t
             where t.assignee_id is not null
               and not t.is_deleted
               and t.status not in ('done', 'cancelled')
               and t.due_date is not null
               and t.due_date <= ${input.dueDate}::date
             group by t.assignee_id
          `
        : Promise.resolve([]),
      /* S4 — assignments in the last 14 days. Counted from `activity_log`
         rather than from `tasks`, because fairness is about how often somebody
         has been HANDED work, and a task reassigned away still happened to
         them. `tasks` only remembers where a task ended up. */
      tx`
        select (a.after ->> 'assigneeId') as user_id, count(*) as given
          from public.activity_log a
         where a.entity_type = 'task'
           and a.action in ('created', 'assigned', 'reassigned')
           and a.after ? 'assigneeId'
           and a.after ->> 'assigneeId' is not null
           and a.created_at > now() - interval '14 days'
         group by 1
      `,
      /* S5 — the last 90 days. A task with no due date cannot be late, so it is
         excluded from the punctuality rate rather than counted as on time;
         otherwise a backlog of undated work would inflate everybody's score. */
      tx`
        select t.assignee_id as user_id,
               count(*) as completed,
               count(*) filter (where t.due_date is not null) as datedone,
               count(*) filter (
                 where t.due_date is not null and t.completed_at::date <= t.due_date
               ) as on_time,
               count(*) filter (where r.revised) as revised
          from public.tasks t
          left join lateral (
            select true as revised
              from public.activity_log a
             where a.entity_type = 'task' and a.entity_id = t.id and a.action = 'revisions'
             limit 1
          ) r on true
         where t.assignee_id is not null
           and t.status = 'done'
           and t.completed_at > now() - interval '90 days'
         group by t.assignee_id
      `,
      /* S6 — familiarity with this particular project. */
      tx`
        select t.assignee_id as user_id,
               count(*) filter (
                 where t.status not in ('done', 'cancelled') and not t.is_deleted
               ) as open_here,
               count(*) as ever_here
          from public.tasks t
         where t.project_id = ${input.projectId} and t.assignee_id is not null
         group by t.assignee_id
      `,
      tx`
        select user_id, type, start_date, end_date
          from public.availability
         where start_date <= ${window.end}::date and end_date >= ${window.start}::date
      `,
    ]);

    const skillsByUser = new Map<string, Array<{ skillId: string; proficiency: number }>>();
    for (const row of skills) {
      const userId = row.user_id as string;
      skillsByUser.set(userId, [
        ...(skillsByUser.get(userId) ?? []),
        { skillId: row.skill_id as string, proficiency: Number(row.proficiency) },
      ]);
    }

    /* Summed here with the shared `taskLoad`, per the note on the query. The
       "active" count is a headcount of things in flight, which is a different
       question from weighted load — somebody at 40% capacity juggling twelve
       things is still in trouble (doc 06 §1), and backlog items are not in
       flight. */
    const IN_FLIGHT = new Set(['todo', 'in_progress', 'in_review', 'revisions']);
    const loadByUser = new Map<string, { points: number; active: number }>();
    for (const row of load) {
      const userId = row.user_id as string;
      const entry = loadByUser.get(userId) ?? { points: 0, active: 0 };
      entry.points += taskLoad({
        effortPoints: Number(row.effort_points),
        priority: row.priority as Priority,
        status: row.status as TaskStatus,
      });
      if (IN_FLIGHT.has(row.status as string)) entry.active += 1;
      loadByUser.set(userId, entry);
    }
    const dueByUser = new Map(dueLoad.map((row) => [row.user_id as string, Number(row.points)]));
    const recentByUser = new Map(recent.map((row) => [row.user_id as string, Number(row.given)]));
    const familiarByUser = new Map(
      familiarity.map((row) => [
        row.user_id as string,
        { open: Number(row.open_here), ever: Number(row.ever_here) },
      ]),
    );

    const historyByUser = new Map(
      history.map((row) => {
        const dated = Number(row.datedone);
        const completed = Number(row.completed);
        return [
          row.user_id as string,
          {
            completed,
            /* No dated tasks means no evidence about punctuality. A neutral 1
               keeps the dimension from inventing a verdict; the completedCount
               floor in the domain handles the "too new to judge" case. */
            onTimeRate: dated > 0 ? Number(row.on_time) / dated : 1,
            revisionRate: completed > 0 ? Number(row.revised) / completed : 0,
          },
        ];
      }),
    );

    /* Leave reduces the capacity the whole calculation is measured against.
       Somebody away all week has zero — not "the same capacity, more load" —
       because those produce very different sentences on screen. */
    const daysOff = new Map<string, number>();
    for (const row of leave) {
      const userId = row.user_id as string;
      const weight = row.type === 'half_day' ? 0.5 : 1;
      daysOff.set(userId, (daysOff.get(userId) ?? 0) + weight);
    }

    const candidates: CandidateInput[] = people.map((row) => {
      const userId = row.id as string;
      const capacity = Number(row.weekly_capacity_points);
      const off = Math.min(6, daysOff.get(userId) ?? 0);
      const current = loadByUser.get(userId);
      const past = historyByUser.get(userId);
      const project = familiarByUser.get(userId);

      return {
        userId,
        name: row.full_name as string,
        roleTitle: (row.role_title as string | null) ?? null,
        skills: skillsByUser.get(userId) ?? [],
        currentLoadPoints: current?.points ?? 0,
        effectiveCapacityPoints: Math.max(0, Math.round(capacity * (1 - off / 6))),
        activeTaskCount: current?.active ?? 0,
        maxConcurrentTasks: Number(row.max_concurrent_tasks),
        committedBeforeDuePoints: dueByUser.get(userId) ?? 0,
        recentAssignments: recentByUser.get(userId) ?? 0,
        completedCount: past?.completed ?? 0,
        onTimeRate: past?.onTimeRate ?? 1,
        revisionRate: past?.revisionRate ?? 0,
        openTasksInProject: project?.open ?? 0,
        hasWorkedOnProject: (project?.ever ?? 0) > 0,
      };
    });

    return {
      candidates,
      totalRecentAssignments: [...recentByUser.values()].reduce((sum, n) => sum + n, 0),
      teamSize: candidates.length,
    };
  });
}

/** The skills library with its keywords, for the FR-055 fallback. */
export async function skillKeywords(
  actorId: string,
): Promise<Array<{ skillId: string; label: string; keywords: string[] }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, label, keywords from public.skills where is_active
  `);
  return rows.map((row) => ({
    skillId: row.id as string,
    label: row.label as string,
    keywords: (row.keywords as string[]) ?? [],
  }));
}
