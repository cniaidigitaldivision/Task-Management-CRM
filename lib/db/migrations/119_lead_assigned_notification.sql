-- ============================================================================
-- 119 · BEING GIVEN A LEAD IS WORTH TELLING SOMEBODY — Step 7
-- ----------------------------------------------------------------------------
-- The bell already carries `task_assigned`. A lead is not a task — it is a
-- stranger who is waiting for a call, and the whole point of assigning one is
-- that somebody rings them soon. Reusing `task_assigned` would put "Chitral
-- Royal Homes" in a feed of task codes and, worse, let somebody silence their
-- task notifications and lose their leads with them.
--
-- ⚠️ WHY THIS FILE CONTAINS ONE LINE
-- `ALTER TYPE … ADD VALUE` may run inside a transaction on PostgreSQL 12+, but
-- the new label CANNOT BE USED until that transaction commits. `migrate.mjs`
-- wraps every file in one, so anything referencing it belongs in 120. Same split
-- as 110/111 and 115/116.
-- ============================================================================

alter type public.notification_kind add value if not exists 'lead_assigned';
