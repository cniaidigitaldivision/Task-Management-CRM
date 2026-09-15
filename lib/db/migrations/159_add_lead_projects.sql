-- ============================================================================
-- 159 · WHICH PROJECTS MAY I ADD A LEAD TO?
-- ----------------------------------------------------------------------------
-- ⚠️ THE SEVENTH TIME THIS BUG HAS BEEN WRITTEN, and migration 125 left a note
-- on the wall about it:
--
--     *"`projects_select` is `app.project_is_visible(id)`, which needs project
--     MEMBERSHIP — and the sales team are not members of Chitral. Read directly,
--     this returned ZERO rows for the sales manager while they could read all
--     615 leads."*
--
-- The Add Lead picker was written as a plain query on `public.projects` with the
-- department rule in its WHERE clause. RLS is applied FIRST, so the department
-- rule never ran: the picker was empty for both salespeople, and the form that
-- depends on it could not be used at all. Measured, not assumed —
-- `scripts/check-add-lead.mjs` reported "0 project(s) in her picker".
--
-- ⚠️ THE SHAPE OF THE MISTAKE IS ALWAYS THE SAME. A correct predicate written
-- one layer above the one that filters. It cannot be caught from an Admin
-- session, because an Admin passes `project_is_visible` and sees a picker that
-- works perfectly.
--
-- ── WHY NOT REUSE `app.crm_project_options()` (125) ─────────────────────────
-- Different question. That one answers "which projects have leads I can see",
-- and a project with no leads yet — a new one, which is exactly when somebody
-- types the first lead in by hand — would be missing from it. This asks the
-- question the WRITE will ask, so the picker and the creator cannot disagree.
-- ============================================================================

create or replace function app.crm_add_lead_projects()
returns table (id uuid, name text)
language sql
security definer
set search_path = public, app, pg_temp
stable
as $fn$
  select p.id, p.name
    from public.projects p
   where p.lead_department_id is not null
     /* ⚠️ THE CREATOR'S OWN GATE, asked here in the same words. A picker that
        offers a project `app.crm_create_lead` then refuses with CRM02 is a form
        that lies about its own choices. */
     and (app.crm_in_project_department(p.id) or app.crm_manages_project(p.id))
   order by p.name
$fn$;

comment on function app.crm_add_lead_projects() is
  'Projects this person may add a lead to. ⚠️ A DEFINER because projects_select '
  'needs project MEMBERSHIP, which the sales team do not have — read directly it '
  'returns zero rows and the Add Lead form has no projects at all. Seventh '
  'instance of that bug; see migration 125. Migration 159.';

revoke all on function app.crm_add_lead_projects() from public;
grant execute on function app.crm_add_lead_projects() to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
-- ⚠️ RUN AS EACH REAL PERSON. The bug this fixes is invisible from any session
-- that can already see every project, which is every session a migration
-- normally runs in.
-- ============================================================================
do $chk$
declare
  v_project uuid; v_person uuid; v_name text; v_outsider uuid;
  n_direct int; n_reader int;
begin
  select p.id into v_project from public.projects p
    join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;

  if v_project is null then
    raise notice '159 · no demo sales project — function created, nothing to measure';
    return;
  end if;

  select e.user_id, e.full_name into v_person, v_name
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;

  if v_person is null then
    raise notice '159 · nobody eligible — function created, nothing to measure';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_person::text, true);

  /* 1 · ⚠️ THE READER FINDS IT. This is the assertion that was failing. */
  select count(*) into n_reader from app.crm_add_lead_projects() where id = v_project;

  /* 2 · ⚠️ AND THE PLAIN QUERY STILL DOES NOT — which is the proof that the
         definer is doing the work, rather than the policy having quietly
         widened underneath and made the whole function unnecessary. If this
         ever returns 1, the membership rule changed and somebody should be told
         rather than left with a definer nobody can justify. */
  select count(*) into n_direct from public.projects p
   where p.id = v_project
     and p.lead_department_id is not null
     and (app.crm_in_project_department(p.id) or app.crm_manages_project(p.id));

  reset role;

  if n_reader <> 1 then
    raise exception '159 · % still cannot see the demo project in the Add Lead picker', v_name;
  end if;

  if n_direct <> 0 then
    raise notice '159 · NOTE: the plain query now returns the project for %, so projects_select has widened since 125', v_name;
  end if;

  /* 3 · ⚠️ AND IT IS NOT A LIST OF EVERY PROJECT. A definer that forgot its
         filter would pass check 1 and hand a salesperson the whole company. */
  select u.id into v_outsider from public.users u
    join public.projects p on p.id = v_project
   where u.is_active and u.department_id is distinct from p.lead_department_id
   limit 1;

  if v_outsider is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_outsider::text, true);
    select count(*) into n_reader from app.crm_add_lead_projects() where id = v_project;
    reset role;
    if n_reader <> 0 then
      raise exception '159 · somebody outside the sales department is offered the demo project';
    end if;
  end if;

  raise notice '159 · % can now see the demo project in the picker, and somebody outside sales cannot', v_name;
end $chk$;
