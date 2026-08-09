# 📊 PROGRESS TRACKER — CNI CRM

**Last updated:** 2026-08-09 (Session 21)
**Current phase:** **All 8 BUILD-PLAN steps complete.** [REDESIGN-PLAN](REDESIGN-PLAN.md) phases 1–8 complete; **phase 9 not started.**
**Blocked on:** 🟢 **Batch 1 of [CHANGE-PLAN.md](CHANGE-PLAN.md) is complete** — all 9 bugs fixed and verified in Chrome. Awaiting the go-ahead for Batch 2 (tasks and the board). ⚠️ **Owner action: remove `NEXT_PUBLIC_APP_URL` from `.env.local`** — it pins `http://localhost:4310`, which is why activation links said localhost. Also still open: **a decision on [REDESIGN-PLAN §9](REDESIGN-PLAN.md)** — what the supplied `CNI-AI-Digital-Task-Board.html` is meant to become. It sat in the repo root, referenced by no planning document, through the whole redesign. Also awaiting permission: **persisting board order** needs a migration (§8.5). `SUPABASE_STORAGE_KEY` and `CRON_SECRET` are set as of Session 17. Resend's sending domain is still deferred, and it is what the email-change verification link waits on.
**Tests:** `npm run test` → **958** · `npm run test:auth` → **133** (real DB) · `npm run smoke` → **27/27** signed-in route checks · DB gates: Step 2 **35/35**, pre-auth **32/32**, 010 **9/9**, 011 **8/8**, work core **17/17**, email change **11/11**

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
| 1 | Foundation & **Security** (auth, DB, roles, MFA) | 🟡 | ▓▓▓▓▓▓▓▓░░ 80% — Steps 1–4 + 5.1 done; 5.2 next |
| 2 | **Projects** & core task management | 🟡 | ▓▓▓▓▓▓▓▓░░ 80% — **pulled forward (Session 11)**: schema, RLS, task + project CRUD, board, capacity engine, timers all live. Missing: attachments, dependencies UI, recurring tasks, calendar view |
| 3 | Real-time & notifications | ⬜ | ░░░░░░░░░░ 0% |
| 4 | ★ Intelligence (workload + assignment) | 🟡 | ▓▓▓▓▓░░░░░ 50% — **workload engine complete and live** (doc 06: bands, thresholds, the BR-003 block with logged override, availability). Missing: the assignment recommendation UI (doc 07) |
| 5 | Dashboards & reporting | 🟡 | ▓▓▓▓▓▓░░░░ 60% — dashboard, workload and reports all live on real data. Missing: CSV export, the scheduled digest, editable settings |
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

### Step 1c — Interface redesign *(Session 08, owner-directed)*

Owner feedback: the interface looked pale and unprofessional, the theme toggle repainted everything including the sidebar, and the white plate behind the logo looked bad. Design decisions recorded in [doc 18 §6a, §6b, §6c, §9a](18-DESIGN-SYSTEM-AND-BRANDING.md).

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-105a | **Theme-invariant chrome** — `--sidebar-*` moved to a single `:root` block neither theme may redefine | doc 18 §6a | ✅ |
| T-105b | **Gold logo glow** replaces the white plate; `LogoPlate` withdrawn for `LogoGlow` | doc 18 §9a | ✅ |
| T-105c | Surfaces deepened, borders and shadows raised to visible values, `--page-ambience` | doc 18 §6b | ✅ |
| T-105d | Soft-tint formula so badges stay vivid **and** legible in both themes from one expression | FR-207, doc 18 §6c | ✅ |
| T-105e | Topbar given a real surface + breadcrumb; page headings moved into content | doc 10 §1 | ✅ |
| T-105f | Primitives upgraded: Card, Badge, Button, Avatar | — | ✅ |
| T-105g | New primitives: StatCard, Sparkline, TrendPill, ProgressBar/Ring, SegmentedBar, IconTile, PageHeader, ViewTabs, FilterChip, AvatarStack, PriorityFlag | — | ✅ |
| T-105h | Dashboard rebuilt and reordered around how the screen is used | doc 10 §7 | ✅ |
| T-105i | Placeholder pages restyled | — | ✅ |
| **Gate 1c** | **Reads as professional business software; sidebar constant across themes** | | ✅ **PASSED** |

> **Gate 1c evidence (2026-08-06):** verified in Chrome at 1600px in **both** themes. The rail is identical light and dark; the logo sits in a gold aura with no plate, no border and no visible edge, and the dark-teal wordmark is legible in both. All 12 routes return 200 with no build error. `npm run verify` clean.
>
> **Known, deliberate:** eight of the nine nav destinations are still phase placeholders — those screens belong to Phase 2 and Phase 5. The redesign covers the shell, the dashboard, the primitives and the placeholders.

### Step 2 — Data foundation *(Session 07)*

Migrations are the schema's single source of truth (registry **C-16**); `types/database.ts` is generated from the live database and never hand-edited. Contract for layer 1: [`lib/db/README.md`](../lib/db/README.md).

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-201a | **Registry first** — 5 conflicts resolved (C-13…C-17) + doc 04 deltas in §9a | doc 20 §10 | ✅ |
| T-201b | Migration **001** — `users`, `auth_identities`, `invitations`, `sessions`, schema `app` | FR-161, doc 04 §2b | ✅ |
| T-201c | Migration **002** — `mfa_factors`, `recovery_codes`, `login_attempts`, `break_glass` | FR-145, SA-9, doc 16 §6 | ✅ |
| T-201d | Migration **003** — `audit_log`, `security_events` + append-only **triggers** | FR-153, SA-10 | ✅ |
| T-201e | Migration **004** — `skills`, `user_skills`, `system_settings` | FR-012, FR-017 | ✅ |
| T-201f | Migration **005** — role `cni_app`, identity helpers, `user_directory`, all RLS | FR-157, ADR-003 | ✅ |
| T-201g | **Super Admin immutability trigger** — BR-027, FR-140, FR-156, BR-028, doc 03 §5, §3 | FR-140, FR-156 | ✅ |
| T-201h | Super Admin MFA floor — always ≥1 verified factor, rotation still allowed | FR-146 | ✅ |
| T-201i | Closed the `anon`/`authenticated` PostgREST surface on `public` | doc 16 §8 | ✅ |
| T-201j | Migration **006** — `search_path = ''` on all `app` functions; all 7 linter WARNs closed | doc 16 §9 A05 | ✅ |
| T-201k | Gate proof checked in — 35 assertions, `BEGIN…ROLLBACK`, safe against production | doc 20 §9 | ✅ |
| T-201l | `types/database.ts` generated from the live schema | C-16 | ✅ |
| T-201m | `.env.example` — every variable, and what breaks if it is wrong | doc 16 §8 | ✅ |
| **Gate 2** | **Trigger blocks a foreign write to a `super_admin` row (proven by test)** | | ✅ **PASSED** |

> **Gate 2 evidence (2026-08-06):** `lib/db/verify/005_super_admin_immutability.sql` — **35 assertions, 35 PASS**, re-run after migration 006 and still 35/35. Assertions 1–4 are the gate itself: an Admin, a Coordinator, a Member and an unidentified session are each refused a write to the `super_admin` row. Assertions ran as `postgres`, which has `BYPASSRLS` — so RLS was switched off entirely and the trigger held alone. Assertions 28–35 then re-ran as `cni_app` to check RLS separately: a Member sees exactly 1 of 5 `users` rows and 1 of 2 `auth_identities` rows, all 5 names via `user_directory`, 0 `security_events`, and cannot read `break_glass`, insert an Admin, or edit a colleague. Supabase security linter: **0 warnings**, 1 expected INFO (`break_glass` has RLS with no policies — doc 04 §5 requires exactly that). `npm run verify` clean.
>
> **Deliberately deferred, not forgotten:** the `queries/` layer and the `withUser()` helper → Step 4, with the code that needs them. Starter skills library → Step 6 (doc 20 §9, 6.1). Resend + SPF/DKIM/DMARC → **owner action**, needed by Step 5.

### Step 2b — Tasks screen *(Session 08, pulled forward from Phase 2 at owner request)*

Pulled forward the same way the app shell was in Session 06 — this is where the team spends its day, so it is the screen worth getting in front of them early.

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-207a | **List view** — grouped by status / project / assignee, collapsible groups | FR-081 | ✅ |
| T-207b | **Board view** — 8 columns, counts + effort totals, drag-and-drop | FR-082 | ✅ |
| T-207c | Working filters: priority, assignee, hide-closed | FR-081 | ✅ |
| T-207d | Task card — reference, project, priority stripe, effort, time-vs-limit, blocked reason, counts | doc 10 §3 | ✅ |
| T-207e | Drop legality driven by `permissions.can()` — refused columns explain themselves | BR-002, doc 10 §3 | ✅ |
| T-207f | Preview data expanded 6 → 18 tasks; status counts **derived**, not duplicated | — | ✅ |

> **Not yet, and stated in the UI:** nothing persists (query layer is Step 4), and the full transition table (doc 05 §2) arrives with `status-machine.ts` in Phase 2. Sorting and saved views are Phase 2/7.

### Step 3 — Domain: the permission matrix *(Session 08)*

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-118a | `lib/domain/permissions.ts` — doc 03 §3 as data, 79 actions × 4 roles | doc 03 | ✅ |
| T-118b | Frozen contract: `can()` / `requiresStepUp()` | doc 20 §5 | ✅ |
| T-118c | Conditional rules fail closed when context is missing | doc 16 §7 | ✅ |
| T-118d | Step-up set — every 🔒 in doc 03 §3 | FR-149 | ✅ |
| T-118e | Vitest installed; `verify` = typecheck → lint → **test** → build | — | ✅ |
| T-118f | Exhaustive suite: transcription + full cross product + prose scenarios | doc 20 §9 | ✅ |
| **Gate 3** | **100% of doc 03 §3 covered by passing tests** | | ✅ **PASSED** |

> **Gate 3 evidence (2026-08-06):** `npm run test` — **502 tests, 502 passing**, ~470ms. Three independent layers, because a test that reads the same table it is checking proves only that the reader works: (1) doc 03 §3 transcribed a **second** time in the test file and compared, (2) the full 79 × 4 cross product driven through `can()` with contexts built to satisfy **and** violate every conditional rule, (3) named scenarios written from the document's sentences — BR-002, BR-028, FR-156, FR-146, ADR-003, BR-003, BR-016, doc 03 §5.
>
> **Also delivered:** the Tasks board now calls `can()` for status changes, approvals and cancellations, so layer 4 holds no rules of its own — a working demonstration of the doc 20 §1 dependency direction.

### Step 4 — Authentication *(Session 08, in progress)*

| ID | Task | Req IDs | Status |
|---|---|---|:--:|
| T-116a | `lib/domain/lockout.ts` — lock **derived** from the append-only ledger, both anti-DoS properties tested | FR-148, FR-155a | ✅ |
| T-106a | `lib/domain/password-policy.ts` — NIST SP 800-63B; names the checks it cannot do | FR-147 | ✅ |
| T-114a | `lib/domain/session-policy.ts` — role-scoped TTLs, idle, absolute cap, step-up, context change | FR-149, FR-150 | ✅ |
| T-107a | **Migration 007** — the 13-function pre-auth `SECURITY DEFINER` surface | registry C-15 | ✅ |
| T-107b | Migrations **008** and **009** — two real defects the proof caught | doc 20 §7 | ✅ |
| T-107c | Gate proof `verify/007_pre_auth_surface.sql` — 32 assertions | — | ✅ **32/32** |
| T-106 | Argon2id hashing + breach check + blocklist wiring | FR-147, doc 16 §5 | ⬜ needs `.env.local` |
| T-114 | `queries/` layer + `withUser()` (registry C-14) | FR-150 | ⬜ needs `.env.local` |
| T-110 | MFA — TOTP verification, WebAuthn, recovery codes | FR-145 | ⬜ |
| T-115 | Step-up re-authentication wiring | FR-149 | ⬜ |
| T-116b | Sign-in, locked and forgot-password screens | doc 16 §3 | ⬜ |
| T-106 | Argon2id hashing — parameters chosen by measurement | FR-147 | ✅ |
| T-114 | `queries/` layer + `withUser()` (registry C-14, C-18) | FR-150 | ✅ |
| T-110 | TOTP verification, proven against RFC 6238 vectors | FR-145 | ✅ verification; enrolment → Step 5 |
| T-116b | `/login`, `/forgot-password`, `/mfa-setup` | doc 16 §3 | ✅ |
| T-107d | Migration 010 — pre-auth token issue + password write | registry C-15 | ✅ 9/9 |
| T-116c | Gate 4 integration suite — `npm run test:auth` | — | ✅ **13/13** |
| **Gate 4** | **Lockout, unlock and MFA work end to end** | | ✅ **PASSED** |

> **Gate 4 evidence (2026-08-06):** `npm run test:auth` — **13/13 against the real database**. Covers identity lookup, Argon2id verify/refuse, the 3-attempt lock, the anti-DoS property (a further attempt while locked does **not** extend it), emailed unlock → new password → lock cleared, verified-factors-only MFA with a real TOTP code, failed MFA counting toward the lock, session revocation on password change, and refresh-token reuse revoking every session.
>
> **Three real bugs were found by testing, none of them findable by reading:**
> 1. **C-18** — the pooler drops the URL role option, so the app connected as `postgres` with `BYPASSRLS` and **every RLS policy was silently skipped.**
> 2. **C-19** — the lockout was evaluated against the app's clock while the timestamps came from the database's. With 22 seconds of measured skew, **every fresh failure was discarded and the lock never tripped.**
> 3. The constant-time decoy hash was invented rather than real, so Argon2 rejected it during parsing and the 99ms timing oracle stayed open.
>
> Integration tests are deliberately **out** of `npm run test`: the moment a database is needed to run the unit suite, the unit suite stops being run.

### Step 4b — Dashboard readability *(Session 09, owner-directed)*

| ID | Task | Status |
|---|---|:--:|
| T-105j | **Legend rebuilt** — was three facts on one line, 6px apart, in 12px/11px grey | ✅ |
| T-105k | `PageSection` primitive — heading, numbered reading order, 32px spacing | ✅ |
| T-105l | Reordered: KPI cards first, one visualisation, detail last, caveat at the foot | ✅ |
| T-105m | Researched professional CRM dashboard structure before changing anything | ✅ |

> **Gate 4 progress (2026-08-06):** the rules are done and exhaustively tested (**599 domain tests**), and the database half is proven — `lib/db/verify/007_pre_auth_surface.sql`, **32/32**. What remains is the application layer, which cannot run until `.env.local` exists.
>
> **The proof earned its keep immediately.** It found two real defects in migration 007 on its first run: an enum cast that would have made every *failed* sign-in throw instead of being recorded (leaving the lockout ledger permanently empty), and an ambiguous column that would have made FR-150's response to a *stolen* refresh token throw — while the happy path worked perfectly in both cases. Both compiled and read correctly; plpgsql does not check statement bodies until they execute.

### Steps 5–7 — see [`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md) §9 for the gate on each
| T-103 | Provision Supabase + storage + Resend | — | 🟡 Supabase ✅ · Resend ⬜ owner |
| T-104 | Schema + migrations, incl. security tables (doc 04 §2b) | — | ✅ Phase 1 tables; Phase 2 tables later |
| T-105 | ~~`organisation_id` on every table~~ | — | ❌ Dropped — [ADR-008](decisions/ADR-008-single-tenant.md), single-tenant |
| T-105a | One-time Super Admin setup route that self-disables after use | ADR-009 | ✅ **Step 5.1** — `/setup` + migration 011, verified 8/8. Self-disabling is **structural**: migration 001's partial unique index permits one `super_admin` row ever, so the guard clause only exists to produce a readable error. |
| T-105b | Guided first-run wizard (empty system → working team) | ADR-009 | ⬜ |
| T-105c | Editable starter skills library (~35 entries with keywords) | FR-017, ADR-009 | ⬜ |
| T-106 | Password auth: Argon2id, breach check, blocklist, strength meter | FR-147, doc 16 §5 | 🟡 Argon2id ✅ + policy/blocklist ✅ (Step 4, Gate 4). **Breach-corpus check ⬜** — `validatePassword()` returns it in `pending`, named rather than silently skipped; it is a network call and arrives with 5.3. |
| T-107 | `auth_identities` table — SSO-ready, no future migration | FR-161 | ✅ Step 2 |
| T-108 | Activation-token invitation flow (hashed, single-use, 48h) | FR-142, FR-143 | ⬜ |
| T-109 | Optional temporary-password path (screen-only, never emailed) | FR-144 | ⬜ |
| T-110 | MFA: TOTP + WebAuthn/passkey + recovery codes | FR-145 | 🟡 TOTP ✅ (Step 4 — RFC 6238, proven against the spec's own vectors) · recovery codes ✅ issued at setup (Step 5.1, hash-only, shown once) · **WebAuthn ⬜** · **enrolment ceremony ⬜ → 5.3** |
| T-111 | Mandatory, undisableable MFA for Super Admin | FR-146 | ⬜ |
| T-112 | **Super Admin immutability**: DB trigger + RLS + server guard | FR-140, FR-156 | 🟡 DB trigger ✅ + RLS ✅ (Step 2, Gate 2). Server guard → Step 3–4; UI → Step 6 |
| T-113 | **"Forgot password"** — emailed one-time code + link, all 4 roles | FR-155, FR-155e | ⬜ |
| T-113a | **3-attempt lockout** + email unlock code + owner alert | FR-155a | 🟡 lockout ✅ and the unlock **path** ✅ (Step 4, Gate 4). The lock is **derived** from the append-only ledger, never counted in a column. **Sending the email ⬜ → 5.5** |
| T-113b | MFA required after email code for Super Admin and Admin resets | FR-155b, Q-039 | ⬜ |
| T-113c | Reset revokes all sessions + confirmation email with IP/location | FR-155c | ⬜ |
| T-113d | Recovery codes + sealed master credential backstops | FR-155d | ⬜ |
| T-113e | Email deliverability: SPF, DKIM, DMARC configured and verified | ADR-007 | ⬜ |
| T-114 | Session hardening: device binding, role TTL, rotation + reuse detection | FR-150 | ✅ Step 4, Gate 4 — opaque signed token, deliberately **not** a JWT so revocation is immediate and the role is never baked in |
| T-115 | Step-up re-authentication for 🔒 actions | FR-149 | 🟡 `requiresStepUp()` ✅ (Step 3, frozen contract) · the challenge UI ⬜ → Step 6 |
| T-116 | Rate limiting, progressive lockout, generic errors, timing normalisation | FR-148 | 🟡 3-attempt lockout ✅ + generic errors ✅ + timing normalisation ✅ (Step 4 — and the decoy hash had to be a **real** Argon2 hash; a malformed one is rejected during parsing in <1ms and leaves the oracle open). **Per-IP rate limiting ⬜** |
| T-117 | Login alerts + anomaly detection (new device/country/impossible travel) | FR-151, FR-152 | ⬜ |
| T-118 | Role enum (4 roles) + permission service | doc 03 | ✅ Step 3 — 79 actions, 502 tests |
| T-119 | Row-level security incl. **member isolation** | FR-157, ADR-003 | ✅ Step 2 — proven by direct DB query, not via the UI |
| T-120 | Immutable audit + security event logs (no UPDATE/DELETE grant) | FR-153 | ✅ Step 2 — trigger as well as grant; binds the table owner too |
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
| T-207 | List view with filter + sort | FR-081 | 🟡 List, grouping and filters ✅ (Step 2b). Sorting → Phase 2 |
| T-208 | Board view with drag-and-drop | FR-082 | 🟡 Board + DnD ✅ (Step 2b). Full transition table → Phase 2 with `status-machine.ts` |
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
| 2026-08-06 | 08b | **TASKS SCREEN (Step 2b) + PHASE 1 STEP 3 — Gate 3 PASSED, 502 tests.** Tasks screen pulled forward from Phase 2: list view with grouping by status/project/assignee and collapsible groups, board view with eight columns and drag-and-drop, working priority/assignee/hide-closed filters, task cards carrying priority stripe, effort, time-against-limit and blocked reason. Preview data expanded 6 → 18 tasks and status counts **derived** from them rather than kept as a second hand-written list. **Step 3:** `lib/domain/permissions.ts` — doc 03 §3 as a table, 79 actions × 4 roles, frozen `can()`/`requiresStepUp()` signatures, conditional rules that fail closed. Test suite built in three independent layers (second transcription of the doc · full cross product with satisfying and violating contexts · prose scenarios) because a test that reads the table it is checking proves nothing. Board rewired to call `can()`, so layer 4 holds no rules — a live demonstration of doc 20 §1. Vitest added; `verify` now runs typecheck → lint → test → build. | **Awaiting go-ahead for Step 4** |
| 2026-08-06 | 08 | **INTERFACE REDESIGN — Gate 1c PASSED.** Owner feedback that the CRM looked pale and unprofessional. Root causes found and fixed: the sidebar was **white** in light theme (a white rail beside a near-white page has no edge, so everything read as one flat sheet); page-vs-card was a 2% step; shadows sat at 0.06 alpha and borders were invisible; status was a 6px dot on a grey chip. **Theme-invariant chrome** added as a new token layer — the rail is now identical in light and dark, per the owner's instruction and matching ClickUp/Linear/Asana. **The white logo plate is gone**, replaced by a four-layer gold glow with a warm cream core centred on the whole artwork, so the dark-teal wordmark stays legible with no rectangle and no visible edge. Surfaces deepened, real elevation, `--page-ambience`. Badges became properly tinted pills with contrast that holds in both themes from one `color-mix()` expression. Eleven new primitives (StatCard, Sparkline, ProgressRing, SegmentedBar, …). Dashboard rebuilt and reordered around how the screen is actually used. Verified in Chrome, both themes. Docs 18 §6a/§6b/§6c/§9a amended. | **Step 3 authorised — next** |
| 2026-08-06 | 07 | **PHASE 1, STEP 2 — data foundation. Gate 2 PASSED, 35/35.** Registry first: five conflicts resolved in doc 19 §9 (**C-13** Supabase Auth vs doc 16 → **we implement our own auth**; **C-14** no `auth.uid()`, so RLS keys off `SET LOCAL app.user_id` under the `NOBYPASSRLS` role `cni_app`; **C-15** narrow pre-auth definer surface; **C-16** SQL migrations are the schema SSOT, types are generated; **C-17** `account_unlock` purpose) plus §9a for the doc 04 deltas. Migrations 001–006: full identity, MFA, recovery, append-only logs, skills, settings, RLS on all 13 tables, and the Super Admin immutability trigger. Two real holes found and closed — Supabase's default `anon`/`authenticated` grants on `public` (the anon key ships in the browser), and `user_directory` being an auto-updatable owner-run view, which writable would have been a total RLS bypass on `users`. Migration 006 cleared all 7 linter warnings. Gate proof checked in, `BEGIN…ROLLBACK`, safe against production. | **Awaiting go-ahead for Step 3** |
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
