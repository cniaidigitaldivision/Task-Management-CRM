-- =============================================================================
-- 025 · GOOGLE DRIVE — THE DOCUMENT REGISTER AND ITS APPROVAL QUEUE
-- =============================================================================
-- Owner request 2026-08-13, in their words:
--
--   *"Every time a user or anybody comes… they should have a place where they can
--   upload something. Other than the team coordinator or admin, every approval
--   will go to the admin. Once the admin approves it, it will actually be added
--   to Google Drive… a list of all documents set by the super admin and admin
--   only… The added is only possible by the admin, super admin, and the
--   coordinator. These people can only delete or update anything."*
--
-- Plus: a new folder appearing under a watched Drive folder creates a **draft**
-- project for the owner to confirm.
--
-- ── ONE TABLE, THREE STATES, AND WHY NOT TWO TABLES ──────────────────────────
-- A pending upload and an approved document are the same thing at different
-- points in its life: same name, same uploader, same project. Two tables would
-- mean copying a row on approval and then keeping two schemas in step forever —
-- and the interesting question ("what is waiting?") becomes a UNION.
--
--   pending    uploaded to Supabase storage, waiting on an Admin. NOT in Drive.
--   approved   moved to Drive. `drive_file_id` is set, `storage_path` is cleared.
--   rejected   refused. Kept, with the reason, because "why was this refused" is
--              a question people ask, and deleting the row answers it with silence.
--
-- ── A REJECTED FILE NEVER TOUCHES DRIVE ──────────────────────────────────────
-- That is the whole point of approving it. Pending files sit in the Supabase
-- bucket the application already owns; approval is what copies the bytes into the
-- company Drive. The alternative — write to Drive first and delete on rejection —
-- means every refused file has been in the company's Drive, and deletion is a
-- second thing that can fail.
--
-- ── VISIBILITY: THE REGISTER IS ADMIN+, THE FILES FOLLOW THEIR PROJECT ────────
-- Reconciling the owner's two answers, which pull in different directions:
--
--   *"a list of all documents… by the super admin and admin only"*   → the register
--   *"match the CRM's own rules"* (their answer on project files)     → per project
--
-- So: a document attached to a project is visible to whoever can see that
-- project, and a document attached to nothing is Admin+ only. Both readings are
-- honoured, and the rule is one sentence rather than a special case.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_state') then
    create type public.document_state as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),

  name              text not null,
  description       text,

  -- Where it belongs. Optional: a division-wide document belongs to no project,
  -- and is therefore Admin+ only by the rule above.
  project_id        uuid references public.projects (id) on delete set null,

  state             public.document_state not null default 'pending',

  -- ── WHILE PENDING ──────────────────────────────────────────────────────────
  -- The object in the Supabase bucket. Cleared on approval, once the bytes are
  -- safely in Drive — so a row never claims to have the file in two places.
  storage_path      text,
  mime_type         text,
  size_bytes        bigint,

  -- ── ONCE APPROVED ──────────────────────────────────────────────────────────
  drive_file_id     text,
  drive_web_link    text,

  -- ── WHO, AND WHEN ──────────────────────────────────────────────────────────
  uploaded_by_id    uuid not null references public.users (id) on delete restrict,
  decided_by_id     uuid references public.users (id) on delete set null,
  decided_at        timestamptz,
  -- Required on a rejection by the constraint below. A refusal with no reason is
  -- the thing that makes people stop using a queue.
  decision_reason   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint documents_name_present
    check (length(btrim(name)) > 0),

  -- The state machine, as a constraint rather than as a convention:
  --   pending   has a storage_path, no drive_file_id, no decision
  --   approved  has a drive_file_id, no storage_path, a decider
  --   rejected  has a decider and a reason
  constraint documents_state_is_coherent check (
    case state
      when 'pending' then
        storage_path is not null and drive_file_id is null and decided_at is null
      when 'approved' then
        drive_file_id is not null and storage_path is null
        and decided_by_id is not null and decided_at is not null
      when 'rejected' then
        decided_by_id is not null and decided_at is not null
        and length(btrim(coalesce(decision_reason, ''))) > 0
    end
  ),

  constraint documents_size_sane
    check (size_bytes is null or (size_bytes > 0 and size_bytes <= 104857600))
);

create index if not exists documents_state_idx    on public.documents (state, created_at desc);
create index if not exists documents_project_idx  on public.documents (project_id);
create index if not exists documents_uploader_idx on public.documents (uploaded_by_id);

comment on table public.documents is
  'The document register. A pending row is a file in Supabase storage awaiting an Admin; approving '
  'it copies the bytes into the company Google Drive and clears storage_path. A rejected row is '
  'kept with its reason — "why was this refused" is a question people ask.';
comment on constraint documents_state_is_coherent on public.documents is
  'Makes the pending → approved/rejected lifecycle a property of the table. A row cannot claim to '
  'hold the file in both Supabase and Drive, and cannot be rejected without a reason.';


-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table public.documents enable row level security;

create or replace function app.can_read_document(
  p_project_id uuid,
  p_uploader   uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    -- Admin and above see the whole register, which is what the owner asked for.
    app.acting_at_least('admin'::public.user_role)
    -- Your own upload, so you can see whether it was approved. Without this a
    -- Member uploads into silence and has to ask somebody what happened.
    or p_uploader = app.current_user_id()
    -- Attached to a project you can see. `public.projects` is itself behind RLS,
    -- so "can see" needs no second definition here.
    or (
      p_project_id is not null
      and exists (select 1 from public.projects p where p.id = p_project_id)
    );
$$;

comment on function app.can_read_document(uuid, uuid) is
  'Admin+ sees the register; anybody sees their own uploads and documents on a project visible to '
  'them. Reconciles the owner''s two answers — Admin-only list, project-scoped files.';

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'documents_select') then
    create policy documents_select on public.documents
      for select to cni_app
      using (app.can_read_document(project_id, uploaded_by_id));
  end if;

  -- ANYBODY may request. That is the owner's instruction — "every time a user or
  -- anybody comes, they should have a place where they can upload something" —
  -- and it is safe precisely because a pending row is not in Drive.
  if not exists (select 1 from pg_policy where polname = 'documents_insert') then
    create policy documents_insert on public.documents
      for insert to cni_app
      with check (
        uploaded_by_id = app.current_user_id()
        and state = 'pending'::public.document_state
      );
  end if;

  -- Deciding, renaming and re-filing. Admin+ and a Coordinator, per *"the added
  -- is only possible by the admin, super admin, and the coordinator"*.
  --
  -- ⚠️ A Coordinator may EDIT and DELETE but must not APPROVE — that is enforced
  -- in `lib/domain/permissions.ts` and the action, because "approved by whom" is
  -- a role question this policy cannot express. The policy is the floor.
  if not exists (select 1 from pg_policy where polname = 'documents_update') then
    create policy documents_update on public.documents
      for update to cni_app
      using (app.acting_at_least('team_coordinator'::public.user_role));
  end if;

  if not exists (select 1 from pg_policy where polname = 'documents_delete') then
    create policy documents_delete on public.documents
      for delete to cni_app
      using (app.acting_at_least('team_coordinator'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.documents to cni_app;

create or replace function app.documents_touch()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents
  for each row execute function app.documents_touch();


-- ----------------------------------------------------------------------------
-- PROJECTS LEARN THEIR DRIVE FOLDER, AND WHETHER THEY ARE A DRAFT
-- ----------------------------------------------------------------------------
-- Owner decision: a new folder under the watched parent creates a project marked
-- "needs details" rather than a fully-formed one — a folder name cannot say what
-- type a project is, who owns it, or when it is due, and a half-defined project
-- entering reports and workload is worse than one waiting to be confirmed.
-- ----------------------------------------------------------------------------

alter table public.projects
  add column if not exists drive_folder_id text,
  add column if not exists is_draft boolean not null default false;

-- One project per Drive folder. Without this, a poll that runs twice — a retry, or
-- two instances — creates the same project again, and the second one is
-- indistinguishable from a real duplicate.
create unique index if not exists projects_drive_folder_key
  on public.projects (drive_folder_id)
  where drive_folder_id is not null;

comment on column public.projects.is_draft is
  'Created from a Drive folder and not yet confirmed. Excluded from reports and workload until an '
  'Admin sets its type and owner — a folder name cannot supply either. Migration 025.';
comment on column public.projects.drive_folder_id is
  'The Drive folder this project came from or was linked to. Unique, so a repeated poll cannot '
  'create the project twice.';


-- ----------------------------------------------------------------------------
-- THE POLL'S MEMORY
-- ----------------------------------------------------------------------------
-- One row. Records which Drive folder is being watched and when it was last read,
-- so a restart does not re-examine everything and a failed run does not lose its
-- place. A single-row table rather than a settings key because it holds a cursor,
-- not a preference — nobody edits it in the Settings screen.
-- ----------------------------------------------------------------------------

create table if not exists public.drive_sync (
  id                integer primary key default 1,
  watched_folder_id text,
  last_checked_at   timestamptz,
  last_error        text,
  -- How many folders the last run turned into draft projects. Reported on screen
  -- so "is this working" has an answer that is not "look in the logs".
  last_created      integer not null default 0,
  constraint drive_sync_is_singleton check (id = 1)
);

insert into public.drive_sync (id) values (1) on conflict (id) do nothing;

alter table public.drive_sync enable row level security;

do $$
begin
  -- Admin+ only, in both directions: it names a folder in the company Drive and
  -- is the switch that turns automatic project creation on.
  if not exists (select 1 from pg_policy where polname = 'drive_sync_select') then
    create policy drive_sync_select on public.drive_sync
      for select to cni_app using (app.acting_at_least('admin'::public.user_role));
  end if;
  if not exists (select 1 from pg_policy where polname = 'drive_sync_update') then
    create policy drive_sync_update on public.drive_sync
      for update to cni_app using (app.acting_at_least('admin'::public.user_role));
  end if;
end
$$;

grant select, update on public.drive_sync to cni_app;

comment on table public.drive_sync is
  'Single row. Which Drive folder is watched for new project folders, and when it was last read. '
  'A cursor, not a preference — which is why it is not a system_settings key.';
