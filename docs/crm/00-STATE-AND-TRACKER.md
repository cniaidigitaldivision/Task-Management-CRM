# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | `crm` (from `main` at `0726704`) |
| **Route** | `/leads` · nav: Growth → Campaign & Lead Desk |
| **Phase** | **0 complete → Phase 1 ready.** Q1–Q5 answered 2026-09-09. Nothing built yet. |
| **Last updated** | 2026-09-09 |
| **Last migration applied anywhere** | 109. CRM migrations start at 110. |

---

## Where we are, in one paragraph

The page exists as an honest scaffold with no figures on it. Nothing else is
built. The Meta side has been verified against the live API: lead capture works,
and there are **615 real leads on Chitral Royal Homes** with one form still taking
leads today. AI & Digital — which the owner expected to start with — has **no ad
account and no lead forms**. The plan is written; five decisions block the first
line of code.

---

## Done

- [x] Branch `crm` created and pushed
- [x] `/leads` page + layout + nav entry (scaffold, no data, Admin-only floor)
- [x] Nav fixture test updated so the route is pinned
- [x] Verified ad accounts per suite — see `01-VERIFIED-FACTS.md`
- [x] Verified lead forms and lead counts per page
- [x] Verified lead data is readable, with its field shape
- [x] Confirmed Graph API v26.0 (unaffected by the v20.0 sunset)
- [x] Market research on CRM features — see `02-FEATURE-MAP.md`
- [x] Data model drafted — see `03-DATA-MODEL.md`
- [x] Phases written — see `04-PHASES.md`

## Blocked — on the owner, in Meta rather than in code

- [ ] **Three pages running live lead campaigns are unreadable.** The Executive
      Housing (302982680199394), AGC Construction (1145446828660442) and
      Investo 21 (107426385582365) are in no portfolio our system user can reach.
      Their leads are accumulating where we cannot see them, and the 90-day clock
      is running on them. See `06-CAMPAIGNS-AND-COVERAGE.md`.
- [ ] **`campaign_name` on a lead is empty** because the page and the ad account
      that runs its campaign sit in different portfolios. One permission change in
      Meta removes a whole subsystem — see the same file.
- [ ] **Which project does each of the 6 campaigns belong to?** The names already
      read like project names, so this is a five-minute confirmation.

## Next, now that Q1–Q5 are answered

1. Migration 110 — `crm_leads`, `crm_lead_notes`, `crm_lead_activity`, RLS,
   self-check as `cni_app` with no session
2. The importer — list forms, page leads, upsert on `(source, external_id)`
3. **Run the one-off backfill the same day** ⚠️ 90-day clock
4. `pg_cron` schedule, every 15 minutes
5. Only then: the list UI

---

## ⚠️ The deadline nobody set for us

**Meta deletes lead data 90 days after submission.**

- Today: 2026-09-09
- The 553-lead form's newest lead: **2026-07-28** (43 days old)
- Its oldest leads are materially older and some may already be gone

Every day without an importer costs leads permanently. This is the reason Phase 1
is "capture", not "design".

---

## Decisions log

Answers to open questions get recorded here with the date, so a later session can
see not just what was decided but when and why.

| Date | Question | Answer |
|---|---|---|
| 2026-09-09 | Q1 Where to start | **Chitral first.** AI & Digital's ad account is being created by the owner's ads person — "we will work on that tomorrow". All projects appear in a dropdown, the same pattern as the Studio. |
| 2026-09-09 | Q2 Who reads a lead | **Admin and Super Admin: all.** **Team Coordinator: yes, included.** **Sales staff: the leads assigned to them**, with the full record — name, phone, project, everything relevant. |
| 2026-09-09 | Q3 Project link | **Yes, every lead belongs to a project.** Plus a **campaign column** on the table, and campaign filters, so "which campaign produced this lead" is answerable per project. |
| 2026-09-09 | Q4 Stages | New · Contacted · Follow-up · Qualified · Visited · Scheduled · Negotiation · Won · Lost. Lost reasons start: wrong number, not serious, budget not enough — owner wants more suggested. |
| 2026-09-09 | Q5 Roles | **Existing four roles, no new rank.** CRM access = Admin, Super Admin, Team Coordinator, plus **project members marked as sales team**. Developers, content creators and campaign staff are excluded. |
| 2026-09-09 | Q7 Client vs lead | **Two things.** A lead is an enquiry. It becomes a **client** when they engage — accept a quotation, or work starts. One client can have many leads. |
| 2026-09-09 | Q10 Testing account | One staff member added to the **sales team**; all leads assigned to them to exercise the staff view. |
| 2026-09-09 | Storage | ⚠️ **Database-first, always.** Leads and reports are stored in our database and every screen reads from there — never live from Meta. Same rule the Studio already follows. |
| 2026-09-09 | Q9 Smart dashboard | Owner has an OpenAI key and wants deep intelligence: per-lead coaching, campaign-vs-staff diagnosis, recording of calls/chats/notes. See `07-AI-PLAN.md`. |

---

## Facts that will go stale

Re-verify rather than trust, after roughly 2026-10-09:

- Lead counts per form (they change daily)
- Which forms are ACTIVE
- Whether AI & Digital has been given an ad account since
- Whether `leads_retrieval` is granted via App Review or only working because the
  caller is an asset admin

The exact calls to re-run are at the foot of `01-VERIFIED-FACTS.md`.

---

## How to resume cold

1. Read this file.
2. Read `01-VERIFIED-FACTS.md` — what is true, and what was never checked.
3. Check the decisions log above. If Q1–Q5 are still unanswered, the job is to
   get them answered, not to start building.
4. `04-PHASES.md` has the order of work and the reason for that order.
