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
| **Current batch** | **Batch 3 — Forms: ✅ COMPLETE** ([CHANGE-PLAN §3](CHANGE-PLAN.md)) |
| **Steps done in this batch** | **3.1a** migration 020 · **3.1b** task times · **3.1c** project times · **3.2** form by type · **3.2a** server allow-list · **3.2b** dialog keyboard bug |
| **⏭️ NEXT ACTION** | **Batch 4 — people & access** — awaiting the owner's go-ahead. Covers: forced password reset with the sent → delivered → opened → completed status trail; Active / Inactive / Deactivated as switches on Team; pagination at 12 rows on tables and lists (not the board). |
| **Working tree** | clean, pushed |
| **Blocked on** | nothing |

### What is complete overall

| | |
|---|---|
| BUILD-PLAN | ✅ all 8 steps |
| REDESIGN-PLAN | ✅ phases 1–8 · 🔴 phase 9 (the supplied task-board HTML) needs an owner decision |
| CHANGE-PLAN | ✅ Batch 1 (9 bugs) · ✅ Batch 2 (impact dialog, Cancel, Purge, avatars) · ✅ **Batch 3 (forms)** · ⬜ Batches 4–7 |
| Tests | 958 unit · 141 integration · 27/27 smoke |
| Migrations applied | through **020** |

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
