-- ============================================================================
-- 191 · WHICH TEMPLATES THIS PROJECT HAS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the dialog's warning that a step outside the 24-hour
-- window needs an approved template: *"Let me know where I can approve the
-- template… Where can I see that template?"*
--
-- ⚠️ THE CRM CANNOT APPROVE ONE — META DOES, and only Meta. A template is
-- written and submitted in WhatsApp Manager and reviewed by Meta, usually within
-- minutes to a day. What the CRM CAN do is show which ones this account has and
-- what Meta says about each, so nobody guesses.
--
-- That list lives at Meta and is fetched live (`listTemplates`, which is
-- deliberately NOT cached: a template can be paused or disabled on Meta's side
-- with no call to us). Fetching it needs the WhatsApp Business Account id, and
-- `projects` is readable only by its members — a salesperson is a member of
-- nothing. So this is the same definer arrangement as 141's phone-number id,
-- with the same audience.
-- ============================================================================

create or replace function app.crm_project_waba(p_project uuid)
returns text
language sql
security definer
set search_path = public, app, pg_temp
stable
as $$
  select p.whatsapp_waba_id
    from public.projects p
   where p.id = p_project
     /* ⚠️ THE SAME AUDIENCE AS `crm_project_wa_number` (141). A fifth answer to
        "who may see this project's WhatsApp configuration" is a mismatch waiting
        to be found by somebody who needed one of the other four. */
     and (app.crm_manages_project(p_project) or app.crm_in_project_department(p_project))
$$;

comment on function app.crm_project_waba(uuid) is
  'The WhatsApp Business Account id a project''s templates belong to, to anybody who may read its leads. 191.';

revoke all on function app.crm_project_waba(uuid) from public;
grant execute on function app.crm_project_waba(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK — as cni_app, as a real salesperson
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_outsider uuid; v_id text; v_none text; v_seen boolean := false;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.whatsapp_waba_id is not null limit 1;
  if v_project is null then
    raise exception '191 · no project has a WhatsApp account id — refusing to skip the check';
  end if;
  select l.owner_id into v_sales
    from public.crm_leads l join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project limit 1;
  select u.id into v_outsider
    from public.users u
   where u.is_active and u.role = 'member' and u.id is distinct from v_sales
     and u.department_id is distinct from (select department_id from public.users where id = v_sales)
   limit 1;
  if v_sales is null or v_outsider is null then
    raise exception '191 · fixtures missing (salesperson %, outsider %)', v_sales, v_outsider;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  v_id := app.crm_project_waba(v_project);
  v_seen := true;
  reset role;

  set local role cni_app;
  perform set_config('app.user_id', v_outsider::text, true);
  v_none := app.crm_project_waba(v_project);
  reset role;

  if not v_seen or v_id is null then
    raise exception '191 · the salesperson working this project cannot read its WhatsApp account id';
  end if;
  if v_none is not null then
    raise exception '191 · another department''s member could read it';
  end if;

  raise notice '191 · the people who work a project can see which templates it has; nobody else can';
end $chk$;
