# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | `crm` (from `main` at `0726704`) |
| **Route** | `/leads` · nav: Growth → Campaign & Lead Desk |
| **Phase** | **0 — decisions.** Nothing built. Waiting on Q1–Q5. |
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

## Blocked

- [ ] **Q1–Q5 in `05-OPEN-QUESTIONS.md`.** Asked in the terminal 2026-09-09;
      awaiting answers. Nothing in Phase 1 starts until these land.

## Next, the moment Q1–Q5 are answered

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
| — | — | *(none yet)* |

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
