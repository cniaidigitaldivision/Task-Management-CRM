-- ============================================================================
-- 017 · READING THE SETTINGS BEFORE THERE IS AN IDENTITY
-- ----------------------------------------------------------------------------
-- Adds:  app.settings_effective()
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- The RLS select policy on `system_settings` is
--
--     using (app.current_user_id() is not null)
--
-- which is right for a table of workspace configuration: doc 04 §5 says read by
-- all *authenticated* users. But four of the settings govern the pre-auth
-- surface, where by definition nobody is authenticated yet:
--
--   failedLoginsToLock          how many bad passwords lock the account
--   accountLockAutoClearMinutes how long that lock lasts
--   recoveryCodeTtlMinutes      how long an emailed six-digit code is good for
--   passwordMinLength           what /activate and /reset-password enforce
--
-- Without this function the login path silently reads the shipped defaults, so
-- a Super Admin who lowers the lock threshold to 3 gets a Settings screen that
-- says 3, an audit entry that says 3, and a login form that still locks at 5.
-- Nothing errors. That is precisely the class of bug this project keeps finding
-- at seams (C-18, C-19, C-22), so it is closed at the same time as the setting
-- becomes editable rather than after somebody notices.
--
-- ── WHY THIS IS SAFE TO EXPOSE WITHOUT AN IDENTITY ───────────────────────────
-- It returns operational parameters, not data about people: no rows from any
-- other table, no user ids, no join. Every one of these numbers is already
-- printed on the login and forgot-password screens in plain English, because
-- telling somebody "5 failed attempts locks the account" is a usability
-- requirement, not a leak. The function is SECURITY DEFINER only so that the
-- unauthenticated path can read the same numbers it is already displaying.
--
-- It cannot be used to write, and `system_settings` writes remain governed by
-- the insert/update/delete policies from migration 005.
-- ============================================================================

create or replace function app.settings_effective()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from public.system_settings
$$;

comment on function app.settings_effective() is
  'Every stored override as one jsonb object. SECURITY DEFINER so the pre-auth '
  'surface can read the lock threshold and code TTL it already displays. '
  'Unset keys are absent — the caller falls back to SYSTEM_DEFAULTS (C-16 §9a).';

revoke all on function app.settings_effective() from public;
grant execute on function app.settings_effective() to cni_app;
