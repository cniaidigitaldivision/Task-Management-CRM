-- ============================================================================
-- CNI CRM — MIGRATION 009 · FIX: ambiguous column in app.auth_detect_reuse
-- ----------------------------------------------------------------------------
-- Corrects a second defect in migration 007. Applied migrations are history and
-- are never edited (doc 20 §7), so this is its own numbered file.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--   ERROR 42702: column reference "user_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- The function declares `RETURNS TABLE (outcome text, user_id uuid,
-- session_id uuid)`. Those OUT parameters are plpgsql variables in scope for
-- the whole body, so an unqualified `where user_id = …` inside it is genuinely
-- ambiguous and Postgres refuses at execution time.
--
-- The consequence would have been the worst possible one for this particular
-- function: FR-150's reuse detection is the response to a STOLEN refresh token,
-- and it would have thrown instead of revoking anything. The happy path
-- ('ok', for a live token) worked fine — only the security response was broken,
-- which is exactly the code path nobody exercises by hand.
--
-- Every table reference in the body is now aliased and qualified.
--
-- ── WHY BOTH 007 DEFECTS SURVIVED REVIEW ──────────────────────────────────
-- plpgsql does not type-check or name-resolve statement bodies at CREATE time.
-- Both functions compiled, deployed and read correctly; neither failed until
-- something called them. That is the case for proving a migration with a script
-- rather than reading it — and both were caught on the verification script's
-- first run, before any application code existed to hide them.
-- ============================================================================

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

  -- A token that was already rotated away, or belongs to a revoked session,
  -- should not be in anybody's hands. Assume it was copied.
  if v_session.revoked_at is not null then
    update public.sessions as s
       set revoked_at        = coalesce(s.revoked_at, now()),
           revoked_reason    = coalesce(s.revoked_reason, 'refresh token reuse detected'),
           reuse_detected_at = coalesce(s.reuse_detected_at, now())
     where s.user_id = v_session.user_id
       and s.revoked_at is null;

    get diagnostics v_revoked = row_count;

    update public.sessions as s
       set reuse_detected_at = coalesce(s.reuse_detected_at, now())
     where s.id = v_session.id;

    insert into public.security_events (user_id, event_type, severity, details)
    values (
      v_session.user_id,
      'refresh_token_reuse',
      'critical'::public.security_severity,
      jsonb_build_object('session_id', v_session.id, 'sessions_revoked', v_revoked)
    );

    return query select 'reuse_detected'::text, v_session.user_id, v_session.id;
    return;
  end if;

  return query select 'ok'::text, v_session.user_id, v_session.id;
end
$$;

comment on function app.auth_detect_reuse(text) is
  'FR-150. A replayed refresh token means the token was copied, so every session on the '
  'account is revoked — the copy cannot be told apart from the original. Table references '
  'are aliased because the OUT parameters shadow the columns (see migration 009).';

revoke execute on function app.auth_detect_reuse(text) from public;
grant  execute on function app.auth_detect_reuse(text) to cni_app;
