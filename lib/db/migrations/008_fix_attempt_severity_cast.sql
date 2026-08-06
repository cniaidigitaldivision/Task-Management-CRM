-- ============================================================================
-- CNI CRM — MIGRATION 008 · FIX: enum cast in app.auth_record_attempt
-- ----------------------------------------------------------------------------
-- Corrects a defect in migration 007. Applied migrations are history and are
-- never edited (doc 20 §7), so the fix is its own numbered file.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--   ERROR 42804: column "severity" is of type public.security_severity
--                but expression is of type text
--
-- `app.auth_record_attempt` chose the event severity with a bare CASE:
--
--     case when p_outcome = 'locked' then 'warning' else 'info' end
--
-- In an ordinary function Postgres would resolve those literals against the
-- target column's type. These functions pin `search_path = ''` (migration 006,
-- for the search-path hardening the linter asked for), and under an empty
-- search path the untyped literals stay `text` and the insert fails.
--
-- So: every failed sign-in would have raised an exception instead of being
-- recorded. Sign-in would have appeared to work and the ledger the lockout,
-- rate limiting and anomaly detection all read (FR-148, FR-152, FR-155a) would
-- have stayed empty.
--
-- ── HOW IT WAS FOUND ──────────────────────────────────────────────────────
-- The verification script, on its first run, before any application code
-- existed to hide it. This is the argument for proving a migration rather than
-- reading it: the function compiled, deployed and looked correct — plpgsql does
-- not type-check statement bodies until they execute, so nothing complained
-- until something actually called it.
--
-- The cast is now explicit and schema-qualified, which is what an empty
-- search_path requires everywhere.
-- ============================================================================

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
    insert into public.security_events
      (user_id, event_type, severity, ip_address, ip_country, details)
    values (
      p_user_id,
      'login_failed',
      -- Explicit, schema-qualified. Under `search_path = ''` nothing resolves
      -- implicitly, and that is the point of pinning it.
      (case when p_outcome = 'locked' then 'warning' else 'info' end)::public.security_severity,
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
  '(FR-152, doc 16 §4). Severity is cast explicitly — see migration 008.';

-- CREATE OR REPLACE preserves the ACL, but state it again so the grant is
-- visible in the migration that last touched the function.
revoke execute on function app.auth_record_attempt(text, uuid, public.login_outcome, inet, text, text) from public;
grant  execute on function app.auth_record_attempt(text, uuid, public.login_outcome, inet, text, text) to cni_app;
