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
| **Current batch** | **Batch 3 — Forms** ([CHANGE-PLAN §3](CHANGE-PLAN.md)) |
| **Steps done in this batch** | none yet — batch just started |
| **⏭️ NEXT ACTION** | Step 3.1a — migration 020, adding `start_time` / `due_time` to `tasks` |
| **Working tree** | clean, pushed |
| **Blocked on** | nothing |

### What is complete overall

| | |
|---|---|
| BUILD-PLAN | ✅ all 8 steps |
| REDESIGN-PLAN | ✅ phases 1–8 · 🔴 phase 9 (the supplied task-board HTML) needs an owner decision |
| CHANGE-PLAN | ✅ Batch 1 (9 bugs) · ✅ Batch 2 (impact dialog, Cancel, Purge, avatars) · 🔶 **Batch 3 in progress** · ⬜ Batches 4–7 |
| Tests | 958 unit · 141 integration · 27/27 smoke |
| Migrations applied | through **019** |

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

---

## 3. 📌 HOW TO RESUME IF A SESSION DIES

1. Read §1 above — it names the exact next action.
2. Read the last few rows of §2 for what was just finished and how it was proved.
3. `git log --oneline -5` — every step is committed as it lands, so the tree and
   this file agree.
4. Continue from **⏭️ NEXT ACTION**. Do not restart the batch.
