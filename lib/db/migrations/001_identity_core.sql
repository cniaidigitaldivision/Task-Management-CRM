-- ============================================================================
-- CNI CRM — MIGRATION 001 · IDENTITY CORE
-- ----------------------------------------------------------------------------
-- Creates:  schema app · canonical enum types · users · auth_identities
--           invitations · sessions
--
-- Specification:  docs/04-DATA-MODEL.md §2, §2b   (tables and columns)
--                 docs/19-MASTER-SPECIFICATION-REGISTRY.md §4, §6, §9a
--                 docs/16-SECURITY-AND-IDENTITY.md §3, §4
--                 docs/20-IMPLEMENTATION-CONTRACTS.md §9 step 2.2
--
-- ⛔ APPLIED MIGRATIONS ARE HISTORY.  Never edit this file. Correct it with a
--    new numbered migration (doc 20 §7).
--
-- Authentication is OUR OWN, not Supabase Auth — registry C-13. There is no
-- reference to auth.users anywhere in this schema, by design.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · SCHEMA app — the identity contract and the enforcement machinery
-- ----------------------------------------------------------------------------
-- Nothing in `app` is a table. It holds the functions that let the database
-- answer "who is asking?" (registry C-14) and the triggers that enforce the
-- invariants doc 20 §5 refuses to leave to application code.

create schema if not exists app;

comment on schema app is
  'CNI CRM enforcement layer: identity resolution for RLS (registry C-14), '
  'invariant triggers, and the narrow pre-authentication SECURITY DEFINER '
  'surface (registry C-15). Contains no tables.';


-- ----------------------------------------------------------------------------
-- 2 · IDENTITY RESOLUTION  (registry C-14)
-- ----------------------------------------------------------------------------
-- We do not use Supabase Auth, so auth.uid() does not exist. Instead every
-- request opens a transaction and declares who it is acting as:
--
--     SET LOCAL ROLE cni_app;
--     SET LOCAL app.user_id = '<uuid>';
--
-- SET LOCAL is transaction-scoped, so identity cannot leak between pooled
-- connections. `cni_app` is NOBYPASSRLS (migration 005) so the policies bind.

create or replace function app.current_user_id()
  returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

comment on function app.current_user_id() is
  'The acting user for this transaction, or NULL when unset. NULL makes every '
  'RLS predicate false — the fail-closed default. Set with SET LOCAL app.user_id.';


-- Break-glass escape hatch. doc 16 §6.
--
-- Some invariants below are absolute: nobody, not even the Super Admin, may
-- delete a Super Admin row or rewrite the audit log. That is the point of them.
-- It also means a genuine disaster — a lost account, a legally compelled
-- erasure — would otherwise have no path at all, which is how "immutable"
-- turns into "unrecoverable".
--
-- The escape requires direct SQL access, which no application code path has.
-- Using it is loud: every trigger that honours it writes a `critical`
-- security_event first (migration 003 onwards).
create or replace function app.break_glass_active()
  returns boolean
  language sql
  stable
as $$
  select coalesce(current_setting('app.break_glass', true), '') = 'on'
$$;

comment on function app.break_glass_active() is
  'True only inside a transaction that has done SET LOCAL app.break_glass = ''on''. '
  'Requires direct database access; no application code path can set it. '
  'Every use is recorded as a critical security event. doc 16 §6.';


-- ----------------------------------------------------------------------------
-- 3 · SHARED TRIGGER HELPERS
-- ----------------------------------------------------------------------------

create or replace function app.touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE trigger: maintains updated_at in the database so a forgotten '
  'application assignment cannot silently produce a stale timestamp.';


-- ----------------------------------------------------------------------------
-- 4 · CANONICAL ENUM TYPES
-- ----------------------------------------------------------------------------
-- Every value here also appears in lib/domain/constants.ts, which is the code
-- source of truth (doc 19 §4). If the two ever disagree, one is a bug — the
-- registry decides which.

-- ROLE — four values. There is deliberately no `guest` (registry C-12) and
-- deliberately no in-app path that creates `super_admin` (BR-028, enforced by
-- the partial unique index in §5).
create type public.user_role as enum (
  'super_admin',
  'admin',
  'team_coordinator',
  'member'
);

create type public.account_state as enum (
  'pending_activation',
  'active',
  'password_reset_required',
  'mfa_setup_required',
  'locked',
  'suspended',
  'deactivated'
);

create type public.theme_preference as enum ('light', 'dark', 'system');

create type public.auth_provider as enum ('password', 'google', 'microsoft');

-- `account_unlock` is an addition to doc 04 §2b — registry C-17. An unlock
-- restores access without changing the password, so it is not a reset.
create type public.invitation_purpose as enum (
  'activation',
  'password_reset',
  'account_unlock',
  'email_change'
);


-- ----------------------------------------------------------------------------
-- 5 · users — the whole team, one row per person, whatever their role
-- ----------------------------------------------------------------------------
-- doc 04 §2. No organisation_id: single-tenant, ADR-008.

create table public.users (
  id                      uuid primary key default gen_random_uuid(),

  full_name               text not null,
  -- Stored lowercase and enforced lowercase. Two rows differing only in case
  -- would be two identities for one human being, each with its own password
  -- and its own lockout counter.
  email                   text not null,
  avatar_url              text,

  role                    public.user_role    not null default 'member',
  role_title              text,
  account_state           public.account_state not null default 'pending_activation',

  -- 36, not 48. Attendance hours are not productive hours — ADR-004.
  weekly_capacity_points  integer not null default 36,
  max_concurrent_tasks    integer not null default 5,

  timezone                text not null default 'Asia/Karachi',
  theme                   public.theme_preference not null default 'system',

  -- Deactivation, never deletion. BR-007.
  is_active               boolean not null default true,

  phone                   text,
  notification_prefs      jsonb not null default '{}'::jsonb,

  -- WHEN the lock happened, so it can auto-clear after 30 minutes
  -- (SYSTEM_DEFAULTS.accountLockAutoClearMinutes). Registry §9a.
  -- The failed-attempt COUNT is deliberately not stored — it is derived from
  -- login_attempts, which is append-only and therefore cannot be quietly reset.
  locked_at               timestamptz,
  last_login_at           timestamptz,

  -- The provisioning chain (FR-141) is only auditable if each account records
  -- who created it. NULL for the Super Admin, who is created by the one-time
  -- setup route and by definition has no creator.
  created_by_id           uuid references public.users (id) on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint users_full_name_present
    check (length(btrim(full_name)) between 1 and 120),

  constraint users_email_lowercase
    check (email = lower(email)),

  constraint users_email_shaped
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),

  constraint users_capacity_sane
    check (weekly_capacity_points > 0 and weekly_capacity_points <= 200),

  constraint users_concurrent_sane
    check (max_concurrent_tasks > 0 and max_concurrent_tasks <= 50),

  -- A locked account must say when it was locked, or it can never auto-clear.
  constraint users_locked_at_matches_state
    check ((account_state = 'locked') = (locked_at is not null)),

  constraint users_not_own_creator
    check (created_by_id is distinct from id)
);

create unique index users_email_key
  on public.users (email);

-- BR-028 · "No in-app path creates a Super Admin."
-- A unique index on a constant expression, restricted to super_admin rows,
-- permits exactly one such row to exist — ever. This is structural: it holds
-- against application bugs, against a mistaken migration, and against direct
-- SQL. doc 16 §6's sealed procedure for a second Super Admin is, concretely,
-- a reviewed migration that drops this index.
create unique index users_single_super_admin_idx
  on public.users ((true))
  where role = 'super_admin';

create index users_role_idx          on public.users (role) where is_active;
create index users_account_state_idx on public.users (account_state);
create index users_created_by_idx    on public.users (created_by_id);

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function app.touch_updated_at();

comment on table  public.users is 'doc 04 §2. Every person, every role, one row each.';
comment on index  public.users_single_super_admin_idx is
  'BR-028: at most one super_admin row can exist. Lifting this is a reviewed migration (doc 16 §6).';
comment on column public.users.locked_at is
  'When FR-155a locked the account. Enables the 30-minute auto-clear. The attempt COUNT is derived from login_attempts, never stored.';
comment on column public.users.weekly_capacity_points is
  'Effective capacity, default 36 = 75% of 48 nominal hours. ADR-004 / registry C-02, C-10.';


-- ----------------------------------------------------------------------------
-- 6 · auth_identities — one user, one or more ways to prove they are them
-- ----------------------------------------------------------------------------
-- doc 04 §2b. Exists from Phase 1 precisely so Google Sign-In (Phase 7a,
-- FR-160/FR-161) needs no migration: it inserts a row, it does not alter a
-- table. Google authenticates an account that already exists; it never
-- creates one, or the provisioning chain in doc 16 §3 is bypassed.

create table public.auth_identities (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.users (id) on delete cascade,

  provider                 public.auth_provider not null,
  -- The provider's stable subject (`sub`). NULL for password identities.
  provider_subject         text,

  -- Argon2id. FR-147. Never selected into any response, never logged, never
  -- placed in an error message. The application layer owns that discipline —
  -- see lib/db/README.md, "What the database cannot enforce".
  password_hash            text,

  -- doc 16 §3 Option B: a temporary password shown once on screen to the
  -- creating Admin, relayed out of band, never emailed. FR-144.
  is_temporary_password    boolean not null default false,
  temporary_expires_at     timestamptz,

  last_password_change_at  timestamptz,
  -- Last 5 hashes. FR-147 blocks reuse; NIST SP 800-63B removed forced
  -- rotation, so this list only ever grows on a deliberate change.
  password_history         text[] not null default '{}',

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- One password identity per person, one Google identity per person.
  constraint auth_identities_one_per_provider unique (user_id, provider),

  constraint auth_identities_password_shape check (
    case provider
      when 'password' then password_hash is not null and provider_subject is null
      else provider_subject is not null and password_hash is null
    end
  ),

  constraint auth_identities_temporary_shape check (
    (is_temporary_password = false and temporary_expires_at is null)
    or (is_temporary_password = true and temporary_expires_at is not null)
  ),

  constraint auth_identities_history_bounded
    check (coalesce(array_length(password_history, 1), 0) <= 5)
);

-- Federated subjects are globally unique. Partial, because password identities
-- all have a NULL subject.
create unique index auth_identities_provider_subject_key
  on public.auth_identities (provider, provider_subject)
  where provider_subject is not null;

create index auth_identities_user_idx on public.auth_identities (user_id);

create trigger auth_identities_touch_updated_at
  before update on public.auth_identities
  for each row execute function app.touch_updated_at();

comment on table public.auth_identities is
  'doc 04 §2b. Password today, SSO later with no migration (FR-161).';


-- ----------------------------------------------------------------------------
-- 7 · invitations — activation, reset and unlock tokens
-- ----------------------------------------------------------------------------
-- doc 16 §3 and §6. THE RAW TOKEN IS NEVER STORED. Only its SHA-256 hash is,
-- and the check constraint below makes that a property of the database rather
-- than a promise in a code review: a 64-character lowercase hex string cannot
-- accidentally be a token, a URL, or a six-digit code.

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,

  token_hash      text not null,
  purpose         public.invitation_purpose not null,

  -- Who provisioned the account. NULL for a self-service password reset,
  -- which nobody provisioned.
  created_by_id   uuid references public.users (id) on delete set null,

  -- The address it was actually sent to, recorded separately from
  -- users.email so a later address change cannot rewrite history.
  sent_to_email   text not null,

  expires_at      timestamptz not null,
  consumed_at     timestamptz,

  -- FR-155: at most 5 code entry attempts, then the code is burned.
  attempt_count   integer not null default 0,
  -- Requesting a new code invalidates the previous one. FR-155.
  invalidated_at  timestamptz,

  created_at      timestamptz not null default now(),

  constraint invitations_token_is_sha256
    check (token_hash ~ '^[0-9a-f]{64}$'),

  constraint invitations_expiry_after_creation
    check (expires_at > created_at),

  constraint invitations_attempts_bounded
    check (attempt_count between 0 and 5),

  constraint invitations_email_lowercase
    check (sent_to_email = lower(sent_to_email))
);

create unique index invitations_token_hash_key
  on public.invitations (token_hash);

-- The hot path: "is there a live token of this purpose for this user?"
create index invitations_live_idx
  on public.invitations (user_id, purpose)
  where consumed_at is null and invalidated_at is null;

comment on table public.invitations is
  'Activation (FR-142), password reset (FR-155), account unlock (FR-155a, registry C-17) '
  'and email-change tokens. Single use, hash-stored, expiring.';
comment on constraint invitations_token_is_sha256 on public.invitations is
  'Makes "the raw token is never stored" a database invariant. Only 64-char lowercase hex is accepted.';


-- ----------------------------------------------------------------------------
-- 8 · sessions — device-bound, role-scoped, rotating
-- ----------------------------------------------------------------------------
-- doc 04 §2b and doc 16 §4. Lifetimes are role-scoped, so the Super Admin's
-- exposure window is 8h/12h while a Member's is 7d/30d
-- (SYSTEM_DEFAULTS.refreshTtl*). The application sets them; the database
-- records them and refuses the incoherent combinations.

create table public.sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users (id) on delete cascade,

  refresh_token_hash    text not null,

  -- FR-150: a stolen cookie replayed from another machine does not match and
  -- is therefore not a session.
  device_fingerprint    text not null,
  user_agent            text,
  ip_address            inet,
  -- A change in either forces re-authentication. Zero trust: verify on context
  -- change, don't trust the session. doc 16 §4, NIST SP 800-207.
  ip_country            text,
  ip_asn                text,

  created_at            timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  -- Sliding: extended on refresh, up to absolute_expires_at.
  expires_at            timestamptz not null,
  -- Hard cap. No session is infinite.
  absolute_expires_at   timestamptz not null,

  revoked_at            timestamptz,
  revoked_reason        text,

  -- Recent password + MFA re-entry, for 🔒 actions. FR-149.
  step_up_verified_at   timestamptz,

  -- FR-150 requires rotation WITH reuse detection. Detection needs the chain:
  -- if a token that was already rotated away is presented again, it was
  -- copied, and every session on the account must die.
  rotated_from_id       uuid references public.sessions (id) on delete set null,
  reuse_detected_at     timestamptz,

  constraint sessions_token_is_sha256
    check (refresh_token_hash ~ '^[0-9a-f]{64}$'),

  constraint sessions_fingerprint_present
    check (length(btrim(device_fingerprint)) > 0),

  constraint sessions_absolute_cap_after_sliding
    check (absolute_expires_at >= expires_at),

  constraint sessions_revocation_has_reason
    check ((revoked_at is null) = (revoked_reason is null))
);

create unique index sessions_refresh_token_hash_key
  on public.sessions (refresh_token_hash);

-- "This user's live sessions" — the session list (FR-154) and the
-- revoke-everything paths (FR-155c).
create index sessions_live_idx
  on public.sessions (user_id, last_seen_at desc)
  where revoked_at is null;

create index sessions_rotated_from_idx on public.sessions (rotated_from_id);

comment on table public.sessions is
  'doc 16 §4. Device-bound, role-scoped TTL, rotating refresh tokens with reuse detection (FR-150).';
comment on column public.sessions.reuse_detected_at is
  'Set when an already-rotated token is presented again. That is evidence of theft: revoke every session on the account.';
