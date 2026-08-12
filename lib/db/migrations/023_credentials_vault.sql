-- =============================================================================
-- 023 · THE CREDENTIALS VAULT
-- =============================================================================
-- Owner request, 2026-08-12: *"let the superadmin see all credentials for every
-- member and project credentials if held, client credentials and other
-- credentials which can be added here."*
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
-- It is **not** a way to see anybody's CRM password. Those are Argon2id digests
-- in `user_credentials.password_hash` and cannot be reversed by anyone, this
-- table included. That was explained to the owner and is unchanged: a password
-- is never shown to anybody, which is the reason the provisioning chain has no
-- "set their password for them" path at all.
--
-- This holds the logins the division holds ON BEHALF OF clients and projects —
-- a client's portal, a hosting account, an ad manager, an API key.
--
-- ── ⚠️ THIS TABLE CHANGES THE THREAT MODEL, DELIBERATELY ─────────────────────
-- Every other secret in this database is either a one-way digest (passwords,
-- tokens) or readable only by the account it belongs to (TOTP seeds). This one is
-- **recoverable plaintext to whoever may read the row**, because a credential you
-- cannot read is not a credential.
--
-- So the value of this table is bounded by three things, and all three are
-- load-bearing rather than decoration:
--
--   1. ENCRYPTED AT REST with the same AES-256-GCM box that protects TOTP seeds
--      (lib/auth/secret-box.ts). Database access alone yields ciphertext.
--   2. ROW-LEVEL SECURITY decides who may read a row at all — see below.
--   3. EVERY REVEAL IS AUDITED as a security event. Reading a credential is a
--      privileged act, not a page view, and the trail is what makes the vault
--      answerable afterwards.
--
-- ── VISIBILITY: OWNER-BASED, WHICH THE OWNER CHOSE WITH THE TRADE STATED ─────
-- Presented as one of three options alongside "Super Admin only" and
-- "Super Admin + Admin", with the note that this one has the widest exposure —
-- a compromised Coordinator account reaches their clients' logins. The owner
-- chose it for practicality. Recorded here because a future reader should know
-- it was a decision and not an oversight.
--
--   super_admin, admin      every credential
--   team_coordinator        credentials for projects they OWN, plus any issued
--                           to them personally
--   member                  only credentials issued to them personally
--
-- "Issued to them" is readable by that person on purpose: they already hold the
-- login, so hiding it from them protects nothing and makes the record useless as
-- the thing you check when they leave.
--
-- ── WHY `secret_encrypted` IS NOT NULL BUT MAY BE EMPTY ──────────────────────
-- Some entries are genuinely "an account exists here and these people can reach
-- it" with the password living in a real password manager. An empty string is a
-- deliberate "not recorded", distinct from a NULL that would read as "unknown".
-- =============================================================================

create table if not exists public.credentials (
  id                uuid primary key default gen_random_uuid(),

  -- What it is, in the words of whoever filed it.
  label             text not null,
  -- Free text rather than an enum: the owner's list ("client credentials and
  -- other credentials which can be added here") is open-ended by description,
  -- and an enum would need a migration every time a new kind of account turns up.
  kind              text not null default 'other',

  -- Where it is used. Both optional and independent: a credential can belong to
  -- a project, to a person, to both, or to neither (a division-wide account).
  project_id        uuid references public.projects (id) on delete set null,
  -- `set null`, not cascade: deleting a project must not silently destroy the
  -- record of a live third-party account somebody still has to go and revoke.
  issued_to_id      uuid references public.users (id) on delete set null,

  -- The credential itself.
  username          text,
  secret_encrypted  text not null default '',
  url               text,
  notes             text,

  -- Rotation. `expires_at` is a date rather than a timestamp because "this key
  -- expires on the 14th" is how anybody states it.
  expires_at        date,
  last_rotated_at   timestamptz,

  created_by_id     uuid not null references public.users (id) on delete restrict,
  updated_by_id     uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint credentials_label_present
    check (length(btrim(label)) > 0),

  -- A stored secret must be either empty or a v1 secret-box payload. This makes
  -- "the secret is encrypted" an invariant of the TABLE rather than a habit of
  -- the code that writes it — the same reasoning as
  -- `invitations_token_is_sha256`. A plaintext password can no longer be written
  -- here by accident, by a migration, or from a SQL console.
  constraint credentials_secret_is_sealed
    check (secret_encrypted = '' or secret_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  constraint credentials_url_shape
    check (url is null or url ~* '^https?://')
);

create index if not exists credentials_project_idx   on public.credentials (project_id);
create index if not exists credentials_issued_to_idx on public.credentials (issued_to_id);
-- The "what needs rotating" query, which is the only one with a date predicate.
create index if not exists credentials_expiry_idx
  on public.credentials (expires_at)
  where expires_at is not null;

comment on table public.credentials is
  'Third-party logins the division holds for clients and projects. NOT user account passwords — '
  'those are one-way Argon2id digests and are not readable by anybody. Secrets here are '
  'AES-256-GCM sealed (lib/auth/secret-box.ts) and every reveal writes a security event.';
comment on column public.credentials.secret_encrypted is
  'v1 secret-box payload, or an empty string meaning "not recorded here". A check constraint '
  'refuses anything else, so plaintext cannot be stored even by mistake.';
comment on column public.credentials.issued_to_id is
  'The person this login was given to. Readable by them — they already hold it — and the reason '
  'the vault is useful at offboarding: it answers "what does this person still have access to".';


-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table public.credentials enable row level security;

-- Who may SEE a row. The three-way rule from the header, expressed once.
create or replace function app.can_read_credential(
  p_project_id   uuid,
  p_issued_to_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    -- Admin and above: everything.
    app.acting_at_least('admin'::public.user_role)
    -- Issued to me: I already hold it.
    or (p_issued_to_id is not null and p_issued_to_id = app.current_user_id())
    -- I own the project it belongs to.
    or (
      p_project_id is not null
      and exists (
        select 1 from public.projects p
         where p.id = p_project_id
           and p.owner_id = app.current_user_id()
      )
    );
$$;

comment on function app.can_read_credential(uuid, uuid) is
  'Owner-based visibility, chosen by the owner 2026-08-12 over Super-Admin-only. Admin+ sees all; '
  'a project owner sees their project''s; a person sees what was issued to them.';

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'credentials_select') then
    create policy credentials_select on public.credentials
      for select to cni_app
      using (app.can_read_credential(project_id, issued_to_id));
  end if;

  -- Writing is Admin and above, and a project owner for their own project. A
  -- Member may never create one: a credential nobody senior knows about is the
  -- opposite of what a vault is for.
  if not exists (select 1 from pg_policy where polname = 'credentials_insert') then
    create policy credentials_insert on public.credentials
      for insert to cni_app
      with check (
        app.acting_at_least('admin'::public.user_role)
        or (
          project_id is not null
          and exists (
            select 1 from public.projects p
             where p.id = project_id and p.owner_id = app.current_user_id()
          )
        )
      );
  end if;

  if not exists (select 1 from pg_policy where polname = 'credentials_update') then
    create policy credentials_update on public.credentials
      for update to cni_app
      using (
        app.acting_at_least('admin'::public.user_role)
        or (
          project_id is not null
          and exists (
            select 1 from public.projects p
             where p.id = project_id and p.owner_id = app.current_user_id()
          )
        )
      );
  end if;

  -- Deleting is Admin and above only. A Coordinator can change a credential on
  -- their project but cannot make the record of it disappear — losing the record
  -- of an account nobody has revoked is worse than an out-of-date entry.
  if not exists (select 1 from pg_policy where polname = 'credentials_delete') then
    create policy credentials_delete on public.credentials
      for delete to cni_app
      using (app.acting_at_least('admin'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.credentials to cni_app;


-- ----------------------------------------------------------------------------
-- `updated_at`, and a record of who touched it
-- ----------------------------------------------------------------------------

create or replace function app.credentials_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  new.updated_by_id := coalesce(app.current_user_id(), new.updated_by_id);

  -- Rotation is inferred rather than asked for: if the secret changed, it was
  -- rotated. Asking somebody to also tick "I rotated this" produces a field that
  -- is wrong whenever they forget.
  if new.secret_encrypted is distinct from old.secret_encrypted
     and new.secret_encrypted <> '' then
    new.last_rotated_at := now();
  end if;

  return new;
end
$$;

drop trigger if exists credentials_touch on public.credentials;
create trigger credentials_touch
  before update on public.credentials
  for each row execute function app.credentials_touch();
