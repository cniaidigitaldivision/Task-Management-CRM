# 📋 WORK LOG — step by step, not batch by batch

> **Why this file exists.** Owner instruction, 2026-08-09: *"record each and
> every step and every work as well, so it doesn't pick up from the phase start
> — rather it starts from where that phase had been completed till… so if I have
> to switch to a new session it picks up exactly from where this chat went dead."*
>
> [`SESSION-STATE.md`](SESSION-STATE.md) records **where we are between batches**.
> That is too coarse to resume from if a session dies halfway through one. This
> file records **every step inside a batch**, written as the step finishes, not
> at the end.
>
> **The rule: update §1 and append to §2 after every step, before moving on.**
> A step is not finished until it is written down here.

---

## 1. ▶️ RESUME POINT — read this first

| | |
|---|---|
| **Updated** | 2026-08-09 · Session 23 |
| **Current batch** | **Batch 4 — People & access** ([CHANGE-PLAN §4](CHANGE-PLAN.md)) |
| **Steps done in this batch** | **4.3a** pagination primitive · **4.2** Team switches · **4.3b** Team paginated · **4.z** migration 021 fixture purge |
| **⏭️ NEXT ACTION** | Step 4.3c — apply `usePagination` to the remaining lists: **Projects** list view · **Tasks** list view · **Audit log** · **Security events** · **Sessions** · **Reports** tables. Then 4.1, the forced-reset status trail. |
| **Working tree** | clean, pushed |
| **Blocked on** | nothing |

### What is complete overall

| | |
|---|---|
| BUILD-PLAN | ✅ all 8 steps |
| REDESIGN-PLAN | ✅ phases 1–8 · 🔴 phase 9 (the supplied task-board HTML) needs an owner decision |
| CHANGE-PLAN | ✅ Batch 1 (9 bugs) · ✅ Batch 2 (impact dialog, Cancel, Purge, avatars) · ✅ **Batch 3 (forms)** · ⬜ Batches 4–7 |
| Tests | 958 unit · 141 integration · 27/27 smoke |
| Migrations applied | through **021** |

### Still needing the owner, whenever we reach them

| | |
|---|---|
| REDESIGN-PLAN §9 | What the supplied `CNI-AI-Digital-Task-Board.html` should become |
| Batch 5 | One new dependency for real `.xlsx` export — package and size to be named first |
| Anytime | The Resend sending domain. Until it exists, mail reaches only the Resend account owner |
| Board order | Persisting a card's position in a column needs a migration; never asked for |

---

## 2. 🗂️ THE STEPS

Newest last. Each entry is written when the step is **finished and verified**,
so anything not listed here has not been done.

### Batch 4 — People & access

| # | Step | State | What changed | Proof |
|:--:|---|:--:|---|---|
| — | *batch started* | — | Order within the batch: **4.3** pagination, **4.2** the Active/Inactive/Deactivated switches, then **4.1** the reset status trail. 4.1 last because it changes what forcing a reset does — today `forceResetAction` sets `account_state` and revokes sessions but **sends nothing**, so a status trail needs the email and the token to exist first. | — |
| 4.3a | **Pagination primitive** — `components/ui/pagination.tsx` | ✅ | `usePagination` + `Pagination`, **12 rows** (owner said "12 or 13"; 12 divides evenly). Pages **in the browser, not in SQL**: every screen already holds its full list, the queries are bounded by RLS, and each of those screens also filters and sorts client-side — so server paging would add a round trip per page turn AND make the page counts disagree with the filters. Page resets when the list shrinks under it, done as a render-time state adjustment rather than an effect (an effect paints the empty page once before fixing itself). Footer renders nothing at one page — "Page 1 of 1" is furniture. | `tsc`, lint, 958 tests, build clean |
| 4.2 | **Active / Inactive / Deactivated switches on Team** | ✅ | Three states because the schema holds **two independent facts**: `is_active = false` means the account was turned off (BR-007, never deleted), while `account_state <> 'active'` means it is on but unusable — awaiting activation, forced reset, MFA not set up, locked, suspended. Collapsing them would hide the difference between "gone" and "stuck", which an Admin acts on differently: one gets restored, the other unblocked. Counts on each switch; empty states name what is absent. | Browser: `Active · 8 · Inactive · 1 · Deactivated · 115`; switching filters the list and the pager follows |
| 4.3b | Pagination applied to **Team** | ✅ | Pages the FILTERED list, so the footer count and the switch count always agree. | Browser: page 1 `1–12 of 115` with 12 rows, page 2 `13–24 of 115` with 12 rows, and the rows genuinely differ. |
| ⚠️ | **Found: 115 deactivated accounts in the live database** | 🔴 noted | They are integration-test fixtures. `test/integration/provisioning.test.ts` cannot delete a user (BR-007 forbids it and a trigger enforces it), so it deactivates and renames them `retired-<uuid>@prov-test.invalid`. Correct behaviour for the test, but every run adds more, and they now outnumber real accounts 13:1 on the Team screen. **Owner decision needed** — see the report. Not touched. | Counted on the Team screen |
| 4.z | **Migration 021 — purged the 115 fixture accounts** (owner chose option 1) | ✅ | A **deliberate, documented BR-007 exception.** BR-007 exists so removing somebody preserves their tasks, comments and time logs — reasoning that does not apply to a row that never had any. Verified across all 115 before writing it: **0** comments, **0** tasks, **0** projects, **0** time entries, **0** attachments, **0** extensions, so every one of the eight `RESTRICT` foreign keys into `users` was unreferenced. Predicate is five conditions wide, including `.invalid` (RFC 2606 reserved — it can never be a real address). Uses the **documented break-glass path**, not a disabled trigger: `alter table … disable trigger` would have worked and left no trace, whereas break-glass makes each deleted row write its own `break_glass_used` CRITICAL event first. | 115 purged, then 5 more on a re-run. `users` 124 → 9. **116 critical security events** written (115 per-row + 1 `permanent_purge` summary). 958 unit · 141 integration · 27/27 smoke all green afterwards. |
| ⚠️ | **The purge is a cleanup, NOT a fix — it came back within minutes** | 🔴 owner decision | The integration run used to VERIFY the purge immediately created **5 more**, all stamped 09:44. So it is ~5 per `npm run test:auth`, and 115 was roughly 23 runs. Migration 021 is idempotent and was re-run to clear them (0 again). Options for stopping it: **(a)** point the integration suite at a separate Supabase project — clean, biggest setup; **(b)** have the suite break-glass-delete its own fixtures in `afterAll` — cheap and permanent, but writes 5 CRITICAL security events per run into the Super Admin's alert feed, whose entire value is being signal; **(c)** leave it and re-run 021 occasionally. Not chosen. | 5 fixtures created at 09:44 by one test run |

### Batch 3 — Forms

| # | Step | State | What changed | Proof |
|:--:|---|:--:|---|---|
| — | *batch started* | — | Found: `projects.type_fields` is **already `jsonb`**, so the migration predicted for per-type fields is **not needed**. But `tasks.start_date` / `due_date` are **`date`** columns, so adding a time **does** need one. | schema read |
| 3.1a | **Migration 020** — `start_time` / `due_time` on `tasks`, `start_time` / `target_end_time` on `projects` | ✅ | Times are **additive `time` columns**, not a `date` → `timestamptz` change. Changing the type would have re-interpreted the partial index on `due_date`, both `dates_ordered` constraints, the whole UTC-calendar recurrence engine (already bitten once in Step 6), the calendar's day grouping and ADR-004's Mon–Sat workload window. `time` not `timetz`: one division, one timezone, so a wall-clock time is what is meant. New `tasks_times_ordered` / `projects_times_ordered` constraints cover the case dates cannot — same day, 17:00 → 09:00. | Applied. Probed in rolled-back transactions: same-day 09:00→17:00 **accepted**, same-day 17:00→09:00 **refused by `tasks_times_ordered`**, across-days 17:00→09:00 **accepted**, no times **accepted** |
| 3.1b | Times read and written end to end for **tasks** | ✅ | `TASK_SELECT` reads `start_time` / `due_time`; `toTask` maps them via a new `timeOnly()` (Postgres `time` arrives as `HH:MM:SS`, forms want `HH:MM`); `TaskRow` **requires** both, so `tsc` enforces the mapping; create and update persist them. Form gained **Start time** / **Due time** as `type="time"` — the browser's own picker, so AM/PM appears for a 12-hour locale without hard-coding either, while always posting 24-hour `HH:MM`. **Start pre-filled with now, due left empty**: a guessed deadline nobody chose looks like a commitment and drives the overdue count. Built from LOCAL date parts, not `toISOString()`, which returns UTC and hands back tomorrow east of Greenwich late in the evening. | Browser: create form pre-filled `2026-08-09` / `20:01`, due empty. Saved start 09:15 / due 17:30 → database held `09:15:00` / `17:30:00`. ⚠️ **Read-back into the EDIT form was not confirmed by eye** — the automation could not hold the nested dialog open. Covered by the SELECT, the required `TaskRow` fields and `tsc`, not by sight. Test task removed. |
| 3.1c | Same date+time treatment on the **project** form | ✅ | `ProjectRow` gained `startTime` / `targetEndTime`; `CreateProjectInput` and `UpdateProjectInput` carry them; insert and update persist them; the action reads both from the form. Form gained **Start time** and **Target end time**, start pre-filled with now and end left empty, matching the task form exactly. ⚠️ Caught while editing: the insert's column list had gained two columns while the VALUES list had not — Postgres would have rejected it at runtime, and `tsc` cannot see inside a tagged template. Fixed before it ran. | `tsc`, `eslint`, 958 unit tests and `next build` all clean. Not yet exercised in the browser — that happens with 3.2, which rebuilds the same form. |
| 3.2 | **The project form changes by type** | ✅ | **Scale moved to every type** (`SHARED_TYPE_FIELDS`) — it was event-only, so a client retainer had no size recorded and nothing could compare them. Event gained a **duration toggle**: *One day* shows **Date / Starts at / Ends at** and submits the end date as the start date (one possible answer is not a question), *Several days* shows all four. `event_date` removed — it duplicated the real `start_date` column that the calendar and every report already read. Added: expected attendance · contract end · engagement as a **Retainer/One-off dropdown** (was free text placeholder'd "retainer or project") · internal sponsor. Existing client contact fields **kept** — the confirmed spec was a list to add, not a list to reduce to, and dropping `contact_email` would have been a regression nobody asked for. | Browser: Client shows 18 fields, Event 12, **Scale on both**. Toggle flips *Date/Starts at/Ends at* ↔ *Start date/Start time/Target end date/Target end time*. Saved a one-day event → `start 2026-09-12 09:00`, `end 2026-09-12 17:00`, `type_fields` held venue, duration, scale **and attendance**. Test project removed. |
| 3.2a | 🐛 **The server allow-list silently dropped the new fields** | ✅ | `TYPE_FIELDS` in `app/actions/projects.ts` is a deliberate allow-list so a crafted POST cannot stuff the `type_fields` jsonb. New form fields not added to it **render, accept input and vanish on save**. Caught by checking the saved row rather than trusting the form closing: `expected_attendance` and `duration` were missing. Both lists now carry a warning that they must change together. | First save came back without `expected_attendance`; after the fix, present. |
| 3.2b | 🐛 **Every dialog closed when a button was activated by keyboard** | ✅ | Found while testing the duration toggle: a programmatic `.click()` closed the whole form. The backdrop test hit-tested `clientX/clientY` against the panel — and a button activated with **Space or Enter fires a click at (0, 0)**, which is outside every panel. So **every keyboard user closed any dialog the moment they used any control inside it.** `event.target === dialog` alone would have fixed that and reintroduced the bug the original author had already hit (a native `<select>` option list reports the dialog as its target). Now requires **both halves of the gesture** — pointerdown *and* click on the dialog itself — which no keyboard activation and no select popup can satisfy. Dead `panelRef` removed. | Browser: the toggle click that previously closed the form now leaves it open, and a `<select>` type change does not close it either. |
| 3.z | ⚠️ **Operational lesson: never run `test:auth` twice at once** | ✅ | A run reported **10 failed / 131 passed** and took over 600s instead of ~240s. Not a regression: a second suite was started while the first was still settling, and they share one database. `vitest.integration.mts` says exactly this — *"these share one database, and two suites creating fixtures concurrently would interfere"* — and `fileParallelism: false` only guards within a single process, not against two. A clean single run: **141 passed**. Nearly closed the batch on the bad number; always read the count, never the duration line. | 141/141 on a clean run |

---

## 3. 📌 HOW TO RESUME IF A SESSION DIES

1. Read §1 above — it names the exact next action.
2. Read the last few rows of §2 for what was just finished and how it was proved.
3. `git log --oneline -5` — every step is committed as it lands, so the tree and
   this file agree.
4. Continue from **⏭️ NEXT ACTION**. Do not restart the batch.
