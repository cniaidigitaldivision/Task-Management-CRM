-- ============================================================================
-- 067 · TAKE THE OWNER OUT OF PAYROLL
-- ----------------------------------------------------------------------------
-- The second half of 066, which had to be separate because Postgres will not
-- let a new enum value be used in the transaction that added it. Apply 066
-- first, or this fails with "invalid input value for enum employment_type".
--
-- ── ⚠️ THE POSTED HISTORY IS REMOVED, AND THAT IS NOT USUAL HERE ───────────
-- Everywhere else in this schema a posted month is immutable — migration 064's
-- whole argument is that history must not be rewritten when a rate changes.
-- This is different in kind. Those rows were never a cost: they were seeded on
-- the false premise that the owner draws a salary, and leaving them in would
-- overstate six months of spending by PKR 1,500,000 in every chart, every total
-- and every exported PDF.
--
-- Correcting a figure that was WRONG WHEN IT WAS WRITTEN is not the same act as
-- rewriting one that was right at the time. Only `source = 'payroll_run'` rows
-- are touched; anything a person filed by hand is left exactly as it is.
-- ============================================================================

-- ⚠️ Matched on the NAME the owner gave, not on `role = 'super_admin'`. The
-- rule is about how this person is paid, not about rank — a future Super Admin
-- who IS salaried must not silently inherit it.
update public.employee_compensation c
   set employment_type = 'owner',
       monthly_salary  = 0,
       note = coalesce(nullif(btrim(c.note), '') || ' · ', '')
              || 'Owner — profit share, not payroll (067).'
  from public.users u
 where u.id = c.user_id
   and lower(u.full_name) like '%ammar%afzal%khan%';

delete from public.expenses e
 using public.users u
 where u.id = e.user_id
   and e.source = 'payroll_run'
   and lower(u.full_name) like '%ammar%afzal%khan%';


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  still_paid  numeric;
  still_rows  int;
  payroll_now numeric;
  headcount   int;
begin
  select coalesce(sum(c.monthly_salary), 0) into still_paid
    from public.employee_compensation c
    join public.users u on u.id = c.user_id
   where lower(u.full_name) like '%ammar%afzal%khan%';

  if still_paid <> 0 then
    raise exception 'The owner still carries a salary of %.', still_paid;
  end if;

  select count(*) into still_rows
    from public.expenses e join public.users u on u.id = e.user_id
   where e.source = 'payroll_run' and lower(u.full_name) like '%ammar%afzal%khan%';

  if still_rows <> 0 then
    raise exception '% posted salary rows for the owner survived.', still_rows;
  end if;

  select coalesce(sum(monthly_salary), 0), count(*)
    into payroll_now, headcount
    from public.employee_compensation
   where employment_type <> 'owner';

  raise notice 'Owner excluded. Payroll is now PKR % across % people.',
    payroll_now, headcount;
end $$;
