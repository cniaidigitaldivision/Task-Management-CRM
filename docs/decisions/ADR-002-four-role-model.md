# ADR-002 — Four-Role Model & Super Admin Immutability

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-002, [`../03-ROLES-AND-PERMISSIONS.md`](../03-ROLES-AND-PERMISSIONS.md), [`../16-SECURITY-AND-IDENTITY.md`](../16-SECURITY-AND-IDENTITY.md)

## Context
The original brief described three roles. Kashif is both a video editor and the team's coordinator — two jobs that don't fit one role. Session 01 proposed a "Team Lead" tier; the owner confirmed a fourth role and named it.

## Decision

**Four roles:**

| Role | Who | Scope |
|---|---|---|
| **Super Admin** | Brother | Total control. Manages Admin accounts. **Immutable by anyone else.** |
| **Admin** | Sister | Full operations. Creates and manages Coordinator and Member accounts. |
| **Team Coordinator** | Kashif | Assigns tasks, approves work, sees all tasks and workload. **No account management. No project creation. Cannot override capacity blocks.** |
| **Team Member** | Yusra + others | Own tasks only. |

The role formerly proposed as *Team Lead* is renamed **Team Coordinator** throughout all documentation.

**Super Admin immutability:** no account other than the Super Admin himself may edit, demote, suspend, lock or delete a Super Admin. There is no "promote to Super Admin" control anywhere in the application. Enforced at four independent layers:

1. PostgreSQL trigger on `users`
2. Row-Level Security policy
3. Server-side permission service
4. UI (presentation only — never counted as security)

The Super Admin also cannot delete, demote, suspend or lock **his own** account — preventing both accident and coercion.

## Why
- Kashif needs coordination authority without account-management power, which belongs to family.
- Concentrating irreversible authority in one immutable account gives a single, clear root of trust.
- Enforcing at the database level means an application bug cannot defeat the rule.

## Consequences
**Easier:** clear authority chain; no ambiguity about who can do what; the audit story is simple.
**Harder:** creates a single point of failure — if Super Admin access is lost, nobody can restore it. **This is why ADR-007 / Q-030 (break-glass recovery) is mandatory, not optional.** The immutability rule is only safe with a recovery path.
**Superseded:** the "Guest" role from session 01 is dropped from v1. Client-facing read-only access is deferred to Phase 7 (P-10).
