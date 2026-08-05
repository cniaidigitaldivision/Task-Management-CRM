# 19 — Master Specification Registry

**Added:** 2026-08-06 (Session 04)
**Purpose:** the single canonical index of everything the CRM contains.

> ## 🔑 How to use this document
>
> **This is the lookup table, not the explanation.** Every requirement, rule, enum, setting and table in the system has exactly one row here, pointing at the one document that owns its full definition.
>
> **Before implementing anything, check here first.** If two documents appear to disagree, the **Owner** column in this registry decides. Nothing else does.
>
> §9 lists every contradiction found during the Session 04 sweep, and how each was resolved.

---

## 1. Document ownership map

Each subsystem has exactly **one** owning document. Amendments live in the owner, never scattered.

| Subsystem | Owner | Nothing else may redefine |
|---|---|---|
| Vision, scope, constraints | [`01`](01-PROJECT-BRIEF.md) | What's in and out of v1 |
| Core requirements FR-001…095 | [`02`](02-FUNCTIONAL-REQUIREMENTS.md) | Auth, team, tasks, views, collaboration |
| Roles & permissions | [`03`](03-ROLES-AND-PERMISSIONS.md) | **Every permission decision** |
| Database schema | [`04`](04-DATA-MODEL.md) | **Every table and column** |
| Statuses & transitions | [`05`](05-TASK-LIFECYCLE-AND-STATUSES.md) | Status names, allowed transitions, effort sizes, priorities |
| Workload maths | [`06`](06-WORKLOAD-CAPACITY-ENGINE.md) | Capacity formulas, thresholds, rebalancing |
| Assignment scoring | [`07`](07-SMART-ASSIGNMENT-ENGINE.md) | Score factors and weights |
| Real-time & notifications | [`08`](08-REALTIME-AND-NOTIFICATIONS.md) | Channels, events, digests |
| Stack & architecture | [`09`](09-TECH-STACK-AND-ARCHITECTURE.md) | Technology choices, folder structure |
| Screens & layout | [`10`](10-UI-SCREENS-AND-VIEWS.md) | Screen inventory, navigation |
| Competitor rationale | [`11`](11-BENCHMARK-CLICKUP-AND-PEERS.md) | *(reference only)* |
| Future ideas | [`12`](12-ENHANCEMENT-BACKLOG.md) | *(nothing committed)* |
| Open questions | [`13`](13-OPEN-QUESTIONS.md) | Question status |
| Build phases | [`14`](14-ROADMAP-AND-PHASES.md) | Phase contents and order |
| Projects & types | [`15`](15-PROJECTS-AND-PROJECT-TYPES.md) | Project types, "Other" rules, Activity Preview |
| Security & identity | [`16`](16-SECURITY-AND-IDENTITY.md) | **Every auth, session, and recovery decision** |
| Timers & time limits | [`17`](17-TASK-TIMERS-AND-TIME-LIMITS.md) | Time limits, timers, extensions |
| Design system | [`18`](18-DESIGN-SYSTEM-AND-BRANDING.md) | **Every colour, token, spacing value** |
| This registry | [`19`](19-MASTER-SPECIFICATION-REGISTRY.md) | Canonical index + contradiction resolutions |
| Build contracts | [`20`](20-IMPLEMENTATION-CONTRACTS.md) | Module boundaries, dependency order, freeze rules |

---

## 2. Requirement registry — FR

### Authentication & accounts — owner: doc 02 / doc 16
| ID | Requirement | Phase |
|---|---|:--:|
| FR-001 | Email + password sign-in, persistent sessions | 1 |
| FR-002 | Hashed passwords; password reset flow | 1 |
| FR-003 | One Super Admin seeded at setup; no in-app path to create another | 1 |
| FR-004 | Accounts created by invitation; invitee sets their own password | 1 |
| FR-005 | Role changes take effect on next request | 1 |
| FR-006 | Deactivated users cannot sign in; history preserved | 1 |
| FR-007 | *(absorbed into FR-145 — MFA)* | — |

### Team & member management — owner: doc 02
| ID | Requirement | Phase |
|---|---|:--:|
| FR-010 | Admin+ can add a member: name, email, role, skills, capacity, avatar | 1 |
| FR-011 | Adding a member is a form — no code change, no redeploy | 1 |
| FR-012 | Role title + skill tags with proficiency 1–5 | 1 |
| FR-013 | Weekly capacity per member (default **36**) | 1 |
| FR-014 | Availability calendar — leave, holidays, half-days | 4 |
| FR-015 | Deactivate (never hard-delete); open tasks flagged for reassignment | 1 |
| FR-016 | Super Admin can promote/demote roles | 1 |
| FR-017 | Editable skills library | 1 |

### Tasks — owner: doc 02
| ID | Requirement | Phase |
|---|---|:--:|
| FR-020 | Any user can create a task; a Member's own task self-assigns | 2 |
| FR-021 | Full task field set | 2 |
| FR-022 | Admin/Super Admin/Coordinator assign to anyone | 2 |
| FR-023 | Reassignment notifies the previous assignee and is logged | 2 |
| FR-024 | Soft delete → Trash; Super Admin can purge | 2 |
| FR-025 | Member edit rights limited to own tasks | 2 |
| FR-026 | Subtasks | 6 |
| FR-027 | Checklists | 6 |
| FR-028 | Dependencies (`blocks`, `relates_to`) | 6 |
| FR-029 | Recurring tasks | 6 |
| FR-030 | Task templates | 6 |
| FR-031 | Bulk actions | 6 |
| FR-032 | Unique task reference — **type-prefixed, see FR-113** | 2 |

### Statuses — owner: doc 05
| ID | Requirement | Phase |
|---|---|:--:|
| FR-040 | 8 statuses: Backlog → To Do → In Progress → Blocked → In Review → Revisions → Done, + Cancelled | 2 |
| FR-041 | Members move their own tasks within the transition rules | 2 |
| FR-042 | Only Coordinator+ may approve In Review → Done or → Revisions | 2 |
| FR-043 | Blocked requires a reason | 2 |
| FR-044 | Status set editable by Super Admin | 5 |
| FR-045 | Every status change timestamped and attributed | 2 |

### Smart assignment — owner: doc 07
| ID | Requirement | Phase |
|---|---|:--:|
| FR-050 | Ranked recommended assignees with match scores | 4 |
| FR-051 | Plain-English reason per recommendation | 4 |
| FR-052 | Never auto-applied; always confirmed by a human | 4 |
| FR-053 | Soft-threshold warning; hard-threshold override with reason | 4 |
| FR-054 | "Nobody fits" alternatives panel | 4 |
| FR-055 | Keyword fallback when no skills are tagged | 4 |
| FR-056 | Rebalance Advisor | 4 |
| FR-057 | Configurable scoring weights | 5 |

### Workload — owner: doc 06
| ID | Requirement | Phase |
|---|---|:--:|
| FR-060 | Load measured in weighted capacity points | 4 |
| FR-061 | Secondary guard — max concurrent active tasks (default 5) | 4 |
| FR-062 | Configurable thresholds (85% / 100%) | 4 |
| FR-063 | Workload view with per-member bars | 4 |
| FR-064 | Rolling window (default: week) | 4 |
| FR-065 | Leave reduces effective capacity | 4 |
| FR-066 | Sustained-overload detection | 4 |

### Real-time & notifications — owner: doc 08
| ID | Requirement | Phase |
|---|---|:--:|
| FR-070 | Live propagation of all task events (<2s) | 3 |
| FR-071 | In-app notification centre | 3 |
| FR-072 | Member notification triggers | 3 |
| FR-073 | Admin notification triggers | 3 |
| FR-074 | Email notifications + per-user preferences | 3 |
| FR-075 | Optional WhatsApp/Telegram | 7 |
| FR-076 | Daily digest | 3 |

### Views & reporting — owner: doc 10
| ID | Requirement | Phase |
|---|---|:--:|
| FR-080 | My Work view | 2 |
| FR-081 | List view with filter/sort | 2 |
| FR-082 | Board view with drag-and-drop | 2 |
| FR-083 | Calendar view | 5 |
| FR-084 | Workload view | 4 |
| FR-085 | Admin dashboard | 5 |
| FR-086 | Global search | 5 |
| FR-087 | Saved views | 7 |
| FR-088 | Reports | 5 |
| FR-089 | CSV export | 7 |

### Collaboration — owner: doc 02
| ID | Requirement | Phase |
|---|---|:--:|
| FR-090 | Threaded comments with @mentions | 2 |
| FR-091 | File attachments | 2 |
| FR-092 | Per-task activity timeline | 2 |
| FR-093 | System audit log | 1 |
| FR-094 | Time tracking — **superseded by FR-170…195** | 2 |
| FR-095 | Trash with 30-day restore | 2 |

### Projects — owner: doc 15
| ID | Requirement | Phase |
|---|---|:--:|
| FR-100 | Admin+ create/edit/archive/delete projects | 2 |
| FR-101 | Coordinator views and assigns within, cannot create | 2 |
| FR-102 | Exactly one type per project (5 types) | 2 |
| FR-103 | Type-specific fields | 2 |
| FR-104 | Every task belongs to exactly one project | 2 |
| FR-105 | Project context on cards and detail | 2 |
| FR-106 | Mandatory `other_description` on Other-type tasks | 2 |
| FR-107 | Promote an Other task to a real project | 2 |
| FR-108 | Member Activity Preview grouped by project type | 2 |
| FR-109 | Current in-progress task pinned at top of preview | 2 |
| FR-110 | Load % per project type | 2 |
| FR-111 | "Other" capacity warning (default 15%) | 4 |
| FR-112 | Project lifecycle; cannot complete with open tasks | 2 |
| FR-113 | Type-prefixed references (EVT/CLI/BIZ/PRM/OTH) | 2 |
| FR-114 | Event deliverables-due derived from event date | 2 |
| FR-115 | Workload breakdown by project type | 4 |
| FR-116 | Capacity consumed per project and per client | 5 |
| FR-117 | Project-familiarity assignment factor | 4 |
| FR-118 | Project-type shed order in Rebalance Advisor | 4 |
| FR-119 | Members see only projects they have a task in | 2 |

### Security & identity — owner: doc 16
| ID | Requirement | Phase |
|---|---|:--:|
| FR-140 | Super Admin immutable by any other account (4 enforcement layers) | 1 |
| FR-141 | Provisioning chain: Super Admin → Admin → Coordinator/Member | 1 |
| FR-142 | Single-use, 48h, hash-stored activation tokens | 1 |
| FR-143 | Invitation emails never contain a password | 1 |
| FR-144 | Optional temporary password, screen-only, 24h, forced change | 1 |
| FR-145 | MFA mandatory for Super Admin and Admin | 1 |
| FR-146 | Super Admin MFA cannot be disabled by anyone | 1 |
| FR-147 | Argon2id, min 12 chars (16 for Super Admin), breach-checked | 1 |
| FR-148 | Rate limiting; **3 failed attempts locks the account** | 1 |
| FR-149 | Step-up re-auth for sensitive actions | 1 |
| FR-150 | Device-bound sessions, role-scoped TTL, rotation + reuse detection | 1 |
| FR-151 | Super Admin alerted on every sign-in | 1 |
| FR-152 | Anomaly alerts — new device, new country, impossible travel | 1 |
| FR-153 | Append-only audit and security logs | 1 |
| FR-154 | Users view and revoke their own sessions | 1 |
| FR-155 | "Forgot password" on all four roles — emailed one-time code + link | 1 |
| FR-155a | 3-attempt lockout, cleared by emailed unlock code | 1 |
| FR-155b | MFA required after email code for Super Admin and Admin | 1 |
| FR-155c | Reset revokes all sessions; confirmation email with IP/location | 1 |
| FR-155d | Recovery codes + sealed master credential backstops | 1 |
| FR-155e | Recovery responses never reveal account existence; constant time | 1 |
| FR-156 | Super Admin cannot delete/demote/suspend/lock his own account | 1 |
| FR-157 | RLS enforces member data isolation | 1 |
| FR-158 | Optional country lock / IP allowlist | 7 |
| FR-159 | Security dashboard for Super Admin | 5 |
| FR-160 | Google Sign-In links to existing accounts only | 7 |
| FR-161 | `auth_identities` table exists from Phase 1 | 1 |
| FR-162 | ~~`organisation_id` on every table~~ — **DROPPED**, [ADR-008](decisions/ADR-008-single-tenant.md) | — |

### Timers & time limits — owner: doc 17
| ID | Requirement | Phase |
|---|---|:--:|
| FR-170 | Time limit per task, distinct from due date | 2 |
| FR-171 | Limit pre-filled from effort estimate (60 min/point) | 2 |
| FR-172 | Admin, Super Admin **and Coordinator** set limits | 2 |
| FR-173 | Only Admin+ edit a limit after work starts | 2 |
| FR-174 | Timer runs automatically while In Progress / Revisions | 2 |
| FR-175 | Auto-pause on status change | 2 |
| FR-176 | Auto-pause outside working hours, Sundays, leave | 2 |
| FR-177 | Idle prompt at 2h; auto-pause at 2h30 | 2 |
| FR-178 | Append-only `time_entries` segments | 2 |
| FR-179 | Manual entry allowed, reason required, visibly flagged | 2 |
| FR-180 | Reminders at 50/75/90/100/120/150% | 2 |
| FR-181 | At 100% — enforced stop-and-account | 2 |
| FR-182 | Admin + Coordinator notified on over-limit | 2 |
| FR-183 | Extension requests with mandatory reason | 2 |
| FR-184 | **Only Admin+ approve extensions** | 2 |
| FR-185 | Extension review context panel | 2 |
| FR-186 | Declining requires a written reason | 2 |
| FR-187 | Approved extensions update limit, timer, and capacity | 2 |
| FR-188 | All limit/extension/adjustment changes audited | 2 |
| FR-189 | Timer UI on cards and detail | 2 |
| FR-190 | Admin dashboard time & extensions widget | 5 |
| FR-191 | Members see only their own time data | 2 |
| FR-192 | Real time feeds the capacity engine | 4 |
| FR-193 | Estimate-accuracy and extension-pattern reports | 5 |
| FR-194 | Digest includes over-limit and pending extensions | 3 |
| FR-195 | Out-of-hours work flagged and reported | 5 |

### Design system — owner: doc 18
| ID | Requirement | Phase |
|---|---|:--:|
| FR-200 | CNI AI & Digital Division logo throughout | 1 |
| FR-201 | **Light/dark/system theme toggle for every role**, in Profile → Appearance | 1 |
| FR-202 | Theme stored on the user record, synced across devices | 1 |
| FR-203 | `system` default, follows OS | 1 |
| FR-204 | Theme applied before first paint | 1 |
| FR-205 | No raw hex in components — semantic tokens only | 1 |
| FR-206 | Gold never conveys semantic state | 1 |
| FR-207 | WCAG AA in both themes | 1 |
| FR-208 | Never colour alone — always a label or icon | 1 |
| FR-209 | Light/dark logo variants swap automatically | 1 |
| FR-210 | Charts use the same tokens | 5 |
| FR-211 | Tabular numerals for time and numeric data | 2 |
| FR-212 | Respects `prefers-reduced-motion` | 1 |
| FR-213 | Theme switch causes no layout shift | 1 |
| FR-214 | Visible focus ring in both themes | 1 |
| FR-215 | Emails always use the light palette | 3 |

---

## 3. Business rules — the complete set

| ID | Rule | Owner | Enforced where |
|---|---|---|---|
| BR-001 | Exactly one assignee per task | 02 | DB constraint + server |
| BR-002 | Nobody approves their own work | 03 | Server + UI |
| BR-003 | Hard-threshold assignment blocked unless overridden with a reason | 06 | Server |
| BR-004 | Soft-threshold shows a warning but proceeds | 06 | Server + UI |
| BR-005 | Members on approved leave excluded from recommendations | 06 | Assignment engine |
| BR-006 | Deactivated members cannot receive new tasks | 03 | Server + RLS |
| BR-007 | Deleting a member never deletes their history | 03 | Soft delete |
| BR-008 | Unfinished dependencies warn on entering In Progress | 02 | Server |
| BR-009 | Overdue evaluated at 17:00 Asia/Karachi | 05 | Cron |
| BR-010 | Effort estimate mandatory when assigning to someone else | 02 | Server |
| BR-011 | A task cannot exist without a project | 15 | **DB NOT NULL** |
| BR-012 | Other-type tasks require `other_description` | 15 | DB check + server |
| BR-013 | Only Admin+ create or delete projects | 15 | Server + RLS |
| BR-014 | A project cannot complete with open tasks | 15 | Server |
| BR-015 | Archiving a project archives its tasks; nothing deleted | 15 | Server |
| BR-016 | Members see only projects they're assigned into | 15 | **RLS** |
| BR-017 | Time limit and due date are independent | 17 | Model |
| BR-018 | Only Admin+ grant additional time | 17 | Server |
| BR-019 | Timer never accrues outside working hours, Sundays, or leave | 17 | Timer service |
| BR-020 | Manual time always needs a reason and is flagged | 17 | DB check + server |
| BR-021 | An over-limit task must be completed, extended, or explained | 17 | Server + UI |
| BR-022 | Declining an extension requires a reason | 17 | Server |
| BR-023 | Time entries are append-only; corrections add rows | 17 | **No UPDATE grant** |
| BR-024 | Gold never conveys status, priority, workload, or warning | 18 | Lint rule + review |
| BR-025 | Components use semantic tokens only | 18 | Lint rule |
| BR-026 | New colours are added to doc 18 before use | 18 | Review |
| BR-027 | Super Admin writable only by itself | 03/16 | **DB trigger + RLS** |
| BR-028 | No in-app path creates a Super Admin | 03/16 | No such code path |

---

## 4. Canonical enums — define once, here

> Any enum below appears in exactly one place in code: `lib/domain/constants.ts`. Nothing else declares these values.

```
ROLE                super_admin | admin | team_coordinator | member
ACCOUNT_STATE       pending_activation | active | password_reset_required
                    | mfa_setup_required | locked | suspended | deactivated
TASK_STATUS         backlog | todo | in_progress | blocked | in_review
                    | revisions | done | cancelled
STATUS_CATEGORY     not_started | active | waiting | done | cancelled
PRIORITY            urgent | high | medium | low
EFFORT_SIZE         XS | S | M | L | XL
PROJECT_TYPE        event | client | business | self_promotion | other
PROJECT_CODE        EVT  | CLI    | BIZ      | PRM             | OTH
PROJECT_STATUS      planning | active | on_hold | completed | archived | cancelled
TIMER_STATE         not_started | running | paused | stopped
TIME_ENTRY_SOURCE   timer | manual | adjustment
EXTENSION_STATUS    pending | approved | partially_approved | declined | cancelled
DEPENDENCY_TYPE     blocks | relates_to
AVAILABILITY_TYPE   leave | holiday | half_day | unavailable
AUTH_PROVIDER       password | google | microsoft
MFA_TYPE            totp | webauthn | recovery_codes
THEME               light | dark | system
NOTIFICATION_CHANNEL in_app | email | push
```

### Numeric constants — define once
```
EFFORT_POINTS        XS=1  S=2  M=4  L=8  XL=16
PRIORITY_WEIGHT      urgent=1.5  high=1.25  medium=1.0  low=0.75
STATUS_LOAD_WEIGHT   backlog=0.25  todo=1.0  in_progress=1.0  blocked=1.0
                     in_review=0.5  revisions=1.0  done=0  cancelled=0
MINUTES_PER_POINT    60
SCORE_WEIGHTS        skill=0.40  availability=0.30  deadline=0.15
                     fairness=0.10  performance=0.05  project_familiarity=0.05
```

> ⚠️ **Score weights now total 1.05** because project familiarity (FR-117) was added in Session 02 without rebalancing. **Resolved in §9, C-06.**

---

## 5. System settings — the complete key list

Owner: doc 04. Editable per doc 03 §3.

| Key | Default | Editable by |
|---|---|---|
| `soft_threshold_pct` | 85 | Super Admin |
| `hard_threshold_pct` | 100 | Super Admin |
| `critical_threshold_pct` | 130 | Super Admin |
| `default_weekly_capacity` | **36** | Super Admin |
| `default_max_concurrent` | 5 | Super Admin |
| `workload_window` | `week` | Super Admin |
| `weight_skill` | 0.40 | Super Admin |
| `weight_availability` | 0.30 | Super Admin |
| `weight_deadline_fit` | 0.15 | Super Admin |
| `weight_fairness` | 0.10 | Super Admin |
| `weight_performance` | 0.05 | Super Admin |
| `weight_project_familiarity` | 0.05 | Super Admin |
| `other_work_warning_pct` | 15 | Admin |
| `project_type_priority` | `client,event,business,self_promotion,other` | Super Admin |
| `default_minutes_per_effort_point` | 60 | Admin |
| `timer_auto_pause_outside_hours` | true | Super Admin |
| `timer_idle_prompt_minutes` | 120 | Admin |
| `timer_idle_autopause_minutes` | 150 | Admin |
| `time_limit_warning_thresholds` | `50,75,90,100,120,150` | Admin |
| `over_limit_behaviour` | `enforced_stop_and_account` | Super Admin |
| `extension_approver_roles` | `admin,super_admin` | Super Admin |
| `require_reason_for_manual_time` | true | Super Admin |
| `failed_logins_to_lock` | **3** | Super Admin |
| `account_lock_auto_clear_minutes` | 30 | Super Admin |
| `recovery_code_ttl_minutes` | 15 | Super Admin |
| `activation_token_ttl_hours` | 48 | Super Admin |
| `require_mfa_on_privileged_reset` | true | Super Admin |
| `team_timezone` | `Asia/Karachi` | Super Admin |
| `working_days` | `mon,tue,wed,thu,fri,sat` | Super Admin |
| `working_hours_start` / `_end` | `09:00` / `17:00` | Super Admin |
| `digest_time` | `09:00` | Admin |
| `default_theme` | `system` | Admin |

---

## 6. Table registry — owner: doc 04

| Table | Purpose | Phase | Append-only |
|---|---|:--:|:--:|
| `users` | People and their roles | 1 | |
| `auth_identities` | Password + future SSO | 1 | |
| `invitations` | Activation & reset tokens | 1 | |
| `mfa_factors` | TOTP / passkeys | 1 | |
| `recovery_codes` | Printed backups | 1 | |
| `sessions` | Active sessions | 1 | |
| `login_attempts` | Rate limiting, lockout | 1 | ✅ |
| `security_events` | Security alert stream | 1 | ✅ |
| `break_glass` | Sealed master credential | 1 | |
| `audit_log` | Every privileged action | 1 | ✅ |
| `activity_log` | Per-entity history | 2 | ✅ |
| `skills` | Skills library | 1 | |
| `user_skills` | Proficiency per person | 1 | |
| `availability` | Leave and holidays | 4 | |
| `system_settings` | Configuration | 1 | |
| `projects` | Projects with types | 2 | |
| `project_members` | Materialised membership | 2 | |
| `statuses` | Configurable workflow | 2 | |
| `tasks` | The core table | 2 | |
| `task_skills` | Required skills | 2 | |
| `task_watchers` | Subscribers | 2 | |
| `task_dependencies` | Blocking relationships | 6 | |
| `checklist_items` | In-task ticks | 6 | |
| `comments` | Discussion | 2 | |
| `attachments` | Files | 2 | |
| `time_entries` | Timer segments | 2 | ✅ |
| `time_extension_requests` | Extension workflow | 2 | |
| `notifications` | Notification feed | 3 | |

> **Append-only tables have no UPDATE or DELETE grant for any role, including `super_admin`.** That property is what makes them evidence rather than decoration.

---

## 7. Decision registry

| ADR | Decision | Status |
|---|---|:--:|
| [001](decisions/ADR-001-tech-stack.md) | Next.js + TypeScript + Supabase + Tailwind + shadcn/ui on Vercel | ✅ |
| [002](decisions/ADR-002-four-role-model.md) | 4 roles; Super Admin immutable | ✅ |
| [003](decisions/ADR-003-member-data-isolation.md) | Members see only their own work | ✅ |
| [004](decisions/ADR-004-working-calendar-and-capacity.md) | Asia/Karachi, Mon–Sat 09:00–17:00, 36 pts | ✅ |
| [005](decisions/ADR-005-capacity-points-and-hard-block.md) | Capacity points, not task count; hard block real | ✅ |
| [006](decisions/ADR-006-projects-and-other-category.md) | Projects required; 5 types; Other rules | ✅ |
| [007](decisions/ADR-007-account-recovery.md) | Email one-time code recovery; 3-attempt lockout | ✅ |
| [008](decisions/ADR-008-single-tenant.md) | Single-tenant; no `organisation_id` | ✅ |
| [009](decisions/ADR-009-no-seeded-roster.md) | No seeded roster; Admin builds the team | ✅ |
| [010](decisions/ADR-010-task-time-limits.md) | Time limits, auto timers, Admin-only extensions | ✅ |
| [011](decisions/ADR-011-design-system.md) | Logo-derived palette; gold never semantic; light/dark for all | ✅ |

---

## 8. Question status

| State | IDs |
|---|---|
| ✅ Answered | 001, 002, 003, 004, 006, 008, 010, 012, 015, 022, 030, 034, 038, 041, 046 |
| 🟡 Open, default applies | 005, 007, 009, 011, 013, 014, 016, 017, 018, 019, 020, 021, 023, 024, 025, 026, 027, 028, 029, 031, 032, 033, 035, 036, 037, 039, 040, 042, 043, 044, 045, 047, 048 |
| 🆕 New this session | **049, 050, 051, 052, 053** — see [doc 18](18-DESIGN-SYSTEM-AND-BRANDING.md) §12 |

**None block Phase 1.**

---

## 9. ⚠️ Contradiction sweep — Session 04

Four sessions of accretion produced real conflicts. Every one found is listed with its resolution. **These resolutions are binding.**

| # | Conflict | Resolution |
|:--:|---|---|
| **C-01** | Doc 05 gave *In Progress* = amber and *Revisions* = orange. Brand gold is amber-adjacent (§3 doc 18). | ✅ **Doc 18 §5 wins.** In Progress → violet `#8B5CF6`; In Review → pink `#EC4899`; Revisions stays orange `#F97316`. Doc 05's colour column is superseded. |
| **C-02** | Doc 06 §4's worked example uses 40-point capacity; ADR-004 sets 36. | ✅ **36 is canonical.** The example is illustrative of *ratios* only and is labelled as such. All code and seed data use 36. |
| **C-03** | Doc 10 §1 navigation gives Members access to Tasks/Workload/Dashboard; ADR-003 forbids it. | ✅ **Doc 03 §4 wins.** Member nav = My Work · My Tasks · My Projects · My Profile. Doc 10 §1 is superseded. |
| **C-04** | "Team Lead" appears in docs 02, 05, 07, 10; ADR-002 renamed it. | ✅ **"Team Coordinator" everywhere.** Any remaining "Team Lead" means Team Coordinator. |
| **C-05** | FR-094 (time logging) overlaps FR-170…195 (timers). | ✅ **FR-094 is superseded by the doc 17 set.** `time_logs` is replaced by `time_entries`. One table, not two. |
| **C-06** | Assignment weights total **1.05** after project familiarity was added. | ✅ **Rebalanced to 1.00:** skill **0.38**, availability **0.28**, deadline fit **0.14**, fairness **0.09**, performance **0.05**, project familiarity **0.06**. Doc 07 §3 and §5 of this registry updated. |
| **C-07** | Doc 04's ERD diagram predates projects, timers and security tables. | ✅ Diagram marked as indicative; **§6 of this registry is the authoritative table list.** |
| **C-08** | Doc 16 §6 originally said "no email-only recovery"; ADR-007 makes email the primary path. | ✅ **ADR-007 wins**, with MFA required after the email code for Super Admin and Admin (FR-155b). Doc 16 §6 rewritten in Session 03. |
| **C-09** | Doc 09 §5 folder structure predates the projects, timer and theme modules. | ✅ **[Doc 20](20-IMPLEMENTATION-CONTRACTS.md) §3 is the authoritative structure.** |
| **C-10** | Doc 02 FR-013 said default capacity 40; ADR-004 says 36. | ✅ **36.** Corrected in §2 above. |
| **C-11** | Doc 05 lists 5 max-concurrent as a *task count* limit while doc 06 makes points primary. | ✅ Both stand — points are primary, concurrent count is the **secondary** guard (FR-061). Not a contradiction, previously ambiguous wording. |
| **C-12** | Guest role appears in doc 04's `users.role` enum but was dropped by ADR-002. | ✅ **Removed.** ROLE enum in §4 is canonical — four values only. |

### The rule going forward
> Any new conflict is recorded here with a resolution **before** the affected code is written. This section is the arbitration record, and it is the only one.
