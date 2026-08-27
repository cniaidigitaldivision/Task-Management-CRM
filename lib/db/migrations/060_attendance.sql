-- ============================================================================
-- 060 · ATTENDANCE — CHECK IN, CHECK OUT, AND WHICH OFFICE YOU ARE IN
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-25: *"The purpose of creating this attendance feature is that
-- the check-in time is 10 am and the check-out time is 6 pm… we will note the
-- time when the person checks in and when the person checks out. We will also
-- note whether today he checked in or not."*
--
-- Two offices, same hours, different days off:
--   Blue Area (Islamabad)   Monday–Saturday, Sunday off
--   Wah (headquarters)      Monday–Thursday + Saturday–Sunday, FRIDAY off
--
-- ── ⚠️ THIS TABLE STORES FACTS, NOT STATUSES ────────────────────────────────
-- There is no `status` column and there must not be one. "Present", "Late",
-- "Absent", "On leave" and "Off" are all DERIVED — from the check-in time against
-- the 10:30 cut-off, from whether the date is one of that team's working days, and
-- from the `availability` table. A stored status is a second copy of that answer
-- that starts drifting the moment somebody corrects a time, and then the row says
-- "Late" beside a 09:58 arrival and nobody can tell which half is wrong.
--
-- The derivation lives in lib/domain/attendance.ts, with tests.
--
-- ── ⚠️ THE DATE IS A KARACHI DATE, NOT A UTC ONE ────────────────────────────
-- `current_date` in this database is UTC. Karachi is UTC+5, so anybody working
-- late — and the owner says they do: *"1 and 2 are late sitting. That's normal"* —
-- would have their 1am check-out filed against the previous day, and the 9pm sweep
-- would chase people who had already gone home. `app.attendance_today()` is the
-- only thing allowed to decide what "today" is.
--
-- ── ⚠️ ONE ROW PER PERSON PER DAY, AND THE DAY CLOSES ───────────────────────
-- Owner's choice when offered sessions: one check-in and one check-out, and a
-- second press after checking out does nothing until tomorrow. That is enforced by
-- the trigger below rather than by the button, because a button is a suggestion.
-- ============================================================================

-- ── Which office somebody works from ────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'office_team') then
    create type public.office_team as enum ('blue_area', 'wah');
  end if;
end $$;

comment on type public.office_team is
  'Which office a person attends. Decides their days off — Blue Area rests on '
  'Sunday, Wah on Friday — and nothing else. It is NOT a permission and NOT the '
  'project-membership role in project_members (060).';

alter table public.users
  add column if not exists office_team public.office_team not null default 'blue_area';

comment on column public.users.office_team is
  'Blue Area (Islamabad) or Wah (headquarters). Defaults to blue_area so nobody '
  'is dayless; an Admin moves people on the Team screen. Only an Admin may change '
  'it — see the policy below.';

-- ── What "today" is, in the only timezone that matters ──────────────────────
create or replace function app.attendance_today()
  returns date
  language sql
  stable
as $$
  select (now() at time zone 'Asia/Karachi')::date
$$;

comment on function app.attendance_today() is
  'The current date in Asia/Karachi. ⚠️ Use this and never current_date: this '
  'database runs in UTC, so a check-out at 1am Karachi would otherwise be filed '
  'against the previous day.';

grant execute on function app.attendance_today() to cni_app;

-- ── The record ──────────────────────────────────────────────────────────────
create table if not exists public.attendance_days (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  -- ⚠️ Not `date` as a name: it shadows the type in enough contexts to be worth
  -- avoiding, and `on_date` reads correctly in a where clause.
  on_date        date not null default app.attendance_today(),

  checked_in_at  timestamptz,
  checked_out_at timestamptz,

  -- ⚠️ WHO CORRECTED IT, AND WHY. Owner: *"if we can say he forgot to check out,
  -- he can add their checkout time but you can say Kashif or any team coordinator
  -- could not do that."* An attendance record an Admin can silently rewrite is a
  -- payroll argument waiting to happen, so a corrected row says who touched it.
  edited_by_id   uuid references public.users(id) on delete set null,
  edited_at      timestamptz,
  edit_note      text,

  created_at     timestamptz not null default now(),

  constraint attendance_days_one_per_day unique (user_id, on_date),
  -- A check-out before the check-in is a typo, every time.
  constraint attendance_days_ordered check (
    checked_out_at is null
    or checked_in_at is null
    or checked_out_at >= checked_in_at
  ),
  -- ⚠️ No check-out without a check-in. Otherwise a correction can produce a row
  -- claiming somebody left an office they never arrived at, and every hours
  -- calculation downstream has to defend against it.
  constraint attendance_days_out_needs_in check (
    checked_out_at is null or checked_in_at is not null
  ),
  -- The edit trail is all-or-nothing, the same shape as notifications.read_at.
  constraint attendance_days_edit_trail check ((edited_by_id is null) = (edited_at is null))
);

comment on table public.attendance_days is
  'One row per person per day: when they checked in and out. Status (present, '
  'late, absent, on leave, off) is DERIVED in lib/domain/attendance.ts and is '
  'deliberately not stored — see the migration header.';

create index if not exists attendance_days_person_idx
  on public.attendance_days (user_id, on_date desc);

-- The month view reads a date range across everybody, so the date leads here.
create index if not exists attendance_days_month_idx
  on public.attendance_days (on_date desc, user_id);

-- ⚠️ Finds the people the 9pm sweep has to chase, without reading the month.
create index if not exists attendance_days_open_idx
  on public.attendance_days (on_date)
  where checked_out_at is null;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- ⚠️ GRANTED EXPLICITLY. RLS only narrows what a GRANT already permits; migration
-- 050 shipped a table with policies and no privileges and every read came back
-- `42501 permission denied`.
grant select, insert, update on public.attendance_days to cni_app;
-- ⚠️ NO DELETE, for anybody. Attendance is a record of what happened. A wrong row
-- is corrected — with `edited_by_id` saying who corrected it — never removed. The
-- demo seed deletes as the migration owner, which bypasses this by design.

alter table public.attendance_days enable row level security;

-- ── Who can see it ──────────────────────────────────────────────────────────
-- Your own always. Everybody's from Coordinator up, because the owner asked for
-- exactly that: *"the CEO, or you can say the super admin or admin, and the team
-- coordinator can see who is coming on time and who is coming late."*
drop policy if exists attendance_days_select on public.attendance_days;
create policy attendance_days_select on public.attendance_days
  for select
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('team_coordinator'::public.user_role)
  );

-- ── Who can write it ────────────────────────────────────────────────────────
-- Anybody may open their OWN row; an Admin may write anybody's. What may be
-- written is the trigger's business — a policy cannot say "only this column, only
-- in this direction".
drop policy if exists attendance_days_insert on public.attendance_days;
create policy attendance_days_insert on public.attendance_days
  for insert
  with check (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );

drop policy if exists attendance_days_update on public.attendance_days;
create policy attendance_days_update on public.attendance_days
  for update
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );

-- ── ⚠️ WHAT MAY ACTUALLY CHANGE ─────────────────────────────────────────────
-- The three rules the interface must not be the only thing enforcing:
--   1. You may only check yourself in TODAY. Not last Tuesday, when you were not
--      here — which is the whole attack on an attendance system.
--   2. Once you have checked out, your day is closed. Owner's choice.
--   3. A Coordinator may not correct anybody's times. They can SEE everything and
--      change nothing; only an Admin corrects a record.
create or replace function app.guard_attendance()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
begin
  -- An Admin may write anything, and is recorded as having done so. This branch
  -- is first because every rule below is about somebody acting on their own row.
  if app.acting_at_least('admin'::public.user_role) then
    if tg_op = 'UPDATE' and new.user_id <> app.current_user_id() then
      new.edited_by_id := app.current_user_id();
      new.edited_at := now();
    end if;
    return new;
  end if;

  if new.user_id <> app.current_user_id() then
    raise exception 'Only an Admin can record attendance for somebody else.'
      using errcode = 'check_violation';
  end if;

  if new.on_date <> app.attendance_today() then
    raise exception 'Attendance can only be recorded for today (%). Ask an Admin to correct another day.',
      app.attendance_today()
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.checked_out_at is not null then
      raise exception 'Check in before checking out.'
        using errcode = 'check_violation';
    end if;
    -- ⚠️ Not trusted from the client. A check-in time is the moment the button was
    -- pressed on the server, or the whole feature is self-reported.
    new.checked_in_at := now();
    new.edited_by_id := null;
    new.edited_at := null;
    return new;
  end if;

  -- UPDATE, by the person themselves: the one legal move is closing an open day.
  if old.checked_out_at is not null then
    raise exception 'You have already checked out today.'
      using errcode = 'check_violation';
  end if;
  if new.checked_in_at <> old.checked_in_at then
    raise exception 'Your check-in time cannot be changed. Ask an Admin.'
      using errcode = 'check_violation';
  end if;
  if new.checked_out_at is null then
    raise exception 'Nothing to change.'
      using errcode = 'check_violation';
  end if;
  new.checked_out_at := now();
  return new;
end $$;

comment on function app.guard_attendance() is
  'Enforces the three rules an interface must not be alone in enforcing: you can '
  'only check yourself in today, your day closes when you check out, and only an '
  'Admin can correct somebody else (060).';

drop trigger if exists attendance_days_guard on public.attendance_days;
create trigger attendance_days_guard
  before insert or update on public.attendance_days
  for each row execute function app.guard_attendance();

-- ── Moving somebody between offices is an Admin act ─────────────────────────
-- ⚠️ `users` already has its own policies (005, 013). This is a column-level
-- guard, which RLS cannot express, so it is a trigger — and it matters because
-- office_team decides which days count as absences.
create or replace function app.guard_office_team()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
begin
  if new.office_team <> old.office_team
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an Admin can move somebody between offices.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists users_office_team_guard on public.users;
create trigger users_office_team_guard
  before update of office_team on public.users
  for each row execute function app.guard_office_team();

-- ── The two things the sweeps tell people ───────────────────────────────────
-- ⚠️ ADD VALUE only, never used in this transaction — Postgres allows adding an
-- enum value inside a transaction but not using it in the same one.
alter type public.notification_kind add value if not exists 'attendance_late_streak';
alter type public.notification_kind add value if not exists 'attendance_missing_checkout';

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
declare
  guarded  int;
  policies int;
begin
  select count(*) into guarded
    from pg_trigger
   where tgrelid = 'public.attendance_days'::regclass
     and not tgisinternal;

  select count(*) into policies
    from pg_policies
   where schemaname = 'public' and tablename = 'attendance_days';

  if guarded < 1 then
    raise exception 'attendance_days has no guard trigger — a member could backdate a check-in.';
  end if;
  if policies < 3 then
    raise exception 'attendance_days has % policies, expected at least 3.', policies;
  end if;

  raise notice 'attendance_days ready: % trigger(s), % policies.', guarded, policies;
end $$;
