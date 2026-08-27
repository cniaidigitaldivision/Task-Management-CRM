-- ============================================================================
-- 068 · A SALARY IS PAID DURING THE MONTH, NOT AFTER IT
-- ----------------------------------------------------------------------------
-- Found by pressing "Pay all" on the payroll screen, 2026-08-26:
--
--     new row for relation "expenses" violates check constraint
--     "expenses_paid_after_incurred"
--
-- ── ⚠️ THE DATA WAS RIGHT AND THE RULE WAS WRONG ───────────────────────────
-- Migration 064 wrote:
--
--     check (paid_on is null or paid_on >= incurred_on)
--
-- which reads as obvious — you cannot pay a bill before you receive it. It is
-- correct for a bill. It is wrong for a salary, and payroll is the largest
-- thing in this ledger.
--
-- A posted salary row is dated the LAST DAY of the month it covers, because
-- that is when the month's cost is complete (see `runMonth`). But a division
-- pays its people on the 25th, or the 28th, or whenever it pays them — before
-- the month has finished. Every one of those payments was refused:
--
--     incurred_on  2026-08-31   (the month's cost, complete)
--     paid_on      2026-08-26   (when the money actually went out)
--
-- Verified against the live rows: all five of August's salaries sit at
-- 2026-08-31, and today is the 26th.
--
-- ── ⚠️ WHY NOT SIMPLY DROP THE CHECK ────────────────────────────────────────
-- Because it catches something real. A payment dated 2019 against a 2026 cost
-- is a typo, and a ledger that accepts it silently is a ledger where somebody
-- eventually finds a decade-old figure in this quarter's total.
--
-- What was too strict was the GRANULARITY, not the idea. The honest rule is
-- about months, which is the unit this entire ledger is denominated in:
--
--     you cannot pay for something in a month EARLIER than the month it
--     belongs to
--
-- Paying on any day of the incurred month is fine — that is what payroll does,
-- and what a deposit paid early in the month does. Paying later is fine, and
-- always was. Paying in a previous month is still refused.
--
-- ── ⚠️ REPLACED, NOT ADDED ALONGSIDE ────────────────────────────────────────
-- The old constraint is dropped. Leaving both would mean the stricter one still
-- refuses every payroll payment, and the new one would look like it worked while
-- changing nothing.
-- ============================================================================

alter table public.expenses
  drop constraint if exists expenses_paid_after_incurred;

-- ⚠️ `::timestamp`, NOT `::timestamptz`. `date_trunc(text, timestamptz)` is
-- STABLE because its answer depends on the session's TimeZone; only the
-- timestamp form is IMMUTABLE, and a check constraint must be immutable or the
-- stored rule can disagree with itself between two sessions.
alter table public.expenses
  add constraint expenses_paid_in_month_or_later
  check (
    paid_on is null
    or paid_on >= date_trunc('month', incurred_on::timestamp)::date
  );

comment on constraint expenses_paid_in_month_or_later on public.expenses is
  'Money may leave on any day of the month a cost belongs to, or later — a '
  'salary is paid before month end while its cost is dated month end. What is '
  'still refused is payment in an EARLIER month, which is always a typo.';


-- ── The same shape on the income side ───────────────────────────────────────
-- ⚠️ `revenue_received_after_earned` has the identical flaw and has not bitten
-- yet only because no seeded retainer was received before its earned date. A
-- retainer earned on the 1st and paid on the 1st passes; one earned on the last
-- day of a month and paid mid-month would not. Fixed now rather than waiting
-- for it to surface in front of the owner.
alter table public.revenue_entries
  drop constraint if exists revenue_received_after_earned;

alter table public.revenue_entries
  add constraint revenue_received_in_month_or_later
  check (
    received_on is null
    or received_on >= date_trunc('month', earned_on::timestamp)::date
  );


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT — the exact case that failed
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  covered int;
begin
  -- The old rule must be gone. Both present would mean nothing changed.
  if exists (select 1 from pg_constraint where conname = 'expenses_paid_after_incurred') then
    raise exception 'The old day-granular constraint is still attached.';
  end if;

  -- Paying month-end payroll on the 26th — the press that failed — must now
  -- satisfy the rule. Asserted as arithmetic rather than by writing a row, so
  -- this proves the predicate itself and leaves no test data behind.
  if not ('2026-08-26'::date >= date_trunc('month', '2026-08-31'::date::timestamp)::date) then
    raise exception 'Paying month-end payroll mid-month is still refused.';
  end if;

  -- ...and a payment in the PREVIOUS month must still be refused.
  if ('2026-07-26'::date >= date_trunc('month', '2026-08-31'::date::timestamp)::date) then
    raise exception 'A payment dated before the incurred month is being accepted.';
  end if;

  select count(*) into covered
    from public.expenses
   where source = 'payroll_run'
     and period_month = date_trunc('month', current_date)::date;

  raise notice 'Payment dates are now month-granular. % salary rows can be settled today.', covered;
end $$;
