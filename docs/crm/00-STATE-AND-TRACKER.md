# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | `crm` (from `main` at `0726704`) |
| **Route** | `/leads` · nav: Growth → Campaign & Lead Desk |
| **Phase** | **Steps 1–3 DONE. Module 1 complete.** 615 leads stored, import scheduled. Step 4 (the list screen) is next. |
| **Scope** | ⚠️ **Chitral Royal Homes only.** One project, end to end. |
| **Last updated** | 2026-09-09 |
| **Last migration applied anywhere** | **113.** CRM next: 114. |

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
- [x] Phases written — see `04-PHASES.md` (superseded by `08-TWELVE-STEPS.md`)
- [x] **Step 1 · migration 110** — `sales` added to `project_role`
- [x] **Step 1 · migration 111** — six CRM tables, 15 policies, 23 indexes, RLS on
      all six, self-check green: a member sees only leads assigned to them, a
      duplicate Meta lead is refused, a lost lead needs a reason, and the
      activity log refuses deletion at every rank including Admin
- [x] **Step 2 · migration 112** — `app.crm_lead_sources` reader and
      `app.crm_record_leads` writer, both SECURITY DEFINER, self-checked with NO
      session exactly as the cron will call them
- [x] **Step 2 · the importer** — `lib/crm/lead-import.ts`, `lib/crm/lead-fields.ts`,
      `lib/domain/phone.ts`, `/api/crm/lead-sync`, 32 new tests
- [x] **Step 2 · THE BACKFILL RAN.** 615 Chitral leads imported, 6 forms, 615
      activity rows. Second run: 0 new, 615 updated — idempotency proved on real
      data, not just in the self-check.

### ⚠️ What the backfill found

| | |
|---|---|
| Leads | **615**, all with a name, phone and city |
| Oldest lead | **2026-06-11** — 91 days old. Past Meta's 90-day window; caught with days to spare, and some older ones are likely already gone. |
| Newest | 2026-09-09 |
| Phone numbers normalised | **612 of 615** |
| The 3 that were not | 2 are Meta test leads (`<test lead: dummy data…>`), 1 is a 10-digit number that is not a mobile. All three correctly refused rather than guessed — the raw value is kept. |
| **Duplicate numbers** | 615 leads, **597 distinct numbers** — so ~18 leads share a phone with another. Real people who enquired twice. Worth surfacing in Step 6. |
| ⚠️ Meta test leads | 2 rows are Meta's own test submissions. They are noise in a sales pipeline. Owner's call whether to delete or flag them. |

- [x] **Step 3 · migration 113** — `crm_lead_sync_runs` (a record of every run,
      so a broken import is visible rather than silent), `app.crm_record_sync_run`,
      `app.trigger_crm_lead_sync`, and the pg_cron job **on Supabase**,
      `*/15 * * * *`. Verified: job active, secret present, run rows written.

### ⚠️ The cron 404s until this branch is deployed

Fired the trigger by hand: request accepted, response **404**. The job calls
`https://taskly.aidigitaldivision.com/api/crm/lead-sync`, and that route exists
only on the `crm` branch — production is still on `main`.

**This is not a fault and needs no fix.** It starts working by itself the moment
the branch is merged and deployed, which is why the job was left ACTIVE rather
than disabled: an active job that heals itself beats a disabled one somebody has
to remember to switch on. Until then it is 96 harmless 404s a day.

⚠️ **Do not read an empty `crm_lead_sync_runs` as "the import is broken" before
the merge.** Nothing is recorded because nothing reaches the route.

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

## Next — the build order is now `08-TWELVE-STEPS.md`

**Scope narrowed by the owner 2026-09-10:** *"first start working on Chitral
Royal Homes. First make them live and mention that for other projects whose leads
you can't read, it's coming soon or not connected."*

Steps 1–3 (tables, Chitral importer + backfill, schedule) need **nothing from the
owner** and can start on their word. Everything else is sequenced in that file
with its dependencies named.

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
| 2026-09-10 | Scope | **Chitral Royal Homes only, first.** Other projects show "Not connected" with a reason. Owner has PAGE access to Executive Housing / AGC Construction / Investo 21 but **not their business portfolios** — will confirm when that lands. |
| 2026-09-10 | Build order | Twelve steps, four modules — `08-TWELVE-STEPS.md`. |
| 2026-09-10 | Database | Growth, indexes, backups and retention written up in `09-DATABASE-MANAGEMENT.md`. Storage is not the constraint; ~5 KB per fully worked lead. |
| 2026-09-10 | ⚠️ **Scope, confirmed** | **One project: Chitral Royal Homes.** Build the whole CRM for it end to end — capture, desk, follow-through, intelligence — before any second project. Owner: *"I'm not saying that you carry 2 or 3 projects at a time, their leads at a time, and every stuff at a time."* |
| 2026-09-10 | Schema stays multi-project | ⚠️ The TABLES keep `project_id` even though only one project is used. Hardcoding one project would make "later on I will do the same thing for the other projects" a rewrite instead of a row. Costs nothing now; saves the whole second build. |

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
