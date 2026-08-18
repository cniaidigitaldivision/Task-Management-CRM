-- =============================================================================
-- 028 · FOLDER ACCESS LEVELS — owner request 2026-08-16
-- -----------------------------------------------------------------------------
-- Owner, on being asked whether a Member's upload into a shared folder should
-- still need approval:
--
--   *"In a normal case it shouldn't be required approval because an admin is
--   assigning access to some folder of a Google Drive to some team member. It
--   will give access like: it can read only files, it can view, it can add it,
--   it can upload, it can delete. These options of access should be provided at
--   the time of giving access… the access level is defined at the time of
--   giving, right?"*
--
-- Right. Migration 027 got this wrong: it made sharing a BOOLEAN, so the only
-- question the screen could ask was "can members see this, yes or no", and every
-- upload therefore still had to go through the approval queue because nothing
-- recorded that a Member had been trusted with more than reading.
--
-- ── WHAT REPLACES THE BOOLEAN ────────────────────────────────────────────────
-- One ordered level per folder, chosen at the moment access is given. This is
-- Google Drive's own model, in our words:
--
--   none    Coordinator and above only. The default, and what a folder
--           discovered by a Drive sync gets.
--   view    Members can see the documents filed here. Read only.
--   upload  view + add files, AND those files go STRAIGHT TO DRIVE. Granting
--           this IS the approval — that is the owner's whole point.
--   manage  upload + delete documents in this folder.
--
-- ⚠️ THE ORDER OF THE ENUM VALUES IS LOAD-BEARING. Postgres orders an enum by
--    declaration, so `member_access >= 'upload'` is a valid and cheap comparison
--    and every policy below is written as one. Never insert a value in the
--    middle of this list — a new level goes on the end, or the comparisons
--    silently change meaning. `alter type … add value … before/after` exists and
--    must not be used here.
--
-- ── WHAT DOES NOT CHANGE ─────────────────────────────────────────────────────
-- Visibility still does NOT inherit to child folders. 027's reasoning stands and
-- is stronger now: inheriting `manage` down a tree would hand delete rights over
-- folders created in Drive months later by somebody who never saw this screen.
--
-- ── SAFE TO RE-RUN ───────────────────────────────────────────────────────────
-- Every step is guarded. The self-check at the foot proves the levels bind, and
-- cleans up after itself.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The level
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'folder_access') then
    create type public.folder_access as enum ('none', 'view', 'upload', 'manage');
  end if;
end
$$;

comment on type public.folder_access is
  'What a Member may do in a folder, chosen when access is given (owner, '
  '2026-08-16). ORDERED — policies compare with >=. Never insert a value in the '
  'middle of the list.';

alter table public.drive_folders
  add column if not exists member_access public.folder_access not null default 'none';

comment on column public.drive_folders.member_access is
  'Replaced visible_to_members in migration 028. `upload` and above mean a '
  'Member''s file goes straight to Drive: granting the level IS the approval.';


-- -----------------------------------------------------------------------------
-- 2 · Carry the boolean across, then remove it
-- -----------------------------------------------------------------------------
-- A folder that was shared meant "Members can see this and nothing more", which
-- is exactly `view`. Nobody is silently upgraded to writing by this migration —
-- that has to be a decision somebody makes on the screen.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'drive_folders'
       and column_name = 'visible_to_members'
  ) then
    update public.drive_folders
       set member_access = 'view'::public.folder_access
     where visible_to_members and member_access = 'none'::public.folder_access;

    /* The old constraint and index name the column, so they go first. */
    alter table public.drive_folders
      drop constraint if exists drive_folders_share_is_attributed;
    drop index if exists public.drive_folders_visible_idx;

    alter table public.drive_folders drop column visible_to_members;
  end if;
end
$$;

/* Who granted it and when are written together with the level or not at all —
   half a record of who opened a folder up is worse than none. Unchanged in
   spirit from 027; only the column it tests has moved. */
alter table public.drive_folders
  drop constraint if exists drive_folders_access_is_attributed;
alter table public.drive_folders
  add constraint drive_folders_access_is_attributed check (
    (member_access = 'none'::public.folder_access)
    or (shared_by_id is not null and shared_at is not null)
  );

create index if not exists drive_folders_access_idx
  on public.drive_folders (member_access)
  where member_access <> 'none'::public.folder_access;


-- -----------------------------------------------------------------------------
-- 3 · One predicate, asked by every policy
-- -----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER, and it has to be. `drive_folders` is itself behind RLS,
-- so a policy on `documents` that joined to it would be asking a question the
-- caller may not be allowed to answer. Definer reads the level directly.
--
-- Coordinator and above are true at every level without consulting the folder:
-- they see and manage the whole register (owner, 2026-08-16), so a folder's
-- member level is not a limit on them. Writing that here rather than in four
-- policies is what stops the four drifting apart.

create or replace function app.folder_grants(
  p_folder_id uuid,
  p_min       public.folder_access
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    app.acting_at_least('team_coordinator'::public.user_role)
    or (
      p_folder_id is not null
      and exists (
        select 1 from public.drive_folders f
         where f.id = p_folder_id
           and f.member_access >= p_min
      )
    );
$$;

comment on function app.folder_grants(uuid, public.folder_access) is
  'Whether the acting user may do at least `p_min` in this folder. Coordinator+ '
  'always may. SECURITY DEFINER because drive_folders is behind RLS and a policy '
  'joining to it would ask a question the caller cannot answer.';

revoke all on function app.folder_grants(uuid, public.folder_access) from public;
grant execute on function app.folder_grants(uuid, public.folder_access) to cni_app;


-- -----------------------------------------------------------------------------
-- 4 · Reading
-- -----------------------------------------------------------------------------
-- Same three grounds as 027, with the folder clause now asking for a level.

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
    -- Your own upload, whatever became of it. Without this you would be filing
    -- into silence with no way to learn whether it was approved.
    or p_uploader = app.current_user_id()
    -- Filed in a folder you have at least `view` on.
    or app.folder_grants(p_folder_id, 'view'::public.folder_access)
    -- Attached to a project you can already see. `public.projects` is itself
    -- behind RLS, so "can see" needs no second definition here.
    or (
      p_project_id is not null
      and exists (select 1 from public.projects p where p.id = p_project_id)
    );
$$;


-- -----------------------------------------------------------------------------
-- 5 · Writing
-- -----------------------------------------------------------------------------

do $$
begin
  /* ── INSERT: `upload` IS THE APPROVAL ──────────────────────────────────────
     025 required every new row to be `pending`, because approval was the only
     gate. A folder granting `upload` moves that gate earlier: the decision was
     made when access was given, by somebody senior enough to give it.

     ⚠️ This does widen what a row may CLAIM at insert. The server uploads to
     Drive first and only then writes the row, so `drive_file_id` is real — but
     the policy alone cannot check that. It is acceptable only because `cni_app`
     is unreachable from a browser: `documents` has `revoke all … from anon,
     authenticated`, so every insert arrives through a server action. If that
     ever stops being true, this policy is the first thing to revisit. */
  drop policy if exists documents_insert on public.documents;
  create policy documents_insert on public.documents
    for insert to cni_app
    with check (
      uploaded_by_id = app.current_user_id()
      and (
        state = 'pending'::public.document_state
        or (
          state = 'approved'::public.document_state
          and app.folder_grants(folder_id, 'upload'::public.folder_access)
        )
      )
    );

  /* ── DELETE: `manage` means what it says ───────────────────────────────────
     A Member with `manage` may remove any document in that folder, not only
     their own — which is what "it can delete" meant, and what the equivalent
     role does in Drive itself. Bounded to the folder: a `manage` grant on one
     folder says nothing about any other. */
  drop policy if exists documents_delete on public.documents;
  create policy documents_delete on public.documents
    for delete to cni_app
    using (app.folder_grants(folder_id, 'manage'::public.folder_access));

  /* ── UPDATE STAYS AT COORDINATOR+ ──────────────────────────────────────────
     Deliberately NOT widened to `manage`. `documents.state` is an updatable
     column, so a Member who could update could move a pending row to `approved`
     with an invented `drive_file_id` — the state constraint checks that the
     column is non-null, not that Google has ever heard of it. Deleting is
     recoverable from Drive; a forged approval is not detectable at all. */
end
$$;


-- -----------------------------------------------------------------------------
-- 6 · SELF-CHECK — the levels bind, or this migration fails
-- -----------------------------------------------------------------------------

do $$
declare
  v_member uuid; v_coord uuid; v_folder uuid; v_doc uuid; n int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'drive_folders'
       and column_name = 'visible_to_members'
  ) then
    raise exception '028 incomplete — visible_to_members still exists';
  end if;

  select id into v_member from public.users where role = 'member' and is_active limit 1;
  select id into v_coord  from public.users where role = 'team_coordinator' and is_active limit 1;

  if v_member is null or v_coord is null then
    raise notice '028 · no member/coordinator to test against; structural checks only';
    return;
  end if;

  insert into public.drive_folders (drive_folder_id, name)
  values ('__m028_selfcheck__', 'Migration 028 self-check')
  returning id into v_folder;

  insert into public.documents (name, folder_id, storage_path, mime_type, size_bytes, uploaded_by_id)
  values ('028 self-check', v_folder, 'documents/m028/x', 'text/plain', 1, v_coord)
  returning id into v_doc;

  -- none → a Member sees nothing.
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from public.documents where id = v_doc;
  if n <> 0 then raise exception '028 · a Member read a document in a `none` folder'; end if;

  -- view → they see it, and may not delete it.
  reset role;
  update public.drive_folders
     set member_access = 'view', shared_by_id = v_coord, shared_at = now()
   where id = v_folder;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from public.documents where id = v_doc;
  if n <> 1 then raise exception '028 · `view` did not make the document readable'; end if;

  delete from public.documents where id = v_doc;
  if found then raise exception '028 · `view` allowed a DELETE'; end if;

  -- manage → now they may.
  reset role;
  update public.drive_folders set member_access = 'manage' where id = v_folder;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  delete from public.documents where id = v_doc;
  if not found then raise exception '028 · `manage` did not allow a DELETE'; end if;

  -- The attribution constraint still refuses an unattributed grant.
  reset role;
  begin
    update public.drive_folders
       set member_access = 'view', shared_by_id = null, shared_at = null
     where id = v_folder;
    raise exception '028 · an unattributed grant was accepted';
  exception when check_violation then null;
  end;

  delete from public.drive_folders where id = v_folder;
  raise notice '028 · folder access levels bind correctly';
end
$$;
