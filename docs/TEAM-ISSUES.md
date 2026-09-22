# 🚨 TEAM ISSUES — the live triage board

> **Owner, 2026-09-22:** *"Right now my team and I are facing a lot of issues
> with the system so prioritize them also. Definitely they are working so I want
> to resolve them first. Then I will come back to this CRM again."*

**This is the active work.** The CRM is paused until the owner says otherwise
(`docs/crm/19-HANDOVER.md` §8). Anything reported here comes before new features.

---

## How this board works

### Intake — what a session writes down when something is reported

The owner usually describes a problem the way a person experiences it ("it is
slow", "it did not save", "the button does nothing"). Record it **in their
words**, then add what only a session can add: the page, the person, the time,
and what the system actually did.

```markdown
### T-00 · <what the person experienced, short>
| | |
|---|---|
| **Reported** | 2026-09-22, by <role: the owner / a salesperson / finance> |
| **In their words** | *"…"* |
| **Where** | /route · which panel or button |
| **Who it hits** | everyone · one role · one person |
| **How often** | every time · sometimes · once |
| **Priority** | P0 / P1 / P2 / P3 (see below) |
| **Status** | reported → reproduced → cause found → fixed → deployed → confirmed |

**Reproduced:** what was done, as whom, and what happened.
**Cause:** the real one, verified — not the first plausible one.
**Fix:** commit, migration, and what was measured afterwards.
```

### Priority

| | Means | Answer |
|---|---|---|
| **P0** | Somebody cannot work, or data is wrong, or a client could be messaged by mistake | Drop everything. Fix, deploy, tell the owner |
| **P1** | A daily job takes far longer than it should, or a feature is unusable in one role | Same session |
| **P2** | Annoying but there is a way round it | Batched into the next session |
| **P3** | Polish, wording, a nice-to-have | Backlog — only when the owner asks |

### Two rules that stop wasted work

1. ⚠️ **Reproduce before fixing.** A displayed error message is often not the real
   cause — this codebase has a written-down history of catch blocks naming a
   guessed cause. Sign in as the person who hit it (a salesperson, not an admin —
   an admin session cannot test access) and watch it happen.
2. ⚠️ **Fix the cause, then prove it with the thing that failed.** Not with a new
   test that passes; with the same click, the same file, the same person.

### Where to look first, by symptom

| Symptom | Look at |
|---|---|
| "It's slow" | Payload size and the router cache **first** — never assume the database or the region. `docs/20-UI-RESPONSIVENESS.md` §"Where the slowness actually is"; `node scripts/perf.mjs` |
| "It didn't save" | Was the write refused by RLS, a guard trigger, or a `GRANT`? "Permission denied" is a grant, not a policy. Reproduce the write as that person |
| "I can't see X" but a colleague can | Membership predicate, not a bug in the screen. Check as them; never from an admin session |
| "It logged me out" | Session rotation and the absolute expiry in `public.sessions` |
| "The client got a message they shouldn't have" | **P0.** `whatsapp_consent`, `app.crm_quiet_insert`, and the auto-send triggers. Stop the scheduler before investigating |
| "The number is wrong" | Karachi vs UTC — `current_date` is a different day for five hours every evening |
| Something looks broken only here | The dev server draws a fallback font when offline; check `document.fonts` before touching CSS |

---

## Open

> Full working of the task system, and how each fact below was measured:
> **`docs/TASK-MANAGEMENT-STUDY.md`**.
> Every flaw, its cause, its fix and the order: **`docs/TASKS-FIX-PLAN.md`**
> — waiting on the owner's go-ahead and their answers to its last three
> questions.

### T-05 · The task page is heavy, and a filter change is heavier — P0
| | |
|---|---|
| **Reported** | 2026-09-22, by the owner |
| **In their words** | *"that page is very heavy … taking a lot of time to render … I want this type of fast page with filter changing showing an instant change. Don't make people wait."* |
| **Where** | /tasks — both board and list |
| **Who it hits** | everyone; worst for admins and coordinators, who see every row |
| **Priority** | **P0** |
| **Status** | reproduced · cause found |

**Measured on production, in a real browser, as the owner:** `/tasks` ships
**458 KB** of HTML and is interactive after **5.5 s**; `?range=all` ships
**1.65 MB** and 9,345 DOM nodes. The server answers in **478 ms** — the database
is not the problem.

**Cause:** the page reads every task due on or before today **including closed
ones** — 1,141 rows, of which **957 are done or cancelled and 793 are hidden by
the browser before anybody sees them**. Nothing is paged or virtualised, and the
date filter is a full server round trip.

**Fix:** `TASKS-FIX-PLAN.md` §B. Bar to hold: under **150 KB**, interactive in
under **1.5 s**, every filter answering in its own frame.

---

### T-06 · No "what did I assign?" filter — P1
| | |
|---|---|
| **Reported** | 2026-09-22, by the owner |
| **In their words** | *"there is no option for me to see all the assigned tasks … All Assigned Tasks, Any Specific Assigned Task, or Self-Created Tasks."* |
| **Where** | /tasks toolbar |
| **Who it hits** | Super Admin, Admin, Team Coordinator |
| **Priority** | **P1** |
| **Status** | cause found |

The toolbar answers *who does it* (Assignee) but never *who asked for it*,
although every row already carries the person who raised it — so the filter can
be instant. Design in `TASKS-FIX-PLAN.md` §C.

---

### T-01 · A repeating task cannot be stopped
| | |
|---|---|
| **Reported** | 2026-09-22, by the owner |
| **In their words** | *"In task creation there is a very important category. During creation you can select whether this task is one-time, a daily task, or a weekly task. For that purpose there is a very big issue."* |
| **Where** | /tasks · the Repeats control in the create/edit dialog, and the nightly runner |
| **Who it hits** | everyone with a repeating task — 56 live series; Najamullah 18, Abdul Moiz 13, Rafay 10, Abdullah 9 |
| **How often** | every night |
| **Priority** | **P0** — the team is deleting 19–23 generated tasks a day and they come back |
| **Status** | reproduced · cause found |

**Reproduced (read-only, against live data):** replaying the runner's own
`decide()` for today shows **10 series whose newest instance has the repeat
switched off would be created again tonight**; the live table shows 19–23
generated instances deleted per day since 18 Sep.

**Cause — three separate holes, all in the same place:**
1. `updateTask` clears `recurrence_rule` on **one row** and leaves
   `recurrence_series_id`; `listRepeatingSeries` then falls back to the newest
   instance that *still* has a rule and carries on.
2. The "already generated for this day" check counts only rows that are **not
   deleted**, so deleting an instance does not register.
3. The runner never looks at status, so cancelling does not register either.

**Fix — shipped 2026-09-22 (migrations 250 and 251):** a repeating task is a row
of its own now (`public.task_series`) with a `stopped_at`, and the nightly runner
reads that instead of guessing from the last copy.

- **"Does not repeat" ends the whole series**, from any copy.
- **A day that was deleted or cancelled counts as generated** — it never comes
  back in the morning.
- **One open copy by default**: while yesterday's is still open, tonight makes
  none. Switchable per series for work that genuinely is a new job each day.
- **A Stop repeating button on the task itself**, with the offer to remove the
  copies nobody has started (never the ones anybody touched).
- **The backfill stopped 19 series immediately** — the 13 people had already
  switched off by hand, and 6 whose every copy had been deleted.

Measured after: tonight's run would create **19** copies instead of 55+, with 26
series held because a copy is still open. Proved end to end on the real screen:
raised a daily task, the panel said "Every day", pressed Stop, the confirmation
named it, the database recorded who stopped it, and the runner no longer sees it.

---

### T-07 · A leaked connection has blocked all policy DDL for ten hours — P1
| | |
|---|---|
| **Reported** | found 2026-09-22 while applying migration 250 |
| **Where** | the production database (Supabase) |
| **Priority** | **P1** — nothing is broken for the team, but no policy can be created and Storage cannot finish an index |
| **Status** | cause found · **needs the owner to act** |

One of our connections has been **idle inside a transaction since 03:11** and
`idle_in_transaction_session_timeout` is `0`, so nothing will ever clear it. It
holds the virtual transaction that Supabase Storage's `CREATE INDEX CONCURRENTLY`
has been waiting on since 05:27 — and while that build waits, **`CREATE POLICY`
and `DROP POLICY` block on `storage.objects` anywhere in the database.**

Migration 250 was written around it (its table has RLS on with no policies, and
authorisation lives in `SECURITY DEFINER` functions instead), so the fix shipped.
But the leak should still be cleared:

```sql
select pg_terminate_backend(<pid>);   -- the backend idle in transaction
```

I could not run it: terminating a backend on production is refused here, which is
right — it is the owner's call. Worth doing from the Supabase SQL editor, and
worth setting `idle_in_transaction_session_timeout` so a leak cannot last twelve
hours again.

---

### T-02 · A repeating series inherits yesterday's edits
| | |
|---|---|
| **Reported** | found while measuring T-01 |
| **Where** | the nightly runner |
| **Who it hits** | every repeating series |
| **Priority** | **P1** |
| **Status** | cause found |

The next instance was copied from the **latest instance**, not from a stored
definition, so renaming, reassigning or re-prioritising one day's task rewrote
every future one. Visible in the data: a series raised as *"making daily report
of all pages"* now generates as *"making daily report of all pages, Weekly report
done"*.

**Fixed 2026-09-22 (250, 251):** the runner reads the definition, and on the edit
form only the *repeat* reaches the series — the title, dates and estimate stay on
the copy in front of you.

---

### T-03 · A repeat is invisible outside the edit dialog
| | |
|---|---|
| **Reported** | found while measuring T-01 |
| **Where** | /tasks — card, list, board, detail |
| **Priority** | **P1** |
| **Status** | cause found |

Nothing shows that a task repeats, which series it belongs to, or how many are
open; a person cannot tell a generated task from one a colleague raised for them,
and there is no one place to manage the 56 live series.

---

### T-04 · A repeat with no due date never generates, and never says so
| | |
|---|---|
| **Reported** | found while measuring T-01 |
| **Priority** | **P2** — a trap, not yet an incident (0 rows today) |
| **Status** | cause found |

The rule is walked forward from the due date (or start date). With neither, the
runner skips the series silently, for ever. Nothing in the form requires a date
when a repeat is chosen.

---

## Closed

*(Fixed and confirmed items move here with their commit, so the same report is
never investigated twice.)*
