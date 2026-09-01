-- ============================================================================
-- 081 · THE SECOND SCAN CLOSES THE DAY — owner instruction, 2026-09-01
-- ----------------------------------------------------------------------------
-- Owner, after watching a colleague's check-out time move on every later scan:
-- *"The first scan in a day should be considered a check-in, the second scan is
-- considered to be a check-out, and after that another scan should not be
-- considered… unless I do it manually."*
--
-- ── WHAT 078 DID, AND WHY IT IS BEING CHANGED ───────────────────────────────
-- 078 made the LAST scan of the day the departure, so lunch handled itself:
-- stepping out set a leaving time, coming back moved it, going home moved it
-- for the last time. That reasoning still holds and the owner has overruled it
-- deliberately, having seen the cost:
--
--   · a double-tap at the door at 09:55 shows a zero-hour day, and stays that
--     way until the next scan — which on a day somebody does not scan again is
--     how it stays
--   · a departure time that keeps moving cannot be relied on while the day is
--     still running, because it is not a departure, it is "the last thing seen"
--
-- The owner's rule trades the lunch case for a day that is FINAL once closed.
-- That is a real trade and the losing side is stated plainly here: somebody who
-- scans on the way out to lunch has their day closed at lunchtime, and it takes
-- an Admin to reopen it. `edited_by_id` records who did.
--
-- ⚠️ A LATER SCAN IS STILL RECORDED. `attendance_scans` keeps every one with
-- outcome `ignored` — so a day that looks wrong can be explained by the scans
-- behind it, and an Admin correcting it can see exactly when somebody really
-- left. Nothing is discarded; it simply stops moving the attendance row.
--
-- ⚠️ THE BUTTON IS UNAFFECTED. `app.guard_attendance` already refuses a second
-- check-out ("You have already checked out today") — this brings the terminal
-- into line with the button rather than inventing a new rule.
-- ============================================================================

create or replace function app.record_device_scan(
  p_serial      text,
  p_secret      text,
  p_employee_no text,
  p_scanned_at  timestamptz,
  p_dedup_key   text,
  p_method      public.scan_method default 'other',
  p_raw         jsonb default null
)
returns table (outcome public.scan_outcome, on_date date, user_id uuid)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_device  public.attendance_devices%rowtype;
  v_user    uuid;
  v_day     date;
  v_today   date := app.attendance_today();
  v_row     public.attendance_days%rowtype;
  v_outcome public.scan_outcome;
begin
  select * into v_device
    from public.attendance_devices
   where upper(btrim(serial_no)) = upper(btrim(p_serial)) and is_active;

  if not found then
    raise exception 'No active terminal with that serial.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_device.secret_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
    raise exception 'That terminal secret is wrong.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.attendance_devices set last_seen_at = now() where id = v_device.id;

  if exists (select 1 from public.attendance_scans
              where device_id = v_device.id and dedup_key = p_dedup_key) then
    return query select 'duplicate'::public.scan_outcome, null::date, null::uuid;
    return;
  end if;

  select id into v_user
    from public.users
   where device_person_no = btrim(p_employee_no) and is_active;

  v_day := (p_scanned_at at time zone 'Asia/Karachi')::date;

  if v_user is null then
    v_outcome := 'unmatched';
    v_day := null;
  elsif v_day > v_today + 1 or v_day < v_today - 7 then
    v_outcome := 'out_of_range';
    v_day := null;
  else
    select * into v_row
      from public.attendance_days
     where attendance_days.user_id = v_user and attendance_days.on_date = v_day;

    -- An Admin's correction outranks the wall, exactly as before.
    if found and v_row.edited_by_id is not null then
      v_outcome := 'locked';

    -- ── FIRST SCAN OF THE DAY: the arrival ────────────────────────────────
    elsif not found then
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, p_scanned_at, 'device', p_method, v_device.id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    -- ── ⚠️ THE DAY IS ALREADY CLOSED. NOTHING MOVES IT. ───────────────────
    -- This branch is the owner's instruction and it is FIRST among the
    -- update cases on purpose: every later scan meets it before any rule
    -- that could change a time. The scan is still written to
    -- `attendance_scans` below, marked `ignored`, so the real departure is
    -- recoverable by an Admin — it simply does not rewrite the record.
    elsif v_row.checked_out_at is not null then
      v_outcome := 'ignored';

    -- An earlier scan arriving late is still the real arrival. Kept from 078:
    -- a bridge replaying a backlog can deliver out of order, and the earliest
    -- scan of the day is the arrival however late we hear about it.
    elsif v_row.checked_in_at is null or p_scanned_at < v_row.checked_in_at then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = p_scanned_at, check_in_source = 'device',
             check_in_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    -- ── SECOND SCAN OF THE DAY: the departure, and the day closes ─────────
    elsif p_scanned_at > v_row.checked_in_at then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_out_at = p_scanned_at, check_out_source = 'device',
             check_out_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'closed_day';

    else
      -- Exactly on the arrival. Nothing to change.
      v_outcome := 'ignored';
    end if;
  end if;

  insert into public.attendance_scans
    (device_id, employee_no, user_id, method, scanned_at, outcome, on_date, dedup_key, raw)
  values
    (v_device.id, btrim(p_employee_no), v_user, p_method, p_scanned_at,
     v_outcome, v_day, p_dedup_key, p_raw);

  update public.attendance_devices set last_event_at = now() where id = v_device.id;

  return query select v_outcome, v_day, v_user;
end $$;

comment on function app.record_device_scan is
  'The only way a terminal writes attendance. First scan of the day is the '
  'arrival, second is the departure, and everything after is recorded but '
  'changes nothing — owner''s rule, 081. Verifies the terminal''s secret itself '
  'and keeps the device''s own clock (078).';


-- ── The same rule for a replayed scan ───────────────────────────────────────
-- ⚠️ `app.apply_stored_scans` (079) replays what arrived before somebody was
-- mapped, and it carried its own copy of the open/close logic. Leaving it on the
-- old rule would mean a person mapped at lunchtime got "last scan wins" while
-- everybody else got "second scan closes" — the same day recorded two different
-- ways depending on when an Admin happened to click.
create or replace function app.apply_stored_scans(p_employee_no text)
returns table (applied integer, skipped integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_user    uuid;
  v_today   date := app.attendance_today();
  v_scan    record;
  v_row     public.attendance_days%rowtype;
  v_day     date;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_outcome public.scan_outcome;
begin
  if not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an Admin can apply stored scans.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_user
    from public.users
   where device_person_no = btrim(p_employee_no) and is_active;

  if v_user is null then
    raise exception 'No active person carries the terminal number %.', p_employee_no
      using errcode = 'no_data_found';
  end if;

  for v_scan in
    select s.id, s.scanned_at, s.method, s.device_id
      from public.attendance_scans s
     where s.employee_no = btrim(p_employee_no)
       and s.outcome = 'unmatched'
     order by s.scanned_at
  loop
    v_day := (v_scan.scanned_at at time zone 'Asia/Karachi')::date;

    if v_day > v_today + 1 or v_day < v_today - 7 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_row
      from public.attendance_days
     where attendance_days.user_id = v_user and attendance_days.on_date = v_day;

    if found and v_row.edited_by_id is not null then
      v_outcome := 'locked';

    elsif not found then
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, v_scan.scanned_at, 'device', v_scan.method, v_scan.device_id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';
      v_applied := v_applied + 1;

    -- The owner's rule, mirrored from `record_device_scan` above.
    elsif v_row.checked_out_at is not null then
      v_outcome := 'ignored';

    elsif v_row.checked_in_at is null or v_scan.scanned_at < v_row.checked_in_at then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = v_scan.scanned_at, check_in_source = 'device',
             check_in_method = v_scan.method, device_id = v_scan.device_id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';
      v_applied := v_applied + 1;

    elsif v_scan.scanned_at > v_row.checked_in_at then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_out_at = v_scan.scanned_at, check_out_source = 'device',
             check_out_method = v_scan.method, device_id = v_scan.device_id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'closed_day';
      v_applied := v_applied + 1;

    else
      v_outcome := 'ignored';
    end if;

    update public.attendance_scans
       set outcome = v_outcome, user_id = v_user, on_date = v_day
     where id = v_scan.id;
  end loop;

  return query select v_applied, v_skipped;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid; v_person uuid; v_dev uuid;
  v_day date := app.attendance_today();
  r record; v_in timestamptz; v_out timestamptz;
begin
  select id into v_admin from public.users where role in ('super_admin','admin') limit 1;
  select id into v_person from public.users
   where is_active and device_person_no is null and role = 'member' limit 1;

  if v_admin is null or v_person is null then
    raise notice '081 · not enough users to self-check; the rule is in place';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.attendance_devices (serial_no, label, secret_hash, created_by_id)
  values ('081-SELFCHECK', 'Self check', app.hash_device_secret('open-sesame'), v_admin)
  returning id into v_dev;

  update public.users set device_person_no = '081-TEST' where id = v_person;

  -- 1st scan → the arrival
  select * into r from app.record_device_scan('081-SELFCHECK','open-sesame','081-TEST',
    ((v_day::timestamp + time '09:55') at time zone 'Asia/Karachi'), 'a1', 'face') limit 1;
  if r.outcome <> 'opened_day' then
    raise exception '081 · the first scan gave % rather than opened_day', r.outcome;
  end if;

  -- 2nd scan → the departure, and the day closes
  select * into r from app.record_device_scan('081-SELFCHECK','open-sesame','081-TEST',
    ((v_day::timestamp + time '13:00') at time zone 'Asia/Karachi'), 'a2', 'face') limit 1;
  if r.outcome <> 'closed_day' then
    raise exception '081 · the second scan gave % rather than closed_day', r.outcome;
  end if;

  -- ⚠️ THE OWNER'S RULE. A third and fourth scan must change NOTHING.
  select * into r from app.record_device_scan('081-SELFCHECK','open-sesame','081-TEST',
    ((v_day::timestamp + time '14:00') at time zone 'Asia/Karachi'), 'a3', 'face') limit 1;
  if r.outcome <> 'ignored' then
    raise exception '081 · a THIRD scan gave % — the day did not stay closed', r.outcome;
  end if;

  perform app.record_device_scan('081-SELFCHECK','open-sesame','081-TEST',
    ((v_day::timestamp + time '18:05') at time zone 'Asia/Karachi'), 'a4', 'face');

  select checked_in_at, checked_out_at into v_in, v_out
    from public.attendance_days where user_id = v_person and on_date = v_day;

  if v_in <> ((v_day::timestamp + time '09:55') at time zone 'Asia/Karachi') then
    raise exception '081 · THE ARRIVAL MOVED: %', v_in;
  end if;
  if v_out <> ((v_day::timestamp + time '13:00') at time zone 'Asia/Karachi') then
    raise exception '081 · THE DEPARTURE MOVED to % — later scans still win', v_out;
  end if;

  -- ...and every ignored scan is still on the record, which is what makes the
  -- real departure recoverable by an Admin.
  if (select count(*) from public.attendance_scans
       where device_id = v_dev and outcome = 'ignored') <> 2 then
    raise exception '081 · the ignored scans were not recorded';
  end if;

  delete from public.attendance_days where user_id = v_person and on_date = v_day;
  delete from public.attendance_devices where id = v_dev;
  update public.users set device_person_no = null where id = v_person;

  raise notice '081 · first scan in, second scan out, and the day stays closed';
end $$;
