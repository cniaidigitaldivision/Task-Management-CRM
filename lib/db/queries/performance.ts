import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * WHAT THE TEAM PERFORMANCE PAGE READS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"I want to know or see a single person's performance: his
 * whole history, what he has done today and yesterday, how his performance is
 * going … every chitta-batta."*
 *
 * ── ⚠️ SCOPE IS ROW-LEVEL SECURITY, NOT THIS FILE ─────────────────────────
 * Nothing here filters by role. `activity_select` already admits a row only to
 * somebody who sees all work, who performed the action, or who can see the task
 * — so a Coordinator's page covers their people and a Member's covers
 * themselves, without any query remembering to ask. Same property `/tasks`
 * relies on (ADR-003).
 *
 * ── ⚠️ ONE WAVE, AND BOUNDED BY DATE ──────────────────────────────────────
 * `activity_log` holds 3,724 rows and grows every day. Every read here is
 * bounded by the period on screen, because the honest alternative — read
 * everything and total it in JavaScript — is the mistake this codebase has
 * already made twice on other pages.
 * ========================================================================= */

export interface PersonStat {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly avatarUrl: string | null;
  /** Reached Done inside the period. */
  readonly completed: number;
  /** …of those, the ones that went through review. */
  readonly reviewed: number;
  /** Judged on a deadline they had. */
  readonly onTime: number;
  readonly judged: number;
  /** Open and past their due date, right now. */
  readonly overdue: number;
  /** Open, whatever their date. */
  readonly openNow: number;
  /** Waiting on a reviewer right now. */
  readonly awaitingReview: number;
  readonly effortPoints: number;
  readonly weeklyCapacityPoints: number;
}

/**
 * Every person this reader may see, with what they did in the period.
 *
 * ⚠️ ONE STATEMENT, NOT ONE PER PERSON. The obvious shape — list the people,
 * then count each one's tasks — is N+1 round trips to Singapore for a table of
 * a dozen rows, and it grows with the division.
 */
export async function performanceBoard(
  actorId: string,
  period: { from: string; to: string; today: string },
): Promise<PersonStat[]> {
  const rows = await withUser(actorId, (tx) => tx`
    with done_in_period as (
      select t.assignee_id, t.id, t.due_date, t.completed_at, t.effort_points,
             (t.completed_at at time zone 'Asia/Karachi')::date as done_on
        from public.tasks t
       where not t.is_deleted
         and t.status = 'done'
         and t.completed_at is not null
         and (t.completed_at at time zone 'Asia/Karachi')::date between ${period.from}::date and ${period.to}::date
    ),
    /* ── ⚠️ as materialized, AND IT IS THE DIFFERENCE BETWEEN 8.7s AND 246ms ──
       Went through review on its way to done — the evidence a second pair of
       eyes was involved, rather than the doer closing their own work.

       Without the keyword Postgres inlines this CTE into the join and
       re-evaluates it once per completed task: 939 rows x a 22 ms scan of
       activity_log. Measured on the live database, the same query ran in
       8,694 ms inlined and 246 ms materialised. The log scan is small and
       fixed, so computing it once and joining is always the right shape here. */
    reviewed as materialized (
      select distinct a.entity_id
        from public.activity_log a
       where a.entity_type = 'task' and a.action = 'in_review'
    ),
    open_now as (
      select t.assignee_id,
             count(*)::int as open_now,
             count(*) filter (where t.due_date is not null and t.due_date < ${period.today}::date)::int as overdue,
             count(*) filter (where t.status = 'in_review')::int as awaiting_review
        from public.tasks t
       where not t.is_deleted and t.status not in ('done', 'cancelled')
       group by t.assignee_id
    )
    select u.id, u.full_name, u.role_title, u.role::text as role, u.avatar_url,
           u.weekly_capacity_points,
           coalesce(count(d.id), 0)::int as completed,
           coalesce(count(d.id) filter (where r.entity_id is not null), 0)::int as reviewed,
           coalesce(count(d.id) filter (where d.due_date is not null and d.done_on <= d.due_date), 0)::int as on_time,
           coalesce(count(d.id) filter (where d.due_date is not null), 0)::int as judged,
           coalesce(sum(d.effort_points), 0)::int as effort_points,
           coalesce(max(o.open_now), 0)::int as open_now,
           coalesce(max(o.overdue), 0)::int as overdue,
           coalesce(max(o.awaiting_review), 0)::int as awaiting_review
      from public.users u
      left join done_in_period d on d.assignee_id = u.id
      left join reviewed r on r.entity_id = d.id
      left join open_now o on o.assignee_id = u.id
     where u.is_active
     group by u.id, u.full_name, u.role_title, u.role, u.avatar_url, u.weekly_capacity_points
     order by completed desc, u.full_name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.full_name),
    roleTitle: (r.role_title as string | null) ?? null,
    role: String(r.role),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    completed: Number(r.completed ?? 0),
    reviewed: Number(r.reviewed ?? 0),
    onTime: Number(r.on_time ?? 0),
    judged: Number(r.judged ?? 0),
    overdue: Number(r.overdue ?? 0),
    openNow: Number(r.open_now ?? 0),
    awaitingReview: Number(r.awaiting_review ?? 0),
    effortPoints: Number(r.effort_points ?? 0),
    weeklyCapacityPoints: Number(r.weekly_capacity_points ?? 0),
  }));
}

/* ── Work that needs somebody, right now ─────────────────────────────────── */

export interface AttentionRow {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly status: string;
  readonly dueDate: string | null;
  readonly blockedReason: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatarUrl: string | null;
  readonly projectName: string;
  /** When it entered its current status — how long a review has been waiting. */
  readonly statusSince: string | null;
}

export async function workNeedingAttention(actorId: string, today: string, limit = 12): Promise<AttentionRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.status::text as status, t.due_date,
           t.blocked_reason, t.assignee_id, u.full_name as assignee_name, u.avatar_url,
           p.name as project_name,
           /* ⚠️ The last time it MOVED, from the log. The updated_at column
              changes when anybody edits anything, so a comment would reset a
              three-day review wait to zero and the queue would look healthy.
              (No backticks in here — they would end the template literal.) */
           (select max(a.created_at) from public.activity_log a
             where a.entity_type = 'task' and a.entity_id = t.id
               and a.action = t.status::text) as status_since
      from public.tasks t
      join public.projects p on p.id = t.project_id
      left join public.users u on u.id = t.assignee_id
     where not t.is_deleted
       and t.status not in ('done', 'cancelled')
       and (
         t.status in ('in_review', 'blocked')
         or (t.due_date is not null and t.due_date <= ${today}::date)
         or t.assignee_id is null
       )
     order by
       case t.status when 'blocked' then 0 when 'in_review' then 1 else 2 end,
       t.due_date nulls last
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    taskId: String(r.id),
    reference: String(r.reference),
    title: String(r.title),
    status: String(r.status),
    dueDate: dateOnly(r.due_date),
    blockedReason: (r.blocked_reason as string | null) ?? null,
    assigneeId: (r.assignee_id as string | null) ?? null,
    assigneeName: (r.assignee_name as string | null) ?? null,
    assigneeAvatarUrl: (r.avatar_url as string | null) ?? null,
    projectName: String(r.project_name),
    statusSince: r.status_since ? new Date(r.status_since as string).toISOString() : null,
  }));
}

/* ── One person, in full ─────────────────────────────────────────────────── */

export interface HistoryEntry {
  readonly at: string;
  readonly action: string;
  readonly summary: string;
  readonly taskId: string | null;
  readonly reference: string | null;
  readonly projectName: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export interface PersonTask {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly status: string;
  readonly projectName: string;
  readonly dueDate: string | null;
  readonly completedOn: string | null;
  readonly createdOn: string;
  readonly effortPoints: number;
  readonly attachments: number;
  readonly placements: number;
}

export interface PersonDetail {
  readonly tasks: PersonTask[];
  readonly history: HistoryEntry[];
  /** Status moves on the person's tasks, for the quality rules. */
  readonly moves: Array<{ taskId: string; action: string; actorId: string | null; at: string }>;
  /** Days present, from attendance — presence, which is not the same as hours worked. */
  readonly daysPresent: number;
  readonly firstSeen: string | null;
}

/**
 * Everything about one person in the period — the owner's *"whole history"*.
 *
 * ⚠️ FOUR READS IN ONE WAVE, not four waves. They have no dependency on each
 * other (Rule Zero, law 4), and the person's page is the slowest thing on this
 * screen if they are allowed to queue.
 */
export async function personDetail(
  actorId: string,
  personId: string,
  period: { from: string; to: string },
): Promise<PersonDetail> {
  const [tasks, history, moves, attendance] = await Promise.all([
    withUser(actorId, (tx) => tx`
      select t.id, t.reference, t.title, t.status::text as status, p.name as project_name,
             t.due_date, t.effort_points, t.created_at,
             (t.completed_at at time zone 'Asia/Karachi')::date as completed_on,
             (select count(*) from public.attachments at where at.task_id = t.id)::int as attachments,
             (select count(*) from public.task_placements tp where tp.task_id = t.id)::int as placements
        from public.tasks t
        join public.projects p on p.id = t.project_id
       where not t.is_deleted
         and t.assignee_id = ${personId}
         and (
           /* In the period if it was finished in it, was due in it, or is still
              open — an open task from last month is still this person's work. */
           (t.completed_at at time zone 'Asia/Karachi')::date between ${period.from}::date and ${period.to}::date
           or t.due_date between ${period.from}::date and ${period.to}::date
           or t.status not in ('done', 'cancelled')
         )
       order by t.due_date desc nulls last, t.created_at desc
       limit 400
    `),
    withUser(actorId, (tx) => tx`
      select a.created_at, a.action, a.summary, a.entity_id, a.before, a.after,
             t.reference, p.name as project_name
        from public.activity_log a
        left join public.tasks t on t.id = a.entity_id and a.entity_type = 'task'
        left join public.projects p on p.id = t.project_id
       where a.actor_id = ${personId}
         and a.created_at >= ${period.from}::date
         and a.created_at < (${period.to}::date + 1)
       order by a.created_at desc
       limit 300
    `),
    withUser(actorId, (tx) => tx`
      /* Every move on this person's tasks, whoever made it — the quality rules
         need the reviewer's actions as well as the doer's. */
      select a.entity_id, a.action, a.actor_id, a.created_at
        from public.activity_log a
        join public.tasks t on t.id = a.entity_id
       where a.entity_type = 'task'
         and t.assignee_id = ${personId}
         and not t.is_deleted
         and a.action in ('backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'revisions', 'done', 'cancelled')
       limit 3000
    `),
    withUser(actorId, (tx) => tx`
      select count(*)::int as days, min(on_date) as first_seen
        from public.attendance_days
       where user_id = ${personId}
         and on_date between ${period.from}::date and ${period.to}::date
         and checked_in_at is not null
    `),
  ]);

  const att = (attendance as Array<Record<string, unknown>>)[0] ?? {};
  return {
    tasks: (tasks as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      reference: String(r.reference),
      title: String(r.title),
      status: String(r.status),
      projectName: String(r.project_name),
      dueDate: dateOnly(r.due_date),
      completedOn: dateOnly(r.completed_on),
      createdOn: dateOnly(r.created_at) ?? '',
      effortPoints: Number(r.effort_points ?? 0),
      attachments: Number(r.attachments ?? 0),
      placements: Number(r.placements ?? 0),
    })),
    history: (history as Array<Record<string, unknown>>).map((r) => ({
      at: new Date(r.created_at as string).toISOString(),
      action: String(r.action),
      summary: String(r.summary ?? ''),
      taskId: (r.entity_id as string | null) ?? null,
      reference: (r.reference as string | null) ?? null,
      projectName: (r.project_name as string | null) ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
    })),
    moves: (moves as Array<Record<string, unknown>>).map((r) => ({
      taskId: String(r.entity_id),
      action: String(r.action),
      actorId: (r.actor_id as string | null) ?? null,
      at: new Date(r.created_at as string).toISOString(),
    })),
    daysPresent: Number(att.days ?? 0),
    firstSeen: dateOnly(att.first_seen),
  };
}

/* ── How the period compares with the one before it ──────────────────────── */

export async function completedInWindow(
  actorId: string,
  window: { from: string; to: string },
  personId?: string | null,
): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*)::int as n
      from public.tasks t
     where not t.is_deleted and t.status = 'done' and t.completed_at is not null
       and (t.completed_at at time zone 'Asia/Karachi')::date between ${window.from}::date and ${window.to}::date
       and (${personId ?? null}::uuid is null or t.assignee_id = ${personId ?? null}::uuid)
  `);
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
}

/**
 * `date`/`timestamptz` as `YYYY-MM-DD`.
 *
 * ⚠️ NOT `String(value).slice(0, 10)`. postgres.js returns a `date` as a JS Date
 * at UTC midnight, so that gives `'Tue Sep 22'` — the trap documented in
 * ./repeats.ts, which silently emptied a column on the Repeating tasks page.
 */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
