# 📋 Task management, studied — 2026-09-22

> **Owner:** *"I want you to go and study how task management is working: how
> anyone creates their task, who can assign a task to a team … In task creation
> there is a very important category. During creation you can select whether this
> task is one-time, a daily task, or a weekly task. For that purpose there is a
> very big issue."*

This is what the system actually does, read from the code **and measured against
the live database on 2026-09-22**. Nothing here is inferred from a document.

---

## 1 · Creating a task

`components/task/task-dialog.tsx` → `createTaskAction` (`app/actions/tasks.ts`)
→ `createTask` (`lib/db/queries/tasks.ts`), with RLS underneath every write.

**Required:** a title, a **project** (BR-011 — every task belongs to one), a
priority, and an effort estimate (XS/S/M/L/XL, which sets effort points and
suggests a due date).

**Optional:** description, assignee, status, start and due date and time, a time
limit, a "content kind" (static post, reel, report, video edit, other…), and the
**repeat**.

**Who may create what**

| | Super Admin | Admin | Team Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Create for themselves | ✅ | ✅ | ✅ | ✅ |
| Create for somebody else | ✅ | ✅ | ✅ | ❌ |
| Assign / reassign | ✅ | ✅ | ✅ | ❌ |
| Create in a project | any | any | any | only projects they are already on |

This matches what the owner described. A Member who tries to assign to somebody
else is refused in words — *"Members can only raise tasks for themselves"* — and
the RLS policy refuses it again underneath.

**Work is assigned downward** (`canAssignTo`): a Coordinator may assign to
Members, never to an Admin; and one Member may not assign to another, because
their ranks are equal and rank alone would have allowed it.

**Two gates before an assignment is accepted**
1. **Rank** — "X is an Admin, so this task cannot be assigned to them."
2. **Capacity** (doc 06) — a soft threshold warns; the hard one blocks, and only
   an Admin may override it by typing a reason, which is logged (BR-003).

Measured: **1,174 live tasks** — 950 self-assigned, 94 delegated, **130
unassigned**. So the team overwhelmingly raises its own work.

---

## 2 · The statuses, and who may move them

The rules live in **one file**, `lib/domain/task-machine.ts`, as an allowlist —
anything not in the table is refused. The board, the detail panel and the bulk
bar all ask the same function, so a rule cannot hold in one place and not another.

```
backlog → todo → in_progress → in_review → done
            ↘ in_review ↗        ↘ revisions ↗
   any → blocked (reason) · any → cancelled (reason) · done → in_progress (Admin only)
```

**The part the owner asked about, and it is already what they described:**

| Move | Who | Note |
|---|---|---|
| `todo / in_progress → in_review` | the **assignee** (or a Coordinator) | "I want this looked at" |
| `todo / in_progress → done` | the **assignee** or the **creator** | "this needed no review" |
| `in_review → done` | the **creator**, or a Coordinator — **never the assignee** | whoever asked for the work signs it off |
| `in_review → revisions` | Coordinator, never the assignee, reason required | the reason is the brief |
| `done → in_progress` | **Admin only** | logged as a reopen; it moves an on-time figure already reported |

Two rules **no rank can override**:
- **BR-002** — you cannot approve work somebody else asked you to do. (It lifts
  only when you raised the task yourself, because then there are not two people
  to separate.)
- **The publish gate** — a static post or a reel cannot reach Done until a
  placement carries a live link, whoever is asking.

---

## 3 · The repeat — "one-time, daily, weekly"

**Where it is:** the Repeats control in the create/edit dialog — *Does not
repeat · Daily · Weekly · Monthly* (weekly can pick weekdays; the "every N"
interval was removed at the owner's request and is fixed at 1).

**How it runs:** not when the previous one is finished. A Vercel cron calls
`/api/schedule` at **19:00 UTC = 00:00 Karachi**; `runRepeatsFor(today)` reads
every live series and creates **that day's instance in Backlog**, assigned to the
same person. This replaced spawn-on-completion on 2026-09-03 at the owner's
instruction: *"whether the previous task is completed or not, if it said that
daily this task should generate then you have to generate daily."*

**It is working.** Measured: instances created every night at **19:03 UTC**,
**56 live series**, and this in the last week:

| Day | Generated | Created by hand | **Generated, then deleted** |
|---|--:|--:|--:|
| 21 Sep | 56 | 61 | **19** |
| 20 Sep | 56 | 12 | **23** |
| 19 Sep | 58 | 39 | **22** |
| 18 Sep | 55 | 90 | **22** |
| 17 Sep | 53 | 54 | **19** |

Series per person: Najamullah 18, Abdul Moiz 13, Rafay 10, Abdullah 9.

---

## 4 · ⚠️ The big issue: a repeat cannot be stopped

**About four in ten generated tasks are deleted the same day, and they come
back.** Three ways a person would naturally try to stop a repeat, and what each
actually does:

### (a) Setting the task to "Does not repeat" — does not work

`updateTask` clears `recurrence_rule` **on that one row** and leaves
`recurrence_series_id` in place. The nightly reader
(`lib/db/queries/repeats.ts`) selects the latest instance **that still has a
rule** — so it silently falls back to an older instance and carries on.

**Measured:** 13 of 58 series have had the repeat switched off on their newest
instance. Replaying the runner's own decision read-only for today, **10 of them
would be created again tonight**:

```
Ads Video Shooting · AI & Digital Division Reels Edit · BARYAL ENCLAVE and NEW
CITY VIDEO · CNI Ads and CEO Meeting BTS Reel · CNI Hiring Advertisement video ·
Created an intro/transaction-style video… · Edited AI & Digital Divisions ads
video · Edited Attari Group videos… · Edited Mam Mirha Video · making daily
report of all pages…
```

### (b) Deleting the task — does not work

Deletion is soft (`is_deleted`), and the "is there already one for today?" check
counts only rows that are **not** deleted. So the series keeps producing a new
one every night. That is exactly the 19–23 a day above.

### (c) Cancelling the task — does not work

The runner never looks at status. A cancelled instance stops nothing.

**The only thing that actually stops a series today** is clearing the rule on
*every* instance, or deleting every instance — neither of which anybody would
guess, and the second destroys the history.

---

## 5 · Four more things found while measuring

1. **A series inherits yesterday's edits.** The next instance is copied from the
   *latest instance*, not from a stored series definition — so renaming one day's
   task renames every future one. The live data shows it happening: a series
   called *"making daily report of all pages"* is now
   *"making daily report of all pages, Weekly report done"*. The same is true of
   the assignee, priority, effort and time limit.
2. **A repeat is invisible outside the edit dialog.** No badge on the card, the
   list, the board or the detail panel; no way to see the series, its history, or
   how many instances are open. A person cannot tell a generated task from one
   somebody raised for them.
3. **A repeat with no due date never generates, and never says so.** The rule is
   walked forward from the due date (or the start date); with neither, the runner
   skips it silently for ever. Nothing in the form requires a date when a repeat
   is chosen. (Today: 0 rows in this state — a trap, not yet an incident.)
4. **Generated tasks land in Backlog.** The owner said *"put in their backlog or
   in a to do"* and the choice was left open; Backlog is what was built. With 67
   live backlog instances, it may be worth revisiting — a person arriving in the
   morning has to move each one before they can start.

---

## 6 · What the fix looks like (for the owner to choose)

Written as options because §4 is one decision with several defensible answers.

**The essential fix — a repeat you can stop.**
- "Does not repeat" on any instance **ends the series**: clear the rule on every
  live instance of it (or stamp the series as ended), not just the row in front
  of you.
- Deleting or cancelling an instance asks a plain question when the task repeats:
  *"Just this one, or stop it repeating?"*
- The runner skips a series whose newest instance was cancelled or deleted for
  that day, so "I dealt with this" is respected.

**The visible-series fix.**
- A "Repeats daily" badge on the card, the row and the detail panel.
- One place — a "Repeating tasks" view — listing each series, its rule, whose it
  is, how many are open, and a **Stop** button.

**The series-definition fix (bigger).**
- Store the series once (title, assignee, project, effort, rule) instead of
  copying the last instance, so editing an instance does not rewrite the future.

My recommendation is to do the first two now — they are what the team is
fighting daily — and treat the third as the follow-up once the bleeding stops.

---

## 7 · How each fact above was measured

| Fact | How |
|---|---|
| Who may create / assign | `lib/domain/permissions.ts`, `canAssignTo`, and the refusals in `createTaskAction` |
| The status rules | `lib/domain/task-machine.ts` — the allowlist table |
| The nightly run | `vercel.json` (19:00 UTC), `app/api/schedule/route.ts`, `lib/schedule/repeats.ts` |
| Series, instances, deletions | Direct SQL against the live database, 2026-09-22 |
| "10 would be created again tonight" | `why-skipped.mjs` — the runner's own `decide()` replayed read-only, against `occursOn` and `parseRecurrence` imported from the repo |
