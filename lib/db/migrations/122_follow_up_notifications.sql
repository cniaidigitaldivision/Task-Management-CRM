-- ============================================================================
-- 122 · TWO THINGS THE BELL COULD NOT SAY — Step 8
-- ----------------------------------------------------------------------------
-- `lead_due`        a salesperson has leads waiting on them today
-- `lead_neglected`  the manager, told a colleague's leads have gone quiet
--
-- ⚠️ NOT `task_due_soon` REUSED. A lead is not a task, and sharing the kind
-- would let somebody silence their task reminders and lose their lead reminders
-- with them — the same reason `lead_assigned` got its own kind in 119.
--
-- ⚠️ WHY THIS FILE CONTAINS TWO LINES
-- `ALTER TYPE … ADD VALUE` may run inside a transaction on PostgreSQL 12+, but
-- the new label CANNOT BE USED until that transaction commits. `migrate.mjs`
-- wraps every file in one, so everything that references these is in 123.
-- ============================================================================

alter type public.notification_kind add value if not exists 'lead_due';
alter type public.notification_kind add value if not exists 'lead_neglected';
