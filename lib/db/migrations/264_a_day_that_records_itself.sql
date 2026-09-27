-- ============================================================================
-- 264 · A DAY THAT RECORDS ITSELF
-- ----------------------------------------------------------------------------
-- Owner (Umm-e-Habiba, Admin), 2026-09-27:
--
--   *"I'm remotely working and I have to do it all the time: check in and check
--    out ... except Sunday, every day, check-in between 9:30 to 10:30 ... and my
--    check-out between 6 and 7:30, or almost between 6 and 8. Any time, check-in
--    and check-out should automatically be done whether I do it, whether I
--    forget it."*
--
-- Two pg_cron jobs and a table saying who they are for. Today that table has
-- exactly one row, hers, because she asked for exactly that.
--
-- ── ⚠️ THE TIME IS STILL THE SERVER'S, AND THAT IS DELIBERATE ────────────
-- `app.guard_attendance()` has said since 060 that a check-in time is *the
-- moment the write reached the server*, not a value anybody supplies:
--
--     -- ⚠️ Not trusted from the client. A check-in time is the moment the
--     -- button was pressed on the server, or the whole feature is self-reported.
--
-- This feature does NOT punch a hole in that. It could have — an Admin writing
-- their own row is allowed past that branch of the guard, so this function could
-- have stamped any time it liked. It does not. The cron fires at the time we
-- want recorded and the row takes `now()` like every other row in the table.
--
-- The consequence is the design below: the jobs tick **every ten minutes across
-- the window** rather than once, and the function refuses to act before the
-- target time. The first tick at or after the target does the work and every
-- later tick finds it done. So a single failed tick costs nothing, and no clock
-- anywhere is ever written by hand.
--
-- ── ⚠️ AND IT IS MARKED `scheduled`, NOT `self` ──────────────────────────
-- 263 added the word. Every report that reads `check_in_source` can therefore
-- tell a pressed button from an automation, which is the difference between a
-- record and a claim. Hiding it as `self` would have been one line shorter and
-- would have quietly corrupted the attendance export.
--
-- ── ⚠️ WHAT IT REFUSES TO DO ─────────────────────────────────────────────
--   · a day that is not a working day for that person  (Sunday, here)
--   · a day covered by approved leave, a holiday, or an `unavailable` block —
--     marking somebody present on their own approved leave would corrupt both
--     records at once. A `half_day` is still a working day and is not skipped.
--   · anything before the target local time, so a mis-scheduled or hand-invoked
--     run cannot stamp a 3 AM arrival
--   · a check-in that already exists, or a check-out on an open day that was
--     never checked in — the unique index and the `where` do that, so every
--     tick after the first is a no-op rather than an error
--   · a check-out earlier than that morning's check-in, which would violate
--     `attendance_days_ordered` and abort the whole job
-- ============================================================================

-- ── who this runs for ──────────────────────────────────────────────────────
create table if not exists public.attendance_auto (
  user_id         uuid primary key references public.users (id) on delete cascade,
  is_enabled      boolean     not null default true,

  /* Local Karachi times. These are the TARGET, and the cron window around them
     is what actually fires — see the header. Stored here so the intent is data
     somebody can read and change, not a number buried in a cron expression. */
  check_in_local  time        not null,
  check_out_local time        not null,

  /* ISO weekdays. 1 = Monday … 7 = Sunday, matching `extract(isodow)` and
     `OFFICE_TEAMS[].workingDays` in lib/domain/attendance.ts. */
  working_days    smallint[]  not null default '{1,2,3,4,5,6}',

  /* Stamped by the function, purely so the owner can see it is alive without
     reading the cron log. */
  last_in_at      timestamptz,
  last_out_at     timestamptz,

  note            text,
  created_by_id   uuid        references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint attendance_auto_days_are_iso
    check (working_days <@ array[1,2,3,4,5,6,7]::smallint[] and array_length(working_days, 1) > 0),
  constraint attendance_auto_out_after_in
    check (check_out_local > check_in_local)
);

comment on table public.attendance_auto is
  'Who has their attendance recorded by a schedule. One row per person; see migration 264.';

grant select, insert, update, delete on public.attendance_auto to cni_app;

alter table public.attendance_auto enable row level security;

/* ⚠️ `(select app.fn())` so the helper is an InitPlan, computed once, not once
   per row — CLAUDE.md law 5. One row today, but the shape is the rule. */
drop policy if exists attendance_auto_select on public.attendance_auto;
create policy attendance_auto_select on public.attendance_auto
  for select using (
    user_id = (select app.current_user_id())
    or (select app.acting_at_least('admin'::public.user_role))
  );

/* Only an Admin decides whose attendance is automatic. A person cannot switch it
   on for themselves — that is the whole difference between a policy and a
   loophole. */
drop policy if exists attendance_auto_write on public.attendance_auto;
create policy attendance_auto_write on public.attendance_auto
  for all using ((select app.acting_at_least('admin'::public.user_role)))
  with check ((select app.acting_at_least('admin'::public.user_role)));

-- ── the job ────────────────────────────────────────────────────────────────
create or replace function app.run_scheduled_attendance(
  p_kind text,
  p_only uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today   date     := app.attendance_today();
  v_local   time     := (now() at time zone 'Asia/Karachi')::time;
  v_dow     smallint := extract(isodow from (now() at time zone 'Asia/Karachi'))::smallint;
  v_target  time;
  v_done    int      := 0;
  v_skipped int      := 0;
  v_names   text[]   := '{}';
  r         record;
begin
  if p_kind not in ('in', 'out') then
    raise exception 'run_scheduled_attendance takes ''in'' or ''out'', not %', p_kind;
  end if;

  for r in
    select a.user_id, a.check_in_local, a.check_out_local, u.full_name
      from public.attendance_auto a
      join public.users u on u.id = a.user_id
     where a.is_enabled
       and u.is_active
       and u.account_state = 'active'
       and v_dow = any (a.working_days)
       and (p_only is null or a.user_id = p_only)
       /* not on their own approved leave, a holiday, or a blocked day */
       and not exists (
         select 1 from public.availability av
          where av.user_id = a.user_id
            and v_today between av.start_date and av.end_date
            and av.type in ('leave', 'holiday', 'unavailable')
       )
  loop
    v_target := case when p_kind = 'in' then r.check_in_local else r.check_out_local end;

    /* Before the target: not this tick. The window's later ticks will find it. */
    if v_local < v_target then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    /* ⚠️ Act AS them. `app.guard_attendance()` reads `app.current_user_id()` to
       decide whose row this is and to honour `attendance_mode = 'terminal_only'`.
       Running with no identity would slip past the "somebody else's row" check on
       a NULL comparison, which is the wrong way for a guard to fail. `is_local`
       is true, so it is gone when this transaction ends. */
    perform set_config('app.user_id', r.user_id::text, true);

    if p_kind = 'in' then
      insert into public.attendance_days (user_id, on_date, check_in_source)
      values (r.user_id, v_today, 'scheduled'::public.attendance_source)
      on conflict (user_id, on_date) do nothing;
    else
      update public.attendance_days
         set checked_out_at  = now(),
             check_out_source = 'scheduled'::public.attendance_source
       where user_id = r.user_id
         and on_date = v_today
         and checked_in_at is not null
         and checked_out_at is null
         /* never earlier than the morning: `attendance_days_ordered` would
            abort the job for everybody behind this person in the loop */
         and checked_in_at <= now();
    end if;

    if found then
      v_done := v_done + 1;
      v_names := v_names || r.full_name;
      if p_kind = 'in' then
        update public.attendance_auto set last_in_at = now() where user_id = r.user_id;
      else
        update public.attendance_auto set last_out_at = now() where user_id = r.user_id;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  perform set_config('app.user_id', '', true);

  return jsonb_build_object(
    'kind', p_kind, 'on_date', v_today, 'at_local', v_local,
    'recorded', v_done, 'skipped', v_skipped, 'people', to_jsonb(v_names)
  );
end
$function$;

comment on function app.run_scheduled_attendance(text, uuid) is
  'Records check-in or check-out for everybody in attendance_auto whose target time has passed today. Idempotent; see migration 264.';

revoke all on function app.run_scheduled_attendance(text, uuid) from public;

-- ── the owner's own row ────────────────────────────────────────────────────
-- 09:40 and 19:10 are both exactly on a ten-minute tick, so the first tick at or
-- after the target is the target. 09:40 also leaves fifty minutes before
-- `LATE_AFTER_MINUTES` (10:30, inclusive) — a delayed tick still arrives on time.
insert into public.attendance_auto
  (user_id, check_in_local, check_out_local, working_days, note, created_by_id)
select u.id, time '09:40', time '19:10', '{1,2,3,4,5,6}'::smallint[],
       'Works remotely. Asked for this on 2026-09-27; Sunday is her day off.', u.id
  from public.users u
 where u.email = 'ummehabiba989@gmail.com'
on conflict (user_id) do nothing;

-- ── the two ticks ──────────────────────────────────────────────────────────
-- ⚠️ pg_cron reads these in UTC (`cron.timezone` is GMT on this instance), and
-- Karachi is UTC+5 with no daylight saving. 04:00–05:59 UTC is 09:00–10:59 in
-- Karachi; 13:00–15:59 UTC is 18:00–20:59. Both windows sit inside one Karachi
-- day, so `1-6` really is Monday to Saturday for the person reading the clock.
select cron.schedule(
  'attendance-auto-in',
  '*/10 4-5 * * 1-6',
  $cron$select app.run_scheduled_attendance('in')$cron$
);

select cron.schedule(
  'attendance-auto-out',
  '*/10 13-15 * * 1-6',
  $cron$select app.run_scheduled_attendance('out')$cron$
);

-- ============================================================================
-- SELF-CHECK — a real person, a real day, and nothing live touched
-- ----------------------------------------------------------------------------
-- ⚠️ `p_only` exists FOR THIS. The function's normal job is "everybody enabled",
-- and the owner is already enabled by the insert above — calling it here without
-- a subject would write her real attendance for today as a side effect of a
-- migration. Every call below names the fixture.
-- ============================================================================
do $$
declare
  v_admin  uuid;
  v_person uuid;
  v_dow    smallint := extract(isodow from (now() at time zone 'Asia/Karachi'))::smallint;
  v_today  date     := app.attendance_today();
  v_src    text;
  v_out    timestamptz;
  v_rows   int;
  v_before int;
begin
  select id into v_admin from public.users
   where is_active and role in ('admin', 'super_admin') order by created_at limit 1;

  select count(*) into v_before from public.attendance_days where on_date = v_today;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Scheduled Attendance Fixture', 'fixture-264@example.invalid', 'member', true, 'active')
  returning id into v_person;

  /* Today, whatever day today is, and a target already in the past. */
  insert into public.attendance_auto
    (user_id, check_in_local, check_out_local, working_days, note)
  values (v_person, time '00:01', time '00:02', array[v_dow], 'fixture');

  -- ── 1 · it records a check-in, and says how ──────────────────────────────
  perform app.run_scheduled_attendance('in', v_person);
  select check_in_source::text into v_src
    from public.attendance_days where user_id = v_person and on_date = v_today;
  if v_src is null then
    raise exception 'THE SCHEDULE DID NOT CHECK ANYBODY IN';
  end if;
  if v_src <> 'scheduled' then
    raise exception 'A SCHEDULED CHECK-IN WAS RECORDED AS %, WHICH IS A LIE TO EVERY REPORT', v_src;
  end if;

  -- ── 2 · a second tick changes nothing ────────────────────────────────────
  perform app.run_scheduled_attendance('in', v_person);
  select count(*) into v_rows from public.attendance_days where user_id = v_person;
  if v_rows <> 1 then
    raise exception 'A SECOND TICK MADE A SECOND DAY (% rows)', v_rows;
  end if;

  -- ── 3 · it closes the day, and says how ──────────────────────────────────
  perform app.run_scheduled_attendance('out', v_person);
  select checked_out_at, check_out_source::text into v_out, v_src
    from public.attendance_days where user_id = v_person and on_date = v_today;
  if v_out is null then
    raise exception 'THE SCHEDULE DID NOT CHECK ANYBODY OUT';
  end if;
  if v_src <> 'scheduled' then
    raise exception 'A SCHEDULED CHECK-OUT WAS RECORDED AS %', v_src;
  end if;

  -- ── 4 · approved leave beats the schedule ────────────────────────────────
  delete from public.attendance_days where user_id = v_person;
  insert into public.availability (user_id, start_date, end_date, type)
  values (v_person, v_today, v_today, 'leave');
  perform app.run_scheduled_attendance('in', v_person);
  if exists (select 1 from public.attendance_days where user_id = v_person) then
    raise exception 'THE SCHEDULE MARKED SOMEBODY PRESENT ON THEIR OWN APPROVED LEAVE';
  end if;
  delete from public.availability where user_id = v_person;

  -- ── 5 · a day that is not theirs is not worked ───────────────────────────
  update public.attendance_auto
     set working_days = array[(case when v_dow = 1 then 2 else 1 end)]::smallint[]
   where user_id = v_person;
  perform app.run_scheduled_attendance('in', v_person);
  if exists (select 1 from public.attendance_days where user_id = v_person) then
    raise exception 'THE SCHEDULE WORKED A DAY OFF';
  end if;

  -- ── 6 · switched off means switched off ──────────────────────────────────
  update public.attendance_auto
     set working_days = array[v_dow]::smallint[], is_enabled = false
   where user_id = v_person;
  perform app.run_scheduled_attendance('in', v_person);
  if exists (select 1 from public.attendance_days where user_id = v_person) then
    raise exception 'A DISABLED SCHEDULE STILL RAN';
  end if;

  -- ── clean up ─────────────────────────────────────────────────────────────
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.attendance_days where user_id = v_person;
  delete from public.attendance_auto  where user_id = v_person;
  delete from public.users            where id = v_person;
  if exists (select 1 from public.users where id = v_person) then
    raise exception 'THE 264 FIXTURE SURVIVED';
  end if;

  /* ⚠️ And nobody real was written while the fixture was being tested. */
  select count(*) into v_rows from public.attendance_days where on_date = v_today;
  if v_rows <> v_before then
    raise exception 'THE SELF-CHECK CHANGED % LIVE ATTENDANCE ROWS FOR TODAY', v_rows - v_before;
  end if;

  raise notice '264 self-check passed: a schedule records and closes a day, marks it "scheduled", never runs twice, and stands down for leave, a day off and an off switch';
end $$;
