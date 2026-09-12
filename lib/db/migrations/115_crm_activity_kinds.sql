-- ============================================================================
-- 115 · TWO THINGS THE TIMELINE COULD NOT SAY — Step 6 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Step 6 lets somebody mark a lead hot and set the next action. `crm_activity_kind`
-- had no label for either, so both changes would have happened with the timeline
-- silent about them — and a log with holes in it is worse than no log, because
-- the holes are invisible and everything else looks complete.
--
-- ⚠️ `temperature_set`, not `temperature_changed`: the first time somebody marks
-- a lead hot, nothing changed — it had no temperature at all. "Changed" would be
-- a small lie on the most common case.
--
-- ── ⚠️ WHY THIS FILE CONTAINS TWO LINES ────────────────────────────────────
-- `ALTER TYPE … ADD VALUE` may run inside a transaction on PostgreSQL 12+, but
-- the new label CANNOT BE USED until that transaction commits — any reference
-- raises "unsafe use of new value". `scripts/migrate.mjs` wraps every file in one
-- transaction, so the triggers that write these rows cannot live here.
--
-- 116 does everything that needs the values. Same split as 110/111 and 106/107.
-- ============================================================================

alter type public.crm_activity_kind add value if not exists 'temperature_set';
alter type public.crm_activity_kind add value if not exists 'next_action_set';
