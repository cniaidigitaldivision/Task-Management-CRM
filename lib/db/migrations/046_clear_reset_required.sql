-- ============================================================================
-- 046 · FINISHING A PASSWORD RESET CLEARS THE "MUST RESET" STATE
-- ----------------------------------------------------------------------------
-- The third instance of the fault fixed in 044 and 045, found by sweeping every
-- `withAppRole` call site rather than waiting for it to be reported.
--
-- `app/(auth)/forgot-password/actions.ts` ended a reset with:
--
--     update public.users set account_state = 'active'
--      where id = <them> and account_state = 'password_reset_required'
--
-- through `withAppRole`, which sets no `app.user_id` — right, because somebody
-- completing a reset has no session yet. `users_update` is identity-scoped, so
-- the statement matched nothing. Measured: `users` shows 0 rows to an
-- unidentified `cni_app` session.
--
-- ⚠️ THE CONSEQUENCE IS A LOOP. An Admin forces a reset, the person receives the
-- code, sets a new password — and the flag saying they must reset is still set.
-- The password really did change (that goes through `app.auth_set_password`,
-- which is SECURITY DEFINER and worked all along), so it is not data loss. It is
-- worse in a quieter way: they are told to reset a password they have already
-- reset, with no way to clear it themselves.
--
-- Narrow on purpose, like 045: it clears exactly `password_reset_required` and
-- nothing else, so it can never become a way to reactivate a deactivated
-- account or unlock a locked one. Those are `setPersonActive` and
-- `app.auth_set_lock`, and both are identity-checked because they must be.
-- ============================================================================

create or replace function app.auth_clear_reset_required(p_user_id uuid)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  with moved as (
    update public.users
       set account_state = 'active'::public.account_state
     where id = p_user_id
       and account_state = 'password_reset_required'::public.account_state
    returning 1
  )
  select exists (select 1 from moved);
$function$;

comment on function app.auth_clear_reset_required(uuid) is
  'Clears the password_reset_required flag once the reset is actually done. '
  'SECURITY DEFINER because the caller has no session yet. Only that one '
  'transition. Migration 046.';

revoke all on function app.auth_clear_reset_required(uuid) from public;
grant execute on function app.auth_clear_reset_required(uuid) to cni_app;
