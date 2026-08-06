-- =============================================================================
-- MIGRATION 014 — RESOLVING A SESSION COOKIE INTO A SIGNED-IN USER
-- Traces to: FR-005, FR-006, FR-150, FR-154, doc 16 §4, registry C-15.
-- -----------------------------------------------------------------------------
-- Migration 007 gave us everything needed to *create* a session. This is the
-- other half: every request afterwards arrives with a cookie and has to turn it
-- back into an identity — and that lookup happens BEFORE any identity is set, so
-- it cannot go through RLS. It belongs on the pre-auth definer surface (C-15).
--
-- ── WHY THE ROLE IS FETCHED EVERY TIME, NOT CACHED IN THE COOKIE ─────────────
-- FR-005: "a role change takes effect on the next request." That is only true if
-- the role is read from `users` on every request. This is the function that makes
-- the cookie's deliberate emptiness (lib/auth/session.ts) actually work — the
-- cookie is an opaque pointer, and this is the dereference.
--
-- ── WHAT IT REFUSES, AND WHY EACH ONE IS A SEPARATE REASON ───────────────────
-- The caller gets a reason, not just a null, because the four failures need four
-- different responses:
--
--   revoked   → the session was killed (password change, incident, sign-out).
--   expired   → the sliding window lapsed; sign in again.
--   idle      → doc 16 §4's idle timeout. Super Admin 30 min, Admin 2 h, nobody
--               else. Distinct from `expired` because it is about the human
--               walking away from a screen, not about the token ageing.
--   inactive  → the account is deactivated or not `active` (FR-006). This is the
--               dangerous one to get wrong: a member suspended this morning must
--               not keep working all afternoon on a cookie issued yesterday.
--
-- The idle rule is evaluated HERE rather than in TypeScript for one specific
-- reason: `last_seen_at` is written by the database's clock, and comparing it to
-- the application's clock is exactly the mistake that made the lockout never
-- trip (registry C-19, 22 seconds of measured skew). Both sides of this
-- comparison come from `now()`.
-- =============================================================================

create or replace function app.session_resolve(p_token_hash text)
returns table (
  outcome         text,
  session_id      uuid,
  user_id         uuid,
  full_name       text,
  email           text,
  role            public.user_role,
  role_title      text,
  account_state   public.account_state,
  avatar_url      text,
  theme           public.theme_preference,
  timezone        text,
  weekly_capacity_points integer,
  max_concurrent_tasks   integer,
  step_up_verified_at    timestamptz,
  device_fingerprint     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Prefixed to keep them clear of the OUT parameters above. RETURNS TABLE
  -- parameters shadow column names inside the body, which is precisely the
  -- defect migration 009 had to fix in app.auth_detect_reuse.
  v_s      public.sessions;
  v_u      public.users;
  v_idle   integer;
begin
  select * into v_s from public.sessions s where s.refresh_token_hash = p_token_hash;
  if v_s.id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text,
      null::public.user_role, null::text, null::public.account_state, null::text,
      null::public.theme_preference, null::text, null::integer, null::integer,
      null::timestamptz, null::text;
    return;
  end if;

  select * into v_u from public.users u where u.id = v_s.user_id;

  if v_s.revoked_at is not null then
    return query select 'revoked'::text, v_s.id, v_u.id, null::text, null::text,
      null::public.user_role, null::text, null::public.account_state, null::text,
      null::public.theme_preference, null::text, null::integer, null::integer,
      null::timestamptz, null::text;
    return;
  end if;

  if v_s.expires_at <= now() or v_s.absolute_expires_at <= now() then
    return query select 'expired'::text, v_s.id, v_u.id, null::text, null::text,
      null::public.user_role, null::text, null::public.account_state, null::text,
      null::public.theme_preference, null::text, null::integer, null::integer,
      null::timestamptz, null::text;
    return;
  end if;

  -- doc 16 §4. NULL means "no idle timeout for this role", which is the
  -- Coordinator and Member case — not a missing value.
  v_idle := case v_u.role
              when 'super_admin' then 30
              when 'admin'      then 120
              else null
            end;

  if v_idle is not null and v_s.last_seen_at < now() - make_interval(mins => v_idle) then
    return query select 'idle'::text, v_s.id, v_u.id, null::text, null::text,
      null::public.user_role, null::text, null::public.account_state, null::text,
      null::public.theme_preference, null::text, null::integer, null::integer,
      null::timestamptz, null::text;
    return;
  end if;

  -- FR-006: only `active` reaches the application. Every other state is a
  -- redirect to one remediation screen, and `is_active = false` is a hard stop.
  if not v_u.is_active or v_u.account_state <> 'active' then
    return query select 'inactive'::text, v_s.id, v_u.id, null::text, null::text,
      null::public.user_role, null::text, v_u.account_state, null::text,
      null::public.theme_preference, null::text, null::integer, null::integer,
      null::timestamptz, null::text;
    return;
  end if;

  return query select
    'ok'::text, v_s.id, v_u.id, v_u.full_name, v_u.email, v_u.role, v_u.role_title,
    v_u.account_state, v_u.avatar_url, v_u.theme, v_u.timezone,
    v_u.weekly_capacity_points, v_u.max_concurrent_tasks,
    v_s.step_up_verified_at, v_s.device_fingerprint;
end
$$;

comment on function app.session_resolve(text) is
  'FR-005/FR-006/FR-150: turns a cookie into an identity. The role is read from users on EVERY call so a role change takes effect on the next request. Idle timeout is evaluated here so both sides of the comparison use the database clock (registry C-19).';

-- -----------------------------------------------------------------------------
-- Sliding the window, and signing out
-- -----------------------------------------------------------------------------
-- Writes `last_seen_at` and extends `expires_at`, never past the absolute cap.
-- Separate from resolve() because resolve is STABLE and read on every request,
-- while this writes — and a read path that writes on every page view is how you
-- turn a navigation into a lock contention.
create or replace function app.session_touch(p_session_id uuid, p_extend_minutes integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sessions
     set last_seen_at = now(),
         expires_at = least(
           greatest(expires_at, now() + make_interval(mins => p_extend_minutes)),
           absolute_expires_at
         )
   where id = p_session_id
     and revoked_at is null
$$;

create or replace function app.session_revoke(p_session_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sessions
     set revoked_at = now(), revoked_reason = coalesce(nullif(btrim(p_reason), ''), 'signed_out')
   where id = p_session_id and revoked_at is null
$$;

-- FR-154: the account's live sessions, for "sign out everywhere".
create or replace function app.session_list(p_user_id uuid)
returns table (
  id uuid, created_at timestamptz, last_seen_at timestamptz,
  expires_at timestamptz, user_agent text, ip_address inet, ip_country text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, s.last_seen_at, s.expires_at,
         s.user_agent, s.ip_address, s.ip_country
    from public.sessions s
   where s.user_id = p_user_id and s.revoked_at is null and s.expires_at > now()
   order by s.last_seen_at desc
$$;

-- FR-149: record that the step-up challenge was cleared just now.
create or replace function app.session_mark_step_up(p_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sessions set step_up_verified_at = now()
   where id = p_session_id and revoked_at is null
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function app.session_resolve(text)              from public;
revoke execute on function app.session_touch(uuid, integer)       from public;
revoke execute on function app.session_revoke(uuid, text)         from public;
revoke execute on function app.session_list(uuid)                 from public;
revoke execute on function app.session_mark_step_up(uuid)         from public;

grant execute on function app.session_resolve(text)              to cni_app;
grant execute on function app.session_touch(uuid, integer)       to cni_app;
grant execute on function app.session_revoke(uuid, text)         to cni_app;
grant execute on function app.session_list(uuid)                 to cni_app;
grant execute on function app.session_mark_step_up(uuid)         to cni_app;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'session_resolve'
  ) then
    raise exception 'Migration 014 incomplete';
  end if;
  raise notice 'Migration 014 OK — session resolve/touch/revoke/list/step-up';
end
$$;
