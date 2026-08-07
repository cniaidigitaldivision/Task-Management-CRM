-- =============================================================================
-- MIGRATION 015 — "have we seen this device before?"
-- Traces to: FR-151 (login alerts), FR-152 (anomaly detection), doc 16 §4.
-- -----------------------------------------------------------------------------
-- FR-151 wants somebody told when their account is signed into. Told about
-- EVERY sign-in, they stop reading them — and an alert that is skimmed past is
-- worse than none, because it is mistaken for coverage while providing none.
--
-- So the alert fires only for a device fingerprint this account has not used
-- before, which needs one question answered during sign-in, before any identity
-- has been established. That is the pre-auth surface (registry C-15), and this
-- is the smallest possible addition to it: one boolean, one account, one
-- fingerprint, no rows returned.
--
-- ── WHY IT IS ASKED *BEFORE* THE NEW SESSION IS CREATED ──────────────────────
-- The caller must check first. `auth_create_session` writes a row carrying this
-- exact fingerprint, so asking afterwards always answers "yes, seen it" — the
-- session just created is the match. A subtle enough ordering bug that the
-- comment is worth more than the function.
-- =============================================================================

create or replace function app.auth_device_is_known(
  p_user_id     uuid,
  p_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
     where s.user_id = p_user_id
       and s.device_fingerprint = p_fingerprint
  )
$$;

comment on function app.auth_device_is_known(uuid, text) is
  'FR-151: true when this account has signed in from this fingerprint before. Includes revoked and expired sessions deliberately — the question is "has this person used this device", not "is there a live session on it". Must be called BEFORE auth_create_session, which would otherwise be its own match.';

-- Sessions are already indexed by (user_id, last_seen_at) for the live-session
-- list, which does not serve this lookup. Small table, but this runs on every
-- sign-in and the answer gates an email.
create index if not exists sessions_user_device_idx
  on public.sessions (user_id, device_fingerprint);

revoke execute on function app.auth_device_is_known(uuid, text) from public;
grant  execute on function app.auth_device_is_known(uuid, text) to cni_app;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'auth_device_is_known'
  ) then
    raise exception 'Migration 015 incomplete';
  end if;
  raise notice 'Migration 015 OK — auth_device_is_known';
end
$$;
