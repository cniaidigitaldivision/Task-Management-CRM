# 03 — Roles & Permissions

**Updated:** 2026-08-06 (Session 02) — role model finalised per [`decisions/ADR-002`](decisions/ADR-002-four-role-model.md) and [`decisions/ADR-003`](decisions/ADR-003-member-data-isolation.md)

---

## 1. The four roles — LOCKED

```
╔══════════════════════════════════════════════════════════════════╗
║  🔐 SUPER ADMIN                                    (your brother) ║
║  ────────────────────────────────────────────────────────────────║
║  Total control. Manages Admin accounts.                          ║
║  ⚠️ CANNOT be edited, demoted, suspended or deleted by ANY       ║
║     other account. Only he can change his own credentials.       ║
║  ⚠️ Cannot delete or demote his OWN account either — prevents    ║
║     accident and coercion. Recovery is via break-glass (Q-030).  ║
║  Mandatory MFA that nobody, including himself, can disable.      ║
╚══════════════════════════════════════════════════════════════════╝
                              ▲ creates & manages
┌──────────────────────────────────────────────────────────────────┐
│  👤 ADMIN                                          (your sister)  │
│  Full day-to-day operational control.                            │
│  Creates and manages Coordinator and Member accounts.            │
│  Creates and manages projects. Can override capacity blocks.     │
│  Managed only by the Super Admin. Mandatory MFA.                 │
└──────────────────────────────────────────────────────────────────┘
                              ▲ creates & manages
┌──────────────────────────────────────────────────────────────────┐
│  🎯 TEAM COORDINATOR                                    (Kashif)  │
│  Assigns tasks, reviews and approves work, sees all tasks        │
│  and the full team workload.                                     │
│  ❌ No account management. ❌ No project creation.                │
│  ❌ Cannot override a capacity block. ❌ Cannot delete tasks.     │
│  Is also a working member with his own tasks and workload.       │
└──────────────────────────────────────────────────────────────────┘
                              ▲ created by Admin+
┌──────────────────────────────────────────────────────────────────┐
│  👥 TEAM MEMBER                                 (Yusra + others)  │
│  Own tasks only. Creates own tasks, updates own statuses,        │
│  comments, attaches files, logs time.                            │
│  🔒 Cannot see other members' tasks, roles, skills, capacity     │
│     or workload. (ADR-003)                                       │
└──────────────────────────────────────────────────────────────────┘
```

Each level inherits the capabilities below it, except where explicitly denied.

---

## 2. Super Admin — the special rules

> *"The super admin can never be altered or managed by anyone else rather than the super admin himself."*

### Enforced at four independent layers

| Layer | Mechanism |
|---|---|
| 1. **Database trigger** | A `BEFORE UPDATE OR DELETE` trigger on `users` rejects any change to a `super_admin` row where the acting identity ≠ that row's id. Fires even if application code is wrong. |
| 2. **Row-Level Security** | Postgres policy restricting writes on `super_admin` rows to the row's owner. |
| 3. **Server authorisation** | Permission service check before any mutation reaches the database. |
| 4. **UI** | Controls don't render. *Presentation only — never counted as security.* |

### Absolute rules

| Rule | Detail |
|---|---|
| **No external management** | No account can edit, rename, demote, suspend, lock, or delete a Super Admin. |
| **No promotion path** | There is no "make Super Admin" control anywhere in the application. A second Super Admin can only be created through the sealed procedure in [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) §6. |
| **No self-destruction** | The Super Admin cannot delete, demote, suspend, or lock his own account. |
| **Unremovable MFA** | Cannot be disabled by anyone, including himself. |
| **Immutable audit** | Every Super Admin action is written to an append-only log that even he cannot alter. |
| **Login alerts** | Email and in-app alert on every single sign-in to the account. |
| **Recovery** | Only via the break-glass procedure (Q-030). Email-only reset can never restore access on its own. |

---

## 3. Full permission matrix

Legend: ✅ allowed · ⚠️ allowed with condition · ❌ denied · 🔒 requires step-up re-authentication

### Account & team management

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Create an Admin account | ✅ 🔒 | ❌ | ❌ | ❌ |
| Edit / suspend / delete an Admin | ✅ 🔒 | ❌ | ❌ | ❌ |
| Create a Coordinator or Member account | ✅ | ✅ | ❌ | ❌ |
| Edit a Coordinator or Member profile | ✅ | ✅ | ⚠️ own only | ⚠️ own only |
| Set capacity, skills, max concurrent tasks | ✅ | ✅ | ❌ | ❌ |
| Deactivate a Coordinator or Member | ✅ | ✅ | ❌ | ❌ |
| Permanently purge a user record | ✅ 🔒 | ❌ | ❌ | ❌ |
| Change a user's role (Member ↔ Coordinator) | ✅ 🔒 | ✅ 🔒 | ❌ | ❌ |
| Promote anyone to Admin | ✅ 🔒 | ❌ | ❌ | ❌ |
| Promote anyone to Super Admin | ❌ *(no such control exists)* | ❌ | ❌ | ❌ |
| **Edit anything about a Super Admin** | ⚠️ **self only** 🔒 | ❌ | ❌ | ❌ |
| Resend an activation invitation | ✅ | ✅ | ❌ | ❌ |
| Force a password reset on another user | ✅ | ⚠️ Coordinator/Member only | ❌ | ❌ |
| Reset another user's MFA | ✅ 🔒 | ⚠️ Coordinator/Member only 🔒 | ❌ | ❌ |
| View another user's profile | ✅ | ✅ | ✅ | ⚠️ **name + avatar only** |

### Projects

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Create a project | ✅ | ✅ | ❌ | ❌ |
| Set / change the project type | ✅ | ✅ | ❌ | ❌ |
| Edit project details | ✅ | ✅ | ❌ | ❌ |
| Change project status (hold, complete, archive) | ✅ | ✅ | ❌ | ❌ |
| Delete a project | ✅ 🔒 | ⚠️ soft delete only | ❌ | ❌ |
| View all projects | ✅ | ✅ | ✅ | ❌ |
| View projects they have a task in | ✅ | ✅ | ✅ | ✅ |
| Create tasks inside a project | ✅ | ✅ | ✅ | ⚠️ own tasks, in projects they're already on |
| Promote an "Other" task to a real project | ✅ | ✅ | ❌ | ❌ |

### Tasks

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Create a task for self | ✅ | ✅ | ✅ | ✅ |
| Create a task for someone else | ✅ | ✅ | ✅ | ❌ |
| Assign / reassign a task | ✅ | ✅ | ✅ | ❌ |
| **Override a hard capacity block** | ✅ | ✅ | ❌ | ❌ |
| Edit task title / description | ✅ | ✅ | ✅ | ⚠️ own tasks |
| Edit priority / due date / effort | ✅ | ✅ | ✅ | ⚠️ self-created only |
| Change status of own task | ✅ | ✅ | ✅ | ✅ |
| Change status of anyone's task | ✅ | ✅ | ✅ | ❌ |
| Approve *In Review* → *Done* | ✅ | ✅ | ✅ | ❌ (BR-002) |
| Send back to *Revisions* | ✅ | ✅ | ✅ | ❌ |
| Cancel / archive a task | ✅ | ✅ | ✅ | ⚠️ self-created only |
| Soft-delete a task (→ Trash) | ✅ | ✅ | ❌ | ❌ |
| Permanently purge a task | ✅ 🔒 | ❌ | ❌ | ❌ |
| Restore from Trash | ✅ | ✅ | ❌ | ❌ |
| Comment & attach files | ✅ | ✅ | ✅ | ⚠️ on own tasks |
| Log time | ✅ | ✅ | ✅ | ⚠️ own tasks |

### Task time limits & extensions — [doc 17](17-TASK-TIMERS-AND-TIME-LIMITS.md), [ADR-010](decisions/ADR-010-task-time-limits.md)

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Set a task's time limit | ✅ | ✅ | ✅ | ❌ |
| Edit the limit before work starts | ✅ | ✅ | ✅ | ❌ |
| Edit the limit after work has started | ✅ | ✅ | ❌ | ❌ |
| **Grant a time extension** | ✅ | ✅ | ❌ | ❌ |
| Decline an extension (reason required) | ✅ | ✅ | ❌ | ❌ |
| Request an extension | ✅ own | ✅ own | ✅ own | ✅ own |
| See pending extension requests | ✅ | ✅ | ⚠️ read-only (Q-045) | ⚠️ own only |
| Start / pause own timer | ✅ | ✅ | ✅ | ✅ |
| Pause someone else's timer | ✅ | ✅ | ✅ | ❌ |
| Manually adjust own logged time | ✅ | ✅ | ⚠️ reason required, flagged | ⚠️ reason required, flagged |
| Adjust someone else's logged time | ✅ | ✅ | ❌ | ❌ |
| See anyone's time data | ✅ | ✅ | ✅ | ❌ (ADR-003) |

> **The key split:** the Coordinator sets the budget, the Admin decides whether to spend more. Setting a limit is planning; extending it is a cost decision.

### Visibility — reflects ADR-003

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| See all tasks of all members | ✅ | ✅ | ✅ | ❌ |
| See own tasks | ✅ | ✅ | ✅ | ✅ |
| See the team workload view | ✅ | ✅ | ✅ | ❌ |
| See own workload / utilisation | ✅ | ✅ | ✅ | ✅ |
| See another member's role or job title | ✅ | ✅ | ✅ | ❌ |
| See another member's skills or capacity | ✅ | ✅ | ✅ | ❌ |
| **Open the Member Activity Preview** | ✅ | ✅ | ⚠️ read-only | ❌ |
| See the admin dashboard | ✅ | ✅ | ⚠️ read-only | ❌ |
| See per-member performance reports | ✅ | ✅ | ⚠️ read-only | ⚠️ own only (Q-018) |
| See the Rebalance Advisor | ✅ | ✅ | ⚠️ read-only | ❌ |
| See the system audit log | ✅ 🔒 | ⚠️ read-only, own scope | ❌ | ❌ |
| See the security dashboard | ✅ 🔒 | ❌ | ❌ | ❌ |

### System settings

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Change capacity thresholds | ✅ 🔒 | ❌ | ❌ | ❌ |
| Change the default weekly capacity | ✅ 🔒 | ❌ | ❌ | ❌ |
| Edit the status workflow | ✅ 🔒 | ❌ | ❌ | ❌ |
| Edit the skills library | ✅ | ✅ | ❌ | ❌ |
| Tune assignment scoring weights | ✅ 🔒 | ❌ | ❌ | ❌ |
| Set the "Other" work threshold | ✅ | ✅ | ❌ | ❌ |
| Set project-type rebalance priority | ✅ 🔒 | ❌ | ❌ | ❌ |
| Configure notification defaults | ✅ | ✅ | ❌ | ❌ |
| Manage own notification preferences | ✅ | ✅ | ✅ | ✅ |
| Change security settings | ✅ 🔒 | ❌ | ❌ | ❌ |
| Export / back up all data | ✅ 🔒 | ❌ | ❌ | ❌ |
| View own active sessions & revoke them | ✅ | ✅ | ✅ | ✅ |

---

## 4. What each role actually sees in the navigation

| | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| My Work | ✅ | ✅ | ✅ | ✅ |
| Tasks (all) | ✅ | ✅ | ✅ | ❌ *(sees "My Tasks")* |
| Projects | ✅ all | ✅ all | ✅ all | ⚠️ own only |
| Workload | ✅ | ✅ | ✅ | ❌ |
| Dashboard | ✅ | ✅ | ⚠️ read-only | ❌ |
| Team | ✅ | ✅ | ❌ | ❌ |
| Reports | ✅ | ✅ | ⚠️ read-only | ❌ |
| Settings | ✅ full | ⚠️ partial | ❌ | ⚠️ own profile only |
| Security | ✅ | ❌ | ❌ | ❌ |
| Trash | ✅ | ✅ | ❌ | ❌ |

A Member's sidebar contains four items: **My Work · My Tasks · My Projects · My Profile.** Nothing else exists for them.

---

## 5. Safety rules that override the matrix

| Rule | Description |
|---|---|
| **Super Admin immutability** | §2. Absolute, enforced at four layers. |
| **No self-elevation** | No account can change its own role, at any level. |
| **No self-approval** | Nobody can approve a task where they are the assignee — including Coordinators and Admins. Their own work escalates one level up. (BR-002) |
| **Server-side enforcement** | Every permission is checked on the server **and** at the database row level. A hidden button is not a security control. (NFR-006) |
| **Override is on record** | Every capacity override, forced reassignment, role change and permanent delete is written to the immutable audit log with actor, timestamp, IP, and typed reason. |
| **Deactivation ≠ deletion** | Removing someone preserves all their tasks, comments, and time logs. (BR-007) |
| **Step-up for sensitive actions** | Every 🔒 action requires password + MFA re-entry even inside a valid session. |
| **Last Admin protection** | The system refuses to deactivate the final remaining Admin while a Super Admin does not exist to replace them. |

---

## 6. Account provisioning chain

**The system ships empty except for the Super Admin** ([ADR-009](decisions/ADR-009-no-seeded-roster.md)). No team data is pre-loaded. The Admin builds the team through the application — role, email, job title, skills, proficiency, capacity, and concurrent-task limit.

```
 Super Admin ──creates──▶ Admin ──creates──▶ Coordinator
                                └──creates──▶ Member
```

Full flow, token handling, and the reasoning behind never emailing a password: [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) §3.

**Summary of the flow:**
1. The creator fills a form: name, email, role, job title, capacity, skills.
2. The account is created in `PENDING_ACTIVATION` with **no password at all**.
3. A single-use, 48-hour activation link is emailed. **The email contains the login email and a link — never a password.**
4. The invitee clicks it, sets their own password, and (for privileged roles) enrols MFA before reaching any other screen.
5. The account becomes `ACTIVE`. The creator is notified.

**Forgotten passwords and lockouts** — every role has self-service recovery ([ADR-007](decisions/ADR-007-account-recovery.md)):
- *Forgot password* → emailed 6-digit one-time code + link → reset. Super Admin and Admin also provide MFA after the code.
- **3 failed sign-in attempts locks the account.** Cleared by an emailed unlock code, or by an Admin for Coordinators and Members. Auto-clears after 30 minutes.
- Every reset revokes all sessions and emails a confirmation with IP and location.

---

## 7. What happens when a member is removed

1. Admin clicks **Deactivate**.
2. The system lists their open tasks and **forces a decision on each**: reassign (with smart recommendations for the replacement), or return to the project backlog.
3. All their sessions are revoked immediately.
4. The account can no longer sign in.
5. Historical tasks, comments and time logs remain, attributed to them, marked *(inactive)*.
6. Their capacity is removed from all team workload calculations from that date forward.
7. Only the Super Admin can purge the record entirely — and purging anonymises history rather than deleting it.
