# ADR-003 — Member Data Isolation

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-003, [`../03-ROLES-AND-PERMISSIONS.md`](../03-ROLES-AND-PERMISSIONS.md), [`../16-SECURITY-AND-IDENTITY.md`](../16-SECURITY-AND-IDENTITY.md) §7

## Context
Session 01 asked whether members should see each other's tasks and workload, and recommended full transparency. The owner chose privacy: members cannot see each other.

## Decision
**Team Members see only their own work.**

| Data | Member can see |
|---|---|
| Tasks | Only where they are the assignee |
| Workload / capacity / utilisation | Only their own |
| Projects | Only projects containing at least one of their own tasks |
| Other users | Name and avatar only — **no role, no job title, no skills, no capacity, no workload** |
| Comments | Only on tasks they can see |
| Time logs | Only their own |
| Team workload view | ❌ No access |
| Member Activity Preview | ❌ No access |
| Dashboards & reports | ❌ No access (own performance metrics only — Q-018) |
| Activity log / audit log | ❌ No access |

Enforced by PostgreSQL Row-Level Security, not by hiding UI. The navigation for a Member contains only **My Work**, **My Tasks**, and **My Projects**.

Admin, Super Admin, and Team Coordinator retain full visibility across all tasks, members, and workload.

## Why
Owner's decision. The reasoning is reasonable for a small team: workload numbers and skill proficiency ratings are sensitive information, and visible comparison between colleagues can create friction rather than accountability.

## Consequences
**Easier:** privacy; no inter-member comparison; a simpler, less cluttered interface for the six people who use it most.

**Harder — and worth stating honestly:**
- The self-balancing effect of visible workload is lost. Fairness now depends entirely on Admin and Coordinator attention, which makes the Rebalance Advisor (doc 06 §5) and the Member Activity Preview (doc 15 §6) *more* important, not less — they become the only mechanism by which imbalance gets noticed.
- Members cannot see who else is on a shared project, which reduces peer coordination. Mitigated by @mentions and watchers still working across visible tasks.
- Task dependencies across members need care: a member must be able to see *that* they are blocked without seeing the blocking task's full detail. Resolved by showing a minimal reference ("waiting on EVT-141, assigned to a teammate") — **flagged as Q-037.**

**Reversible:** switching to full transparency later is a change to RLS policies and navigation, not a data migration. Low cost to revisit after the team has used the system.
