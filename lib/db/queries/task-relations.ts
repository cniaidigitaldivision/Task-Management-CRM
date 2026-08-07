import 'server-only';

import type { Priority, TaskStatus } from '@/lib/domain/constants';
import type { DependencyEdge, DependencyType } from '@/lib/domain/dependencies';
import type { ExtensionStatus } from '@/lib/domain/extensions';

import { withUser } from '../client';

/* ============================================================================
 * TASK RELATIONS — LAYER 1
 * ----------------------------------------------------------------------------
 * Dependencies, watchers, required skills, subtasks and extension requests.
 * Separated from tasks.ts because that file is already the largest in the
 * layer, and because these five share one property that the task columns do
 * not: they are all rows ABOUT a task rather than fields OF one, so they are
 * read on the detail screen and nowhere else.
 *
 * Same contract as every other query module (doc 20 §1): RLS is live, nothing
 * here filters by visibility, and no rule is decided here. A dependency that
 * would form a cycle is refused by lib/domain/dependencies.ts before this file
 * is ever called.
 * ========================================================================= */

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/* ==========================================================================
 * DEPENDENCIES
 * ========================================================================== */

export interface DependencyRow {
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly type: DependencyType;
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly assigneeName: string | null;
}

/** What this task waits on. */
export async function listDependencies(
  actorId: string,
  taskId: string,
): Promise<DependencyRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.task_id, d.depends_on_task_id, d.type,
           t.reference, t.title, t.status, t.priority, u.full_name as assignee_name
      from public.task_dependencies d
      join public.tasks t on t.id = d.depends_on_task_id and not t.is_deleted
      left join public.users u on u.id = t.assignee_id
     where d.task_id = ${taskId}
     order by t.reference
  `);
  return rows.map(toDependency);
}

/** What waits on this task — the other direction, and the one people forget. */
export async function listDependents(actorId: string, taskId: string): Promise<DependencyRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.task_id, d.depends_on_task_id, d.type,
           t.reference, t.title, t.status, t.priority, u.full_name as assignee_name
      from public.task_dependencies d
      join public.tasks t on t.id = d.task_id and not t.is_deleted
      left join public.users u on u.id = t.assignee_id
     where d.depends_on_task_id = ${taskId}
     order by t.reference
  `);
  return rows.map(toDependency);
}

function toDependency(row: Record<string, unknown>): DependencyRow {
  return {
    taskId: row.task_id as string,
    dependsOnTaskId: row.depends_on_task_id as string,
    type: row.type as DependencyType,
    reference: row.reference as string,
    title: row.title as string,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    assigneeName: (row.assignee_name as string | null) ?? null,
  };
}

/**
 * Every blocks-edge the actor can see, for the cycle check.
 *
 * ── WHY THE WHOLE GRAPH AND NOT A NEIGHBOURHOOD ──────────────────────────────
 * A cycle can close through any path, so a check that loads only the immediate
 * neighbours would miss A → B → C → A — which is exactly the case that matters,
 * because nobody builds a two-node cycle by accident. The table holds one row
 * per relationship for the whole division; if it ever grows past what is
 * comfortable to load, the walk belongs in a recursive CTE, not in a smaller
 * fetch that answers the wrong question.
 *
 * RLS filters it, which is safe here: an edge the actor cannot see cannot be
 * one they are about to create, and the database's own `task_dependencies_write`
 * policy is the backstop.
 */
export async function listAllDependencyEdges(actorId: string): Promise<DependencyEdge[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select task_id, depends_on_task_id, type from public.task_dependencies
  `);
  return rows.map((row) => ({
    taskId: row.task_id as string,
    dependsOnTaskId: row.depends_on_task_id as string,
    type: row.type as DependencyType,
  }));
}

export async function addDependency(
  actorId: string,
  input: { taskId: string; dependsOnTaskId: string; type: DependencyType },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.task_dependencies (task_id, depends_on_task_id, type)
    values (${input.taskId}, ${input.dependsOnTaskId}, ${input.type}::public.dependency_type)
    on conflict (task_id, depends_on_task_id) do update set type = excluded.type
  `);
}

export async function removeDependency(
  actorId: string,
  taskId: string,
  dependsOnTaskId: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.task_dependencies
     where task_id = ${taskId} and depends_on_task_id = ${dependsOnTaskId}
  `);
}

/* ==========================================================================
 * WATCHERS
 * ========================================================================== */

export interface WatcherRow {
  readonly userId: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
}

export async function listWatchers(actorId: string, taskId: string): Promise<WatcherRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select w.user_id, u.full_name, u.role_title
      from public.task_watchers w
      join public.users u on u.id = w.user_id
     where w.task_id = ${taskId}
     order by u.full_name
  `);
  return rows.map((row) => ({
    userId: row.user_id as string,
    fullName: row.full_name as string,
    roleTitle: (row.role_title as string | null) ?? null,
  }));
}

/**
 * Idempotent on purpose. "Watch" pressed twice is the same intent twice, not an
 * error — and the alternative is a unique-violation the caller has to catch and
 * translate back into success.
 */
export async function addWatcher(
  actorId: string,
  taskId: string,
  userId: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.task_watchers (task_id, user_id) values (${taskId}, ${userId})
    on conflict do nothing
  `);
}

export async function removeWatcher(
  actorId: string,
  taskId: string,
  userId: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.task_watchers where task_id = ${taskId} and user_id = ${userId}
  `);
}

/** Assignee plus watchers, deduplicated — who a comment or status change reaches. */
export async function notifyAudience(actorId: string, taskId: string): Promise<string[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select user_id from public.task_watchers where task_id = ${taskId}
     union
    select assignee_id from public.tasks where id = ${taskId} and assignee_id is not null
  `);
  return rows.map((row) => row.user_id as string);
}

/* ==========================================================================
 * REQUIRED SKILLS — FR-055, what the matching engine reads
 * ========================================================================== */

export interface TaskSkillRow {
  readonly skillId: string;
  readonly slug: string;
  readonly label: string;
  readonly category: string | null;
  /** 1 nice to have · 2 needed · 3 essential. */
  readonly weight: number;
  readonly isActive: boolean;
}

export const SKILL_WEIGHT_LABEL: Record<number, string> = {
  1: 'Nice to have',
  2: 'Needed',
  3: 'Essential',
};

export async function listTaskSkills(actorId: string, taskId: string): Promise<TaskSkillRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select ts.skill_id, ts.weight, s.slug, s.label, s.category, s.is_active
      from public.task_skills ts
      join public.skills s on s.id = ts.skill_id
     where ts.task_id = ${taskId}
     order by ts.weight desc, s.label
  `);
  return rows.map((row) => ({
    skillId: row.skill_id as string,
    slug: row.slug as string,
    label: row.label as string,
    category: (row.category as string | null) ?? null,
    weight: Number(row.weight),
    isActive: row.is_active as boolean,
  }));
}

export async function setTaskSkill(
  actorId: string,
  taskId: string,
  skillId: string,
  weight: number,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.task_skills (task_id, skill_id, weight)
    values (${taskId}, ${skillId}, ${weight})
    on conflict (task_id, skill_id) do update set weight = excluded.weight
  `);
}

export async function removeTaskSkill(
  actorId: string,
  taskId: string,
  skillId: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.task_skills where task_id = ${taskId} and skill_id = ${skillId}
  `);
}

/* ==========================================================================
 * SUBTASKS
 * ========================================================================== */

export interface SubtaskRow {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly effortPoints: number;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly dueDate: string | null;
}

export async function listSubtasks(actorId: string, parentId: string): Promise<SubtaskRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.status, t.priority, t.effort_points,
           t.assignee_id, u.full_name as assignee_name, t.due_date
      from public.tasks t
      left join public.users u on u.id = t.assignee_id
     where t.parent_task_id = ${parentId} and not t.is_deleted
     order by t.created_at
  `);
  return rows.map((row) => ({
    id: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    effortPoints: Number(row.effort_points),
    assigneeId: (row.assignee_id as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
  }));
}

/** How deep a task sits. 0 for a top-level task, 1 for a subtask. */
export async function subtaskDepth(actorId: string, taskId: string): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select parent_task_id from public.tasks where id = ${taskId}
  `);
  if (!rows[0]) return 0;
  return rows[0].parent_task_id ? 1 : 0;
}

/* ==========================================================================
 * TIME EXTENSION REQUESTS — doc 17 §5
 * ========================================================================== */

export interface ExtensionRow {
  readonly id: string;
  readonly taskId: string;
  readonly taskReference: string;
  readonly taskTitle: string;
  readonly requestedById: string;
  readonly requestedByName: string | null;
  readonly requestedMinutes: number;
  readonly reason: string;
  readonly status: ExtensionStatus;
  readonly decidedById: string | null;
  readonly decidedByName: string | null;
  readonly grantedMinutes: number | null;
  readonly decisionNote: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  /** Context for the decision (doc 17 §5). */
  readonly taskLimitMinutes: number | null;
  readonly taskSpentMinutes: number;
  readonly taskDueDate: string | null;
  readonly priorDecidedOnTask: number;
}

const EXTENSION_SELECT = `
  select r.id, r.task_id, r.requested_by_id, r.requested_minutes, r.reason, r.status,
         r.decided_by_id, r.granted_minutes, r.decision_note, r.created_at, r.decided_at,
         t.reference as task_reference, t.title as task_title,
         t.time_limit_minutes as task_limit_minutes,
         t.time_spent_minutes as task_spent_minutes,
         t.due_date as task_due_date,
         requester.full_name as requested_by_name,
         decider.full_name as decided_by_name,
         (select count(*) from public.time_extension_requests prior
           where prior.task_id = r.task_id and prior.status <> 'pending'
             and prior.created_at < r.created_at) as prior_decided_on_task
    from public.time_extension_requests r
    join public.tasks t on t.id = r.task_id
    left join public.users requester on requester.id = r.requested_by_id
    left join public.users decider on decider.id = r.decided_by_id
`;

function toExtension(row: Record<string, unknown>): ExtensionRow {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    taskReference: row.task_reference as string,
    taskTitle: row.task_title as string,
    requestedById: row.requested_by_id as string,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    requestedMinutes: Number(row.requested_minutes),
    reason: row.reason as string,
    status: row.status as ExtensionStatus,
    decidedById: (row.decided_by_id as string | null) ?? null,
    decidedByName: (row.decided_by_name as string | null) ?? null,
    grantedMinutes: row.granted_minutes == null ? null : Number(row.granted_minutes),
    decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
    decidedAt: isoOrNull(row.decided_at),
    taskLimitMinutes: row.task_limit_minutes == null ? null : Number(row.task_limit_minutes),
    taskSpentMinutes: Number(row.task_spent_minutes ?? 0),
    taskDueDate: row.task_due_date ? String(row.task_due_date).slice(0, 10) : null,
    priorDecidedOnTask: Number(row.prior_decided_on_task ?? 0),
  };
}

export async function listExtensionsForTask(
  actorId: string,
  taskId: string,
): Promise<ExtensionRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    ${tx.unsafe(EXTENSION_SELECT)}
    where r.task_id = ${taskId}
    order by r.created_at desc
  `);
  return rows.map(toExtension);
}

/**
 * Everything still awaiting a decision.
 *
 * RLS decides the scope, not this query: `tx_select` shows an Admin every
 * request and shows everybody else only their own. So the same call powers the
 * Admin's queue and a Member's "waiting on an answer" list, and there is no
 * `where requested_by_id = me` here to get wrong.
 */
export async function listPendingExtensions(actorId: string): Promise<ExtensionRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    ${tx.unsafe(EXTENSION_SELECT)}
    where r.status = 'pending'
    order by r.created_at asc
  `);
  return rows.map(toExtension);
}

export async function createExtensionRequest(
  actorId: string,
  input: { taskId: string; requestedMinutes: number; reason: string },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.time_extension_requests
      (task_id, requested_by_id, requested_minutes, reason)
    values (${input.taskId}, ${actorId}, ${input.requestedMinutes}, ${input.reason.trim()})
    returning id
  `);
  return rows[0].id as string;
}

/**
 * Record the decision and, when time is granted, apply it — in one transaction.
 *
 * ── WHY THESE TWO WRITES CANNOT BE SEPARATE ──────────────────────────────────
 * The request row says "approved for 60 minutes"; the task's limit is what the
 * over-limit banner and the capacity engine actually read. If the second write
 * failed on its own, the requester would be told they had been granted an hour
 * they did not have, and the task would keep flagging as over limit with an
 * approval sitting next to it. One transaction, or the two disagree.
 *
 * ── FR-187 SAYS "RESUME THE TIMER", AND THERE IS NOTHING TO RESUME ──────────
 * Deliberately not implemented, because under doc 17 §4's chosen option B the
 * timer is never stopped at the limit in the first place — the task is flagged
 * OVER LIMIT and work continues, precisely so that nobody finishes the job
 * outside the system and back-fills it later. `timer_pause_reason` has no
 * `limit_reached` value for the same reason.
 *
 * So an approval raises the limit and clears the over-limit acknowledgement.
 * It does not touch `timer_state`: the only pauses that exist are leave,
 * outside-hours, idle, a status change and a manual one, and restarting any of
 * those on somebody's behalf would record time they are not spending.
 */
export async function decideExtension(
  actorId: string,
  input: {
    requestId: string;
    status: ExtensionStatus;
    grantedMinutes: number | null;
    note: string | null;
  },
): Promise<{ taskId: string; appliedMinutes: number } | null> {
  return withUser(actorId, async (tx) => {
    const updated = await tx`
      update public.time_extension_requests
         set status = ${input.status}::public.extension_status,
             decided_by_id = ${actorId},
             granted_minutes = ${input.grantedMinutes},
             decision_note = ${input.note?.trim() || null},
             decided_at = now()
       where id = ${input.requestId} and status = 'pending'
      returning task_id
    `;

    /* Zero rows means somebody else decided it first. Not an error — the
       outcome the caller wanted is already true — but it must not then apply
       the minutes a second time. */
    if (!updated[0]) return null;

    const taskId = updated[0].task_id as string;
    const minutes = input.grantedMinutes ?? 0;
    if (minutes <= 0) return { taskId, appliedMinutes: 0 };

    await tx`
      update public.tasks
         set time_limit_minutes = coalesce(time_limit_minutes, 0) + ${minutes},
             extension_minutes_granted = extension_minutes_granted + ${minutes},
             over_limit_acknowledged_at = null
       where id = ${taskId}
    `;

    return { taskId, appliedMinutes: minutes };
  });
}

export async function hasPendingExtension(actorId: string, taskId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    select 1 from public.time_extension_requests
     where task_id = ${taskId} and status = 'pending' limit 1
  `);
  return rows.length > 0;
}
