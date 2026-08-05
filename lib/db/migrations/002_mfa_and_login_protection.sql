-- ============================================================================
-- CNI CRM — MIGRATION 002 · MFA, RECOVERY CODES, LOGIN PROTECTION, BREAK-GLASS
-- ----------------------------------------------------------------------------
-- Creates:  mfa_factors · recovery_codes · login_attempts · break_glass
--
-- Specification:  docs/04-DATA-MODEL.md §2b
--                 docs/16-SECURITY-AND-IDENTITY.md §4 (MFA, login protection),
--                                                  §6 (SA-9, break-glass)
--                 docs/20-IMPLEMENTATION-CONTRACTS.md §9 step 2.3
--
-- ⛔ Never edit an applied migration (doc 20 §7).
-- ============================================================================


create type public.mfa_type as enum ('totp', 'webauthn', 'recovery_codes');

create type public.login_outcome as enum (
  'success',
  'bad_password',
  'bad_mfa',
  'locked',
  'unknown_account'
);


-- ----------------------------------------------------------------------------
-- 1 · mfa_factors
-- ----------------------------------------------------------------------------
-- doc 04 §2b, doc 16 §4. Mandatory for Super Admin and Admin (FR-145);
-- the Super Admin's cannot be removed by anyone, including himself (FR-146) —
-- enforced by a trigger in migration 005, because a permission check in
-- application code is exactly the thing FR-146 says must not be the only guard.
--
-- Passkeys are preferred for the Super Admin over TOTP for one specific
-- reason: a TOTP code can be relayed by a convincing fake login page in real
-- time, and a WebAuthn credential is bound to the real domain and physically
-- cannot be. That closes threat T-2, which nothing else does. doc 16 §4.

create table public.mfa_factors (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,

  type               public.mfa_type not null,

  -- TOTP seed, encrypted at rest. Never returned to any client after
  -- enrolment: the QR code is rendered once, server-side, and then the secret
  -- exists only to verify codes.
  secret_encrypted   text,

  -- WebAuthn / passkey.
  credential_id      text,
  public_key         text,
  -- The authenticator's signature counter. Must increase on every use; a
  -- counter that goes backwards means the credential was cloned.
  sign_count         bigint not null default 0,

  friendly_name      text not null,
  is_primary         boolean not null default false,

  -- Not active until proven. An enrolment that was never verified is a
  -- half-configured factor, and treating it as real locks people out.
  verified_at        timestamptz,
  last_used_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint mfa_factors_friendly_name_present
    check (length(btrim(friendly_name)) between 1 and 80),

  constraint mfa_factors_shape check (
    case type
      when 'totp'     then secret_encrypted is not null
                           and credential_id is null and public_key is null
      when 'webauthn' then credential_id is not null and public_key is not null
                           and secret_encrypted is null
      else true
    end
  ),

  constraint mfa_factors_sign_count_non_negative
    check (sign_count >= 0)
);

-- A WebAuthn credential id is globally unique.
create unique index mfa_factors_credential_id_key
  on public.mfa_factors (credential_id)
  where credential_id is not null;

-- One headline factor per person: the one offered first at sign-in.
create unique index mfa_factors_one_primary_per_user_idx
  on public.mfa_factors (user_id)
  where is_primary;

create index mfa_factors_user_idx
  on public.mfa_factors (user_id)
  where verified_at is not null;

create trigger mfa_factors_touch_updated_at
  before update on public.mfa_factors
  for each row execute function app.touch_updated_at();

comment on table public.mfa_factors is
  'doc 16 §4. TOTP and WebAuthn factors. Mandatory for super_admin and admin (FR-145); '
  'the super_admin''s cannot be removed by anyone (FR-146, enforced in migration 005).';
comment on column public.mfa_factors.sign_count is
  'WebAuthn replay protection. A counter that fails to increase indicates a cloned authenticator.';


-- ----------------------------------------------------------------------------
-- 2 · recovery_codes
-- ----------------------------------------------------------------------------
-- SA-9. Ten per person, issued once, shown once, single use, hash-stored.
-- These exist for the case email recovery cannot cover: the mailbox itself is
-- lost or compromised (doc 16 §6, "If the email itself is unreachable").
-- Printed and kept off the device they protect.

create table public.recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,

  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint recovery_codes_is_sha256
    check (code_hash ~ '^[0-9a-f]{64}$')
);

-- The same code cannot be issued twice to one person, and lookup on
-- redemption is a single index hit.
create unique index recovery_codes_user_code_key
  on public.recovery_codes (user_id, code_hash);

create index recovery_codes_unused_idx
  on public.recovery_codes (user_id)
  where used_at is null;

comment on table public.recovery_codes is
  'SA-9. Ten single-use codes per user, hash-stored, shown exactly once at generation.';


-- ----------------------------------------------------------------------------
-- 3 · login_attempts — APPEND-ONLY
-- ----------------------------------------------------------------------------
-- doc 04 §2b. Feeds three things: the per-account 3-attempt lockout
-- (FR-155a), per-IP rate limiting (FR-148), and anomaly detection
-- (FR-152 — new device, new country, impossible travel).
--
-- The failed-attempt count lives HERE and is derived, not stored on `users`.
-- A counter column can be reset by any code path that touches the row; an
-- append-only ledger cannot. The count that matters is "failures since the
-- last success", which this table can answer and a counter cannot.
--
-- Immutability (no UPDATE/DELETE for any role, including super_admin) is
-- applied in migration 003 alongside the other append-only tables.
--
-- `user_id` is nullable and carries no FK on purpose: an attempt against an
-- address that matches no account is exactly the event worth recording, and
-- the row must survive unchanged even if the account is later purged.

create table public.login_attempts (
  id               uuid primary key default gen_random_uuid(),

  email_attempted  text not null,
  user_id          uuid,

  ip_address       inet,
  ip_country       text,
  user_agent       text,

  outcome          public.login_outcome not null,
  created_at       timestamptz not null default now(),

  constraint login_attempts_email_lowercase
    check (email_attempted = lower(email_attempted))
);

-- "How many failures since this account last succeeded?" — the lockout query.
create index login_attempts_email_recent_idx
  on public.login_attempts (email_attempted, created_at desc);

-- "Is this IP cycling through accounts?" — the anti-DoS mitigation that makes
-- a 3-strike lock safe to ship (doc 16 §4).
create index login_attempts_ip_recent_idx
  on public.login_attempts (ip_address, created_at desc);

create index login_attempts_user_recent_idx
  on public.login_attempts (user_id, created_at desc)
  where user_id is not null;

comment on table public.login_attempts is
  'APPEND-ONLY (doc 19 §6). Drives the 3-attempt lockout (FR-155a), rate limiting '
  '(FR-148) and anomaly detection (FR-152). The failed-attempt count is derived from '
  'here and never stored on users.';
comment on column public.login_attempts.user_id is
  'No foreign key by design: attempts against non-existent accounts must be recorded, '
  'and the row must stay true after a purge.';


-- ----------------------------------------------------------------------------
-- 4 · break_glass — the sealed master credential
-- ----------------------------------------------------------------------------
-- doc 16 §6. The honest counterweight to "the Super Admin cannot be altered
-- by anyone": that rule, taken alone, means a lost phone plus a forgotten
-- password plus mislaid recovery codes equals the permanent loss of the CRM.
-- That is threat T-9, and it is rated Total loss for a reason.
--
-- Generated once at setup, displayed exactly once, stored only as a hash,
-- printed and kept physically. Using it alerts everyone and is permanently
-- logged (doc 16 §10). It should never be touched in normal operation.
--
-- doc 04 §5: "No client read path at all." Migration 005 enables RLS on this
-- table and grants it NO policies, so the application role can neither read
-- nor write it. Verification is server-side only, through the pre-auth
-- SECURITY DEFINER surface (registry C-15).

create table public.break_glass (
  id                uuid primary key default gen_random_uuid(),

  credential_hash   text not null,

  generated_at      timestamptz not null default now(),
  -- Who generated it. NULL when it was issued by the one-time setup route,
  -- before any account existed to attribute it to.
  generated_by_id   uuid references public.users (id) on delete set null,

  used_at           timestamptz,
  used_from_ip      inet,
  invalidated_at    timestamptz,

  notes             text,

  constraint break_glass_is_sha256
    check (credential_hash ~ '^[0-9a-f]{64}$'),

  -- A used credential must record where from — an unattributed use of the
  -- master credential is the one event that must never be untraceable.
  constraint break_glass_use_is_attributed
    check ((used_at is null) = (used_from_ip is null))
);

-- At most one live credential at a time. Two valid master credentials means
-- two ways in and half the accountability.
create unique index break_glass_single_live_idx
  on public.break_glass ((true))
  where used_at is null and invalidated_at is null;

comment on table public.break_glass is
  'doc 16 §6. Sealed master credential, hash-only, single-use, loudly logged. '
  'No client read path (doc 04 §5) — RLS-enabled with zero policies in migration 005.';
comment on index public.break_glass_single_live_idx is
  'At most one unused, un-invalidated credential may exist at any time.';
