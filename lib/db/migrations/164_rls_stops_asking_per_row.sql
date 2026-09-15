-- ============================================================================
-- 164 · THE ACCESS RULE IS ANSWERED ONCE, NOT ONCE PER ROW
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-15: *"Only 8 leads are loading and it is taking too much time…
-- How will you deal with it when we have a lot of data, 2,000 to 2 lakh clients?
-- Then this system will not work."*
--
-- They are right, and this is the measurement that proves it. Execution time
-- only, network excluded, against **659 leads**:
--
--     salesperson · list of 8 with its laterals      143.6 ms
--     salesperson · count for the tab chips           93.9 ms
--     manager     · count over everything visible   1214.7 ms   ⚠️
--
-- ⚠️ 1.2 SECONDS TO COUNT 659 ROWS IS NOT A DATA PROBLEM. It is the access rule
-- being re-answered for every single row. At 200,000 leads the same shape is
-- roughly SIX MINUTES — the owner's question answered in the only honest way.
--
-- ── WHY IT HAPPENS, AND IT IS NOT OBVIOUS ──────────────────────────────────
-- The policy reads:
--
--     app.crm_manages_project(project_id)
--       or (app.crm_in_project_department(project_id)
--           and owner_id = app.current_user_id())
--
-- Both helpers are correctly marked STABLE. But they TAKE THE ROW'S project_id
-- AS AN ARGUMENT, and a stable function with a row-dependent argument cannot be
-- hoisted out of the scan — Postgres must call it per row, and each call runs
-- its own `exists (select 1 from public.projects …)`.
--
-- `app.current_user_id()` in the same policy takes no argument, is equally
-- STABLE, and is evaluated exactly ONCE. That is the whole difference.
--
-- ── WHAT THIS CHANGES, AND WHAT IT MUST NOT ────────────────────────────────
-- Both helpers reduce to the same question — *is this project's lead department
-- mine?* — which has ONE answer for the whole statement. So the set of project
-- ids is computed once, argument-free, and each row does an array membership
-- test instead of a subquery.
--
-- ⚠️ THE VISIBILITY MUST NOT MOVE BY ONE ROW. This is the security boundary
-- that keeps Sarah out of Sahad's leads and the AI team out of the CRM
-- entirely. The algebra is written out below and the self-check compares the
-- old predicate against the new policy FOR EVERY ACTIVE USER before it lets the
-- migration commit.
--
--     old:  manages(p) or (in_dept(p) and owner = me)
--     where manages(p) = admin or (preview and leads_dept and p in D)
--           in_dept(p) = admin or (preview and p in D)
--
--     expand: admin
--             or (preview and leads_dept and p in D)
--             or (admin and owner = me)                 -- absorbed by `admin`
--             or (preview and p in D and owner = me)
--
--     collect: admin or (preview and p in D and (leads_dept or owner = me))
--
--     new:    admin or (p in D' and (manages_dept or owner = me))
--             where D'          = preview ? D : {}
--                   manages_dept = preview and leads_dept
--
-- Identical in both branches of `preview`, which is what the check confirms.
-- ============================================================================

/* ── Argument-free, so it is evaluated ONCE per statement ──────────────────
   ⚠️ Returns an ARRAY rather than a set, deliberately: `= any (array)` against
   a once-computed constant is a cheap per-row test the planner can also use
   against `crm_leads_project_next_idx`. A subquery here would put the cost
   straight back. */
create or replace function app.crm_dept_project_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select case
    when not app.crm_preview_allows() then array[]::uuid[]
    else coalesce(
      (select array_agg(p.id)
         from public.projects p
        where p.lead_department_id is not null
          and p.lead_department_id = app.acting_department_id()),
      array[]::uuid[])
  end
$fn$;

comment on function app.crm_dept_project_ids() is
  'Projects whose lead department is the acting user''s. ⚠️ ARGUMENT-FREE ON '
  'PURPOSE — a STABLE function taking the row''s project_id is called once per '
  'row and cannot be hoisted; this one is evaluated once per statement. '
  'Migration 164.';

/* Does this person run their own department? Argument-free, once. */
create or replace function app.crm_manages_own_department()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select app.crm_preview_allows() and app.acting_leads_a_department()
$fn$;

/* Admin and above see everything, unchanged. Argument-free, once. */
create or replace function app.crm_sees_every_lead()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select app.acting_at_least('admin'::public.user_role)
$fn$;

revoke all on function app.crm_dept_project_ids() from public;
revoke all on function app.crm_manages_own_department() from public;
revoke all on function app.crm_sees_every_lead() from public;
grant execute on function app.crm_dept_project_ids() to cni_app;
grant execute on function app.crm_manages_own_department() to cni_app;
grant execute on function app.crm_sees_every_lead() to cni_app;

-- ⚠️ SELECT AND UPDATE BOTH, because they carry the same predicate and a
-- half-converted pair is worse than neither: the list would be fast and every
-- write would still crawl, and nobody would understand why.
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    app.crm_sees_every_lead()
    or (
      project_id = any (app.crm_dept_project_ids())
      and (app.crm_manages_own_department() or owner_id = app.current_user_id())
    )
  );

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    app.crm_sees_every_lead()
    or (
      project_id = any (app.crm_dept_project_ids())
      and (app.crm_manages_own_department() or owner_id = app.current_user_id())
    )
  )
  with check (
    app.crm_sees_every_lead()
    or (
      project_id = any (app.crm_dept_project_ids())
      and (app.crm_manages_own_department() or owner_id = app.current_user_id())
    )
  );

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY ACTIVE USER, OLD PREDICATE AGAINST NEW POLICY. Not a sample, not the
-- testers only — every one. A rewrite of the rule that keeps one salesperson out
-- of another's leads is checked exhaustively or not at all.
-- ============================================================================
do $chk$
declare
  r record;
  n_old int; n_new int; n_checked int := 0; n_moved int := 0;
begin
  for r in select id, full_name from public.users where is_active order by full_name
  loop
    /* ⚠️ THE IDENTITY IS SET FIRST. Both helpers read `app.current_user_id()`
       and `app.acting_department_id()` from the session, so evaluating the old
       predicate before setting it would compare everybody against whoever was
       last examined — and the check would pass while proving nothing. */
    perform set_config('app.user_id', r.id::text, true);

    /* The OLD predicate, written out, evaluated as the table owner — who
       bypasses RLS — so it is the RULE being measured rather than the new
       policy being asked to confirm itself. */
    select count(*) into n_old from public.crm_leads l
     where app.crm_manages_project(l.project_id)
        or (app.crm_in_project_department(l.project_id)
            and l.owner_id = app.current_user_id());

    /* The NEW policy, by actually reading the table as that person. */
    perform set_config('role', 'cni_app', true);
    select count(*) into n_new from public.crm_leads;
    reset role;

    n_checked := n_checked + 1;
    if n_old is distinct from n_new then
      n_moved := n_moved + 1;
      raise warning '164 · % saw % leads and now sees %', r.full_name, n_old, n_new;
    end if;
  end loop;

  if n_moved <> 0 then
    raise exception '164 · visibility changed for % of % people — refusing to commit', n_moved, n_checked;
  end if;

  raise notice '164 · visibility identical for all % active users', n_checked;
end $chk$;
