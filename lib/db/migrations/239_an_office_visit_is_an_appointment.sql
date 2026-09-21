-- ============================================================================
-- 239 · AN OFFICE VISIT IS AN APPOINTMENT OF ITS OWN
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, on the new Appointments page: *"One more is the office
-- visit. That appointment can also be done. That filter should be present so
-- we can see, for which type of visit or appointment each one is coming."*
--
-- A client coming to the office is neither a site visit (someone meets them at
-- the plot) nor a meeting (which may be online) nor a call.
--
-- ⚠️ ONLY THE ENUM VALUE HERE. Postgres will not let a new enum value be used
-- in the transaction that added it, and every function that names it is in
-- 240, which runs after this one commits.
-- ============================================================================

alter type public.crm_appointment_kind add value if not exists 'office_visit';
