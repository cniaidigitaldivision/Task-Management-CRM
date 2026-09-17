-- ============================================================================
-- 173 · QUALIFYING VALUES FOR A SERVICE LEAD
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"If it is an ERP enquiry, definitely they are not real
-- estate; they are AI services. Their questions will be different, their
-- services will be different, their time duration will be different, their
-- budget will be different… you are still showing me qualifying questions
-- relevant to real estate."*
--
-- Correct, and it was a real fault in 167. Measured: EVERY demo lead arrives on
-- "ERP enquiry", "CRM enquiry" or "Taskly enquiry", and the budget bands offered
-- to them were 20 lakh to over a crore — plot money. For a CRM at 2 lakh, one
-- band ever applies and it is the bottom one, so the answer carried no
-- information at all.
--
-- ⚠️ ALONE IN ITS OWN MIGRATION. A label added to an existing enum cannot be
-- USED in the transaction that adds it, and 174's self-check writes these. 157
-- and 168 exist for exactly this reason.
--
-- ⚠️ THE `svc_` PREFIX IS DELIBERATE AND PERMANENT. A service band and a plot
-- band are different SCALES of the same column, and a report that summed them
-- would be adding lakhs to crores. The prefix means a value is never ambiguous
-- about which world it came from, in the database or on a screen.
--
-- ⚠️ AND THE FOUR BANT AXES DO NOT CHANGE. Budget, Authority, Need and Timeline
-- are universal — what varies is the OPTIONS for two of them. Adding a second
-- set of columns would have meant a second gate, a second set of reports and two
-- definitions of "qualified".
-- ============================================================================

-- ── B · budget, at software scale ──────────────────────────────────────────
-- Anchored on the owner's own worked example: their CRM at 2 lakh, floor 1 lakh.
alter type public.crm_budget_band add value if not exists 'svc_under_50k';
alter type public.crm_budget_band add value if not exists 'svc_50k_to_1l';
alter type public.crm_budget_band add value if not exists 'svc_1l_to_3l';
alter type public.crm_budget_band add value if not exists 'svc_3l_to_5l';
alter type public.crm_budget_band add value if not exists 'svc_over_5l';

-- ── N · which service they actually want ───────────────────────────────────
-- The owner's own list: *"maybe someone is interested in digital marketing,
-- maybe someone is interested in ERP, maybe someone is interested in CRM or
-- WhatsApp API automations… or in that software to automate all their tasks."*
alter type public.crm_purpose add value if not exists 'svc_erp';
alter type public.crm_purpose add value if not exists 'svc_crm';
alter type public.crm_purpose add value if not exists 'svc_digital_marketing';
alter type public.crm_purpose add value if not exists 'svc_whatsapp_automation';
alter type public.crm_purpose add value if not exists 'svc_task_automation';
alter type public.crm_purpose add value if not exists 'svc_website';
alter type public.crm_purpose add value if not exists 'svc_other';
