# 01 — Project Brief

**Project name:** CNI CRM (working title)
**Type:** Internal web application — team task management CRM
**Owner:** You (project owner / decision maker)
**Date:** 2026-08-05
**Status:** Planning

---

## 1. The problem in one paragraph

You run a small creative/marketing team of 6–7 specialists — a video editor who also coordinates the team, an ads manager, and others. Work is currently assigned informally. There is no single place that shows who is doing what, how far along it is, or **who is drowning while someone else is idle**. Tasks land on whoever is nearest at hand, which distributes work unevenly. You want a system that not only *records* tasks but *thinks* — one that knows each person's specialty and current load, and tells you where a new task should go.

---

## 2. What we are building

A web-based task management CRM with three pillars:

### Pillar 1 — Task management that actually fits a small specialist team
Create, assign, track, comment on, and complete tasks. Statuses that reflect real creative work (not just "todo/done" — there is review, revision, and blocked). Multiple views: list, board, calendar, and a workload view.

### Pillar 2 — Role-aware intelligence
The system knows Kashif edits video and Yusra runs ads. When you type a task called *"Edit the Ramadan campaign reel"*, it should surface Kashif — and if Kashif is at capacity, it should say so and offer the next-best qualified person, or tell you to push the deadline.

### Pillar 3 — Load fairness, enforced
Every member has a measured capacity. The system tracks utilisation, warns before someone tips into overload, and **blocks or requires an explicit override** past the hard limit. It also actively suggests rebalancing when the distribution goes lopsided.

Everything is **live** — a status change by Yusra appears on the Admin dashboard within a couple of seconds without a refresh.

---

## 3. Who uses it

**LOCKED — four roles** ([ADR-002](decisions/ADR-002-four-role-model.md)):

| User | Person | Primary need |
|---|---|---|
| **Super Admin** | Your brother | Total control. Manages Admin accounts. **Immutable — cannot be altered by any other account.** Mandatory MFA. |
| **Admin** | Your sister | Day-to-day operations. Creates and manages Coordinator and Member accounts, creates projects, assigns and deletes tasks, sees everything. Mandatory MFA. |
| **Team Coordinator** | Kashif | Assigns tasks, reviews and approves work, sees all tasks and team workload. No account management, no project creation, no capacity override. Also a working member with his own tasks. |
| **Team Member** | Yusra + others | Own tasks only. **Cannot see other members' tasks, roles, skills, capacity or workload** ([ADR-003](decisions/ADR-003-member-data-isolation.md)). |

> The *Guest / Client viewer* role from the original draft is dropped from v1. Client-facing read-only project links are deferred to Phase 7 (P-10 in [doc 15](15-PROJECTS-AND-PROJECT-TYPES.md)).

---

## 4. Goals (what success looks like)

| # | Goal | How we'll know it worked |
|---|---|---|
| G-1 | One source of truth for all team work | Zero tasks tracked in WhatsApp/notebooks after 30 days of use |
| G-2 | No member is silently overloaded | Utilisation view shows nobody sustained above the hard threshold |
| G-3 | Assignment takes seconds, not deliberation | Admin picks from a ranked recommendation instead of guessing |
| G-4 | Admins always know current status without asking | Dashboard answers "where is X?" without a message to anyone |
| G-5 | The team grows without rework | Adding member #8 is a 60-second form, no code change |

---

## 5. Explicitly IN scope (v1)

- **Hardened authentication**: MFA, activation-link provisioning, session hardening, immutable audit log ([doc 16](16-SECURITY-AND-IDENTITY.md))
- **Super Admin immutability** enforced at the database level
- **Projects with 5 types** — Event, Client, Business, Self-Promotion, Other — with the mandatory-description "Other" rule ([doc 15](15-PROJECTS-AND-PROJECT-TYPES.md))
- **Member Activity Preview** for Admins, grouped by project type
- Per-role access control with member data isolation
- Team member management (add, edit, deactivate, change role, set capacity & skills)
- Task CRUD with rich fields (priority, effort estimate, due date, tags, skills required, attachments)
- Custom status workflow with review/revision loop
- **Smart assignment recommendation engine** (ranked candidates + plain-English reasons)
- **Workload & capacity engine** with soft warning + hard block thresholds
- Real-time updates across all connected clients
- In-app notifications
- Dashboards: personal ("My Work"), team workload heatmap, admin overview
- Comments with @mentions, file attachments
- Activity log / audit trail
- Mobile-responsive UI (works properly on a phone)

## 6. Explicitly OUT of scope (v1)

- A public marketing website (you said clearly: this is not a website build)
- Invoicing, payroll, or accounting
- Native iOS/Android apps (the web app will be phone-friendly; a PWA wrapper is a later option)
- **Google Sign-In** — deferred to Phase 7a. The schema is built for it in Phase 1 so no migration is needed later ([doc 16](16-SECURITY-AND-IDENTITY.md) §11).
- Deep integrations (Slack, Google Calendar, Meta Ads API) — parked in [`12-ENHANCEMENT-BACKLOG.md`](12-ENHANCEMENT-BACKLOG.md)
- **Multi-tenant SaaS.** You've confirmed you'll sell this eventually, but v1 is single-company. The only thing we do now is add an `organisation_id` column so the retrofit is cheap later — see **Q-034**.

---

## 7. Guiding principles for every design decision

1. **Small team, not enterprise.** ClickUp is powerful and overwhelming. We take its good ideas and leave the 400 settings behind. If a feature needs a tutorial, it's wrong.
2. **The system suggests, the human decides.** Recommendations are never silent auto-assignment. An Admin always sees *why* and can always override — with the override recorded.
3. **Fairness is a first-class feature, not a report.** Load balancing shows up at the moment of assignment, not in a monthly review.
4. **Everything is configurable without code.** Thresholds, statuses, roles, skills — all editable by Super Admin in the UI.
5. **Nothing is truly deleted.** Deletes are soft (archive + audit trail). Only Super Admin can purge.
6. **Real-time by default.** If two people are looking at the same board, they see the same thing.

---

## 8. Constraints & assumptions

| | |
|---|---|
| Team size | 6–7 now, plan for up to ~25 without redesign |
| Concurrent users | Under 25. This is not a scale problem; it's a *design quality* problem. |
| Budget | $0/month on free tiers at this scale ([ADR-001](decisions/ADR-001-tech-stack.md)) |
| Timeline | Not yet stated. **Q-013** |
| Language | English UI. **Q-016** covers Urdu/bilingual. |
| Devices | Desktop-primary, phone-secondary but fully functional |
| **Timezone** | **Asia/Karachi** ([ADR-004](decisions/ADR-004-working-calendar-and-capacity.md)) |
| **Working week** | **Monday–Saturday, 09:00–17:00** — 48 nominal hours, **36 effective capacity points** |

---

## 9. Next step

Answer [`13-OPEN-QUESTIONS.md`](13-OPEN-QUESTIONS.md) and fill in [`templates/TEAM-ROSTER-TEMPLATE.md`](templates/TEAM-ROSTER-TEMPLATE.md).
Then the plan is locked and Phase 1 in [`14-ROADMAP-AND-PHASES.md`](14-ROADMAP-AND-PHASES.md) begins.
