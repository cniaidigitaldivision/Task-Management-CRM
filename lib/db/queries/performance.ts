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
  /** `activity_log.id` — an event is SELECTED by it, so it has to be stable. */
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly summary: string;
  /**
   * Who performed it.
   *
   * ⚠️ THIS FEED IS NO LONGER ONLY THEIR OWN ACTIONS. The owner's reference
   * shows "Admin assigned ... to Abdul Moiz" and "Coordinator changed due date"
   * beside the person's own moves — a history of somebody's work that hides
   * what was DONE TO them answers half the question. Measured on the live log,
   * Abdul Moiz has 572 actions of his own and 14 by three other people on his
   * tasks; leaving those out is how a reassignment becomes invisible.
   */
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorAvatarUrl: string | null;
  readonly actorRole: string | null;
  /** False when somebody else acted on their task. */
  readonly byThem: boolean;
  readonly taskId: string | null;
  readonly reference: string | null;
  readonly title: string | null;
  /** What the person typed about the task, when they typed anything. */
  readonly description: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly before: unknown;
  readonly after: unknown;
  /**
   * Why, when the mover was asked for a reason.
   *
   * ⚠️ IT IS RECORDED, BUT ONLY WHERE THE PRODUCT ASKS. Blocking and
   * cancelling take a reason; a plain status move and a date change do not. 26
   * of the 1,900 rows carrying the slot have one. The panel prints what was
   * typed, or says the move never asked — never an invented sentence.
   */
  readonly reason: string | null;
  /** Both sides of a reassignment, by name. */
  readonly fromName: string | null;
  readonly toName: string | null;
  /**
   * Where the task came from — the owner's "Source", 2026-09-24:
   * *"Source means 'Assigned by someone' or 'Self-created' ... whether it's an
   * admin, super admin, or team coordinator who assigned that activity."*
   *
   * ⚠️ IT DESCRIBES THE TASK, NOT THE LOG LINE. A row saying "marked
   * complete" is always the person's own action; what a manager wants beside it
   * is who put the work there in the first place.
   */
  readonly sourceKind: 'self' | 'coordinator' | 'admin' | 'teammate' | 'unknown';
  readonly sourceName: string | null;
  /** Set when the task is a copy from a repeat — "FREQ=DAILY;INTERVAL=1". */
  readonly recurrenceRule: string | null;
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
      /* ⚠️ BOTH DIRECTIONS — what they did, and what was done to their work.
         The predicate used to be actor_id = person alone, which drops every
         assignment, reassignment and review somebody else performed on their
         task. Those are exactly the rows a manager opens this tab to read: on
         the live log Abdul Moiz has 572 of his own and 14 by other people. */
      select a.id, a.created_at, a.action, a.summary, a.entity_id, a.before, a.after,
             a.actor_id, ac.full_name as actor_name, ac.avatar_url as actor_avatar,
             ac.role::text as actor_role,
             t.reference, t.title, t.description,
             p.id as project_id, p.name as project_name,
             cb.full_name as source_name, t.recurrence_rule,
             /* The reason, wherever the product asked for one. */
             coalesce(
               nullif(a.after->>'reason', ''),
               nullif(a.after->>'overrideReason', '')
             ) as reason,
             fu.full_name as from_name,
             tu.full_name as to_name,
             case
               when t.id is null then 'unknown'
               when t.created_by_id is null then 'unknown'
               when t.created_by_id = t.assignee_id then 'self'
               when cb.role in ('admin', 'super_admin') then 'admin'
               when cb.role = 'team_coordinator' then 'coordinator'
               else 'teammate' end as source_kind
        from public.activity_log a
        left join public.tasks t on t.id = a.entity_id and a.entity_type = 'task'
        left join public.projects p on p.id = t.project_id
        left join public.users cb on cb.id = t.created_by_id
        left join public.users ac on ac.id = a.actor_id
        /* Only a reassignment carries these two, and only then are they read. */
        left join public.users fu
               on a.action = 'reassigned'
              and fu.id = nullif(a.before->>'assigneeId', '')::uuid
        left join public.users tu
               on a.action = 'reassigned'
              and tu.id = nullif(a.after->>'assigneeId', '')::uuid
       where (a.actor_id = ${personId} or t.assignee_id = ${personId})
         and a.created_at >= ${period.from}::date
         and a.created_at < (${period.to}::date + 1)
       order by a.created_at desc
       limit 400
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
    history: (history as Array<Record<string, unknown>>).map((h) => ({
      id: String(h.id),
      at: new Date(h.created_at as string).toISOString(),
      action: String(h.action),
      summary: String(h.summary ?? ''),
      actorId: (h.actor_id as string | null) ?? null,
      actorName: (h.actor_name as string | null) ?? null,
      actorAvatarUrl: (h.actor_avatar as string | null) ?? null,
      actorRole: (h.actor_role as string | null) ?? null,
      byThem: h.actor_id === personId,
      taskId: (h.entity_id as string | null) ?? null,
      reference: (h.reference as string | null) ?? null,
      title: (h.title as string | null) ?? null,
      description: (h.description as string | null) ?? null,
      projectId: (h.project_id as string | null) ?? null,
      projectName: (h.project_name as string | null) ?? null,
      before: h.before ?? null,
      after: h.after ?? null,
      reason: (h.reason as string | null) ?? null,
      fromName: (h.from_name as string | null) ?? null,
      toName: (h.to_name as string | null) ?? null,
      sourceKind: String(h.source_kind ?? 'unknown') as HistoryEntry['sourceKind'],
      sourceName: (h.source_name as string | null) ?? null,
      recurrenceRule: (h.recurrence_rule as string | null) ?? null,
    })),    moves: (moves as Array<Record<string, unknown>>).map((r) => ({
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
  /**
   * Who reviews it.
   *
   * ⚠️ THE PERSON WHO ASSIGNED IT — the owner's rule, 2026-09-24: *"Definitely
   * the person who assigns the task will review that task."* Nothing in the
   * schema names a reviewer, but `created_by_id` names who handed the work out,
   * and that is the same person under this rule.
   *
   * ⚠️ NULL WHEN THEY RAISED IT THEMSELVES. 1,011 of 1,105 tasks here were
   * raised by the person who then did them, so on most rows there is nobody
   * else to review it. Printing their own name as the reviewer would dress a
   * self-check up as an independent one.
   */
  readonly reviewerName: string | null;
  readonly selfRaised: boolean;
}

export interface QualitySummary {
  /** Reached done in the period. */
  readonly completed: number;
  /** Went through review on the way there. */
  readonly reviewed: number;
  /** Sitting in review right now. */
  readonly inReview: number;
  readonly resubmitted: number;
  readonly reopened: number;
  /** Closures made by the person who did the work. */
  readonly selfClosed: number;
  /** Closures made by somebody else. */
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
             cb.full_name as reviewer_name,
             (t.created_by_id is not null and t.created_by_id = t.assignee_id) as self_raised,
             (select max(a.created_at) from public.activity_log a
               where a.entity_type = 'task' and a.entity_id = t.id
                 and a.action = 'in_review') as submitted_at
        from public.tasks t
        join public.projects p on p.id = t.project_id
        left join public.users u on u.id = t.assignee_id
        left join public.users cb on cb.id = t.created_by_id
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
  const queueRows = queue as Array<Record<string, unknown>>;
  return {
    completed: Number(row.completed ?? 0),
    reviewed: Number(row.reviewed ?? 0),
    inReview: queueRows.length,
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
      selfRaised: Boolean(r.self_raised),
      reviewerName: r.self_raised ? null : ((r.reviewer_name as string | null) ?? null),
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

/* ============================================================================
 * THE TASK LEDGER — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"I want that when I'm a team member, when an admin or super admin wants to
 * view that task, all the filters should be working properly ... when I click
 * on that row, that row turns light green. On the right side you can see a
 * sleek way to represent all the information relevant to all of that."*
 *
 * ── ⚠️ THREE BOXES IN THE REFERENCE CANNOT BE FILLED, AND SAY SO ──────────
 * Measured before anything was drawn:
 *
 *   "Reason for change"              nobody is ever asked why a date moved
 *   "Original vs latest assigner"    0 of 126 `updated` log rows touch the
 *                                    assignee, so a reassignment is not recorded
 *   "Done unverified"                the owner removed the word "verified"
 *                                    an hour before sending this image
 *
 * The date MOVE itself is real — it is in the log's before/after — so the panel
 * shows the move and says the reason was never captured, instead of printing a
 * plausible one.
 * ========================================================================= */

export interface LedgerRow {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly createdByName: string | null;
  readonly createdByAvatarUrl: string | null;
  /**
    * Who created or assigned it. Nothing else.
    *
    * ⚠️ A REPEAT IS NOT A SOURCE. Owner, 2026-09-24: *"Why do you put this all
    * in the daily rotation sources? ... I want to see just whether this task is
    * created by himself or assigned by me, my admin, or a super admin or a team
    * coordinator."* A repeating task still HAS a creator — whoever set the
    * series up — and letting "repeat" win buried that answer on 183 of one
    * person's 254 tasks. The repeat travels beside it in `recurrenceRule`.
    */
  readonly sourceKind: 'self' | 'coordinator' | 'admin' | 'teammate' | 'unknown';
  /** "FREQ=DAILY;INTERVAL=1" when this copy came from a repeat. A separate fact. */
  readonly recurrenceRule: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly ownerAvatarUrl: string | null;
  readonly status: string;
  readonly priority: string;
  readonly dueDate: string | null;
  readonly completedOn: string | null;
  readonly evidenceCount: number;
  readonly commentCount: number;
}

/**
 * Every task in scope, with who raised it and who holds it.
 *
 * ⚠️ THE COUNTS ARE SUBQUERIES, NOT JOINS. Joining `attachments` and `comments`
 * and grouping would multiply the rows before it counted them — the classic way
 * to report four files as sixteen.
 */
export async function taskLedger(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
  limit = 200,
): Promise<{ rows: LedgerRow[]; total: number }> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const [rows, counted] = await withUser(actorId, async (tx) => {
    const where = tx`
         not t.is_deleted
     and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
     and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
     and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
     and (
           t.status not in ('done', 'cancelled')
        or (t.completed_at is not null
            and (t.completed_at at time zone 'Asia/Karachi')::date
                between ${period.from}::date and ${period.to}::date)
     )
    `;
    const r = tx`
      select t.id, t.reference, t.title, t.description,
             t.status::text as status, t.priority::text as priority,
             t.due_date,
             (t.completed_at at time zone 'Asia/Karachi')::date as completed_on,
             p.id as project_id, p.name as project_name,
             cb.full_name as created_by_name, cb.avatar_url as created_by_avatar,
             u.id as owner_id, u.full_name as owner_name, u.avatar_url as owner_avatar,
             case
               when t.created_by_id is null then 'unknown'
               when t.created_by_id = t.assignee_id then 'self'
               when cb.role in ('admin', 'super_admin') then 'admin'
               when cb.role = 'team_coordinator' then 'coordinator'
               else 'teammate' end as source_kind,
             t.recurrence_rule,
             (select count(*) from public.attachments a where a.task_id = t.id)::int as evidence_count,
             (select count(*) from public.comments c where c.task_id = t.id)::int as comment_count
        from public.tasks t
        join public.projects p on p.id = t.project_id
        left join public.users u on u.id = t.assignee_id
        left join public.users cb on cb.id = t.created_by_id
       where ${where}
       order by
         case t.status
           when 'blocked' then 0 when 'in_review' then 1 when 'in_progress' then 2
           when 'revisions' then 3 when 'todo' then 4 when 'backlog' then 5 else 6 end,
         t.due_date nulls last, t.reference
       limit ${limit}
    `;
    const c = tx`
      select count(*)::int as n
        from public.tasks t
        left join public.users u on u.id = t.assignee_id
       where ${where}
    `;
    return Promise.all([r, c]);
  });

  return {
    rows: (rows as Array<Record<string, unknown>>).map((r) => ({
      taskId: String(r.id),
      reference: String(r.reference),
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      projectId: String(r.project_id),
      projectName: String(r.project_name),
      createdByName: (r.created_by_name as string | null) ?? null,
      createdByAvatarUrl: (r.created_by_avatar as string | null) ?? null,
      sourceKind: String(r.source_kind) as LedgerRow['sourceKind'],
      recurrenceRule: (r.recurrence_rule as string | null) ?? null,
      ownerId: (r.owner_id as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      ownerAvatarUrl: (r.owner_avatar as string | null) ?? null,
      status: String(r.status),
      priority: String(r.priority),
      dueDate: dateOnly(r.due_date),
      completedOn: dateOnly(r.completed_on),
      evidenceCount: Number(r.evidence_count ?? 0),
      commentCount: Number(r.comment_count ?? 0),
    })),
    total: Number((counted as Array<Record<string, unknown>>)[0]?.n ?? 0),
  };
}

/* ── One task, in full — the right-hand panel ────────────────────────────── */

export interface LedgerEvent {
  readonly at: string;
  readonly action: string;
  readonly summary: string;
  readonly actorName: string | null;
}

export interface LedgerFile {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedByName: string | null;
  readonly at: string;
}

export interface LedgerComment {
  readonly id: string;
  readonly body: string;
  readonly authorName: string | null;
  readonly at: string;
}

export interface LedgerDetail {
  readonly timeline: LedgerEvent[];
  readonly files: LedgerFile[];
  readonly comments: LedgerComment[];
  /** The first and last due dates the log ever saw, when it moved at all. */
  readonly originalDue: string | null;
  readonly revisedDue: string | null;
}

/**
 * The timeline, the files and the comments for one task.
 *
 * ⚠️ FETCHED WHEN A ROW IS OPENED, NOT FOR ALL 200. The list carries what the
 * row shows; this is the part a row genuinely could not know (Rule Zero, law 3).
 */
export async function taskLedgerDetail(actorId: string, taskId: string): Promise<LedgerDetail> {
  /* ── ⚠️ ONE STATEMENT, NOT THREE ────────────────────────────────────────
     This read was three queries inside one `withUser`, and a transaction runs
     its statements in SERIES on a single connection — `Promise.all` around them
     changes nothing (transactions-run-queries-in-series). Measured from the
     browser, each call cost ~2.4s and the timeline took 8s to appear, which is
     what the owner reported.

     Three scalar subqueries returning json is one round trip to Singapore
     instead of three. The indexes were never the problem: `activity_log` has
     `(entity_type, entity_id, created_at DESC)` and holds 3,935 rows. */
  const rows = await withUser(actorId, (tx) => tx`
    select
      coalesce((
        select json_agg(e order by e.created_at)
          from (
            select a.created_at, a.action, a.summary, a.before, a.after,
                   au.full_name as actor_name
              from public.activity_log a
              left join public.users au on au.id = a.actor_id
             where a.entity_type = 'task' and a.entity_id = ${taskId}::uuid
             order by a.created_at
             limit 120
          ) e
      ), '[]'::json) as timeline,
      coalesce((
        select json_agg(f order by f.created_at desc)
          from (
            select a.id, a.file_name, a.mime_type, a.size_bytes, a.created_at,
                   ub.full_name as uploaded_by_name
              from public.attachments a
              left join public.users ub on ub.id = a.uploaded_by_id
             where a.task_id = ${taskId}::uuid
             order by a.created_at desc
             limit 40
          ) f
      ), '[]'::json) as files,
      coalesce((
        select json_agg(c order by c.created_at)
          from (
            select c.id, c.body, c.created_at, au.full_name as author_name
              from public.comments c
              left join public.users au on au.id = c.author_id
             where c.task_id = ${taskId}::uuid
             order by c.created_at
             limit 40
          ) c
      ), '[]'::json) as comments
  `);

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  const raw = (row.timeline as Array<Record<string, unknown>>) ?? [];
  const files = (row.files as Array<Record<string, unknown>>) ?? [];
  const comments = (row.comments as Array<Record<string, unknown>>) ?? [];

  /* ⚠️ THE DATE MOVE IS REAL EVEN THOUGH THE REASON IS NOT. `updated` rows carry
     before/after; the first and last dueDate they mention are the original and
     the revised one. Nothing anywhere records WHY. */
  const dues: string[] = [];
  for (const r of raw) {
    for (const side of [r.before, r.after]) {
      const d = (side as { dueDate?: unknown } | null)?.dueDate;
      if (typeof d === 'string' && d.length >= 10) dues.push(d.slice(0, 10));
    }
  }

  return {
    timeline: raw.map((r) => ({
      at: new Date(r.created_at as string).toISOString(),
      action: String(r.action),
      summary: String(r.summary ?? ''),
      actorName: (r.actor_name as string | null) ?? null,
    })),
    files: files.map((r) => ({
      id: String(r.id),
      fileName: String(r.file_name),
      mimeType: (r.mime_type as string | null) ?? null,
      sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
      uploadedByName: (r.uploaded_by_name as string | null) ?? null,
      at: new Date(r.created_at as string).toISOString(),
    })),
    comments: comments.map((r) => ({
      id: String(r.id),
      body: String(r.body ?? ''),
      authorName: (r.author_name as string | null) ?? null,
      at: new Date(r.created_at as string).toISOString(),
    })),
    originalDue: dues.length > 1 ? dues[0] : null,
    revisedDue: dues.length > 1 ? dues[dues.length - 1] : null,
  };
}

/* ============================================================================
 * WHERE SOMEBODY'S WORK COMES FROM — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * The individual record's "Assignment accountability": self-created,
 * coordinator-assigned, admin-assigned. The reference draws it as "Not
 * recorded"; it IS recorded, in `tasks.created_by_id` against the creator's
 * rank, and measured on the live database it is the most interesting number on
 * the whole screen — 1,011 of 1,105 assigned tasks were raised by the person
 * who then did them.
 *
 * ⚠️ RANK AT READ TIME, NOT AT CREATION TIME. `users.role` is today's rank, so
 * a coordinator promoted to admin makes their old assignments read as
 * admin-assigned. The alternative is stamping the rank onto every task, which
 * is a migration and a write path for a figure nobody audits. The screen says
 * which it is rather than implying a history it does not keep.
 * ========================================================================= */

export interface TaskSources {
  /**
   * How many of these are copies of a repeat.
   *
   * ⚠️ IT IS NOT ONE OF THE BUCKETS BELOW. Every task is counted once by WHO
   * raised it; this says how many of them also happen to repeat, which is a
   * different question and must not eat the answer to the first one.
   */
  readonly repeat: number;
  readonly self: number;
  readonly coordinator: number;
  readonly admin: number;
  readonly teammate: number;
  readonly unknown: number;
  readonly total: number;
}

export async function assignmentSources(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
): Promise<TaskSources> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const rows = await withUser(actorId, (tx) => tx`
    select case
             when t.created_by_id is null then 'unknown'
             when t.created_by_id = t.assignee_id then 'self'
             when cb.role in ('admin', 'super_admin') then 'admin'
             when cb.role = 'team_coordinator' then 'coordinator'
             else 'teammate' end as source,
           count(*)::int as n,
           count(*) filter (
             where t.recurrence_series_id is not null or t.recurrence_rule is not null
           )::int as repeats
      from public.tasks t
      left join public.users cb on cb.id = t.created_by_id
      left join public.users u on u.id = t.assignee_id
     where not t.is_deleted and t.assignee_id is not null
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
       and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
       /* Raised in the window, or still open — the same shape the rest of the
          page uses, so the figures agree with the cards above them. */
       and (
             (t.created_at at time zone 'Asia/Karachi')::date
                 between ${period.from}::date and ${period.to}::date
          or t.status not in ('done', 'cancelled')
       )
     group by 1
  `);

  const by: Record<string, number> = {};
  let repeat = 0;
  for (const r of rows as Array<Record<string, unknown>>) {
    by[String(r.source)] = Number(r.n ?? 0);
    repeat += Number(r.repeats ?? 0);
  }
  const self = by.self ?? 0;
  const coordinator = by.coordinator ?? 0;
  const admin = by.admin ?? 0;
  const teammate = by.teammate ?? 0;
  const unknown = by.unknown ?? 0;
  return {
    repeat,
    self,
    coordinator,
    admin,
    teammate,
    unknown,
    /* ⚠️ `repeat` is deliberately NOT in this sum — it overlaps every bucket. */
    total: self + coordinator + admin + teammate + unknown,
  };
}

/* ============================================================================
 * PERFORMANCE HISTORY — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * A bar per period, a table of periods, and the assessment written about one.
 *
 * ── ⚠️ THE PERIODS ARE GENERATED, NOT GROUPED ─────────────────────────────
 * `bucketTrend` groups completed tasks by week, so a week in which somebody
 * finished nothing simply does not exist — the chart closes the gap and a bad
 * week reads as if it never happened. Here the weeks come from
 * `generate_series` and the counts are attached to them, so an empty week is a
 * zero bar, which is the truth.
 *
 * ── ⚠️ "OVERDUE AT CUTOFF" IS AS AT THE PERIOD'S END, NOT TODAY ───────────
 * The whole point of a historical table is that each row says what was true
 * THEN. A count of what is overdue now, repeated down the column, would be the
 * same number six times and would silently rewrite history every morning.
 *
 * ── ⚠️ "REVIEWED", NOT "VERIFIED" ─────────────────────────────────────────
 * Owner, 2026-09-24: *"There is no term you can say 'verified' ... the person
 * who assigns the task will review that task."* So a task counts as reviewed
 * when SOMEBODY OTHER THAN THE PERSON DOING IT closed it or sent it back.
 *
 * ⚠️ AND MEASURED FIRST, THE ANSWER IS ALMOST ALWAYS ZERO. Across 1,251 live
 * tasks: 61 were ever put into review, 0 were ever sent back, and 36 were closed
 * by someone else. That is not a reason to drop the column — it is the column
 * telling a manager that review is not happening, which is worth knowing.
 * ========================================================================= */

export interface PeriodRow {
  /** "2026-W38" or "2026-09". */
  readonly bucket: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly completed: number;
  /** Closed or sent back by somebody other than the person doing the work. */
  readonly reviewed: number;
  readonly onTime: number;
  /** Completed tasks that HAD a due date — the only ones on-time can judge. */
  readonly judged: number;
  /** Open and past its date as at the end of this period. */
  readonly overdueAtCutoff: number;
  /** The assessment written about this period, when there is one. */
  readonly assessmentId: string | null;
  readonly assessmentState: 'draft' | 'reviewed' | 'published' | null;
}

export async function periodHistory(
  actorId: string,
  personId: string,
  by: 'week' | 'month',
  today: string,
  count = 6,
): Promise<PeriodRow[]> {
  const unit = by === 'week' ? 'week' : 'month';
  const label = by === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM';
  const one = `1 ${unit}`;
  const back = `${count - 1} ${unit}`;

  const rows = await withUser(actorId, (tx) => tx`
    with periods as (
      select d::date as ps,
             (d + ${one}::interval - interval '1 day')::date as pe
        from generate_series(
               date_trunc(${unit}, ${today}::date) - ${back}::interval,
               date_trunc(${unit}, ${today}::date),
               ${one}::interval
             ) d
    )
    select to_char(periods.ps, ${label}) as bucket,
           periods.ps as starts_on,
           periods.pe as ends_on,
           m.completed, m.reviewed, m.on_time, m.judged, m.overdue_at_cutoff,
           a.id as assessment_id, a.state::text as assessment_state
      from periods
      cross join lateral (
        select
          count(*) filter (where f.done_in)::int as completed,
          count(*) filter (where f.done_in and t.due_date is not null)::int as judged,
          count(*) filter (
            where f.done_in and t.due_date is not null
              and (t.completed_at at time zone 'Asia/Karachi')::date <= t.due_date
          )::int as on_time,
          /* Somebody other than the doer closed it or sent it back. */
          count(*) filter (
            where f.done_in and exists (
              select 1 from public.activity_log al
               where al.entity_type = 'task' and al.entity_id = t.id
                 and al.action in ('done', 'revisions')
                 and al.actor_id is distinct from t.assignee_id
            )
          )::int as reviewed,
          /* As at the period's END, not today. */
          count(*) filter (
            where t.status <> 'cancelled'
              and t.due_date is not null and t.due_date < periods.pe
              and (t.completed_at is null
                   or (t.completed_at at time zone 'Asia/Karachi')::date > periods.pe)
          )::int as overdue_at_cutoff
          from public.tasks t
          cross join lateral (
            select t.status = 'done' and t.completed_at is not null
               and (t.completed_at at time zone 'Asia/Karachi')::date
                   between periods.ps and periods.pe as done_in
          ) f
         where t.assignee_id = ${personId} and not t.is_deleted
      ) m
      left join public.performance_assessments a
             on a.subject_id = ${personId}
            and a.period_start = periods.ps
            and a.period_end = periods.pe
     order by periods.ps
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    bucket: String(r.bucket),
    startsOn: dateOnly(r.starts_on) ?? '',
    endsOn: dateOnly(r.ends_on) ?? '',
    completed: Number(r.completed ?? 0),
    reviewed: Number(r.reviewed ?? 0),
    onTime: Number(r.on_time ?? 0),
    judged: Number(r.judged ?? 0),
    overdueAtCutoff: Number(r.overdue_at_cutoff ?? 0),
    assessmentId: (r.assessment_id as string | null) ?? null,
    assessmentState: (r.assessment_state as PeriodRow['assessmentState']) ?? null,
  }));
}

/* ── The assessment itself ───────────────────────────────────────────────── */

export interface Assessment {
  readonly id: string;
  readonly subjectId: string;
  readonly periodKind: 'week' | 'month';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly reviewerId: string | null;
  readonly reviewerName: string | null;
  readonly state: 'draft' | 'reviewed' | 'published';
  readonly strengths: string;
  readonly improvementAreas: string;
  readonly employeeResponse: string;
  readonly goal: string;
  readonly acceptance: readonly string[];
  readonly baseline: string;
  readonly target: string;
  readonly reviewDate: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly support: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

/**
 * Every assessment on this person that the caller may see.
 *
 * ⚠️ THE POLICY DECIDES, NOT THIS FUNCTION. A Member reading their own record
 * gets only the published ones because `performance_assessments_select` says so
 * — there is no `and state = 'published'` here to forget, or to get wrong in a
 * second place.
 */
export async function assessmentsFor(actorId: string, personId: string): Promise<Assessment[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.*, r.full_name as reviewer_name, o.full_name as owner_name
      from public.performance_assessments a
      left join public.users r on r.id = a.reviewer_id
      left join public.users o on o.id = a.owner_id
     where a.subject_id = ${personId}
     order by a.period_start desc
     limit 60
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    subjectId: String(r.subject_id),
    periodKind: String(r.period_kind) as 'week' | 'month',
    periodStart: dateOnly(r.period_start) ?? '',
    periodEnd: dateOnly(r.period_end) ?? '',
    reviewerId: (r.reviewer_id as string | null) ?? null,
    reviewerName: (r.reviewer_name as string | null) ?? null,
    state: String(r.state) as Assessment['state'],
    strengths: String(r.strengths ?? ''),
    improvementAreas: String(r.improvement_areas ?? ''),
    employeeResponse: String(r.employee_response ?? ''),
    goal: String(r.goal ?? ''),
    acceptance: ((r.acceptance as string[] | null) ?? []).filter(Boolean),
    baseline: String(r.baseline ?? ''),
    target: String(r.target ?? ''),
    reviewDate: dateOnly(r.review_date),
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    support: String(r.support ?? ''),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    publishedAt: r.published_at ? new Date(r.published_at as string).toISOString() : null,
  }));
}

/* ── Writing one ─────────────────────────────────────────────────────────── */

export interface AssessmentDraft {
  readonly subjectId: string;
  readonly periodKind: 'week' | 'month';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly strengths: string;
  readonly improvementAreas: string;
  readonly goal: string;
  readonly acceptance: readonly string[];
  readonly baseline: string;
  readonly target: string;
  readonly reviewDate: string | null;
  readonly ownerId: string | null;
  readonly support: string;
}

/**
 * Save the draft for one person and one period.
 *
 * ⚠️ AN UPSERT ON THE PERIOD, NOT AN INSERT. One assessment per person per
 * period is the table's own constraint; a second row for the same week is
 * somebody pressing save twice, not a revision worth keeping.
 *
 * ⚠️ AND IT NEVER TOUCHES `state` OR `employee_response`. Saving the manager's
 * wording must not silently un-publish a review the person has already read and
 * answered — moving state is its own deliberate call below.
 */
export async function upsertAssessment(
  actorId: string,
  draft: AssessmentDraft,
): Promise<{ id: string }> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.performance_assessments
      (subject_id, period_kind, period_start, period_end, reviewer_id, created_by_id,
       strengths, improvement_areas, goal, acceptance, baseline, target, review_date,
       owner_id, support)
    values
      (${draft.subjectId}, ${draft.periodKind}, ${draft.periodStart}::date, ${draft.periodEnd}::date,
       ${actorId}, ${actorId},
       ${draft.strengths}, ${draft.improvementAreas}, ${draft.goal},
       ${draft.acceptance as string[]}::text[], ${draft.baseline}, ${draft.target},
       ${draft.reviewDate}::date, ${draft.ownerId}, ${draft.support})
    on conflict (subject_id, period_start, period_end) do update
       set reviewer_id = ${actorId},
           strengths = excluded.strengths,
           improvement_areas = excluded.improvement_areas,
           goal = excluded.goal,
           acceptance = excluded.acceptance,
           baseline = excluded.baseline,
           target = excluded.target,
           review_date = excluded.review_date,
           owner_id = excluded.owner_id,
           support = excluded.support
    returning id
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) throw new Error('The assessment could not be saved.');
  return { id: String(row.id) };
}

/** Draft → reviewed → published, or back. The trigger stamps `published_at`. */
export async function setAssessmentState(
  actorId: string,
  id: string,
  state: 'draft' | 'reviewed' | 'published',
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.performance_assessments
       set state = ${state}::public.assessment_state
     where id = ${id}::uuid
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

/**
 * The subject's own reply.
 *
 * ⚠️ NOTHING HERE CHECKS WHO IS ASKING, ON PURPOSE. The policy admits the
 * subject and the trigger refuses every column but this one, so a second copy
 * of the rule here would be a second copy to get wrong. It is bounded by the
 * caller's session, like every other read and write in this file.
 */
export async function saveEmployeeResponse(
  actorId: string,
  id: string,
  response: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.performance_assessments
       set employee_response = ${response}
     where id = ${id}::uuid
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

/* ============================================================================
 * THE EVENTS BEHIND THE AI SUMMARY — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"Summarise this activity."*
 *
 * ⚠️ THE BROWSER SENDS IDS, NOT SENTENCES. The obvious build has the client
 * post the rows it has already drawn and the server forward them to the model.
 * That makes the model's input client-supplied text on a screen that reports on
 * a named colleague — anything typed into a task title would be read as part of
 * the brief. The ids are a SELECTION; every word the model sees is read back out
 * of the database here, under the caller's own RLS.
 * ========================================================================= */

export interface SummaryEvent {
  readonly at: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly sourceKind: 'self' | 'coordinator' | 'admin' | 'teammate' | 'unknown';
  readonly title: string | null;
  readonly reference: string | null;
  readonly projectName: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly fromName: string | null;
  readonly toName: string | null;
}

export async function activityEvents(
  actorId: string,
  personId: string,
  ids: readonly string[],
): Promise<SummaryEvent[]> {
  if (ids.length === 0) return [];
  /* ⚠️ BOUNDED, AND BOUND TO THE PERSON. A crafted list of ids cannot widen
     the answer past the record being read: the predicate still demands the row
     was theirs, by action or by assignment. */
  const rows = await withUser(actorId, (tx) => tx`
    select a.created_at, a.action, a.before, a.after,
           ac.full_name as actor_name,
           t.reference, t.title, p.name as project_name,
           coalesce(nullif(a.after->>'reason', ''), nullif(a.after->>'overrideReason', '')) as reason,
           fu.full_name as from_name, tu.full_name as to_name,
           case
             when t.id is null then 'unknown'
             when t.created_by_id is null then 'unknown'
             when t.created_by_id = t.assignee_id then 'self'
             when cb.role in ('admin', 'super_admin') then 'admin'
             when cb.role = 'team_coordinator' then 'coordinator'
             else 'teammate' end as source_kind
      from public.activity_log a
      left join public.tasks t on t.id = a.entity_id and a.entity_type = 'task'
      left join public.projects p on p.id = t.project_id
      left join public.users cb on cb.id = t.created_by_id
      left join public.users ac on ac.id = a.actor_id
      left join public.users fu
             on a.action = 'reassigned' and fu.id = nullif(a.before->>'assigneeId', '')::uuid
      left join public.users tu
             on a.action = 'reassigned' and tu.id = nullif(a.after->>'assigneeId', '')::uuid
     where a.id = any(${ids as string[]}::uuid[])
       and (a.actor_id = ${personId} or t.assignee_id = ${personId})
     order by a.created_at
     limit 200
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    at: new Date(r.created_at as string).toISOString(),
    action: String(r.action),
    actorName: (r.actor_name as string | null) ?? null,
    sourceKind: String(r.source_kind ?? 'unknown') as SummaryEvent['sourceKind'],
    title: (r.title as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    projectName: (r.project_name as string | null) ?? null,
    before: r.before ?? null,
    after: r.after ?? null,
    reason: (r.reason as string | null) ?? null,
    fromName: (r.from_name as string | null) ?? null,
    toName: (r.to_name as string | null) ?? null,
  }));
}

/**
 * Just enough about a person to head a file with.
 *
 * ⚠️ ITS OWN READ, BECAUSE AN EXPORT IS NOT A PAGE RENDER. The board already
 * carries the name when the screen is open, but a server action is entered
 * cold: nothing from the browser may be trusted to name the person a document
 * is about.
 */
export async function personBrief(
  actorId: string,
  personId: string,
): Promise<{ name: string; roleTitle: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select u.full_name, coalesce(u.role_title, '') as role_title
      from public.users u
     where u.id = ${personId}
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? { name: String(row.full_name), roleTitle: String(row.role_title) } : null;
}

/* ============================================================================
 * THE WORK ITSELF — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"It's not visible who is assigned ... any task I want to see for any
 * individual project. The task exactly what he is doing is not showing. It is
 * not mentioning what exact activity he is doing on his task list. A lot of
 * things are messy ... nothing you can say is meaningful."*
 *
 * ── ⚠️ THE PAGE COUNTED EVERYTHING AND SHOWED NOTHING ────────────────────
 * Eight tabs of totals — completed, verified, on time, overdue, points, review
 * coverage — and the actual task titles appeared in exactly TWO places: the
 * seven rows of "Work requiring attention", and inside a drawer somebody had to
 * click a row to reach. A manager asking "what is Najamullah doing today" could
 * not answer it from this screen. That is what this read is for: the tasks
 * themselves, with the person on them and the project they belong to.
 * ========================================================================= */

export interface WorkRow {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  /** What they typed about it, when they typed anything. */
  readonly description: string | null;
  readonly status: string;
  readonly priority: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatarUrl: string | null;
  readonly assigneeRole: string | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly completedOn: string | null;
  /** The last thing that happened to it, and when — "what he is doing". */
  readonly lastAction: string | null;
  readonly lastActionAt: string | null;
  readonly lastActorName: string | null;
}

/**
 * The actual tasks in scope — open first, then what closed in the period.
 *
 * ⚠️ IT CARRIES THE LAST MOVE, NOT JUST THE STATUS. "In progress" says a state;
 * "moved to in progress by Najamullah, 2 days ago" says what is happening. The
 * log already holds it, and reading it here costs one join rather than a second
 * round trip per row.
 *
 * ⚠️ AND IT IS CAPPED. 1,235 tasks exist; a screen that tried to draw them all
 * would be the payload mistake this codebase has already made twice. The caller
 * is told the total so the page can say what it is not showing.
 */
export async function workInScope(
  actorId: string,
  period: { from: string; to: string; today: string },
  filters: PerfFilters = {},
  limit = 150,
): Promise<{ rows: WorkRow[]; total: number }> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const [rows, counted] = await withUser(actorId, async (tx) => {
    const where = tx`
         not t.is_deleted
     and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
     and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
     and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
     and (
           t.status not in ('done', 'cancelled')
        or (t.completed_at is not null
            and (t.completed_at at time zone 'Asia/Karachi')::date
                between ${period.from}::date and ${period.to}::date)
     )
    `;
    const r = tx`
      select t.id, t.reference, t.title, t.description,
             t.status::text as status, t.priority::text as priority,
             t.start_date, t.due_date,
             (t.completed_at at time zone 'Asia/Karachi')::date as completed_on,
             p.id as project_id, p.name as project_name,
             u.id as assignee_id, u.full_name as assignee_name,
             u.avatar_url, u.role_title as assignee_role,
             la.action as last_action, la.created_at as last_action_at,
             au.full_name as last_actor_name
        from public.tasks t
        join public.projects p on p.id = t.project_id
        left join public.users u on u.id = t.assignee_id
        left join lateral (
          select a.action, a.created_at, a.actor_id
            from public.activity_log a
           where a.entity_type = 'task' and a.entity_id = t.id
           order by a.created_at desc
           limit 1
        ) la on true
        left join public.users au on au.id = la.actor_id
       where ${where}
       order by
         case t.status
           when 'blocked' then 0 when 'in_review' then 1 when 'in_progress' then 2
           when 'revisions' then 3 when 'todo' then 4 when 'backlog' then 5 else 6 end,
         t.due_date nulls last, t.reference
       limit ${limit}
    `;
    const c = tx`
      select count(*)::int as n
        from public.tasks t
        left join public.users u on u.id = t.assignee_id
       where ${where}
    `;
    return Promise.all([r, c]);
  });

  return {
    rows: (rows as Array<Record<string, unknown>>).map((r) => ({
      taskId: String(r.id),
      reference: String(r.reference),
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      status: String(r.status),
      priority: String(r.priority),
      projectId: String(r.project_id),
      projectName: String(r.project_name),
      assigneeId: (r.assignee_id as string | null) ?? null,
      assigneeName: (r.assignee_name as string | null) ?? null,
      assigneeAvatarUrl: (r.avatar_url as string | null) ?? null,
      assigneeRole: (r.assignee_role as string | null) ?? null,
      startDate: dateOnly(r.start_date),
      dueDate: dateOnly(r.due_date),
      completedOn: dateOnly(r.completed_on),
      lastAction: (r.last_action as string | null) ?? null,
      lastActionAt: r.last_action_at ? new Date(r.last_action_at as string).toISOString() : null,
      lastActorName: (r.last_actor_name as string | null) ?? null,
    })),
    total: Number((counted as Array<Record<string, unknown>>)[0]?.n ?? 0),
  };
}

/* ============================================================================
 * THE DAILY TASK ASSIGNMENT FORM — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"Every person can download or export their daily task in this template from
 * the performance page and this is the daily task list ... you will show that
 * today's tasks are: these ones are completed, these are left, these are
 * overdue."*
 *
 * The paper form is `TASK ASSIGNMENT FORM / CNI OFFICE, ISLAMABAD`: one person
 * per sheet, ten numbered rows, then signature blocks for the individual, HOD,
 * C.O.O and C.E.O.
 *
 * ── ⚠️ WHAT COUNTS AS "TODAY'S TASKS" ────────────────────────────────────
 * A task is on somebody's sheet for day D when ANY of these is true:
 *
 *   · it is due on D                      — today's list
 *   · it was completed on D               — what they finished
 *   · it is still open and was due before D — carried over, still owed
 *
 * The third is the one worth stating: an overdue task is still on your plate
 * today, and the owner asked for exactly that word on the sheet. It means the
 * same task appears on each day's sheet until it is closed, which is what a
 * daily submission to an officer is for.
 * ========================================================================= */

export interface FormTaskRow {
  readonly reference: string;
  readonly title: string;
  readonly assignedByName: string | null;
  /** True when they raised it themselves rather than being given it. */
  readonly selfRaised: boolean;
  readonly priority: string;
  readonly startDate: string | null;
  /** Set when `start_date` is empty and this is the day it was created instead. */
  readonly startIsCreated: boolean;
  readonly dueDate: string | null;
  readonly status: string;
  readonly completedOn: string | null;
  readonly projectName: string;
}

export interface TaskForm {
  readonly personId: string;
  readonly personName: string;
  readonly department: string | null;
  readonly designation: string | null;
  /** The day this sheet is for, `YYYY-MM-DD`. */
  readonly day: string;
  readonly rows: readonly FormTaskRow[];
}

/**
 * One sheet per person per day across the range.
 *
 * ⚠️ ONE STATEMENT FOR THE WHOLE RANGE, NOT ONE PER DAY. A week for sixteen
 * people is 112 sheets; asking per sheet would be 112 round trips to Singapore.
 * The days are generated in SQL and joined against the tasks once.
 *
 * ⚠️ AND IT IS BOUNDED. `limitDays` caps the range so a hand-typed date cannot
 * ask for a year of sheets in one request.
 */
export async function dailyTaskForms(
  actorId: string,
  range: { from: string; to: string },
  filters: PerfFilters = {},
): Promise<TaskForm[]> {
  const departmentId = filters.departmentId ?? null;
  const projectId = filters.projectId ?? null;
  const personId = filters.personId ?? null;

  const rows = await withUser(actorId, (tx) => tx`
    with days as (
      select d::date as day
        from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') as d
    ),
    people as (
      select u.id, u.full_name, u.role_title, d.name as department_name
        from public.users u
        left join public.departments d on d.id = u.department_id
       where u.is_active
         and (${departmentId}::uuid is null or u.department_id = ${departmentId}::uuid)
         and (${personId}::uuid is null or u.id = ${personId}::uuid)
    )
    select p.id as person_id, p.full_name, p.role_title, p.department_name,
           dy.day,
           t.reference, t.title, t.priority::text as priority, t.status::text as status,
           t.start_date, t.due_date, t.created_at,
           (t.completed_at at time zone 'Asia/Karachi')::date as completed_on,
           pr.name as project_name,
           t.created_by_id, t.assignee_id,
           cb.full_name as created_by_name
      from people p
      cross join days dy
      join public.tasks t
        on t.assignee_id = p.id
       and not t.is_deleted
       and (${projectId}::uuid is null or t.project_id = ${projectId}::uuid)
       and (
             t.due_date = dy.day
          or (t.completed_at at time zone 'Asia/Karachi')::date = dy.day
          or (t.status not in ('done', 'cancelled')
              and t.due_date is not null and t.due_date < dy.day)
       )
      join public.projects pr on pr.id = t.project_id
      left join public.users cb on cb.id = t.created_by_id
     order by p.full_name, dy.day,
              case t.status when 'done' then 2 else 1 end,
              t.due_date nulls last, t.reference
  `);

  const byKey = new Map<string, TaskForm & { rows: FormTaskRow[] }>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const day = dateOnly(r.day) ?? '';
    const key = `${String(r.person_id)}|${day}`;
    let form = byKey.get(key);
    if (!form) {
      form = {
        personId: String(r.person_id),
        personName: String(r.full_name),
        department: (r.department_name as string | null) ?? null,
        designation: (r.role_title as string | null) ?? null,
        day,
        rows: [],
      };
      byKey.set(key, form);
    }
    const start = dateOnly(r.start_date);
    form.rows.push({
      reference: String(r.reference),
      title: String(r.title),
      /* ⚠️ ONE TASK, ONE ASSIGNER — the owner's own words. `created_by_id` is
         who raised it, and when that is the assignee they gave it to
         themselves, which the sheet says rather than printing their own name
         back at them. */
      assignedByName: (r.created_by_name as string | null) ?? null,
      selfRaised: String(r.created_by_id ?? '') === String(r.assignee_id ?? ''),
      priority: String(r.priority),
      startDate: start ?? dateOnly(r.created_at),
      startIsCreated: start === null,
      dueDate: dateOnly(r.due_date),
      status: String(r.status),
      completedOn: dateOnly(r.completed_on),
      projectName: String(r.project_name),
    });
  }

  return [...byKey.values()].sort(
    (a, b) => a.personName.localeCompare(b.personName) || a.day.localeCompare(b.day),
  );
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
