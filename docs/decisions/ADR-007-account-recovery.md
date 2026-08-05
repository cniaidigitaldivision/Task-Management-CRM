# ADR-007 — Account Recovery & Lockout

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Supersedes:** Q-030's original A/B/C options
**Relates to:** [`../16-SECURITY-AND-IDENTITY.md`](../16-SECURITY-AND-IDENTITY.md) §6

## Context
[ADR-002](ADR-002-four-role-model.md) makes the Super Admin unmanageable by any other account. That closed a security hole and opened an availability one: with no recovery path, a lost password plus a lost phone would permanently destroy access to the CRM. Session 02 offered three break-glass options. The owner proposed a different and better answer.

## Decision

**1. "Forgot password" exists for all four roles** — Super Admin, Admin, Team Coordinator, Team Member.

The flow:
1. User clicks *Forgot password*, enters their email.
2. Response is always *"If that email is registered, a code has been sent"* — constant time, never confirms whether an account exists.
3. Email contains a **6-digit one-time code and a click-link**. Either works. 15-minute expiry, single use, stored only as a SHA-256 hash, max 5 entry attempts, superseded by any newer request.
4. **Super Admin and Admin additionally provide their authenticator code or passkey** before the reset screen opens (Q-039).
5. New password set — breach-checked, blocklisted, not among the last 5.
6. All existing sessions revoked.
7. Confirmation email with IP and location. Super Admin resets also alert every Admin.

**2. Three failed sign-in attempts locks the account.**
- Attempt 2 warns that one attempt remains.
- Attempt 3 locks it and offers *"Send unlock code to my email"* — the same code flow, which unlocks and moves to a password reset.
- The account owner is emailed immediately with the attempting IP and location.
- An Admin can also unlock a Coordinator or Member directly.
- The lock auto-clears after 30 minutes (Q-048).

**3. Two backstops for the case where email itself is unreachable:** 10 printed single-use recovery codes, and a sealed master credential shown once at setup and stored physically.

## Why
The owner's design solves the availability problem cleanly and uses a flow every user already understands, which matters more than elegance — an unfamiliar recovery process is one nobody completes under stress.

**On the added second factor:** email-only recovery for the most privileged account means a compromised mailbox is a compromised CRM (threat T-3, and the most common route to small-business account takeover). Requiring the authenticator after the email code costs one extra tap for two people who are already required to carry MFA, and removes the threat entirely. The owner's flow is otherwise unchanged.

**On 3 attempts rather than 5:** stricter than the original plan, and acceptable because self-service unlock is one email away. The denial-of-service risk that a 3-strike rule normally creates — anyone who knows an email can lock that account — is mitigated by per-IP throttling, self-service unlock, a 30-minute auto-clear, and counting attempts from recognised devices separately.

## Consequences
**Easier:** no permanent lockout scenario; no Admin involvement needed for routine password resets; a locked account is a 30-second inconvenience rather than a support ticket.
**Harder:** email deliverability becomes operationally important — if recovery emails land in spam, recovery fails. Mitigated by a proper transactional email provider with SPF, DKIM and DMARC configured in Phase 1.
**Residual risk:** for Coordinators and Members, a compromised mailbox is sufficient to take the account. Accepted — the blast radius is one person's own tasks, and they cannot see anyone else's data (ADR-003).
