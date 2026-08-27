-- ============================================================================
-- 066 · AN OWNER IS A WAY OF BEING ENGAGED
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26:
--
--   "Ammar Afzal Khan is the CEO or he is the owner of this business or a
--    profit-sharing business so exclude his salary all over."
--
-- ── ⚠️ THIS MIGRATION ADDS ONE ENUM VALUE AND NOTHING ELSE. ON PURPOSE. ────
-- Postgres refuses to USE a new enum value in the transaction that created it:
--
--     ERROR: unsafe use of new value "owner" of enum type employment_type
--     HINT:  New enum values must be committed before they can be used.
--
-- A cast from text does not get around it — the check is on the value, not on
-- how it was written. `scripts/migrate.mjs` wraps each file in one transaction,
-- so adding the value and marking somebody with it CANNOT be one migration.
-- Measured, not assumed: the combined version failed exactly this way.
--
-- 067 does the marking. Apply them in order; 067 alone will fail with "invalid
-- input value for enum".
--
-- ── ⚠️ WHY A STATUS AND NOT A DELETED ROW ──────────────────────────────────
-- The obvious move is to delete his `employee_compensation` row. That works
-- today and is unreadable in six months: an absent row cannot be told apart
-- from "nobody has entered his salary yet", and the next person to look would
-- helpfully add one. `owner` says the thing out loud, and the reason travels
-- with the data.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'employment_type' and e.enumlabel = 'owner'
  ) then
    alter type public.employment_type add value 'owner';
  end if;
end $$;

comment on type public.employment_type is
  'How somebody is engaged. `owner` shares profit rather than drawing a salary '
  'and is excluded from every payroll figure — see migrations 066 and 067.';
