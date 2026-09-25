-- ============================================================================
-- 260 · THE EXECUTIVE OPENS THE LEAD DESK
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25, listing the Growth pages an Executive sees: *"in the lead
-- desk, only the lead campaign lead desk page will be displayed ...
-- Conversations will be displayed. Appointments will be displayed. Follows will
-- be displayed ... AI knowledge will be displayed. Clients will be displayed.
-- Live overview and lead reporting will be displayed."*
--
-- ── ⚠️ FOUND BY WALKING THE APP AS ONE, NOT BY READING THE CODE ──────────
-- The sidebar offered all eight of those pages and every one of them bounced to
-- the dashboard. Eight routes sit behind a single predicate — `crmIsOpenTo()`
-- in TypeScript and `app.crm_is_open_to_caller()` here — and both said Admin,
-- Super Admin, or somebody whose department owns lead projects. An Executive is
-- none of those.
--
-- ⚠️ THE TWO MUST MOVE TOGETHER. `lib/auth/current-user.ts` carries a note
-- saying this function is its mirror and that they are kept in step by hand,
-- "so if one changes, the other must". The TypeScript side changed in the same
-- commit as this file. Had only that side changed, the page would have drawn
-- and then shown nothing — which is the failure that note predicts.
--
-- ── ⚠️ IT IS A READ, AND IT STAYS A READ ─────────────────────────────────
-- Opening the desk is not permission to work it. An Executive's transaction is
-- read-only (257), so the only lead write they have is handing one out, which
-- 258 granted deliberately and narrowly.
-- ============================================================================

set local lock_timeout = '5s';

create or replace function app.crm_is_open_to_caller()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      -- ⚠️ ADDED 2026-09-25, and named rather than folded into the rank test
      -- above: an Executive is rank 3 and `acting_at_least('admin')` is 4, so
      -- lowering that floor would have admitted nobody new but would have made
      -- this function say something it does not mean.
      or app.acting_is_executive()
      or (
        app.acting_department_id() is not null
        and exists (
          select 1 from public.projects p
           where p.lead_department_id = app.acting_department_id()
        )
      )
$$;

comment on function app.crm_is_open_to_caller() is
  'Admin, the Executive (read-only, migration 260), or anybody whose department owns lead projects. Mirrored by crmIsOpenTo() in lib/auth/current-user.ts.';

-- ----------------------------------------------------------------------------
-- THE SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_admin uuid;
  v_member uuid;
  v_before boolean;
  v_after boolean;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_member from public.users
   where role = 'member' and is_active and department_id is null order by created_at limit 1;
  if v_admin is null then raise exception 'self-check needs an active admin'; end if;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 260', 'self-check-260@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  perform set_config('role', 'cni_app', true);

  perform set_config('app.user_id', v_exec::text, true);
  if not app.crm_is_open_to_caller() then
    raise exception 'THE LEAD DESK IS STILL CLOSED TO AN EXECUTIVE';
  end if;

  -- ── and nobody else moved ───────────────────────────────────────────────
  perform set_config('app.user_id', v_admin::text, true);
  if not app.crm_is_open_to_caller() then
    raise exception 'AN ADMIN LOST THE LEAD DESK';
  end if;

  -- ⚠️ A person with no department and no rank must still be refused; without
  -- this arm the check would pass even if the function had been widened to
  -- everybody.
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    if app.crm_is_open_to_caller() then
      raise exception 'THE LEAD DESK OPENED TO SOMEBODY WITH NEITHER RANK NOR A LEAD DEPARTMENT';
    end if;
  else
    raise notice '260: no department-less member exists, so the refusal arm was not exercised';
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.users where id = v_exec;
  if exists (select 1 from public.users where id = v_exec) then
    raise exception 'THE 260 FIXTURE SURVIVED';
  end if;

  raise notice '260 self-check passed: the lead desk opens to an executive and to nobody new';
end $$;
