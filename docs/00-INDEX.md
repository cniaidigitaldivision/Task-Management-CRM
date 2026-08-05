# CNI CRM — Documentation Index

> **Status:** Planning phase. No code has been written. Nothing has been implemented.
> **Last updated:** 2026-08-06 (Session 02)
>
> 🔄 **Session interrupted?** Open [`SESSION-STATE.md`](SESSION-STATE.md) and paste the resume prompt in §1 into a new session. Nothing is lost.

---

## 1. What this project is

An **internal Task Management CRM** for the CNI team (6–7 members, expandable).
It is *not* a public website. It is an internal operations tool where:

- **Super Admin** (brother) and **Admin** (sister) create, assign, edit, delete, and monitor tasks.
- **Members** (Kashif — video editor & team coordinator; Yusra — ads posting & management; others TBD) create their own tasks and update the status of tasks assigned to them.
- The system is **intelligent**: it recommends *who* should get a task based on role/skill match and current workload, and it *prevents overloading* any single member.
- Everything updates **in real time** across all logged-in users.

---

## 2. How to read these documents

> **⚡ Short on time? Read three documents.**
> [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) **§11** is the entire system on one screen.
> [`19-MASTER-SPECIFICATION-REGISTRY.md`](19-MASTER-SPECIFICATION-REGISTRY.md) is where you look up anything.
> [`SESSION-STATE.md`](SESSION-STATE.md) tells you where we stopped.

> **📐 Which document wins when two disagree?**
> [`19-MASTER-SPECIFICATION-REGISTRY.md`](19-MASTER-SPECIFICATION-REGISTRY.md) §1 names the single owner of each subsystem, and §9 records every conflict found and how it was resolved. That registry is the arbiter. Nothing else is.

Read in this order if you are new to the project:

| # | Document | What it answers |
|---|---|---|
| 00 | [`00-INDEX.md`](00-INDEX.md) | You are here. Map of everything + naming conventions. |
| 01 | [`01-PROJECT-BRIEF.md`](01-PROJECT-BRIEF.md) | Why we're building this, who it's for, what's in/out of scope. |
| 02 | [`02-FUNCTIONAL-REQUIREMENTS.md`](02-FUNCTIONAL-REQUIREMENTS.md) | Every feature, written as numbered requirements (FR-xxx). |
| 03 | [`03-ROLES-AND-PERMISSIONS.md`](03-ROLES-AND-PERMISSIONS.md) | Who can do what. Full permission matrix. |
| 04 | [`04-DATA-MODEL.md`](04-DATA-MODEL.md) | Database tables, fields, relationships. |
| 05 | [`05-TASK-LIFECYCLE-AND-STATUSES.md`](05-TASK-LIFECYCLE-AND-STATUSES.md) | Task statuses, allowed transitions, rules. |
| 06 | [`06-WORKLOAD-CAPACITY-ENGINE.md`](06-WORKLOAD-CAPACITY-ENGINE.md) | How "overload" is measured. Thresholds. The maths. |
| 07 | [`07-SMART-ASSIGNMENT-ENGINE.md`](07-SMART-ASSIGNMENT-ENGINE.md) | How the system recommends who to assign to. The scoring formula. |
| 08 | [`08-REALTIME-AND-NOTIFICATIONS.md`](08-REALTIME-AND-NOTIFICATIONS.md) | Live updates, in-app alerts, email/WhatsApp. |
| 09 | [`09-TECH-STACK-AND-ARCHITECTURE.md`](09-TECH-STACK-AND-ARCHITECTURE.md) | What we build it with, and how the pieces fit. |
| 10 | [`10-UI-SCREENS-AND-VIEWS.md`](10-UI-SCREENS-AND-VIEWS.md) | Every screen, what's on it, who sees it. |
| 11 | [`11-BENCHMARK-CLICKUP-AND-PEERS.md`](11-BENCHMARK-CLICKUP-AND-PEERS.md) | What ClickUp/Asana/Monday do well, what we copy, what we skip. |
| 12 | [`12-ENHANCEMENT-BACKLOG.md`](12-ENHANCEMENT-BACKLOG.md) | Ideas beyond your brief that would make this genuinely better. |
| 13 | [`13-OPEN-QUESTIONS.md`](13-OPEN-QUESTIONS.md) | **Questions for you.** Answer these and the plan locks in. |
| 14 | [`14-ROADMAP-AND-PHASES.md`](14-ROADMAP-AND-PHASES.md) | Build order, phase by phase, with exit criteria. |
| 15 | [`15-PROJECTS-AND-PROJECT-TYPES.md`](15-PROJECTS-AND-PROJECT-TYPES.md) | ★ Projects, the 5 project types, the "Other" category, and the Member Activity Preview. |
| 16 | [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) | ★ Threat model, credential provisioning, account recovery, Super Admin hardening, Google SSO roadmap. |
| 17 | [`17-TASK-TIMERS-AND-TIME-LIMITS.md`](17-TASK-TIMERS-AND-TIME-LIMITS.md) | ★ Task time limits, automatic timers, over-limit rules, extension approvals. |
| 18 | [`18-DESIGN-SYSTEM-AND-BRANDING.md`](18-DESIGN-SYSTEM-AND-BRANDING.md) | ★ Logo, brand palette, light/dark themes. **Every colour in the system.** |
| 19 | [`19-MASTER-SPECIFICATION-REGISTRY.md`](19-MASTER-SPECIFICATION-REGISTRY.md) | ⭐ **The canonical index.** Every requirement, rule, enum and setting — and which doc owns it. Read this to resolve any disagreement. |
| 20 | [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) | ⭐ **Build safety.** Module boundaries, dependency order, frozen interfaces, integration seams. |
| — | [`SESSION-STATE.md`](SESSION-STATE.md) | 🔄 **Resume point.** Read this first if a session was interrupted. |
| — | [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) | **The full checklist.** Every phase, every task, permanent record. |
| — | [`templates/FIRST-RUN-SETUP-GUIDE.md`](templates/FIRST-RUN-SETUP-GUIDE.md) | Day-one walkthrough. **No roster needed** — the Admin builds the team in-app. |
| — | [`decisions/`](decisions/) | Decision log (ADRs) — one file per locked decision. |

---

## 3. Naming conventions (so both of us stay oriented)

### Documents
```
docs/NN-KEBAB-CASE-TOPIC.md      NN = read order, 00–20
docs/SESSION-STATE.md            Resume point — short, current, read first
docs/PROGRESS-TRACKER.md         Full permanent checklist
docs/decisions/ADR-NNN-slug.md   NNN = 001, 002, ... one locked decision each
docs/templates/*.md              Blank forms for you to fill in
```

### The two tracker files — don't confuse them
| File | Job |
|---|---|
| `SESSION-STATE.md` | **Where we stopped.** Short, volatile. Read on resume after any interruption. |
| `PROGRESS-TRACKER.md` | **Everything, ever.** The complete task checklist across all phases. |

### Requirement IDs (used throughout, so we can point at exact things)
| Prefix | Meaning | Example |
|---|---|---|
| `FR-` | Functional Requirement | `FR-014 — Member can change status of own task` |
| `NFR-` | Non-Functional Requirement | `NFR-003 — Updates propagate in < 2 seconds` |
| `BR-` | Business Rule | `BR-007 — Block assignment above 100% capacity` |
| `ADR-` | Architecture Decision Record | `ADR-002 — Use Postgres over MongoDB` |
| `Q-` | Open Question awaiting your answer | `Q-011 — Do you want WhatsApp alerts?` |
| `E-` | Enhancement idea (not yet committed) | `E-009 — Natural-language task creation` |

### Code (once we start building — for reference only)
```
Folders / files : kebab-case      → components/task-card.tsx
React components: PascalCase      → TaskCard, WorkloadMeter
Functions/vars  : camelCase       → calculateWorkloadScore()
DB tables/cols  : snake_case      → task_assignments, due_date
Constants/enums : SCREAMING_SNAKE → STATUS_IN_REVIEW
Env variables   : SCREAMING_SNAKE → DATABASE_URL
Git branches    : type/short-desc → feat/smart-assignment
```

---

## 4. Current state

| Item | State |
|---|---|
| **Phase 0 (Planning)** | ✅ **COMPLETE** — all blockers cleared, all contradictions resolved |
| Company | ✅ Crescent Nova International (CNI) — AI & Digital Division |
| Planning documents | ✅ 21 documents, 11 ADRs |
| Brand & theming | ✅ [doc 18](18-DESIGN-SYSTEM-AND-BRANDING.md) — palette from the logo, light/dark for all roles |
| Canonical registry | ✅ [doc 19](19-MASTER-SPECIFICATION-REGISTRY.md) — 12 contradictions found and resolved |
| Build contracts | ✅ [doc 20](20-IMPLEMENTATION-CONTRACTS.md) — module walls and dependency order |
| Tech stack locked | ✅ Next.js + TypeScript + Supabase + Tailwind ([ADR-001](decisions/ADR-001-tech-stack.md)) |
| Role model locked | ✅ 4 roles ([ADR-002](decisions/ADR-002-four-role-model.md)) |
| Projects subsystem designed | ✅ [doc 15](15-PROJECTS-AND-PROJECT-TYPES.md) |
| Security architecture designed | ✅ [doc 16](16-SECURITY-AND-IDENTITY.md) |
| Crash-resume protocol | ✅ [`SESSION-STATE.md`](SESSION-STATE.md) |
| Team roster | ✅ Not needed — the Admin creates members in-app ([ADR-009](decisions/ADR-009-no-seeded-roster.md)) |
| Multi-tenancy | ✅ Single-tenant ([ADR-008](decisions/ADR-008-single-tenant.md)) |
| Any code written | ❌ None. By your instruction. |
| **Phase 1** | ⏸️ **Ready. Awaiting your explicit go-ahead.** |

---

## 5. The standing rule for every phase

> **No phase begins without explicit permission from the project owner.**
>
> When authorised, a phase proceeds **step by step** — not all at once — with [`SESSION-STATE.md`](SESSION-STATE.md) and [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) updated as work progresses. At the phase's exit criteria, work **stops and waits** for permission to begin the next one.

Phase 0 (Planning) is complete. Phase 1 is ready and waiting on your word.
