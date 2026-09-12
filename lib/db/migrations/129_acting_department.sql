-- ============================================================================
-- 129 · THE SALES TEAM CAN REACH THE DESK AT ALL
-- ----------------------------------------------------------------------------
-- ── ⚠️ THE FOURTH TIME THIS EXACT SHAPE HAS APPEARED ────────────────────────
-- 105, 121, 125 — and now the door itself. Reported by the owner 2026-09-12:
-- *"When I log in as a sale tester account, I can't see this campaign and lead
-- desk."* They were right, and it was never the seed data.
--
-- `getCurrentDepartment()` in `lib/auth/current-user.ts` decides two things for
-- every request: the department name under somebody's name, and
-- `ownsLeadProjects`, which `crmIsOpenTo()` turns into the CRM's front door. It
-- asked the question like this:
--
--     withAppRole(tx => tx`select d.key, …, exists (select 1 from projects …)
--                            from users u join departments d … where u.id = $1`)
--
-- `withAppRole` sets `role = cni_app` and NO `app.user_id`. So:
--
--   • `users_select` hides every row — the join returns NOTHING, and the
--     function's own catch-all returns NO_DEPARTMENT { ownsLeadProjects: false }
--   • even with a session set, `projects_select` is `app.project_is_visible(id)`
--     which needs project MEMBERSHIP, and a salesperson is not a member of
--     Chitral — so the EXISTS is false anyway
--
-- Measured before this migration, as the app itself runs it:
--
--     withAppRole,             Sale Tester  →  no rows at all
--     withUser(Sale Tester)    Sale Tester  →  key=sales, owns_leads=FALSE
--
-- ── ⚠️ AND IT WAS INVISIBLE FROM AN ADMIN SESSION, AGAIN ────────────────────
-- `crmIsOpenTo()` short-circuits on `role in (admin, super_admin)` and never
-- consults the department. So every browser check ever made of this screen was
-- made by somebody the bug could not touch, and the three people whose whole job
-- the screen is were redirected to `/my-work` by `requireCrmAccess`.
--
-- The nav is not the floor and never was (NFR-006): the link was missing AND the
-- route refused. Nothing leaked. The feature was simply unreachable by its own
-- audience — RLS failing closed, and closed reading as "no" rather than "not
-- allowed", for the fourth time.
--
-- ⚠️ A DEFINER READER IS THE ONLY FIX THAT WORKS. Widening `projects_select` to
-- admit a department would hand the sales team the whole Projects area, which is
-- a much larger grant than "may I open the lead desk". So the question is asked
-- once, here, under a function whose own body is the security boundary.
-- ============================================================================

-- ── The reader ──────────────────────────────────────────────────────────────
-- ⚠️ `stable`, not `volatile`: it runs on EVERY authenticated request, in the
-- layout, and the planner may cache it within a statement.
create or replace function app.crm_acting_department()
returns table (
  key             text,
  name            text,
  department_role text,
  owns_leads      boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select d.key,
         d.name,
         u.department_role::text,
         /* ⚠️ THE WHOLE REASON THIS FUNCTION EXISTS. Read as the definer, so it
            answers "does this department own any lead-routed project" rather
            than "is this caller a member of one". Those are different
            questions, and `projects_select` can only answer the second. */
         exists (
           select 1 from public.projects p
            where p.lead_department_id = d.id
              and not p.is_draft
         )
    from public.users u
    join public.departments d on d.id = u.department_id
   /* ⚠️ THE CALLER, NOT A PARAMETER. A parameter would let anybody ask the
      question about anybody — harmless here, but the habit is not. */
   where u.id = app.current_user_id()
     and u.is_active
$$;

comment on function app.crm_acting_department() is
  'The acting session''s department, and whether it owns any lead-routed project. '
  'SECURITY DEFINER because projects_select needs MEMBERSHIP and a salesperson is '
  'not a member of the projects whose leads they work — see migration 129.';

revoke all on function app.crm_acting_department() from public;
grant execute on function app.crm_acting_department() to cni_app;

-- ============================================================================
-- SELF-CHECK — as `cni_app`, under each person's own session, because that is
-- the only way any of the three earlier versions of this bug were ever found.
-- ============================================================================
do $$
declare
  v_sales_member uuid;
  v_sales_mgr    uuid;
  v_admin        uuid;
  v_dev          uuid;
  r              record;
  n              int;
begin
  select u.id into v_sales_member
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.department_role = 'member' and u.is_active limit 1;

  select u.id into v_sales_mgr
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.department_role = 'manager' and u.is_active limit 1;

  select u.id into v_dev
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'development' and u.is_active limit 1;

  select id into v_admin from public.users where role = 'admin' and is_active limit 1;

  if v_sales_member is null then
    raise notice '129 · no sales member to check against — skipping the check that matters most';
  else
    -- 1 · ⚠️ THE BUG ITSELF. A salesperson's department owns lead projects, and
    --     before this migration this read FALSE through RLS.
    set local role cni_app;
    perform set_config('app.user_id', v_sales_member::text, true);
    select * into r from app.crm_acting_department();
    reset role;

    if r.key is null then
      raise exception '129 · a salesperson cannot read their own department at all';
    end if;
    if r.owns_leads is not true then
      raise exception '129 · the Sales department owns lead projects and a salesperson is told it does not — the bug is NOT fixed';
    end if;
    if r.department_role <> 'member' then
      raise exception '129 · a sales member reads their department_role as %', r.department_role;
    end if;
  end if;

  -- 2 · The manager reads the same department, and reads as a manager.
  if v_sales_mgr is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales_mgr::text, true);
    select * into r from app.crm_acting_department();
    reset role;
    if r.department_role <> 'manager' then
      raise exception '129 · the sales manager does not read as a manager';
    end if;
    if r.owns_leads is not true then
      raise exception '129 · the sales manager is told Sales owns no leads';
    end if;
  end if;

  -- 3 · ⚠️ AND IT MUST STILL SAY NO WHERE THE ANSWER IS NO. A fix that returned
  --     true for everybody would open the desk to the whole company and pass
  --     every check above.
  if v_dev is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_dev::text, true);
    select * into r from app.crm_acting_department();
    reset role;
    if r.owns_leads is not false then
      raise exception '129 · Development owns no lead-routed project and is told it does';
    end if;
  end if;

  -- 4 · No session at all is no department — the importer and the cron run this
  --     way, and neither has a department.
  --     ⚠️ THE RESET IS LOAD-BEARING. set_config(..., true) lasts the whole
  --     transaction, so without clearing it this check inherits whoever was
  --     acting in check 3 and fails against a perfectly correct function.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  select count(*) into n from app.crm_acting_department();
  reset role;
  if n <> 0 then
    raise exception '129 · a session with no user is given a department';
  end if;

  -- 5 · An Admin still reads their own department correctly. Their CRM access
  --     never depended on this, which is exactly why the bug survived.
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    select count(*) into n from app.crm_acting_department();
    reset role;
    if n <> 1 then
      raise exception '129 · an admin reads % departments', n;
    end if;
  end if;

  raise notice '129 · the sales team can reach the lead desk, and Development still cannot';
end $$;
