-- ============================================================================
-- CNI CRM — MIGRATION 007 · THE PRE-AUTHENTICATION SURFACE
-- ----------------------------------------------------------------------------
-- Creates:  the narrow SECURITY DEFINER API in schema `app` that the sign-in
--           path uses before an identity exists.
--
-- Specification:  docs/19 §9 C-15 (the seam)
--                 docs/16 §3 §4 §6 · FR-142, FR-147, FR-148, FR-150, FR-155,
--                 FR-155a, FR-155e
--                 docs/20 §9 step 4
--
-- ⛔ Never edit an applied migration (doc 20 §7).
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL
--
-- Registry C-14 requires every request to declare who it is acting as, and RLS
-- refuses everything when it does not. Sign-in cannot satisfy that: verifying a
-- password means reading `auth_identities` BEFORE anybody is identified.
--
-- The answer is not "connect as postgres for login" — that would hand the whole
-- schema to the auth code path. It is this: a small, named, individually
-- reviewed set of definer functions that each do one thing and return the
-- minimum. The application still connects as `cni_app` and still has RLS
-- applied to everything else.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHAT IS DELIBERATELY *NOT* HERE
--
-- The lockout RULE. `app.auth_recent_attempts` returns the ledger and
-- `lib/domain/lockout.ts` decides; this file only caches the answer with
-- `app.auth_set_lock`. Implementing "3 failures in 30 minutes" in both SQL and
-- TypeScript would be two sources of truth for a security control — the exact
-- drift registry C-16 rejected for the schema. One implementation, exhaustively
-- tested (599 domain tests), and SQL stores its verdict.
--
-- Argon2 verification is likewise absent: Postgres cannot do it, and the hash
-- leaves the database only far enough to be verified in the server action.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · IDENTITY LOOKUP
-- ----------------------------------------------------------------------------
-- The single query the sign-in path needs before it can do anything.
--
-- ⚠️ This returns `password_hash`. That is the point — Argon2id verification
--    happens in the server action — but it is also why this function is the
--    most sensitive object in the schema. It is granted to `cni_app` alone,
--    revoked from PUBLIC, and returns exactly one row for an exact,
--    already-lowercased address.
--
-- FR-155e: the caller must behave identically whether or not a row comes back.
-- Returning zero rows rather than raising is part of that — an exception is a
-- timing and behaviour difference an attacker can measure.

create or replace function app.auth_find_identity(p_email text)
  returns table (
    user_id                uuid,
    full_name              text,
    email                  text,
    role                   public.user_role,
    account_state          public.account_state,
    is_active              boolean,
    locked_at              timestamptz,
    password_hash          text,
    is_temporary_password  boolean,
    temporary_expires_at   timestamptz,
    has_verified_mfa       boolean
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    u.id,
    u.full_name,
    u.email,
    u.role,
    u.account_state,
    u.is_active,
    u.locked_at,
    i.password_hash,
    coalesce(i.is_temporary_password, false),
    i.temporary_expires_at,
    exists (
      select 1 from public.mfa_factors f
      where f.user_id = u.id and f.verified_at is not null
    )
  from public.users u
  left join public.auth_identities i
    on i.user_id = u.id and i.provider = 'password'
  where u.email = lower(p_email)
  limit 1
$$;

comment on function app.auth_find_identity(text) is
  'Pre-auth identity lookup (registry C-15). Returns the password hash for Argon2id '
  'verification in the server action. Returns zero rows for an unknown address rather '
  'than raising — FR-155e requires identical behaviour either way.';


-- ----------------------------------------------------------------------------
-- 2 · RECORDING AN ATTEMPT
-- ----------------------------------------------------------------------------
-- Appends to `login_attempts`, which is append-only (migration 003), and raises
-- a security event for anything that is not a clean success.
--
-- Every sign-in attempt must reach here, including those against addresses that
-- match no account — FR-152's anomaly detection and doc 16 §4's per-IP
-- throttling both read this table, and an attempt that was never recorded is an
-- attack that leaves no trace.

create or replace function app.auth_record_attempt(
  p_email       text,
  p_user_id     uuid,
  p_outcome     public.login_outcome,
  p_ip          inet   default null,
  p_ip_country  text   default null,
  p_user_agent  text   default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.login_attempts
    (email_attempted, user_id, ip_address, ip_country, user_agent, outcome)
  values
    (lower(p_email), p_user_id, p_ip, p_ip_country, p_user_agent, p_outcome)
  returning id into v_id;

  if p_outcome <> 'success' then
    insert into public.security_events (user_id, event_type, severity, ip_address, ip_country, details)
    values (
      p_user_id,
      'login_failed',
      case when p_outcome = 'locked' then 'warning' else 'info' end,
      p_ip,
      p_ip_country,
      jsonb_build_object('outcome', p_outcome, 'email', lower(p_email))
    );
  end if;

  return v_id;
end
$$;

comment on function app.auth_record_attempt is
  'Appends a sign-in attempt to the append-only ledger and raises a security event for '
  'failures. Every attempt reaches here, including those against unknown addresses '
  '(FR-152, doc 16 §4).';


-- ----------------------------------------------------------------------------
-- 3 · THE INPUTS THE LOCKOUT RULE NEEDS
-- ----------------------------------------------------------------------------
-- The rule itself lives in lib/domain/lockout.ts. These two functions hand it
-- its inputs: the recent ledger, and the moment of the last explicit unlock
-- (below which earlier failures are spent).
--
-- The unlock timestamp is not a new column — a consumed `account_unlock`
-- invitation already IS that record (registry C-17), and deriving it keeps one
-- fact in one place.

create or replace function app.auth_recent_attempts(
  p_user_id uuid,
  p_since   timestamptz
)
  returns table (outcome public.login_outcome, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select a.outcome, a.created_at
  from public.login_attempts a
  where a.user_id = p_user_id
    and a.created_at >= p_since
  order by a.created_at asc
$$;

create or replace function app.auth_last_unlock_at(p_user_id uuid)
  returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select max(i.consumed_at)
  from public.invitations i
  where i.user_id = p_user_id
    and i.purpose = 'account_unlock'
    and i.consumed_at is not null
$$;

comment on function app.auth_recent_attempts(uuid, timestamptz) is
  'The append-only ledger the lockout rule reads. The RULE is lib/domain/lockout.ts — '
  'implementing it here as well would be two sources of truth for a security control.';


-- ----------------------------------------------------------------------------
-- 4 · CACHING THE VERDICT
-- ----------------------------------------------------------------------------
-- `users.account_state` and `users.locked_at` are a cache of what
-- evaluateLockout() decided, so the account's state is readable without
-- replaying history on every request.
--
-- This writes with NO actor identity, which the users trigger (migration 005)
-- permits only for authentication bookkeeping — role, capacity, email and the
-- rest must be untouched, and the new state must be one authentication can
-- legitimately produce. That is exactly the narrow path assertion 18 of the
-- Step 2 gate proof exists to protect.

create or replace function app.auth_set_lock(
  p_user_id   uuid,
  p_locked_at timestamptz
)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_locked_at is null then
    update public.users
       set account_state = 'active',
           locked_at     = null
     where id = p_user_id
       and account_state = 'locked';
  else
    update public.users
       set account_state = 'locked',
           locked_at     = p_locked_at
     where id = p_user_id
       and account_state <> 'locked';

    insert into public.security_events (user_id, event_type, severity, details)
    values (p_user_id, 'account_locked', 'warning',
            jsonb_build_object('locked_at', p_locked_at));
  end if;
end
$$;

comment on function app.auth_set_lock(uuid, timestamptz) is
  'Caches the lockout verdict on users. Writes with no actor, which the users trigger '
  'permits only for authentication bookkeeping (migration 005 §3.1).';


create or replace function app.auth_record_login(p_user_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.users
     set last_login_at = now(),
         account_state = case when account_state = 'locked' then 'active' else account_state end,
         locked_at     = case when account_state = 'locked' then null else locked_at end
   where id = p_user_id;
end
$$;


-- ----------------------------------------------------------------------------
-- 5 · TOKENS — activation, password reset, account unlock
-- ----------------------------------------------------------------------------
-- doc 16 §3 and §6. The raw token never reaches the database; the caller hashes
-- it and passes the digest, which the `^[0-9a-f]{64}$` check on the column
-- enforces (migration 001).
--
-- Consumption is a single atomic statement on purpose. Read-then-write would
-- let two simultaneous requests both see an unconsumed token and both succeed —
-- a single-use token that can be used twice under load is not single-use.

create or replace function app.auth_consume_token(
  p_token_hash text,
  p_purpose    public.invitation_purpose,
  p_max_attempts integer default 5
)
  returns table (status text, user_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row public.invitations%rowtype;
begin
  select * into v_row
  from public.invitations i
  where i.token_hash = p_token_hash
    and i.purpose = p_purpose
  limit 1;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select 'already_used'::text, v_row.user_id;
    return;
  end if;

  if v_row.invalidated_at is not null then
    -- FR-155: requesting a new code invalidates the previous one.
    return query select 'superseded'::text, v_row.user_id;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, v_row.user_id;
    return;
  end if;

  if v_row.attempt_count >= p_max_attempts then
    return query select 'burned'::text, v_row.user_id;
    return;
  end if;

  -- Atomic: the WHERE clause re-checks everything, so a second concurrent
  -- caller updates zero rows and is told the token is already used.
  update public.invitations
     set consumed_at = now()
   where id = v_row.id
     and consumed_at is null
     and invalidated_at is null
     and expires_at > now();

  if not found then
    return query select 'already_used'::text, v_row.user_id;
    return;
  end if;

  return query select 'ok'::text, v_row.user_id;
end
$$;

comment on function app.auth_consume_token is
  'Redeems an activation, reset or unlock token. Single atomic UPDATE — read-then-write '
  'would let two concurrent requests both consume a single-use token.';


-- Counts a wrong code entry against the token, and burns it at the limit.
create or replace function app.auth_register_token_attempt(p_token_hash text)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.invitations
     set attempt_count = least(attempt_count + 1, 5)
   where token_hash = p_token_hash
     and consumed_at is null
     and invalidated_at is null
  returning attempt_count into v_count;

  return coalesce(v_count, 0);
end
$$;


-- Requesting a new code invalidates every live one of the same purpose (FR-155).
create or replace function app.auth_invalidate_tokens(
  p_user_id uuid,
  p_purpose public.invitation_purpose
)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.invitations
     set invalidated_at = now()
   where user_id = p_user_id
     and purpose = p_purpose
     and consumed_at is null
     and invalidated_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;


-- ----------------------------------------------------------------------------
-- 6 · MFA FACTORS
-- ----------------------------------------------------------------------------
-- Read before the session exists, because FR-145 puts the second factor
-- *inside* the sign-in flow. Returns the encrypted TOTP seed for verification
-- in the server action — same reasoning, and same tight grant, as the password
-- hash in §1.

create or replace function app.auth_verified_factors(p_user_id uuid)
  returns table (
    factor_id        uuid,
    type             public.mfa_type,
    secret_encrypted text,
    credential_id    text,
    public_key       text,
    sign_count       bigint,
    is_primary       boolean
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select f.id, f.type, f.secret_encrypted, f.credential_id, f.public_key,
         f.sign_count, f.is_primary
  from public.mfa_factors f
  where f.user_id = p_user_id
    and f.verified_at is not null
  order by f.is_primary desc, f.created_at asc
$$;


-- ----------------------------------------------------------------------------
-- 7 · SESSIONS
-- ----------------------------------------------------------------------------
-- Created only once authentication has actually succeeded. Lifetimes are
-- computed by lib/domain/session-policy.ts and passed in — the same reasoning
-- as the lockout rule: one implementation, tested, and SQL stores the result.

create or replace function app.auth_create_session(
  p_user_id             uuid,
  p_refresh_token_hash  text,
  p_device_fingerprint  text,
  p_expires_at          timestamptz,
  p_absolute_expires_at timestamptz,
  p_user_agent          text default null,
  p_ip                  inet default null,
  p_ip_country          text default null,
  p_ip_asn              text default null,
  p_rotated_from        uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.sessions (
    user_id, refresh_token_hash, device_fingerprint, user_agent,
    ip_address, ip_country, ip_asn, expires_at, absolute_expires_at, rotated_from_id
  )
  values (
    p_user_id, p_refresh_token_hash, p_device_fingerprint, p_user_agent,
    p_ip, p_ip_country, p_ip_asn, p_expires_at, p_absolute_expires_at, p_rotated_from
  )
  returning id into v_id;

  return v_id;
end
$$;


/*
 * FR-150 — refresh rotation with reuse detection.
 *
 * A refresh token is single-use. Presenting one that has already been rotated
 * away means it was copied, and the copy is indistinguishable from the original
 * — so the only safe response is to assume the attacker has it and revoke every
 * session on the account.
 *
 * Returns the outcome so the caller can raise the alarm (doc 16 §10).
 */
create or replace function app.auth_detect_reuse(p_refresh_token_hash text)
  returns table (outcome text, user_id uuid, session_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_revoked integer;
begin
  select * into v_session
  from public.sessions s
  where s.refresh_token_hash = p_refresh_token_hash
  limit 1;

  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid;
    return;
  end if;

  -- Already rotated away, or already revoked: this token should not exist in a
  -- caller's hands at all.
  if v_session.revoked_at is not null then
    update public.sessions
       set revoked_at        = coalesce(revoked_at, now()),
           revoked_reason    = coalesce(revoked_reason, 'refresh token reuse detected'),
           reuse_detected_at = coalesce(reuse_detected_at, now())
     where user_id = v_session.user_id
       and revoked_at is null;

    get diagnostics v_revoked = row_count;

    update public.sessions
       set reuse_detected_at = coalesce(reuse_detected_at, now())
     where id = v_session.id;

    insert into public.security_events (user_id, event_type, severity, details)
    values (v_session.user_id, 'refresh_token_reuse', 'critical',
            jsonb_build_object('session_id', v_session.id,
                               'sessions_revoked', v_revoked));

    return query select 'reuse_detected'::text, v_session.user_id, v_session.id;
    return;
  end if;

  return query select 'ok'::text, v_session.user_id, v_session.id;
end
$$;

comment on function app.auth_detect_reuse(text) is
  'FR-150. A replayed refresh token means the token was copied, so every session on the '
  'account is revoked — the copy cannot be told apart from the original.';


create or replace function app.auth_revoke_all_sessions(
  p_user_id uuid,
  p_reason  text
)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.sessions
     set revoked_at = now(), revoked_reason = p_reason
   where user_id = p_user_id
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function app.auth_revoke_all_sessions(uuid, text) is
  'FR-155c — every password reset revokes every session. Also the first move in each '
  'incident-response scenario in doc 16 §12.';


-- ----------------------------------------------------------------------------
-- 8 · PRIVILEGES
-- ----------------------------------------------------------------------------
-- Definer functions default to EXECUTE for PUBLIC, which on a SECURITY DEFINER
-- function that returns password hashes would be the whole point of the
-- exercise undone. Revoked from PUBLIC, granted to `cni_app` alone.

revoke execute on function app.auth_find_identity(text) from public;
revoke execute on function app.auth_record_attempt(text, uuid, public.login_outcome, inet, text, text) from public;
revoke execute on function app.auth_recent_attempts(uuid, timestamptz) from public;
revoke execute on function app.auth_last_unlock_at(uuid) from public;
revoke execute on function app.auth_set_lock(uuid, timestamptz) from public;
revoke execute on function app.auth_record_login(uuid) from public;
revoke execute on function app.auth_consume_token(text, public.invitation_purpose, integer) from public;
revoke execute on function app.auth_register_token_attempt(text) from public;
revoke execute on function app.auth_invalidate_tokens(uuid, public.invitation_purpose) from public;
revoke execute on function app.auth_verified_factors(uuid) from public;
revoke execute on function app.auth_create_session(uuid, text, text, timestamptz, timestamptz, text, inet, text, text, uuid) from public;
revoke execute on function app.auth_detect_reuse(text) from public;
revoke execute on function app.auth_revoke_all_sessions(uuid, text) from public;

grant execute on function app.auth_find_identity(text) to cni_app;
grant execute on function app.auth_record_attempt(text, uuid, public.login_outcome, inet, text, text) to cni_app;
grant execute on function app.auth_recent_attempts(uuid, timestamptz) to cni_app;
grant execute on function app.auth_last_unlock_at(uuid) to cni_app;
grant execute on function app.auth_set_lock(uuid, timestamptz) to cni_app;
grant execute on function app.auth_record_login(uuid) to cni_app;
grant execute on function app.auth_consume_token(text, public.invitation_purpose, integer) to cni_app;
grant execute on function app.auth_register_token_attempt(text) to cni_app;
grant execute on function app.auth_invalidate_tokens(uuid, public.invitation_purpose) to cni_app;
grant execute on function app.auth_verified_factors(uuid) to cni_app;
grant execute on function app.auth_create_session(uuid, text, text, timestamptz, timestamptz, text, inet, text, text, uuid) to cni_app;
grant execute on function app.auth_detect_reuse(text) to cni_app;
grant execute on function app.auth_revoke_all_sessions(uuid, text) to cni_app;
