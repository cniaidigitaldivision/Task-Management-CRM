-- =============================================================================
-- 029 · A STATUS FUNCTION FOR drive_connection — bug fix, 2026-08-16
-- -----------------------------------------------------------------------------
-- ⚠️ WHAT BROKE, AND WHY IT LOOKED LIKE SOMETHING ELSE ENTIRELY
--
-- Migration 027 revoked every privilege on `public.drive_connection` from
-- `cni_app` and gave the application four SECURITY DEFINER functions instead.
-- That was right. But `connectionStatus()` in `lib/db/queries/drive.ts` selected
-- the table DIRECTLY, using none of them, so on a real request it failed with:
--
--     42501  permission denied for table drive_connection
--
-- `/documents` reads that on every load. The page threw, and the owner was sent
-- to the sign-in screen — which reads as *"it signs me out again and again"*.
-- The session was never the problem. A permission error two layers down
-- surfaced as an authentication failure, which is the most misleading shape a
-- bug can take.
--
-- ── WHY 027's SELF-CHECK DID NOT CATCH IT ────────────────────────────────────
-- 027 proved that `drive_connection` has zero policies and that a plaintext
-- token is refused. Both passed, and both were verified as `postgres`, which
-- IGNORES table grants. Nothing exercised the query as `cni_app` — the role the
-- application actually uses. The self-check at the foot of this file does
-- exactly that, so the same class of mistake fails at migration time.
--
-- ── WHY NOT JUST REUSE `app.drive_connection_read()` ─────────────────────────
-- Because it returns the sealed refresh token, and this runs on every visit to
-- the Documents screen by anybody signed in. Handing the token to a status check
-- would undo the point of 027: the token has exactly one caller, and a status
-- display is not it. So this function returns the three harmless columns and
-- cannot return the token at all.
-- =============================================================================

create or replace function app.drive_connection_status()
returns table (
  account_email text,
  connected_at  timestamptz,
  last_error    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.account_email, c.connected_at, c.last_error
    from public.drive_connection c where c.id = 1
$$;

comment on function app.drive_connection_status() is
  'Whether Drive is connected and to whose account, for any signed-in screen. '
  'Deliberately CANNOT return refresh_token_encrypted — that is '
  'app.drive_connection_read(), which has one caller. Added in 029 after '
  'connectionStatus() selected the table directly and failed with 42501.';

revoke all on function app.drive_connection_status() from public;
grant execute on function app.drive_connection_status() to cni_app;


-- -----------------------------------------------------------------------------
-- SELF-CHECK — as `cni_app`, the role that actually runs the application
-- -----------------------------------------------------------------------------
-- ⚠️ The `set local role` is the whole point. Verifying this as `postgres` is
--    what let the original bug through: `postgres` bypasses table grants, so the
--    broken direct select passed every check it was given.

do $$
declare
  n int;
begin
  set local role cni_app;

  -- The new function must be callable, and must not error.
  select count(*) into n from app.drive_connection_status();
  if n is null then
    raise exception '029 · drive_connection_status() did not return';
  end if;

  -- The direct select must STILL be refused. If this ever starts working, 027's
  -- guarantee has been undone and the token is reachable from the app role.
  begin
    perform 1 from public.drive_connection;
    raise exception '029 · cni_app can SELECT drive_connection directly — 027 has been undone';
  exception when insufficient_privilege then null;
  end;

  reset role;
  raise notice '029 · drive_connection_status() works as cni_app, and the table stays unreachable';
end
$$;

-- The function's own signature is the real proof it cannot leak the token: it
-- returns three named columns and `refresh_token_encrypted` is not one of them.
do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace nsp on nsp.oid = p.pronamespace
     where nsp.nspname = 'app'
       and p.proname = 'drive_connection_status'
       and pg_get_function_result(p.oid) ilike '%refresh_token%'
  ) then
    raise exception '029 · the status function returns the refresh token — it must not';
  end if;
end
$$;
