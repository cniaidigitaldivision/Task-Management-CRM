# CNI CRM — Crescent Nova International

Internal task management CRM for a 6–7 person creative/marketing team, with skill-aware assignment recommendations, workload overload protection, and per-task time limits.

**Status: ✅ Phase 0 (Planning) complete. No code written yet. Phase 1 awaits explicit go-ahead.**

> ⛔ **No phase begins without the owner's permission.** Work proceeds step by step within a phase, then stops at the boundary and waits.

---

## Start here

| I want to… | Read |
|---|---|
| ⚡ **See the whole system on one screen** | [`docs/20-IMPLEMENTATION-CONTRACTS.md`](docs/20-IMPLEMENTATION-CONTRACTS.md) **§11** |
| 🔄 **Resume after a session was interrupted** | [`docs/SESSION-STATE.md`](docs/SESSION-STATE.md) — paste the prompt in §1 |
| 🔍 **Look anything up / settle a disagreement** | [`docs/19-MASTER-SPECIFICATION-REGISTRY.md`](docs/19-MASTER-SPECIFICATION-REGISTRY.md) |
| Understand the whole project | [`docs/00-INDEX.md`](docs/00-INDEX.md) |
| Know where we are right now | [`docs/PROGRESS-TRACKER.md`](docs/PROGRESS-TRACKER.md) |
| See the brand, colours & theming | [`docs/18-DESIGN-SYSTEM-AND-BRANDING.md`](docs/18-DESIGN-SYSTEM-AND-BRANDING.md) |
| See the projects & "Other" design | [`docs/15-PROJECTS-AND-PROJECT-TYPES.md`](docs/15-PROJECTS-AND-PROJECT-TYPES.md) |
| See the security architecture | [`docs/16-SECURITY-AND-IDENTITY.md`](docs/16-SECURITY-AND-IDENTITY.md) |
| **Answer the questions blocking the build** | [`docs/13-OPEN-QUESTIONS.md`](docs/13-OPEN-QUESTIONS.md) |
| **Give the team names and roles** | [`docs/templates/TEAM-ROSTER-TEMPLATE.md`](docs/templates/TEAM-ROSTER-TEMPLATE.md) |
| See what makes this different from ClickUp | [`docs/11-BENCHMARK-CLICKUP-AND-PEERS.md`](docs/11-BENCHMARK-CLICKUP-AND-PEERS.md) §4 |
| See the intelligence design | [`docs/07-SMART-ASSIGNMENT-ENGINE.md`](docs/07-SMART-ASSIGNMENT-ENGINE.md) |

---

## What this is, in one paragraph

A task manager that knows your people. It tracks who can do what and how well, measures how loaded each person actually is (in weighted effort, not raw task count), and when you go to assign something it gives you a **ranked shortlist with reasons** — then stops you from dumping work on someone already at capacity. When nobody fits, it doesn't just refuse; it offers concrete alternatives: extend the deadline, split the task, or rebalance two other tasks to free someone up.

Everything updates live. Adding a new team member is a 60-second form.

---

## Documentation map

```
docs/
├── 00-INDEX.md                        map + naming conventions
├── 01-PROJECT-BRIEF.md                why, who, scope
├── 02-FUNCTIONAL-REQUIREMENTS.md      every feature, numbered
├── 03-ROLES-AND-PERMISSIONS.md        who can do what
├── 04-DATA-MODEL.md                   database design
├── 05-TASK-LIFECYCLE-AND-STATUSES.md  statuses + transitions
├── 06-WORKLOAD-CAPACITY-ENGINE.md     ★ overload prevention maths
├── 07-SMART-ASSIGNMENT-ENGINE.md      ★ who should do this task
├── 08-REALTIME-AND-NOTIFICATIONS.md   live updates + alerts
├── 09-TECH-STACK-AND-ARCHITECTURE.md  what we build it with
├── 10-UI-SCREENS-AND-VIEWS.md         every screen
├── 11-BENCHMARK-CLICKUP-AND-PEERS.md  what to copy, what to skip
├── 12-ENHANCEMENT-BACKLOG.md          ideas beyond the brief
├── 13-OPEN-QUESTIONS.md               ⚠️ needs your answers
├── 14-ROADMAP-AND-PHASES.md           build order
├── 15-PROJECTS-AND-PROJECT-TYPES.md   ★ projects, 5 types, the "Other" rule
├── 16-SECURITY-AND-IDENTITY.md        ★ threat model, provisioning, recovery, hardening
├── 17-TASK-TIMERS-AND-TIME-LIMITS.md  ★ time limits, timers, extension approvals
├── 18-DESIGN-SYSTEM-AND-BRANDING.md   ★ logo, palette, light/dark themes
├── 19-MASTER-SPECIFICATION-REGISTRY.md ⭐ canonical index — settles all disputes
├── 20-IMPLEMENTATION-CONTRACTS.md     ⭐ build safety — walls, order, gates
├── SESSION-STATE.md                   🔄 resume point after an interruption
├── PROGRESS-TRACKER.md                ⚠️ full checklist, all phases
├── decisions/                         ADR-001 … ADR-011 (locked)
└── templates/FIRST-RUN-SETUP-GUIDE.md day-one walkthrough
```

---

## The system in ten facts

```
FOUR ROLES      super_admin · admin · team_coordinator · member
FIVE PROJECT    event · client · business · self_promotion · other
EIGHT STATUSES  backlog → todo → in_progress → blocked → in_review
                → revisions → done  (+ cancelled)
TWO DEADLINES   due_date (when) · time_limit (how much working time)
ONE LOAD MODEL  points = effort × priority × status_weight · 36/week
ONE SCORE       skill .38 · avail .28 · deadline .14 · fair .09
                · perf .05 · familiarity .06  = 1.00
TWO COLOURS     teal #0E5C63 (interface) · gold #D4A63C (accent only)
TWO THEMES      light · dark · system — every role
ONE RULE        dependencies point downward; domain imports nothing
```

---

## Next action

👉 **Say "start Phase 1"** and work begins on the foundation: scaffold, database, authentication, MFA, recovery, roles, and row-level security.

Nothing blocks it. Ten questions remain open ([`docs/13-OPEN-QUESTIONS.md`](docs/13-OPEN-QUESTIONS.md)) but all have defaults — the two worth a look first are **Q-039** (MFA on privileged password resets) and **Q-041** (what happens when a task hits its time limit).
