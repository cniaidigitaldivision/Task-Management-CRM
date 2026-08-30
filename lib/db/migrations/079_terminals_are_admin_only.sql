-- ============================================================================
-- 079 · THE TERMINALS ARE ADMIN BUSINESS — owner instruction, 2026-08-30
-- ----------------------------------------------------------------------------
-- Asked where the terminal mapping screen should live, the owner answered:
-- *"only in admin and superadmin."*
--
-- 078 made both tables readable from Coordinator up, mirroring
-- `attendance_days_select`. That was the wrong mirror. Seeing who arrived late
-- is reading a record; seeing the terminal registry is seeing the machinery that
-- decides WHOSE attendance a face opens. The owner drew the line between them
-- and this moves the database to match.
--
-- ⚠️ HIDING A SCREEN IS NOT ENOUGH. `attendance.manage_devices` keeps the panel
-- off a Coordinator's page, but the panel is not a boundary — the data behind it
-- is. Without this migration a Coordinator could still read every terminal and
-- every scan through any other route into the database.
-- ============================================================================


-- ── The terminals: Admin and above only ─────────────────────────────────────
drop policy if exists attendance_devices_select on public.attendance_devices;
create policy attendance_devices_select on public.attendance_devices
  for select to cni_app
  using (app.acting_at_least('admin'::public.user_role));


-- ── The scans: your own always, everybody else's only for an Admin ──────────
-- ⚠️ THE `user_id = current_user_id()` BRANCH STAYS, and it is not an oversight.
-- Somebody looking at their own attendance and asking "why does it say I arrived
-- at 10:42" deserves to see the scan behind it. That is their own record, it is
-- already on their own attendance row, and withholding it would make a correct
-- figure look arbitrary. What narrows is only the reach into other people's.
drop policy if exists attendance_scans_select on public.attendance_scans;
create policy attendance_scans_select on public.attendance_scans
  for select to cni_app
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );


-- ════════════════════════════════════════════════════════════════════════════
-- APPLYING SCANS THAT ARRIVED BEFORE THE PERSON WAS MAPPED
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ THIS IS WHY EVERY UNMATCHED SCAN IS KEPT. Somebody scans in the morning,
-- an Admin maps them at lunchtime, and without this their arrival is simply
-- missing — they would read as absent on a day they were present, and the
-- correction would have to be typed by hand from memory.
--
-- ⚠️ AND IT IS A SEPARATE FUNCTION BECAUSE IT HAS A DIFFERENT GATE.
-- `app.record_device_scan` proves it is a terminal by holding the terminal's
-- secret. This is an ADMIN acting deliberately on data already stored, so the
-- secret is neither available (only its hash is kept) nor the right question.
-- The gate here is rank.
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

  -- ⚠️ OLDEST FIRST. The rule is "earliest scan is the arrival, latest is the
  -- departure", so replaying out of order still reaches the right answer but
  -- writes a nonsensical trail on the way there.
  for v_scan in
    select s.id, s.scanned_at, s.method, s.device_id
      from public.attendance_scans s
     where s.employee_no = btrim(p_employee_no)
       and s.outcome = 'unmatched'
     order by s.scanned_at
  loop
    v_day := (v_scan.scanned_at at time zone 'Asia/Karachi')::date;

    -- The same window `record_device_scan` enforces. A scan from six weeks ago
    -- is not somebody's attendance today, however recently it was mapped.
    if v_day > v_today + 1 or v_day < v_today - 7 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_row
      from public.attendance_days
     where attendance_days.user_id = v_user and attendance_days.on_date = v_day;

    -- An Admin's correction still outranks the wall, exactly as in 078.
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

    -- ⚠️ THE SCAN IS RE-STAMPED with what it did and who it turned out to be, so
    -- it leaves the unmatched queue. Left as `unmatched` it would be offered for
    -- mapping again tomorrow, and the queue would never empty.
    update public.attendance_scans
       set outcome = v_outcome, user_id = v_user, on_date = v_day
     where id = v_scan.id;
  end loop;

  return query select v_applied, v_skipped;
end $$;

comment on function app.apply_stored_scans(text) is
  'Replays the scans that arrived before somebody was mapped, so their first day '
  'is not silently missing. Admin-only, and the only reason it is possible is '
  'that unmatched scans are kept rather than dropped (079).';

revoke all on function app.apply_stored_scans(text) from public;
grant execute on function app.apply_stored_scans(text) to cni_app;


-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
do $$
declare
  v_admin uuid; v_coord uuid; n int;
begin
  select id into v_admin from public.users where role in ('super_admin','admin') limit 1;
  select id into v_coord from public.users where role = 'team_coordinator' and is_active limit 1;

  if v_coord is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_coord::text, true);

    select count(*) into n from public.attendance_devices;
    if n <> 0 then
      raise exception '079 · A COORDINATOR CAN STILL SEE THE TERMINALS (% rows)', n;
    end if;

    -- ...and cannot replay somebody's scans either.
    begin
      perform app.apply_stored_scans('019');
      raise exception '079 · A COORDINATOR APPLIED STORED SCANS';
    exception
      when insufficient_privilege then null;
      when no_data_found then
        raise exception '079 · the rank check did not run before the lookup';
    end;

    reset role;
  end if;

  if v_admin is not null then
    perform set_config('app.user_id', v_admin::text, true);
    select count(*) into n from public.attendance_devices;
    if n = 0 then
      raise exception '079 · an Admin can no longer see the terminals';
    end if;
  end if;

  raise notice '079 · terminals are Admin-only, and stored scans can be replayed';
end $$;
