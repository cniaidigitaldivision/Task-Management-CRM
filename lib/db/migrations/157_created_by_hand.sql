-- ============================================================================
-- 157 · A LEAD SOMEBODY TYPED IN
-- ----------------------------------------------------------------------------
-- One enum value, on its own, for the reason 148 had to learn the hard way:
--
--   ⚠️ A VALUE ADDED BY `ALTER TYPE … ADD VALUE` CANNOT BE REFERENCED IN THE
--   SAME TRANSACTION. Not by a cast, not by a comparison, not by enum_range.
--   The migration runner wraps each file in one transaction, so the only way to
--   add a label and then use it is two files. This is the first.
--
-- ── WHY NOT REUSE `imported` ───────────────────────────────────────────────
-- `imported` means Meta handed it to us. A walk-in that Sarah typed at her desk
-- is a different event with a different accountability: somebody chose to enter
-- it, and their name belongs on it. Collapsing the two would make the timeline
-- say a lead arrived from a campaign that never ran.
-- ============================================================================

alter type public.crm_activity_kind add value if not exists 'created';
