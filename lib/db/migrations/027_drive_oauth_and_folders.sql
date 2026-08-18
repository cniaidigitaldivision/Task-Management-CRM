-- =============================================================================
-- 027 · GOOGLE DRIVE — OAUTH CONNECTION, FOLDER REGISTRY, PER-FOLDER VISIBILITY
-- =============================================================================
-- Owner, 2026-08-16: connect Drive using cniaidigitaldivision@gmail.com; senior
-- roles see every document and can make folders visible to members; members
-- upload into folders they can see.
--
-- ── WHY OAUTH AND NOT THE SERVICE ACCOUNT ALREADY BUILT ──────────────────────
-- `lib/drive/client.ts` authenticates as a SERVICE ACCOUNT, and that cannot work
-- for this owner. A service account has no Drive storage of its own, so a file it
-- uploads is owned by it and Google refuses with "Service Accounts do not have
-- storage quota". The two standard escapes — a Shared Drive, or domain-wide
-- delegation — both require Google Workspace, and
-- `cniaidigitaldivision@gmail.com` is a consumer account.
--
-- Reading folders would have worked. Approving a document INTO Drive — the
-- entire point of the feature — would have failed. So the CRM acts AS the owner's
-- account instead: files are owned by them, land in their My Drive, and no quota
-- question arises.
--
-- ⛔ THAT MAKES THE REFRESH TOKEN THE MOST DANGEROUS SECRET IN THIS DATABASE.
--    It grants ongoing access to a real person's Google Drive. It is stored
--    sealed with the same AES-256-GCM box as the credentials vault, it has NO
--    client read path at all, and the check constraint below makes "the token is
--    encrypted" a property of the table rather than a habit of the code.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · THE CONNECTION — one row, ever
-- -----------------------------------------------------------------------------
create table if not exists public.drive_connection (
  id                       integer primary key default 1,

  /* Which Google account the CRM is acting as. Shown on screen so nobody has to
     guess whose Drive the documents are landing in. */
  account_email            text,

  /* v1 secret-box payload. NEVER selected by anything with a client path — see
     the RLS section, which grants none. */
  refresh_token_encrypted  text,

  connected_by_id          uuid references public.users (id) on delete set null,
  connected_at             timestamptz,
  /* The last failure from Google, so "why is Drive not working" has an answer on
     screen instead of in a log. A revoked token is the common one. */
  last_error               text,
  last_error_at            timestamptz,

  constraint drive_connection_is_singleton check (id = 1),

  /* The same shape rule as `credentials_secret_is_sealed`. A plaintext refresh
     token cannot be written here by accident, by a migration, or from a SQL
     console. */
  constraint drive_connection_token_is_sealed check (
    refresh_token_encrypted is null
    or refresh_token_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  ),

  /* A connection is either complete or absent. A row naming an account with no
     token would render as "connected" and fail on every call. */
  constraint drive_connection_coherent check (
    (account_email is null and refresh_token_encrypted is null)
    or (account_email is not null and refresh_token_encrypted is not null
        and connected_at is not null)
  )
);

insert into public.drive_connection (id) values (1) on conflict (id) do nothing;

comment on table public.drive_connection is
  'Single row. The OAuth refresh token for the Google account the CRM acts as. '
  'No client read path — RLS is enabled with ZERO policies, deliberately, exactly '
  'like break_glass. Only the server reads it, and only to mint an access token.';


-- -----------------------------------------------------------------------------
-- 2 · THE FOLDER REGISTRY — and where member visibility is decided
-- -----------------------------------------------------------------------------
-- Owner chose per-FOLDER visibility, mirroring Drive: "the Drive folder IS the
-- permission". So the CRM keeps a row per folder it knows about, and one boolean
-- on it decides whether Members see the documents inside.
--
-- ⚠️ VISIBILITY DOES NOT INHERIT DOWN THE TREE, AND THAT IS DELIBERATE.
-- `parent_drive_id` is recorded so the UI can draw the hierarchy, but a child
-- folder is NOT made visible by its parent. Inheritance would mean sharing one
-- top-level folder silently exposes everything ever nested under it, including
-- folders created in Drive later by somebody who never saw this screen. Each
-- folder is turned on by a person who looked at it.
create table if not exists public.drive_folders (
  id                  uuid primary key default gen_random_uuid(),

  drive_folder_id     text not null,
  name                text not null,
  /* Drive's own id for the parent, not a foreign key: the parent may be above
     the watched root and therefore not a row here at all. */
  parent_drive_id     text,

  /* Set when this folder corresponds to a project (migration 025 already creates
     draft projects from new folders). Null for folders that are just folders. */
  project_id          uuid references public.projects (id) on delete set null,

  /* THE SWITCH. Coordinator and above turn it on; Members then see the documents
     filed in this folder. Off by default — a folder appearing from a Drive sync
     must never be visible to everybody the moment it is created. */
  visible_to_members  boolean not null default false,

  shared_by_id        uuid references public.users (id) on delete set null,
  shared_at           timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint drive_folders_name_present check (length(btrim(name)) > 0),
  /* Who shared it and when are written together or not at all — half a record of
     who exposed a folder is worse than none. */
  constraint drive_folders_share_is_attributed check (
    (visible_to_members = false) or (shared_by_id is not null and shared_at is not null)
  )
);

create unique index if not exists drive_folders_drive_id_key
  on public.drive_folders (drive_folder_id);
create index if not exists drive_folders_parent_idx on public.drive_folders (parent_drive_id);
create index if not exists drive_folders_project_idx on public.drive_folders (project_id);
create index if not exists drive_folders_visible_idx
  on public.drive_folders (visible_to_members) where visible_to_members;

comment on table public.drive_folders is
  'Folders the CRM knows about, and the per-folder switch that lets Members see '
  'their documents. Visibility does NOT inherit to child folders — see migration 027.';
comment on column public.drive_folders.visible_to_members is
  'Coordinator+ turns this on. Off by default, so a folder discovered by a Drive '
  'sync is never visible to everybody the moment it appears.';


-- -----------------------------------------------------------------------------
-- 3 · A DOCUMENT KNOWS ITS FOLDER
-- -----------------------------------------------------------------------------
alter table public.documents
  add column if not exists folder_id uuid
    references public.drive_folders (id) on delete set null;

create index if not exists documents_folder_idx
  on public.documents (folder_id) where folder_id is not null;

comment on column public.documents.folder_id is
  'The registry folder this document is filed in. NULL means unfiled, which is '
  'Admin+ only — a document nobody has placed is not visible by folder rule.';


-- -----------------------------------------------------------------------------
-- 4 · WHO SEES WHAT — the rule the owner asked for
-- -----------------------------------------------------------------------------
-- Replaces migration 025's version. Two changes:
--   · COORDINATOR now sees the whole register, not just Admin+. Owner's words:
--     "super admin, admin and team coordinator can see the whole documents".
--   · A Member additionally sees documents in a folder somebody has shared.
--
-- Kept from 025: you always see your own upload, or you would be filing into
-- silence with no way to learn whether it was approved.
create or replace function app.can_read_document(
  p_project_id uuid,
  p_uploader   uuid,
  p_folder_id  uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    -- Coordinator and above: the whole register.
    app.acting_at_least('team_coordinator'::public.user_role)
    -- Your own upload, whatever became of it.
    or p_uploader = app.current_user_id()
    -- Filed in a folder that has been shared with members.
    or (
      p_folder_id is not null
      and exists (
        select 1 from public.drive_folders f
         where f.id = p_folder_id and f.visible_to_members
      )
    )
    -- Attached to a project you can already see. `public.projects` is itself
    -- behind RLS, so "can see" needs no second definition here.
    or (
      p_project_id is not null
      and exists (select 1 from public.projects p where p.id = p_project_id)
    );
$$;

comment on function app.can_read_document(uuid, uuid, uuid) is
  'Coordinator+ sees the whole register (owner, 2026-08-16); anybody sees their own '
  'uploads, documents in a folder shared with members, and documents on a project '
  'visible to them.';

/* The policy has to be recreated to call the new three-argument function —
   `create or replace function` cannot change a signature in place, and the old
   two-argument version would otherwise still be bound to the policy. */
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to cni_app
  using (app.can_read_document(project_id, uploaded_by_id, folder_id));

/* The two-argument version is now unreferenced. Dropped rather than left behind:
   a stale overload is exactly what somebody copies by accident later. */
drop function if exists app.can_read_document(uuid, uuid);


-- -----------------------------------------------------------------------------
-- 5 · RLS
-- -----------------------------------------------------------------------------
alter table public.drive_connection enable row level security;
alter table public.drive_folders    enable row level security;

/* drive_connection gets NO POLICIES AT ALL, exactly like break_glass. It holds a
   token granting ongoing access to a real person's Google Drive; there is no
   version of "a client may read this" that is safe. The server reads it through
   the definer function below and nothing else. The Supabase linter will report
   this as 0008_rls_enabled_no_policy — that finding is the design. */
revoke all on public.drive_connection from cni_app, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'drive_folders_select') then
    /* Everybody signed in may READ the registry. A folder's name and whether it
       is shared are not sensitive, and a Member needs to see the folder to
       understand why a document is visible to them. */
    create policy drive_folders_select on public.drive_folders
      for select to cni_app
      using (app.current_user_id() is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'drive_folders_write') then
    /* Coordinator+ shares a folder — the owner's instruction. Deliberately NOT
       Admin-only: a Coordinator runs the projects whose folders these are. */
    create policy drive_folders_write on public.drive_folders
      for all to cni_app
      using (app.acting_at_least('team_coordinator'::public.user_role))
      with check (app.acting_at_least('team_coordinator'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.drive_folders to cni_app;
revoke all on public.drive_folders from anon, authenticated;

drop trigger if exists drive_folders_touch_updated_at on public.drive_folders;
create trigger drive_folders_touch_updated_at
  before update on public.drive_folders
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 6 · THE ONLY WAY THE TOKEN IS READ OR WRITTEN
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER, granted to cni_app, because the table itself grants nothing.
-- Narrow on purpose: one function returns the sealed token, one stores a new
-- connection, one records a failure. There is no function that returns the token
-- alongside anything else, and none that takes a filter.
create or replace function app.drive_connection_read()
returns table (account_email text, refresh_token_encrypted text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.account_email, c.refresh_token_encrypted, c.connected_at
    from public.drive_connection c where c.id = 1
$$;

create or replace function app.drive_connection_store(
  p_email text,
  p_token text,
  p_actor uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.drive_connection
     set account_email = p_email,
         refresh_token_encrypted = p_token,
         connected_by_id = p_actor,
         connected_at = now(),
         last_error = null,
         last_error_at = null
   where id = 1
$$;

create or replace function app.drive_connection_clear()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.drive_connection
     set account_email = null, refresh_token_encrypted = null,
         connected_by_id = null, connected_at = null
   where id = 1
$$;

create or replace function app.drive_connection_fail(p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.drive_connection
     set last_error = left(coalesce(p_error, ''), 500), last_error_at = now()
   where id = 1
$$;

revoke execute on function app.drive_connection_read()                  from public;
revoke execute on function app.drive_connection_store(text, text, uuid) from public;
revoke execute on function app.drive_connection_clear()                 from public;
revoke execute on function app.drive_connection_fail(text)              from public;

grant execute on function app.drive_connection_read()                  to cni_app;
grant execute on function app.drive_connection_store(text, text, uuid) to cni_app;
grant execute on function app.drive_connection_clear()                 to cni_app;
grant execute on function app.drive_connection_fail(text)              to cni_app;


-- -----------------------------------------------------------------------------
-- 7 · SELF-CHECK
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='drive_connection')
  or not exists (select 1 from pg_tables where schemaname='public' and tablename='drive_folders') then
    raise exception 'Migration 027 incomplete — tables missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='documents' and column_name='folder_id'
  ) then
    raise exception 'Migration 027 incomplete — documents.folder_id missing';
  end if;

  /* The connection must be unreachable from the application role. */
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='drive_connection';
  if n <> 0 then
    raise exception 'Migration 027 FAILED — drive_connection has % policies; it must have none', n;
  end if;

  /* And a plaintext token must be impossible to store. */
  begin
    update public.drive_connection set refresh_token_encrypted = 'not-sealed' where id = 1;
    raise exception 'Migration 027 FAILED — a plaintext refresh token was accepted';
  exception
    when check_violation then
      raise notice 'Migration 027 OK — tables present, connection has no client path, plaintext token refused';
  end;
end
$$;
