-- ============================================================================
-- 097 · THE SCHEDULE RUNNER'S READER AND WRITER — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- Two functions so the cron can find the schedules that are due and record what
-- happened. Nothing else changes.
--
-- ── ⚠️ SECURITY DEFINER, BECAUSE RLS FAILS CLOSED FOR A CRON ────────────────
-- A cron request has no session, so `app.current_user_id()` is NULL and every
-- policy in this database evaluates false. The failure mode is the dangerous
-- one: not an error but a SILENT ZERO-ROW READ, so the runner reports "0
-- schedules due, ok" forever while nothing is ever filed. That exact shape has
-- already happened twice on this feature — 094 and 095 exist because of it, and
-- the second produced a run that looked SUCCESSFUL while writing nothing.
--
-- So the reader is SECURITY DEFINER and narrow: it returns only the columns the
-- runner needs, only for ACTIVE schedules, only when due. Widening a policy
-- instead would have handed the same rows to every signed-in person.
--
-- ── ⚠️ THE DATE IS PASSED IN, NOT READ FROM `current_date` ──────────────────
-- Every date boundary in this system is Asia/Karachi (UTC+5). `current_date` on
-- this server is a DIFFERENT DAY for five hours each evening, which has already
-- made a correct answer look wrong once. The caller computes the Karachi date
-- with `isoDateIn` and passes it, so there is one clock and it is the
-- application's.
-- ============================================================================

create or replace function app.report_schedules_due(p_today date)
returns table (
  schedule_id   uuid,
  project_id    uuid,
  template_id   uuid,
  cadence       text,
  next_run_on   date,
  template_name text,
  engine        text,
  kind          text,
  -- The actor the report is generated AS. See the note below on why a schedule
  -- with no usable author is returned rather than filtered out.
  actor_id      uuid,
  actor_email   text,
  actor_name    text,
  actor_role    public.user_role
)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select s.id,
         s.project_id,
         s.template_id,
         s.cadence,
         s.next_run_on,
         t.name,
         t.engine,
         t.kind,
         u.id,
         u.email,
         u.full_name,
         u.role
    from public.report_schedules s
    join public.report_templates t on t.id = s.template_id
    -- ⚠️ A LEFT JOIN, AND THE ROW IS RETURNED WITH A NULL ACTOR RATHER THAN
    -- DROPPED. `created_by_id` is `on delete set null`, and a person can be
    -- deactivated — so a schedule can outlive the only identity it could run as.
    -- Filtering it out here would leave a schedule sitting in the UI marked
    -- "Active", quietly never running, with nothing anywhere saying why. The
    -- runner sees the null, records "the person who set this up no longer has an
    -- account", and that sentence reaches the page.
    left join public.users u
           on u.id = s.created_by_id
          and u.is_active
   where s.is_active
     and s.next_run_on <= p_today
   order by s.next_run_on, s.created_at
$$;

comment on function app.report_schedules_due(date) is
  'Schedules due on the given KARACHI date, for the cron (097). SECURITY '
  'DEFINER because a cron has no session and RLS would silently return nothing.';


-- ── Recording the outcome ───────────────────────────────────────────────────
-- ⚠️ THE DUE DATE MOVES ON EVEN WHEN THE RUN FAILED, and that is deliberate. If
-- a failure left `next_run_on` in the past, every subsequent cron tick would
-- retry the same broken schedule forever — two-hourly, indefinitely, against a
-- project whose report cannot be built. The error is recorded and the schedule
-- tries again at its next natural time. `last_error` is what the page reads, and
-- a successful run clears it.
create or replace function app.record_schedule_run(
  p_schedule uuid,
  p_next     date,
  p_error    text
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  update public.report_schedules
     set last_run_at  = now(),
         last_error   = p_error,
         next_run_on  = p_next,
         updated_at   = now()
   where id = p_schedule;
end $$;

comment on function app.record_schedule_run(uuid, date, text) is
  'Records a schedule run and advances its due date (097). The date advances '
  'even on failure, so a broken schedule cannot be retried every two hours '
  'forever.';

grant execute on function app.report_schedules_due(date)                to cni_app;
grant execute on function app.record_schedule_run(uuid, date, text)     to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ THE ASSERTIONS RUN AS `cni_app`. Migrations execute as the schema owner,
-- which BYPASSES RLS entirely — 094's self-check passed its own policy claim for
-- that reason and proved nothing at all. The whole point here is that a caller
-- WITHOUT a session can still read these rows, so the check sets no `app.user_id`
-- and asserts the reader works anyway.
--
-- It creates its own project, template and schedule, and removes exactly those.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_project  uuid;
  v_template uuid;
  v_sched    uuid;
  v_before   bigint;
  v_after    bigint;
  n          integer;
  v_next     date;
  v_err      text;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;
  if v_admin is null then
    raise notice '097 · no admin row; the functions are in place, self-check skipped';
    return;
  end if;

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('097 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  select id into v_template from public.report_templates where slug = 'monthly-client-report';

  insert into public.report_schedules
    (project_id, template_id, cadence, next_run_on, created_by_id)
  values (v_project, v_template, 'monthly', '2026-09-01'::date, v_admin)
  returning id into v_sched;

  -- ── Everything below runs with NO SESSION, exactly as the cron does ──────
  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 1 · ⚠️ THE ASSERTION THAT MATTERS. A plain select under RLS with no session
  --     returns nothing; the reader must return the row anyway. Without this
  --     the runner would report "0 due, ok" forever.
  select count(*) into n from public.report_schedules where id = v_sched;
  if n <> 0 then
    raise exception '097 · RLS let a session-less caller read a schedule directly — the policy is too open';
  end if;

  select count(*) into n from app.report_schedules_due('2026-09-04'::date)
   where schedule_id = v_sched;
  if n <> 1 then
    raise exception '097 · the reader returned % rows for a due schedule with no session; expected 1', n;
  end if;

  -- 2 · A schedule not yet due is not returned.
  select count(*) into n from app.report_schedules_due('2026-08-01'::date)
   where schedule_id = v_sched;
  if n <> 0 then
    raise exception '097 · a schedule due on 2026-09-01 was returned for 2026-08-01';
  end if;

  -- 3 · The actor travels with the row, or the runner cannot generate as anybody.
  select actor_email into v_err from app.report_schedules_due('2026-09-04'::date)
   where schedule_id = v_sched;
  if v_err is null then
    raise exception '097 · the reader returned no actor for a schedule that has one';
  end if;

  -- 4 · The outcome writer advances the date and records the error.
  perform app.record_schedule_run(v_sched, '2026-10-01'::date, 'self-check');
  -- ⚠️ Read back as the OWNER, not as cni_app: `report_schedules_due` returns
  -- neither `last_error` nor the row once it is no longer due, and cni_app has
  -- no session so a direct select returns nothing (assertion 1 above proves
  -- that). This one line is the check verifying the WRITE, not the read.
  reset role;
  select s.next_run_on, s.last_error into v_next, v_err
    from public.report_schedules s where s.id = v_sched;
  set local role cni_app;
  if v_next <> '2026-10-01'::date then
    raise exception '097 · the due date did not advance; it is %', v_next;
  end if;
  if v_err <> 'self-check' then
    raise exception '097 · the error was not recorded; last_error is %', coalesce(v_err, 'NULL');
  end if;

  -- 5 · A paused schedule is never returned, however overdue.
  reset role;
  update public.report_schedules set is_active = false, next_run_on = '2026-01-01'::date
   where id = v_sched;
  set local role cni_app;
  select count(*) into n from app.report_schedules_due('2026-12-31'::date)
   where schedule_id = v_sched;
  if n <> 0 then
    raise exception '097 · a paused schedule was returned as due';
  end if;

  reset role;

  delete from public.report_schedules where id = v_sched;
  delete from public.projects          where id = v_project;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '097 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '097 · the schedule runner can read its work without a session';
end $$;
