import 'server-only';

import type { EffortSize, Priority, TaskStatus } from '@/lib/domain/constants';

import { withUser, type Tx } from '../client';
import type { ChecklistRow, CommentRow, TaskRow } from './types';

/* ============================================================================
 * TASK QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * Every function here runs inside `withUser`, which means row-level security is
 * live and the acting identity is set. Two consequences worth internalising:
 *
 *   1. NO FUNCTION HERE FILTERS BY VISIBILITY. There is no `where assignee_id =
 *      me` scattered through these queries, because migration 013 already
 *      decides that. A member calling `listTasks()` with no filters gets their
 *      own tasks — not because this file asked for that, but because the other
 *      rows do not exist for them. That is the difference between isolation as a
 *      property of the system and isolation as a habit of the query author.
 *
 *   2. A MISSING ROW AND A FORBIDDEN ROW ARE INDISTINGUISHABLE. `getTask()`
 *      returns null for both, which is correct: telling someone "that task
 *      exists but you may not see it" leaks the existence of work they have no
 *      business knowing about.
 *
 * ── NO RULES IN THIS FILE ────────────────────────────────────────────────────
 * Whether a status change is legal is decided by lib/domain/task-machine.ts.
 * These functions write what they are told. A permission check here would be a
 * second implementation of a rule that is already exhaustively tested elsewhere.
 * ========================================================================= */

/* The projection every task list shares. Written once because six call sites
   drifting apart is how a board and a dashboard start disagreeing about the
   same task. The counts are correlated subqueries rather than joins: joins
   against three satellite tables multiply rows and then need a GROUP BY over
   every selected column, which is both slower here and much easier to get
   subtly wrong. */
const TASK_SELECT = (tx: Tx) => tx`
  select
    t.id, t.reference, t.title, t.description,
    t.project_id, p.name as project_name, p.type as project_type, p.code as project_code,
    t.other_description, t.parent_task_id,
    t.assignee_id, a.full_name as assignee_name,
    t.created_by_id, c.full_name as created_by_name,
    t.status, t.priority, t.effort_size, t.effort_points,
    t.start_date, t.due_date, t.completed_at,
    t.blocked_reason, t.cancelled_reason, t.assignment_override_reason,
    t.time_limit_minutes, t.time_spent_minutes, t.timer_state, t.timer_started_at,
    t.extension_minutes_granted,
    t.created_at, t.updated_at,
    (select count(*) from public.comments        cm where cm.task_id = t.id) as comment_count,
    (select count(*) from public.attachments     at where at.task_id = t.id) as attachment_count,
    (select count(*) from public.checklist_items ci where ci.task_id = t.id) as checklist_total,
    (select count(*) from public.checklist_items ci where ci.task_id = t.id and ci.is_done) as checklist_done,
    (select count(*) from public.tasks st where st.parent_task_id = t.id and not st.is_deleted) as subtask_count
  from public.tasks t
  join public.projects p on p.id = t.project_id
  left join public.users a on a.id = t.assignee_id
  left join public.users c on c.id = t.created_by_id
`;

function toTask(row: Record<string, unknown>): TaskRow {
  return {
    id: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    projectId: row.project_id as string,
    projectName: row.project_name as string,
    projectType: row.project_type as TaskRow['projectType'],
    projectCode: row.project_code as string,
    otherDescription: (row.other_description as string | null) ?? null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    assigneeId: (row.assignee_id as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    createdById: row.created_by_id as string,
    createdByName: (row.created_by_name as string | null) ?? null,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    effortSize: (row.effort_size as EffortSize | null) ?? null,
    /* `numeric` arrives as a string from postgres.js — it refuses to silently
       lose precision. Every capacity sum downstream is arithmetic, so it is
       converted exactly once, here. */
    effortPoints: Number(row.effort_points),
    startDate: dateOnly(row.start_date),
    dueDate: dateOnly(row.due_date),
    completedAt: isoOrNull(row.completed_at),
    blockedReason: (row.blocked_reason as string | null) ?? null,
    cancelledReason: (row.cancelled_reason as string | null) ?? null,
    assignmentOverrideReason: (row.assignment_override_reason as string | null) ?? null,
    timeLimitMinutes: row.time_limit_minutes == null ? null : Number(row.time_limit_minutes),
    timeSpentMinutes: Number(row.time_spent_minutes ?? 0),
    timerState: row.timer_state as TaskRow['timerState'],
    timerStartedAt: isoOrNull(row.timer_started_at),
    extensionMinutesGranted: Number(row.extension_minutes_granted ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    attachmentCount: Number(row.attachment_count ?? 0),
    checklistDone: Number(row.checklist_done ?? 0),
    checklistTotal: Number(row.checklist_total ?? 0),
    subtaskCount: Number(row.subtask_count ?? 0),
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
  };
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/* ==========================================================================
 * READS
 * ========================================================================== */

export interface TaskFilter {
  readonly assigneeId?: string | null;
  readonly projectId?: string;
  readonly statuses?: readonly TaskStatus[];
  readonly includeClosed?: boolean;
  readonly search?: string;
  readonly limit?: number;
}

export async function listTasks(actorId: string, filter: TaskFilter = {}): Promise<TaskRow[]> {
  const rows = await withUser(actorId, async (tx) => {
    /* Built with postgres.js fragments rather than string concatenation, so
       every value stays a bound parameter. A `where` clause assembled by hand is
       how injection gets in, and "it is only an internal tool" has never once
       been a durable reason. */
    const conditions = [tx`not t.is_deleted`];

    if (filter.assigneeId !== undefined) {
      conditions.push(
        filter.assigneeId === null
          ? tx`t.assignee_id is null`
          : tx`t.assignee_id = ${filter.assigneeId}`,
      );
    }
    if (filter.projectId) conditions.push(tx`t.project_id = ${filter.projectId}`);
    if (filter.statuses?.length) {
      conditions.push(tx`t.status = any(${filter.statuses as unknown as string[]}::public.task_status[])`);
    }
    if (!filter.includeClosed && !filter.statuses?.length) {
      conditions.push(tx`t.status not in ('done', 'cancelled')`);
    }
    if (filter.search?.trim()) {
      const needle = `%${filter.search.trim()}%`;
      conditions.push(tx`(t.title ilike ${needle} or t.reference ilike ${needle})`);
    }

    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    return tx`
      ${TASK_SELECT(tx)}
      where ${where}
      order by
        case t.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
        t.due_date nulls last,
        t.created_at desc
      limit ${filter.limit ?? 500}
    `;
  });

  return rows.map(toTask);
}

export async function getTask(actorId: string, taskId: string): Promise<TaskRow | null> {
  const rows = await withUser(
    actorId,
    (tx) => tx`${TASK_SELECT(tx)} where t.id = ${taskId} and not t.is_deleted`,
  );
  return rows[0] ? toTask(rows[0]) : null;
}

export async function getTaskComments(actorId: string, taskId: string): Promise<CommentRow[]> {
  const rows = await withUser(
    actorId,
    (tx) => tx`
      select c.id, c.task_id, c.author_id, u.full_name as author_name, c.body,
             c.parent_comment_id, c.mentions, c.created_at, c.edited_at
        from public.comments c
        left join public.users u on u.id = c.author_id
       where c.task_id = ${taskId}
       order by c.created_at asc
    `,
  );
  return rows.map((row) => ({
    id: row.id as string,
    taskId: row.task_id as string,
    authorId: row.author_id as string,
    authorName: (row.author_name as string | null) ?? null,
    body: row.body as string,
    parentCommentId: (row.parent_comment_id as string | null) ?? null,
    mentions: (row.mentions as string[]) ?? [],
    createdAt: isoOrNull(row.created_at) ?? '',
    editedAt: isoOrNull(row.edited_at),
  }));
}

export async function getChecklist(actorId: string, taskId: string): Promise<ChecklistRow[]> {
  const rows = await withUser(
    actorId,
    (tx) => tx`
      select id, task_id, text, is_done, sort_order
        from public.checklist_items
       where task_id = ${taskId}
       order by sort_order, created_at
    `,
  );
  return rows.map((row) => ({
    id: row.id as string,
    taskId: row.task_id as string,
    text: row.text as string,
    isDone: row.is_done as boolean,
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

/** Every open task with an assignee — the one query the capacity engine needs. */
export async function listOpenTasksForCapacity(
  actorId: string,
): Promise<Array<{ assigneeId: string; effortPoints: number; priority: Priority; status: TaskStatus; dueDate: string | null }>> {
  const rows = await withUser(
    actorId,
    (tx) => tx`
      select assignee_id, effort_points, priority, status, due_date
        from public.tasks
       where not is_deleted
         and assignee_id is not null
         and status not in ('done', 'cancelled')
    `,
  );
  return rows.map((row) => ({
    assigneeId: row.assignee_id as string,
    effortPoints: Number(row.effort_points),
    priority: row.priority as Priority,
    status: row.status as TaskStatus,
    dueDate: dateOnly(row.due_date),
  }));
}

/** Status counts for the whole visible set, including closed work. */
export async function countTasksByStatus(
  actorId: string,
): Promise<Array<{ status: TaskStatus; count: number }>> {
  const rows = await withUser(
    actorId,
    (tx) => tx`
      select status, count(*) as n from public.tasks
       where not is_deleted group by status
    `,
  );
  return rows.map((row) => ({ status: row.status as TaskStatus, count: Number(row.n) }));
}

/* ==========================================================================
 * WRITES
 * ========================================================================== */

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null;
  readonly projectId: string;
  readonly otherDescription?: string | null;
  readonly assigneeId?: string | null;
  readonly status?: TaskStatus;
  readonly priority: Priority;
  readonly effortSize?: EffortSize | null;
  readonly effortPoints: number;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly timeLimitMinutes?: number | null;
  readonly parentTaskId?: string | null;
  readonly assignmentOverrideReason?: string | null;
  readonly blockedReason?: string | null;
}

/**
 * Create a task and its reference, in one transaction.
 *
 * The reference comes from `app.next_reference(project.code)`, so `EVT-142`
 * lines up with the project it belongs to. It is taken inside the same
 * transaction as the insert: if the insert fails a constraint — a missing
 * "Other" description, say — the number is released rather than skipped.
 */
export async function createTask(actorId: string, input: CreateTaskInput): Promise<TaskRow> {
  const row = await withUser(actorId, async (tx) => {
    const project = await tx`select code from public.projects where id = ${input.projectId}`;
    if (!project[0]) throw new Error('That project does not exist, or you cannot see it.');

    const ref = await tx`select app.next_reference(${project[0].code as string}) as reference`;

    const inserted = await tx`
      insert into public.tasks (
        reference, title, description, project_id, other_description, parent_task_id,
        assignee_id, created_by_id, status, priority, effort_size, effort_points,
        start_date, due_date, blocked_reason, time_limit_minutes,
        assignment_override_reason
      ) values (
        ${ref[0].reference as string},
        ${input.title.trim()},
        ${input.description?.trim() || null},
        ${input.projectId},
        ${input.otherDescription?.trim() || null},
        ${input.parentTaskId ?? null},
        ${input.assigneeId ?? null},
        ${actorId},
        ${input.status ?? 'todo'}::public.task_status,
        ${input.priority}::public.task_priority,
        ${input.effortSize ?? null}::public.effort_size,
        ${input.effortPoints},
        ${input.startDate ?? null},
        ${input.dueDate ?? null},
        ${input.blockedReason?.trim() || null},
        ${input.timeLimitMinutes ?? null},
        ${input.assignmentOverrideReason?.trim() || null}
      )
      returning id
    `;

    const created = await tx`${TASK_SELECT(tx)} where t.id = ${inserted[0].id as string}`;
    return created[0];
  });

  return toTask(row);
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly projectId?: string;
  readonly otherDescription?: string | null;
  readonly priority?: Priority;
  readonly effortSize?: EffortSize | null;
  readonly effortPoints?: number;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly timeLimitMinutes?: number | null;
}

/**
 * Patch the editable fields. Anything left undefined is untouched — `coalesce`
 * on a bound null would make "clear this due date" impossible to express, so
 * each column tests its own sentinel flag instead.
 */
export async function updateTask(
  actorId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<void> {
  const has = (k: keyof UpdateTaskInput) => Object.hasOwn(input, k);

  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks set
        title             = case when ${has('title')} then ${input.title ?? null} else title end,
        description       = case when ${has('description')} then ${input.description ?? null} else description end,
        project_id        = case when ${has('projectId')} then ${input.projectId ?? null}::uuid else project_id end,
        other_description = case when ${has('otherDescription')} then ${input.otherDescription ?? null} else other_description end,
        priority          = case when ${has('priority')} then ${input.priority ?? null}::public.task_priority else priority end,
        effort_size       = case when ${has('effortSize')} then ${input.effortSize ?? null}::public.effort_size else effort_size end,
        effort_points     = case when ${has('effortPoints')} then ${input.effortPoints ?? null} else effort_points end,
        start_date        = case when ${has('startDate')} then ${input.startDate ?? null}::date else start_date end,
        due_date          = case when ${has('dueDate')} then ${input.dueDate ?? null}::date else due_date end,
        time_limit_minutes = case when ${has('timeLimitMinutes')} then ${input.timeLimitMinutes ?? null}::integer else time_limit_minutes end
      where id = ${taskId} and not is_deleted
    `,
  );
}

/**
 * Apply a status change that has already been judged legal.
 *
 * Three things move together, and they have to: `completed_at` is constrained to
 * agree with `status = 'done'`, the blocked reason is cleared on the way out of
 * Blocked, and the timer stops when the new status is not one the timer runs in
 * (doc 17, FR-174). Doing any of these in a separate statement would leave a
 * window where the row violates its own check constraint.
 */
export async function applyStatus(
  actorId: string,
  taskId: string,
  to: TaskStatus,
  reason: string | null,
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks set
        status = ${to}::public.task_status,
        completed_at = case when ${to} = 'done' then now() else null end,
        blocked_reason = case
                           when ${to} = 'blocked' then ${reason}
                           else null
                         end,
        cancelled_reason = case
                             when ${to} = 'cancelled' then ${reason}
                             else cancelled_reason
                           end,
        timer_state = case
                        when ${to} in ('in_progress', 'revisions') then timer_state
                        when timer_state = 'running' then 'paused'::public.timer_state
                        else timer_state
                      end,
        timer_pause_reason = case
                               when ${to} not in ('in_progress', 'revisions') and timer_state = 'running'
                                 then 'status_change'::public.timer_pause_reason
                               else timer_pause_reason
                             end,
        time_spent_minutes = case
                               when ${to} not in ('in_progress', 'revisions') and timer_state = 'running'
                                 then time_spent_minutes
                                      + greatest(0, floor(extract(epoch from (now() - timer_started_at)) / 60))::integer
                               else time_spent_minutes
                             end,
        timer_started_at = case
                             when ${to} not in ('in_progress', 'revisions') and timer_state = 'running'
                               then null
                             else timer_started_at
                           end
      where id = ${taskId} and not is_deleted
    `,
  );
}

export async function assignTask(
  actorId: string,
  taskId: string,
  assigneeId: string | null,
  overrideReason: string | null,
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks
         set assignee_id = ${assigneeId},
             assignment_override_reason = ${overrideReason}
       where id = ${taskId} and not is_deleted
    `,
  );
}

/** FR-095. A soft delete, with the 30-day purge window starting now. */
export async function softDeleteTask(actorId: string, taskId: string): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks set is_deleted = true, deleted_at = now()
       where id = ${taskId} and not is_deleted
    `,
  );
}

/* ---- Comments ---- */

export async function addComment(
  actorId: string,
  taskId: string,
  body: string,
  mentions: readonly string[] = [],
): Promise<string> {
  const rows = await withUser(
    actorId,
    (tx) => tx`
      insert into public.comments (task_id, author_id, body, mentions)
      values (${taskId}, ${actorId}, ${body.trim()}, ${mentions as unknown as string[]}::uuid[])
      returning id
    `,
  );
  return rows[0].id as string;
}

/* ---- Checklist ---- */

export async function addChecklistItem(
  actorId: string,
  taskId: string,
  text: string,
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      insert into public.checklist_items (task_id, text, sort_order)
      values (
        ${taskId}, ${text.trim()},
        coalesce((select max(sort_order) + 1 from public.checklist_items where task_id = ${taskId}), 0)
      )
    `,
  );
}

export async function setChecklistItemDone(
  actorId: string,
  itemId: string,
  isDone: boolean,
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`update public.checklist_items set is_done = ${isDone} where id = ${itemId}`,
  );
}

export async function deleteChecklistItem(actorId: string, itemId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`delete from public.checklist_items where id = ${itemId}`);
}

/* ---- Timer (doc 17) ---- */

export async function startTimer(actorId: string, taskId: string): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks
         set timer_state = 'running'::public.timer_state,
             timer_started_at = now(),
             timer_pause_reason = null
       where id = ${taskId} and not is_deleted and timer_state <> 'running'
    `,
  );
}

/**
 * Stop the clock and bank the elapsed minutes.
 *
 * The elapsed time is computed in SQL from `timer_started_at` to `now()` — both
 * the database's clock. Sending the browser's idea of elapsed time would let a
 * client write its own time sheet, and would be wrong anyway by whatever the
 * clock skew happens to be (registry C-19 measured 22 seconds).
 */
export async function pauseTimer(
  actorId: string,
  taskId: string,
  reason: 'manual' | 'status_change' | 'outside_hours' | 'idle' | 'leave' = 'manual',
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      update public.tasks
         set timer_state = 'paused'::public.timer_state,
             timer_pause_reason = ${reason}::public.timer_pause_reason,
             time_spent_minutes = time_spent_minutes
               + greatest(0, floor(extract(epoch from (now() - timer_started_at)) / 60))::integer,
             timer_started_at = null
       where id = ${taskId} and not is_deleted and timer_state = 'running'
    `,
  );
}

export async function logManualTime(
  actorId: string,
  taskId: string,
  minutes: number,
  reason: string,
): Promise<void> {
  await withUser(actorId, async (tx) => {
    await tx`
      insert into public.time_entries (task_id, user_id, started_at, ended_at, minutes, source, reason)
      values (${taskId}, ${actorId}, now(), now(), ${minutes}, 'manual', ${reason.trim()})
    `;
    await tx`
      update public.tasks set time_spent_minutes = time_spent_minutes + ${minutes}
       where id = ${taskId}
    `;
  });
}
