-- =============================================================================
-- 033 · PROJECTS WIRED TO THE CATALOGUE
-- -----------------------------------------------------------------------------
-- 032 built the catalogue and nothing read it. This connects a project to it:
-- the package it was sold on, the targets that were actually agreed, the
-- platforms it manages, the people accountable for it, and the services it
-- bought. Plus the two task columns that make the whole thing measurable.
--
-- Analysis and decisions: docs/PROJECTS-REDESIGN.md.
--
-- ── ⚠️ THE TARGETS ARE COPIED, NOT REFERENCED. THIS IS THE WHOLE DESIGN ───────
-- `projects.assets_target_min` is a column on the project, not a join to
-- `packages.assets_min`. Owner, 2026-08-19: *"by default the package has that
-- value but we can adjust those values at the time of creation of a project."*
--
-- Two reasons, and the second is the important one:
--
--   1. The owner needs to adjust them per project. A join cannot be edited.
--
--   2. A join would let a package edit REWRITE HISTORY. Raise SPARK from 14
--      assets to 18 next year and every existing SPARK project would
--      retroactively have been promised 18 — last quarter's reports would show
--      projects missing a target nobody had agreed to at the time. The same
--      reason an order line stores its price instead of reading it from the
--      product: you record what was agreed, not what is currently on the shelf.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ───────────────────────────────────────────
-- It does not touch `type_fields`, even though nine of its keys are agreed dead
-- (PROJECTS-REDESIGN.md §6). The current Projects page still reads them; deleting
-- the data before the form is rebuilt would break a working screen for no gain.
-- The rebuild stops writing them, and a later migration clears them out.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Types
-- -----------------------------------------------------------------------------

do $$
begin
  /* Who the work is for. Owner sets this per project — see 032's note on why no
     company list is hardcoded. */
  if not exists (select 1 from pg_type where typname = 'client_kind') then
    create type public.client_kind as enum ('internal', 'external');
  end if;

  /* What a task actually produced. THIS is the column that turns "task
     management" into "did we publish what we promised". `static` and `reel` are
     the two the packages count; `carousel` is named in STARTER's own wording. */
  if not exists (select 1 from pg_type where typname = 'content_kind') then
    create type public.content_kind as enum (
      'static', 'reel', 'carousel', 'story', 'video',
      'website', 'ad', 'report', 'other'
    );
  end if;

  /* Accountability. The owner's reason for wanting it: "who is responsible for
     any blunder, who is responsible for delaying the project". */
  if not exists (select 1 from pg_type where typname = 'project_role') then
    create type public.project_role as enum (
      'manager', 'content', 'design', 'development', 'ads', 'video', 'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'service_state') then
    create type public.service_state as enum (
      'planned', 'in_progress', 'delivered', 'cancelled'
    );
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2 · The project's own commercial columns
-- -----------------------------------------------------------------------------

alter table public.projects
  add column if not exists client_kind  public.client_kind,
  add column if not exists client_id    uuid references public.clients (id) on delete set null,
  add column if not exists package_id   uuid references public.packages (id) on delete set null,

  /* The AGREED fee, which may differ from the package's list price. */
  add column if not exists monthly_fee_pkr numeric(12, 2),

  /* The AGREED targets. Seeded from the package in the form, then editable. */
  add column if not exists assets_target_min integer,
  add column if not exists assets_target_max integer,
  add column if not exists reels_target_min  integer,

  /* Renewal, for a retainer. `target_end_date` already exists and means "when
     this finishes"; a retainer instead rolls forward, and the two are different
     questions. */
  add column if not exists renews_on date;

alter table public.projects drop constraint if exists projects_targets_ordered;
alter table public.projects add constraint projects_targets_ordered check (
  assets_target_min is null or assets_target_max is null
  or assets_target_min <= assets_target_max
);

alter table public.projects drop constraint if exists projects_targets_sane;
alter table public.projects add constraint projects_targets_sane check (
  (assets_target_min is null or assets_target_min >= 0)
  and (assets_target_max is null or assets_target_max >= 0)
  and (reels_target_min  is null or reels_target_min  >= 0)
  /* Reels sit INSIDE the asset total, so more reels than assets is incoherent. */
  and (reels_target_min is null or assets_target_max is null
       or reels_target_min <= assets_target_max)
);

comment on column public.projects.assets_target_min is
  'The agreed monthly minimum — the PROMISE. Copied from the package at creation '
  'and editable, so a later package change cannot rewrite what this client was '
  'told. See migration 033 header.';
comment on column public.projects.client_kind is
  'Internal (inside the Attari Group) or external. Set by the owner per project.';

create index if not exists projects_package_idx on public.projects (package_id);
create index if not exists projects_client_idx  on public.projects (client_id);


-- -----------------------------------------------------------------------------
-- 3 · The platforms a project manages
-- -----------------------------------------------------------------------------
-- Per-platform targets, because Instagram may carry three reels a week while
-- Facebook carries one. NULL means "no separate target — judge it at project
-- level", which is the common case and must not read as zero.

create table if not exists public.project_platforms (
  project_id    uuid not null references public.projects (id)  on delete cascade,
  platform_id   uuid not null references public.platforms (id) on delete restrict,
  assets_target integer,
  reels_target  integer,
  created_at    timestamptz not null default now(),

  primary key (project_id, platform_id),
  constraint project_platforms_sane check (
    (assets_target is null or assets_target >= 0)
    and (reels_target is null or reels_target >= 0)
  )
);

create index if not exists project_platforms_platform_idx
  on public.project_platforms (platform_id);


-- -----------------------------------------------------------------------------
-- 4 · Who is accountable
-- -----------------------------------------------------------------------------

create table if not exists public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.users (id)    on delete cascade,
  role        public.project_role not null default 'other',
  added_by_id uuid references public.users (id) on delete set null,
  added_at    timestamptz not null default now(),

  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members (user_id);

comment on table public.project_members is
  'Explicit assignment. Before this, "who is on this project" could only be '
  'INFERRED from task assignees, so somebody assigned but not yet given a task '
  'was invisible — which defeats the accountability the owner asked for.';


-- -----------------------------------------------------------------------------
-- 5 · Services a project bought
-- -----------------------------------------------------------------------------

create table if not exists public.project_services (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  service_id       uuid not null references public.services (id) on delete restrict,
  quantity         integer not null default 1,
  /* The agreed price, again snapshotted rather than joined — the catalogue price
     is a list price and moves. */
  agreed_price_pkr numeric(12, 2),
  state            public.service_state not null default 'planned',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint project_services_quantity_sane check (quantity > 0),
  constraint project_services_price_sane
    check (agreed_price_pkr is null or agreed_price_pkr >= 0)
);

create index if not exists project_services_project_idx on public.project_services (project_id);
create index if not exists project_services_service_idx on public.project_services (service_id);


-- -----------------------------------------------------------------------------
-- 6 · The two columns that make everything measurable
-- -----------------------------------------------------------------------------
-- ⚠️ THIS IS THE JOIN THE WHOLE MODEL RESTS ON. Without it, "what went out
-- yesterday, for which client, on which platform" cannot be answered — which is
-- exactly what the owner asked the reports to answer.

alter table public.tasks
  add column if not exists platform_id  uuid references public.platforms (id) on delete set null,
  add column if not exists content_kind public.content_kind,

  /* ⚠️ NOT `completed_at`, and not `due_date`. A reel can be finished on Monday,
     scheduled for Friday and counted in Friday's month. Progress against a
     monthly target has to be measured on the date the thing was PUBLISHED, which
     is a third date and belongs in its own column. */
  add column if not exists published_on date;

create index if not exists tasks_published_idx
  on public.tasks (published_on) where published_on is not null;
create index if not exists tasks_content_idx
  on public.tasks (project_id, content_kind, published_on)
  where content_kind is not null;

comment on column public.tasks.published_on is
  'The date the deliverable actually went live. Distinct from completed_at and '
  'due_date on purpose: a reel finished Monday and posted Friday counts against '
  'Friday. Every target report measures on this column.';


-- -----------------------------------------------------------------------------
-- 7 · Membership now confers visibility
-- -----------------------------------------------------------------------------
-- ⚠️ A REAL BUG FIX, not just an addition. `project_is_visible` granted sight to
-- the owner, the creator, and anybody with a task on the project. So a person
-- explicitly assigned to a project but not yet given a task could not see it —
-- they would be "on" a project that did not appear in their list.

create or replace function app.project_is_visible(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when app.current_user_id() is null then false
    when app.acting_at_least('team_coordinator'::public.user_role) then true
    else exists (
      select 1 from public.projects p
       where p.id = p_project
         and (p.owner_id = app.current_user_id()
              or p.created_by_id = app.current_user_id())
    ) or exists (
      select 1 from public.project_members m
       where m.project_id = p_project
         and m.user_id = app.current_user_id()
    ) or exists (
      select 1 from public.tasks t
       where t.project_id = p_project
         and not t.is_deleted
         and (t.assignee_id = app.current_user_id()
              or t.created_by_id = app.current_user_id())
    )
  end
$function$;


-- -----------------------------------------------------------------------------
-- 8 · RLS
-- -----------------------------------------------------------------------------
-- Read follows the project: if you can see the project, you can see its
-- platforms, its team and its services. Write is Coordinator+, matching
-- `projects_update`, because these are commercial and staffing facts.

alter table public.project_platforms enable row level security;
alter table public.project_members   enable row level security;
alter table public.project_services  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['project_platforms','project_members','project_services']
  loop
    if not exists (select 1 from pg_policy where polname = t || '_select') then
      execute format(
        'create policy %I on public.%I for select to cni_app '
        'using (app.project_is_visible(project_id))', t || '_select', t);
    end if;

    if not exists (select 1 from pg_policy where polname = t || '_write') then
      execute format(
        'create policy %I on public.%I for all to cni_app '
        'using (app.sees_all_work()) with check (app.sees_all_work())',
        t || '_write', t);
    end if;

    execute format('grant select, insert, update, delete on public.%I to cni_app', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

drop trigger if exists project_services_touch_updated_at on public.project_services;
create trigger project_services_touch_updated_at
  before update on public.project_services
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 9 · SELF-CHECK
-- -----------------------------------------------------------------------------

do $$
declare
  v_member uuid; v_coord uuid; v_project uuid; v_platform uuid; n int; ok boolean;
begin
  select id into v_coord  from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_member from public.users where role = 'member' and is_active limit 1;
  select id into v_platform from public.platforms where slug = 'instagram';

  -- Structural: every column landed.
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='projects'
     and column_name in ('client_kind','client_id','package_id','monthly_fee_pkr',
                         'assets_target_min','assets_target_max','reels_target_min','renews_on');
  if n <> 8 then raise exception '033 · expected 8 new project columns, found %', n; end if;

  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='tasks'
     and column_name in ('platform_id','content_kind','published_on');
  if n <> 3 then raise exception '033 · task columns missing (found %)', n; end if;

  -- A backwards target range must be impossible.
  begin
    update public.projects
       set assets_target_min = 30, assets_target_max = 10
     where id = (select id from public.projects limit 1);
    raise exception '033 · a backwards target range was accepted';
  exception when check_violation then null;
  end;

  -- Reels cannot exceed the assets they sit inside.
  begin
    update public.projects
       set assets_target_min = 10, assets_target_max = 12, reels_target_min = 40
     where id = (select id from public.projects limit 1);
    raise exception '033 · reels exceeding assets was accepted';
  exception when check_violation then null;
  end;

  if v_coord is null or v_member is null then
    raise notice '033 · no coordinator/member to test visibility against';
    return;
  end if;

  -- ── THE BUG THIS FIXES: membership must confer visibility ─────────────────
  -- A project the member neither owns, created, nor has a task on.
  /* `projects_code_format` is `^[A-Z]{3}$` — exactly three uppercase letters. My
     first attempt used 'M033' and the whole migration correctly refused to
     commit, which is the self-check earning its keep on itself. */
  insert into public.projects (name, type, code, status, owner_id, created_by_id)
  values ('033 self-check', 'client', 'ZZZ', 'planning', v_coord, v_coord)
  returning id into v_project;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select app.project_is_visible(v_project) into ok;
  if ok then raise exception '033 · an unrelated member could already see the project'; end if;

  -- Name them on it. No task, no ownership — membership alone.
  reset role;
  insert into public.project_members (project_id, user_id, role, added_by_id)
  values (v_project, v_member, 'content', v_coord);

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select app.project_is_visible(v_project) into ok;
  if not ok then
    raise exception '033 · MEMBERSHIP DID NOT CONFER VISIBILITY — the fix does not work';
  end if;

  -- They can see the team, and cannot change it.
  select count(*) into n from public.project_members where project_id = v_project;
  if n <> 1 then raise exception '033 · a named member cannot see the team list'; end if;

  begin
    insert into public.project_platforms (project_id, platform_id)
    values (v_project, v_platform);
    raise exception '033 · A MEMBER ADDED A PLATFORM TO A PROJECT';
  exception when insufficient_privilege then null;
  end;

  -- A coordinator can.
  reset role;
  set local role cni_app;
  perform set_config('app.user_id', v_coord::text, true);
  insert into public.project_platforms (project_id, platform_id, assets_target, reels_target)
  values (v_project, v_platform, 12, 3);
  if not found then raise exception '033 · a coordinator could not add a platform'; end if;

  reset role;
  delete from public.projects where id = v_project;  -- cascades members + platforms
  if exists (select 1 from public.project_members where project_id = v_project) then
    raise exception '033 · project_members outlived its project';
  end if;

  raise notice '033 · projects wired: targets snapshotted, membership confers visibility';
end
$$;
