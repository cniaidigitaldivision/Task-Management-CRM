-- ============================================================================
-- 148 · THE FUNNEL GETS ITS REAL SHAPE, AND A SOURCE GETS A CHANNEL
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-14, settling the three questions in `15-MY-LEADS-PHASE.md`:
-- the stage list per their specification; priority as high · normal · low,
-- DERIVED rather than stored; and source widened because *"maybe some source in
-- the next future, maybe from Google or somewhere else."*
--
-- ── ⚠️ DECIDED NOW BECAUSE IT GETS MORE EXPENSIVE EVERY DAY ────────────────
-- Three leads sit on `follow_up` today and 643 on `new`. The same change in a
-- month, after the sales testers have worked a few hundred leads, means
-- rewriting `crm_lead_activity` history so the timeline does not contradict the
-- stage it names. Today it is three rows.
--
-- ── ⚠️ `follow_up` IS RETIRED, NOT DELETED ─────────────────────────────────
-- PostgreSQL has no `ALTER TYPE … DROP VALUE`, and recreating `crm_stage` would
-- mean dropping and rebuilding every policy, index and function that mentions
-- it — a far larger blast radius than the thing being fixed. So the label stays
-- in the type, unused: the rows move, `STAGE_ORDER` in TypeScript stops
-- offering it, and a check below proves nothing is left on it.
--
-- ⚠️ AND IT MOVES TO `contacted`, NOT `qualified`. "Following up" says somebody
-- has been spoken to; it says nothing about whether they are a real buyer.
-- Promoting three leads into `qualified` would put them past a gate nobody
-- decided they had passed.
--
-- The owner's own reasoning for the demotion, which is right: a follow-up is an
-- ACTIVITY, not a position. A qualified lead, a quotation-stage lead and a lead
-- in negotiation can all be awaiting one — and `next_action` + `next_action_at`
-- already carry exactly that.
--
-- ── ⚠️ AND "NEW REPLY" IS DELIBERATELY NOT A STAGE ─────────────────────────
-- The reference design shows it as one. It is a conversation state: a lead that
-- replies while in `negotiation` must still be in negotiation, or the funnel
-- forgets where they were. The desk already says it twice over — the green
-- WhatsApp mark on the row and the "Unread replies" card.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE STAGES
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ APPENDED, NOT POSITIONED. `AFTER 'proposal_pending'` fails with "unsafe use
-- of new value" — a label added in this transaction cannot be REFERENCED by the
-- next statement in it, only committed. Chaining three `AFTER`s looked tidier
-- and could never have run.
--
-- ⚠️ AND THE ENUM'S INTERNAL ORDER IS NOT THE FUNNEL'S ORDER ANYWAY. The order
-- on screen is `STAGE_ORDER` in `lib/domain/crm-stages.ts`, which is deliberate:
-- 111's note says `won`/`lost` sit at the end because they have to sit
-- somewhere, and `isOpen` is what code should ask. Sorting by the enum would
-- make "further along" mean "more recently added".
alter type public.crm_stage add value if not exists 'proposal_pending';
alter type public.crm_stage add value if not exists 'quotation_sent';
alter type public.crm_stage add value if not exists 'visit_scheduled';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE SOURCE
-- ----------------------------------------------------------------------------
-- ⚠️ THE CHANNEL IS AN ENUM, THE DETAIL IS TEXT, and that split is the point.
-- The design wants "Facebook / Lead ad", "Google / Search ad", "Website /
-- Contact form". Enumerating every channel × type pair is how an enum reaches
-- thirty values nobody can read, and how adding "Performance Max" becomes a
-- migration. The channel is a closed set; what kind of ad it was is not.
--
-- ⚠️ `meta_lead_ad` STAYS AND IS NOT REWRITTEN. All 643 imported leads carry it,
-- and we do not know which of them came from Facebook and which from Instagram
-- — Meta's payload does not say. Rewriting them to `facebook` would be
-- inventing a fact about 643 real people. It renders as "Meta · Lead ad" until
-- something real says otherwise.
-- ════════════════════════════════════════════════════════════════════════════
alter type public.crm_lead_source add value if not exists 'facebook';
alter type public.crm_lead_source add value if not exists 'instagram';
alter type public.crm_lead_source add value if not exists 'google';
alter type public.crm_lead_source add value if not exists 'linkedin';
alter type public.crm_lead_source add value if not exists 'referral';
alter type public.crm_lead_source add value if not exists 'walk_in';
alter type public.crm_lead_source add value if not exists 'import';

alter table public.crm_leads
  /* "Lead ad" · "Search ad" · "Contact form" · "Existing client". Free text
     because the sales team names these, not us, and the list is open. */
  add column if not exists source_detail text;

comment on column public.crm_leads.source_detail is
  'What kind of source, in words — "Lead ad", "Search ad", "Contact form". The '
  'CHANNEL is the enum; this is the open half. Migration 148.';

-- ⚠️ NO `priority` COLUMN, ON PURPOSE. The owner chose the derived option:
-- overdue or an unanswered reply is High, a lead with a plan is Normal, a closed
-- one is Low. A stored column would be a second rating beside `temperature` that
-- says almost the same thing, and the pair would disagree within a week. Derived
-- means there is nothing to keep up to date and it cannot go stale.
-- It is computed in `lib/domain/lead-priority.ts`, beside the stage helpers.

-- ============================================================================
-- ⚠️ NO SELF-CHECK THAT TOUCHES THE NEW LABELS, AND THIS IS THE THIRD TIME THE
-- SAME RULE BIT IN ONE FILE. `ALTER TYPE … ADD VALUE` may run inside a
-- transaction, but the new label cannot be READ in it either — not by
-- `enum_range`, not by a cast, not by `AFTER`. Two attempts failed here before
-- the rule was stated plainly:
--
--   1. `add value 'quotation_sent' AFTER 'proposal_pending'`  → unsafe use
--   2. a self-check counting `enum_range(...)` for the new labels → unsafe use
--
-- So this file is DDL and nothing else. Everything that USES the new labels —
-- moving the rows, re-weighting the rota, and proving all ten stages exist —
-- lives in 149, which runs in its own transaction. The same split as 110/111,
-- 119/120 and 144/145, and the reason those files are one line long.
--
-- The column below is an ordinary DDL change and is safe here.
-- ============================================================================
do $$
declare n_total int;
begin
  select count(*) into n_total from public.crm_leads;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_leads'
       and column_name = 'source_detail'
  ) then
    raise exception '148 · source_detail was not added';
  end if;
  raise notice '148 · labels added and source_detail exists; % leads untouched. 149 proves the rest', n_total;
end $$;
