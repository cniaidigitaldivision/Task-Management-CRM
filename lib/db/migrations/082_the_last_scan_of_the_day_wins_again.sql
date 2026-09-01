-- ============================================================================
-- 082 · THE LAST SCAN OF THE DAY WINS, AGAIN — owner, 2026-09-01
-- ----------------------------------------------------------------------------
-- ── THIS REVERSES 081, AND THE REVERSAL IS THE POINT ────────────────────────
-- 081 was written this morning to the owner's instruction: *"the first scan in a
-- day should be considered a check-in, the second scan is considered to be a
-- check-out, and after that another scan should not be considered."* It was
-- built, tested and shipped exactly as asked.
--
-- Then it met real people. Owner, hours later:
--
--   *"Everyone is accidentally doing a two-time scan, so every time they take a
--    second scan it is taken as a checkout and then locked. After that he
--    couldn't be checked out."*
--
-- Which is precisely what happened to Arslan: eight scans between 13:18 and
-- 13:23 while he was registering himself, and his recorded day came out as
-- **21 seconds long**. His real departure could not be recorded at all.
--
-- ── WHY THE ORIGINAL RULE WAS RIGHT, AND WHAT WAS MISSED ────────────────────
-- 078's reasoning was sound: people double-tap. They tap once, see the screen
-- flash, and tap again to be sure. A rule that treats the second tap as "I am
-- leaving" is a rule that closes somebody's day four seconds after they arrive.
--
-- What made 081 look attractive was a different, real complaint: a check-out
-- time that keeps moving cannot be trusted while the day is still running. That
-- is true, and it is not a reason to freeze the day — it is a reason to say the
-- day is not settled yet, which `isSettled` in lib/view/attendance-board.ts
-- already does.
--
-- ⚠️ SO THE HONEST TRADE, WRITTEN DOWN: the check-out is "the last time we saw
-- them" until the day ends, and only then is it "when they left". A day read at
-- 11am will say something that changes by 6pm. That is a property of a wall
-- clock nobody presses a button on, and it is far cheaper than a day that locks
-- itself before anybody has done any work.
--
-- The "three attempts then lock" idea the owner raised was offered and not
-- chosen, for the same reason: three still runs out — arrive (2 taps), lunch,
-- home is four events, and the real home time would be the one lost.
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

    -- An Admin's correction still outranks the wall.
    if found and v_row.edited_by_id is not null then
      v_outcome := 'locked';

    elsif not found then
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, p_scanned_at, 'device', p_method, v_device.id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    elsif v_row.checked_in_at is null or p_scanned_at < v_row.checked_in_at then
      -- An earlier scan arriving late is still the real arrival.
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = p_scanned_at, check_in_source = 'device',
             check_in_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    -- ── ⚠️ THE LAST SCAN OF THE DAY IS THE DEPARTURE ──────────────────────
    -- Note what this compares against: `coalesce(checked_out_at, checked_in_at)`.
    -- 081 compared against `checked_in_at` alone and refused to move an existing
    -- check-out — that single word is the whole difference between a day that
    -- records when somebody went home and a day that froze on their second tap.
    elsif p_scanned_at > coalesce(v_row.checked_out_at, v_row.checked_in_at) then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_out_at = p_scanned_at, check_out_source = 'device',
             check_out_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'closed_day';

    else
      -- Between the arrival and the current departure. Nothing to change.
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
  'The only way a terminal writes attendance. The first scan of the day is the '
  'arrival and the LAST is the departure, so a double-tap at the door is '
  'harmless and going home is always recorded (082, reversing 081). Verifies '
  'the terminal''s secret itself and keeps the device''s own clock (078).';


-- ── The replay follows the same rule ────────────────────────────────────────
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

    elsif v_row.checked_in_at is null or v_scan.scanned_at < v_row.checked_in_at then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = v_scan.scanned_at, check_in_source = 'device',
             check_in_method = v_scan.method, device_id = v_scan.device_id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';
      v_applied := v_applied + 1;

    elsif v_scan.scanned_at > coalesce(v_row.checked_out_at, v_row.checked_in_at) then
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
-- SELF-CHECK — the exact sequence that broke Arslan's day this afternoon
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
    raise notice '082 · not enough users to self-check; the rule is in place';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.attendance_devices (serial_no, label, secret_hash, created_by_id)
  values ('082-SELFCHECK', 'Self check', app.hash_device_secret('open-sesame'), v_admin)
  returning id into v_dev;

  update public.users set device_person_no = '082-TEST' where id = v_person;

  -- Arrives, and double-taps five seconds later — what everybody actually does.
  perform app.record_device_scan('082-SELFCHECK','open-sesame','082-TEST',
    ((v_day::timestamp + time '09:55:00') at time zone 'Asia/Karachi'), 'b1', 'face');
  perform app.record_device_scan('082-SELFCHECK','open-sesame','082-TEST',
    ((v_day::timestamp + time '09:55:05') at time zone 'Asia/Karachi'), 'b2', 'face');

  -- Lunch, back, and home.
  perform app.record_device_scan('082-SELFCHECK','open-sesame','082-TEST',
    ((v_day::timestamp + time '13:00') at time zone 'Asia/Karachi'), 'b3', 'face');
  perform app.record_device_scan('082-SELFCHECK','open-sesame','082-TEST',
    ((v_day::timestamp + time '14:00') at time zone 'Asia/Karachi'), 'b4', 'face');
  select * into r from app.record_device_scan('082-SELFCHECK','open-sesame','082-TEST',
    ((v_day::timestamp + time '18:05') at time zone 'Asia/Karachi'), 'b5', 'face') limit 1;

  if r.outcome <> 'closed_day' then
    raise exception '082 · GOING HOME GAVE % — the day locked before they left', r.outcome;
  end if;

  select checked_in_at, checked_out_at into v_in, v_out
    from public.attendance_days where user_id = v_person and on_date = v_day;

  if v_in <> ((v_day::timestamp + time '09:55:00') at time zone 'Asia/Karachi') then
    raise exception '082 · the double-tap moved the ARRIVAL to %', v_in;
  end if;

  -- ⚠️ THE ASSERTION THIS FILE EXISTS FOR. Under 081 this was 09:55:05 and the
  -- recorded day was five seconds long.
  if v_out <> ((v_day::timestamp + time '18:05') at time zone 'Asia/Karachi') then
    raise exception '082 · the departure is % rather than when they went home', v_out;
  end if;

  delete from public.attendance_days where user_id = v_person and on_date = v_day;
  delete from public.attendance_devices where id = v_dev;
  update public.users set device_person_no = null where id = v_person;

  raise notice '082 · a double-tap is harmless again, and going home is recorded';
end $$;
