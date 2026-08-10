-- =============================================================================
-- 022 · A STATUS TRAIL FOR A FORCED PASSWORD RESET
-- =============================================================================
-- CHANGE-PLAN 4.1 — owner: *"give me the status for the Super Admin."*
-- Sent → delivered → opened → completed, with the expiry, plus Resend and
-- Revoke link.
--
-- ── WHAT `invitations` ALREADY ANSWERS ────────────────────────────────────────
-- Four of the six states are already in the table and need nothing:
--
--     sent        created_at
--     expires     expires_at
--     completed   consumed_at
--     revoked     invalidated_at
--
-- This migration adds only the two it cannot answer, and it is deliberately
-- honest about what each one can actually mean.
--
-- ── "DELIVERED" IS RECORDED AS WHAT WE ACTUALLY KNOW ─────────────────────────
-- We know what the mail provider said when asked to send. We do NOT know that
-- it reached a mailbox — that needs Resend to call us back on a webhook, which
-- is a separate endpoint and is worth nothing until a sending domain exists.
--
-- So the column is `email_state`, not `delivered_at`, and its values say only
-- what was observed:
--
--     accepted         Resend took it and returned an id
--     refused          Resend answered with an error (the reason is kept)
--     unreachable      the request failed or timed out
--     not_configured   RESEND_API_KEY is unset — nothing was attempted
--
-- ⚠️ `accepted` IS NOT `delivered`. While `EMAIL_FROM` is still the sandbox
-- sender, Resend accepts mail for any recipient with a 200 and **silently drops
-- everything except the address that owns the Resend account** (see
-- lib/email/send.ts). That is why `email_sandbox` is stored per row rather than
-- read from the environment when the screen renders: the environment can change
-- afterwards, and a trail that retroactively claims a dropped message was fine
-- is worse than no trail. The interface must read these two together and say
-- "accepted by Resend, but not delivered — no verified sending domain".
--
-- ── "OPENED" IS THE LINK BEING OPENED, NOT THE EMAIL BEING READ ──────────────
-- Email opens need a tracking pixel, and most clients block images by default,
-- so a missing open would mean nothing and a present one is a guess. The plan
-- already ruled that out.
--
-- `link_opened_at` is a stronger fact: the reset page was loaded with a live
-- code. Recorded server-side, no pixel, nothing to block.
--
-- ── WHY A SEPARATE `trail_ref` IS NEEDED FOR THAT ────────────────────────────
-- Found while reading the existing flow, and it is the reason this column
-- exists. The token hash is scoped: `hashScopedCode(purpose, email, code)`. On
-- `/reset-password?code=…` the email has not been typed yet, so the row CANNOT
-- be found from the URL — there is no way to record an open without something
-- else to look it up by.
--
-- `trail_ref` is that lookup key, and it is safe to put in a link because it
-- grants nothing: it is a random value that identifies a row for the sole
-- purpose of stamping `link_opened_at`. The six-digit code remains the only
-- secret, still stored only as a hash, still the only thing that can reset a
-- password. The worst a leaked `trail_ref` achieves is a false "opened".
--
-- It is nullable because every token issued before this migration has none, and
-- self-service resets do not need one — nobody is watching those.
-- =============================================================================

alter table public.invitations
  add column if not exists email_state       text,
  add column if not exists email_detail      text,
  add column if not exists email_sandbox     boolean,
  add column if not exists email_attempted_at timestamptz,
  add column if not exists link_opened_at    timestamptz,
  add column if not exists trail_ref         text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_email_state_known'
  ) then
    alter table public.invitations
      add constraint invitations_email_state_known
      check (email_state is null or email_state in
             ('accepted', 'refused', 'unreachable', 'not_configured'));
  end if;

  -- A state without the moment it was observed is half a record, and so is the
  -- reverse. They are written together or not at all.
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_email_state_has_time'
  ) then
    alter table public.invitations
      add constraint invitations_email_state_has_time
      check ((email_state is null) = (email_attempted_at is null));
  end if;

  -- Same shape as the token hash constraint: make "this is a random value, not
  -- something guessable" an invariant of the table rather than a habit of the
  -- code that writes it.
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_trail_ref_shape'
  ) then
    alter table public.invitations
      add constraint invitations_trail_ref_shape
      check (trail_ref is null or trail_ref ~ '^[A-Za-z0-9_-]{22,64}$');
  end if;
end
$$;

-- Two rows must never share a lookup key, or an open would be stamped on the
-- wrong reset. Partial, because NULL is the normal case for everything else.
create unique index if not exists invitations_trail_ref_key
  on public.invitations (trail_ref)
  where trail_ref is not null;

comment on column public.invitations.email_state is
  'What the mail provider said when asked to send: accepted | refused | unreachable | not_configured. '
  'NOT proof of delivery — accepted only means Resend took it. Read with email_sandbox.';
comment on column public.invitations.email_sandbox is
  'True if the sandbox sender was in use, when this was sent. Stored per row because the environment '
  'can change later and a trail must not retroactively claim a dropped message arrived.';
comment on column public.invitations.link_opened_at is
  'When the reset page was loaded with this live code. A server-side fact, not a tracking pixel.';
comment on column public.invitations.trail_ref is
  'Opaque, non-secret lookup key carried in the emailed link so an open can be recorded. The token '
  'hash is scoped by email, which is not known from the URL, so this is the only way. Grants nothing.';


-- ----------------------------------------------------------------------------
-- WRITE PATHS
-- ----------------------------------------------------------------------------
-- Every pre-auth write to `invitations` goes through an `app.auth_*` SECURITY
-- DEFINER function (migrations 007, 010, 014) because the caller has no user id
-- to satisfy row-level security with. These three follow that existing rule
-- rather than inventing a second way in.
-- ----------------------------------------------------------------------------

-- Records the send outcome against the token that was just issued.
create or replace function app.auth_record_token_delivery(
  p_token_hash text,
  p_state      text,
  p_detail     text,
  p_sandbox    boolean
) returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.invitations
     set email_state        = p_state,
         email_detail       = left(coalesce(p_detail, ''), 500),
         email_sandbox      = p_sandbox,
         email_attempted_at = now()
   where token_hash = p_token_hash;
$$;

comment on function app.auth_record_token_delivery(text, text, text, boolean) is
  'Stores what the mail provider said about one token email. Called straight after sendEmail().';

-- Stamps the first open only. A person who opens the link four times has not
-- done anything four times, and overwriting would lose when they first saw it.
create or replace function app.auth_mark_link_opened(p_trail_ref text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  hit boolean;
begin
  update public.invitations
     set link_opened_at = now()
   where trail_ref      = p_trail_ref
     and link_opened_at is null
     and consumed_at    is null
     and invalidated_at is null
     and expires_at     > now();
  hit := found;
  return hit;
end
$$;

comment on function app.auth_mark_link_opened(text) is
  'Records the first load of the reset page for this trail_ref. Ignores a dead, used or revoked token.';

-- Revoke link. `invalidated_at` is what the consume path already treats as
-- dead (migration 007), so revoking needs no new concept — only a way to say it
-- deliberately, and it must not resurrect an already-finished reset.
create or replace function app.auth_revoke_token(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  hit boolean;
begin
  update public.invitations
     set invalidated_at = now()
   where id             = p_id
     and invalidated_at is null
     and consumed_at    is null;
  hit := found;
  return hit;
end
$$;

comment on function app.auth_revoke_token(uuid) is
  'Kills a live token on purpose (CHANGE-PLAN 4.1 "Revoke link"). Leaves a consumed one alone.';

revoke all on function app.auth_record_token_delivery(text, text, text, boolean) from public;
revoke all on function app.auth_mark_link_opened(text) from public;
revoke all on function app.auth_revoke_token(uuid) from public;
grant execute on function app.auth_record_token_delivery(text, text, text, boolean) to cni_app;
grant execute on function app.auth_mark_link_opened(text) to cni_app;
grant execute on function app.auth_revoke_token(uuid) to cni_app;
