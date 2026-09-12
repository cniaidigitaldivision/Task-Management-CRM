-- ============================================================================
-- 124 · A LEAD BELONGS TO A DEPARTMENT, NOT TO SALES — owner, 2026-09-10
-- ----------------------------------------------------------------------------
-- *"The Chitral lead will definitely be sent to the sales team. The system
-- should be intelligent enough to know whether this lead is a sales lead or a
-- lead from this project and whether this will be handled by the sales team.
-- This is the ERP lead so this lead will be handled by [the team lead]. This is
-- the CRM and automation lead so this will be handled by the developer team…
-- you should know, or the system should know or be smart enough to know, which
-- campaign these leads are coming from and which project they are from. Who
-- will lead or deal with these leads?"*
--
-- ── ⚠️ THIS REPLACES THE RULE MIGRATION 118 WROTE, AND 118 WAS TOO NARROW ──
-- 118 put `d.key = 'sales'` into eleven policies and two helpers, on the owner's
-- instruction at the time: *"all this CRM belongs to the sales manager and the
-- salespersons."* That was true of the only project with leads. It stops being
-- true the moment the division advertises its OWN products — an ERP enquiry is
-- not sales work, and the person best placed to answer it is the one who knows
-- what the system does.
--
-- So the question a policy asks changes from **"are you in Sales?"** to
-- **"does this lead's project belong to your department?"** Sales keeps every
-- lead it has today, because Chitral routes to Sales; nothing narrows.
--
-- ── ⚠️ A COLUMN ON `projects`, NOT A ROUTING TABLE ─────────────────────────
-- One project's leads go to one department. A join table would allow two, which
-- is not a capability anybody asked for and is a way for a lead to be visible to
-- two teams and worked by neither.
--
-- ⚠️ AND NO CAMPAIGN-LEVEL OVERRIDE, DELIBERATELY. Offered and declined: the
-- owner chose *"AI & Digital owns them, under Kashif"* over *"split by campaign"*.
-- `crm_campaigns` is also still empty. When one page ever runs campaigns for two
-- departments, this is the column that gains a sibling — and until then a second
-- routing rule would be a second thing that can disagree.
--
-- ── ⚠️ NULL MEANS ADMIN ONLY, AND THAT IS THE DANGEROUS DEFAULT ────────────
-- An unrouted project's leads are invisible to everybody but Admin. That fails
-- closed, which is right for access — and it is exactly how leads arrive and are
-- never worked. Every project that exists today is routed below for that reason,
-- and the seeding note says which of those are DECISIONS and which are
-- DEFAULTS the owner should correct.
-- ============================================================================

alter table public.projects
  add column if not exists lead_department_id uuid
    references public.departments(id) on delete set null;

create index if not exists projects_lead_department_idx
  on public.projects (lead_department_id);

comment on column public.projects.lead_department_id is
  'Which department works this project''s incoming leads (124). NULL means '
  'nobody but Admin can see them — safe, but they will not be worked.';


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE CALLER, ONCE PER QUERY
-- ----------------------------------------------------------------------------
-- ⚠️ NO ARGUMENTS AND STABLE, so each costs ONE evaluation for a whole query
-- rather than one per row. That distinction is why the row-local part of the
-- policy below stays inline — the trap 114's header sets out at length.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.acting_department_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select u.department_id from public.users u
   where u.id = app.current_user_id() and u.is_active
$$;

create or replace function app.acting_leads_a_department()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select u.department_role = 'manager' from public.users u
      where u.id = app.current_user_id() and u.is_active and u.department_id is not null),
    false
  )
$$;

grant execute on function app.acting_department_id()       to cni_app;
grant execute on function app.acting_leads_a_department()  to cni_app;


-- ── The two questions, now asked about a PROJECT ───────────────────────────
-- ⚠️ `crm_sees_all_leads()` KEEPS ITS NAME AND LOSES ITS MEANING, so it is
-- replaced rather than edited: a global "can see everything" no longer exists,
-- because seeing everything depends on which project is asked about. Anything
-- still calling the old one would compile and be wrong, so it is dropped.
-- ⚠️ EVERY DEPENDENT POLICY GOES FIRST. PostgreSQL refuses to drop a function a
-- policy references — and `DROP … CASCADE`, which the error helpfully suggests,
-- would silently take the policies with it and leave the tables OPEN if anything
-- below this line failed. Dropping them explicitly means the same transaction
-- that removes them puts them back, or none of it commits.
drop policy if exists crm_leads_select         on public.crm_leads;
drop policy if exists crm_leads_insert         on public.crm_leads;
drop policy if exists crm_leads_update         on public.crm_leads;
drop policy if exists crm_clients_select       on public.crm_clients;
drop policy if exists crm_clients_write        on public.crm_clients;
drop policy if exists crm_campaigns_select     on public.crm_campaigns;
drop policy if exists crm_campaigns_write      on public.crm_campaigns;
drop policy if exists crm_lead_forms_select    on public.crm_lead_forms;
drop policy if exists crm_lead_forms_write     on public.crm_lead_forms;
drop policy if exists crm_lead_sync_runs_select on public.crm_lead_sync_runs;

drop function if exists app.crm_sees_all_leads();
drop function if exists app.crm_is_open_to_caller();

/** Do you run the department this project's leads belong to? */
create or replace function app.crm_manages_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or (
        app.acting_leads_a_department()
        and exists (
          select 1 from public.projects p
           where p.id = p_project
             and p.lead_department_id = app.acting_department_id()
        )
      )
$$;

/** Are you in the department this project's leads belong to, at all? */
create or replace function app.crm_in_project_department(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or exists (
        select 1 from public.projects p
         where p.id = p_project
           and p.lead_department_id is not null
           and p.lead_department_id = app.acting_department_id()
      )
$$;

/** May you reach the CRM at all — any project routed to your department? */
create or replace function app.crm_is_open_to_caller()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or (
        app.acting_department_id() is not null
        and exists (
          select 1 from public.projects p
           where p.lead_department_id = app.acting_department_id()
        )
      )
$$;

comment on function app.crm_manages_project(uuid) is
  'Admin, or the manager of the department this project''s leads route to (124). '
  'Replaces 118''s crm_sees_all_leads(), which asked only about Sales.';

grant execute on function app.crm_manages_project(uuid)       to cni_app;
grant execute on function app.crm_in_project_department(uuid) to cni_app;
grant execute on function app.crm_is_open_to_caller()         to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE POLICIES, ASKING THE NEW QUESTION
-- ----------------------------------------------------------------------------
-- ⚠️ `project_id` IS A COLUMN ON THE ROW, so the `exists` below is one primary-
-- key lookup per row — index-only, and cheap enough on the 25-row page and the
-- 615-row count that back this desk. What is NOT per-row is the caller: both
-- helpers above are argument-free and STABLE, so the expensive halves are
-- evaluated once.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    app.crm_manages_project(project_id)
    or (app.crm_in_project_department(project_id) and owner_id = app.current_user_id())
  );

drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert with check (app.crm_manages_project(project_id));

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    app.crm_manages_project(project_id)
    or (app.crm_in_project_department(project_id) and owner_id = app.current_user_id())
  )
  with check (
    app.crm_manages_project(project_id)
    or (app.crm_in_project_department(project_id) and owner_id = app.current_user_id())
  );

/* Unchanged: Admin only. A lead is the only copy of a real enquiry that will
   exist once Meta deletes it at 90 days — not even a department manager. */
drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete using (app.acting_at_least('admin'::public.user_role));


-- ── The by-id reader 114 built, and 118's copy of the rule ─────────────────
create or replace function app.crm_lead_is_visible(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.crm_leads l
     where l.id = p_lead_id
       and (
         app.crm_manages_project(l.project_id)
         or (app.crm_in_project_department(l.project_id)
             and l.owner_id = app.current_user_id())
       )
  );
$$;

-- ── 121's owner-name reader ─────────────────────────────────────────────────
create or replace function app.crm_lead_owners()
returns table (id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select distinct u.id, u.full_name, u.avatar_url
    from public.crm_leads l
    join public.users u on u.id = l.owner_id
   where app.crm_manages_project(l.project_id)
      or (app.crm_in_project_department(l.project_id)
          and l.owner_id = app.current_user_id())
$$;

-- ── 120's reassign guard ────────────────────────────────────────────────────
create or replace function app.crm_guard_reassign()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    /* The importer runs with no session and must pass — see 120's note. */
    if app.current_user_id() is not null
       and not app.crm_manages_project(new.project_id) then
      raise exception
        'Only the manager of the department this project belongs to, or an Admin, can hand out its leads.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;


-- ── Campaigns, forms, clients and the sync log ─────────────────────────────
drop policy if exists crm_campaigns_select on public.crm_campaigns;
create policy crm_campaigns_select on public.crm_campaigns
  for select using (app.crm_in_project_department(project_id));

drop policy if exists crm_campaigns_write on public.crm_campaigns;
create policy crm_campaigns_write on public.crm_campaigns
  for all using (app.crm_manages_project(project_id))
          with check (app.crm_manages_project(project_id));

drop policy if exists crm_lead_forms_select on public.crm_lead_forms;
create policy crm_lead_forms_select on public.crm_lead_forms
  for select using (app.crm_in_project_department(project_id));

drop policy if exists crm_lead_forms_write on public.crm_lead_forms;
create policy crm_lead_forms_write on public.crm_lead_forms
  for all using (app.crm_manages_project(project_id))
          with check (app.crm_manages_project(project_id));

/* ⚠️ `crm_clients` HAS NO `project_id` — deliberately, since 111: one person who
   enquires about two things is one client. So its rule is "any lead of theirs
   you can read", which is the same shape it had and now follows the new rule
   automatically through `crm_leads`. */
drop policy if exists crm_clients_select on public.crm_clients;
create policy crm_clients_select on public.crm_clients
  for select using (
    exists (
      select 1 from public.crm_leads l where l.client_id = crm_clients.id
    )
  );

drop policy if exists crm_clients_write on public.crm_clients;
create policy crm_clients_write on public.crm_clients
  for all using      (app.crm_is_open_to_caller())
          with check (app.crm_is_open_to_caller());

drop policy if exists crm_lead_sync_runs_select on public.crm_lead_sync_runs;
create policy crm_lead_sync_runs_select on public.crm_lead_sync_runs
  for select using (app.crm_is_open_to_caller());


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE ROTA AND THE ROSTER, PER PROJECT
-- ----------------------------------------------------------------------------
-- ⚠️ BOTH TAKE A PROJECT NOW, so the old signatures are dropped rather than
-- overloaded: an argument-less call would still resolve and would hand an ERP
-- lead to a salesperson.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists app.crm_next_owner();
drop function if exists app.crm_sales_roster();

create or replace function app.crm_next_owner(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id
    from public.users u
    join public.projects p on p.id = p_project
   where u.department_id = p.lead_department_id
     and u.is_active
     and u.department_role = 'member'    -- the manager runs the rota
   order by
     /* Fewest OPEN leads ON THIS PROJECT. ⚠️ Scoped to the project on purpose:
        somebody carrying forty Chitral leads should not be skipped for an ERP
        enquiry their department is separately responsible for. */
     (select count(*) from public.crm_leads l
       where l.owner_id = u.id and l.project_id = p_project
         and l.stage not in ('won', 'lost')) asc,
     (select max(a.occurred_at) from public.crm_lead_activity a
       where a.kind = 'assigned' and (a.detail->>'to')::uuid = u.id) asc nulls first,
     u.full_name
   limit 1
$$;

create or replace function app.crm_project_roster(p_project uuid)
returns table (
  user_id     uuid,
  full_name   text,
  avatar_url  text,
  is_manager  boolean,
  open_leads  bigint,
  total_leads bigint,
  won_leads   bigint,
  last_given  timestamptz,
  median_response_minutes numeric
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.full_name, u.avatar_url,
         u.department_role = 'manager',
         (select count(*) from public.crm_leads l
           where l.owner_id = u.id and l.project_id = p_project
             and l.stage not in ('won', 'lost')),
         (select count(*) from public.crm_leads l
           where l.owner_id = u.id and l.project_id = p_project),
         (select count(*) from public.crm_leads l
           where l.owner_id = u.id and l.project_id = p_project and l.stage = 'won'),
         (select max(a.occurred_at) from public.crm_lead_activity a
           where a.kind = 'assigned' and (a.detail->>'to')::uuid = u.id),
         (select percentile_cont(0.5) within group (
                   order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
            from public.crm_leads l
           where l.owner_id = u.id and l.project_id = p_project
             and l.first_contacted_at is not null)
    from public.users u
    join public.projects p on p.id = p_project
   where u.department_id = p.lead_department_id
     and u.is_active
     /* ⚠️ The guard stays INSIDE, because definer bypasses RLS: without it a
        salesperson could read colleagues' response times and win counts. */
     and app.crm_manages_project(p_project)
   order by u.department_role desc, u.full_name
$$;

grant execute on function app.crm_next_owner(uuid)     to cni_app;
grant execute on function app.crm_project_roster(uuid) to cni_app;


-- ── 123's neglect alert, per department manager ────────────────────────────
create or replace function app.crm_notify_neglect(p_days integer default 5)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r       record;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  n_sent  integer := 0;
begin
  /* ⚠️ ONE PASS PER MANAGER PER PERSON THEY MANAGE. 123 looked up "the sales
     manager"; now every department that owns leads has its own, and a manager
     hears only about their own department's projects. */
  for r in
    select mgr.id as manager_id,
           l.owner_id,
           u.full_name,
           count(*) as stale
      from public.crm_leads l
      join public.projects p on p.id = l.project_id
      join public.users mgr on mgr.department_id = p.lead_department_id
                           and mgr.department_role = 'manager'
                           and mgr.is_active
      join public.users u on u.id = l.owner_id
     where l.owner_id is not null
       and l.owner_id <> mgr.id
       and l.stage not in ('won', 'lost')
       and u.is_active
       and not exists (
         select 1 from public.crm_lead_activity a
          where a.lead_id = l.id
            and a.kind <> 'imported'
            and a.occurred_at > now() - make_interval(days => p_days)
       )
     group by mgr.id, l.owner_id, u.full_name
  loop
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.manager_id
         and n.kind = 'lead_neglected'
         and n.entity_id = r.owner_id
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    if not app.wants_in_app(r.manager_id, 'lead_neglected') then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (
      r.manager_id, 'lead_neglected',
      r.stale || case when r.stale = 1 then ' lead of ' else ' leads of ' end
        || r.full_name || ' have gone quiet',
      'No call, message or note on them for ' || p_days || ' days.',
      '/leads', r.owner_id
    );

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · WHERE EACH PROJECT'S LEADS GO
-- ----------------------------------------------------------------------------
-- ⚠️ TWO OF THESE ARE DECISIONS AND THE REST ARE DEFAULTS, and the difference
-- matters because a default that is wrong sends a stranger's enquiry to the
-- wrong team rather than to nobody:
--
--   DECIDED by the owner, 2026-09-10:
--     · Chitral Royal Homes            → Sales   ("the Chitral lead will
--                                                  definitely be sent to sales")
--     · AI & Digital's own products    → AI & Digital, under Kashif Ayaz
--       (ERP, CRM, automation — *"AI & Digital owns them, under Kashif"*)
--
--   DEFAULTED to Sales, and the owner should correct any that are wrong:
--     every other client, event and marketing project. They have no leads today,
--     so nothing is misrouted yet — but leaving them NULL would mean their first
--     lead arrives invisible to everybody but an Admin, and invisible is worse
--     than in-the-wrong-inbox.
--
-- ⚠️ `type = 'tool'` PROJECTS ARE ROUTED, AND THAT CORRECTS A COMMENT OF MINE.
-- `listCrmProjects` excludes them with the note *"a product has no leads and
-- never will."* The owner is about to advertise the ERP and the CRM, both of
-- which ARE tool projects — so their leads would have imported and then been
-- invisible. The exclusion is removed in the same change as this.
-- ════════════════════════════════════════════════════════════════════════════
update public.projects p
   set lead_department_id = (select d.id from public.departments d where d.key = 'digital')
 where p.lead_department_id is null
   and (p.type = 'tool' or p.name = 'AI & Digital Division');

update public.projects p
   set lead_department_id = (select d.id from public.departments d where d.key = 'sales')
 where p.lead_department_id is null;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ THE POINT IS THAT SALES LOSES NOTHING AND GAINS NOTHING. Chitral routes to
-- Sales, so every person who could read a lead an hour ago still can, and nobody
-- new can. A refactor of eleven policies that quietly widened access would be
-- the worst possible outcome of a file whose purpose is routing.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  v_sm     uuid;   -- sales manager
  v_sp     uuid;   -- salesperson
  v_km     uuid;   -- Kashif, AI & Digital manager
  v_dev    uuid;   -- a developer
  v_chit   uuid;
  v_tool   uuid;
  v_lead   uuid;
  v_erp    uuid;
  v_pick   uuid;
  n        integer;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_sm  from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_sp  from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_km  from public.users where lower(email) = 'kk8464123@gmail.com';
  select id into v_dev from public.users where lower(email) = 'laraibrafique090@gmail.com';
  select id into v_chit from public.projects where name = 'Chitral Royal Homes' limit 1;
  select id into v_tool from public.projects where type = 'tool' limit 1;

  if v_admin is null or v_sm is null or v_sp is null or v_km is null or v_chit is null or v_tool is null then
    raise notice '124 · people or projects missing; routing applied untested';
    return;
  end if;

  -- 1 · Every project is routed. An unrouted one takes leads nobody can see.
  select count(*) into n from public.projects where lead_department_id is null and not is_draft;
  if n <> 0 then
    raise exception '124 · % live projects have no department; their leads would be invisible', n;
  end if;

  insert into public.crm_leads (project_id, owner_id, source, external_id, full_name, submitted_at)
  values (v_chit, v_sp, 'manual', '124-chitral', '124 chitral', now()) returning id into v_lead;
  insert into public.crm_leads (project_id, source, external_id, full_name, submitted_at)
  values (v_tool, 'manual', '124-erp', '124 erp', now()) returning id into v_erp;

  set local role cni_app;

  -- 2 · ⚠️ SALES KEEPS WHAT IT HAD. The manager still sees the Chitral lead.
  perform set_config('app.user_id', v_sm::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then
    raise exception '124 · the sales manager lost sight of a Chitral lead';
  end if;

  -- 3 · And still cannot see a lead belonging to AI & Digital.
  select count(*) into n from public.crm_leads where id = v_erp;
  if n <> 0 then
    raise exception '124 · the sales manager can read another department''s lead';
  end if;

  -- 4 · The salesperson still sees their own and nothing else.
  perform set_config('app.user_id', v_sp::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then
    raise exception '124 · a salesperson lost their own lead';
  end if;
  select count(*) into n from public.crm_leads where id = v_erp;
  if n <> 0 then
    raise exception '124 · a salesperson can read an ERP lead';
  end if;

  -- 5 · ⚠️ THE NEW CAPABILITY. Kashif runs AI & Digital, so the ERP lead is his
  --     — and the Chitral lead is still not.
  perform set_config('app.user_id', v_km::text, true);
  select count(*) into n from public.crm_leads where id = v_erp;
  if n <> 1 then
    raise exception '124 · the AI & Digital manager cannot see his own department''s lead';
  end if;
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 0 then
    raise exception '124 · the AI & Digital manager can read a Chitral lead';
  end if;

  -- 6 · A developer is in Development, which owns no project — so no leads.
  if v_dev is not null then
    perform set_config('app.user_id', v_dev::text, true);
    select count(*) into n from public.crm_leads;
    if n <> 0 then
      raise exception '124 · somebody in Development can read leads';
    end if;
  end if;

  -- 7 · ⚠️ AND THE ROTA IS PER PROJECT. Chitral's rota returns a salesperson,
  --     never somebody from another department.
  --
  --     ⚠️ THE ANSWER IS CAPTURED UNDER THE MANAGER'S SESSION AND CHECKED
  --     OUTSIDE IT. The first version verified the pick with a join to `users`
  --     and `departments` while still acting as the sales manager — and
  --     `users_select` shows a manager exactly ONE row of the staff table, their
  --     own, so the join found nothing and the check failed against a rota that
  --     was correct. That is the same trap 121 exists to fix, arriving here in a
  --     verification query rather than in a feature. Reading a team through RLS
  --     while acting as somebody who cannot see the team proves nothing.
  perform set_config('app.user_id', v_sm::text, true);
  select app.crm_next_owner(v_chit) into v_pick;
  reset role;

  if v_pick is null then
    raise exception '124 · Chitral''s rota returned nobody';
  end if;
  select count(*) into n
    from public.users u join public.departments d on d.id = u.department_id
   where u.id = v_pick and d.key = 'sales';
  if n <> 1 then
    raise exception '124 · Chitral''s rota picked somebody outside Sales';
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_sm::text, true);

  -- 8 · The sales manager cannot read the AI & Digital roster.
  select count(*) into n from app.crm_project_roster(v_tool);
  if n <> 0 then
    raise exception '124 · the sales manager can read another department''s roster';
  end if;

  -- 9 · Kashif can read his own.
  perform set_config('app.user_id', v_km::text, true);
  select count(*) into n from app.crm_project_roster(v_tool);
  if n < 1 then
    raise exception '124 · the AI & Digital manager cannot read his own roster';
  end if;

  reset role;

  delete from public.crm_lead_activity where lead_id in (v_lead, v_erp);
  delete from public.crm_leads where id in (v_lead, v_erp);

  raise notice '124 · leads route by project; Sales keeps Chitral, AI & Digital gets its own products, and nobody gained anything else';
end $$;
