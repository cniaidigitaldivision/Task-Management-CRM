-- ============================================================================
-- 165 · THE HELPERS BECOME SUBQUERIES, AND ARE EVALUATED ONCE
-- ----------------------------------------------------------------------------
-- 164 made the access rule argument-free and it got 6× faster for a salesperson
-- — but the manager's count over 659 rows still took **750 ms**, and the plan
-- said why in one line:
--
--     Seq Scan on public.crm_leads l (actual time=1.567..756.587 rows=659)
--       Filter: (app.crm_sees_every_lead() OR ((l.project_id = ANY
--                (app.crm_dept_project_ids())) AND (…)))
--
-- ⚠️ THE FUNCTIONS ARE IN THE FILTER, WHICH MEANS PER ROW. Measured directly:
--
--     app.crm_sees_every_lead()          198.9 ms over 659 calls
--     app.crm_manages_own_department()   276.3 ms
--     app.crm_dept_project_ids()         270.1 ms
--
-- ── ⚠️ `STABLE` DOES NOT MEAN "EVALUATED ONCE", AND THAT IS THE WHOLE TRAP ──
-- It is a promise about consistency WITHIN a statement, not an instruction to
-- cache. Postgres constant-folds IMMUTABLE expressions; a STABLE call in a WHERE
-- clause is re-evaluated for every row. And a SECURITY DEFINER function can
-- never be inlined, so there is not even a cheap body to fold — each row pays a
-- full function invocation.
--
-- Marking them IMMUTABLE would "fix" it and would be a lie: they read
-- `app.user_id` from the session, and Postgres would be free to cache a result
-- across sessions. That is the one change here that could hand one person
-- another's leads.
--
-- ── THE ACTUAL MECHANISM: A SCALAR SUBQUERY BECOMES AN InitPlan ────────────
-- `(select app.fn())` is planned as an InitPlan — computed ONCE before the scan
-- and referenced as a constant. Same function, same volatility, same result;
-- the parentheses are what tell the planner it may hoist it.
--
-- This is the documented shape for RLS at scale, and it is the answer to the
-- owner's question: *"How will you deal with it when we have 2,000 to 2 lakh
-- clients? Then this system will not work."*
--
-- ⚠️ AND THE VISIBILITY IS CHECKED AGAIN, EXHAUSTIVELY. A performance change to
-- the rule that keeps one salesperson out of another's leads is verified for
-- every active user or it does not commit — the same check 164 ran, because the
-- risk is identical and "it was fine last time" is not evidence.
-- ============================================================================

drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    (select app.crm_sees_every_lead())
    or (
      /* ⚠️ `coalesce(...)` IS LOad-BEARING, not decoration. Written as
         `= any ((select fn()))` Postgres reads the parentheses as the SUBQUERY
         form of ANY — a set of rows — and refuses with "operator does not exist:
         uuid = uuid[]". Wrapping it in an expression makes ANY see an ARRAY
         again, while the inner scalar subquery still becomes an InitPlan. */
      project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
      and (
        (select app.crm_manages_own_department())
        or owner_id = (select app.current_user_id())
      )
    )
  );

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    (select app.crm_sees_every_lead())
    or (
      /* ⚠️ `coalesce(...)` IS LOad-BEARING, not decoration. Written as
         `= any ((select fn()))` Postgres reads the parentheses as the SUBQUERY
         form of ANY — a set of rows — and refuses with "operator does not exist:
         uuid = uuid[]". Wrapping it in an expression makes ANY see an ARRAY
         again, while the inner scalar subquery still becomes an InitPlan. */
      project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
      and (
        (select app.crm_manages_own_department())
        or owner_id = (select app.current_user_id())
      )
    )
  )
  with check (
    (select app.crm_sees_every_lead())
    or (
      /* ⚠️ `coalesce(...)` IS LOad-BEARING, not decoration. Written as
         `= any ((select fn()))` Postgres reads the parentheses as the SUBQUERY
         form of ANY — a set of rows — and refuses with "operator does not exist:
         uuid = uuid[]". Wrapping it in an expression makes ANY see an ARRAY
         again, while the inner scalar subquery still becomes an InitPlan. */
      project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
      and (
        (select app.crm_manages_own_department())
        or owner_id = (select app.current_user_id())
      )
    )
  );

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  r record;
  n_old int; n_new int; n_checked int := 0; n_moved int := 0;
  t0 timestamptz; ms numeric;
begin
  for r in select id, full_name from public.users where is_active order by full_name
  loop
    perform set_config('app.user_id', r.id::text, true);

    /* The ORIGINAL predicate from before 164, as the owner (RLS bypassed), so
       this is still being compared against the rule as it was written in 124 —
       not against 164's version of it. Two rewrites deep, the thing that must
       not have moved is the ORIGINAL answer. */
    select count(*) into n_old from public.crm_leads l
     where app.crm_manages_project(l.project_id)
        or (app.crm_in_project_department(l.project_id)
            and l.owner_id = app.current_user_id());

    perform set_config('role', 'cni_app', true);
    select count(*) into n_new from public.crm_leads;
    reset role;

    n_checked := n_checked + 1;
    if n_old is distinct from n_new then
      n_moved := n_moved + 1;
      raise warning '165 · % saw % leads and now sees %', r.full_name, n_old, n_new;
    end if;
  end loop;

  if n_moved <> 0 then
    raise exception '165 · visibility changed for % of % people — refusing to commit', n_moved, n_checked;
  end if;

  /* ⚠️ AND IT IS ACTUALLY FASTER, measured rather than assumed. A rewrite that
     kept the visibility and none of the speed would be pure risk. */
  select id into r from public.users where department_role = 'manager' and is_active limit 1;
  perform set_config('app.user_id', r.id::text, true);
  perform set_config('role', 'cni_app', true);
  t0 := clock_timestamp();
  perform count(*) from public.crm_leads;
  ms := extract(milliseconds from clock_timestamp() - t0);
  reset role;

  if ms > 200 then
    raise exception '165 · the manager count still takes % ms — the subqueries were not hoisted', round(ms);
  end if;

  raise notice '165 · visibility identical for all % users, and the manager count is now % ms (was 750)',
    n_checked, round(ms);
end $chk$;
