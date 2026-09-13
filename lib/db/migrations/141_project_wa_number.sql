-- ============================================================================
-- 141 · THE SEND PATH CAN READ THE NUMBER IT SENDS FROM
-- ----------------------------------------------------------------------------
-- ⚠️ THIS MIGRATION CORRECTS A CLAIM MADE IN 140. That file says:
--
--     "NOT A BUG IN SENDING. `whatsAppConfigFor` reads the same column through
--      `withAppRole`, which sets the role and no session, so RLS never narrowed
--      it. Sending has always worked for a salesperson."
--
-- That is wrong, and it is wrong in the direction that matters. `withAppRole`
-- does this and nothing else:
--
--     select set_config('role', 'cni_app', true)
--
-- `cni_app` is an ordinary role. It does not have BYPASSRLS and it does not own
-- the table, so **RLS still applies** — and with no `app.user_id` set,
-- `projects_select` = `app.project_is_visible(id)` evaluates for nobody and
-- returns false. Measured:
--
--     set_config('role','cni_app',true)
--     current_user = cni_app, app.user_id = ''
--     select whatsapp_phone_number_id from projects where id = <demo> → 0 ROWS
--
-- So `whatsAppConfigFor` returned null for EVERY project and EVERY user, always.
-- Sending has never worked from the application at all — not for a salesperson,
-- not for the manager, not for an Admin. The owner met it as a toast reading
-- *"Demo — Product Enquiries [demo] has no WhatsApp number set up yet"* on a
-- project whose number is set, live, and GREEN at Meta.
--
-- ── ⚠️ AND "SET THE ROLE, SKIP THE SESSION" IS NOT A WAY PAST RLS ──────────
-- That is the general lesson. `withAppRole` narrows harder than `withUser`, not
-- less: it is the same policies evaluated for a user that does not exist. It is
-- correct only where the policy admits an anonymous session on purpose — the
-- WhatsApp webhook's INSERT does, which is why storing an inbound message has
-- worked all along and reading a project's number has not.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- The same shape as 130 and 140: one value, through a definer, to exactly the
-- people who may already read that project's leads. The caller has passed
-- `getCrmLead` before reaching this, so the audience matches what they are
-- already holding.
-- ============================================================================

create or replace function app.crm_project_wa_number(p_project uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.whatsapp_phone_number_id
    from public.projects p
   where p.id = p_project
     /* ⚠️ THE SAME AUDIENCE AS `crm_leads_select`, `crm_project_name` and
        `crm_project_can_whatsapp`. Four readers on one screen; a fifth audience
        would be a bug waiting for somebody to notice the mismatch. */
     and (app.crm_manages_project(p_project) or app.crm_in_project_department(p_project))
$$;

comment on function app.crm_project_wa_number(uuid) is
  'The Meta Phone Number ID a project sends WhatsApp from, to anybody who may '
  'read its leads. SECURITY DEFINER because projects_select needs MEMBERSHIP. '
  'Migration 141 — and note that it also corrects 140''s claim that withAppRole '
  'escaped RLS here. It does not; cni_app is subject to policy like any role.';

revoke all on function app.crm_project_wa_number(uuid) from public;
grant execute on function app.crm_project_wa_number(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_proj  uuid;
  v_sales uuid;
  v_admin uuid;
  v_dev   uuid;
  v_id    text;
  v_rows  int;
begin
  select id into v_proj from public.projects
   where whatsapp_phone_number_id is not null limit 1;

  if v_proj is null then
    raise notice '141 · no project has a number yet — the definer is in place, nothing to measure';
    return;
  end if;

  -- 0 · ⚠️ THE BUG ITSELF, REPRODUCED FIRST. This is exactly what `withAppRole`
  --     runs, and it must still return nothing — the point is that the old path
  --     was never going to work, not that RLS has been loosened.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  select count(*) into v_rows
    from public.projects where id = v_proj and whatsapp_phone_number_id is not null;
  reset role;

  if v_rows <> 0 then
    raise exception '141 · projects_select now admits an anonymous cni_app session — that is a far bigger problem than the one being fixed';
  end if;

  select u.id into v_sales
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active limit 1;

  select id into v_admin from public.users where role = 'admin' and is_active limit 1;

  select u.id into v_dev
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'development' and u.is_active limit 1;

  -- 1 · A salesperson who works this project's leads gets the number.
  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    select app.crm_project_wa_number(v_proj) into v_id;
    reset role;
    if v_id is null then
      raise exception '141 · a salesperson still cannot read the number their own lead sends from';
    end if;
  end if;

  -- 2 · So does an Admin.
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    select app.crm_project_wa_number(v_proj) into v_id;
    reset role;
    if v_id is null then
      raise exception '141 · an admin cannot read the number';
    end if;
  end if;

  -- 3 · ⚠️ AND NOBODY ELSE DOES. A Phone Number ID is the address every message
  --     from that business is billed and attributed to.
  if v_dev is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_dev::text, true);
    select app.crm_project_wa_number(v_proj) into v_id;
    reset role;
    if v_id is not null then
      raise exception '141 · somebody in Development can read a sending number they have no leads behind';
    end if;
  end if;

  -- 4 · No session at all learns nothing.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  select app.crm_project_wa_number(v_proj) into v_id;
  reset role;
  if v_id is not null then
    raise exception '141 · a session with no user is handed a sending number';
  end if;

  raise notice '141 · the send path can read its own number, and only the people behind the leads can';
end $$;
