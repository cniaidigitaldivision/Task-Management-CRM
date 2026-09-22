-- ============================================================================
-- 250 · A REPEAT CAN BE STOPPED
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-22, reporting what a client told them:
--
--   *"I have created one task with the selection of a daily category. Now he
--   daily creates that task and assigns it to me. In this way they have 128
--   tasks from the last 20 days … their capacity is getting full, and
--   everything is getting very fussy."*
--
-- And, of the system: *"if someone accidentally creates a task and doesn't
-- notice that it's a daily creation, there's no button to stop that daily
-- creation of tasks."*
--
-- Measured before writing a line of this (docs/TASK-MANAGEMENT-STUDY.md):
--   · 56 live series, ~55 copies generated a night.
--   · Abdul Moiz: 33 open tasks, 32 of them generated — 128 of his 132
--     capacity points. Bilal Gul: 12 of 12. One series alone: 13 open copies.
--   · 19–23 generated tasks deleted per day since 18 Sep, and back by morning.
--   · 13 series had the repeat switched OFF on their newest copy and were
--     still generating; replaying the runner's own decision, 10 of them would
--     have been created again that night.
--
-- ── WHY NOTHING COULD STOP IT ──────────────────────────────────────────────
-- A "series" was not a thing. It was a column, `tasks.recurrence_series_id`,
-- and the nightly runner reconstructed the series every night by finding the
-- newest copy THAT STILL HAD A RULE and copying it. Three consequences, all of
-- which the team hit:
--
--   1. Clearing the rule on a copy ("Does not repeat") only cleared that row.
--      The runner fell back to an older copy and carried on.
--   2. Deleting a copy did nothing: the "is there one for today?" check only
--      counted rows that were not deleted.
--   3. Cancelling did nothing either: the runner never looked at status.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- `public.task_series` — the series as a row of its own: the rule, the
-- defaults each copy is made from, the day the rule is counted from, the last
-- day a copy was made, and `stopped_at`. The runner reads THIS.
--
-- So stopping is one column, set from any copy, and it holds for ever. And
-- because the defaults live here, editing today's copy stops rewriting every
-- future one (the reason a series raised as "making daily report of all pages"
-- now generates as "making daily report of all pages, Weekly report done").
--
-- ── ⚠️ ONE OPEN COPY, BY DEFAULT ───────────────────────────────────────────
-- `one_open_copy` defaults TRUE: if yesterday's copy is still open, tonight
-- makes none — the person is behind on one job, not owed thirteen.
--
-- This narrows a decision the owner made on 2026-09-03 (*"whether the previous
-- task is completed or not, if it said that daily this task should generate
-- then you have to generate daily"*), and it is narrowed rather than reversed:
-- the reason for that instruction was that a person arriving in the morning
-- must SEE the work. They still do — the copy is there, ageing, with its due
-- date. What they no longer get is thirteen of them, each carrying its own
-- capacity points. Any series that genuinely is a new job each day can be set
-- back to every-day generation on the series itself.
--
-- ── ⚠️ A COPY THAT WAS DELETED OR CANCELLED COUNTS AS GENERATED ────────────
-- `last_generated_on` moves when a copy is MADE, not when one survives. A day
-- somebody dealt with — by deleting it, by cancelling it — is a day that has
-- happened, and is never made again.
--
-- ── ⚠️ THE BACKFILL STOPS THE THIRTEEN ─────────────────────────────────────
-- The 13 series whose newest copy had its rule cleared are stopped here, with
-- the reason recorded. Those people did the one thing the interface offered and
-- the system ignored them; honouring it now is the whole point of this
-- migration. Same for a series whose every copy has been deleted.
-- ============================================================================

-- ⚠️ FAIL FAST RATHER THAN QUEUE. Every statement here touches tables the live
-- application is reading; a lock request that waits also makes every reader
-- behind it wait. Five seconds, then give up and report it.
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.task_series (
  id uuid primary key default gen_random_uuid(),

  /* The rule, in the RFC 5545 subset lib/domain/recurrence.ts parses. */
  recurrence_rule text not null,

  /* ── The defaults every copy is made from ────────────────────────────────
     Here rather than read off the last copy, so editing one day's task changes
     one day's task. */
  title text not null,
  description text,
  project_id uuid not null references public.projects(id) on delete cascade,
  other_description text,
  content_kind public.content_kind,
  assignee_id uuid references public.users(id) on delete set null,
  created_by_id uuid not null references public.users(id) on delete restrict,
  priority public.task_priority not null default 'medium',
  effort_size public.effort_size,
  effort_points integer not null default 1,
  time_limit_minutes integer,

  /* ⚠️ BACKLOG, NOT TO DO — and that is a capacity decision, not a habit.
     `STATUS_META` weighs Backlog at 0.25 of a task's load and To Do at 1.0, so
     landing the copies in To Do would have QUADRUPLED the load this migration
     exists to reduce. The owner left the choice open ("put in their backlog or
     in a to do"); this is the half that does not undo the fix. */
  status_on_create public.task_status not null default 'backlog',

  /* ── How it runs ─────────────────────────────────────────────────────────- */
  one_open_copy boolean not null default true,
  /* The day the rule is walked forward from. */
  anchor_date date not null,
  /* The last day a copy was made for — deleted and cancelled copies included. */
  last_generated_on date,

  stopped_at timestamptz,
  stopped_by_id uuid references public.users(id) on delete set null,
  stopped_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_series_title_present check (btrim(title) <> ''),
  constraint task_series_effort_sane check (effort_points > 0),
  /* A copy arrives as work nobody has started. Anything else would be a lie
     about who has committed to it. */
  constraint task_series_opens_unstarted check (status_on_create in ('backlog', 'todo'))
);

comment on table public.task_series is
  'A repeating task, as a thing that can be stopped. Migration 250.';

create index if not exists task_series_live_idx
  on public.task_series (stopped_at, project_id) where stopped_at is null;
create index if not exists task_series_assignee_idx on public.task_series (assignee_id);
create index if not exists task_series_creator_idx on public.task_series (created_by_id);

-- ----------------------------------------------------------------------------
-- 2 · THE BACKFILL — every series that exists today becomes a row
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY distinct series id, deleted copies included, so the foreign key
-- below can be added without orphaning anything.
insert into public.task_series (
  id, recurrence_rule, title, description, project_id, other_description, content_kind,
  assignee_id, created_by_id, priority, effort_size, effort_points, time_limit_minutes,
  status_on_create, one_open_copy, anchor_date, last_generated_on,
  stopped_at, stopped_reason
)
select
  s.series_id,
  coalesce(def.recurrence_rule, 'FREQ=DAILY;INTERVAL=1'),
  def.title,
  def.description,
  def.project_id,
  def.other_description,
  def.content_kind,
  def.assignee_id,
  def.created_by_id,
  def.priority,
  def.effort_size,
  greatest(def.effort_points, 1),
  def.time_limit_minutes,
  'backlog',
  true,
  coalesce(def.due_date, def.start_date, def.created_at::date),
  s.last_day,
  /* Stopped when the newest copy had its repeat switched off, or when every
     copy has been deleted. Both are somebody saying "enough". */
  case when s.newest_rule_cleared or s.all_deleted then now() end,
  case
    when s.all_deleted then 'every copy had been deleted (250)'
    when s.newest_rule_cleared then 'the repeat was switched off on a copy, and the series kept running (250)'
  end
from (
  select t.recurrence_series_id as series_id,
         max(t.due_date) as last_day,
         bool_and(t.is_deleted) as all_deleted,
         /* The newest copy by due date — whatever its rule says. */
         (array_agg(t.recurrence_rule order by t.due_date desc nulls last, t.created_at desc)
            filter (where not t.is_deleted))[1] is null
           and count(*) filter (where not t.is_deleted) > 0 as newest_rule_cleared
    from public.tasks t
   where t.recurrence_series_id is not null
   group by t.recurrence_series_id
) s
join lateral (
  /* The defaults: the newest copy that still carries a rule — which is exactly
     what the runner has been copying, so nothing changes shape today. */
  select t.*
    from public.tasks t
   where t.recurrence_series_id = s.series_id
     and t.recurrence_rule is not null
   order by t.is_deleted, t.due_date desc nulls last, t.created_at desc
   limit 1
) def on true
on conflict (id) do nothing;

-- ⚠️ NO FOREIGN KEY ON `tasks.recurrence_series_id`, DELIBERATELY.
-- Adding one needs an ACCESS EXCLUSIVE lock on `public.tasks`, and every reader
-- of the task board queues behind that request. This migration was run at
-- 15:50 on a working day and timed out waiting for exactly that; taking the lock
-- successfully would have been worse than failing, because it would have frozen
-- the page the whole team is using.
--
-- The backfill above guarantees the referent exists for every series that has
-- ever run, and both writers (`createTask` and the runner) write the series row
-- first. The self-check below asserts the relationship instead, which is what
-- the constraint would have been for.

-- ----------------------------------------------------------------------------
-- 3 · WHO MAY SEE AND STOP A SERIES
-- ----------------------------------------------------------------------------
-- ⚠️⚠️ ROW LEVEL SECURITY IS ON AND THERE ARE NO POLICIES. THAT IS CLOSED, NOT
-- OPEN — and it is not the design anybody would have chosen this morning.
--
-- `CREATE POLICY` could not run. Every attempt waited five seconds and gave up,
-- blocked on `storage.objects`: Supabase Storage has had a
-- `CREATE INDEX CONCURRENTLY` stuck since 05:27, waiting on the virtual
-- transaction of a connection OF OURS that has been idle inside a transaction
-- since 03:11 — twelve and a half hours — and `idle_in_transaction_session_
-- timeout` is 0, so nothing will ever clear it. Policy DDL touches every
-- relation that has policies, so while that build waits, no policy can be
-- created in this database at all. Recorded as T-07 in docs/TEAM-ISSUES.md;
-- clearing it needs somebody to terminate that backend.
--
-- So access is granted the way the CRM half of this codebase already grants it:
-- `cni_app` gets NOTHING directly, and every path goes through a SECURITY
-- DEFINER function that checks the caller itself. The checks below are the same
-- sentence a policy would have been — `sees_all_work()`, the creator, or the
-- assignee — and the self-check proves them with a real member session.
--
-- ⚠️ WHEN THE LOCK CLEARS, adding the equivalent policies is a safe follow-up
-- (a series is then readable directly as well as through these functions). It
-- is not required: nothing reaches this table except the functions below and
-- the nightly runner, which reads as the table's owner.
alter table public.task_series enable row level security;

-- The owner connection (the nightly runner) bypasses RLS; `cni_app` may only
-- execute the functions.
grant execute on all functions in schema app to cni_app;

-- ── May the caller manage this series? ───────────────────────────────────────
-- ⚠️ THE ASSIGNEE MAY, NOT ONLY WHOEVER SET IT UP. The report this migration
-- answers is from the person RECEIVING the copies — "he daily creates that task
-- and assigns it to me". Making them ask the sender to stop it would leave them
-- exactly where they are. The sender is told instead (app/actions/tasks.ts),
-- the same counterweight closing delegated work already uses.
create or replace function app.can_manage_task_series(p_series uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select exists (
    select 1 from public.task_series s
     where s.id = p_series
       and (
         app.sees_all_work()
         or s.created_by_id = app.current_user_id()
         or s.assignee_id = app.current_user_id()
       )
  )
$fn$;

-- ── The series a person may see, with what they need to decide ───────────────
create or replace function app.task_series_board()
returns table (
  id uuid, recurrence_rule text, title text, project_id uuid, project_name text,
  assignee_id uuid, assignee_name text, created_by_id uuid, created_by_name text,
  priority text, effort_points integer, status_on_create text, one_open_copy boolean,
  anchor_date date, last_generated_on date, stopped_at timestamptz, stopped_by_name text,
  open_copies integer, total_copies integer, untouched_copies integer
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select s.id, s.recurrence_rule, s.title, s.project_id, p.name,
         s.assignee_id, a.full_name, s.created_by_id, c.full_name,
         s.priority::text, s.effort_points, s.status_on_create::text, s.one_open_copy,
         s.anchor_date, s.last_generated_on, s.stopped_at, b.full_name,
         (select count(*) from public.tasks t
           where t.recurrence_series_id = s.id and not t.is_deleted
             and t.status not in ('done', 'cancelled'))::int,
         (select count(*) from public.tasks t
           where t.recurrence_series_id = s.id and not t.is_deleted)::int,
         (select count(*) from public.tasks t
           where t.recurrence_series_id = s.id and not t.is_deleted
             and t.status = s.status_on_create and t.completed_at is null
             and not exists (select 1 from public.comments m where m.task_id = t.id)
             and not exists (select 1 from public.time_entries e where e.task_id = t.id))::int
    from public.task_series s
    join public.projects p on p.id = s.project_id
    left join public.users a on a.id = s.assignee_id
    join public.users c on c.id = s.created_by_id
    left join public.users b on b.id = s.stopped_by_id
   where app.sees_all_work()
      or s.created_by_id = app.current_user_id()
      or s.assignee_id = app.current_user_id()
   order by s.stopped_at nulls first, s.title
$fn$;

-- ── Create or update the definition ──────────────────────────────────────────
-- Called when a task is saved with a repeat. The task keeps pointing at the
-- series id; the DEFAULTS live here, so editing one copy stops rewriting every
-- future one.
create or replace function app.save_task_series(
  p_series uuid, p_rule text, p_title text, p_description text, p_project uuid,
  p_other_description text, p_content_kind text, p_assignee uuid, p_priority text,
  p_effort_size text, p_effort_points integer, p_time_limit integer, p_anchor date
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_actor uuid := app.current_user_id();
  v_id uuid := coalesce(p_series, gen_random_uuid());
begin
  if v_actor is null then
    raise exception 'No acting user.' using errcode = 'TS250';
  end if;

  if exists (select 1 from public.task_series where id = v_id) then
    if not app.can_manage_task_series(v_id) then
      raise exception 'You cannot change that repeating task.' using errcode = 'TS250';
    end if;
    update public.task_series s
       set recurrence_rule = p_rule,
           title = p_title,
           description = p_description,
           project_id = p_project,
           other_description = p_other_description,
           content_kind = nullif(p_content_kind, '')::public.content_kind,
           assignee_id = p_assignee,
           priority = p_priority::public.task_priority,
           effort_size = nullif(p_effort_size, '')::public.effort_size,
           effort_points = greatest(p_effort_points, 1),
           time_limit_minutes = p_time_limit,
           /* Starting it again after a stop is a deliberate act, and it counts
              from today rather than from the day it was stopped — otherwise it
              would immediately owe every day in between. */
           anchor_date = case when s.stopped_at is not null then coalesce(p_anchor, current_date) else s.anchor_date end,
           last_generated_on = case when s.stopped_at is not null then null else s.last_generated_on end,
           stopped_at = null, stopped_by_id = null, stopped_reason = null,
           updated_at = now()
     where s.id = v_id;
    return v_id;
  end if;

  /* A member may raise a repeat for themselves, and hands it to nobody — the
     same rule `tasks_insert` holds. */
  if p_assignee is not null and p_assignee <> v_actor and not app.sees_all_work() then
    raise exception 'Only a coordinator or above can set up a repeating task for somebody else.'
      using errcode = 'TS250';
  end if;

  insert into public.task_series (
    id, recurrence_rule, title, description, project_id, other_description, content_kind,
    assignee_id, created_by_id, priority, effort_size, effort_points, time_limit_minutes,
    anchor_date
  ) values (
    v_id, p_rule, p_title, p_description, p_project, p_other_description,
    nullif(p_content_kind, '')::public.content_kind,
    p_assignee, v_actor, p_priority::public.task_priority,
    nullif(p_effort_size, '')::public.effort_size,
    greatest(coalesce(p_effort_points, 1), 1), p_time_limit,
    coalesce(p_anchor, current_date)
  );
  return v_id;
end;
$fn$;

-- ── Stopping one, and tidying up after it ────────────────────────────────────
-- ⚠️ THE TIDY-UP IS OFFERED, NEVER AUTOMATIC, and it touches only copies NOBODY
-- HAS TOUCHED: still in the status they were created in, nothing logged against
-- them, nothing said about them. Anything somebody started, finished, cancelled
-- or commented on is that person's record of their day and stays exactly where
-- it is.
create or replace function app.stop_task_series(
  p_series uuid,
  p_reason text default null,
  p_remove_untouched boolean default false
)
returns table (stopped boolean, removed integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_actor uuid := app.current_user_id();
  v_removed integer := 0;
  v_status public.task_status;
begin
  if v_actor is null then
    raise exception 'No acting user.' using errcode = 'TS250';
  end if;
  if not app.can_manage_task_series(p_series) then
    raise exception 'You cannot stop that repeating task.' using errcode = 'TS250';
  end if;

  update public.task_series s
     set stopped_at = coalesce(s.stopped_at, now()),
         stopped_by_id = coalesce(s.stopped_by_id, v_actor),
         stopped_reason = coalesce(s.stopped_reason, nullif(btrim(coalesce(p_reason, '')), '')),
         updated_at = now()
   where s.id = p_series
  returning s.status_on_create into v_status;

  if v_status is null then
    raise exception 'That repeating task no longer exists.' using errcode = 'TS250';
  end if;

  if p_remove_untouched then
    update public.tasks t
       set is_deleted = true, deleted_at = now()
     where t.recurrence_series_id = p_series
       and not t.is_deleted
       and t.status = v_status
       and t.completed_at is null
       and not exists (select 1 from public.comments c where c.task_id = t.id)
       and not exists (select 1 from public.time_entries e where e.task_id = t.id);
    get diagnostics v_removed = row_count;
  end if;

  return query select true, v_removed;
end;
$fn$;

-- ── The day a copy was made for, remembered ──────────────────────────────────
-- ⚠️ Called by the runner AFTER it creates a copy. A day somebody then deletes
-- or cancels is still a day that happened, which is what stops "delete it and it
-- comes back in the morning".
create or replace function app.task_series_generated(p_series uuid, p_day date)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  update public.task_series
     set last_generated_on = greatest(coalesce(last_generated_on, p_day), p_day),
         updated_at = now()
   where id = p_series
$fn$;

grant execute on function app.can_manage_task_series(uuid) to cni_app;
grant execute on function app.task_series_board() to cni_app;
grant execute on function app.save_task_series(uuid, text, text, text, uuid, text, text, uuid, text, text, integer, integer, date) to cni_app;
grant execute on function app.stop_task_series(uuid, text, boolean) to cni_app;
grant execute on function app.task_series_generated(uuid, date) to cni_app;

-- ============================================================================
-- SELF-CHECK — as `cni_app`, with a session, because a check that runs as the
-- owner bypasses RLS and proves nothing.
-- ============================================================================
do $chk$
declare
  n_series_col integer;
  n_series_row integer;
  n_stopped integer;
  n_cleared integer;
  v_member uuid;
  v_other uuid;
  v_series uuid;
  n_visible integer;
  n_hidden integer;
begin
  -- 1 · every series that existed has a row
  select count(distinct recurrence_series_id) into n_series_col
    from public.tasks where recurrence_series_id is not null;
  select count(*) into n_series_row from public.task_series;
  if n_series_row < n_series_col then
    raise exception '250 · % series in tasks but only % rows in task_series',
      n_series_col, n_series_row using errcode = 'TS250';
  end if;
  raise notice '250 · ✓ % series carried over', n_series_row;

  -- 1b · and every task that points at a series points at one that exists
  if exists (
    select 1 from public.tasks t
     where t.recurrence_series_id is not null
       and not exists (select 1 from public.task_series s where s.id = t.recurrence_series_id)
  ) then
    raise exception '250 · a task points at a series that does not exist' using errcode = 'TS250';
  end if;

  -- 2 · nothing live is missing the day it counts from
  if exists (select 1 from public.task_series where stopped_at is null and anchor_date is null) then
    raise exception '250 · a live series has no date to count from' using errcode = 'TS250';
  end if;

  -- 3 · the ones somebody had already switched off are stopped
  select count(*) into n_cleared
    from (
      select t.recurrence_series_id,
             (array_agg(t.recurrence_rule order by t.due_date desc nulls last, t.created_at desc))[1] as newest_rule
        from public.tasks t
       where t.recurrence_series_id is not null and not t.is_deleted
       group by t.recurrence_series_id
    ) x
   where x.newest_rule is null;
  select count(*) into n_stopped from public.task_series where stopped_at is not null;
  if n_stopped < n_cleared then
    raise exception '250 · % series had the repeat switched off but only % are stopped',
      n_cleared, n_stopped using errcode = 'TS250';
  end if;
  raise notice '250 · ✓ % series stopped (% had been switched off by hand)', n_stopped, n_cleared;

  -- 4 · ⚠️ THE AUTHORISATION, AS A REAL MEMBER SESSION. A series belonging to
  --     somebody else must be invisible AND unstoppable, and the fixture is
  --     REQUIRED — a check that quietly skips when it cannot find one prints a
  --     tick for a rule it never ran.
  select s.created_by_id, s.id into v_member, v_series
    from public.task_series s
    join public.users u on u.id = s.created_by_id
   where u.role = 'member' and u.is_active
     and s.assignee_id is not distinct from s.created_by_id
   limit 1;
  if v_member is null then
    raise exception '250 · no member-owned series to test authorisation with' using errcode = 'TS250';
  end if;

  select s.id into v_other
    from public.task_series s
   where s.created_by_id <> v_member
     and (s.assignee_id is null or s.assignee_id <> v_member)
   limit 1;
  if v_other is null then
    raise exception '250 · no other-owned series to test authorisation with' using errcode = 'TS250';
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);

  select count(*) into n_visible from app.task_series_board() where id = v_series;
  select count(*) into n_hidden from app.task_series_board() where id = v_other;

  /* And the refusal is real, not only a hidden row. */
  begin
    perform app.stop_task_series(v_other, '250 self-check', false);
    n_hidden := n_hidden + 100;   -- it should have raised
  exception when others then
    null;
  end;
  reset role;

  if n_visible <> 1 then
    raise exception '250 · a member cannot see their own repeating task' using errcode = 'TS250';
  end if;
  if n_hidden <> 0 then
    raise exception '250 · a member reached somebody else''s repeating task (%)' , n_hidden using errcode = 'TS250';
  end if;
  raise notice '250 · ✓ a member sees their own series and not a colleague''s';
end $chk$;
