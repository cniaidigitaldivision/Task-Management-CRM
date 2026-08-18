-- =============================================================================
-- 031 · ACCESS FOR A NAMED PERSON — owner request 2026-08-18
-- -----------------------------------------------------------------------------
-- Owner: *"I don't want to assign access member by member. That's fine for that
-- but when I want that specifically I can select any team member. For example
-- Yusra, I want this access, for example Rafi, I want some other access."*
--
-- So both, not either. 028 gave every folder ONE level that applied to all
-- Members at once, which is the right tool for "the whole team can read this" and
-- useless for "Yusra can upload here". This adds the second half.
--
-- ── GRANTS ONLY ADD (the owner's choice, asked directly) ─────────────────────
-- Effective access = the GREATER of
--     drive_folders.member_access   what every Member gets
--     drive_folder_grants.access    what this person was named for
--
-- A grant can therefore raise somebody and never lower them. To keep one person
-- out, you lower the everyone level and name the people who keep access.
--
-- The alternative — a per-person level that overrides in both directions — was
-- offered and declined, and the reason is worth recording: an exclusion is
-- invisible in the everyone level, so "why can't Rafi see this" becomes a
-- two-place question, and a forgotten exclusion looks exactly like a bug.
--
-- ── `none` IS NOT A GRANTABLE LEVEL HERE ─────────────────────────────────────
-- Under "grants only add" a grant of `none` cannot express anything — the row
-- would be indistinguishable from having no row, while looking like a
-- restriction. Refused by a check constraint rather than allowed to mislead.
-- =============================================================================

create table if not exists public.drive_folder_grants (
  id          uuid primary key default gen_random_uuid(),

  folder_id   uuid not null references public.drive_folders (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,

  access      public.folder_access not null,

  /* Who named this person, and when. Same reasoning as the folder-level
     attribution in 028: opening access is the act nobody can undo the
     consequences of, so it is always attributable. */
  granted_by_id uuid references public.users (id) on delete set null,
  granted_at    timestamptz not null default now(),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  /* See the header: a grant of `none` says nothing and looks like a restriction. */
  constraint drive_folder_grants_access_is_positive
    check (access <> 'none'::public.folder_access)
);

/* One row per person per folder. A second grant for the same pair would make
   "what can Yusra do here" depend on row order. */
create unique index if not exists drive_folder_grants_unique
  on public.drive_folder_grants (folder_id, user_id);

create index if not exists drive_folder_grants_user_idx
  on public.drive_folder_grants (user_id);

comment on table public.drive_folder_grants is
  'Access given to a NAMED person for one folder, on top of the folder''s '
  'everyone level. Grants only ADD (owner, 2026-08-18) — effective access is the '
  'greater of the two. Never lowers anybody.';

drop trigger if exists drive_folder_grants_touch_updated_at on public.drive_folder_grants;
create trigger drive_folder_grants_touch_updated_at
  before update on public.drive_folder_grants
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 2 · The predicate now consults both
-- -----------------------------------------------------------------------------
-- ⚠️ Every policy on `documents` already calls this, so widening it here is what
-- makes a named grant actually work for reading, uploading and deleting. Nothing
-- downstream changes — which was the point of routing all four policies through
-- one function in 028.

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
    -- Coordinator and above: the whole register, at every level.
    app.acting_at_least('team_coordinator'::public.user_role)
    or (
      p_folder_id is not null
      and (
        -- What every Member gets on this folder.
        exists (
          select 1 from public.drive_folders f
           where f.id = p_folder_id
             and f.member_access >= p_min
        )
        -- Or what THIS person was named for. GREATER of the two, by virtue of
        -- being a second `or` — a grant can raise, never lower.
        or exists (
          select 1 from public.drive_folder_grants g
           where g.folder_id = p_folder_id
             and g.user_id = app.current_user_id()
             and g.access >= p_min
        )
      )
    );
$$;

comment on function app.folder_grants(uuid, public.folder_access) is
  'Whether the acting user may do at least `p_min` in this folder: Coordinator+ '
  'always, or the folder''s everyone level, or a grant naming them (031). '
  'SECURITY DEFINER because both tables are behind RLS.';


-- -----------------------------------------------------------------------------
-- 3 · RLS
-- -----------------------------------------------------------------------------

alter table public.drive_folder_grants enable row level security;

do $$
begin
  /* READ: your own grants, always — a Member must be able to see why they can
     reach a folder. Coordinator+ sees all of them, because they are the ones
     deciding. A Member cannot enumerate what OTHER people were given; that is
     nobody else's business and it is not needed to explain their own access. */
  if not exists (select 1 from pg_policy where polname = 'drive_folder_grants_select') then
    create policy drive_folder_grants_select on public.drive_folder_grants
      for select to cni_app
      using (
        user_id = app.current_user_id()
        or app.acting_at_least('team_coordinator'::public.user_role)
      );
  end if;

  /* WRITE: Coordinator+, the same floor as the folder's everyone level. Naming a
     person is the same kind of decision as opening the folder to everybody. */
  if not exists (select 1 from pg_policy where polname = 'drive_folder_grants_write') then
    create policy drive_folder_grants_write on public.drive_folder_grants
      for all to cni_app
      using (app.acting_at_least('team_coordinator'::public.user_role))
      with check (app.acting_at_least('team_coordinator'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.drive_folder_grants to cni_app;
revoke all on public.drive_folder_grants from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4 · SELF-CHECK — as cni_app, because grants are enforced by GRANTs and RLS
-- -----------------------------------------------------------------------------
-- ⚠️ `set local role cni_app` throughout. Verifying this as `postgres` is what
--    let the 42501 bug of 2026-08-16 through: postgres bypasses both.

do $$
declare
  v_member uuid; v_other uuid; v_coord uuid; v_folder uuid; v_doc uuid; n int;
begin
  select id into v_coord from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_member from public.users where role = 'member' and is_active limit 1;
  select id into v_other  from public.users
   where role = 'member' and is_active and id <> v_member limit 1;

  if v_coord is null or v_member is null then
    raise notice '031 · no coordinator/member to test against; structural checks only';
    return;
  end if;

  -- A folder nobody may see, holding somebody else's document.
  insert into public.drive_folders (drive_folder_id, name)
  values ('__m031_selfcheck__', 'Migration 031 self-check')
  returning id into v_folder;

  insert into public.documents (name, folder_id, storage_path, mime_type, size_bytes, uploaded_by_id)
  values ('031 self-check', v_folder, 'documents/m031/x', 'text/plain', 1, v_coord)
  returning id into v_doc;

  -- Baseline: member_access = 'none' and no grant → invisible.
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from public.documents where id = v_doc;
  if n <> 0 then raise exception '031 · visible with no access at all'; end if;

  -- Name that ONE member for `view`. The folder's everyone level stays `none`.
  reset role;
  insert into public.drive_folder_grants (folder_id, user_id, access, granted_by_id)
  values (v_folder, v_member, 'view', v_coord);

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from public.documents where id = v_doc;
  if n <> 1 then raise exception '031 · a named grant did not confer read'; end if;

  -- `view` still must not confer delete.
  delete from public.documents where id = v_doc;
  if found then raise exception '031 · a `view` grant allowed a DELETE'; end if;

  -- A DIFFERENT member must be unaffected by somebody else's grant.
  if v_other is not null then
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into n from public.documents where id = v_doc;
    if n <> 0 then raise exception '031 · one person''s grant leaked to another'; end if;
    -- And they must not be able to read the grant row itself.
    select count(*) into n from public.drive_folder_grants where folder_id = v_folder;
    if n <> 0 then raise exception '031 · a member enumerated another member''s grant'; end if;
  end if;

  -- Raise the grant to `manage`: delete now allowed.
  reset role;
  update public.drive_folder_grants set access = 'manage'
   where folder_id = v_folder and user_id = v_member;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  delete from public.documents where id = v_doc;
  if not found then raise exception '031 · a `manage` grant did not allow DELETE'; end if;

  -- A Member may not grant access to anybody, including themselves.
  begin
    insert into public.drive_folder_grants (folder_id, user_id, access, granted_by_id)
    values (v_folder, v_member, 'manage', v_member);
    raise exception '031 · A MEMBER GRANTED THEMSELVES ACCESS';
  exception when insufficient_privilege or unique_violation then null;
  end;

  -- A grant of `none` is refused: it would look like a restriction and be none.
  reset role;
  begin
    insert into public.drive_folder_grants (folder_id, user_id, access, granted_by_id)
    values (v_folder, v_coord, 'none', v_coord);
    raise exception '031 · a `none` grant was accepted';
  exception when check_violation then null;
  end;

  delete from public.drive_folders where id = v_folder;  -- cascades the grant
  if exists (select 1 from public.drive_folder_grants where folder_id = v_folder) then
    raise exception '031 · the grant outlived its folder';
  end if;

  raise notice '031 · named grants add access, never leak, and never lower';
end
$$;
