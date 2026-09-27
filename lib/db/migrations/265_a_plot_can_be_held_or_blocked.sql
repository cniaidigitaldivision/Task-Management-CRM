-- ============================================================================
-- 265 · A PLOT CAN BE HELD, AND A PROPERTY HAS ITS OWN PAPERS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-27, specifying the Properties page:
--
--   *"Availability states: Available, Reserved, Sold, On Hold and Blocked."*
--   *"Property documents: property sheet, site plan and payment plan."*
--
-- `crm_property_status` has said `available · reserved · sold · withdrawn`
-- since 150. Two of the five she named are missing, and `withdrawn` is not one
-- of hers — it stays, because eight quotations and a booking trigger already
-- reference this type and removing a label from an enum in use is a rewrite of
-- every row that holds it. It simply will not be offered in the new UI.
--
-- ⚠️ ON HOLD IS NOT BLOCKED, and the difference is who did it. A hold is a
-- salesperson keeping a plot warm for somebody who is deciding; a block is the
-- company taking it off the market — a legal question, a dispute, a plot the
-- developer has not released. The Properties page counts them in one card
-- ("On hold / Blocked 7") and the reference does the same, but they are two
-- different answers to "why can I not sell this?" and one word could not carry
-- both.
--
-- ── ⚠️ WHY THIS FILE HAS ONLY ALTER TYPE IN IT ───────────────────────────
-- `alter type ... add value` cannot be USED in the transaction that adds it.
-- 266 puts these labels in a CHECK, a policy and a self-check, so it has to
-- commit after this one. Same reason 263 was alone last week.
-- ============================================================================

alter type public.crm_property_status add value if not exists 'on_hold';
alter type public.crm_property_status add value if not exists 'blocked';

-- The two papers a plot carries that a project does not. `site_plan` already
-- exists (150) and is shared between the two.
alter type public.crm_document_kind add value if not exists 'property_sheet';
alter type public.crm_document_kind add value if not exists 'payment_plan';
