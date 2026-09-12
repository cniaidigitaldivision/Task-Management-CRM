-- ============================================================================
-- 125 · THE SALES TEAM CAN SEE WHICH PROJECT THEIR LEADS ARE ON — Step 9 prep
-- ----------------------------------------------------------------------------
-- ── ⚠️ THE THIRD TIME THIS EXACT SHAPE HAS APPEARED, AND IT WAS FOUND BY
--    ASKING THE DATABASE RATHER THAN BY READING THE CODE ────────────────────
-- `listCrmProjects` reads `public.projects`, whose policy is:
--
--     projects_select  →  app.project_is_visible(id)
--
-- which admits a Coordinator and above, a project's owner, its creator, its
-- MEMBERS, and anybody holding a task on it. A salesperson is none of those. So
-- after migration 124 the position was:
--
--     sale manager tester   leads visible: 615   projects in dropdown: 0
--     Sale Tester           leads visible:   0   projects in dropdown: 0
--
-- The desk would have rendered *"No projects are visible to you yet"* with six
-- hundred readable leads sitting behind it. Nothing leaked; the screen simply
-- could not find the project the leads belonged to.
--
-- ⚠️ THIS IS THE SAME FAILURE AS 105 AND 121, ON A THIRD TABLE. A correct
-- restriction on ONE table silently degrades a feature on ANOTHER, and it
-- degrades into a plausible-looking empty state rather than an error. Recorded
-- again because the lesson clearly has not finished arriving: **RLS fails
-- closed, and closed reads as "no data" rather than "not allowed."**
--
-- ⚠️ AND IT WOULD HAVE BEEN INVISIBLE FROM AN ADMIN SESSION, which is how both
-- earlier versions reached the owner. It was caught by counting, per person,
-- under each person's own session, on the live database.
--
-- ── WHY NOT WIDEN `projects_select` ────────────────────────────────────────
-- Because it would hand every project in the company to every salesperson —
-- budgets, credentials, membership — to solve a problem about a dropdown with
-- three fields in it. The narrow function that answers one question beats the
-- broad permission that answers it along with a hundred others. Migration 103
-- refused a general secret reader for the same reason.
-- ============================================================================

create or replace function app.crm_project_options()
returns table (
  id      uuid,
  name    text,
  code    text,
  leads   bigint,
  forms   bigint
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p.id, p.name, p.code,
         (select count(*) from public.crm_leads      l where l.project_id = p.id),
         (select count(*) from public.crm_lead_forms f where f.project_id = p.id)
    from public.projects p
   where p.is_draft = false
     /* ⚠️ THE WHOLE SECURITY OF THIS FUNCTION. RLS is bypassed below, so the
        caller's right to these projects is checked here, once, against the same
        predicate migration 124 put on `crm_leads`. A caller whose department
        owns nothing gets an empty set — the same answer the table would have
        given, for a better reason. */
     and app.crm_in_project_department(p.id)
   order by 4 desc, p.name
$$;

comment on function app.crm_project_options() is
  'Projects whose leads route to the caller''s department, with counts (125). '
  'SECURITY DEFINER because projects_select needs project MEMBERSHIP, which the '
  'sales team does not have — see this migration''s header.';

grant execute on function app.crm_project_options() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS UNDER EACH PERSON'S OWN SESSION. An Admin passes against the bug.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid;
  v_sm    uuid;
  v_sp    uuid;
  v_km    uuid;
  v_dev   uuid;
  n       integer;
  m       integer;
  v_name  text;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_sm  from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_sp  from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_km  from public.users where lower(email) = 'kk8464123@gmail.com';
  select id into v_dev from public.users where lower(email) = 'laraibrafique090@gmail.com';

  if v_admin is null or v_sm is null or v_sp is null or v_km is null then
    raise notice '125 · people missing; the reader was created untested';
    return;
  end if;

  set local role cni_app;

  -- 1 · ⚠️ THE BUG ITSELF, ASSERTED. Through the table a salesperson sees no
  --     Chitral; through the reader they do. If the first ever stops being true
  --     this function is redundant and should be deleted.
  perform set_config('app.user_id', v_sp::text, true);

  select count(*) into n from public.projects p
   where p.name = 'Chitral Royal Homes' and app.crm_in_project_department(p.id);
  if n <> 0 then
    raise exception
      '125 · a salesperson can now read projects directly — this reader is redundant and projects_select must be re-examined';
  end if;

  select count(*) into m from app.crm_project_options() where name = 'Chitral Royal Homes';
  if m <> 1 then
    raise exception '125 · a salesperson still cannot see the project their leads are on';
  end if;

  -- 2 · And it carries the count the dropdown prints.
  select leads into n from app.crm_project_options() where name = 'Chitral Royal Homes';
  if n < 1 then
    raise exception '125 · the project came back with no lead count';
  end if;

  -- 3 · ⚠️ AND ONLY THEIR OWN DEPARTMENT'S. A salesperson offered the ERP
  --     project would pick a dropdown entry whose table they cannot read.
  select count(*) into n from app.crm_project_options() where name = 'Internal CRM';
  if n <> 0 then
    raise exception '125 · a salesperson is offered another department''s project';
  end if;

  -- 4 · Kashif gets AI & Digital's, and not Chitral.
  perform set_config('app.user_id', v_km::text, true);
  select count(*) into n from app.crm_project_options() where name = 'Internal CRM';
  if n <> 1 then
    raise exception '125 · the AI & Digital manager is not offered his own project';
  end if;
  select count(*) into n from app.crm_project_options() where name = 'Chitral Royal Homes';
  if n <> 0 then
    raise exception '125 · the AI & Digital manager is offered Chitral';
  end if;

  -- 5 · Development owns no leads, so it gets an empty dropdown rather than a
  --     confusing partial one.
  if v_dev is not null then
    perform set_config('app.user_id', v_dev::text, true);
    select count(*) into n from app.crm_project_options();
    if n <> 0 then
      raise exception '125 · somebody in Development is offered a lead project';
    end if;
  end if;

  -- 6 · An Admin sees every live project.
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from app.crm_project_options();
  reset role;
  select count(*) into m from public.projects where not is_draft;
  if n <> m then
    raise exception '125 · an admin is offered % of % live projects', n, m;
  end if;

  -- 7 · ⚠️ AND A `tool` PROJECT IS AMONG THEM. `listCrmProjects` excluded them
  --     with the note "a product has no leads and never will" — untrue the
  --     moment the division advertises its own ERP.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from app.crm_project_options() o
    join public.projects p on p.id = o.id where p.type = 'tool';
  reset role;
  if n < 1 then
    raise exception '125 · the division''s own products are still hidden from the desk';
  end if;

  raise notice '125 · the sales team can see the project their leads are on, and only their own department''s';
end $$;
