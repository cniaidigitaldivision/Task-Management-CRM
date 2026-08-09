# 🔧 CHANGE PLAN — owner requests, Session 20

> Agreed with the owner on **2026-08-09**, after the eight build steps and the
> nine redesign phases. Twenty-six changes in one instruction, split here into
> seven batches.
>
> **Nothing in this document has been built.** It exists to be approved first —
> the owner's instruction was *"ask me questions… confirm to me every single
> thing… and after I have confirmed, document them, then implement them."*
>
> Sibling documents: [`REDESIGN-PLAN.md`](REDESIGN-PLAN.md) covers speed and
> appearance; [`BUILD-PLAN.md`](BUILD-PLAN.md) covers the original eight steps.
> This one covers **function**, which is why it is separate: the redesign plan
> had no section for behaviour, and that is part of why several of these were
> not picked up sooner.

---

## 📍 STATUS

| | |
|---|---|
| **Items** | 26 — **9 bugs**, 17 features |
| **Batches** | 7. One at a time: implement → verify → commit → **stop and ask** (rule R1) |
| **Progress** | ✅⬜⬜⬜⬜⬜⬜ **Batch 1 complete** — all nine bugs fixed and verified in Chrome |
| **Next** | Batch 2 — tasks and the board. **Awaiting the go-ahead.** |

---

## ✅ THE TWELVE DECISIONS THE OWNER TOOK

Recorded before anything else, because each one changes what gets built.

| # | Question | Decision |
|:--:|---|---|
| 1 | What does "delete a task" mean? | **Both.** Cancel for everyone (reversible, keeps history); a separate **Purge** for the Super Admin only, behind step-up |
| 2 | Sequencing | **Bugs first**, then features in themed batches |
| 3 | Pagination scope | **Tables and lists only.** The board keeps scrolling columns — paging a board breaks dragging between pages |
| 4 | Avatar storage | **A separate public bucket.** Faces are not task data, and signed URLs on every card would cost a round trip each |
| 5 | Report types | **All four** — Completion, Workload/capacity, Project status, Time & overrun |
| 6 | Excel and PDF | **Print stylesheet + real `.xlsx`.** Print covers printable *and* PDF via the browser. Excel gets one small library — the first new runtime dependency since Step 1 |
| 7 | Project form by type | **As specified** — see Batch 3 |
| 8 | Settings layout | **Tabs down the left** — Capacity · Timers · Security · Scoring |
| 9 | Sidebar | **Regroup only.** Projects gets its own heading; no new screens, no Clients page |
| 10 | Dashboard by role | **As specified** — see Batch 7 |
| 11 | Calendar | **Month + week views.** No drag-to-reschedule for now |
| 12 | Password reset | **Force + full status trail** — sent, delivered, opened, completed |

---

## 1️⃣ BATCH 1 — THE BUGS ✅ COMPLETE

Nine things that were visibly broken. All fixed, and **every one checked in a
real browser** rather than declared done because it compiled.

### What the fixes turned out to be

Three of the nine were not what they looked like from the outside.

**B2, the password reset that "went black and got stuck", was not the reset.**
Every database step succeeded when replayed — account state, session revocation,
activity log, audit log, all five. The fault was in `components/ui/dialog.tsx`,
the machinery **every dialog in the application shares**, and it was two separate
defects:

1. *A re-render silently closed the dialog.* The open/close effect was keyed on
   `[open]`, so it only ran when that prop changed. But `router.refresh()`
   re-renders the server tree, React reconciles, and the `<dialog>` DOM node can
   be recreated — **and a recreated node is not open**, because `showModal()`
   state lives on the element, not in React. Measured exactly that in Chrome:
   `open` was `true`, the panel's children were in the DOM, and `dialog.open`
   was `false`. The confirmation of what had just happened was rendered and
   invisible. That is precisely *"I don't see what happens."*
2. *The scroll lock was per-dialog, so two dialogs fought.* `PersonActions`
   closes its confirmation and opens its result dialog **in the same commit**.
   Each saved and restored `document.body.style.overflow` independently, so the
   restore order decided whether the page stayed locked. Intermittent — which is
   why it did not happen every time.

Plus two in the caller: `run()` had **no `try`/`catch`**, so a server action that
threw left `busy` true and the dialog open with a spinner forever, unrecoverable
without a reload — and that applied to *every* action on that menu, not just the
reset. And `router.refresh()` fired while the result was being shown, destroying
the outcome before it could be read.

The scroll lock is now **one reference-counted lock for the whole application**,
the open/close effect runs on every render, dialogs close themselves on unmount,
and the refresh waits until the result is dismissed.

**B3, the localhost activation link, was five copies of one line.** Every file
carried its own `process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4310'`.
Now one `lib/app-url.ts` that **derives the origin from the request**, so a link
is right on localhost, right over the LAN, right on a Vercel preview with a
generated hostname, and right in production, with nothing to keep in step.

⚠️ **The environment variable still wins when set, deliberately** — a fixed value
cannot be influenced by a request header, which matters because host-header
poisoning in a password-reset email is a real attack. And that is also the actual
cause of the report: **`.env.local` pins it to `http://localhost:4310`**, so
every link says localhost even when the page was opened over the LAN. See the
owner action at the foot of this file.

**B1, the dead Add-task button, was exactly as dead as it looked** — a `<button>`
with a class and no handler. It now opens the create form with that column's
status pre-selected, and with the assignee pre-selected when the page arrived
filtered to one person.

### The nine

| # | Owner's words | What was wrong | What was done |
|:--:|---|---|---|
| B1 | *"There is a button called active — when I click that it does not show the form"* | **No `onClick` at all** on the board column's Add task | Opens the create form, pre-set to that column's status (and only to a status a task may legally start in, doc 05 §2) |
| B2 | *"The page gets stuck, it's going black… I have to switch tabs"* | Four defects, two in the shared Dialog primitive — see above | Reference-counted scroll lock · effect runs every render · closes on unmount · `try`/`catch` · refresh deferred until the result is read |
| B3 | *"That activation link is still in localhost"* | Five copies of the same fallback; `.env.local` pins localhost | One `lib/app-url.ts`, origin derived from the request, **11 unit tests** |
| B4 | *"Calendar option is just unclickable"* | Literally `disabled: true` | Navigates to the calendar screen. Month + week view arrives in Batch 7 |
| B5 | *"The assignee should automatically be that member"* | Not carried through from Team | Filter and create-form default both pre-set to that person |
| B6 | *"It should remove the assignee variable from the URL"* | `?assignee=` survived every reload, invisibly | **Refresh** button clears it and re-fetches |
| B7 | *"Instead of 'someone' just put 'add member'"* | *"Add someone to the team"* | **Add member** |
| B8 | *"Instead of owner just put lead"* | Field labelled **Owner** | **Lead** (label only; the column stays `owner_id`) |
| B9 | *"Scale should become a dropdown"* | Free-text box placeholder'd `large` | **Small · Medium · Large** |

### Verified in Chrome, not just built

| | |
|---|---|
| B1 | Add task opens the form; To Do column pre-sets `todo`, Backlog pre-sets `backlog` |
| B2 | Result dialog now **opens and is readable**; locked while shown, unlocked after, refresh lands |
| B3 | 11 unit tests including the reported case — a LAN request produces a LAN link |
| B4 | Tab is live and lands on `/calendar` |
| B5 | Toolbar shows *Yusra Khan* instead of *Everyone*; form pre-fills *Yusra Khan — Ads Manager* |
| B6 | URL `?assignee=…` → cleared · filter → Everyone · 6 cards → 31 |
| B7 | Button *Add member*, dialog *Add a member*, no "someone" left anywhere |
| B8/B9 | *Lead* present, *Owner* gone; scale is a `SELECT` with Not set / Small / Medium / Large |

**958 unit tests** (11 new) · **133 integration** · **27/27 smoke**.

#### One thing worth remembering

`router.replace()` and `router.refresh()` must not both fire on the same click.
Together they left the URL untouched — measured: the filter reset while
`?assignee=…` stayed in the address bar, because `refresh()` re-fetches the
*current* route and raced the navigation. Navigating to a different query string
already re-fetches, so `replace` alone is both the clear and the refresh.

| # | Owner's words | What is actually wrong | Fix |
|:--:|---|---|---|
| B1 | *"There is a button called active — when I click that it does not show the form"* | The **Add task** button at the foot of every board column has **no handler at all**. Confirmed in `task-board.tsx`: a `<button>` with a class and no `onClick` | Open the task dialog with the column's status and the current filters pre-applied |
| B2 | *"The page gets stuck, it's going black… I have to switch tabs"* | Password reset freezes the page | Diagnose before promising a cause. Most likely a dialog that never closes and leaves `overflow: hidden` on the body, or an action that never resolves |
| B3 | *"That activation link is still in localhost"* | `appUrl()` is `process.env.NEXT_PUBLIC_APP_URL \|\| 'http://localhost:4310'` in four files. If the variable is unset the link is unusable | Derive the origin from the **request headers** so it is always correct, with the environment variable as an override. Removes a whole class of "works locally, wrong in production" |
| B4 | *"Calendar option is just unclickable"* | The Calendar tab in the Tasks workspace is literally `disabled: true` | Enable it — see Batch 7 for what it shows |
| B5 | *"The assignee should automatically be that member"* | Adding a task for someone from the Team screen lands on Tasks without pre-selecting them | Carry the member through and pre-select them in the dialog, still changeable |
| B6 | *"When I refresh, it should remove the assignee variable from the URL"* | The `?assignee=` filter survives a refresh, so the page silently stays filtered | Clear it once consumed, and add a visible refresh control |
| B7 | *"Instead of 'someone' just put 'add member'"* | `"Add someone to the team"` and `"Add someone"` | → **Add member** |
| B8 | *"Instead of owner just put lead"* | Project form field is labelled **Owner** | → **Lead**. Label only; the column stays `owner_id` |
| B9 | *"Scale should become a dropdown"* | `expected_scale` is a free-text box with the placeholder `large` | Dropdown: **Small · Medium · Large** |

**Note on B3:** whether `NEXT_PUBLIC_APP_URL` is set on Vercel is worth checking
either way, but the header-derived fix means the link is right even if it is not.

---

## 2️⃣ BATCH 2 — TASKS AND THE BOARD

### 2.1 Delete, with a confirmation that actually tells you something
> *"It should tell me that these things will be affected by this deletion and
> what the dependencies will be and how I would have to rearrange them."*

**Decision 1: two different actions, not one.**

- **Cancel** — available to whoever may already cancel a task (doc 03). Moves it
  to `cancelled`. Reversible, keeps every comment, attachment and time record.
- **Purge** — **Super Admin only, behind step-up.** `task.purge` already exists
  in the permission matrix and has never had a screen. Irreversible.

The dialog names the real consequences before either:

```
Cancel 3 tasks?

  CLI-115  Packaging mockups — round 2
    ⚠ 2 tasks depend on this one
        EVT-108  Edit the exhibition showreel   → will be unblocked early
        BIZ-111  Draft the flagship case studies → will be unblocked early
    ⚠ Has 3 subtasks — they are cancelled with it
    · 4 comments and 1 attachment are kept

  EVT-110  Export deliverables in three ratios
    · Nothing depends on it

  Blocked-by links pointing AT these tasks are removed, so the
  work they were holding up becomes startable.
```

The dependency walk reuses the graph logic built in Step 6 — the same code that
already refuses to create a cycle.

### 2.2 A delete action on the bulk bar
> *"The clear does not — it just deselects. Make the clear button's functionality
> deleting the selected tasks."*

**Clear stays as Clear** — deselecting is a legitimate thing to want, and a
button that silently changed from "deselect" to "destroy" is the worst possible
outcome of this request. Instead the bar gains **Cancel selected**, and for the
Super Admin a separate, clearly-marked **Purge**. Both go through 2.1's dialog.

### 2.3 Real avatars on every task
> *"Avatars should be on every task the member, coordinator, admin is assigned
> to… not the icons which you have right now."*

- Profile → upload a picture. Stored in a **new public bucket** (decision 4).
- Shown on the task card, the list view, the board, Team, Workload and the rail.
- Initials remain the fallback for anyone who has not uploaded one.
- Validated on the server: image types only, size-capped, and **re-encoded** —
  an uploaded file is never trusted or served back as-is.

⚠️ **This needs a new Supabase bucket.** It is separate from `attachments`, which
stays private — that was a deliberate security fix in Step 7 and is not being
weakened.

---

## 3️⃣ BATCH 3 — FORMS

### 3.1 Dates and times everywhere
> *"Start date should auto-fill with the current time and date, and the due
> should be left empty. Both should have a time as well, AM or PM."*

- **Start** pre-filled with now. **Due** left empty deliberately — a guessed
  deadline that nobody chose is worse than no deadline.
- Both gain a time, **12-hour with AM/PM**, in 15-minute steps.
- Everything is stored UTC and shown in the viewer's timezone. The recurrence
  work in Step 6 was bitten by exactly this: `new Date('2026-03-29').getDay()`
  answers *locally*, so "every Monday" silently became every Sunday west of
  Greenwich.

### 3.2 The project form changes by type
> *"If it's an event it should show the event length; if it's a business, what
> type of business."*

Confirmed field set:

| | Fields |
|---|---|
| **All types** | Name · Type · **Lead** · Scale `Small/Medium/Large` · Start (date + time, pre-filled) · Due (date + time) · Description |
| **Event** | Duration `single day / multiple days` · Venue · Expected attendance |
| **Client** | Client name · Retainer or one-off · Contract end |
| **Business** | Business area · Internal sponsor |
| **Self-promotion** | Channel · Campaign goal |
| **Other** | Mandatory written description — already required by ADR-006 |

**Event length drives the date fields**, as asked:
- *Single day* → one date, with a start time and an end time
- *Multiple days* → start date + time through to due date + time

⚠️ **The per-type fields need somewhere to live.** Options at build time: a
`details jsonb` column on `projects` (one migration, flexible, no new table per
type) or typed columns. I will recommend `jsonb` and confirm before writing it —
**this is the one part of this batch that needs a migration** and therefore the
owner's go-ahead under rule R1.

---

## 4️⃣ BATCH 4 — PEOPLE AND ACCESS

### 4.1 Forced password reset, with a status trail
> *"The page gets stuck… make it proper functioning… give me the status for the
> Super Admin."*

Two separate things, and B2 (the freeze) is fixed first regardless.

- An Admin forces a reset; the person must set a new password before doing
  anything else, and their other sessions are signed out (FR-155c already does
  this on a password change).
- The Super Admin sees where it got to: **sent → delivered → opened → completed**,
  with the expiry, plus **Resend** and **Revoke link**.

⚠️ **"Delivered" and "opened" are honest only as far as the mail provider is.**
With no verified sending domain, mail to anyone but the account owner is accepted
and silently dropped — so this screen will say **"not sent — no mail domain"**
rather than pretend. Open-tracking needs a tracking pixel and many clients block
it; it will be shown as *"opened (if their mail client loads images)"* rather
than stated as fact.

### 4.2 Active / Inactive / Deactivated as switches
> *"I can switch from active members, inactive members, deactivated members —
> put those options in switches."*

A segmented control on Team, replacing the current filter. Counts on each.

### 4.3 Pagination
> *"After every 12 or 13 rows it should add another page."*

**12 rows**, on tables and lists only (decision 3): Team, Reports, Projects list,
Tasks list view, Audit log, Security events, Sessions. **Not the board** —
dragging a card to a task on another page is impossible, so paging a board would
break the thing we just spent two sessions making work.

---

## 5️⃣ BATCH 5 — REPORTING AND EXPORT

### 5.1 Report types
> *"Reports should have types — I can select which kind of report I want."*

All four, each for **one person or everybody**, over a chosen period:

| Report | Answers |
|---|---|
| **Completion** | Done vs missed per person, on-time rate, average days late |
| **Workload / capacity** | Points used vs capacity per week, who is over, who has headroom |
| **Project status** | Per project: tasks by status, effort spent, overdue, who is on it |
| **Time & overrun** | Time spent vs limit per task and person, and every extension granted |

Each is **scoped by the reader's role** — a Coordinator's report covers their
people, and a Member can only ever report on themselves (ADR-003).

### 5.2 Export formats
> *"I want also a printable export option and Excel option and then also PDF."*

| Format | How |
|---|---|
| **CSV** | Exists. Keeps its formula-injection guard — a title starting `=` executes on open in Excel |
| **Printable / PDF** | A real print stylesheet. Covers both: the browser's own *Save as PDF* produces the PDF, so there is no server-side PDF engine to slow the route or maintain |
| **Excel `.xlsx`** | A genuine spreadsheet with typed columns and widths |

⚠️ **`.xlsx` needs a library — the first new runtime dependency since Step 1.**
I will name the exact package and its size for approval before installing it.
Every export stays audited: once a file is in Downloads no access control applies
to it, which is why that rule exists.

---

## 6️⃣ BATCH 6 — LAYOUT AND NAVIGATION

### 6.1 The primary button follows the page
> *"When I'm in projects it should say New Project, not New Task."*

| Page | Button |
|---|---|
| Tasks · My Work · Dashboard · Calendar | New task |
| Projects | New project |
| Team | Add member |
| Reports · Workload | *(no create action — hidden, not a dead button)* |
| Settings · Security | *(hidden)* |

### 6.2 Sidebar hierarchy
> *"Remove the projects from the Work thing… it should be another subheading."*

Regroup only — no new screens (decision 9):

```
        Dashboard
        My Work

WORK    Tasks
        Calendar
        Workload

PROJECTS
        Projects

TEAM    Team
        Reports

SYSTEM  Settings
        Security
```

### 6.3 Projects as list and grid
> *"It should be the current projects in lists and grids."*

A view toggle on Projects, and the same component reused on the Team screen.

### 6.4 Settings, rebuilt
> *"It is totally dismantled. I want it more presentable, professional, sleek."*

Tabs down the left — **Capacity · Timers · Security · Scoring** — with each
section short enough to read without scrolling. Every setting keeps its
four validation gates (role → step-up → the field's own bounds → **the
combination**), which is the part that actually matters and is not changing.

---

## 7️⃣ BATCH 7 — ROLE-SCOPED VIEWS

### 7.1 The Dashboard
> *"The dashboard should be narrower or broader according to the role level."*

| Role | Sees |
|---|---|
| **Super Admin · Admin** | Everything — division KPIs, every person's workload, all overdue work, security alerts |
| **Team Coordinator** | Their projects and the people on them: team workload, project status, approvals waiting on them |
| **Team Member** | Themselves only: open tasks, capacity this week, what is due, what they are blocked on. **No other person's data at all** |

This is ADR-003 applied to the dashboard. Row-level security already stops a
Member reading anyone else's row — so today they see a dashboard built to answer
a question they cannot ask, with one row in it. This makes the *shape* right, not
just the data.

### 7.2 The Calendar
> *"Super Admin should see each and every task on each date… team members should
> see their tasks only."*

- **Month and week views** (decision 11). Week lays times across the working day,
  Mon–Sat 09:00–17:00 (ADR-004).
- Same role scoping as the dashboard — and again, enforced by RLS rather than by
  filtering in the page.
- Click a task to open its detail drawer.
- **No drag-to-reschedule** for now, by decision.

---

## 🚫 NOT IN THIS PLAN

- Sales management and workflow automation — standing rule **R4**
- A Clients screen — decision 9 was regroup only
- Drag-to-reschedule on the calendar — decision 11
- **REDESIGN-PLAN §9**, the supplied `CNI-AI-Digital-Task-Board.html`, still
  awaiting a decision and still blocking any "sleekness pass" that touches the
  palette or typefaces
- **Persisting board order** — still needs a migration and still unasked-for

---

## ⚠️ THE FOUR THINGS THAT NEED THE OWNER BEFORE THEY CAN BE BUILT

Everything else can proceed on the decisions already taken.

| | What | Why it needs you |
|:--:|---|---|
| 1 | **A public Supabase bucket for avatars** | New bucket. `attachments` stays private — that was a deliberate Step 7 fix and is not being weakened |
| 2 | **A migration for per-type project fields** | Rule R1: migrations do not start without a go-ahead. I will recommend a `details jsonb` column |
| 3 | **One new dependency for `.xlsx`** | The first new runtime package since Step 1. I will name it and its size first |
| 4 | **The Resend sending domain** | Still deferred. Until it exists, the reset status trail will honestly say *"not sent — no mail domain"* rather than imply an email arrived |
| 5 | **Remove `NEXT_PUBLIC_APP_URL` from your `.env.local`** | It is pinned to `http://localhost:4310`, which is the actual reason links said localhost. Delete the line (or blank it) and the origin is derived from whatever host you opened — localhost, the LAN IP, or production. `.env.example` now explains this. **Check the Vercel project too:** if it is set there, make sure it is the real URL; if it is unset, links are now derived correctly rather than defaulting to localhost |
