# 📊 PROGRESS TRACKER — CNI CRM

**Last updated:** 2026-08-06 (Session 06)
**Current phase:** **Phase 1 — Foundation & Security** · Step 1 + shell complete
**Overall progress:** ▓▓▓▓▓░░░░░░░░░░░░░░░ 27%
**Blocked on:** **Nothing.** Awaiting go-ahead for Step 2 (data foundation).

> ⛔ **Standing rule (owner, Session 06):** commit, push to GitHub and update these docs after **every** change — not batched at session end.
**Run it:** `npm run dev` → http://localhost:4310 · `npm run verify` → typecheck + lint + build

> **Phase 1 build order:** follow [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) §9 — 7 steps, each with a gate.
> **Any spec disagreement:** [`19-MASTER-SPECIFICATION-REGISTRY.md`](19-MASTER-SPECIFICATION-REGISTRY.md) decides.

> ⛔ **WORKING AGREEMENT — phase-by-phase permission.** No phase begins without your explicit instruction. Work stops at each phase boundary and waits. I do not run ahead into the next phase, and I do not do all of a phase's work in one uninterrupted go — each phase proceeds step by step with the tracker updated as we move.

> **This is the permanent record of everything.** For "where did we stop, resume from here", read [`SESSION-STATE.md`](SESSION-STATE.md) instead — it's short and always current.
>
> **If your session ends unexpectedly:** open [`SESSION-STATE.md`](SESSION-STATE.md) §1 and paste the resume prompt into a new session. Nothing is lost.

---

## Status legend

| Symbol | Meaning |
|:--:|---|
| ⬜ | Not started |
| 🟡 | In progress |
| ✅ | Done |
| ⏸️ | Paused / deferred |
| 🚫 | Blocked — waiting on something |
| ❌ | Cancelled / dropped from scope |

---

## Phase overview

| Phase | Name | Status | Progress |
|:--:|---|:--:|---|
| 0 | Planning & Documentation | ✅ | ▓▓▓▓▓▓▓▓▓▓ 100% |
| 1 | Foundation & **Security** (auth, DB, roles, MFA) | 🟡 | ▓▓░░░░░░░░ 14% — Step 1/7 |
| 2 | **Projects** & core task management | ⬜ | ░░░░░░░░░░ 0% |
| 3 | Real-time & notifications | ⬜ | ░░░░░░░░░░ 0% |
| 4 | ★ Intelligence (workload + assignment) | ⬜ | ░░░░░░░░░░ 0% |
| 5 | Dashboards & reporting | ⬜ | ░░░░░░░░░░ 0% |
| 6 | Polish & adoption | ⬜ | ░░░░░░░░░░ 0% |
| 7+ | Enhancements | ⬜ | ░░░░░░░░░░ 0% |

---

## ✅ BLOCKERS — all cleared

| ID | Blocker | Resolution | Cleared |
|---|---|---|---|
| **B-001** | Team roster — Q-001 | **Dissolved.** No seeded roster; the Admin builds the team in-app ([ADR-009](decisions/ADR-009-no-seeded-roster.md)) | 08-06 |
| **B-002** | Tech stack — Q-012 | Next.js + TS + Supabase + Tailwind ([ADR-001](decisions/ADR-001-tech-stack.md)) | 08-06 |
| **B-003** | Role model & visibility — Q-002, Q-003 | 4 roles; members isolated ([ADR-002](decisions/ADR-002-four-role-model.md), [ADR-003](decisions/ADR-003-member-data-isolation.md)) | 08-06 |
| **B-004** | Timezone / working week — Q-010 | Asia/Karachi, Mon–Sat 09:00–17:00 ([ADR-004](decisions/ADR-004-working-calendar-and-capacity.md)) | 08-06 |
| **B-005** | Super Admin recovery — Q-030 | Email one-time code for all roles + 3-attempt lockout ([ADR-007](decisions/ADR-007-account-recovery.md)) | 08-06 |
| **B-006** | Multi-tenancy — Q-034 | **No.** Single-tenant ([ADR-008](decisions/ADR-008-single-tenant.md)) | 08-06 |
| **B-007** | Company name — Q-022 | **Crescent Nova International (CNI)** | 08-06 |

**Phase 0 is complete. Phase 1 awaits your instruction to begin.**

---

## Phase 0 — Planning & Documentation

| ID | Task | Status | Notes |
|---|---|:--:|---|
| T-001 | Draft the planning document set (00–14) | ✅ | Session 01 |
| T-002 | Hands-on ClickUp browser walkthrough | ⏸️ | Doc 11 written from established knowledge. Say the word for a live browser session. |
| T-003 | Collect the real team roster | 🚫 | Blocked on B-001 |
| T-004 | Get blocking questions answered | ✅ | All blockers cleared Session 03. Remaining questions have defaults and don't block. |
| T-005 | Lock the tech stack → ADR-001 | ✅ | Session 02 |
| T-006 | Final plan sign-off | ⬜ | Gate to Phase 1 |
| T-007 | Design the Projects & project-types subsystem → doc 15 | ✅ | Session 02 |
| T-008 | Design the Security & identity architecture → doc 16 | ✅ | Session 02 |
| T-009 | Create the crash-resume protocol → `SESSION-STATE.md` | ✅ | Session 02 |
| T-010 | Write ADR-001 … ADR-006 | ✅ | Session 02 |
| T-011 | Update docs 00–14 for the 4-role model, projects, and security | ✅ | Session 02 |
| T-012 | Write ADR-007 (account recovery) | ✅ | Session 03 |
| T-013 | Write ADR-008 (single-tenant) | ✅ | Session 03 |
| T-014 | Write ADR-009 (no seeded roster) + retire the roster template | ✅ | Session 03 |
| T-015 | Design task timers & time limits → doc 17 | ✅ | Session 03 |
| T-016 | Write ADR-010 (task time limits) | ✅ | Session 03 |
| T-017 | Write `templates/FIRST-RUN-SETUP-GUIDE.md` | ✅ | Session 03 |
| T-018 | Rework doc 16 recovery model for the email-code flow | ✅ | Session 03 |
| T-019 | Analyse the logo; derive the brand palette → doc 18 | ✅ | Session 04 |
| T-020 | Design light/dark theming for all roles | ✅ | Session 04 |
| T-021 | Write ADR-011 (design system) | ✅ | Session 04 |
| T-022 | Build the master specification registry → doc 19 | ✅ | Session 04 |
| T-023 | **Contradiction sweep** — 12 found, all resolved | ✅ | Session 04, doc 19 §9 |
| T-024 | Write implementation contracts & build order → doc 20 | ✅ | Session 04 |
| T-025 | Apply contradiction fixes to docs 04, 05, 06, 07, 10 | ✅ | Session 04 |

---

## Phase 1 — Foundation & Security

> **Build in the step order of [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) §9.** The IDs below map onto those steps. Each step has a gate that must pass before the next begins.

### Step 1 — Scaffold, design tokens, theme

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-101 | Scaffold project (Next.js 16.3 + React 19.2 + TS + Tailwind v4) | ADR-001 | ✅ |
| T-102 | Repository structure per **doc 20 §3** | — | ✅ |
| T-102a | `styles/tokens.css` — full token system, light + dark + shadcn bridge | FR-205, FR-207 | ✅ |
| T-102b | ThemeProvider + pre-paint script (no flash) | FR-203, FR-204 | ✅ |
| T-102c | ThemeToggle + segmented + Appearance setting | FR-201, FR-202 | ✅ |
| T-102d | `lib/domain/constants.ts` — every enum from doc 19 §4 | — | ✅ |
| T-102e | Logo as theme-aware inline SVG + favicon | FR-200, FR-209 | ✅ |
| T-102f | Lint rule blocking raw hex in components | BR-025 | ✅ |
| T-102g | Lint rule enforcing `lib/domain/` purity + determinism | doc 20 §1, §5 | ✅ |
| T-102h | Score-weight load-time assertion (must total 1.00) | C-06 | ✅ |
| T-102i | Type scale + tabular numerals utility | FR-211 | ✅ |
| T-102j | `prefers-reduced-motion` + focus-ring styles | FR-212, FR-214 | ✅ |
| **Gate 1** | **Both themes render; no flash; tokens resolve** | | ✅ **PASSED** |

> **Gate 1 evidence (browser-verified, 2026-08-06):** theme switch light↔dark works; preference persists across reload; `data-theme` is correct at first paint with no flash; `--text-gold` correctly resolves asymmetrically (gold-800 light / gold-400 dark); status colours all distinct with no gold in the semantic set; `npm run verify` passes clean.
>
> **Deferred by design:** 375px responsive verification → Step 7, with the app shell.

### Step 1b — Application shell & brand correction *(added Session 06)*

Pulled forward from Step 7 in response to owner feedback that the interface did not look like a CRM. Building the shell early lets the look be approved before six more steps are built on top of it.

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-103a | **Use the supplied logo file as-is** — SVG reconstruction removed | FR-200, ADR-011 | ✅ |
| T-103b | Aspect ratio locked in code — distortion structurally impossible | FR-209 | ✅ |
| T-103c | Diagnosed and fixed the chequerboard baked into the supplied PNG | Q-049 | ✅ |
| T-103d | `LogoPlate` — keeps the dark-teal wordmark legible on dark surfaces | FR-207 | ✅ |
| T-103e | Favicon from the real artwork (`app/icon.png`) | FR-200 | ✅ |
| T-104a | Richer surface tokens — tinted page, white cards, sidebar palette | FR-205 | ✅ |
| T-104b | UI primitives: Card, Badge, Button, Avatar | — | ✅ |
| T-104c | App shell — fixed sidebar, drawer on mobile, top bar | doc 10 §1 | ✅ |
| T-104d | Role-aware navigation config, route-typed hrefs | doc 03 §4 | ✅ |
| T-104e | **Admin dashboard** — KPIs, needs-attention, workload, activity | doc 10 §7 | ✅ |
| T-104f | Placeholder pages for all 9 nav routes — no 404s anywhere | — | ✅ |
| T-104g | Design system moved to `/design-system` | — | ✅ |
| **Gate 1b** | **Looks like professional business software in both themes** | | ✅ **PASSED** |

> **Still to do in the shell (Step 7):** responsive verification at 375px, keyboard navigation pass, collapsed sidebar rail, command palette.

### Steps 2–7 — see [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) §9 for the gate on each
| T-103 | Provision Supabase + storage + Resend | — | ⬜ |
| T-104 | Schema + migrations, incl. security tables (doc 04 §2b) | — | ⬜ |
| T-105 | ~~`organisation_id` on every table~~ | — | ❌ Dropped — [ADR-008](decisions/ADR-008-single-tenant.md), single-tenant |
| T-105a | One-time Super Admin setup route that self-disables after use | ADR-009 | ⬜ |
| T-105b | Guided first-run wizard (empty system → working team) | ADR-009 | ⬜ |
| T-105c | Editable starter skills library (~35 entries with keywords) | FR-017, ADR-009 | ⬜ |
| T-106 | Password auth: Argon2id, breach check, blocklist, strength meter | FR-147, doc 16 §5 | ⬜ |
| T-107 | `auth_identities` table — SSO-ready, no future migration | FR-161 | ⬜ |
| T-108 | Activation-token invitation flow (hashed, single-use, 48h) | FR-142, FR-143 | ⬜ |
| T-109 | Optional temporary-password path (screen-only, never emailed) | FR-144 | ⬜ |
| T-110 | MFA: TOTP + WebAuthn/passkey + recovery codes | FR-145 | ⬜ |
| T-111 | Mandatory, undisableable MFA for Super Admin | FR-146 | ⬜ |
| T-112 | **Super Admin immutability**: DB trigger + RLS + server guard | FR-140, FR-156 | ⬜ |
| T-113 | **"Forgot password"** — emailed one-time code + link, all 4 roles | FR-155, FR-155e | ⬜ |
| T-113a | **3-attempt lockout** + email unlock code + owner alert | FR-155a | ⬜ |
| T-113b | MFA required after email code for Super Admin and Admin resets | FR-155b, Q-039 | ⬜ |
| T-113c | Reset revokes all sessions + confirmation email with IP/location | FR-155c | ⬜ |
| T-113d | Recovery codes + sealed master credential backstops | FR-155d | ⬜ |
| T-113e | Email deliverability: SPF, DKIM, DMARC configured and verified | ADR-007 | ⬜ |
| T-114 | Session hardening: device binding, role TTL, rotation + reuse detection | FR-150 | ⬜ |
| T-115 | Step-up re-authentication for 🔒 actions | FR-149 | ⬜ |
| T-116 | Rate limiting, progressive lockout, generic errors, timing normalisation | FR-148 | ⬜ |
| T-117 | Login alerts + anomaly detection (new device/country/impossible travel) | FR-151, FR-152 | ⬜ |
| T-118 | Role enum (4 roles) + permission service | doc 03 | ⬜ |
| T-119 | Row-level security incl. **member isolation** | FR-157, ADR-003 | ⬜ |
| T-120 | Immutable audit + security event logs (no UPDATE/DELETE grant) | FR-153 | ⬜ |
| T-121 | Seed Super Admin (guided setup with MFA + recovery codes) | FR-140 | ⬜ |
| T-122 | Provisioning chain UI: Super Admin → Admin → Coordinator/Member | FR-141 | ⬜ |
| T-123 | Team management UI (add/edit/deactivate) | FR-010–016 | ⬜ |
| T-124 | Session list + self-revoke | FR-154 | ⬜ |
| T-125 | Role-aware app shell: sidebar, top bar, responsive layout | NFR-007 | ⬜ |
| T-126 | Deploy to preview environment | — | ⬜ |
| **Exit** | Everyone signs in on their own phone; a member confirms they cannot see anyone else's data | | ⬜ |

---

## Phase 2 — Projects & core task management

### 2a — Projects (doc 15)

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-220 | Project CRUD, Admin/Super Admin only | FR-100, FR-101 | ⬜ |
| T-221 | 5 project types with type-specific fields (`type_fields` + Zod per type) | FR-102, FR-103 | ⬜ |
| T-222 | Project lifecycle statuses + completion guard | FR-112, BR-014 | ⬜ |
| T-223 | Seed the permanent "Misc / Ad-hoc" Other project | Q-024 | ⬜ |
| T-224 | Every task requires a project — enforced at DB and app layer | FR-104, BR-011 | ⬜ |
| T-225 | Mandatory `other_description` on Other-type tasks | FR-106, BR-012 | ⬜ |
| T-226 | Project context card on task detail + chip on task cards | FR-105 | ⬜ |
| T-227 | Type-prefixed task references (EVT/CLI/BIZ/PRM/OTH) | FR-113, Q-026 | ⬜ |
| T-228 | Promote an Other task into a real project | FR-107 | ⬜ |
| T-229 | Projects list + project detail screens | doc 15 §7 | ⬜ |
| T-230 | **Member Activity Preview** grouped by project type | FR-108–110 | ⬜ |
| T-231 | "Other" capacity warning threshold | FR-111 | ⬜ |
| T-232 | Member project visibility scoping (RLS) | FR-119, BR-016 | ⬜ |
| T-233 | Event deliverables-due derivation + late-task flagging | FR-114 | ⬜ |

### 2b — Tasks

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-201 | Task create form + all fields | FR-020, FR-021 | ⬜ |
| T-202 | Task reference generator (CNI-nnn) | FR-032 | ⬜ |
| T-203 | Status model + transition rule enforcement | FR-040–045 | ⬜ |
| T-204 | Assignment + reassignment (manual, pre-intelligence) | FR-022, FR-023 | ⬜ |
| T-205 | Task detail page | doc 10 §5 | ⬜ |
| T-206 | My Work view | FR-080 | ⬜ |
| T-207 | List view with filter + sort | FR-081 | ⬜ |
| T-208 | Board view with drag-and-drop | FR-082 | ⬜ |
| T-209 | Comments + @mentions | FR-090 | ⬜ |
| T-210 | File attachments | FR-091 | ⬜ |
| T-211 | Activity timeline per task | FR-092 | ⬜ |
| T-212 | Soft delete + Trash + restore | FR-024, FR-095 | ⬜ |
| T-213 | Permission enforcement across all task actions | doc 03 | ⬜ |
| **Exit** | Full CNI-142 walkthrough (doc 05 §3) works end to end | | ⬜ |

---

### 2c — Task timers & time limits (doc 17)

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-240 | `time_limit_minutes` on tasks, pre-filled from effort estimate | FR-170, FR-171 | ⬜ |
| T-241 | Limit-setting permissions: Admin + Coordinator set; Admin-only after start | FR-172, FR-173 | ⬜ |
| T-242 | Automatic timer driven by task status | FR-174, FR-175 | ⬜ |
| T-243 | **Working-hours auto-pause** (Mon–Sat 09:00–17:00, Sundays, leave) | FR-176, BR-019 | ⬜ |
| T-244 | Idle prompt at 2h, auto-pause at 2h30 | FR-177 | ⬜ |
| T-245 | `time_entries` append-only segment log | FR-178, BR-023 | ⬜ |
| T-246 | Manual entry & adjustment — reason required, visibly flagged | FR-179, BR-020 | ⬜ |
| T-247 | Threshold reminders at 50/75/90/100/120/150% | FR-180 | ⬜ |
| T-248 | **Over-limit enforced stop-and-account** banner | FR-181, BR-021 | ⬜ |
| T-249 | Admin + Coordinator notified on over-limit | FR-182 | ⬜ |
| T-250 | Extension request flow with mandatory reason | FR-183, BR-018 | ⬜ |
| T-251 | **Admin-only extension approval** (full / partial / decline) | FR-184, FR-186 | ⬜ |
| T-252 | Extension review context panel (capacity, history, similar tasks) | FR-185 | ⬜ |
| T-253 | Approved extensions update limit, timer and capacity load | FR-187 | ⬜ |
| T-254 | Timer UI: card progress ring, detail panel, segment list | FR-189 | ⬜ |
| T-255 | Admin dashboard time & extensions widget | FR-190 | ⬜ |
| T-256 | Audit logging for limits, extensions, adjustments | FR-188 | ⬜ |
| T-257 | Member time-data isolation | FR-191, ADR-003 | ⬜ |

---

## Phase 3 — Real-time & notifications

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-301 | Real-time channel setup + subscriptions | FR-070, NFR-003 | ⬜ |
| T-302 | Optimistic UI across task actions | NFR-002 | ⬜ |
| T-303 | Notification data model + centre + badge | FR-071 | ⬜ |
| T-304 | Member notification triggers | FR-072 | ⬜ |
| T-305 | Admin notification triggers | FR-073 | ⬜ |
| T-306 | Email notifications + preferences | FR-074 | ⬜ |
| T-307 | Batching + quiet hours | doc 08 §4 | ⬜ |
| T-308 | Cron: overdue scan, due-soon, escalations | doc 05 §6 | ⬜ |
| T-309 | Daily digest | FR-076 | ⬜ |
| **Exit** | Two devices, one change, both update within 2s | | ⬜ |

---

## Phase 4 — ★ Intelligence

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-401 | Skills library + admin UI | FR-017 | ⬜ |
| T-402 | Per-member skills with proficiency | FR-012 | ⬜ |
| T-403 | Capacity settings per member | FR-013, FR-060 | ⬜ |
| T-404 | Availability / leave calendar | FR-014, FR-065 | ⬜ |
| T-405 | **workload-engine.ts** — load, capacity, utilisation | doc 06 §2 | ⬜ |
| T-406 | Threshold bands + traffic lights | FR-062, doc 06 §3 | ⬜ |
| T-407 | Concurrent task guard | FR-061 | ⬜ |
| T-408 | Workload view UI | FR-063, doc 10 §4 | ⬜ |
| T-409 | **assignment-engine.ts** — 5-factor scoring | doc 07 §3 | ⬜ |
| T-410 | Eligibility filter (leave, inactive, guest) | BR-005, BR-006 | ⬜ |
| T-411 | Recommendation panel with plain-English reasons | FR-050, FR-051 | ⬜ |
| T-412 | Soft warning + hard block + override dialog | FR-053, BR-003 | ⬜ |
| T-413 | "Nobody fits" alternatives panel | FR-054, doc 07 §5 | ⬜ |
| T-414 | Keyword fallback matching | FR-055 | ⬜ |
| T-415 | Rebalance Advisor | FR-056, doc 06 §5 | ⬜ |
| T-416 | Sustained overload detection + alerts | FR-066 | ⬜ |
| T-417 | **Unit test suite for both engines** | — | ⬜ |
| T-418 | Project-familiarity scoring factor (S6) | FR-117 | ⬜ |
| T-419 | Workload breakdown by project type | FR-115 | ⬜ |
| T-420 | Project-type shed order in the Rebalance Advisor | FR-118, Q-027 | ⬜ |
| T-421 | Capacity consumed per project and per client | FR-116 | ⬜ |
| **Exit** | Doc 07 §4 scenario reproduces with the real team | | ⬜ |

---

## Phase 5 — Dashboards & reporting

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-501 | Admin dashboard | FR-085, doc 10 §7 | ⬜ |
| T-502 | Calendar view | FR-083 | ⬜ |
| T-503 | Reports: completion, on-time, cycle time, revisions | FR-088 | ⬜ |
| T-504 | Global search | FR-086 | ⬜ |
| T-505 | Audit log + viewer | FR-093 | ⬜ |
| T-506 | Settings UI (all tabs) | doc 10 §9 | ⬜ |
| T-507 | Time logging | FR-094 | ⬜ |
| T-508 | Scoring weight configuration | FR-057 | ⬜ |

---

## Phase 6 — Polish & adoption

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-601 | Subtasks | FR-026 | ⬜ |
| T-602 | Checklists | FR-027 | ⬜ |
| T-603 | Dependencies | FR-028 | ⬜ |
| T-604 | Recurring tasks | FR-029 | ⬜ |
| T-605 | Task templates | FR-030 | ⬜ |
| T-606 | Bulk actions | FR-031 | ⬜ |
| T-607 | Keyboard shortcuts + command palette | doc 10 §11 | ⬜ |
| T-608 | Mobile refinement pass | NFR-007 | ⬜ |
| T-609 | Empty / loading / error states | doc 10 §11 | ⬜ |
| T-610 | New-member onboarding flow | — | ⬜ |
| T-611 | Accessibility pass | NFR-008 | ⬜ |
| T-612 | End-to-end tests | — | ⬜ |
| T-613 | Production deploy + backup verification | NFR-005 | ⬜ |
| T-614 | Data import (if Q-021 = yes) | — | ⬜ |

---

## Decisions locked so far

| ID | Decision | Date |
|---|---|---|
| [ADR-001](decisions/ADR-001-tech-stack.md) | Next.js + TypeScript + Supabase + Tailwind + shadcn/ui on Vercel | 2026-08-06 |
| [ADR-002](decisions/ADR-002-four-role-model.md) | 4 roles; Super Admin immutable by anyone else, enforced at 4 layers | 2026-08-06 |
| [ADR-003](decisions/ADR-003-member-data-isolation.md) | Members see only their own tasks, workload and projects | 2026-08-06 |
| [ADR-004](decisions/ADR-004-working-calendar-and-capacity.md) | Asia/Karachi, Mon–Sat 09:00–17:00, default capacity 36 pts | 2026-08-06 |
| [ADR-005](decisions/ADR-005-capacity-points-and-hard-block.md) | Weighted capacity points, not task count; hard block is real | 2026-08-06 |
| [ADR-006](decisions/ADR-006-projects-and-other-category.md) | Projects required in v1; 5 types; mandatory "Other" description | 2026-08-06 |
| [ADR-007](decisions/ADR-007-account-recovery.md) | Email one-time code recovery for all roles; 3-attempt lockout | 2026-08-06 |
| [ADR-008](decisions/ADR-008-single-tenant.md) | Single-tenant. No `organisation_id`. | 2026-08-06 |
| [ADR-009](decisions/ADR-009-no-seeded-roster.md) | No seeded roster — the Admin builds the team in-app | 2026-08-06 |
| [ADR-010](decisions/ADR-010-task-time-limits.md) | Task time limits, automatic timers, Admin-only extensions | 2026-08-06 |
| [ADR-011](decisions/ADR-011-design-system.md) | Logo-derived palette; gold never semantic; light/dark for all roles | 2026-08-06 |

---

## Session log

| Date | Session | What happened | Next |
|---|---|---|---|
| 2026-08-05 | 01 | Planning set 00–14 drafted: brief, requirements (FR/NFR/BR), permissions matrix, data model, task lifecycle, workload engine, assignment engine, real-time design, tech stack, UI screens, competitor benchmark, enhancement backlog, questions, roadmap, tracker. **No code.** | Get Q-001/002/003/010/012 answered |
| 2026-08-06 | 02 | Answers locked (Q-002/003/010/012/015 + defaults). Role model expanded to 4 with **Team Coordinator**. **Doc 15** — projects, 5 types, task↔project linkage, "Other" rules, Member Activity Preview, 12 engineering enhancements. **Doc 16** — threat model, provisioning chain, Super Admin hardening, break-glass, OWASP/NIST coverage, incident runbook, Google SSO roadmap. **`SESSION-STATE.md`** crash-resume protocol. ADR-001–006 written. Docs 03, 04, 06, 13, 14 and tracker updated. 15 new questions (Q-024–Q-038). **No code.** | Q-001 roster · Q-030 break-glass · Q-034 tenancy · Q-022 name |
| 2026-08-06 | 05 | **PHASE 1, STEP 1 — first code.** Next.js 16.3 / React 19.2 / TS / Tailwind v4 scaffolded into the existing docs tree. Complete design-token system (raw palette → semantic layer → shadcn bridge), light and dark. Canonical constants with a load-time assertion that score weights total 1.00. Theme provider built on `useSyncExternalStore` with pre-paint script and transition suppression. Logo rebuilt as a theme-aware inline SVG whose facet seams track the surface. Lint rules now enforce BR-025 (no raw hex) and layer-2 purity (no db/framework/React in `lib/domain/`, no `Date.now()`). Dev port moved to 4310 after finding a foreign service worker on 3000. **Gate 1 PASSED**, browser-verified. | **Awaiting go-ahead for Step 2** |
| 2026-08-06 | 04 | Logo analysed → **doc 18 design system**: palette from the mark, semantic tokens, light/dark for every role (ADR-011). **Gold/amber collision** found and resolved — gold is brand chrome only; status and workload colours revised. **Doc 19 master registry** — canonical index of every FR/BR/enum/setting/table, document ownership map, **12 contradictions found and resolved**. **Doc 20 implementation contracts** — 4-layer architecture, module table ownership, dependency graph, frozen interfaces, 9 integration seams, migration safety, per-phase gates, concrete Phase 1 step order. Assignment weights corrected 1.05 → 1.00. Fixes applied to docs 04, 05, 06, 07, 10. Q-049–Q-053 raised. **No code.** | **Awaiting go-ahead for Phase 1** |
| 2026-08-06 | 03 | **All blockers cleared.** No seeded roster — Admin builds the team in-app (ADR-009); roster template retired, replaced by `FIRST-RUN-SETUP-GUIDE.md`. Recovery redesigned around emailed one-time codes for all 4 roles + 3-attempt lockout (ADR-007); doc 16 §6 rewritten, MFA added after email code for privileged roles. Single-tenant confirmed (ADR-008). Company name: **Crescent Nova International**. **Doc 17** — task timers, time limits, working-hours pausing, over-limit enforcement, Admin-only extensions, 9 further enhancements (ADR-010). Phase-by-phase permission recorded as a working agreement. 10 new questions (Q-039–Q-048). **No code.** | **Awaiting your go-ahead for Phase 1** |

---

## Metrics (once live)

| Metric | Target | Current |
|---|---|---|
| Team members onboarded | 7 / 7 | — |
| Tasks tracked in the system | > 90% of real work | — |
| Members above hard threshold | 0 sustained | — |
| Utilisation spread (max − min) | < 40 pts | — |
| Recommendation acceptance rate | > 60% | — |
| Daily active members | 7 / 7 | — |
