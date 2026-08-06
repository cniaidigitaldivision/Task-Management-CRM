-- ============================================================================
-- CNI CRM — MIGRATION 010 · PRE-AUTH TOKEN ISSUE + PASSWORD WRITE
-- ----------------------------------------------------------------------------
-- Two gaps found while wiring the server actions, both the same shape: a write
-- the sign-in and recovery flows must perform BEFORE anybody is identified.
--
--   · `invitations` INSERT requires `admin+` (migration 005)
--   · `auth_identities` UPDATE requires the owning identity
--
-- Pre-authentication has neither. The alternative would have been to loosen
-- those policies — which would open the same write to every signed-in Member,
-- permanently, to serve a path that runs once per reset. These join the narrow
-- SECURITY DEFINER surface instead (registry C-15).
--
-- Verified: 9/9 assertions, including that `anon` can reach neither.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · ISSUING A TOKEN
-- ----------------------------------------------------------------------------
-- FR-155: "requesting a new code invalidates the previous one". Superseding and
-- inserting happen in one function so the pair cannot be half-applied — two
-- separate calls could leave a window with two live codes, or with none.

create or replace function app.auth_issue_token(
  p_user_id       uuid,
  p_token_hash    text,
  p_purpose       public.invitation_purpose,
  p_sent_to_email text,
  p_expires_at    timestamptz,
  p_created_by    uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.invitations
     set invalidated_at = now()
   where user_id = p_user_id
     and purpose = p_purpose
     and consumed_at is null
     and invalidated_at is null;

  insert into public.invitations
    (user_id, token_hash, purpose, sent_to_email, expires_at, created_by_id)
  values
    (p_user_id, p_token_hash, p_purpose, lower(p_sent_to_email), p_expires_at, p_created_by)
  returning id into v_id;

  return v_id;
end
$$;

comment on function app.auth_issue_token is
  'Issues a reset/unlock/activation token and supersedes any live one of the same '
  'purpose in the same statement sequence, so FR-155 cannot be half-applied. '
  'Pre-auth (registry C-15) — RLS refuses an invitations INSERT without an admin identity.';


-- ----------------------------------------------------------------------------
-- 2 · SETTING A PASSWORD
-- ----------------------------------------------------------------------------
-- Used at activation and after a verified reset.
--
-- The history trim happens INSIDE the same statement as the write. That is not
-- tidiness: `auth_identities_history_bounded` (migration 001) caps the array at
-- 5, so appending first and trimming afterwards would violate the constraint on
-- the sixth password change and abort. Proven by setting a password six times
-- in the verification script.

create or replace function app.auth_set_password(
  p_user_id  uuid,
  p_hash     text,
  p_keep     integer default 5
)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.auth_identities (user_id, provider, password_hash, last_password_change_at)
  values (p_user_id, 'password', p_hash, now())
  on conflict (user_id, provider) do update
    set password_hash           = p_hash,
        -- A temporary password is spent the moment a real one replaces it
        -- (doc 16 §3 Option B).
        is_temporary_password   = false,
        temporary_expires_at    = null,
        last_password_change_at = now(),
        password_history        = (
          select array_agg(h)
          from (
            select h from unnest(
              array_prepend(public.auth_identities.password_hash, public.auth_identities.password_history)
            ) as h
            where h is not null
            limit p_keep
          ) kept
        );

  -- FR-155c — every session dies on a password change. This is the control that
  -- turns "someone stole my password" into a bounded incident.
  update public.sessions
     set revoked_at = now(), revoked_reason = 'password changed'
   where user_id = p_user_id and revoked_at is null;

  -- A successful reset is also how a locked account comes back (ADR-007).
  update public.users
     set account_state = case
           when account_state in ('locked', 'password_reset_required') then 'active'
           else account_state
         end,
         locked_at = null
   where id = p_user_id;

  insert into public.security_events (user_id, event_type, severity, details)
  values (p_user_id, 'password_changed', 'warning'::public.security_severity, '{}'::jsonb);
end
$$;

comment on function app.auth_set_password is
  'Sets a password, trims history to the last 5 in the same statement (so the '
  'bounded-history check cannot be violated), revokes every session (FR-155c) and '
  'clears any lock. Pre-auth (registry C-15).';


-- ----------------------------------------------------------------------------
-- 3 · PRIVILEGES
-- ----------------------------------------------------------------------------

revoke execute on function app.auth_issue_token(uuid, text, public.invitation_purpose, text, timestamptz, uuid) from public;
revoke execute on function app.auth_set_password(uuid, text, integer) from public;

grant execute on function app.auth_issue_token(uuid, text, public.invitation_purpose, text, timestamptz, uuid) to cni_app;
grant execute on function app.auth_set_password(uuid, text, integer) to cni_app;
