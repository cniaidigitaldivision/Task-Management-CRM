# 14 — Roadmap & Build Phases

Build order is deliberate: **each phase produces something you can actually open and use.** No phase is pure plumbing with nothing to show.

Effort figures are rough working-session estimates, not calendar dates — we'll set real dates once **Q-013** is answered.

---

> ## ⛔ STANDING RULE — permission per phase
>
> **No phase begins without the project owner's explicit go-ahead.** When authorised, a phase proceeds **step by step**, with [`SESSION-STATE.md`](SESSION-STATE.md) and [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) updated as work moves — not the whole phase in one uninterrupted burst. At the exit criteria, work **stops and waits** for permission to start the next phase.

---

## Phase 0 — Planning ✅ **COMPLETE**

| Task | State |
|---|---|
| Requirements, roles, data model, engines, UI documented | ✅ 18 documents |
| Projects & project types subsystem | ✅ [doc 15](15-PROJECTS-AND-PROJECT-TYPES.md) |
| Security & identity architecture | ✅ [doc 16](16-SECURITY-AND-IDENTITY.md) |
| Task timers & time limits | ✅ [doc 17](17-TASK-TIMERS-AND-TIME-LIMITS.md) |
| Design system & branding | ✅ [doc 18](18-DESIGN-SYSTEM-AND-BRANDING.md) — palette from the logo, light/dark for all roles |
| Canonical spec registry | ✅ [doc 19](19-MASTER-SPECIFICATION-REGISTRY.md) — 12 contradictions resolved |
| Implementation contracts | ✅ [doc 20](20-IMPLEMENTATION-CONTRACTS.md) — module walls, dependency order, gates |
| Decisions locked | ✅ ADR-001 … ADR-011 |
| Crash-resume protocol | ✅ [`SESSION-STATE.md`](SESSION-STATE.md) |
| Blocking questions | ✅ All cleared |
| Team roster | ✅ Not needed — the Admin builds the team in-app ([ADR-009](decisions/ADR-009-no-seeded-roster.md)) |

**Exit criteria met.** Phase 1 is ready and awaiting your instruction.

---

## Phase 1 — Foundation & Security
*Goal: you can log in safely, and your team exists in the system.*

**Expanded in Session 02** — security is now built into the foundation rather than added later. Retrofitting authentication hardening is far more expensive than building it in, and it's the layer everything else trusts.

> **Follow the concrete step order in [doc 20 §9](20-IMPLEMENTATION-CONTRACTS.md#9-phase-1--the-concrete-build-order)** — 7 steps, each with a gate. The list below is the contents; doc 20 is the sequence.

- Project scaffold, TypeScript, Tailwind, shadcn/ui, repository structure ([doc 20 §3](20-IMPLEMENTATION-CONTRACTS.md))
- **Design tokens** (`styles/tokens.css`) — every colour from doc 18, before the first component
- **Theme provider + pre-paint script + toggle** in Profile → Appearance, all roles
- **Logo assets** — light, dark, mark, favicon
- **`lib/domain/constants.ts`** — every enum and numeric constant from doc 19 §4
- Database provisioned, schema created (doc 04 incl. security tables), migrations
- `organisation_id` on every table (Q-034)
- **One-time Super Admin setup route** that permanently self-disables after use
- **Guided first-run wizard** — empty system → Admin → skills library → first project → members ([ADR-009](decisions/ADR-009-no-seeded-roster.md))
- **Editable starter skills library** (~35 entries with matching keywords)
- **"Forgot password"** for all four roles — emailed one-time code, 3-attempt lockout, self-service unlock ([ADR-007](decisions/ADR-007-account-recovery.md))
- Email deliverability: SPF, DKIM, DMARC configured and verified *(recovery depends on it)*
- **Super Admin seeding** with mandatory MFA enrolment
- **Super Admin immutability**: database trigger + RLS policy + server guard (doc 03 §2)
- **Break-glass recovery** setup per Q-030
- **Provisioning chain**: Super Admin → Admin → Coordinator/Member (doc 16 §3)
- Activation-token invitations — hashed, single-use, 48-hour
- Password policy: Argon2id, breach check, blocklist, strength meter (doc 16 §5)
- MFA: TOTP + WebAuthn/passkey + recovery codes
- Session hardening: device binding, role-scoped TTL, rotation with reuse detection
- Rate limiting, progressive lockout, generic errors, timing normalisation
- Step-up re-authentication for 🔒 actions
- `auth_identities` table ready for Google SSO (Phase 7a) — no future migration
- Role system + permission service + **row-level security incl. member isolation** (ADR-003)
- Immutable audit and security event logs
- Login and anomaly alerting
- Seed the real team roster
- App shell: role-aware sidebar, top bar, routing, responsive layout
- Deployed to a preview URL

**You can:** log in as Super Admin with MFA, create the Admin account, watch your sister activate hers, and have her create the members.
**Demo:** everyone signs in on their own phone; a member confirms they cannot see anyone else's data.

---

## Phase 2 — Projects & core task management
*Goal: the team can actually run their work in it.*

**Expanded in Session 02** — projects are now a v1 requirement (ADR-006), and every task belongs to one, so the project layer has to land alongside tasks rather than after them.

- **Projects**: CRUD, the 5 types with type-specific fields, lifecycle statuses
- **Permanent "Misc / Ad-hoc" Other project** seeded (Q-024)
- **Every task belongs to exactly one project** (BR-011)
- **Mandatory `other_description`** on tasks in Other projects (BR-012)
- **Project context card** on task detail + project chip on task cards
- Type-prefixed task references — `EVT-142`, `CLI-088`, `OTH-205` (Q-026)
- **Member Activity Preview** grouped by project type, with the Other section (doc 15 §6)
- Promote an Other task into a real project
- Projects list and project detail screens
- Member project visibility scoping (BR-016)
- Task CRUD with all fields (doc 04)
- Status workflow with transition rules enforced (doc 05)
- **My Work** view (doc 10 §2)
- **List** view with filter and sort
- **Board** view with drag-and-drop
- Task detail page: description, checklist, activity timeline
- Comments with @mentions
- File attachments
- Permission enforcement across every action
- Soft delete + Trash

**Also in Phase 2 — task timers & time limits** ([doc 17](17-TASK-TIMERS-AND-TIME-LIMITS.md), [ADR-010](decisions/ADR-010-task-time-limits.md)):
- Time limit per task, pre-filled from the effort estimate
- Automatic timer driven by task status, with working-hours auto-pause
- Threshold reminders at 50/75/90/100/120/150%
- Over-limit enforced stop-and-account
- Extension requests — Coordinator sets limits, **only Admin grants more time**
- Append-only time entry log; manual adjustments flagged

**You can:** create, assign, time-box and complete real work. This alone replaces WhatsApp task-chasing.
**Demo:** the full walkthrough from doc 05 §3, end to end, with a timer running and an extension approved.

---

## Phase 3 — Real-time & notifications
*Goal: nobody needs to refresh, and nobody misses anything.*

- Real-time subscriptions on tasks, comments, notifications (doc 08)
- Optimistic UI everywhere
- In-app notification centre + toasts
- Email notifications + per-user preferences
- Cron jobs: overdue scan, due-soon reminders, escalations
- Daily digest email

**You can:** watch Yusra's status change appear live on your dashboard.
**Demo:** two devices side by side, one change, both update.

---

## Phase 4 — The intelligence ★
*Goal: the reason this project exists.*

- Skills library + per-member skills with proficiency
- Capacity settings per member
- **Workload engine** — load calculation, thresholds, traffic lights (doc 06)
- **Workload view** with per-member bars (doc 10 §4)
- **Assignment engine** — 5-factor scoring (doc 07)
- **Recommendation panel** with plain-English reasons
- Soft warning + hard block + logged override
- "Nobody fits" alternatives panel
- **Rebalance Advisor**
- Availability / leave calendar
- Exhaustive unit tests on both engines

**You can:** assign a task and be told who should get it and why — and be stopped from overloading anyone.
**Demo:** the exact scenario from doc 07 §4 with your real team.

> **This is the phase that makes it worth building instead of buying.**

---

## Phase 5 — Dashboards & reporting
*Goal: you can see the whole operation at a glance.*

- Admin dashboard (doc 10 §7)
- Calendar view
- Reports: completion, on-time rate, cycle time, revision rate, per-member and per-project
- Activity feed + audit log
- Global search
- Settings UI: thresholds, skills, weights, statuses, notifications
- Time logging

**You can:** answer any question about the team's work without asking anyone.

---

## Phase 6 — Polish & adoption
*Goal: the team actually uses it every day.*

- Subtasks, dependencies, checklists
- Recurring tasks + task templates
- Bulk actions
- Keyboard shortcuts + `⌘K` command palette
- Mobile refinement pass
- Empty states, loading states, error handling
- Onboarding for a new member's first login
- Accessibility pass (NFR-008)
- End-to-end tests on critical flows
- Production deploy, backups verified, real data migration (Q-021)

**You can:** hand this to the team and step back.

---

## Phase 7+ — Enhancements *(optional, driven by real use)*

Pulled from [`12-ENHANCEMENT-BACKLOG.md`](12-ENHANCEMENT-BACKLOG.md) in priority order:

| Wave | Items |
|---|---|
| **7a** | **S-01 Google Sign-In (OAuth/OIDC)** · S-02 passkeys for all roles · E-007 Blocked escalation · E-011 Priority guard |
| **7b** | E-004 Handoff chains · E-005 "What should I do next?" · E-002 Estimate calibration · S-05 trusted devices · S-08 data export rights |
| **7c** | E-016 Calendar sync · E-017 Telegram bot · E-023 PWA · P-10 client progress link |
| **7d** | E-008/E-009 LLM layer (if Q-009 = yes) · E-012 Weekly retro · P-12 auto-suggested project type |
| **7e** | E-006 Skill gaps · E-010 Burndown · E-026 Annotated video feedback · P-11 project archive intelligence |
| **7f** | **S-10 Tenant isolation** — required before any SaaS launch (Q-015) |

> **E-001 (Client/Project layer) has been promoted out of Phase 7 into Phase 2** — it's now a v1 requirement per ADR-006.

### Google Sign-In — where it lands and why

You asked for it to be recorded for later. It's **S-01, Phase 7a**, and the schema is built for it in Phase 1 so no migration is needed when you want it.

Three design rules already decided (doc 16 §11):
1. **Google never creates an account.** It only authenticates an account an Admin already provisioned — otherwise your whole provisioning chain gets bypassed.
2. **Restricted to your company's Google Workspace domain** if you have one; otherwise any Gmail could attempt sign-in.
3. **The Super Admin stays on password + passkey.** Federating the most privileged account to Google means a Google compromise becomes a CRM compromise. Deliberate exception.

> **Important:** don't commit to 7a–7e now. Ship Phase 6, let the team use it for a month, then decide from evidence. What they actually complain about will be more useful than any of my predictions.

---

## Dependency graph

```
Phase 0  Planning
   │
Phase 1  Foundation ──────────────────────┐
   │                                      │
Phase 2  Core tasks ──────┬───────────────┤
   │                      │               │
Phase 3  Real-time        │               │
   │                      │               │
Phase 4  ★ Intelligence ◀─┘  (needs tasks + members + estimates)
   │
Phase 5  Dashboards  (needs intelligence for workload widgets)
   │
Phase 6  Polish
   │
Phase 7+ Enhancements
```

Phase 3 and Phase 4 can partly run in parallel — real-time doesn't depend on the engines.

---

## Working agreement for the build

| | |
|---|---|
| **Sessions** | Each working session takes one tracker item, completes it, updates [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) |
| **Reviewable output** | Every phase ends with a preview URL you can click through on your phone |
| **Nothing silent** | If I hit an ambiguity, I ask rather than guess |
| **Documents stay live** | Any design change updates the relevant doc, not just the code |
| **Testing** | The workload and assignment engines get exhaustive unit tests — they're too important to hand-check |
| **Your call on scope** | If something turns out to be more work than expected, you decide whether to cut it, not me |

---

## What I recommend for a first milestone

If you want the **shortest path to something genuinely useful**:

> **Phases 1 + 2 + a stripped-down Phase 4** — foundation, core tasks, and the workload view with basic capacity thresholds.
>
> That gives you: real task management, live team visibility, and the overload protection that was your main concern — without dashboards, reports, or reporting polish yet.
>
> Then use it for two weeks. What you find annoying will reorder everything that comes after, more usefully than this roadmap can.
