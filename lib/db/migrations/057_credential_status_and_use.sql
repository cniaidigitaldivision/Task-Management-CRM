-- ============================================================================
-- 057 · A CREDENTIAL'S STATE, AND WHEN IT WAS LAST READ
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-25, supplying a Vault design: *"make sure that the functionality
-- and features are required. Implement each and every thing logically and please
-- make sure that you do not skip any feature."*
--
-- The design asks for four things this table could not answer:
--
--   an Active/Inactive pill on every row      → no status column existed
--   a Deactivate button                        → nothing to set
--   a "Compromised · 0 · All good" counter     → no such concept
--   a "Last used · 2d ago" column              → nothing recorded a read
--
-- ── ⚠️ ONE COLUMN FOR THREE OF THEM, NOT A BOOLEAN AND A FLAG ───────────────
-- `is_active boolean` plus `is_compromised boolean` would allow the state
-- (false, true) — deactivated AND compromised — which is not a state anybody
-- means, and every reader would then have to decide which flag wins. A credential
-- is in exactly one of three conditions, so it gets one column that says which.
--
--   active        in use, and the only state that should be handed out
--   inactive      deliberately retired. The secret is kept, because "we changed
--                 the password and this is what it used to be" is a real thing to
--                 need, and because deleting is a separate, audited act.
--   compromised   known or suspected leaked. Louder than inactive: this one is a
--                 warning to whoever is about to use it, not a tidy-up.
--
-- ⚠️ `compromised` is NOT a synonym for expired. `expires_at` says a secret will
-- stop working; this says it must stop being used even though it still does. The
-- first is housekeeping, the second is an incident, and collapsing them would hide
-- the incident inside a list of chores.
--
-- ── ⚠️ WHY `last_used_at` IS A COLUMN AND NOT A QUERY ───────────────────────
-- Every reveal already writes to `security_events`, so "when was this last read"
-- is derivable — and deriving it means a correlated subquery over an
-- ever-growing event table for every row of every Vault page load, for a column
-- somebody glances at. One stamp on reveal costs a single UPDATE on an act that is
-- already writing two rows.
--
-- ⚠️ It is NOT the audit trail. `security_events` remains the record of who read
-- what and when, and that is the row nobody may overwrite. This column is a cache
-- of the latest timestamp for display, and it deliberately does not say WHO —
-- putting a name here would invite somebody to treat it as the trail.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'credential_status') then
    create type public.credential_status as enum ('active', 'inactive', 'compromised');
  end if;
end $$;

alter table public.credentials
  -- Existing rows are active: they were created to be used and nothing has said
  -- otherwise. A nullable column would make "unknown" a fourth state for no gain.
  add column if not exists status public.credential_status not null default 'active',
  add column if not exists last_used_at timestamptz;

comment on column public.credentials.status is
  'active | inactive | compromised. ONE column rather than two booleans, because a '
  'credential is in exactly one of these conditions and (deactivated AND '
  'compromised) is not a state anybody means. compromised is an incident, not an '
  'expiry — expires_at says a secret will stop working, this says it must stop '
  'being used while it still does.';

comment on column public.credentials.last_used_at is
  'When the secret was last decrypted, stamped by revealCredentialAction. A CACHE '
  'for display only — security_events is the audit trail and is never overwritten. '
  'Deliberately records no actor, so nobody mistakes this for the trail.';

-- ── Backfill from the trail we already have ─────────────────────────────────
-- ⚠️ Every reveal so far is already in `security_events`, so the column starts
-- populated rather than empty. Without this, a vault that has been read for weeks
-- would show "never used" on every row and the new column would look broken on the
-- day it shipped.
do $$
declare
  stamped int;
begin
  update public.credentials c
     set last_used_at = e.at
    from (
      select (s.details ->> 'credentialId')::uuid as id, max(s.created_at) as at
        from public.security_events s
       where s.event_type = 'credential_revealed'
         and s.details ->> 'credentialId' is not null
       group by 1
    ) e
   where c.id = e.id;

  get diagnostics stamped = row_count;
  raise notice 'Stamped last_used_at on % credential(s) from security_events.', stamped;
end $$;

-- ⚠️ Indexed because the Vault sorts and filters on it. Only where it is set —
-- a credential nobody has read is not interesting to an ordering by recency, and
-- a partial index keeps it small on a table where most rows may never be read.
create index if not exists credentials_last_used_idx
  on public.credentials (last_used_at desc)
  where last_used_at is not null;

create index if not exists credentials_status_idx
  on public.credentials (status)
  where status <> 'active';
