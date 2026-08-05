# 🔄 SESSION STATE — Resume Point

> **Purpose:** if your power cuts, your internet drops, or a session ends unexpectedly, this file lets us pick up **exactly** where we stopped — with no lost context and nothing forgotten.
>
> **How to use it:** open a new session and paste the resume prompt in §1. That's it.

---

## 1. ▶️ RESUME PROMPT — copy and paste this into a new session

```
Resume the CNI CRM project.

Read these files first, in this order:
  1. docs/SESSION-STATE.md     (this file — where we stopped)
  2. docs/PROGRESS-TRACKER.md  (what's done, what's next)
  3. docs/00-INDEX.md          (map of all documentation)

Then continue from the "NEXT ACTION" in SESSION-STATE.md §3.
Do not restart or re-plan anything already marked complete.
```

That's all you ever need to type. Everything else is recorded in the files.

---

## 2. 📍 WHERE WE ARE RIGHT NOW

| | |
|---|---|
| **Last updated** | 2026-08-06, Session 06 |
| **Current phase** | **Phase 1 — Foundation & Security** |
| **Phase 1 progress** | ▓▓▓░░░░░░░ Step 1 + application shell complete |
| **Overall progress** | ▓▓▓▓▓░░░░░░░░░░░░░░░ 27% |
| **Code written** | ✅ Step 1 (scaffold, tokens, theming, constants) + shell, dashboard, 9 routes |
| **Currently blocked on** | **Nothing.** Awaiting go-ahead for Step 2 (data foundation). |

### What was completed in Session 06 (2026-08-06)

**Owner feedback addressed:** the Step 1 result was a design-token reference sheet, not a CRM screen. The shell was pulled forward from Step 7 so the look can be approved before six more steps are built on it.

**Logo — corrected**
- ❌ Removed the hand-authored SVG reconstruction from Session 05. **The supplied artwork is used as-is, always.**
- ✅ Aspect ratio locked in code: `<Logo>` takes one dimension and derives the other, so stretching is impossible rather than merely discouraged
- 🔍 **Found a real defect in the supplied PNG** — every pixel was opaque and the transparency chequerboard was painted into the image. A derived copy for `public/brand/` clears only background connected to the border by flood fill, preserving the white facet seams inside the mark. `logo/` is untouched.
- ✅ `LogoPlate` keeps the dark-teal wordmark legible on dark surfaces without altering the artwork
- ✅ Favicon now uses the real artwork

**Design — richer**
- Tinted page + white cards, so cards read as raised objects instead of dissolving into a flat white background
- Full sidebar palette for both themes

**Interface built**
- UI primitives: Card, Badge, Button, Avatar
- App shell: fixed sidebar, mobile drawer, top bar with search / notifications / theme / new-task
- Role-aware navigation, route-typed hrefs (a link to a non-existent page is now a compile error)
- **Admin dashboard**: KPI row, needs-attention list, team workload with bands, active work table with time-vs-limit, activity feed
- Placeholder pages for all 9 nav routes — nothing 404s
- Design system moved to `/design-system`
| **Dev server** | `npm run dev` → http://localhost:4310 |
| **Repository** | https://github.com/habibaminhas989-blip/cni-crm — **private**, branch `main` |
| **GitHub account** | `habibaminhas989-blip` · `gh` CLI v2.97.0 authenticated |
| **Supabase** | Project `rxjqbtvlzxigfakbiktw` already exists (see `mcp.json`) — used in Step 2 |

### What was completed in Session 05 (2026-08-06) — PHASE 1, STEP 1

**Gate 1: ✅ PASSED** — both themes render correctly, no flash, all tokens resolve.

- ✅ Next.js 16.3.0 · React 19.2.8 · TypeScript · Tailwind v4 · Turbopack
- ✅ `styles/tokens.css` — complete two-layer token system (raw palette → semantic), light + dark, plus a shadcn bridge so every future shadcn component inherits the brand automatically
- ✅ `app/globals.css` — Tailwind `@theme inline` mapping (runtime-swappable), type scale utilities
- ✅ `lib/domain/constants.ts` — every enum and numeric constant from doc 19 §4, with a **load-time assertion that score weights sum to 1.00**
- ✅ `lib/theme.ts` — pure resolution helpers + the pre-paint script
- ✅ `components/brand/theme-provider.tsx` — built on `useSyncExternalStore`
- ✅ `components/brand/theme-toggle.tsx` — compact toggle, segmented control, full Appearance setting
- ✅ `components/brand/logo.tsx` — vector reconstruction of the mark; facet seams track the surface so it works on light and dark from one source
- ✅ `public/brand/favicon.svg` — simplified mark for 16px
- ✅ `eslint.config.mjs` — **BR-025** (no raw hex in components) and **layer-2 purity** (no db/framework/React imports in `lib/domain/`, no `Date.now()`/`Math.random()`)
- ✅ `next.config.ts` — `allowedDevOrigins` for LAN testing, `typedRoutes`
- ✅ Dev/start port moved to **4310** — another project holds a service worker on 3000 that intercepts requests

**Verified:** `npm run verify` (typecheck → lint → build) passes clean. Theme switch, persistence across reload, no-flash on load, and correct asymmetric `--text-gold` resolution all confirmed in a real browser.

**Deferred to Step 7 (by design):** responsive verification at 375px — belongs with the app shell.

### Version control established (Session 05)

- ✅ `gh` CLI v2.97.0 installed; authenticated as `habibaminhas989-blip`
- ✅ Repo initialised, `.gitattributes` added (LF normalisation, binary handling)
- ✅ Commit identity uses GitHub's noreply address — commits link to the profile, real email stays private
- ✅ **Private** repo created and pushed: https://github.com/habibaminhas989-blip/cni-crm
- ✅ Verified no `.env`, key or credential files committed; `node_modules` excluded
- ⏳ **Q-049 update:** a transparent PNG of the logo now exists at `logo/Gemini_Generated_Image_*.png`. See §9 below for how it changes the plan.

### 🎨 Logo — revised plan after the transparent PNG arrived

The new asset is a **transparent raster**, not vector. That changes what each format is best for:

| Use | Asset | Why |
|---|---|---|
| Large stacked lockup (auth screens) | **PNG** | Full gradient/bevel fidelity of the original artwork |
| Sidebar, small sizes, favicon | **inline SVG** | Stays crisp at any size; seams track the surface colour |
| Wordmark in dark theme | **HTML text** (already built) | The PNG's wordmark is dark teal and would be unreadable on dark |

**Still worth having:** the true vector (AI/EPS/SVG) for print and large display. The PNG solves the dark-background problem but not scaling.

### What was completed in Session 04 (2026-08-06)

- ✅ **Logo analysed** — low-poly teal/gold brain dissolving into pixels, serif wordmark
- ✅ **[`18-DESIGN-SYSTEM-AND-BRANDING.md`](18-DESIGN-SYSTEM-AND-BRANDING.md)** — full palette from the mark, semantic tokens, **light/dark themes for every role**, typography, spacing, logo usage ([ADR-011](decisions/ADR-011-design-system.md))
- ✅ **Gold/amber collision found and resolved** — gold is brand chrome only, never a semantic state. Status and workload colours revised.
- ✅ **[`19-MASTER-SPECIFICATION-REGISTRY.md`](19-MASTER-SPECIFICATION-REGISTRY.md)** — canonical index of every FR, BR, enum, setting and table; document ownership map; **12 contradictions found and resolved**
- ✅ **[`20-IMPLEMENTATION-CONTRACTS.md`](20-IMPLEMENTATION-CONTRACTS.md)** — 4-layer architecture, module table ownership, dependency graph, frozen interfaces, 9 integration seams, migration safety, per-phase gates, concrete Phase 1 step order
- ✅ **Assignment weights corrected** — totalled 1.05, now exactly 1.00
- ✅ Contradiction fixes applied into docs 04, 05, 06, 07, 10
- ✅ Q-049 – Q-053 raised

> ⛔ **STANDING RULE — never start a phase without explicit permission.**
> The owner's instruction: *"Do not implement any phase without my permission. When I say to you to implement the phase then you will implement the phase. Go from each phase step by step but do not go all in on a single phase and then start doing all the things in one go."*
>
> This means: **(a)** wait for a clear go-ahead before starting any phase, **(b)** work through a phase step by step with the tracker updated as we go — not one uninterrupted burst, **(c)** stop at the phase boundary and wait again.

### What was completed in Session 03 (2026-08-06)

- ✅ **All blockers cleared.** Phase 0 complete.
- ✅ **No seeded roster** — the Admin creates team members in-app ([ADR-009](decisions/ADR-009-no-seeded-roster.md)). `TEAM-ROSTER-TEMPLATE.md` retired, replaced by [`templates/FIRST-RUN-SETUP-GUIDE.md`](templates/FIRST-RUN-SETUP-GUIDE.md)
- ✅ **Account recovery redesigned** — emailed one-time code for all 4 roles, 3-attempt lockout with email unlock ([ADR-007](decisions/ADR-007-account-recovery.md)). Doc 16 §6 rewritten. MFA added after the email code for Super Admin and Admin.
- ✅ **Single-tenant confirmed** — no `organisation_id` ([ADR-008](decisions/ADR-008-single-tenant.md))
- ✅ Company name: **Crescent Nova International (CNI)**
- ✅ **[`17-TASK-TIMERS-AND-TIME-LIMITS.md`](17-TASK-TIMERS-AND-TIME-LIMITS.md)** — time limits distinct from due dates, automatic status-driven timers, working-hours pausing, over-limit enforcement, Admin-only extensions, 9 further enhancements ([ADR-010](decisions/ADR-010-task-time-limits.md))
- ✅ Phase-by-phase permission recorded as a standing rule
- ✅ Q-039 – Q-048 raised

### What was completed in Session 02 (2026-08-06)

- ✅ Locked your answers: Q-002 (4 roles), Q-003 (members isolated), Q-010 (Asia/Karachi, Mon–Sat 09:00–17:00), Q-012 (Next.js + TS + Supabase + Tailwind), Q-015 (single-tenant now, SaaS later)
- ✅ Renamed the third role: *Team Lead* → **Team Coordinator**
- ✅ Wrote [`15-PROJECTS-AND-PROJECT-TYPES.md`](15-PROJECTS-AND-PROJECT-TYPES.md) — projects, the 5 project types, task↔project linkage, the "Other" category rules, the Member Activity Preview, and 12 further engineering enhancements
- ✅ Wrote [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) — threat model, credential provisioning chain, Super Admin hardening, break-glass recovery, OWASP/NIST coverage, incident runbook, Google SSO roadmap
- ✅ Wrote this file — crash-resume protocol
- ✅ Updated docs 00, 01, 02, 03, 04, 06, 09, 10, 13, 14 and the progress tracker for the new requirements
- ✅ Wrote ADR-001 through ADR-006 locking the decisions you made

### What was completed in Session 01 (2026-08-05)

- ✅ Full planning document set 00–14 drafted
- ✅ Progress tracker established
- ✅ Team roster template created
- ✅ 23 open questions raised

---

## 3. ⏭️ NEXT ACTION

> **Phase 1, Step 1 is complete and Gate 1 has passed.**
> Waiting for your go-ahead to begin **Step 2 — Data foundation**.

Phase 1 step order ([doc 20 §9](20-IMPLEMENTATION-CONTRACTS.md#9-phase-1--the-concrete-build-order)):

```
STEP 1  ✅ Scaffold + design tokens + theme provider + constants   GATE 1 PASSED
STEP 2  ⬜ Data foundation — Supabase, migrations 001–005, RLS,
           Super Admin immutability trigger
STEP 3  ⬜ Domain — permissions matrix + exhaustive tests
STEP 4  ⬜ Authentication — hashing, sessions, lockout, MFA, step-up
STEP 5  ⬜ Provisioning & recovery — setup route, invitations, forgot-password
STEP 6  ⬜ Team management — skills, members, profile, theme persistence
STEP 7  ⬜ Shell, first-run wizard, responsive pass, deploy to preview
```

**Step 2 needs from you:** a Supabase project (free tier) and a Resend account for email.
I will list the exact environment variables required before starting, so nothing is guessed.

Work proceeds **step by step**, with this file and the tracker updated after each one — not the whole phase in one burst. At the Phase 1 exit criteria ([doc 20 §8](20-IMPLEMENTATION-CONTRACTS.md)), work **stops and reports**, then waits for permission to begin Phase 2.

---

## 4. ✅ BLOCKERS — all cleared

| ID | Question | Answer |
|---|---|---|
| **Q-001** | Team roster | **Dissolved** — no seeded roster; the Admin builds the team in-app ([ADR-009](decisions/ADR-009-no-seeded-roster.md)) |
| **Q-030** | Super Admin recovery | Emailed one-time code for all 4 roles + 3-attempt lockout ([ADR-007](decisions/ADR-007-account-recovery.md)) |
| **Q-034** | Multi-tenancy | **No** — single-tenant ([ADR-008](decisions/ADR-008-single-tenant.md)) |
| **Q-022** | Company name | **Crescent Nova International (CNI)** |
| **Q-038** | Default capacity | **36 points/week** confirmed |

**10 new questions (Q-039 – Q-048) are open but none block Phase 1.** All have documented defaults in [`13-OPEN-QUESTIONS.md`](13-OPEN-QUESTIONS.md).

---

## 5. 🔒 DECISIONS ALREADY LOCKED — do not reopen these

| Decision | Value | ADR |
|---|---|---|
| Company | **Crescent Nova International (CNI)** | — |
| Roles | **Super Admin · Admin · Team Coordinator · Team Member** (4 roles) | ADR-002 |
| Super Admin immutability | Cannot be altered by anyone but himself. Enforced at DB, RLS, server, and UI layers. | ADR-002 |
| Member visibility | Members see **only their own** tasks, workload, and projects. They cannot see other members' roles, tasks, workload, or capacity. | ADR-003 |
| Timezone | **Asia/Karachi** | ADR-004 |
| Working week | **Monday–Saturday, 09:00–17:00** (48 nominal hours) | ADR-004 |
| Default capacity | **36 points/week** effective (75% of 48 nominal — see ADR-004) | ADR-004 |
| Tech stack | **Next.js 16 + TypeScript + Supabase (Postgres/Auth/Realtime/Storage) + Tailwind + shadcn/ui, on Vercel** | ADR-001 |
| Capacity model | Weighted **capacity points**, not raw task count. Task count is the secondary guard. | ADR-005 |
| Hard threshold | A real block. Admin/Super Admin may override with a typed, logged reason. Coordinator cannot override. | ADR-005 |
| Projects | Required in v1. 5 types: Event · Client · Business · Self-Promotion · Other. Every task belongs to exactly one project. | ADR-006 |
| "Other" category | Mandatory written description. Surfaced separately in every admin view. Warns above 15% of capacity. | ADR-006 |
| Credential provisioning | Super Admin → Admin → Coordinator/Member. **Passwords are never sent by email** — activation links only. | doc 16 §3 |
| **No seeded roster** | System ships with the Super Admin only. The Admin creates all team members in-app. | ADR-009 |
| **Account recovery** | "Forgot password" on all 4 roles → emailed 6-digit one-time code + link, 15-min, single use. **3 failed attempts locks the account**, cleared by emailed unlock code. Super Admin and Admin also provide MFA after the email code. | ADR-007 |
| **Multi-tenancy** | **None.** Single-tenant, built for CNI only. No `organisation_id`. | ADR-008 |
| **Task time limits** | Separate from due dates. Auto timer on *In Progress*, pauses outside Mon–Sat 09:00–17:00. Admin + Coordinator set limits; **only Admin grants extensions.** Over-limit = enforced stop-and-account. | ADR-010 |
| Google Sign-In | Deferred to Phase 7a. Schema designed now so no migration is needed later. | doc 16 §11 |
| **Brand & theme** | Palette derived from the CNI AI & Digital Division logo. Teal `#0E5C63` primary, gold `#D4A63C` accent. **Gold is never a semantic state.** Light/dark/system toggle for **every role** in Profile → Appearance. | ADR-011 |
| **Architecture** | 4 layers, dependencies point downward only. `lib/domain/` is pure — imports nothing from db, framework, or React. Workload and assignment store nothing; both are fully derived. | doc 20 |
| **Spec arbitration** | [doc 19](19-MASTER-SPECIFICATION-REGISTRY.md) §1 names the owner of each subsystem; §9 records all 12 resolved contradictions. **The registry decides, nothing else.** | doc 19 |
| **Phase permission** | **No phase starts without explicit go-ahead. Step by step within a phase, then stop and wait.** | §2 |

---

## 6. 📋 THE UPDATE PROTOCOL

**This file is updated at the end of every meaningful unit of work** — not just at the end of a session. That way a crash never loses more than one step.

Each update rewrites §2 (where we are), §3 (next action), and appends to §7 (log).

### The rule
> Before starting any new task: read §3.
> After finishing any task: update §2, §3, and §7, and tick the item in [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md).

### Two files, two jobs — don't confuse them
| File | Job |
|---|---|
| **`SESSION-STATE.md`** *(this file)* | **Where we stopped.** Short, current, volatile. Read first on resume. |
| **`PROGRESS-TRACKER.md`** | **Everything, ever.** The full checklist of all phases and tasks. The permanent record. |

---

## 7. 🗂️ SESSION LOG

| # | Date | What happened | Ended at |
|:--:|---|---|---|
| 01 | 2026-08-05 | Full planning set (docs 00–14), progress tracker, roster template, 23 open questions raised. No code. | Awaiting answers to Q-001, 002, 003, 010, 012 |
| 02 | 2026-08-06 | Answers locked. Roles expanded to 4 with Team Coordinator. Projects & project types subsystem designed (doc 15). Security & identity architecture designed (doc 16). Crash-resume protocol created (this file). All existing docs updated. ADR-001–006 written. 13 new questions raised (Q-024–Q-036). No code. | Awaiting Q-001, Q-030, Q-034, Q-022 |
| 03 | 2026-08-06 | **All blockers cleared — Phase 0 complete.** No seeded roster (ADR-009); roster template retired for `FIRST-RUN-SETUP-GUIDE.md`. Recovery redesigned around emailed one-time codes + 3-attempt lockout (ADR-007), doc 16 §6 rewritten. Single-tenant confirmed (ADR-008). Company name locked. **Doc 17 — task timers & time limits** (ADR-010). Phase-by-phase permission recorded as a standing rule. Q-039–Q-048 raised. No code. | **Awaiting go-ahead for Phase 1** |
| 04 | 2026-08-06 | Logo analysed; **doc 18** design system — palette from the mark, semantic tokens, light/dark for all roles (ADR-011). **Gold/amber collision** found and resolved; status and workload colours revised. **Doc 19** master registry — canonical index + document ownership + **12 contradictions resolved**. **Doc 20** implementation contracts — 4-layer architecture, module table ownership, dependency graph, frozen interfaces, 9 integration seams, per-phase gates, Phase 1 step order. Assignment weights corrected from 1.05 → 1.00. Fixes applied to docs 04, 05, 06, 07, 10. Q-049–Q-053 raised. **No code.** | **Awaiting go-ahead for Phase 1** |
| 05 | 2026-08-06 | **PHASE 1, STEP 1 — code begins.** Next.js 16.3 + React 19.2 + TS + Tailwind v4 scaffolded. Full design-token system (light/dark, semantic layer, shadcn bridge). Canonical constants with score-weight assertion. Theme provider on `useSyncExternalStore`, pre-paint script, toggle + segmented + Appearance controls. Logo rebuilt as theme-aware inline SVG. Lint rules enforcing BR-025 and layer-2 purity. Dev port moved to 4310 (service-worker collision on 3000). **Gate 1 PASSED** — verified in browser: both themes, no flash, persistence, correct gold-token asymmetry. `npm run verify` clean. | **Awaiting go-ahead for Step 2** |
| 06 | 2026-08-06 | **Logo corrected + application shell built.** SVG reconstruction removed; supplied artwork used as-is with aspect ratio locked in code. Diagnosed the chequerboard baked into the supplied PNG and produced a genuinely transparent derived copy (original untouched). Richer surface tokens. UI primitives, app shell, role-aware nav, admin dashboard, 9 placeholder routes. Standing rule adopted: push and document after every change. | **Awaiting go-ahead for Step 2** |
| 07 | — | *(next session)* | |

---

## 8. 🧭 IF YOU'RE COMPLETELY LOST

Read these three files, in this order, and you'll have the full picture in about ten minutes:

1. [`00-INDEX.md`](00-INDEX.md) — what every document is for
2. [`01-PROJECT-BRIEF.md`](01-PROJECT-BRIEF.md) — what we're building and why
3. [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) — exactly what's done and what isn't

If you want the short version of what makes this system different from ClickUp, read [`11-BENCHMARK-CLICKUP-AND-PEERS.md`](11-BENCHMARK-CLICKUP-AND-PEERS.md) §4 — it's one table.
