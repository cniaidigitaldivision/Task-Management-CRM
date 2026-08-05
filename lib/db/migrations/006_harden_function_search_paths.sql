-- ============================================================================
-- CNI CRM — MIGRATION 006 · SEARCH-PATH HARDENING & FUNCTION PRIVILEGES
-- ----------------------------------------------------------------------------
-- Applies:  search_path = '' to every function in schema app
--           EXECUTE revoked from PUBLIC on the platform event-trigger function
--
-- Raised by:  Supabase database linter, run immediately after migration 005
--             (0011_function_search_path_mutable — 5 WARN
--              0028/0029_anon_security_definer_function_executable — 2 WARN)
--
-- Specification:  docs/16-SECURITY-AND-IDENTITY.md §8 (secure configuration),
--                 §9 A05 "Security Misconfiguration", CIS Benchmarks
--
-- ⛔ Never edit an applied migration (doc 20 §7).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · EMPTY SEARCH PATH ON EVERY app FUNCTION
-- ----------------------------------------------------------------------------
-- A function with a mutable search_path resolves unqualified names using
-- whatever the *caller* happens to have set. For a SECURITY DEFINER function
-- that is a privilege-escalation primitive: shadow a table or an operator in a
-- schema you control, call the function, and it runs your object with the
-- owner's rights.
--
-- Setting it to '' removes the attack entirely — nothing resolves implicitly
-- except pg_catalog, which is always searched and cannot be shadowed. Every
-- reference inside these functions is already schema-qualified, so nothing
-- changes behaviourally; the gate proof in lib/db/verify/ is re-run after this
-- migration to confirm that.
--
-- Migrations 001–005 set `public, pg_temp` on the definer functions, which
-- silenced nothing: having `public` on the path is the risk, not the cure.

alter function app.current_user_id()                        set search_path = '';
alter function app.break_glass_active()                     set search_path = '';
alter function app.touch_updated_at()                       set search_path = '';
alter function app.role_rank(public.user_role)              set search_path = '';
alter function app.current_user_role()                      set search_path = '';
alter function app.acting_at_least(public.user_role)        set search_path = '';
alter function app.acting_outranks(uuid)                    set search_path = '';
alter function app.reject_row_mutation()                    set search_path = '';
alter function app.reject_truncate()                        set search_path = '';
alter function app.enforce_users_write_rules()              set search_path = '';
alter function app.protect_super_admin_mfa()                set search_path = '';


-- ----------------------------------------------------------------------------
-- 2 · public.rls_auto_enable() — A PLATFORM OBJECT, TIGHTENED
-- ----------------------------------------------------------------------------
-- Not ours. Supabase installs it as an event trigger that switches RLS on for
-- any table created in `public`, and grants EXECUTE to PUBLIC. Migration 005's
-- `revoke ... from anon, authenticated` could not remove that: a grant to
-- PUBLIC is not a grant to those roles, and revoking from a role does not
-- withdraw what PUBLIC already confers.
--
-- Severity is low in practice — its return type is `event_trigger`, which
-- Postgres refuses to call from SQL, so the RPC route the linter describes does
-- not actually execute anything. But "low" is not "zero", the object is
-- SECURITY DEFINER, and the fix costs nothing.
--
-- Firing an event trigger does not consult EXECUTE on its function (the same
-- as an ordinary trigger), and the owner keeps the privilege regardless, so
-- the auto-enable behaviour is unaffected.

revoke execute on function public.rls_auto_enable() from public;


-- ----------------------------------------------------------------------------
-- 3 · break_glass — the linter's remaining finding is the intended design
-- ----------------------------------------------------------------------------
-- 0008_rls_enabled_no_policy reports `public.break_glass` as RLS-enabled with
-- no policies. That is exactly what doc 04 §5 asks for: "No client read path at
-- all. Server-side verification only." A policy would create the path the
-- requirement forbids. Recorded on the table so the next person to run the
-- linter does not helpfully add one.

comment on table public.break_glass is
  'doc 16 §6. Sealed master credential, hash-only, single-use, loudly logged. '
  'RLS is enabled with ZERO policies and all privileges revoked from cni_app — '
  'deliberately, per doc 04 §5 "no client read path at all". The Supabase linter '
  'reports this as 0008_rls_enabled_no_policy; that finding is the intended design. '
  'Do not add a policy.';
