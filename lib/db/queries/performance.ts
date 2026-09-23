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

/**
 * The three things the filter row on the page narrows by.
 *
 * ⚠️ NULL MEANS "ALL", AND IT IS COMPARED IN SQL, NOT BRANCHED IN JS. Building
 * two versions of a statement is how a filter ends up applied to one CTE and
 * forgotten in the next — which on this page would show a department's people
 * beside the whole division's overdue count.
 */
export interface PerfFilters {
  /** `users.department_id` — the reference calls this "All teams". */
  readonly departmentId?: string | null;
  readonly projectId?: string | null;
  /**
   * One person, or null for everybody.
   *
   * Owner, 2026-09-23: *"If someone is clicked specifically then his whole
   * history, his whole performance, his whole contribution in each project, and
   * his whole assessment over time and over the month will be displayed."* So
   * the person is part of the SCOPE, not a way of hiding rows already drawn:
   * every read below narrows to them.
   */
  readonly personId?: string | null;
}

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
  filters: PerfFilters = {},
): Promise<PersonStat[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;
  const rows = await withUser(actorId, (tx) => tx`
    with done_in_period as (
      select t.assignee_id, t.id, t.due_date, t.completed_at, t.effort_points,
             (t.completed_at at time zone 'Asia/Karachi')::date as done_on
        from public.tasks t
       where not t.is_deleted
         and t.status = 'done'
         and t.completed_at is not null
         and (t.completed_at at time zone 'Asia/Karachi')::date between ${period.from}::date and ${period.to}::date
         and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
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
         and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
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
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
       and (${personId}::uuid is null or u.id = ${personId}::uuid)
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

export async function workNeedingAttention(
  actorId: string,
  today: string,
  filters: PerfFilters = {},
  limit = 12,
): Promise<AttentionRow[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;
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
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
       /* ⚠️ The DEPARTMENT of the person who holds it. An unassigned task has
          no department, so it stays out of a filtered view rather than being
          shown to every team as theirs. */
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
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

/* ── What the filter row is allowed to offer ─────────────────────────────── */

export interface FilterOptions {
  readonly teams: ReadonlyArray<{ id: string; name: string }>;
  readonly projects: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * The teams and projects that actually have work, for the two dropdowns.
 *
 * ⚠️ BUILT FROM THE DATA, NEVER A LIST IN THE CODE. The owner asked this of the
 * Clients page in the same words — *"whatever the project is, those projects
 * will automatically be added to a filter"* — and the answer has to hold here
 * too: a department nobody is in, or an archived project, is not an option
 * somebody can pick and then wonder why the page is empty.
 *
 * ⚠️ ONE WAVE. Two selects, one round trip — Rule Zero, law 4.
 */
export async function performanceFilterOptions(actorId: string): Promise<FilterOptions> {
  const [teams, projects] = await withUser(actorId, async (tx) => {
    const t = tx`
      select d.id, d.name
        from public.departments d
       where exists (select 1 from public.users u
                      where u.department_id = d.id and u.is_active)
       order by d.sort_order, d.name
    `;
    const p = tx`
      select p.id, p.name
        from public.projects p
       /* ⚠️ NOT deleted_at is null. Migration 053 adds that column and has
          never been applied — the live table has no such column, so the query
          fails with 42703. is_draft is what actually exists.
          (No backticks in here — they would end the template literal.) */
       where not coalesce(p.is_draft, false)
         and exists (select 1 from public.tasks x
                      where x.project_id = p.id and not x.is_deleted)
       order by p.name
    `;
    /* ⚠️ INSIDE ONE withUser, so both run on the one connection that has
       `app.user_id` set. Promise.all here does NOT parallelise — a transaction
       runs its statements in series — it simply avoids two awaits in a chain. */
    return Promise.all([t, p]);
  });

  return {
    teams: (teams as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), name: String(r.name) })),
    projects: (projects as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), name: String(r.name) })),
  };
}

/* ============================================================================
 * THE TABS — one read each, all bounded by the scope on screen
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"Their project and team will display which project they
 * are working on and which team they are working in. The workload tab shows how
 * much workload is on it ... the compare page will compare their performance
 * against month-wise performance."*
 *
 * Every one of these takes the same `PerfFilters`, so a person, a team or a
 * project narrows the whole page rather than one panel of it.
 * ========================================================================= */

/** What one project got out of the people in scope. */
export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly assigned: number;
  readonly completed: number;
  readonly onTime: number;
  readonly judged: number;
  readonly overdue: number;
  readonly openNow: number;
  readonly people: number;
}

export async function projectContribution(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
): Promise<ProjectRow[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const rows = await withUser(actorId, (tx) => tx`
    select p.id, p.name,
           count(t.id)::int as assigned,
           count(t.id) filter (
             where t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between ${period.from}::date and ${period.to}::date
           )::int as completed,
           count(t.id) filter (
             where t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between ${period.from}::date and ${period.to}::date
               and t.due_date is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date <= t.due_date
           )::int as on_time,
           count(t.id) filter (
             where t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between ${period.from}::date and ${period.to}::date
               and t.due_date is not null
           )::int as judged,
           count(t.id) filter (
             where t.status not in ('done', 'cancelled')
               and t.due_date is not null and t.due_date < ${period.today}::date
           )::int as overdue,
           count(t.id) filter (where t.status not in ('done', 'cancelled'))::int as open_now,
           count(distinct t.assignee_id)::int as people
      from public.projects p
      join public.tasks t on t.project_id = p.id and not t.is_deleted
      left join public.users u on u.id = t.assignee_id
     where (${projectId}::uuid is null or p.id = ${projectId}::uuid)
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
     group by p.id, p.name
    having count(t.id) > 0
     order by completed desc, open_now desc, p.name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    assigned: Number(r.assigned ?? 0),
    completed: Number(r.completed ?? 0),
    onTime: Number(r.on_time ?? 0),
    judged: Number(r.judged ?? 0),
    overdue: Number(r.overdue ?? 0),
    openNow: Number(r.open_now ?? 0),
    people: Number(r.people ?? 0),
  }));
}

/** A department, and what its people are carrying. */
export interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly people: number;
  readonly completed: number;
  readonly openNow: number;
  readonly overdue: number;
}

export async function teamContribution(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
): Promise<TeamRow[]> {
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const rows = await withUser(actorId, (tx) => tx`
    select d.id, d.name,
           count(distinct u.id)::int as people,
           count(t.id) filter (
             where t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between ${period.from}::date and ${period.to}::date
           )::int as completed,
           count(t.id) filter (where t.status not in ('done', 'cancelled'))::int as open_now,
           count(t.id) filter (
             where t.status not in ('done', 'cancelled')
               and t.due_date is not null and t.due_date < ${period.today}::date
           )::int as overdue
      from public.departments d
      join public.users u on u.department_id = d.id and u.is_active
      left join public.tasks t on t.assignee_id = u.id and not t.is_deleted
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
     where (${personId}::uuid is null or u.id = ${personId}::uuid)
     group by d.id, d.name, d.sort_order
    having count(distinct u.id) > 0
     order by d.sort_order, d.name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    people: Number(r.people ?? 0),
    completed: Number(r.completed ?? 0),
    openNow: Number(r.open_now ?? 0),
    overdue: Number(r.overdue ?? 0),
  }));
}

/** What one person is carrying right now, against what they can carry. */
export interface WorkloadRow {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly avatarUrl: string | null;
  readonly departmentName: string | null;
  readonly openNow: number;
  readonly overdue: number;
  readonly dueToday: number;
  readonly inReview: number;
  readonly blocked: number;
  readonly openPoints: number;
  readonly weeklyCapacityPoints: number;
  readonly maxConcurrentTasks: number;
  readonly completed: number;
}

export async function workloadRows(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
): Promise<WorkloadRow[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const rows = await withUser(actorId, (tx) => tx`
    select u.id, u.full_name, u.role_title, u.role::text as role, u.avatar_url,
           u.weekly_capacity_points, u.max_concurrent_tasks,
           d.name as department_name,
           count(t.id) filter (where t.status not in ('done', 'cancelled'))::int as open_now,
           count(t.id) filter (
             where t.status not in ('done', 'cancelled')
               and t.due_date is not null and t.due_date < ${period.today}::date
           )::int as overdue,
           count(t.id) filter (
             where t.status not in ('done', 'cancelled') and t.due_date = ${period.today}::date
           )::int as due_today,
           count(t.id) filter (where t.status = 'in_review')::int as in_review,
           count(t.id) filter (where t.status = 'blocked')::int as blocked,
           coalesce(sum(t.effort_points) filter (
             where t.status not in ('done', 'cancelled')
           ), 0)::int as open_points,
           count(t.id) filter (
             where t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between ${period.from}::date and ${period.to}::date
           )::int as completed
      from public.users u
      left join public.departments d on d.id = u.department_id
      left join public.tasks t on t.assignee_id = u.id and not t.is_deleted
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
     where u.is_active
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
       and (${personId}::uuid is null or u.id = ${personId}::uuid)
     group by u.id, u.full_name, u.role_title, u.role, u.avatar_url,
              u.weekly_capacity_points, u.max_concurrent_tasks, d.name
     order by open_now desc, u.full_name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.full_name),
    roleTitle: (r.role_title as string | null) ?? null,
    role: String(r.role),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    departmentName: (r.department_name as string | null) ?? null,
    openNow: Number(r.open_now ?? 0),
    overdue: Number(r.overdue ?? 0),
    dueToday: Number(r.due_today ?? 0),
    inReview: Number(r.in_review ?? 0),
    blocked: Number(r.blocked ?? 0),
    openPoints: Number(r.open_points ?? 0),
    weeklyCapacityPoints: Number(r.weekly_capacity_points ?? 0),
    maxConcurrentTasks: Number(r.max_concurrent_tasks ?? 0),
    completed: Number(r.completed ?? 0),
  }));
}

/* ── Quality ─────────────────────────────────────────────────────────────── */

export interface ReviewRow {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly projectName: string;
  readonly ownerName: string | null;
  readonly ownerAvatarUrl: string | null;
  readonly submittedAt: string | null;
}

export interface QualitySummary {
  readonly completed: number;
  readonly reviewed: number;
  readonly resubmitted: number;
  readonly reopened: number;
  /** Closures made by the person who did the work. */
  readonly selfClosed: number;
  /** Closures made by somebody else — the only real evidence of a second look. */
  readonly closedByOther: number;
  readonly queue: readonly ReviewRow[];
}

/**
 * How the work was checked, and by whom.
 *
 * ⚠️ THE HONEST HEADLINE HERE IS THAT REVIEW IS BARELY USED. Measured on the
 * live database, 5 of 917 closures were made by somebody other than the person
 * who did the work. A "first-pass acceptance rate" computed over that would be
 * a number with nothing behind it, so this returns the raw counts and the tab
 * says what they mean rather than dressing them as a score.
 */
export async function qualitySummary(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
): Promise<QualitySummary> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const [counts, queue] = await withUser(actorId, async (tx) => {
    const c = tx`
      with done_in as (
        select t.id, t.assignee_id
          from public.tasks t
          left join public.users u on u.id = t.assignee_id
         where not t.is_deleted and t.status = 'done' and t.completed_at is not null
           and (t.completed_at at time zone 'Asia/Karachi')::date
               between ${period.from}::date and ${period.to}::date
           and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
           and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
           and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
      ),
      /* as materialized for the reason in performanceBoard: inlined, these are
         re-evaluated once per completed task. */
      submitted as materialized (
        select a.entity_id, count(*)::int as times
          from public.activity_log a
         where a.entity_type = 'task' and a.action = 'in_review'
         group by a.entity_id
      ),
      reopened as materialized (
        select distinct a.entity_id
          from public.activity_log a
         where a.entity_type = 'task'
           and a.action in ('todo', 'in_progress', 'backlog')
           and exists (
             select 1 from public.activity_log d
              where d.entity_type = 'task' and d.entity_id = a.entity_id
                and d.action = 'done' and d.created_at < a.created_at
           )
      ),
      closer as materialized (
        select distinct on (a.entity_id) a.entity_id, a.actor_id
          from public.activity_log a
         where a.entity_type = 'task' and a.action = 'done'
         order by a.entity_id, a.created_at desc
      )
      select count(*)::int as completed,
             count(*) filter (where s.entity_id is not null)::int as reviewed,
             count(*) filter (where s.times > 1)::int as resubmitted,
             count(*) filter (where r.entity_id is not null)::int as reopened,
             count(*) filter (
               where c.actor_id is not null and c.actor_id = d.assignee_id
             )::int as self_closed,
             count(*) filter (
               where c.actor_id is not null and c.actor_id <> d.assignee_id
             )::int as closed_by_other
        from done_in d
        left join submitted s on s.entity_id = d.id
        left join reopened r on r.entity_id = d.id
        left join closer c on c.entity_id = d.id
    `;
    const q = tx`
      select t.id, t.reference, t.title, p.name as project_name,
             u.full_name as owner_name, u.avatar_url,
             (select max(a.created_at) from public.activity_log a
               where a.entity_type = 'task' and a.entity_id = t.id
                 and a.action = 'in_review') as submitted_at
        from public.tasks t
        join public.projects p on p.id = t.project_id
        left join public.users u on u.id = t.assignee_id
       where not t.is_deleted and t.status = 'in_review'
         and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
         and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
         and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
       order by submitted_at nulls last
       limit 25
    `;
    /* One connection, two statements — a transaction runs them in series, so
       this is not parallelism, only the absence of a second round trip. */
    return Promise.all([c, q]);
  });

  const row = (counts as Array<Record<string, unknown>>)[0] ?? {};
  return {
    completed: Number(row.completed ?? 0),
    reviewed: Number(row.reviewed ?? 0),
    resubmitted: Number(row.resubmitted ?? 0),
    reopened: Number(row.reopened ?? 0),
    selfClosed: Number(row.self_closed ?? 0),
    closedByOther: Number(row.closed_by_other ?? 0),
    queue: (queue as Array<Record<string, unknown>>).map((r) => ({
      taskId: String(r.id),
      reference: String(r.reference),
      title: String(r.title),
      projectName: String(r.project_name),
      ownerName: (r.owner_name as string | null) ?? null,
      ownerAvatarUrl: (r.avatar_url as string | null) ?? null,
      submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
    })),
  };
}

/* ── Compare, over time ──────────────────────────────────────────────────── */

export interface BucketRow {
  /** "2026-W38" or "2026-09". */
  readonly bucket: string;
  readonly startsOn: string | null;
  readonly completed: number;
  readonly onTime: number;
  readonly judged: number;
}

/**
 * Completed work per week or per month, for the trend on the Compare tab.
 *
 * ⚠️ WEEKS ARE THE HONEST UNIT HERE, AND THE TAB SAYS WHY. The owner asked for
 * *"month-wise performance"*; measured on the live database, every completed
 * task falls between 2026-09-02 and 2026-09-22 — one month, so a month-wise
 * chart is a single bar. The same range is four real weeks (121, 261, 411 and
 * 146 tasks), which is a trend somebody can act on. Both are offered; the
 * screen states what the record actually covers.
 */
export async function bucketTrend(
  actorId: string,
  by: 'week' | 'month',
  filters: PerfFilters = {},
  limit = 12,
): Promise<BucketRow[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;
  const pattern = by === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM';

  const rows = await withUser(actorId, (tx) => tx`
    select to_char((t.completed_at at time zone 'Asia/Karachi'), ${pattern}) as bucket,
           min((t.completed_at at time zone 'Asia/Karachi')::date) as starts_on,
           count(*)::int as completed,
           count(*) filter (
             where t.due_date is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date <= t.due_date
           )::int as on_time,
           count(*) filter (where t.due_date is not null)::int as judged
      from public.tasks t
      left join public.users u on u.id = t.assignee_id
     where not t.is_deleted and t.status = 'done' and t.completed_at is not null
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
     group by 1
     order by 1 desc
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>)
    .map((r) => ({
      bucket: String(r.bucket),
      startsOn: dateOnly(r.starts_on),
      completed: Number(r.completed ?? 0),
      onTime: Number(r.on_time ?? 0),
      judged: Number(r.judged ?? 0),
    }))
    .reverse();
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
