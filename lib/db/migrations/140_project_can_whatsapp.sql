-- ============================================================================
-- 140 · THE SALES TEAM CAN SEE THAT A PROJECT HAS A WHATSAPP NUMBER
-- ----------------------------------------------------------------------------
-- 105, 121, 125, 129, 130 — and now the sixth. Same shape every time: a CRM
-- screen reads `public.projects` under the reader's own session, `projects_select`
-- is `app.project_is_visible(id)` which needs project MEMBERSHIP, and a
-- salesperson is a member of nothing. The row comes back empty and the app reads
-- the emptiness as a fact about the world rather than about the reader.
--
-- Here it was `crmProjectCanWhatsApp`:
--
--     select whatsapp_phone_number_id is not null as ready
--       from public.projects where id = $1        -- ⚠️ 0 rows for Sales
--
-- Measured on the demo project, which HAS a number (139):
--
--     Ammar Afzal Khan     (super_admin) → ready = true
--     Umm-e-Habiba         (admin)       → ready = true
--     Sale Tester          (Sales)       → NO ROW
--     Sale 2 tester        (Sales)       → NO ROW
--     sale manager tester  (Sales)       → NO ROW
--
-- ── ⚠️ AND FALSE HERE IS NOT A BLANK SCREEN, IT IS A WRONG BUTTON ──────────
-- `false` means "this project cannot send", and the desk and the record both
-- fall back to `wa.me` on it. `wa.me` opens the SALESPERSON'S OWN WhatsApp: the
-- message leaves from a personal handset and `crm_lead_messages` never sees it —
-- no thread, no response time, no "who replied". So the entire sales team, the
-- only people who use this daily, would have gone on messaging leads off the
-- record while the manager's screens showed silence.
--
-- ⚠️ AND IT WOULD HAVE PASSED EVERY CHECK. An Admin is a member of nothing and
-- visible everything, so the docked chat opens correctly in an Admin session —
-- which is the session every browser check of this feature has been made from.
--
-- ── NOT A BUG IN SENDING ───────────────────────────────────────────────────
-- `whatsAppConfigFor` (lib/crm/whatsapp.ts) reads the same column through
-- `withAppRole`, which sets the role and no session, so RLS never narrowed it.
-- Sending has always worked for a salesperson. It was only the button that
-- pointed them away from it.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- One boolean, to exactly the people who may already read the project's leads —
-- the same audience as `crm_project_name` in 130, deliberately, because these
-- two are read side by side on the same screen and a different audience would
-- be a bug waiting for somebody to notice the mismatch.
-- ============================================================================

create or replace function app.crm_project_can_whatsapp(p_project uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(
    (select p.whatsapp_phone_number_id is not null
       from public.projects p
      where p.id = p_project
        /* ⚠️ THE SAME AUDIENCE AS `crm_leads_select` AND `crm_project_name`. */
        and (app.crm_manages_project(p_project) or app.crm_in_project_department(p_project))),
    false)
$$;

comment on function app.crm_project_can_whatsapp(uuid) is
  'Whether a project has a WhatsApp number of its own, to anybody who may read '
  'its leads. SECURITY DEFINER because projects_select needs MEMBERSHIP and a '
  'salesperson is not a member of the project whose leads they work — '
  'see migration 140, and 130 for the fifth time this happened.';

revoke all on function app.crm_project_can_whatsapp(uuid) from public;
grant execute on function app.crm_project_can_whatsapp(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK — under each person's own session, which is the only way any of
-- the six versions of this bug has ever been found.
-- ============================================================================
do $$
declare
  v_proj  uuid;
  v_none  uuid;
  v_sales uuid;
  v_admin uuid;
  v_dev   uuid;
  v_can   boolean;
begin
  select id into v_proj from public.projects
   where whatsapp_phone_number_id is not null limit 1;

  if v_proj is null then
    raise notice '140 · no project has a WhatsApp number yet — the definer is in place, nothing to measure';
    return;
  end if;

  /* Somebody in the department this project's leads route to — a salesperson,
     not a member. This is the reader the bug was about. */
  select u.id into v_sales
    from public.users u
    join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active
   limit 1;

  select id into v_admin from public.users where role = 'admin' and is_active limit 1;

  select u.id into v_dev
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'development' and u.is_active limit 1;

  -- 1 · ⚠️ THE BUG ITSELF.
  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    select app.crm_project_can_whatsapp(v_proj) into v_can;
    reset role;

    if not v_can then
      raise exception '140 · a salesperson still cannot see that the project can send — the wa.me fallback is NOT fixed';
    end if;
  else
    raise notice '140 · nobody in Sales to measure against';
  end if;

  -- 2 · ⚠️ AND IT STILL SAYS NOTHING WHERE THE ANSWER IS NOTHING. A function
  --     that answered everybody would pass check 1 and tell the whole company
  --     which clients are set up to message.
  if v_dev is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_dev::text, true);
    select app.crm_project_can_whatsapp(v_proj) into v_can;
    reset role;
    if v_can then
      raise exception '140 · somebody in Development is told about a project they have no leads on';
    end if;
  end if;

  -- 3 · No session at all learns nothing.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  select app.crm_project_can_whatsapp(v_proj) into v_can;
  reset role;
  if v_can then
    raise exception '140 · a session with no user is told a project can send';
  end if;

  -- 4 · An Admin still reads it, as they always could.
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    select app.crm_project_can_whatsapp(v_proj) into v_can;
    reset role;
    if not v_can then
      raise exception '140 · an admin can no longer see that the project can send';
    end if;
  end if;

  -- 5 · ⚠️ A PROJECT WITHOUT A NUMBER IS STILL FALSE, not an error and not
  --     true-by-accident. Chitral is the live case: its leads are real, it has
  --     no number of its own yet, and the `wa.me` fallback must stay there.
  select id into v_none from public.projects
   where whatsapp_phone_number_id is null limit 1;

  if v_none is not null then
    set local role cni_app;
    perform set_config('app.user_id', coalesce(v_admin, v_sales)::text, true);
    select app.crm_project_can_whatsapp(v_none) into v_can;
    reset role;
    if v_can then
      raise exception '140 · a project with no number reports that it can send';
    end if;
  end if;

  raise notice '140 · the sales team can see that a project sends from its own number, and Development cannot';
end $$;
