-- =============================================================================
-- MIGRATION 016 — per-source rate limiting, and resetting somebody's MFA
-- Traces to: FR-148 (rate limiting), FR-145/FR-146 (MFA), doc 03 §3.1.
-- -----------------------------------------------------------------------------
-- Two additions, both small, both on the pre-auth surface for the same reason:
-- they are needed at moments when no identity has been established yet, or when
-- the identity that exists must not be the one deciding.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · FR-148 — failures from one source, for the rate limiter
-- -----------------------------------------------------------------------------
-- The three-strike lock protects an ACCOUNT. It does nothing about one password
-- tried against every address in the company: each account collects a single
-- failure, none reaches three, and the whole staff list is walked unimpeded.
-- Limiting by source is what closes that, and the two compose — the lockout
-- stops depth, this stops breadth.
--
-- Returns timestamps rather than a count, deliberately: the RULE (how many are
-- free, how the delay rises, when to refuse) belongs in lib/domain/rate-limit.ts
-- where it is pure and tested. Counting here would put half a security control
-- in SQL and half in TypeScript, which is how the two drift apart.
create or replace function app.auth_failures_from(
  p_ip    inet,
  p_since timestamptz
)
returns table (at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.created_at
    from public.login_attempts l
   where l.ip_address = p_ip
     and l.created_at >= p_since
     and l.outcome <> 'success'
$$;

comment on function app.auth_failures_from(inet, timestamptz) is
  'FR-148: failed attempt times from one source. Returns raw timestamps — the rate-limit rule lives in lib/domain/rate-limit.ts so there is one implementation, not two.';

-- login_attempts is indexed for the per-user lockout, which does not serve a
-- lookup by address. This runs on every sign-in.
create index if not exists login_attempts_ip_recent_idx
  on public.login_attempts (ip_address, created_at desc)
  where outcome <> 'success';

-- -----------------------------------------------------------------------------
-- 2 · Resetting somebody else's authenticator — doc 03 §3.1, FR-146
-- -----------------------------------------------------------------------------
-- ⚠️ WHY THIS IS A FUNCTION AND NOT A DELETE THROUGH RLS
-- `mfa_factors_delete` permits a factor's owner, or an Admin who outranks them,
-- to remove it. That is correct for the ordinary case and NOT sufficient here,
-- because the Super Admin's factors are additionally protected by the
-- `protect_super_admin_mfa` trigger (migration 005, FR-146): the invariant is
-- that account always keeps at least one verified factor, and nobody else may
-- remove the last one.
--
-- Routing the reset through one named function means the refusal is a sentence
-- rather than a policy violation, and means the act is recorded in one place
-- instead of wherever somebody happened to write a DELETE.
create or replace function app.mfa_reset_for(
  p_actor_id  uuid,
  p_target_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role  public.user_role;
  v_target_role public.user_role;
  v_removed     integer;
begin
  select role into v_actor_role  from public.users where id = p_actor_id;
  select role into v_target_role from public.users where id = p_target_id;

  if v_actor_role is null or v_target_role is null then
    raise exception 'Unknown account.' using errcode = 'no_data_found';
  end if;

  -- doc 03 §3.1: Admin and above, and only downward.
  if app.role_rank(v_actor_role) < app.role_rank('admin'::public.user_role) then
    raise exception 'Only an Admin can reset an authenticator.'
      using errcode = 'insufficient_privilege';
  end if;

  -- FR-146. The Super Admin's second factor cannot be removed by anybody else,
  -- and that is the point of the role: an Admin who could strip it could then
  -- reset the password and take the account.
  if v_target_role = 'super_admin' and p_actor_id <> p_target_id then
    raise exception 'The Super Admin''s authenticator cannot be reset by anybody else.'
      using errcode = 'insufficient_privilege',
            hint = 'Recovery codes are the way back in. FR-146, FR-140.';
  end if;

  if app.role_rank(v_actor_role) <= app.role_rank(v_target_role)
     and p_actor_id <> p_target_id then
    raise exception 'You can only manage people below your own rank.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.mfa_factors where user_id = p_target_id;
  get diagnostics v_removed = row_count;

  insert into public.security_events (user_id, event_type, severity, details)
  values (p_target_id, 'mfa_reset', 'warning'::public.security_severity,
          jsonb_build_object('by', p_actor_id, 'factors_removed', v_removed));

  return v_removed;
end
$$;

comment on function app.mfa_reset_for(uuid, uuid) is
  'doc 03 §3.1: an Admin removes somebody''s authenticators so they can enrol again. Refuses the Super Admin (FR-146) and anybody at or above the actor''s rank.';

-- -----------------------------------------------------------------------------
-- 3 · Grants
-- -----------------------------------------------------------------------------
revoke execute on function app.auth_failures_from(inet, timestamptz) from public;
revoke execute on function app.mfa_reset_for(uuid, uuid)             from public;

grant execute on function app.auth_failures_from(inet, timestamptz) to cni_app;
grant execute on function app.mfa_reset_for(uuid, uuid)             to cni_app;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('auth_failures_from', 'mfa_reset_for')
     group by 1 having count(*) = 2
  ) then
    raise exception 'Migration 016 incomplete';
  end if;
  raise notice 'Migration 016 OK — auth_failures_from, mfa_reset_for';
end
$$;
