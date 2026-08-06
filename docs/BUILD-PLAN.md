# 🏗️ BUILD PLAN — finishing the system

> **Purpose.** The owner's instruction (2026-08-07): *"completely and fully build
> the system, replace the placeholders… build each and every function for every
> role every user… ask for my permission on every step."*
>
> This file is the running checklist. **It is updated at the end of every step**,
> so a fresh session can read it and know exactly where to pick up without
> re-reading the chat.
>
> Design and visual work is explicitly **out of scope here** — the owner will
> give a new look separately, and called it *"customization and has nothing to do
> with our original system conventions and features."*

---

## 📍 STATUS

| | |
|---|---|
| **Live** | https://cni-crm.vercel.app — auto-deploys on push to `main` |
| **Current step** | — awaiting go-ahead for **Step 1** |
| **Last updated** | 2026-08-07 |

**Progress:** ⬜⬜⬜⬜⬜⬜⬜⬜ 0 of 8 steps

---

## 🔍 WHAT IS ACTUALLY MISSING — the honest inventory

Measured, not guessed: one screen is still a placeholder, and eight database
tables have no write path in the application at all.

| Table | Built for | Reachable from the app? |
|---|---|:--:|
| `invitations` | Adding a team member | ❌ nothing writes it |
| `audit_log` | The privileged-action trail | ❌ nothing reads it |
| `system_settings` | Editable configuration | ❌ nothing writes it |
| `task_dependencies` | "This blocks that" | ❌ |
| `task_watchers` | Following work you are not assigned | ❌ |
| `task_skills` | What a task needs, for matching | ❌ |
| `time_extension_requests` | Asking for more time | ❌ seeded only |
| `attachments` | Files on a task | ❌ read path only |

Plus `/security`, the last remaining placeholder screen.

---

## 🎯 WHAT EACH ROLE WILL BE ABLE TO DO WHEN THIS IS FINISHED

Straight from doc 03 §3. **Bold = does not exist yet.**

### Super Admin
Everything an Admin can, plus: **create and manage Admins** · **edit every system
setting** (thresholds, capacity, scoring weights, workflow) · **view the full
audit log including Admin actions** · **break-glass status** · cannot be edited,
demoted or locked by anybody, including themselves.

### Admin
**Create, deactivate and reactivate people** · **change roles below their own** ·
**force a password reset** · **reset somebody's MFA** · set capacity, concurrency
and skills · create and edit projects · assign any task to anybody ·
**override a capacity block in writing** *(built)* · **approve time extensions** ·
approve or reject work in review · **view the audit log except Super Admin
entries** · **edit the skills library**.

### Team Coordinator
See the whole board · create tasks and assign them to anybody · set time limits
(**but never extend them**) · approve or reject work in review — **never their
own** · cancel tasks · see everyone's workload · **cannot** create projects,
manage people, or override a capacity block.

### Team Member
See **only their own** work · create tasks for themselves · move their own tasks
through the workflow · comment, checklist, track time · **request a time
extension** · **watch a task** · edit their own profile and appearance · sees
nobody else's tasks, workload, capacity or role.

---

## 📋 THE STEPS

Each ends with something usable, a passing `npm run verify`, a commit, and this
file updated. **Nothing starts without the owner's go-ahead.**

---

### ⬜ Step 1 · Adding people — the invitation chain
**The single thing between a demo and your team using this.**

- Admin creates a person: name, email, role, job title, capacity
- A hashed, single-use invitation token, valid 48 hours (the raw token is never stored — the database already enforces that)
- Activation page: the invitee sets **their own** password, enrols an authenticator if their role requires one
- Resend the invitation · revoke it · see who has not accepted
- Deactivate and reactivate somebody (never delete — BR-007)
- Change a role, with the rules enforced: an Admin cannot mint another Admin, nobody can change their own role, the Super Admin cannot be touched

**Needs from you:** the Resend key in `.env.local` **and** in Vercel. Until then,
invitation links appear on screen for copying rather than being emailed — which
is enough to test the whole flow.

**⚠️ Worth knowing now:** Resend's free `onboarding@resend.dev` sender only
delivers to the address that owns the Resend account. Your real team cannot be
emailed until a domain of yours is verified.

---

### ⬜ Step 2 · Email
- Resend wired in, with templates: invitation, password reset, unlock, login alert, capacity warning
- `/forgot-password` connected end to end — the code is emailed, verified, the password changes, every session is revoked
- The 3-strike account lock emails an unlock code
- Every email in the light palette, plain-text fallback

**Needs from you:** the Resend key. Ideally also a verified domain, or the team cannot be onboarded by email.

---

### ⬜ Step 3 · The Security screen — the last placeholder
- Your live sessions, with device and location, and **sign out everywhere**
- Recent sign-ins and failed attempts
- The audit log, searchable — Admins see everything except Super Admin entries
- Locked accounts, and unlocking them
- Break-glass status

---

### ⬜ Step 4 · Hardening
- **Encrypt the authenticator secrets.** `MFA_ENCRYPTION_KEY` is set and read by nothing; the secrets are plaintext today, so database access is enough to mint 2FA codes
- Step-up re-authentication before the dangerous actions (FR-149)
- Per-IP rate limiting on sign-in
- Reset somebody's MFA (Admin, on people below them)
- Regenerate your own recovery codes
- **`npm run demo:code` gets deleted here** — it only works because of the plaintext gap

---

### ⬜ Step 5 · Settings you can actually change
- Every value on the Settings screen becomes editable, by the role doc 03 permits
- Written to `system_settings` as overrides, with the defaults still the fallback
- Scoring weights validated to total exactly 1.00 before saving *(they were once 1.05 and silently inflated every recommendation by 5%)*
- The skills library: add, rename, retire — never delete one somebody holds

---

### ⬜ Step 6 · The rest of task management
- **Subtasks** — the column exists, nothing creates them
- **Dependencies** — "this cannot start until that finishes", with a warning when you start something blocked
- **Watchers** — follow a task you are not assigned
- **Time extensions** — a Member requests, an Admin approves or declines, and only an Admin can (BR-018)
- **Task skills** — what a task needs, which is what the matching engine reads
- Bulk actions on the board
- Recurring tasks

---

### ⬜ Step 7 · Attachments
- Upload to a task or a comment, download, delete
- Type and size limits, and the storage rules so one person's files are not readable by another

**Needs from you:** a Supabase Storage bucket. I can create it through the Supabase connection — I will ask first.

---

### ⬜ Step 8 · Intelligence and the finishing pieces
- **"Who should do this?"** — the assignment engine, which already knows everyone's skills and load, actually recommending somebody, with the reasoning shown
- The rebalance advisor acting on its suggestions rather than only listing them
- Global search across tasks, projects and people
- Calendar view
- CSV export and the Monday-morning digest
- Notification preferences per person, per channel

---

## 🔁 HOW EACH STEP RUNS

1. Owner says go
2. Build it — schema first if needed, then rules, then the screen
3. Prove it: `npm run verify`, integration tests where there is a real seam, `npm run smoke` against the live URL
4. Commit, push (which deploys itself)
5. **Update this file and `SESSION-STATE.md`**
6. Report what changed, what it needs from the owner, and stop

## ⛔ NOT IN THIS PLAN

- **Sales management and workflow automation** — standing rule R4, the owner was explicit these are examples of what other CRMs do and are not wanted
- **Visual redesign** — coming separately, after the system is complete
- Google Sign-In (Phase 7a), WebAuthn/passkeys, multi-tenancy (ADR-008 says never)
