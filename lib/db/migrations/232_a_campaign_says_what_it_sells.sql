-- ============================================================================
-- 232 · A CAMPAIGN SAYS WHAT IT SELLS, AND WHO ANSWERS ITS NEW LEADS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21: *"I am running a campaign for a CRM with the name CRM. I
-- will upload all the documents relevant to the CRM"* and, the day before,
-- *"when the first greeting message is sent and the client replies, auto AI
-- responding is on."*
--
-- Two settings per project, set from "What the agent knows":
--   · `product`            — what the campaign sells (227). A lead from it is a
--                            CRM lead without anybody tagging it one by one.
--   · `agent_mode_default` — who answers a NEW lead: My reply, Suggestions, or
--                            the AI agent (212's trigger applies it on arrival).
--
-- ⚠️ THROUGH A DEFINER, AND ONLY FOR A MANAGER. `crm_project_settings` has a
-- select policy and nothing else; every write is a function that says who may.
-- Turning the agent on for a whole campaign decides who talks to every client it
-- brings in, which is a manager's call, not any salesperson's.
-- ============================================================================

create or replace function app.crm_set_agent_settings(
  p_project uuid,
  p_product text,
  p_mode text
) returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  if not (app.acting_at_least('admin'::public.user_role)
          or app.crm_manages_project(p_project)
          or app.crm_manages_own_department()) then
    raise exception 'Only a sales manager or an admin can change what a campaign sells or who answers it.'
      using errcode = 'CRM95';
  end if;
  if p_mode is not null and p_mode not in ('off', 'suggest', 'agent') then
    raise exception 'unknown reply mode %', p_mode;
  end if;
  if p_product is not null and p_product not in ('taskly', 'crm', 'erp', 'whatsapp') then
    raise exception 'unknown product %', p_product;
  end if;

  /* ⚠️ THE AGENT CANNOT BE THE DEFAULT FOR A CAMPAIGN IT KNOWS NOTHING ABOUT. The
     same condition setAgentModeAction applies to one lead, here for all of them. */
  if p_mode = 'agent' and app.crm_agent_ready(p_project) = 0 then
    raise exception 'Approve at least one answer for this project before the AI agent can answer its new leads.'
      using errcode = 'CRM96';
  end if;

  insert into public.crm_project_settings (project_id, product, agent_mode_default)
  values (p_project, p_product::public.crm_product, coalesce(p_mode, 'off')::public.crm_agent_mode)
  on conflict (project_id) do update
     set product = excluded.product,
         agent_mode_default = excluded.agent_mode_default,
         updated_at = now();
  return true;
end;
$fn$;

grant execute on function app.crm_set_agent_settings(uuid, text, text) to cni_app;

/* A document's product can be corrected after upload — a proposal filed as
   "all products" that is really about the CRM. */
create or replace function app.crm_set_document_product(p_document uuid, p_product text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_n integer;
begin
  if not app.crm_is_open_to_caller() then
    return false;
  end if;
  if p_product not in ('any', 'taskly', 'crm', 'erp', 'whatsapp') then
    raise exception 'unknown product %', p_product;
  end if;
  update public.crm_documents
     set product = p_product::public.crm_product
   where id = p_document and lead_id is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_set_document_product(uuid, text) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_admin uuid; v_member uuid;
  v_refused boolean := false; v_empty_refused boolean := false;
  v_after text; v_had_knowledge integer;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_admin from public.users u where u.is_active and u.role in ('admin', 'super_admin') limit 1;
  /* A salesperson who manages nothing — asked of the same functions the rule
     uses, rather than guessed from a column. */
  for v_member in
    select u.id from public.users u join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.is_active and u.role = 'member'
  loop
    perform set_config('app.user_id', v_member::text, true);
    exit when not app.crm_manages_own_department() and not app.crm_manages_project(v_project);
    v_member := null;
  end loop;
  if v_project is null or v_admin is null then
    raise exception '232 · fixtures missing';
  end if;

  begin
    /* A salesperson may not switch a whole campaign over. */
    if v_member is not null then
      perform set_config('app.user_id', v_member::text, true);
      begin
        perform app.crm_set_agent_settings(v_project, 'crm', 'suggest');
      exception when sqlstate 'CRM95' then
        v_refused := true;
      end;
    else
      v_refused := true;
    end if;

    /* An admin may — but not to the agent while nothing is approved. */
    perform set_config('app.user_id', v_admin::text, true);
    select app.crm_agent_ready(v_project) into v_had_knowledge;
    update public.crm_knowledge set status = 'draft' where project_id = v_project and status = 'approved';
    begin
      perform app.crm_set_agent_settings(v_project, 'crm', 'agent');
    exception when sqlstate 'CRM96' then
      v_empty_refused := true;
    end;

    perform app.crm_set_agent_settings(v_project, 'crm', 'suggest');
    select agent_mode_default::text into v_after from public.crm_project_settings where project_id = v_project;

    raise exception using errcode = 'P0232', message = '232 rollback';
  exception when sqlstate 'P0232' then
    null;
  end;

  if not v_refused then
    raise exception '232 · a salesperson changed a whole campaign''s reply mode';
  end if;
  if not v_empty_refused then
    raise exception '232 · the agent was made the default for a project with nothing approved';
  end if;
  if v_after is distinct from 'suggest' then
    raise exception '232 · an admin could not save the campaign settings (got %)', v_after;
  end if;

  raise notice '232 · a manager sets what a campaign sells and who answers it — never the agent with nothing to say';
end $chk$;
