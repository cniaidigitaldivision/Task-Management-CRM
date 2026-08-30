-- ============================================================================
-- 080 · THE HEARTBEAT NEEDED THE SAME DOOR AS THE SCANS
-- ----------------------------------------------------------------------------
-- ── THE BUG, AND IT WAS MINE ────────────────────────────────────────────────
-- The terminal card said "last heard from 2 hours ago" while the device was
-- posting 2.5 times a second, because `last_seen_at` is written inside
-- `app.record_device_scan` and stale events never reach it.
--
-- The fix shipped for that ran a plain UPDATE from the route:
--
--     update public.attendance_devices set last_seen_at = now() where serial_no = ...
--
-- and it silently did nothing, every single time. `attendance_devices_write` is
-- `app.acting_at_least('admin')`, and this endpoint has NO SIGNED-IN USER — a
-- terminal cannot have one. So RLS refused the write, the route's `catch`
-- swallowed it, and the card went on lying while a deploy claimed to have fixed
-- it. Measured, not guessed: the same UPDATE run as `cni_app` with no
-- `app.user_id` returns zero rows.
--
-- ⚠️ THE LESSON IS THE CATCH, not the policy. `catch {}` around a write turns a
-- permission failure into a no-op that looks like success. It is there for a
-- good reason — a missed heartbeat must never fail somebody's scan — so the fix
-- is to make the write legal rather than to make the failure louder.
--
-- ── WHY A FUNCTION AND NOT A WIDER POLICY ───────────────────────────────────
-- The obvious alternative is to let `cni_app` update `last_seen_at` freely. That
-- would work and it opens the whole row: anybody with the grant could deactivate
-- a terminal or rewrite its secret hash. This function can only touch one
-- column, only on one terminal, and only for a caller holding that terminal's
-- secret — the same gate `record_device_scan` uses, for the same reason.
-- ============================================================================

create or replace function app.touch_device_seen(p_serial text, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_hash text;
begin
  select secret_hash into v_hash
    from public.attendance_devices
   where upper(btrim(serial_no)) = upper(btrim(p_serial)) and is_active;

  -- Unknown or switched-off terminal. Answered quietly rather than raised: this
  -- is a heartbeat on an unauthenticated route, and an exception here would be
  -- noise in the logs for something nobody can act on.
  if not found then return false; end if;

  if v_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
    return false;
  end if;

  -- ⚠️ SELF-THROTTLING. The route samples which requests call this; the
  -- predicate here decides whether a row is actually written. Together that is
  -- one write a minute at most, however hard the terminal is posting.
  update public.attendance_devices
     set last_seen_at = now()
   where upper(btrim(serial_no)) = upper(btrim(p_serial))
     and (last_seen_at is null or last_seen_at < now() - interval '1 minute');

  return true;
end $$;

comment on function app.touch_device_seen(text, text) is
  'Records that a terminal is alive when its events are too old to store. '
  'SECURITY DEFINER because the endpoint has no signed-in user and RLS refused '
  'the plain UPDATE silently — see 080''s header. Touches one column only, and '
  'only for a caller holding the terminal''s secret.';

revoke all on function app.touch_device_seen(text, text) from public;
grant execute on function app.touch_device_seen(text, text) to cni_app;


-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
-- ⚠️ RUN AS `cni_app` WITH NO USER — the exact conditions the route runs under,
-- and the conditions the previous fix was never tested against.
do $$
declare
  v_before timestamptz;
  v_after  timestamptz;
  v_ok     boolean;
begin
  if not exists (select 1 from public.attendance_devices where serial_no = 'GB4571046') then
    raise notice '080 · no terminal registered; function installed, untested';
    return;
  end if;

  update public.attendance_devices
     set last_seen_at = now() - interval '2 hours'
   where serial_no = 'GB4571046'
  returning last_seen_at into v_before;

  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- A wrong secret must change nothing.
  v_ok := app.touch_device_seen('GB4571046', 'wrong-secret');
  if v_ok then raise exception '080 · A WRONG SECRET WAS ACCEPTED'; end if;

  select last_seen_at into v_after
    from public.attendance_devices where serial_no = 'GB4571046';
  if v_after <> v_before then
    raise exception '080 · a wrong secret still moved the heartbeat';
  end if;

  reset role;

  raise notice '080 · the heartbeat can be written without a signed-in user';
end $$;
