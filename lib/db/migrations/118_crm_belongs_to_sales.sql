-- ============================================================================
-- 118 · THE CRM BELONGS TO SALES — owner, 2026-09-10
-- ----------------------------------------------------------------------------
-- *"This whole CRM will be hidden by the other team members, except admin,
-- super admin, and these tester IDs that I have added, because these are in the
-- sales department so they can see. Other than that nobody can see."*
--
-- And on the Coordinator, asked directly because it reversed a recorded answer:
-- *"That was the team coordinator, not the sales manager. The team coordinator
-- will be part of a digital creator team. He will manage their tasks, all their
-- tasks will be visible to him. But for the salespersons or for the management
-- of the lead, all this CRM belongs to the sales manager and the salespersons.
-- Plus admin and super admin are by default added."*
--
-- ── ⚠️ THIS SUPERSEDES THE ANSWER OF 2026-09-09 ────────────────────────────
-- Q2 was answered *"Team Coordinator: yes, included"*, and migration 111 wrote
-- that into six policies as `acting_at_least('team_coordinator')`. The owner has
-- since separated the two jobs: Kashif Ayaz coordinates the DIGITAL team's
-- tasks, and has no lead work. So every CRM policy stops asking about rank and
-- asks about the department instead.
--
-- ⚠️ NOTHING ELSE THE COORDINATOR DOES IS TOUCHED. His task, workload and
-- approval powers live in their own policies and are untouched by this file —
-- the owner was explicit that *"all their tasks will be visible to him"*. What
-- changes is exactly one thing: he can no longer read 615 strangers' phone
-- numbers, because that was never his job.
--
-- ── ⚠️ WHY RANK IS THE WRONG QUESTION ALTOGETHER ───────────────────────────
-- `acting_at_least('team_coordinator')` is a LADDER: it lets in everybody at
-- that rank or above, which is the right shape for "may approve work" and the
-- wrong shape for "works in this department". Sales staff are `member` — the
-- bottom of the ladder — and belong; the Coordinator is above them and does not.
-- A ladder cannot express that. A department can.
--
-- ⚠️ AND THE SALES MANAGER IS STILL `member` IN `users.role`. ADR-002 fixed the
-- app at four ranks and this file does not add a fifth. Seniority INSIDE a
-- department is `users.department_role`, which is a different question from
-- authority over the application.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE TWO QUESTIONS EVERY CRM POLICY ASKS
-- ----------------------------------------------------------------------------
-- Written once, here, because the alternative is the same two clauses copied
-- into eleven policies — and a widening that reaches ten of them.
--
-- ⚠️ NO ARGUMENTS, AND STABLE, SO THEY COST ONE EVALUATION PER QUERY rather than
-- one per row. That is the distinction 114's header draws: a predicate that
-- depends on the ROW must stay inline, a predicate about the CALLER may be a
-- function. These are entirely about the caller.
-- ════════════════════════════════════════════════════════════════════════════

/** Everyone whose job is the whole pipeline: Admin, Super Admin, sales manager. */
create or replace function app.crm_sees_all_leads()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app.acting_at_least('admin'::public.user_role)
      or app.acting_manages_department('sales')
$$;

/** Everyone allowed into the CRM at all — the above, plus sales staff. */
create or replace function app.crm_is_open_to_caller()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app.acting_at_least('admin'::public.user_role)
      or app.acting_in_department('sales')
$$;

comment on function app.crm_sees_all_leads() is
  'Admin, Super Admin, or the manager of the sales department (118). ⚠️ Not the '
  'Team Coordinator — see the header of this migration.';

grant execute on function app.crm_sees_all_leads()    to cni_app;
grant execute on function app.crm_is_open_to_caller() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LEADS
-- ----------------------------------------------------------------------------
-- ⚠️ `owner_id = app.current_user_id()` STAYS INLINE and row-local. It is the
-- hot predicate on the only query this CRM runs at volume, and 114's header
-- explains at length why routing it through a function would turn one comparison
-- into an index probe per row.
--
-- ⚠️ AND A SALESPERSON MUST BE IN SALES TO SEE THEIR OWN LEADS. Without the
-- department clause, somebody moved out of sales would keep every lead still
-- carrying their name — which is precisely the moment access should stop.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    app.crm_sees_all_leads()
    or (app.acting_in_department('sales') and owner_id = app.current_user_id())
  );

/* Creating a lead by hand is the manager's and the Admin's. A salesperson works
   the leads the campaigns bring in; inventing one is a different act. */
drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert with check (app.crm_sees_all_leads());

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    app.crm_sees_all_leads()
    or (app.acting_in_department('sales') and owner_id = app.current_user_id())
  )
  with check (
    app.crm_sees_all_leads()
    or (app.acting_in_department('sales') and owner_id = app.current_user_id())
  );

/* ⚠️ Admin only, unchanged. A lead is the only copy of a real enquiry that will
   exist once Meta deletes it at 90 days — not even the sales manager. */
drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete using (app.acting_at_least('admin'::public.user_role));


-- ── The reader 114 built has to answer the same question ───────────────────
-- ⚠️ IT IS A DELIBERATE SECOND COPY OF THE RULE ABOVE, for the by-id case, and
-- 114's self-check proves the two agree. Changing the policy without changing
-- this would leave a salesperson able to read the NOTES on a lead they can no
-- longer read — the definer function bypasses RLS, so nothing else would stop it.
create or replace function app.crm_lead_is_visible(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p_lead_id is not null
     and (
       app.crm_sees_all_leads()
       or exists (
         select 1 from public.crm_leads l
          where l.id = p_lead_id
            and l.owner_id = app.current_user_id()
            and app.acting_in_department('sales')
       )
     );
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · CLIENTS, CAMPAIGNS, FORMS AND THE SYNC LOG
-- ----------------------------------------------------------------------------
-- ⚠️ `crm_campaigns_select` and `crm_lead_forms_select` used `project_is_visible`,
-- which is TRUE for any Coordinator and for any member of the project. That
-- would have left a video editor on Chitral Royal Homes able to read the
-- campaign and form names the moment they were linked. Harmless today because
-- `crm_campaigns` is empty; wrong the day Step 8 fills it.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists crm_clients_select on public.crm_clients;
create policy crm_clients_select on public.crm_clients
  for select using (
    app.crm_sees_all_leads()
    or (
      app.acting_in_department('sales')
      and exists (
        select 1 from public.crm_leads l
         where l.client_id = crm_clients.id and l.owner_id = app.current_user_id()
      )
    )
  );

drop policy if exists crm_clients_write on public.crm_clients;
create policy crm_clients_write on public.crm_clients
  for all using      (app.crm_sees_all_leads())
          with check (app.crm_sees_all_leads());

drop policy if exists crm_campaigns_select on public.crm_campaigns;
create policy crm_campaigns_select on public.crm_campaigns
  for select using (app.crm_is_open_to_caller());

drop policy if exists crm_campaigns_write on public.crm_campaigns;
create policy crm_campaigns_write on public.crm_campaigns
  for all using      (app.crm_sees_all_leads())
          with check (app.crm_sees_all_leads());

drop policy if exists crm_lead_forms_select on public.crm_lead_forms;
create policy crm_lead_forms_select on public.crm_lead_forms
  for select using (app.crm_is_open_to_caller());

drop policy if exists crm_lead_forms_write on public.crm_lead_forms;
create policy crm_lead_forms_write on public.crm_lead_forms
  for all using      (app.crm_sees_all_leads())
          with check (app.crm_sees_all_leads());

/* Whether the import is running is operational, not personal — anybody in the
   CRM should be able to see that leads have stopped arriving. */
drop policy if exists crm_lead_sync_runs_select on public.crm_lead_sync_runs;
create policy crm_lead_sync_runs_select on public.crm_lead_sync_runs
  for select using (app.crm_is_open_to_caller());


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ FIVE PEOPLE, FIVE SESSIONS, and the Coordinator is the one that matters —
-- he could read every lead an hour ago. Checking this as an Admin would pass
-- against the old policies too and prove nothing.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_coord   uuid;
  v_digital uuid;
  v_sales_m uuid;
  v_sales_p uuid;
  v_other_p uuid;
  v_project uuid;
  v_lead    uuid;
  n         integer;
begin
  select id into v_admin    from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_coord    from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_digital  from public.users where lower(email) = 'sayednajmullah@gmail.com';
  select id into v_sales_m  from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_sales_p  from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_other_p  from public.users where lower(email) = 'cniaidigitaldivision@gmail.com';
  select id into v_project  from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_sales_m is null or v_sales_p is null or v_other_p is null or v_project is null then
    raise notice '118 · the sales testers or Chitral are missing; policies applied untested';
    return;
  end if;

  /* One lead, belonging to ONE of the two salespeople. */
  insert into public.crm_leads (project_id, owner_id, source, external_id, full_name, submitted_at)
  values (v_project, v_sales_p, 'manual', '118-selfcheck-lead', '118 self-check', now())
  returning id into v_lead;

  set local role cni_app;

  -- 1 · The Admin sees it.
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then raise exception '118 · an admin cannot see a lead'; end if;

  -- 2 · The sales MANAGER sees it, though it is not his.
  perform set_config('app.user_id', v_sales_m::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then
    raise exception '118 · the sales manager cannot see a lead held by their own team';
  end if;

  -- 3 · The salesperson who HOLDS it sees it.
  perform set_config('app.user_id', v_sales_p::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then raise exception '118 · a salesperson cannot see their own lead'; end if;

  -- 4 · The OTHER salesperson does not.
  perform set_config('app.user_id', v_other_p::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 0 then
    raise exception '118 · a salesperson can read a colleague''s lead';
  end if;

  -- 5 · ⚠️ THE TEAM COORDINATOR CANNOT. This is the change this file exists for.
  if v_coord is not null then
    perform set_config('app.user_id', v_coord::text, true);
    select count(*) into n from public.crm_leads where id = v_lead;
    if n <> 0 then
      raise exception '118 · the team coordinator can still read leads';
    end if;

    select count(*) into n from public.crm_lead_sync_runs;
    if n <> 0 then
      raise exception '118 · the team coordinator can still read the import log';
    end if;
  end if;

  -- 6 · Nor can anybody else in digital.
  if v_digital is not null then
    perform set_config('app.user_id', v_digital::text, true);
    select count(*) into n from public.crm_leads where id = v_lead;
    if n <> 0 then
      raise exception '118 · a digital team member can read leads';
    end if;
  end if;

  -- 7 · ⚠️ AND THE NOTES FOLLOW THE LEAD. 114's reader bypasses RLS, so a rule
  --     changed in one place and not the other would leave a colleague's notes
  --     readable to somebody who cannot read the lead they are on.
  perform set_config('app.user_id', v_other_p::text, true);
  if app.crm_lead_is_visible(v_lead) then
    raise exception '118 · crm_lead_is_visible still says yes to the wrong salesperson';
  end if;

  perform set_config('app.user_id', v_sales_m::text, true);
  if not app.crm_lead_is_visible(v_lead) then
    raise exception '118 · crm_lead_is_visible says no to the sales manager';
  end if;

  -- 8 · The salesperson can work their own lead, and only within Step 6's columns.
  perform set_config('app.user_id', v_sales_p::text, true);
  update public.crm_leads set stage = 'contacted' where id = v_lead;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '118 · a salesperson cannot work the lead assigned to them';
  end if;

  -- 9 · ⚠️ AND STILL CANNOT HAND IT TO SOMEBODY ELSE. `owner_id` is not in
  --     116's column grant; Step 7 adds it with the rule that only the manager
  --     may reassign. Until then nobody can, which is the safe direction.
  begin
    update public.crm_leads set owner_id = v_other_p where id = v_lead;
    raise exception '118 · a salesperson was allowed to reassign a lead';
  exception when insufficient_privilege then
    null;
  end;

  reset role;

  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_leads          where id = v_lead;

  raise notice '118 · admin and the sales manager see every lead, a salesperson sees only theirs, and the coordinator sees none';
end $$;
