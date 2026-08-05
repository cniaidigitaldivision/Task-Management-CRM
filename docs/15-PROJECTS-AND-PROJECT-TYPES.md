# 15 — Projects, Project Types & the "Other" Category

**Added:** 2026-08-06 (Session 02)
**Status:** Planned, not built
**Supersedes:** E-001 in [`12-ENHANCEMENT-BACKLOG.md`](12-ENHANCEMENT-BACKLOG.md) — this is now a confirmed v1 requirement, not an idea.

---

## 1. What you asked for

> *"Our CRM should also have a project created through which the admin or super admin can create projects. Those projects can have the options of creating a particular type of project — an event type, a client's perspective type, a business type, a self-promotion type, an extra type. Below these project types the task should be assigned to this relevant event or relevant project… the task description should also tell which event or which project he's currently working on and the details of that project as well."*

And separately:

> *"When an admin or super admin is observing the tasks of members, it should show the preview of the task it is doing. The preview should contain a section which is 'Other'. The task from the projects which was written extra… should be labeled under the 'Other' one. The 'Other' option should show or describe what the task is being upheld."*

Both are specified below.

---

## 2. The structure

```
PROJECT  (created by Admin / Super Admin only)
   │  has a TYPE  ─────────────────────────────────────────┐
   │                                                        │
   ├── 🎪 Event            e.g. "Expo Karachi — Oct 2026"  │
   ├── 🤝 Client           e.g. "ABC Traders — Retainer"   │
   ├── 🏢 Business         e.g. "Q4 Internal Rebrand"      │
   ├── 📣 Self-Promotion   e.g. "CNI YouTube Channel"      │
   └── 📦 Other            e.g. "Misc / Ad-hoc work"       │
   │                                                        │
   └──▶ TASKS  ────────────────────────────────────────────┘
            every task belongs to exactly one project
            and carries that project's context with it
```

**The rule:** every task belongs to **exactly one project**. There is no such thing as an orphan task. If a piece of work doesn't fit any real project, it goes into an **Other** project — and *Other requires a written explanation of what the work actually is*. That's the whole point of the Other category: it makes ad-hoc work visible instead of invisible.

---

## 3. The five project types

Each type is not just a label — it carries **different fields**, because an event and a client retainer are genuinely different things. This is the "better engineering" you asked about: a type that changes the shape of the form is useful; a type that's only a coloured chip is decoration.

### 🎪 Event
Work anchored to a date that cannot move.

| Field | Notes |
|---|---|
| Event name | |
| **Event date** | The immovable anchor |
| Venue / location | |
| Deliverables-due offset | e.g. "all assets due 3 days before event date" → auto-sets task deadlines |
| Client (optional) | An event can also belong to a client |
| Expected attendance / scale | |

**Special behaviour:** because the event date is fixed, the system treats it as a **hard deadline** and works backwards. Any task in an Event project that would finish after the deliverables-due date raises an alert automatically — not just when someone notices.

### 🤝 Client
Paid work for an external party. This is the CRM dimension.

| Field | Notes |
|---|---|
| Client name | |
| Contact person + email/phone | |
| Engagement type | One-off project · Monthly retainer · Ongoing |
| **Retainer hours/month** | If applicable — enables "have we used up their hours?" |
| Contract start / end | |
| Billable | Yes / No |
| Priority tier | Key account · Standard · Trial |

**Special behaviour:** the system tracks **capacity consumed per client**. At the end of the month you can see that ABC Traders bought 20 hours and consumed 34. That is a real business insight that no amount of task-listing gives you.

### 🏢 Business
Internal company work. Not for a client, not for promotion — running the business.

| Field | Notes |
|---|---|
| Objective | What this is meant to achieve |
| Area | Operations · Finance · HR · Systems · Strategy |
| Target completion | |

### 📣 Self-Promotion
Marketing your own company. Distinguished from Business because it competes directly with client work for the same creative people — and it's the first thing to slip.

| Field | Notes |
|---|---|
| Channel | YouTube · Instagram · TikTok · LinkedIn · Website · Multiple |
| Campaign goal | Reach · Leads · Brand · Recruitment |
| Target publish date | |

**Special behaviour:** the dashboard reports **what percentage of team capacity went to self-promotion**. Most agencies discover this number is near zero and that's exactly why their own channels are dead. Making it visible is the fix.

### 📦 Other
Everything that doesn't fit — ad-hoc requests, favours, experiments, admin overhead, "can you just quickly…".

| Field | Notes |
|---|---|
| **`other_description` — MANDATORY** | Free text. "What is this work?" The task cannot be saved without it. |
| Requested by | Who asked for this |
| Reason it isn't a real project | Optional but prompted |

**Special behaviour — this is the important one:**
- Every task under Other **must** carry a written description of what it is.
- Other work is surfaced separately in every admin view (see §6).
- If Other exceeds a threshold of team capacity (default **15%**), the dashboard flags it: *"23% of your team's time this month is uncategorised. That's 3 days of work nobody can account for."*
- Any Other task can be **promoted** into a real project in one click, at which point it stops being invisible.

> **Why this matters:** in every small team, the work that quietly eats the week is the work nobody wrote down. The Other category is a trap designed to catch it.

---

## 4. Project lifecycle

| Status | Meaning |
|---|---|
| **Planning** | Created, tasks being defined, not yet active |
| **Active** | Work in progress |
| **On Hold** | Paused — waiting on client, budget, or a decision. Reason required. |
| **Completed** | All tasks done, signed off |
| **Archived** | Closed and out of the way. Read-only, still searchable. |
| **Cancelled** | Dropped. Reason required. |

**Rules:**
- Only Admin and Super Admin create, edit, or delete projects. (FR-101)
- A Team Coordinator can view all projects and assign tasks within them, but cannot create or edit the project itself.
- A project cannot be marked *Completed* while it has open tasks — the system lists them and asks what to do with each.
- Archiving a project archives its tasks; both remain in reports and search.

---

## 5. Task ↔ Project linkage

### Every task carries its project's context

You asked that a member working across two different things always knows which is which. So the project context travels with the task everywhere it appears:

**On a task card (list, board, My Work):**
```
┌──────────────────────────────────────────────┐
│ 🎪 Expo Karachi — Oct 2026        ← type + project
│ CNI-142  Edit exhibition showreel            │
│ 🎬 Kashif · M · High · due Thu               │
│ ⏰ Event date: 12 Oct (37 days)   ← type-specific context
└──────────────────────────────────────────────┘
```

**On the task detail page — a full project context card:**
```
┌─ PROJECT CONTEXT ────────────────────────────────────┐
│ 🎪  EVENT                                            │
│ Expo Karachi — October 2026                          │
│ ────────────────────────────────────────────────────│
│ Event date      12 Oct 2026  (37 days away)          │
│ Venue           Expo Centre, Hall 3                  │
│ Deliverables    due 9 Oct — 3 days before event      │
│ Client          ABC Traders (key account)            │
│ Project status  🟢 Active                            │
│ Progress        8 of 14 tasks done (57%)             │
│ Team on this    Kashif, Yusra, Member C              │
│                                     [ Open project ] │
└──────────────────────────────────────────────────────┘
```

A member never has to ask "wait, which event is this for?" — it's on the screen they're already looking at.

### Task reference numbers carry the type
Instead of a flat `CNI-142`, references encode the project type, so a reference is self-describing in conversation:

| Type | Prefix | Example |
|---|---|---|
| Event | `EVT` | `EVT-142` |
| Client | `CLI` | `CLI-088` |
| Business | `BIZ` | `BIZ-031` |
| Self-Promotion | `PRM` | `PRM-017` |
| Other | `OTH` | `OTH-205` |

Saying *"OTH-205 is blocking me"* immediately tells everyone this is uncategorised work. **Q-026** asks whether you want this or plain sequential numbering.

---

## 6. The Member Activity Preview (Admin / Super Admin)

> *"When an admin or super admin is observing the tasks of members, it should show the preview of the task it is doing."*

Clicking any member — from the Team page, the Workload view, or the Dashboard — opens this panel. It answers *"what is this person actually working on right now?"* in one screen, **grouped by project type**, with **Other** given its own prominent section.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🎬 KASHIF AHMED — Video Editor & Team Coordinator              [ × ]    │
│  Load 34 / 36 pts  ·  94% 🟠 Near limit  ·  7 open tasks                 │
├──────────────────────────────────────────────────────────────────────────┤
│  ▶ WORKING ON RIGHT NOW                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 🎪 EVT-142  Edit exhibition showreel                               │  │
│  │    Project: Expo Karachi — Oct 2026 · Event date 12 Oct (37d)      │  │
│  │    In Progress since Tue 11:20 · 4 pts · High · due Thu            │  │
│  │    Checklist 3/5 · Time logged 2h 30m of 4h estimated              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│  🎪 EVENT (2 tasks · 9 pts · 25%)                                        │
│     EVT-142  Edit exhibition showreel        In Progress   Thu   4 pts   │
│     EVT-147  Cut 3 speaker testimonials      To Do         Mon   5 pts   │
│                                                                          │
│  🤝 CLIENT (2 tasks · 12 pts · 33%)                                      │
│     CLI-088  ABC Traders — product video     In Review     Fri   8 pts   │
│     CLI-091  ABC Traders — social cutdowns   To Do         Mon   4 pts   │
│                                                                          │
│  🏢 BUSINESS (1 task · 4 pts · 11%)                                      │
│     BIZ-031  Rebuild company showreel        To Do         Oct   4 pts   │
│                                                                          │
│  📣 SELF-PROMOTION (0 tasks · 0 pts · 0%)                                │
│     — nothing assigned —                                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ 📦 OTHER — UNCATEGORISED WORK (2 tasks · 9 pts · 25%)  ⚠️        │    │
│  │                                                                  │    │
│  │  OTH-205  Fix audio on old wedding video          In Progress    │    │
│  │  ▸ What this is: "Client from last year asked as a favour.       │    │
│  │    Not billed, not part of any current project."                 │    │
│  │    Requested by: Admin (Sana) · 5 pts · no due date              │    │
│  │              [ Promote to a real project ]  [ Reassign ]         │    │
│  │                                                                  │    │
│  │  OTH-209  Help Yusra export ad creatives          To Do          │    │
│  │  ▸ What this is: "Covering for Yusra while she is on the         │    │
│  │    Expo shoot. One-off."                                         │    │
│  │    Requested by: Kashif (self) · 4 pts · due Wed                 │    │
│  │              [ Promote to a real project ]  [ Reassign ]         │    │
│  │                                                                  │    │
│  │  ⚠️ 25% of Kashif's load is uncategorised (threshold: 15%).      │    │
│  │     That is roughly 1.5 days a week of work with no project.     │    │
│  └──────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────┤
│  🔴 OVERDUE (1)   CLI-084 · 2 days late                                  │
│  ✅ COMPLETED THIS WEEK (4)  ·  On time 3/4  ·  Revisions 1              │
│  📅 On leave: none this week                                             │
├──────────────────────────────────────────────────────────────────────────┤
│  [ Assign new task ]   [ Rebalance this member ]   [ Full task list ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

### What this panel deliberately does

| Design choice | Reason |
|---|---|
| Grouped by **project type**, not by status | You asked "what is he working on" — the answer is a *type of work*, not a column |
| **Percentage of load per type** | Reveals imbalance instantly: 25% of Kashif's week is on unpaid favours |
| **Other is boxed and visually distinct** | It's the section that needs attention, so it looks like it |
| Every Other task shows its **written explanation** | Your explicit requirement — the "Other" option describes what the work is |
| **One-click promote** | Uncategorised work becomes real work without retyping anything |
| The **current live task** is pinned at the top | The literal answer to "what is he doing right now" |
| Threshold warning on Other | Turns an observation into a decision |

**Members do not have access to this panel.** It exists only for Admin, Super Admin, and (read-only) Team Coordinator — consistent with your decision that members cannot see each other. See [`03-ROLES-AND-PERMISSIONS.md`](03-ROLES-AND-PERMISSIONS.md).

---

## 7. Project screens

### Projects list (Admin / Super Admin / Coordinator)
```
PROJECTS                    [ All types ▾ ] [ Active ▾ ]   [ + New Project ]

🎪 EVENT (3)
   Expo Karachi — Oct 2026        🟢 Active   14 tasks  8✅  57%  ⏰ 37d
   Client Product Launch          🟡 Planning  6 tasks  0✅   0%  ⏰ 61d
   Ramadan Campaign 2026          ⚫ Archived 22 tasks 22✅ 100%

🤝 CLIENT (4)
   ABC Traders — Retainer         🟢 Active   9 tasks  4✅  44%  ⏱ 34/20h ⚠️
   XYZ Foods — Brand Video        🟢 Active   7 tasks  5✅  71%
   ...

🏢 BUSINESS (2)      📣 SELF-PROMOTION (1)      📦 OTHER (1)
   ...                  CNI YouTube Channel        Misc / Ad-hoc
                        🔴 Stalled — 0 tasks       🟠 12 open tasks ⚠️
                        in 6 weeks                 25% of team capacity
```

### New project form
Type is chosen **first**, and the rest of the form changes to match it. Choosing *Event* asks for an event date; choosing *Client* asks for retainer hours. No irrelevant fields.

### Project detail
Overview · Tasks (board/list) · Team & capacity consumed · Timeline · Files · Activity.

---

## 8. How this makes the intelligence better

The projects layer feeds directly into the engines from docs 06 and 07:

| Engine | What project context adds |
|---|---|
| **Assignment** | Someone already on the Expo project scores higher for another Expo task — context-switching is a real cost. New factor **S6 — project familiarity (5%)**. |
| **Assignment** | Event projects with a fixed date get deadline-fit weighting boosted automatically. |
| **Workload** | Load is now breakable by project type, so "we're at 90% but 25% of it is uncategorised favours" becomes visible. |
| **Rebalance Advisor** | Can now suggest *"drop the Other work before dropping client work"* — priority by project type, not just task priority. |
| **Recommendation panel** | Shows *"Member C is at 30% but 100% of it is Expo work — she has context here."* |

**Proposed project-type priority order** when the Rebalance Advisor decides what to shed first:
`Client (billable) > Event (fixed date) > Business > Self-Promotion > Other`
Configurable by Super Admin. **Q-027.**

---

## 9. Further engineering enhancements

> *"You can further tell me how this can be enhanced into a much better version or better engineering."*

Ordered by value.

### ⭐⭐⭐ P-01 · Project templates per type
An Event project spawns its standard 12 tasks the moment it's created — shoot, edit, thumbnails, ad creatives, scheduling — each pre-tagged with required skills and estimates. Creating a new event becomes 30 seconds instead of an hour, and nothing gets forgotten because it's the same checklist every time.
**Recommend: Phase 6.**

### ⭐⭐⭐ P-02 · Backwards scheduling from the event date
You enter the event date; the system generates the task deadlines by working backwards through the dependency chain. Move the event date and every deadline shifts with it. For a team that does events, this is the single biggest time-saver on this list.
**Recommend: Phase 5.**

### ⭐⭐⭐ P-03 · Client capacity ledger
Track hours consumed vs. retainer hours per client per month. `ABC Traders: 34h used of 20h contracted — 70% over.` Answers the question every agency gets wrong: *which client is quietly unprofitable?*
**Recommend: Phase 5.**

### ⭐⭐⭐ P-04 · The "Other" audit
A monthly report of everything that landed in Other, who requested it, and how much capacity it consumed. Recurring patterns get flagged: *"You've had 6 'quick favour' tasks from ABC Traders this month — 14 hours. That's not a favour, that's unbilled work."*
**Recommend: Phase 5. This is where the Other category pays for itself.**

### ⭐⭐ P-05 · Project health score
Automatic RAG status from real signals — % complete vs. % time elapsed, overdue count, blocked count, assignee load. A project going red before anyone notices is the whole point.
**Recommend: Phase 5.**

### ⭐⭐ P-06 · Capacity allocation targets per type
Set an intention — 60% client, 20% event, 10% business, 10% self-promotion — and the dashboard shows actual against it. Self-promotion permanently at 0% becomes a visible decision rather than an accident.
**Recommend: Phase 5.**

### ⭐⭐ P-07 · Cross-project conflict detection
*"Expo Karachi and the ABC Traders launch both need Kashif in the same week, and together they exceed his capacity by 40%."* Caught at planning time, not the week it happens.
**Recommend: Phase 5.**

### ⭐⭐ P-08 · Project phases / milestones
Pre-production → Production → Post → Delivery. Group tasks into stages and track stage completion. Useful for anything longer than two weeks.
**Recommend: Phase 6.**

### ⭐⭐ P-09 · Per-project budget in hours
Set a capacity budget on the project; the system warns as it's consumed. Works for internal projects too, not just billable ones.
**Recommend: Phase 6.**

### ⭐ P-10 · Client-facing progress link
A read-only URL showing project progress, no login. Kills the "any update?" message.
**Recommend: Phase 7 — was E-028.**

### ⭐ P-11 · Project archive intelligence
On completion, capture what the project actually cost vs. what was estimated. After five events, *"events like this typically take 140 hours"* becomes a real estimate instead of a guess.
**Recommend: Phase 7.**

### ⭐ P-12 · Auto-suggested project type
The system reads the project name and proposes the type. *"'Expo Karachi Oct 2026' — Event?"* Small, but it keeps the data clean, and clean data is what all the intelligence runs on.
**Recommend: Phase 6, or Phase 7 with the LLM layer.**

---

## 10. Requirements added by this document

| ID | Requirement | Priority |
|---|---|---|
| FR-100 | Admin and Super Admin can create, edit, archive and delete projects. | P0 |
| FR-101 | Team Coordinator can view all projects and assign tasks within them, but cannot create or edit projects. Members cannot create projects. | P0 |
| FR-102 | Every project has exactly one type: Event, Client, Business, Self-Promotion, or Other. | P0 |
| FR-103 | The project form shows type-specific fields (event date, retainer hours, channel, etc.). | P0 |
| FR-104 | Every task belongs to exactly one project. No orphan tasks. | P0 |
| FR-105 | Task cards and task detail display the project name, type, and type-specific context. | P0 |
| FR-106 | Tasks in an **Other** project require a mandatory written description of the work (`other_description`). The task cannot be saved without it. | P0 |
| FR-107 | Any Other task can be promoted into a real project in one action, preserving history. | P1 |
| FR-108 | Admin/Super Admin/Coordinator can open a **Member Activity Preview** showing that member's tasks grouped by project type, with a distinct Other section. | P0 |
| FR-109 | The preview shows the member's currently in-progress task pinned at the top. | P0 |
| FR-110 | The preview shows load percentage per project type. | P0 |
| FR-111 | The system warns when Other exceeds a configurable share of a member's or the team's capacity (default 15%). | P1 |
| FR-112 | Projects have a lifecycle status; a project cannot be completed with open tasks. | P1 |
| FR-113 | Task references are prefixed by project type (EVT/CLI/BIZ/PRM/OTH) — **subject to Q-026**. | P1 |
| FR-114 | Event projects auto-derive a deliverables-due date from the event date and flag tasks that would land after it. | P1 |
| FR-115 | The workload view can be broken down by project type. | P1 |
| FR-116 | Capacity consumed per project and per client is tracked and reportable. | P1 |
| FR-117 | The assignment engine adds a **project familiarity** factor. | P1 |
| FR-118 | The Rebalance Advisor respects a configurable project-type priority order. | P1 |
| FR-119 | Members see only projects they have at least one task in. | P0 |

**Business rules:**

| ID | Rule |
|---|---|
| BR-011 | A task cannot exist without a project. |
| BR-012 | A task in an Other project cannot be saved without `other_description`. |
| BR-013 | Only Admin and Super Admin may create or delete projects. |
| BR-014 | A project cannot move to Completed while open tasks remain. |
| BR-015 | Archiving a project archives its tasks; nothing is deleted. |
| BR-016 | Members see only the projects they are assigned into. |

---

## 11. Open questions from this document

- **Q-024** — Should there be a permanent catch-all *"Misc / Ad-hoc"* Other project that always exists, or must an Admin create an Other project each time?
  *Default: one permanent "Misc / Ad-hoc" project exists from day one, plus the ability to create more.*
- **Q-025** — Is 15% the right warning threshold for Other work?
  *Default: 15%, configurable.*
- **Q-026** — Type-prefixed task references (`EVT-142`) or plain sequential (`CNI-142`)?
  *Default: type-prefixed — it makes references self-describing.*
- **Q-027** — Is `Client > Event > Business > Self-Promotion > Other` the right order for what gets dropped first when someone is overloaded?
  *Default: as listed.*
- **Q-028** — Can a Team Coordinator create projects, or is that strictly Admin and above?
  *Default: strictly Admin and above; Coordinator assigns within existing projects.*
- **Q-029** — Should an Event project also be linkable to a Client project (an event *for* a client)?
  *Default: yes — Event has an optional client link.*
