# Phases — SUPERSEDED by `08-TWELVE-STEPS.md`

⚠️ **Do not plan from this file.** It was the first pass, written 2026-09-09 as
five phases. On 2026-09-10 the owner asked for the work broken into twelve
steps, and `08-TWELVE-STEPS.md` is that — four modules, twelve shippable steps,
each naming what it needs from the owner.

Two numbering schemes for one plan is how a plan stops being followed, so this
file is kept only for the reasoning behind the ORDER, which did not change:

> stop the data loss, then make it usable, then make it clever.

The mapping, if you are cross-referencing an older note:

| This file | `08-TWELVE-STEPS.md` |
|---|---|
| Phase 0 — decisions | Done. Answers are in the tracker's decisions log. |
| Phase 1 — capture and keep | **Module 1**, steps 1–3 |
| Phase 2 — the desk | **Module 2**, steps 4–7 |
| Phase 3 — follow-up and reporting | **Module 3**, steps 8–10 |
| Phase 4 — real-time and integrations | Parked; see the parked table in step 12 |
| Phase 5 — the AI | **Module 4**, steps 11–12 |

---

*Original text follows.*

---


The ordering principle: **stop the data loss, then make it usable, then make it
clever.** Every phase ends somewhere shippable — no phase leaves the product
half-built.

---

## Phase 0 — Decisions (now, blocking)

Nothing is built until `05-OPEN-QUESTIONS.md` has answers to Q1–Q5. They change
the table, and a table changed after a thousand rows is a migration with a
backfill and a risk.

**Exit:** the five answers written into `00-STATE-AND-TRACKER.md`.

---

## Phase 1 — Capture and keep (urgent)

⚠️ **This is urgent for a reason that has nothing to do with ambition.** Meta
deletes lead data at 90 days. 615 leads exist; the oldest are at or past that
edge. Everything in this phase is about getting them into a table we control
before they are gone.

1. `crm_leads` + `crm_lead_notes` + `crm_lead_activity`, with RLS and a
   self-check that runs as `cni_app` with no session.
2. An importer: for every linked Meta account, list lead forms, page through
   leads, upsert on `(source, external_id)`.
   - Runs from `pg_cron` like the Meta sync, every 15 minutes.
   - Idempotent. Safe to run twice, because it will be.
3. A **one-off backfill** of everything currently retrievable — run it the day
   the table exists.
4. Nothing on screen yet beyond a count. The page can stay as it is.

**Exit:** the leads are ours. From here the 90-day clock stops mattering.

**Risk if delayed:** every day, some of the oldest leads become permanently
unrecoverable. This is the only part of the plan with a deadline set by somebody
else.

---

## Phase 2 — The desk

The screen from the PropForce reference, built for real rows.

1. **Admin view** — project dropdown (same pattern as the Studio), the list, and
   filters: stage, owner, temperature, source, date range.
2. **The row**, in PropForce's column order because it is right: next action and
   when · last call outcome and how long ago · owner · temperature · lead name
   and when they came · project · actions.
3. **Sorted by next action**, not by created date. This is the difference between
   a list you work from and a list you scroll.
4. **Staff view** — the same list, pre-scoped to "mine", with the same filters.
   One component, two scopes, so they cannot drift apart.
5. **The detail panel** — the answers Meta gave, the note thread, the activity
   timeline, and the actions.
6. **Actions that work today with no new integration:** log a call outcome, add a
   note, change stage, set the next action, WhatsApp link-out (`wa.me`).

**Exit:** a staff member can run their day from it.

---

## Phase 3 — Follow-up and reporting

1. **Assignment rules** — round-robin, or by project, or by hand. Start manual
   with a bulk-assign; automate once there is a rule worth automating.
2. **Follow-up reminders** — due next actions on the dashboard and in the bell,
   reusing the notification system rather than inventing one.
3. **Email with templates**, logged to the activity timeline.
4. **Reports** — source → conversion, per-staff, ageing, stage funnel. The CSV /
   XLSX / PDF writers already exist and already take a typed-cell `Report`.
5. **Duplicate detection** on `phone_e164`.
6. **Campaign attribution** — resolve ad → adset → campaign, so reporting can say
   which campaign produced which leads.

**Exit:** the division can answer "which campaign is worth the money".

---

## Phase 4 — Real-time and the integrations that need approval

1. **Leadgen webhook.** Under 5 seconds instead of 15 minutes, and response time
   moves conversion measurably. ⚠️ Keep the poller — **webhooks fail silently**,
   and the poller becomes the reconciliation that catches the drops.
2. **WhatsApp Business API** — real sends and templates, once the number and
   approvals exist.
3. **Call & voice** — provider decision first. Owner has deferred this.

---

## Phase 5 — The AI, once there is something to be intelligent about

Deliberately last, and this is the argument for it:

- **Lead scoring** needs outcomes. Scoring before anyone has marked a lead won or
  lost produces a number with no information in it — which is worse than no
  number, because people trust it.
- **Call summarisation** needs calls to be logged first.
- **Next-best-action** needs a history of what actions led where.

What is worth building here, in order: scoring from real conversion history →
summarising a lead's activity into two lines → next-best-action → a WhatsApp
qualification agent.

⚠️ Every one of these must show its working. A score nobody can reconstruct gets
ignored the first time it disagrees with somebody's gut — the same reason the
workload page prints its formula.

---

## What this plan deliberately does not build

Named so the decision is visible rather than forgotten: Projects & Inventory
(unit-level stock), Sales Dispute, Accounts and commissions, Policies. They are in
the PropForce screenshot because it serves a property brokerage that holds
inventory. This division runs marketing for clients. **Revisit only if the owner
says otherwise.**
