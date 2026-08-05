# 02 — Functional & Non-Functional Requirements

Every requirement has an ID. When we build, each one gets ticked in [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md).

> **Session 02 additions — requirements FR-100 to FR-162 live in their own documents:**
> - **FR-100 – FR-119** — Projects, project types, the "Other" category, Member Activity Preview → [`15-PROJECTS-AND-PROJECT-TYPES.md`](15-PROJECTS-AND-PROJECT-TYPES.md) §10
> - **FR-140 – FR-162** — Security, identity, credential provisioning, Super Admin hardening → [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) §14
> - **BR-011 – BR-016** — Project business rules → doc 15 §10
>
> **Amended by Session 02:** the role set is now **Super Admin · Admin · Team Coordinator · Team Member** (ADR-002). Every reference to "Team Lead" below means **Team Coordinator**. Members can no longer see other members' tasks or workload (ADR-003). Default weekly capacity is **36 points**, not 40 (ADR-004). Every task now requires a project (BR-011).

**Priority key:** `P0` = must exist for v1 to be usable · `P1` = v1 but can land late · `P2` = v2

---

## A. Authentication & Accounts

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | A user signs in with email + password. Sessions persist across browser restarts. | P0 |
| FR-002 | Passwords are hashed; a password reset flow exists via email link. | P0 |
| FR-003 | There is exactly one Super Admin seeded at setup; only a Super Admin can create another. | P0 |
| FR-004 | Users are invited by Admin/Super Admin via email; the invitee sets their own password on first login. | P0 |
| FR-005 | A user's session is bound to their role; role changes take effect on next request, not next login. | P1 |
| FR-006 | Deactivated users cannot log in, but their historical tasks and comments remain visible. | P0 |
| FR-007 | Optional 2FA (TOTP) for Admin and Super Admin accounts. | P2 |

## B. Team & Member Management

| ID | Requirement | Priority |
|---|---|---|
| FR-010 | Admin/Super Admin can add a new team member: name, email, role title, skills, weekly capacity, avatar. | P0 |
| FR-011 | Adding a member is a form — **no code change, no redeploy**. New member is immediately assignable. | P0 |
| FR-012 | Each member has a **role title** (e.g. "Video Editor") and a set of **skill tags with proficiency 1–5** (e.g. `video-editing:5`, `motion-graphics:3`). | P0 |
| FR-013 | Each member has a **weekly capacity** in capacity points (default 40) editable by Admin. Part-timers get less. | P0 |
| FR-014 | Each member has an **availability calendar**: leave days, holidays, half-days. Capacity for those days is reduced or zeroed. | P1 |
| FR-015 | Admin can deactivate (not hard-delete) a member. Their open tasks are flagged for reassignment. | P0 |
| FR-016 | Super Admin can promote/demote roles (Member ↔ Team Lead ↔ Admin). | P0 |
| FR-017 | A "Skills library" is editable by Admin — add/rename skill tags used across the system. | P1 |

## C. Task Creation & Management

| ID | Requirement | Priority |
|---|---|---|
| FR-020 | Any user can create a task. A Member's self-created task defaults to being assigned to themselves. | P0 |
| FR-021 | Task fields: title, description (rich text), assignee, status, priority, effort estimate, due date, start date, required skills, tags, project/client, attachments, watchers. | P0 |
| FR-022 | Admin/Super Admin/Team Lead can assign a task to **any** member. | P0 |
| FR-023 | Admin/Super Admin can **reassign** a task; the previous assignee is notified and it is logged. | P0 |
| FR-024 | Admin/Super Admin can **delete** a task (soft delete → Trash). Super Admin can purge permanently. | P0 |
| FR-025 | A Member can edit the fields of their own task (description, checklist, attachments) but **cannot** change assignee, priority, or due date on a task assigned *to* them by an Admin. | P0 |
| FR-026 | Subtasks: a task can have child tasks, each independently assignable and statused. | P1 |
| FR-027 | Checklists: lightweight tick-items inside a task, not separate tasks. | P1 |
| FR-028 | Dependencies: task B can be marked "blocked by" task A. B cannot enter *In Progress* until A is *Done* (soft warning, overridable). | P1 |
| FR-029 | Recurring tasks: daily/weekly/monthly templates that auto-generate (e.g. "Post weekly ad report every Monday"). | P1 |
| FR-030 | Task templates: save a task shape (title pattern, checklist, required skills, estimate) and spawn from it in one click. | P1 |
| FR-031 | Bulk actions: multi-select tasks → change status, reassign, set due date, delete. | P1 |
| FR-032 | Every task has a unique short reference (e.g. `CNI-142`) usable in conversation. | P1 |

## D. Statuses & Workflow

| ID | Requirement | Priority |
|---|---|---|
| FR-040 | The status set is: **Backlog → To Do → In Progress → Blocked → In Review → Revisions → Done**, plus **Cancelled**. Full definitions in [`05`](05-TASK-LIFECYCLE-AND-STATUSES.md). | P0 |
| FR-041 | Members can move their own tasks through statuses, with the transition rules in doc 05 enforced. | P0 |
| FR-042 | Only Admin/Super Admin/Team Lead can move a task from *In Review* → *Done*, or → *Revisions*. A member cannot mark their own work approved. | P0 |
| FR-043 | Moving to *Blocked* requires a mandatory reason. | P0 |
| FR-044 | The status set itself is editable by Super Admin (add/rename/reorder/recolour). | P2 |
| FR-045 | Every status change is timestamped and logged with the actor. | P0 |

## E. Smart Assignment (the intelligence)

| ID | Requirement | Priority |
|---|---|---|
| FR-050 | When creating/assigning a task, the system shows a **ranked list of recommended assignees** with a match score. | P0 |
| FR-051 | Each recommendation shows a **plain-English reason**: skill match, current utilisation, active task count, and whether they can hit the deadline. | P0 |
| FR-052 | Recommendation is never auto-applied. The Admin always clicks to confirm. | P0 |
| FR-053 | Members already **over the soft threshold** appear with an amber warning; members over the **hard threshold** are shown but require an explicit override with a typed reason. | P0 |
| FR-054 | If nobody is available, the system says so plainly and suggests options: extend the deadline, split the task, or lower another task's priority. | P0 |
| FR-055 | Requesting a recommendation without a skill tag falls back to keyword-matching the task title/description against skill names. | P1 |
| FR-056 | A **Rebalance Advisor** detects lopsided distribution and proposes specific moves ("Move CNI-131 from Yusra to Ali — frees 6 pts, Ali is at 38%"). | P1 |
| FR-057 | The scoring weights are configurable by Super Admin (skill vs. load vs. deadline vs. fairness). | P2 |

## F. Workload & Capacity

| ID | Requirement | Priority |
|---|---|---|
| FR-060 | Workload is measured in **capacity points**, derived from effort estimate × priority weight — not a raw task count. See [`06`](06-WORKLOAD-CAPACITY-ENGINE.md). | P0 |
| FR-061 | A secondary guard limits **concurrent active tasks** per member (default 5, configurable). | P0 |
| FR-062 | Thresholds are configurable: soft warning (default 85% utilisation), hard block (default 100%). | P0 |
| FR-063 | A **Workload view** shows every member as a bar: current load / capacity, colour-coded green/amber/red. | P0 |
| FR-064 | Workload is calculated over a rolling window (default: current week), configurable. | P1 |
| FR-065 | Leave/holiday reduces that member's capacity for the affected period automatically. | P1 |
| FR-066 | The system flags **sustained overload** (red for 3+ consecutive days) to Admins proactively. | P1 |

## G. Real-time & Notifications

| ID | Requirement | Priority |
|---|---|---|
| FR-070 | Task creates, updates, status changes, comments, and assignments propagate live to all connected clients — no refresh. | P0 |
| FR-071 | In-app notification centre with unread badge. | P0 |
| FR-072 | A member is notified when: a task is assigned to them, their task is commented on, they are @mentioned, their task is due soon/overdue, their task is sent to Revisions. | P0 |
| FR-073 | Admins are notified when: a task enters *In Review*, a task goes *Blocked*, a task becomes overdue, a member crosses the overload threshold. | P0 |
| FR-074 | Email notifications for high-signal events, with per-user preferences to mute categories. | P1 |
| FR-075 | Optional WhatsApp/Telegram push for assignment + overdue. **See Q-011.** | P2 |
| FR-076 | Daily digest at a configured time: "Your day — 3 tasks due, 1 overdue, 1 awaiting your review." | P1 |

## H. Views, Search & Reporting

| ID | Requirement | Priority |
|---|---|---|
| FR-080 | **My Work** view — the default landing page for a Member. Today / This week / Overdue / In review. | P0 |
| FR-081 | **List view** with sort + filter (assignee, status, priority, due date, tag, project). | P0 |
| FR-082 | **Board (Kanban) view** grouped by status, drag-and-drop to change status. | P0 |
| FR-083 | **Calendar view** by due date. | P1 |
| FR-084 | **Workload view** (see FR-063). | P0 |
| FR-085 | **Admin dashboard**: totals by status, overdue count, per-member load, tasks needing review, recent activity. | P0 |
| FR-086 | Global search across task titles, descriptions, and comments. | P1 |
| FR-087 | Saved filters / custom views per user. | P2 |
| FR-088 | Reports: completion rate, on-time %, average cycle time per member and per task type, revision rate. | P1 |
| FR-089 | Export a filtered task list to CSV. | P2 |

## I. Collaboration & Records

| ID | Requirement | Priority |
|---|---|---|
| FR-090 | Threaded comments on each task, with @mention of any member. | P0 |
| FR-091 | File attachments on tasks and comments (images, video previews, docs). | P0 |
| FR-092 | Full activity timeline on each task: created, assigned, status changes, edits, comments. | P0 |
| FR-093 | System-wide **audit log** (who did what, when) visible to Super Admin. | P1 |
| FR-094 | Time tracking: log actual hours against a task; compare to estimate. Feeds capacity accuracy over time. | P1 |
| FR-095 | Trash / archive with restore, retained for 30 days before purge eligibility. | P1 |

---

## J. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Page load (first meaningful paint) | < 2s on average connection |
| NFR-002 | Interaction response (status change, filter) | < 300ms perceived (optimistic UI) |
| NFR-003 | Real-time propagation latency | < 2s end-to-end |
| NFR-004 | Uptime | Best-effort on managed hosting; no on-call requirement |
| NFR-005 | Data durability | Automated daily database backup, 7-day retention minimum |
| NFR-006 | Security | Role checks enforced **server-side**, never only in the UI. Row-level security on the database. |
| NFR-007 | Mobile | Fully usable on a 375px-wide screen. No horizontal scrolling. |
| NFR-008 | Accessibility | Keyboard-navigable, sufficient colour contrast, status never conveyed by colour alone |
| NFR-009 | Auditability | Every destructive or permission-sensitive action is logged and attributable |
| NFR-010 | Extensibility | Adding a role, status, or skill requires configuration only, not a deploy |

---

## K. Business Rules (referenced by the engines)

| ID | Rule |
|---|---|
| BR-001 | A task must have exactly one assignee (watchers are separate). |
| BR-002 | A member cannot approve their own work (*In Review* → *Done* requires Lead/Admin). |
| BR-003 | Assignment above the **hard threshold** is blocked unless overridden with a typed reason by Admin/Super Admin. |
| BR-004 | Assignment above the **soft threshold** shows a warning but proceeds. |
| BR-005 | A member on approved leave is excluded from recommendations for the leave period. |
| BR-006 | A deactivated member cannot be assigned new tasks. |
| BR-007 | Deleting a member never deletes their task history. |
| BR-008 | A task with unfinished blocking dependencies warns on entering *In Progress*. |
| BR-009 | Overdue is calculated at end-of-day in the team's configured timezone. |
| BR-010 | Effort estimate is mandatory for any task an Admin assigns to someone else (otherwise capacity maths is meaningless). |
