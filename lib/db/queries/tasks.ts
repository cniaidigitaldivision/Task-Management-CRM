import 'server-only';

import { randomUUID } from 'node:crypto';

import { dateOnly, isoOrNull, timeOnly } from '../row-values';
import { TIMER_ALERTS, type TimerAlert } from '@/lib/domain/timers';

import type { ContentKind, EffortSize, Priority, TaskStatus } from '@/lib/domain/constants';

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
    t.assignee_id, a.full_name as assignee_name, a.avatar_url as assignee_avatar_url,
    t.created_by_id, c.full_name as created_by_name,
    t.status, t.priority, t.effort_size, t.effort_points,
    t.start_date, t.start_time, t.due_date, t.due_time, t.completed_at,
    t.blocked_reason, t.cancelled_reason, t.assignment_override_reason,
    t.time_limit_minutes, t.time_spent_minutes, t.timer_state, t.timer_started_at,
    t.extension_minutes_granted, t.recurrence_rule,
    t.content_kind, t.source_drive_url, t.asset_drive_url, t.published_on,
    t.created_at, t.updated_at,
    /* How many places this deliverable went, and how many of those are live.
       Both on the row so a task card can show "3 of 4 posted" without a second
       query per card — the same reasoning as the project aggregates. */
    (select count(*) from public.task_placements tp where tp.task_id = t.id) as placement_count,
    (select count(*) from public.task_placements tp
      where tp.task_id = t.id and tp.url is not null) as placement_live_count,
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
    assigneeAvatarUrl: (row.assignee_avatar_url as string | null) ?? null,
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
    startTime: timeOnly(row.start_time),
    dueDate: dateOnly(row.due_date),
    dueTime: timeOnly(row.due_time),
    completedAt: isoOrNull(row.completed_at),
    blockedReason: (row.blocked_reason as string | null) ?? null,
    cancelledReason: (row.cancelled_reason as string | null) ?? null,
    assignmentOverrideReason: (row.assignment_override_reason as string | null) ?? null,
    timeLimitMinutes: row.time_limit_minutes == null ? null : Number(row.time_limit_minutes),
    timeSpentMinutes: Number(row.time_spent_minutes ?? 0),
    timerState: row.timer_state as TaskRow['timerState'],
    timerStartedAt: isoOrNull(row.timer_started_at),
    extensionMinutesGranted: Number(row.extension_minutes_granted ?? 0),
    recurrenceRule: (row.recurrence_rule as string | null) ?? null,
    contentKind: (row.content_kind as ContentKind | null) ?? null,
    sourceDriveUrl: (row.source_drive_url as string | null) ?? null,
    assetDriveUrl: (row.asset_drive_url as string | null) ?? null,
    publishedOn: dateOnly(row.published_on),
    placementCount: Number(row.placement_count ?? 0),
    placementLiveCount: Number(row.placement_live_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    attachmentCount: Number(row.attachment_count ?? 0),
    checklistDone: Number(row.checklist_done ?? 0),
    checklistTotal: Number(row.checklist_total ?? 0),
    subtaskCount: Number(row.subtask_count ?? 0),
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
  };
}

/* `dateOnly`, `timeOnly` and `isoOrNull` moved to lib/db/row-values.ts.

   They were correct here and PRIVATE, which is exactly why eight other call sites
   wrote the plausible broken one-liner instead — and why the calendar displayed
   nothing at all until 2026-08-12. A right answer nobody can import is not
   available. */

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
  /* ── ⚠️ THE DUE WINDOW, AND WHY IT IS SERVER-SIDE NOW ──────────────────
     Owner, 2026-09-02: *"by default it should show only today's tasks not the
     whole month's tasks"*, and separately *"my system is getting heavy and
     slow... nothing is in my database right now, only 300 tasks."*

     Both had the same cause. The board shipped EVERY task and filtered in the
     browser: measured on the live database, 318 rows of which 293 are due in
     the FUTURE, serialising to 275 kB of JSON for a screen that shows 25 cards.
     Filtering client-side cannot fix that - the rows have already been read,
     serialised, transferred to Karachi, parsed and hydrated by the time any
     filter runs.

     Bounding it here instead takes the same page to 22 kB. Same filter, one
     layer down, where it costs nothing. */
  readonly dueFrom?: string;
  readonly dueTo?: string;
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

    /* ⚠️ UNDATED WORK SURVIVES EVERY WINDOW, exactly as the browser-side
       filter it replaces did (it guarded with `if (t.dueDate)`). A task with no
       due date is not outside a range - it has no date to be outside one - and
       dropping it here would make work vanish from the board rather than move.
       Only the bound that was actually given is applied, so an open-ended
       window stays open-ended. */
    if (filter.dueFrom || filter.dueTo) {
      let window = tx`t.due_date is null`;
      if (filter.dueFrom) window = tx`${window} or t.due_date >= ${filter.dueFrom}::date`;
      if (filter.dueTo) window = tx`${window} or t.due_date <= ${filter.dueTo}::date`;

      /* Both ends given means BETWEEN, not "either end matches" - the two
         clauses above are alternatives only when one side is unbounded. */
      if (filter.dueFrom && filter.dueTo) {
        conditions.push(
          tx`(t.due_date is null or (t.due_date >= ${filter.dueFrom}::date and t.due_date <= ${filter.dueTo}::date))`,
        );
      } else {
        conditions.push(tx`(${window})`);
      }
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

/** The four figures on the Tasks page's summary strip. */
export interface TaskTotals {
  readonly open: number;
  readonly done: number;
  readonly overdue: number;
  readonly activeProjects: number;
}

/**
 * The whole visible picture, as four numbers.
 *
 * ── ⚠️ WHY THIS QUERY NOW EXISTS, HAVING BEEN ARGUED AGAINST BEFORE ──────
 * The Tasks page used to count these in JavaScript over the full task list, and
 * a comment there explained - correctly at the time - that four `count(*)` round
 * trips to draw four small numbers would be the most expensive thing on the page.
 * That reasoning held only while the page was ALREADY loading every row.
 *
 * It no longer does: the board is scoped to a due window (owner, 2026-09-02).
 * Counting in memory would now mean counting the 25 rows on screen and labelling
 * the result "Open tasks", which would quietly turn a division-wide summary into
 * a restatement of what the reader can already see - and would make the number
 * change every time they moved the date filter.
 *
 * So the figures come from the database, over every visible row, and stay true
 * whatever the board is showing. It is ONE round trip, not four: `count(*)
 * filter (where ...)` computes all of them in a single pass, measured at ~2 ms.
 *
 * ⚠️ `overdue` uses the DIVISION's date, not the server's. `current_date` on a
 * database in Singapore is already tomorrow for the last five hours of a Karachi
 * evening, which would mark a full day of on-time work overdue every night. Same
 * trap as app.attendance_today().
 */
export async function taskTotals(actorId: string, filter: { projectId?: string; assigneeId?: string | null } = {}): Promise<TaskTotals> {
  const rows = await withUser(actorId, async (tx) => {
    const conditions = [tx`not t.is_deleted`];
    if (filter.projectId) conditions.push(tx`t.project_id = ${filter.projectId}`);
    if (filter.assigneeId !== undefined) {
      conditions.push(
        filter.assigneeId === null
          ? tx`t.assignee_id is null`
          : tx`t.assignee_id = ${filter.assigneeId}`,
      );
    }
    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    return tx`
      with d as (select (now() at time zone 'Asia/Karachi')::date as today)
      select
        count(*) filter (where t.status not in ('done', 'cancelled'))         as open,
        count(*) filter (where t.status = 'done')                             as done,
        count(*) filter (
          where t.status not in ('done', 'cancelled')
            and t.due_date is not null
            and t.due_date < (select today from d)
        )                                                                     as overdue,
        count(distinct t.project_id) filter (
          where t.status not in ('done', 'cancelled')
        )                                                                     as active_projects
      from public.tasks t
      where ${where}
    `;
  });

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  return {
    open: n(row.open),
    done: n(row.done),
    overdue: n(row.overdue),
    activeProjects: n(row.active_projects),
  };
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
  /** 'HH:MM'. Optional companion to startDate — migration 020. */
  readonly startTime?: string | null;
  readonly dueDate?: string | null;
  readonly dueTime?: string | null;
  readonly timeLimitMinutes?: number | null;
  readonly parentTaskId?: string | null;
  readonly assignmentOverrideReason?: string | null;
  readonly blockedReason?: string | null;
  readonly recurrenceRule?: string | null;

  /* ── The deliverable — migrations 033/034 ─────────────────────────────────
     What this task produces, and where the files live. `contentKind` is what
     makes a task countable against a package target; without it a task is work
     that happened, not a deliverable that was promised. */
  readonly contentKind?: ContentKind | null;
  /** Raw material — the coordinator's sheet calls it the "Google Drive link". */
  readonly sourceDriveUrl?: string | null;
  /** The finished file — the sheet's "Reels Drive link". */
  readonly assetDriveUrl?: string | null;
  /** The date it actually went live. NOT completed_at — see migration 033. */
  readonly publishedOn?: string | null;
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

    /* ── ⚠️ THE ID IS MADE HERE, AND `returning` IS DELIBERATELY ABSENT ───────
       This used to end `returning id`, which is the obvious way to write it and
       is broken for a Member. Found on 2026-08-22 when the schedule generator
       ran as a project owner who happens to be a Member: every insert failed
       with "new row violates row-level security policy for table tasks", while
       the identical insert without `returning` succeeded.

       PostgreSQL applies the SELECT policy to the row an INSERT returns. That
       policy is `app.task_is_visible(id)`, which is STABLE — so it reads the
       CALLING QUERY'S SNAPSHOT, taken before this insert existed. For a
       Coordinator or above the function short-circuits on rank and never looks
       at the table, so it passes; for a Member it has to find the row by id and
       cannot, because from that snapshot the row is not there yet. The check
       therefore fails for a person who is unambiguously allowed to create it.

       Reading the row back in a SEPARATE statement takes a fresh snapshot, and
       the same function then sees it — which is what the code below already
       does. So the only thing needed is an id known in advance.

       ⚠️ Do not "simplify" this back to `returning id`. It will pass every test
       run as an Admin and fail for every Member. */
    const id = randomUUID();

    await tx`
      insert into public.tasks (
        id, reference, title, description, project_id, other_description, parent_task_id,
        assignee_id, created_by_id, status, priority, effort_size, effort_points,
        start_date, start_time, due_date, due_time, blocked_reason, time_limit_minutes,
        assignment_override_reason, recurrence_rule,
        content_kind, source_drive_url, asset_drive_url, published_on
      ) values (
        ${id},
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
        ${input.startTime ?? null}::time,
        ${input.dueDate ?? null},
        ${input.dueTime ?? null}::time,
        ${input.blockedReason?.trim() || null},
        ${input.timeLimitMinutes ?? null},
        ${input.assignmentOverrideReason?.trim() || null},
        ${input.recurrenceRule ?? null},
        ${input.contentKind ?? null}::public.content_kind,
        ${input.sourceDriveUrl?.trim() || null},
        ${input.assetDriveUrl?.trim() || null},
        ${input.publishedOn ?? null}
      )
    `;

    const created = await tx`${TASK_SELECT(tx)} where t.id = ${id}`;
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
  /** 'HH:MM'. Optional companion to startDate — migration 020. */
  readonly startTime?: string | null;
  readonly dueDate?: string | null;
  readonly dueTime?: string | null;
  readonly timeLimitMinutes?: number | null;
  readonly recurrenceRule?: string | null;
  readonly contentKind?: ContentKind | null;
  readonly sourceDriveUrl?: string | null;
  readonly assetDriveUrl?: string | null;
  readonly publishedOn?: string | null;
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
        start_time        = case when ${has('startTime')} then ${input.startTime ?? null}::time else start_time end,
        due_time          = case when ${has('dueTime')} then ${input.dueTime ?? null}::time else due_time end,
        time_limit_minutes = case when ${has('timeLimitMinutes')} then ${input.timeLimitMinutes ?? null}::integer else time_limit_minutes end,
        recurrence_rule   = case when ${has('recurrenceRule')} then ${input.recurrenceRule ?? null} else recurrence_rule end,
        content_kind      = case when ${has('contentKind')} then ${input.contentKind ?? null}::public.content_kind else content_kind end,
        source_drive_url  = case when ${has('sourceDriveUrl')} then ${input.sourceDriveUrl ?? null} else source_drive_url end,
        asset_drive_url   = case when ${has('assetDriveUrl')} then ${input.assetDriveUrl ?? null} else asset_drive_url end,
        published_on      = case when ${has('publishedOn')} then ${input.publishedOn ?? null}::date else published_on end
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

/**
 * Start the clock, subject to the three-concurrent cap.
 *
 * Goes through `app.timer_start` (migration 024) rather than an UPDATE here,
 * because the cap has to hold whatever calls it — the application checks first so
 * the refusal can name the three running tasks, and the function is the backstop
 * that makes three a property of the system rather than of one code path.
 *
 * Returns what happened rather than throwing: `at_limit` is a normal answer to
 * give somebody, not an exception.
 */
export async function startTimer(
  actorId: string,
  taskId: string,
): Promise<'ok' | 'at_limit' | 'not_updated' | 'no_actor'> {
  const rows = await withUser(
    actorId,
    (tx) => tx`select app.timer_start(${taskId}::uuid) as result`,
  );
  return (rows[0]?.result as 'ok' | 'at_limit' | 'not_updated' | 'no_actor') ?? 'not_updated';
}

/**
 * Everything this person currently has running.
 *
 * Scoped by RLS like everything else, and additionally to their own assignments:
 * the timer bar is about what THEY are doing, so an Admin who can see the whole
 * division's timers should still not have thirty chips in their top bar.
 */
export async function runningTimers(actorId: string): Promise<
  Array<{
    taskId: string;
    reference: string;
    title: string;
    projectName: string;
    startedAt: string;
    minutesBefore: number;
    limitMinutes: number | null;
    alertsSent: TimerAlert[];
  }>
> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.timer_started_at, t.time_spent_minutes,
           t.time_limit_minutes, t.extension_minutes_granted, t.timer_alerts_sent,
           p.name as project_name
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.timer_state = 'running'::public.timer_state
       and not t.is_deleted
       and t.assignee_id = ${actorId}
     order by t.timer_started_at asc
  `);

  return rows.map((row) => ({
    taskId: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    projectName: row.project_name as string,
    startedAt: isoOrNull(row.timer_started_at) ?? new Date().toISOString(),
    minutesBefore: Number(row.time_spent_minutes ?? 0),
    /* The allowance INCLUDES any granted extension — the same rule the Time &
       overrun report uses, so a task with an approved extension is not warned
       about as though the extension had not been granted. */
    limitMinutes:
      row.time_limit_minutes === null
        ? null
        : Number(row.time_limit_minutes) + Number(row.extension_minutes_granted ?? 0),
    /* Narrowed rather than cast. `tasks_timer_alerts_known` already guarantees
       these three values, but that is a promise made by the database and this is
       the boundary where an unknown value becomes a typed one — so an unexpected
       string is dropped here instead of reaching a `switch` that has no case for
       it. Filtering is also what makes the type honest without an assertion. */
    alertsSent: ((row.timer_alerts_sent as string[] | null) ?? []).filter(
      (value): value is TimerAlert => (TIMER_ALERTS as readonly string[]).includes(value),
    ),
  }));
}

/** Claims one countdown alert. True only for the caller that recorded it. */
export async function markTimerAlert(
  actorId: string,
  taskId: string,
  alert: string,
): Promise<boolean> {
  const rows = await withUser(
    actorId,
    (tx) => tx`select app.timer_mark_alert(${taskId}::uuid, ${alert}) as claimed`,
  );
  return rows[0]?.claimed === true;
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

/* ==========================================================================
 * WHAT A CANCELLATION OR A PURGE WOULD ACTUALLY DISTURB
 * ==========================================================================
 * Owner instruction, Session 20: *"if I'm deleting, it should tell me a
 * confirmation message before deletion — that these things will be affected by
 * this deletion, and what the dependencies will be, and how I would have to
 * rearrange them."*
 *
 * ── ONE ROUND TRIP FOR THE WHOLE SELECTION ───────────────────────────────────
 * A bulk cancel can name twenty tasks. Asking per task would be twenty round
 * trips to Singapore before a dialog could open, and the dialog would appear
 * a second and a half after the click — which is exactly when somebody has
 * already clicked again.
 *
 * ── IT ANSWERS "WHAT BECOMES UNBLOCKED", NOT JUST "WHAT IS LINKED" ───────────
 * The interesting direction is `depends_on_task_id = these`: tasks that are
 * WAITING on the ones being removed. Those are the ones whose plan changes, and
 * they are what the owner meant by "how would I have to rearrange them".
 *
 * Row-level security applies throughout, so a Member's impact report cannot
 * name a task they are not entitled to see (ADR-003).
 * ========================================================================= */

export interface TaskImpact {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** Open subtasks. They follow the parent, so they are named before it happens. */
  readonly subtaskCount: number;
  readonly commentCount: number;
  readonly attachmentCount: number;
  readonly checklistCount: number;
  readonly minutesLogged: number;
  /** Tasks WAITING on this one — the plan that changes if it goes. */
  readonly blocks: ReadonlyArray<{ reference: string; title: string }>;
}

export async function describeImpact(
  actorId: string,
  taskIds: readonly string[],
): Promise<TaskImpact[]> {
  if (taskIds.length === 0) return [];

  const ids = [...taskIds];

  const [rows, edges] = await withUser(actorId, async (tx) => {
    const counts = await tx`
      select t.id, t.reference, t.title, t.status,
             (select count(*) from public.tasks st
               where st.parent_task_id = t.id and not st.is_deleted)      as subtask_count,
             (select count(*) from public.comments c
               where c.task_id = t.id)                                     as comment_count,
             (select count(*) from public.attachments a
               where a.task_id = t.id)                                     as attachment_count,
             (select count(*) from public.checklist_items ci
               where ci.task_id = t.id)                                    as checklist_count,
             (select coalesce(sum(te.minutes), 0) from public.time_entries te
               where te.task_id = t.id)                                    as minutes_logged
        from public.tasks t
       where t.id = any(${ids}::uuid[]) and not t.is_deleted
       order by t.reference
    `;

    const dependents = await tx`
      select d.depends_on_task_id as subject_id, t.reference, t.title
        from public.task_dependencies d
        join public.tasks t on t.id = d.task_id and not t.is_deleted
       where d.depends_on_task_id = any(${ids}::uuid[])
       order by t.reference
    `;

    return [counts, dependents] as const;
  });

  const blocksBy = new Map<string, Array<{ reference: string; title: string }>>();
  for (const edge of edges) {
    const key = edge.subject_id as string;
    const list = blocksBy.get(key) ?? [];
    list.push({ reference: edge.reference as string, title: edge.title as string });
    blocksBy.set(key, list);
  }

  return rows.map((row) => ({
    taskId: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    status: row.status as TaskStatus,
    subtaskCount: Number(row.subtask_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    attachmentCount: Number(row.attachment_count ?? 0),
    checklistCount: Number(row.checklist_count ?? 0),
    minutesLogged: Number(row.minutes_logged ?? 0),
    blocks: blocksBy.get(row.id as string) ?? [],
  }));
}

/* ==========================================================================
 * PURGE — permanent, Super Admin only
 * ==========================================================================
 * doc 03 §3 has had `task.purge` as Super-Admin-with-step-up since Step 3, and
 * it has never had an implementation. This is it.
 *
 * ── WHY A REAL DELETE, WHEN A SOFT DELETE ALREADY EXISTS ─────────────────────
 * FR-095's soft delete hides a task for 30 days and is the right answer almost
 * always. Purge is for the case it cannot serve: something that should never
 * have been recorded — a task created against the wrong client, carrying a name
 * or a note that must not sit in the database for a month.
 *
 * ── EVERYTHING ATTACHED GOES WITH IT, BY THE SCHEMA ──────────────────────────
 * `comments`, `attachments`, `checklist_items`, `time_entries`,
 * `task_dependencies`, `task_watchers` and `task_skills` are all
 * `on delete cascade` from `tasks`, and subtasks cascade through
 * `parent_task_id`. So one delete is genuinely one delete — there is no
 * half-purged state to design around.
 *
 * ⚠️ Storage objects are NOT cascaded. Postgres cannot reach into Supabase
 * Storage, so an attachment's row goes and its object would be left orphaned.
 * The caller removes those first; see purgeTasksAction.
 *
 * ⚠️⚠️ THIS CANNOT WORK YET, AND IT FAILS SILENTLY — MEASURED, NOT ASSUMED.
 * `public.tasks` has row-level security enabled and **no DELETE policy**:
 *
 *     policies on public.tasks → tasks_select (r), tasks_insert (a), tasks_update (w)
 *
 * With RLS on, a command with no policy is refused for every row — so this
 * deletes NOTHING and raises NOTHING. Verified against the real database as the
 * Super Admin through `cni_app`: **0 rows deleted.**
 *
 * This is the same trap Session 11 hit, where "the RLS delete policy being
 * Super-Admin-only meant an Admin's Reset deleted zero rows with no error".
 *
 * Closing it needs a migration adding `tasks_delete` restricted to
 * `app.current_user_role() = 'super_admin'`, and migrations wait for the
 * owner's go-ahead (rule R1). Until then `PURGE_IS_AVAILABLE` is false, the
 * control is not rendered, and the action refuses loudly rather than reporting
 * a success that did not happen.
 * ========================================================================= */

/* The flag itself lives in lib/capabilities.ts — a client component needs to
   read it too, and everything here is server-only. */

export async function purgeTasks(actorId: string, taskIds: readonly string[]): Promise<number> {
  if (taskIds.length === 0) return 0;
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.tasks where id = any(${[...taskIds]}::uuid[]) returning id
  `);
  return rows.length;
}

/** The storage paths a purge would orphan, read before the rows are gone. */
export async function attachmentPathsFor(
  actorId: string,
  taskIds: readonly string[],
): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await withUser(actorId, (tx) => tx`
    select file_path from public.attachments
     where task_id = any(${[...taskIds]}::uuid[])
  `);
  return rows.map((row) => row.file_path as string);
}
