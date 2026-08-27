-- ============================================================================
-- 061 · AN ADMIN'S OWN CHECK-IN RECORDED NO TIME
-- ----------------------------------------------------------------------------
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- `app.guard_attendance()` (migration 060) stamps the arrival time itself:
--
--     new.checked_in_at := now();
--
-- so that a check-in cannot be self-reported. But that line lives in the branch
-- for somebody acting on their own row, and the function returns EARLY for an
-- Admin — because an Admin correcting a record must be able to state a time.
--
-- The result: `checkIn()` inserts `(user_id)` and nothing else, an Admin's insert
-- takes the early return, and the row lands with `checked_in_at` NULL. The person
-- presses Check in, the button reports a failure (the query had no time to return),
-- and the page still says "Not in yet".
--
-- Found in the real table within minutes of the button shipping: three genuine
-- check-ins had happened, and the only one that was broken belonged to the Admin.
--
-- ── ⚠️ WHY THE FIX IS A COLUMN DEFAULT AND NOT A TRIGGER EDIT ───────────────
-- The trigger cannot tell "the column was omitted" from "the column was set to
-- NULL deliberately" — both arrive as NULL in `new`. And both are real cases:
--
--   omitted        a plain check-in. Must become now().
--   explicit NULL  an Admin clearing a day to mark it an absence. Must stay NULL.
--
-- A DEFAULT distinguishes them for free, because a default applies only when the
-- column is absent from the INSERT. `correctDay` always names both columns, so a
-- deliberate clearing is untouched; `checkIn` names neither, so it gets the clock.
-- And a default is evaluated BEFORE the trigger, so the member branch's
-- overwrite still wins for anybody acting on their own row — a Member still cannot
-- state their own arrival time.
-- ============================================================================

alter table public.attendance_days
  alter column checked_in_at set default now();

comment on column public.attendance_days.checked_in_at is
  'When they arrived. Defaults to now() so a plain check-in is stamped by the '
  'server even for an Admin, whose insert skips the guard trigger''s stamping '
  'branch (061). An explicit NULL — an Admin clearing the day — is preserved, '
  'because a default only applies to an omitted column.';

-- ── ⚠️ AND THE GUARD MUST STAND ASIDE FOR A MAINTENANCE SESSION ────────────
-- Found by this very migration: its own UPDATE below was refused with "Nothing to
-- change." — raised by `app.guard_attendance()`.
--
-- The trigger's member branch asks "is this row yours?" and "is it today?". Run
-- from a migration there is no acting user at all, so `app.current_user_id()` is
-- NULL, every comparison against it evaluates to NULL rather than TRUE, and control
-- falls through to the branch that assumes somebody is closing their own day.
--
-- A guard on self-service writes has nothing to say about a session that is not
-- self-service. So it now returns early when there is no acting user — which is
-- the ONLY way a migration, a repair, or a future sweep that has to write can
-- touch this table at all.
--
-- ⚠️ THIS DOES NOT OPEN A DOOR. A session with no `app.user_id` is either the
-- migration owner — who bypasses RLS regardless of any trigger, so the trigger was
-- never what protected the table from them — or `cni_app` with no identity, for
-- which every policy on the table evaluates false and the write never reaches the
-- trigger. The application always sets `app.user_id`: `withUser` throws on an
-- empty id rather than proceeding.
create or replace function app.guard_attendance()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
begin
  -- No acting user: a migration, a repair or a scheduled sweep. See 061.
  if app.current_user_id() is null then
    return new;
  end if;

  -- An Admin may write anything, and is recorded as having done so.
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
    -- ⚠️ Not trusted from the client, even though the column now defaults to
    -- now(): a Member could name the column explicitly and state any time.
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

-- ── Repair the rows the bug produced ────────────────────────────────────────
-- ⚠️ `created_at` IS the arrival time for these rows, precisely: the row was
-- inserted by the press of the Check in button, and nothing else has touched it.
-- So this recovers the real time rather than inventing one.
--
-- ⚠️ Scoped to rows with NO editor. A row an Admin deliberately cleared to mark an
-- absence also has a null check-in, and overwriting that would silently turn
-- somebody's recorded absence into a present day — the exact class of quiet damage
-- this table exists to prevent.
update public.attendance_days
   set checked_in_at = created_at
 where checked_in_at is null
   and checked_out_at is null
   and edited_by_id is null;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
declare
  fixed_default text;
  orphans int;
begin
  select column_default into fixed_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'attendance_days'
     and column_name = 'checked_in_at';

  if fixed_default is null then
    raise exception 'checked_in_at has no default — an Admin check-in would record no time.';
  end if;

  select count(*) into orphans
    from public.attendance_days
   where checked_in_at is null
     and edited_by_id is null;

  if orphans > 0 then
    raise exception '% row(s) still have no check-in and no editor.', orphans;
  end if;

  raise notice 'checked_in_at defaults to % and no unexplained null rows remain.', fixed_default;
end $$;
