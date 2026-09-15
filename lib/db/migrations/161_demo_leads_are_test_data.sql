-- ============================================================================
-- 161 · THE DEMO LEADS SAY SO IN THE COLUMN, NOT ONLY IN THE PROJECT NAME
-- ----------------------------------------------------------------------------
-- The owner's standing requirement, shipped with the property pack:
-- `is_test_data: true` and `exclude_from_real_reports: true`.
--
-- Migration 150 added `crm_leads.is_test_data` with `default false` and
-- backfilled nothing. Measured 2026-09-15: **0 of 659 leads carried the flag**,
-- including all 21 on the demo project — while `crm_properties` and
-- `crm_quotations` were correctly flagged by their seed scripts, which is what
-- made the gap invisible. Anything filtering on the column would have counted
-- demo enquiries as real ones.
--
-- ⚠️ FOUND BY A CHECK THAT ASSERTED AN INHERITANCE, NOT BY READING. A new
-- appointment copies `is_test_data` from its lead; `scripts/check-appointments.mjs`
-- asserted the copy arrived as `true` and it arrived as `false`. The appointment
-- code was right and the lead data was wrong.
--
-- ── ⚠️ THE FILTER IS THE WHOLE RISK OF THIS FILE ───────────────────────────
-- 638 of these leads are Chitral Royal Homes — a real client's real enquiries.
-- Flagging one of those as test data would remove a paying client's lead from
-- the reports their money is measured by. The predicate is the project's own
-- name ending `[demo]`, the same convention every seed script here uses, and the
-- self-check proves the real project is untouched before it lets the migration
-- commit.
-- ============================================================================

update public.crm_leads l
   set is_test_data = true
  from public.projects p
 where p.id = l.project_id
   and p.name like '%[demo]'
   and l.is_test_data = false;

comment on column public.crm_leads.is_test_data is
  'Excluded from real reporting. ⚠️ Set from the PROJECT (a name ending [demo]) '
  'rather than per row — a flag somebody has to remember to tick is one that '
  'gets forgotten. New leads set it in app.crm_create_lead (158); this migration '
  'backfilled the 21 that predated the column. Migration 161.';

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  n_demo int; n_demo_flagged int;
  n_real int; n_real_flagged int;
begin
  select count(*) into n_demo from public.crm_leads l
    join public.projects p on p.id = l.project_id where p.name like '%[demo]';
  select count(*) into n_demo_flagged from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.is_test_data;

  select count(*) into n_real from public.crm_leads l
    join public.projects p on p.id = l.project_id where p.name not like '%[demo]';
  select count(*) into n_real_flagged from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name not like '%[demo]' and l.is_test_data;

  -- 1 · Every demo lead is flagged.
  if n_demo <> n_demo_flagged then
    raise exception '161 · % of % demo leads are still unflagged', n_demo - n_demo_flagged, n_demo;
  end if;

  -- 2 · ⚠️ AND NOT ONE REAL LEAD IS. This is the assertion that matters: a
  --     client's enquiry marked as test data vanishes from the reports their
  --     spend is judged by, and nobody would notice until a number looked low.
  if n_real_flagged <> 0 then
    raise exception '161 · % REAL leads were flagged as test data', n_real_flagged;
  end if;

  -- 3 · The real ones are all still there.
  if n_real < 600 then
    raise exception '161 · only % real leads remain — something deleted rows', n_real;
  end if;

  raise notice '161 · % demo leads flagged, % real leads untouched and none of them flagged',
    n_demo_flagged, n_real;
end $chk$;
