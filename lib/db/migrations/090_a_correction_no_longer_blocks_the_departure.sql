-- ============================================================================
-- 090 · A CORRECTION NO LONGER BLOCKS THE DEPARTURE — owner, 2026-09-03
-- ----------------------------------------------------------------------------
-- The Team Coordinator left at 19:24 on 2 September, scanned twice on his way
-- out, and the system recorded no departure at all. Both scans are on record in
-- `attendance_scans` with outcome `locked`.
--
-- ── WHAT ACTUALLY HAPPENED, FROM THE ROWS ───────────────────────────────────
--   10:07:00  opened_day   he arrived
--   10:07:06  closed_day   the terminal fired again six seconds later, and the
--                          last scan of the day is the departure (082), so his
--                          day now read six seconds long
--   10:23:44  an Admin corrected the day by hand, clearing that nonsense
--   19:24:20  locked       his real departure — REFUSED
--   19:24:25  locked       and again
--
-- ── ⚠️ THE LOCK WAS PROTECTING A BLANK ──────────────────────────────────────
-- `record_device_scan` opened with "an Admin's correction still outranks the
-- wall" and refused every device scan for a day carrying `edited_by_id`. The
-- intent is sound: a terminal should not silently overwrite a human decision.
--
-- What it missed is that the stamp is written on the WHOLE ROW by any admin
-- edit — see `app.guard_attendance`, which sets `edited_by_id` on any UPDATE of
-- somebody else's day. So an Admin correcting the MORNING silently forbids the
-- EVENING from ever being recorded. The correction being defended was of the
-- arrival; the fact being turned away was the departure. They are not the same
-- fact, and the day ended up not merely uncorrected but blank — which reads to
-- everybody downstream as "never went home".
--
-- ── THE RULE NOW ────────────────────────────────────────────────────────────
-- Owner: *"The last scan of the day should be considered a checkout. Whether he
-- goes out and scans, put that in a checkout. If he again comes back and again
-- scans, then the last scan of the day should be considered a checkout."*
--
-- So on a hand-corrected day a device scan may still MOVE THE DEPARTURE
-- FORWARD. Nothing else about the day became reachable from the terminal:
--
--   · fills a missing arrival            yes     (a blank is not a correction)
--   · moves an existing arrival EARLIER  only if no Admin has touched the day
--   · moves the departure LATER          ALWAYS  <- this is the fix
--   · moves anything backwards           never   (unchanged; 082's
--                                                `> coalesce(...)` did this)
--
-- ⚠️ WHY THE ARRIVAL KEEPS ITS PROTECTION. The owner asked for the checkout, and
-- only the checkout. An Admin who fixes somebody's 10:30 start has made a
-- judgement about a time already past, and a stray earlier scan arriving after
-- that would undo it with nothing to show it had. A departure is different: it
-- is always the latest thing known about the day, so a later scan is by
-- definition better information. One word moves the arrival to the same rule if
-- that is ever wanted.
--
-- ── ISOLATION ───────────────────────────────────────────────────────────────
-- Both functions below are the TERMINAL path and nothing else. The app's own
-- check-in/out button goes through `app.guard_attendance` and is untouched, so
-- self-recorded attendance behaves exactly as before. On a day no Admin has
-- edited — which is nearly every day — the branch order is unchanged and every
-- scan gets the identical outcome it got under 082.
--
-- No live row is rewritten by this file. The `locked` scans already on record
-- stay `locked`: the owner is correcting 2 September by hand and asked
-- explicitly that yesterday's and today's entries not be touched. The enum
-- value is kept for that same reason — three historical rows carry it.
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

    if not found then
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, p_scanned_at, 'device', p_method, v_device.id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    -- A missing arrival is filled by anybody. An EXISTING one is only moved
    -- earlier while no Admin has ruled on the day — see the header.
    elsif v_row.checked_in_at is null
          or (p_scanned_at < v_row.checked_in_at and v_row.edited_by_id is null) then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = p_scanned_at, check_in_source = 'device',
             check_in_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    -- ── ⚠️ THE LAST SCAN OF THE DAY IS THE DEPARTURE, EDIT OR NO EDIT ──────
    -- 082 got the comparison right — `coalesce(checked_out_at, checked_in_at)`,
    -- so a double-tap cannot freeze the day — and this supplies the missing
    -- half: the branch is now REACHABLE on a hand-corrected day. Until 090 a
    -- `locked` arm sat above it and returned first.
    elsif p_scanned_at > coalesce(v_row.checked_out_at, v_row.checked_in_at) then
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_out_at = p_scanned_at, check_out_source = 'device',
             check_out_method = p_method, device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'closed_day';

    else
      -- Between the arrival and the current departure, or earlier than a time an
      -- Admin has set by hand. Nothing to change.
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
  'arrival and the LAST is the departure (082); since 090 a day an Admin has '
  'corrected still accepts a later departure, so the correction stands and '
  'going home is still recorded. Verifies the terminal secret itself and keeps '
  'the device clock (078).';


-- ── The replay follows the same rule ────────────────────────────────────────
-- ⚠️ Its scan SET is deliberately unchanged: `outcome = 'unmatched'` only. Scans
-- already refused as `locked` are not swept up retroactively, because the owner
-- is correcting 2 September by hand and asked that live entries be left alone.
-- Widening this to re-apply them is a one-word change if it is ever wanted.
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

    if not found then
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, v_scan.scanned_at, 'device', v_scan.method, v_scan.device_id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';
      v_applied := v_applied + 1;

    elsif v_row.checked_in_at is null
          or (v_scan.scanned_at < v_row.checked_in_at and v_row.edited_by_id is null) then
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
-- SELF-CHECK — the Coordinator's 2 September, replayed
-- ----------------------------------------------------------------------------
-- ⚠️ IT TOUCHES NOTHING LIVE, and that is a requirement rather than good
-- manners: the owner asked that yesterday's and today's entries be left exactly
-- as they are. So it works on
--
--   · a date THREE DAYS BACK — outside today and yesterday, inside the seven-day
--     window `record_device_scan` accepts,
--   · a person carrying no terminal number, borrowed and given one back,
--   · a throwaway terminal, deleted at the end. `attendance_scans.device_id` is
--     ON DELETE CASCADE, so the test scans leave with it.
--
-- and it ABORTS rather than proceeding if the row it would create already
-- exists. 082's own self-check deleted the chosen person's row for TODAY, which
-- would have destroyed a real entry had that person scanned in that morning.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  v_person uuid;
  v_dev    uuid;
  v_day    date := app.attendance_today() - 3;
  r        record;
  v_in     timestamptz;
  v_out    timestamptz;
begin
  select id into v_admin from public.users where role in ('super_admin','admin') limit 1;

  -- ⚠️ "AND HAS NO ROW ON THAT DATE" IS PART OF THE SELECTION, not a check
  -- afterwards. Picking a person first and then asserting they are free would
  -- fail the migration over an unrelated attendance entry; this simply chooses
  -- somebody the test can borrow without writing over anything.
  select u.id into v_person
    from public.users u
   where u.is_active and u.device_person_no is null and u.role = 'member'
     and not exists (select 1 from public.attendance_days d
                      where d.user_id = u.id and d.on_date = v_day)
   limit 1;

  if v_admin is null or v_person is null then
    raise notice '090 · nobody free to self-check on %; the rule is in place', v_day;
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.attendance_devices (serial_no, label, secret_hash, created_by_id)
  values ('090-SELFCHECK', 'Self check', app.hash_device_secret('open-sesame'), v_admin)
  returning id into v_dev;

  update public.users set device_person_no = '090-TEST' where id = v_person;

  -- 1 · Arrives at 10:07:00 and the terminal double-fires six seconds later,
  --     exactly as it did to the Coordinator.
  perform app.record_device_scan('090-SELFCHECK','open-sesame','090-TEST',
    ((v_day::timestamp + time '10:07:00') at time zone 'Asia/Karachi'), 'k1', 'face');
  perform app.record_device_scan('090-SELFCHECK','open-sesame','090-TEST',
    ((v_day::timestamp + time '10:07:06') at time zone 'Asia/Karachi'), 'k2', 'face');

  -- 2 · An Admin clears that six-second departure by hand. The guard stamps
  --     `edited_by_id` on its own — which is the whole trap.
  --
  -- ⚠️ ONLY THE TIMESTAMP IS CLEARED, and that is not a shortcut in the test —
  -- it is what the schema permits. `check_out_source` is NOT NULL while
  -- `checked_out_at` is nullable, so clearing a departure by hand necessarily
  -- leaves the source and method behind. That is why the Coordinator's real row
  -- reads `check_out_source = 'device'` with no time against it: not a sloppy
  -- edit, a constraint. A first draft of this block set all three to null and
  -- the migration refused it, which is how the pair was found.
  update public.attendance_days
     set checked_out_at = null
   where user_id = v_person and on_date = v_day;

  if not exists (select 1 from public.attendance_days
                  where user_id = v_person and on_date = v_day
                    and edited_by_id is not null) then
    raise exception '090 · the hand edit did not stamp edited_by_id, so this '
                    'test is no longer reproducing the reported fault';
  end if;

  -- 3 · He goes home at 19:24 and scans. THIS is what used to come back locked.
  select * into r from app.record_device_scan('090-SELFCHECK','open-sesame','090-TEST',
    ((v_day::timestamp + time '19:24:25') at time zone 'Asia/Karachi'), 'k3', 'fingerprint') limit 1;

  if r.outcome <> 'closed_day' then
    raise exception '090 · GOING HOME GAVE % on a corrected day — the departure '
                    'is still being refused', r.outcome;
  end if;

  select checked_in_at, checked_out_at into v_in, v_out
    from public.attendance_days where user_id = v_person and on_date = v_day;

  -- ⚠️ THE ASSERTION THIS FILE EXISTS FOR.
  if v_out <> ((v_day::timestamp + time '19:24:25') at time zone 'Asia/Karachi') then
    raise exception '090 · the departure is % rather than when he went home', v_out;
  end if;

  -- And the Admin's side of the day was not disturbed by any of it.
  if v_in <> ((v_day::timestamp + time '10:07:00') at time zone 'Asia/Karachi') then
    raise exception '090 · the arrival moved to %', v_in;
  end if;

  -- 4 · An earlier stray scan must NOT rewind an arrival on a corrected day.
  select * into r from app.record_device_scan('090-SELFCHECK','open-sesame','090-TEST',
    ((v_day::timestamp + time '08:00:00') at time zone 'Asia/Karachi'), 'k4', 'face') limit 1;

  if r.outcome <> 'ignored' then
    raise exception '090 · an 08:00 scan gave % on a corrected day; it must be '
                    'ignored, not allowed to rewind the arrival', r.outcome;
  end if;

  select checked_in_at into v_in
    from public.attendance_days where user_id = v_person and on_date = v_day;
  if v_in <> ((v_day::timestamp + time '10:07:00') at time zone 'Asia/Karachi') then
    raise exception '090 · the stray scan rewound the arrival to %', v_in;
  end if;

  -- 5 · He comes back and leaves again. The LAST scan is the departure.
  select * into r from app.record_device_scan('090-SELFCHECK','open-sesame','090-TEST',
    ((v_day::timestamp + time '21:10:00') at time zone 'Asia/Karachi'), 'k5', 'face') limit 1;

  if r.outcome <> 'closed_day' then
    raise exception '090 · the second departure gave %', r.outcome;
  end if;

  select checked_out_at into v_out
    from public.attendance_days where user_id = v_person and on_date = v_day;
  if v_out <> ((v_day::timestamp + time '21:10:00') at time zone 'Asia/Karachi') then
    raise exception '090 · the last scan of the day is not the departure: %', v_out;
  end if;

  -- Cleanup: only what this block created.
  delete from public.attendance_days where user_id = v_person and on_date = v_day;
  delete from public.attendance_devices where id = v_dev;
  update public.users set device_person_no = null where id = v_person;

  raise notice '090 · a corrected day still records when somebody went home';
end $$;
