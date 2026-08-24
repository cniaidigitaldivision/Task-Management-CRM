-- ============================================================================
-- 045 · ACTIVATION ACTUALLY MARKS THE ACCOUNT ACTIVE
-- ----------------------------------------------------------------------------
-- The second wall, found while fixing the first (migration 044) and before the
-- owner could walk into it.
--
-- `activateAccount` ended with a direct statement through `withAppRole`:
--
--     update public.users
--        set account_state = 'active', is_active = true
--      where id = <the person who just set their password>
--
-- Same flaw as 044, one step further along. `withAppRole` carries no
-- `app.user_id` — correct, the caller is still an anonymous stranger at this
-- point — and `users_update` is written in terms of the current user. With no
-- identity it matches nothing.
--
-- ⚠️ AND IT FAILS SILENTLY, WHICH IS WHY IT WOULD HAVE BEEN VICIOUS. An UPDATE
-- that matches no rows is not an error. The token would be consumed, the
-- password hashed and stored, a session issued, the welcome email sent, and the
-- person redirected into the application — with `account_state` still
-- `pending_activation`. The invitation is now spent, so the link cannot be used
-- again, and the state that gets them in was never written. Measured: 0 rows.
--
-- ── ONE FUNCTION, ONE TRANSITION ─────────────────────────────────────────────
-- Deliberately not a general "set any state" helper. It moves an account out of
-- `pending_activation` and nowhere else, so it cannot be repurposed into a way
-- to reactivate somebody an Admin deactivated — that is `setPersonActive`, and
-- it is identity-checked precisely because it must be.
--
-- The guard is in the WHERE clause rather than a raise: activation is allowed to
-- be retried, and a second call for an already-active account should be a
-- no-op, not an exception on a path where the token is already spent.
-- ============================================================================

create or replace function app.auth_activate_account(p_user_id uuid)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  with moved as (
    update public.users
       set account_state = 'active'::public.account_state,
           is_active = true
     where id = p_user_id
       and account_state = 'pending_activation'::public.account_state
    returning 1
  )
  select exists (select 1 from moved);
$function$;

comment on function app.auth_activate_account(uuid) is
  'Moves an account from pending_activation to active, at the end of the '
  'activation flow. SECURITY DEFINER because the caller has no identity yet — '
  'they are setting the credential that will give them one. Only that one '
  'transition; reactivating a deactivated account is setPersonActive. '
  'Migration 045.';

revoke all on function app.auth_activate_account(uuid) from public;
grant execute on function app.auth_activate_account(uuid) to cni_app;
