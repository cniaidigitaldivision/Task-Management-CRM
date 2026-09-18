-- ============================================================================
-- 197 · A REQUEST FROM THE DIALOG REACHES THE MANAGER
-- ----------------------------------------------------------------------------
-- The owner's Related items designs put a request on two tabs:
--
--   Quotations   "Request updated quote — Ask for a revised quotation from the team."
--   Invoices     "Request correction"
--
-- Neither is the salesperson's to do alone. A revised price needs whoever
-- approves discounts (151); a wrong invoice needs whoever raised or approves it.
-- Both go to the manager of the department the project's leads route to (124),
-- and to an admin only when that department has no manager — so a request never
-- lands nowhere.
--
-- ⚠️ ITS OWN NOTIFICATION KIND. Reusing `lead_due` or `lead_replied` would let
-- somebody silence one and lose the other — the reason this file's three
-- predecessors each got their own (constants.ts says so three times).
--
-- ⚠️ `add value` IS NOT USABLE IN THE TRANSACTION THAT ADDS IT, so the self-check
-- below proves who receives a request and does not insert one.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'lead_request'
  ) then
    alter type public.notification_kind add value 'lead_request';
  end if;
end $$;

/* Who a request about this project goes to.
   ⚠️ KEYED ON A PROJECT, and the caller has already read the lead under RLS
   before asking (`lib/db/queries/crm-related.ts`), so this returns manager ids
   and nothing about any lead. */
create or replace function app.crm_request_recipients(p_project uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select coalesce(
    (select array_agg(u.id order by u.full_name)
       from public.users u
       join public.projects p on p.id = p_project
      where u.is_active
        and u.department_role = 'manager'
        and u.department_id = p.lead_department_id),
    (select array_agg(u.id order by u.full_name)
       from public.users u
      where u.is_active and u.role in ('admin', 'super_admin')),
    array[]::uuid[]
  )
$fn$;

revoke all on function app.crm_request_recipients(uuid) from public;
grant execute on function app.crm_request_recipients(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_ids uuid[]; v_manager boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then
    raise exception '197 · no demo sales project — refusing to skip the check';
  end if;

  set local role cni_app;
  v_ids := app.crm_request_recipients(v_project);
  reset role;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '197 · a request on the demo project would reach nobody';
  end if;

  select bool_or(u.department_role = 'manager') into v_manager
    from public.users u where u.id = any (v_ids);
  if not v_manager and exists (
    select 1 from public.users u join public.projects p on p.id = v_project
     where u.is_active and u.department_role = 'manager' and u.department_id = p.lead_department_id
  ) then
    raise exception '197 · the department has a manager and the request went elsewhere';
  end if;

  raise notice '197 · a request reaches the department''s manager (% recipient(s)), or an admin when there is none', array_length(v_ids, 1);
end $chk$;
