-- =============================================================================
-- MIGRATION 011 — First-run Super Admin setup
-- Applied: session 10.  Verified: 8/8 (see the assertion list at the foot).
-- Traces to: FR-140, ADR-009, BR-028, SA-2, SA-9, doc 20 §9 step 5.1.
-- -----------------------------------------------------------------------------
-- ADR-009: the system ships with no team data whatsoever. There is no seeded
-- roster and no public sign-up, so *something* has to create the first account,
-- and that something cannot itself require an account to run. That is the whole
-- of the pre-auth bootstrap problem recorded as C-15 in doc 19.
--
-- These two functions are the narrowest surface that solves it:
--
--   app.setup_is_available()  → is there no Super Admin yet?
--   app.setup_super_admin(…)  → create the one Super Admin, atomically
--
-- ── WHY THIS ROUTE CANNOT BE RUN TWICE ───────────────────────────────────────
-- Not because of a flag, and not because of the guard clause below. Migration
-- 001 declares
--
--   create unique index users_single_super_admin_idx
--     on public.users ((true)) where role = 'super_admin';
--
-- so at most one `super_admin` row can exist in this database, ever (BR-028).
-- The guard clause and `setup_is_available()` exist only so that a second
-- attempt produces a sentence a human can read instead of a unique violation.
-- Delete both and the route is *still* single-use. That is the difference
-- between disabled and impossible, and it is why the constraint lives in an
-- index rather than in a boolean somebody could flip back.
--
-- ── WHY SECURITY DEFINER, AND WHY THAT IS SAFE HERE ──────────────────────────
-- The caller is `cni_app` with no session identity — `app.user_id` is unset, so
-- every RLS policy on `users` fails closed and the insert would be refused.
-- SECURITY DEFINER lets the function do the insert as its owner. The exposure
-- is bounded by three things, all of them structural:
--   1. the function's only reachable effect is creating a `super_admin`, and the
--      unique index means that is possible at most once in the lifetime of the
--      database;
--   2. `search_path = ''` (per 006) means every name is schema-qualified, so a
--      caller cannot shadow `users` with a table of their own;
--   3. `execute` is granted to `cni_app` only — never to `anon`, `authenticated`
--      or `public`.
--
-- ── WHY ONE TRANSACTION ──────────────────────────────────────────────────────
-- The user, the password identity, the ten recovery codes, the CRITICAL security
-- event and the audit row are written together or not at all. A partial setup is
-- the worst possible outcome: an account that exists but cannot be signed into,
-- in a system whose only remedy for that is the account it just failed to make.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Availability
-- -----------------------------------------------------------------------------
create or replace function app.setup_is_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.users where role = 'super_admin')
$$;

comment on function app.setup_is_available() is
  'FR-140: true only while no super_admin exists. Advisory — the real guarantee is users_single_super_admin_idx.';

-- -----------------------------------------------------------------------------
-- 2. The one-time creation
-- -----------------------------------------------------------------------------
-- p_password_hash    — Argon2id, computed in the application (lib/auth/hashing).
--                      The database never sees a plaintext password.
-- p_recovery_hashes  — ten SHA-256 hashes (lib/auth/tokens). The plaintext codes
--                      exist only in the response to the browser, once (SA-9).
create or replace function app.setup_super_admin(
  p_full_name       text,
  p_email           text,
  p_password_hash   text,
  p_recovery_hashes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if exists (select 1 from public.users where role = 'super_admin') then
    raise exception 'Setup has already been completed.'
      using errcode = 'restrict_violation',
            hint = 'A second Super Admin can only be created through the sealed procedure in doc 16 §6.';
  end if;

  insert into public.users (full_name, email, role, account_state)
  values (btrim(p_full_name), lower(btrim(p_email)), 'super_admin', 'active')
  returning id into v_id;

  insert into public.auth_identities (user_id, provider, password_hash, last_password_change_at)
  values (v_id, 'password', p_password_hash, now());

  -- SA-9: ten single-use codes, hash-only, shown once at setup and never again.
  insert into public.recovery_codes (user_id, code_hash)
  select v_id, h from unnest(p_recovery_hashes) as h;

  insert into public.security_events (user_id, event_type, severity, details)
  values (v_id, 'super_admin_created', 'critical'::public.security_severity,
          jsonb_build_object('email', lower(btrim(p_email))));

  insert into public.audit_log (actor_id, actor_email, actor_role, entity_type, entity_id, action, outcome)
  values (v_id, lower(btrim(p_email)), 'super_admin', 'user', v_id, 'super_admin.setup', 'success');

  return v_id;
end
$$;

comment on function app.setup_super_admin(text, text, text, text[]) is
  'FR-140: creates the one Super Admin, its password identity, ten recovery codes, a CRITICAL security event and an audit row, in one transaction. Single-use by virtue of users_single_super_admin_idx.';

-- -----------------------------------------------------------------------------
-- 3. Grants — the application role only
-- -----------------------------------------------------------------------------
revoke execute on function app.setup_is_available()                         from public;
revoke execute on function app.setup_super_admin(text, text, text, text[])  from public;

grant  execute on function app.setup_is_available()                         to cni_app;
grant  execute on function app.setup_super_admin(text, text, text, text[])  to cni_app;

-- =============================================================================
-- VERIFIED 8/8 (session 10, against the live project in a rolled-back
-- transaction):
--   1. setup_is_available() is true on an empty roster
--   2. setup_super_admin() returns a uuid and creates a role='super_admin' row
--   3. an auth_identities row exists with provider='password'
--   4. the supplied recovery-code hashes are all stored
--   5. a security_events row exists with severity='critical'
--   6. setup_is_available() is false afterwards
--   7. a second call raises 'Setup has already been completed.'
--   8. `anon` cannot execute either function (permission denied)
-- =============================================================================
