-- ============================================================================
-- 075 · AN ADVANCE IS A KIND OF INVOICE — owner request 2026-08-29
-- ----------------------------------------------------------------------------
-- Owner, asked which invoice types the form should offer, chose the three that
-- already exist plus a fourth:
--
--   Monthly invoice            retainer  — the agreed package fee for one month
--   Project add-on invoice     add_on    — extra work on a project that already
--                                          pays a monthly fee
--   One-off project invoice    one_off   — a standalone job, no retainer
--   Advance / deposit invoice  advance   — NEW. Money taken before work starts;
--                                          the balance is invoiced separately.
--
-- ── ⚠️ THIS MIGRATION ADDS ONE ENUM VALUE AND NOTHING ELSE. ON PURPOSE. ────
-- Postgres refuses to USE a new enum value in the transaction that created it:
--
--     ERROR: unsafe use of new value "advance" of enum type revenue_kind
--     HINT:  New enum values must be committed before they can be used.
--
-- A cast from text does not get around it — the check is on the value, not on
-- how it was written. `scripts/migrate.mjs` wraps each file in ONE transaction,
-- so adding the value and referring to it cannot be one migration.
--
-- This is the second time this has bitten this schema. Migrations 066 and 067
-- are split for exactly the same reason, and 066's header records the measured
-- failure. 076 does the work; apply them in order.
--
-- ── WHY A KIND AND NOT A FLAG ───────────────────────────────────────────────
-- `is_advance boolean` was the alternative and it is worse: the four types are
-- mutually exclusive — an invoice is one of them — and a set of booleans lets a
-- row claim to be two at once. The kind already exists, already drives the
-- revenue reporting split, and the form is a radio group either way.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'revenue_kind' and e.enumlabel = 'advance'
  ) then
    alter type public.revenue_kind add value 'advance';
  end if;
end $$;

comment on type public.revenue_kind is
  'What is being billed. retainer = the monthly package fee; add_on = extra '
  'work on a project that already pays one; one_off = a standalone job; '
  'advance = money taken before work begins, balance invoiced separately (075).';
