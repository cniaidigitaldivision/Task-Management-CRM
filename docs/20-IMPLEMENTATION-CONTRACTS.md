# 20 — Implementation Contracts & Build Order

**Added:** 2026-08-06 (Session 04)
**Purpose:** to make implementation safe — so building feature B never breaks feature A.

> ## 🎯 What this document is for
>
> You said it plainly: *"when you are implementing them they do not get disturbed or they do not get tackled — this will basically bug out the whole CRM and make a system crash."*
>
> That failure has one cause: **subsystems reaching into each other's internals.** When the timer writes directly to the workload table, or the assignment engine queries the database itself, a change in one place silently breaks three others.
>
> This document draws the walls. Each subsystem owns its data, exposes a fixed interface, and **may only be touched through that interface.** Get this right and features can be added for years without the system becoming fragile.

---

## 1. The four layers — and the one rule

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 4 — UI                     app/  components/              │
│  Renders. Calls server actions. Owns no logic and no rules.      │
│  ⛔ Never queries the database. Never does arithmetic on load.   │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3 — SERVER ACTIONS         app/**/actions.ts              │
│  Authenticate → authorise → validate → call domain → persist     │
│  → log → notify. The only place a write is orchestrated.         │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2 — DOMAIN                 lib/domain/                    │
│  Pure functions. Data in, answer out. No DB, no framework,       │
│  no clock, no randomness. 100% unit tested.                      │
│  ⛔ Never imports from lib/db, next/*, or React.                 │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 1 — DATA                   lib/db/                        │
│  Schema, migrations, queries, RLS. The only code that            │
│  speaks SQL.                                                     │
└──────────────────────────────────────────────────────────────────┘
```

> ### 🔒 THE ONE RULE
> **Dependencies point downward only.** Layer 4 → 3 → 2 → 1.
> Layer 2 (Domain) imports **nothing** from layers 1, 3, or 4.
>
> If this rule holds, the intelligence — the part that took the most design and matters the most — can never be broken by a UI change, a schema tweak, or a framework upgrade. It is also the only reason the engines can be exhaustively unit tested.

---

## 2. Module ownership — who owns which tables

**A module is the only code permitted to write its own tables.** Everything else asks the module.

| Module | Owns (writes) | Reads | Exposes |
|---|---|---|---|
| **auth** | `users` · `auth_identities` · `invitations` · `mfa_factors` · `recovery_codes` · `sessions` · `login_attempts` · `break_glass` | — | `getCurrentUser()` · `requireRole()` · `requireStepUp()` |
| **team** | `skills` · `user_skills` · `availability` | `users` | `getMember()` · `listMembers()` · `getEffectiveCapacity()` |
| **projects** | `projects` · `project_members` | `tasks` | `getProject()` · `listProjects()` · `getProjectContext()` |
| **tasks** | `tasks` · `task_skills` · `task_watchers` · `task_dependencies` · `checklist_items` · `statuses` | `projects` · `users` | `getTask()` · `listTasks()` · `changeStatus()` |
| **timers** | `time_entries` · `time_extension_requests` · timer columns on `tasks` | `tasks` · `users` | `getTimeSpent()` · `startTimer()` · `pauseTimer()` |
| **workload** | *(nothing — fully derived)* | `tasks` · `users` · `availability` · `time_entries` | `getWorkload()` · `getUtilisation()` · `getTeamWorkload()` |
| **assignment** | *(nothing — fully derived)* | everything, read-only | `recommendAssignees()` · `checkCapacity()` |
| **collaboration** | `comments` · `attachments` | `tasks` | `addComment()` · `attachFile()` |
| **notifications** | `notifications` | everything, read-only | `notify()` · `sendDigest()` |
| **audit** | `audit_log` · `activity_log` · `security_events` | — | `record()` — **insert only, no read-modify** |
| **settings** | `system_settings` | — | `getSetting()` · `setSetting()` |
| **theme** | `users.theme` | — | `getTheme()` · `setTheme()` |

### Why workload and assignment own no tables
They are **pure derivations**. Nothing about a person's load is stored — it is calculated from tasks, capacity, and availability every time it is asked for.

This is deliberate, and it is the single most important structural decision in the system:

| If load were stored | Because it is derived |
|---|---|
| Every task change must remember to update it | Nothing to forget |
| A missed update = a silently wrong number | Always correct by construction |
| Two screens can disagree | Every screen agrees automatically |
| Backfilling after a bug is painful | Nothing to backfill |

**A wrong workload number destroys trust in the entire product.** The cost is recalculating on read — trivial for a team of 7, and cacheable if it ever isn't.

---

## 3. Repository structure — authoritative (supersedes doc 09 §5)

```
cni-crm/
├── docs/                          ← all planning documents
├── public/
│   └── brand/                     logo-full-light.svg · logo-full-dark.svg
│                                  logo-mark.svg · favicon.svg · og-image.png
├── app/
│   ├── (auth)/                    login · activate · forgot-password
│   │                              reset-password · locked · mfa-setup
│   ├── (setup)/                   one-time Super Admin setup (self-disabling)
│   ├── (app)/
│   │   ├── my-work/               ← Member landing
│   │   ├── tasks/[reference]/
│   │   ├── projects/[id]/
│   │   ├── workload/
│   │   ├── dashboard/
│   │   ├── team/[id]/             ← includes Member Activity Preview
│   │   ├── reports/
│   │   ├── settings/
│   │   ├── security/              ← Super Admin only
│   │   └── profile/appearance/    ← THEME TOGGLE (all roles)
│   └── api/cron/                  overdue · digest · escalations · recurring
├── components/
│   ├── ui/                        shadcn primitives
│   ├── brand/                     Logo · ThemeToggle · ThemeProvider
│   ├── task/ · project/ · timer/ · workload/ · assignment/ · team/
├── lib/
│   ├── domain/                    ★ PURE — no imports from db/next/react
│   │   ├── constants.ts           ★ ALL enums & numeric constants (doc 19 §4)
│   │   ├── permissions.ts         ★ the permission matrix, in code
│   │   ├── workload-engine.ts
│   │   ├── assignment-engine.ts
│   │   ├── scoring.ts
│   │   ├── timer-engine.ts        ★ working-hours arithmetic
│   │   ├── status-machine.ts      ★ allowed transitions
│   │   └── __tests__/             ★ exhaustive
│   ├── db/
│   │   ├── schema.ts · migrations/ · queries/ · rls/
│   ├── auth/ · notifications/ · realtime/ · audit/ · settings/
├── styles/
│   └── tokens.css                 ★ ALL colour tokens (doc 18) — one file
└── types/
```

### ★ The five single-source-of-truth files
Everything that could drift lives in exactly one file. If a value appears in two places, one of them is a bug.

| File | Owns | Derived from |
|---|---|---|
| `lib/domain/constants.ts` | Every enum, effort point, priority weight, score weight | doc 19 §4 |
| `lib/domain/permissions.ts` | The full permission matrix as data | doc 03 §3 |
| `lib/domain/status-machine.ts` | Every allowed status transition | doc 05 §2 |
| `styles/tokens.css` | Every colour, spacing, radius, shadow | doc 18 |
| `lib/db/schema.ts` | Every table and column | doc 04 + doc 19 §6 |

---

## 4. Dependency graph — safe build order

```
                    ┌─────────────────┐
                    │  0. FOUNDATION  │  tokens.css · constants.ts
                    │                 │  schema · theme provider
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  1. AUTH        │  identity · sessions · MFA
                    │                 │  recovery · permissions · audit
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  2. TEAM        │  members · skills · capacity
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  3. PROJECTS    │  types · lifecycle · "Other"
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  4. TASKS       │  CRUD · statuses · comments
                    └───┬─────────┬───┘
                        ▼         ▼
              ┌─────────────┐ ┌─────────────┐
              │ 5. TIMERS   │ │ 6. REALTIME │   ← independent of each other
              └──────┬──────┘ └──────┬──────┘
                     └────────┬──────┘
                              ▼
                    ┌─────────────────┐
                    │  7. WORKLOAD    │  needs tasks + capacity + time
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  8. ASSIGNMENT  │  needs workload + skills + projects
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  9. DASHBOARDS  │  needs everything above
                    └─────────────────┘
```

**Read this as a hard constraint, not a suggestion.** Building workload before timers means writing it twice. Building assignment before workload means it has nothing to score against. Building anything before auth means retrofitting permissions into finished screens — which is exactly how permission bugs ship.

### Why the design system is at layer 0
Colour tokens must exist before the first component. Retrofitting a theme into finished components means touching every file — the single most common source of visual inconsistency in a rebuild.

---

## 5. 🔒 Frozen contracts

Once these are built and tested, **their signatures do not change.** Everything downstream depends on them. Changing a frozen contract means auditing every caller.

### Domain — pure functions
```ts
// workload-engine.ts
calculateTaskLoad(task, status) → number
calculateUserLoad(tasks[], statuses[]) → number
calculateEffectiveCapacity(user, availability[], window) → number
calculateUtilisation(load, capacity) → { pct, band }
getBand(pct, thresholds) → 'available'|'healthy'|'warning'|'over'

// assignment-engine.ts
scoreCandidate(task, user, context) → { score, factors, flags, reasons[] }
recommendAssignees(task, candidates[], context) → RankedCandidate[]
generateAlternatives(task, candidates[]) → Alternative[]

// timer-engine.ts
calculateElapsed(segments[], now) → minutes            // excludes non-working hours
isWithinWorkingHours(instant, calendar) → boolean
nextResumeTime(instant, calendar) → instant
calculateOverage(spent, limit, extensions[]) → { over, pct }

// status-machine.ts
canTransition(from, to, actorRole, isAssignee) → boolean
requiredFieldsFor(status) → string[]

// permissions.ts
can(actor, action, resource) → boolean
requiresStepUp(action) → boolean
```

**Every one is deterministic.** `now` is always a parameter, never read from the system clock — which is what makes the working-hours arithmetic testable across timezones, midnights, Sundays, and leave periods without waiting for real time to pass.

### Data — invariants that never relax

| Invariant | Enforcement |
|---|---|
| `tasks.project_id` is NOT NULL | DB constraint (BR-011) |
| `other_description` present when project type is `other` | DB check (BR-012) |
| `super_admin` rows writable only by themselves | DB trigger + RLS (BR-027) |
| `audit_log` · `activity_log` · `security_events` · `login_attempts` · `time_entries` | **No UPDATE or DELETE grant, any role** |
| One assignee per task | Single column, not a join table (BR-001) |
| Members read only their own tasks | RLS policy (BR-016, ADR-003) |

> **These are enforced in the database.** Application-layer-only enforcement is a bug waiting for the one code path that forgets.

---

## 6. Integration points — where bugs actually happen

Nine seams between subsystems. Each has a defined contract because each is a place where an assumption can silently diverge.

| # | Seam | Contract | Failure if wrong |
|:--:|---|---|---|
| **I-1** | Timer → Workload | Workload **reads** `time_entries`. The timer never writes load. | Double-counted capacity; numbers that disagree between screens |
| **I-2** | Extension approved → Workload | Granting time raises the limit; workload recalculates on next read. No cached value updated. | Stale utilisation after an approval |
| **I-3** | Status change → Timer | The status machine emits an event; the timer subscribes. Status code never calls timer internals. | Timers running on Done tasks; time accruing while Blocked |
| **I-4** | Task assignment → Capacity check | Assignment calls `checkCapacity()` **before** writing. Never after. | Overload written first and rejected second — a half-applied change |
| **I-5** | Project type → Task rules | Tasks ask `projects.getType()`. Task code never reads the projects table. | "Other" description rule silently skipped |
| **I-6** | Any write → Audit | Server actions call `audit.record()` after a successful write, inside the same transaction. | Actions that happened with no record — the log stops being evidence |
| **I-7** | Any change → Realtime | Realtime subscribes to database changes. Nothing publishes manually. | Missed events; two clients showing different truth |
| **I-8** | Permission → every action | Every server action starts with `can()`. No exceptions, including internal calls. | Privilege escalation |
| **I-9** | Theme → every component | Components read semantic tokens. No component knows which theme is active. | Unreadable text in one theme; the classic dark-mode bug |

> **Rule for all nine: communicate through the module's public interface or through events. Never reach into another module's tables.**

---

## 7. Migration safety

| Rule | Why |
|---|---|
| Every schema change is a **new numbered migration file**. Never edit an applied one. | Applied migrations are history; editing them desynchronises environments |
| Migrations are **additive within a phase**. Destructive changes get their own reviewed migration. | A dropped column mid-phase takes data with it |
| Every migration is tested against a **restored production backup** before production. | The only way to know it survives real data |
| RLS policies live in their own migration files, separate from schema. | Security changes get reviewed as security changes |
| Adding a column: add nullable → backfill → add constraint. **Three migrations, not one.** | A NOT NULL added in one step fails on any existing row |
| Never drop a column in the same release that stops using it. | If the release is rolled back, the data must still be there |

---

## 8. Testing gates per phase

A phase is not complete until its gate passes. **These are the exit criteria, not a wish list.**

| Phase | Gate |
|---|---|
| **1 — Foundation & Security** | A Member cannot read another Member's data **via direct database query** (not just via the UI). Every permission in doc 03 §3 has a passing test. Password reset and 3-attempt lockout work end to end. Theme switches with no flash on both themes. |
| **2 — Projects, Tasks, Timers** | A task cannot be created without a project. An Other-task cannot save without a description. Timer arithmetic is correct across a Saturday 16:30 → Monday 09:00 boundary, across leave, and across a Sunday. Only an Admin can approve an extension. |
| **3 — Realtime** | Two browsers, one change, both update within 2 seconds. A Member never receives an event for a task they cannot see. |
| **4 — Intelligence** | Workload maths verified against hand-calculated fixtures. Assignment weights sum to exactly 1.00. Hard threshold blocks; override requires a reason and is logged. |
| **5 — Dashboards** | Every number on every dashboard matches the domain function that produced it. No screen computes its own arithmetic. |
| **6 — Polish** | Full keyboard navigation. WCAG AA verified in both themes. All flows usable at 375px. |

---

## 9. Phase 1 — the concrete build order

The order below is dependency-safe. Each step is checked off in [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) as it lands, and [`SESSION-STATE.md`](SESSION-STATE.md) is updated so a crash never loses more than one step.

```
STEP 1 · SCAFFOLD
  1.1  Next.js 16 + TypeScript + Tailwind + shadcn/ui
  1.2  Repository structure (§3)
  1.3  styles/tokens.css — every colour token from doc 18
  1.4  ThemeProvider + pre-paint script + ThemeToggle
  1.5  lib/domain/constants.ts — every enum from doc 19 §4
  1.6  Logo assets into public/brand/
  ✅ GATE: light and dark render correctly; no flash; tokens resolve

STEP 2 · DATA FOUNDATION
  2.1  Supabase project; Resend with SPF/DKIM/DMARC verified
  2.2  Migration 001 — users, auth_identities, sessions, invitations
  2.3  Migration 002 — mfa_factors, recovery_codes, login_attempts, break_glass
  2.4  Migration 003 — audit_log, security_events (append-only grants)
  2.5  Migration 004 — skills, user_skills, system_settings
  2.6  Migration 005 — RLS policies + Super Admin immutability trigger
  ✅ GATE: trigger blocks a foreign write to a super_admin row (proven by test)

STEP 3 · DOMAIN — PERMISSIONS
  3.1  lib/domain/permissions.ts — the full matrix as data
  3.2  Exhaustive unit tests — every role × every action
  ✅ GATE: 100% of doc 03 §3 covered by passing tests

STEP 4 · AUTHENTICATION
  4.1  Password hashing (Argon2id) + policy + breach check
  4.2  Sign-in, sessions, device binding, rotation
  4.3  Rate limiting + 3-attempt lockout + auto-clear
  4.4  MFA — TOTP, WebAuthn, recovery codes
  4.5  Step-up re-authentication
  ✅ GATE: lockout, unlock, and MFA all work end to end

STEP 5 · PROVISIONING & RECOVERY
  5.1  One-time Super Admin setup route (self-disabling)
  5.2  Invitation flow — hashed token, 48h, single use
  5.3  Activation — set password, enrol MFA
  5.4  Forgot password — email code, 15 min, MFA for privileged roles
  5.5  Email templates (light palette, FR-215)
  5.6  Login and anomaly alerts
  ✅ GATE: full chain works — setup → Admin → Member → forgot → reset

STEP 6 · TEAM MANAGEMENT
  6.1  Skills library with starter set + keywords
  6.2  Create/edit/deactivate member; role, skills, capacity
  6.3  Own-profile editing + Profile → Appearance (theme)
  6.4  Session list + self-revoke
  ✅ GATE: an Admin can build a whole team through the UI, no code

STEP 7 · SHELL & FIRST RUN
  7.1  Role-aware sidebar (doc 03 §4) + top bar
  7.2  Responsive layout down to 375px
  7.3  Guided first-run wizard
  7.4  Deploy to preview
  ✅ GATE: Phase 1 exit criteria (§8) all pass

⛔ STOP. Report. Wait for permission to begin Phase 2.
```

---

## 10. Working agreement

| Rule | |
|---|---|
| **Permission per phase** | No phase begins without your explicit go-ahead. At the exit gate, work stops and reports. |
| **Step by step** | Within a phase, one step at a time — not the whole phase in one burst. |
| **Tracker discipline** | `SESSION-STATE.md` and `PROGRESS-TRACKER.md` updated after every step, so a power cut loses one step at most. |
| **Docs stay true** | If implementation reveals a design flaw, the document is corrected **before** the code — never after, never "we'll remember". |
| **New conflicts** | Recorded in [doc 19 §9](19-MASTER-SPECIFICATION-REGISTRY.md) with a resolution before affected code is written. |
| **No silent scope changes** | If something turns out bigger than planned, you decide whether to cut it. Not me. |
| **Ask, don't guess** | Ambiguity gets a question, not an assumption. |

---

## 11. What "sleek and organised" means in practice

You asked for something you can read once and hold in your head. Here is the whole system in one screen:

```
FOUR ROLES        super_admin · admin · team_coordinator · member
                  Super Admin immutable. Members see only themselves.

FIVE PROJECT      event · client · business · self_promotion · other
TYPES             Every task belongs to one. "Other" needs a written reason.

EIGHT STATUSES    backlog → todo → in_progress → blocked → in_review
                  → revisions → done  (+ cancelled)
                  Nobody approves their own work.

TWO DEADLINES     due_date  = when it must be finished
                  time_limit = how much working time it may consume
                  Coordinator sets limits. Only Admin extends.

ONE LOAD MODEL    points = effort × priority × status_weight
                  36 points/week · 85% warns · 100% blocks
                  Never stored. Always derived.

ONE SCORE         skill .38 · availability .28 · deadline .14
                  fairness .09 · performance .05 · familiarity .06  = 1.00

TWO BRAND         teal #0E5C63 (interface)  ·  gold #D4A63C (accent only)
COLOURS           Gold is never a status, warning, or state.

TWO THEMES        light · dark · system — every role, Profile → Appearance

ONE RULE          Dependencies point downward. Domain imports nothing.
```

That's the system. Everything in the other nineteen documents is detail beneath these ten facts.
