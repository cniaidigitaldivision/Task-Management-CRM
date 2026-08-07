# 🔄 SESSION STATE — Resume Point

> **Purpose:** if your power cuts, your internet drops, or a session ends unexpectedly, this file lets us pick up **exactly** where we stopped — with no lost context and nothing forgotten.
>
> **How to use it:** open a new session and paste the resume prompt in §1. That's it.

---

## 1. ▶️ RESUME PROMPT — copy and paste this into a new session

```
Resume the CNI CRM project.

Read these files first, in this order:
  1. docs/SESSION-STATE.md                     (where we stopped)
  1a. docs/BUILD-PLAN.md                       (the 8-step checklist — WHICH STEP IS NEXT)
  2. docs/OWNER-REQUESTS.md                    (my standing requests, verbatim)
  3. docs/PROGRESS-TRACKER.md                  (done vs remaining)
  4. docs/19-MASTER-SPECIFICATION-REGISTRY.md  (settles any doc conflict)
  5. docs/20-IMPLEMENTATION-CONTRACTS.md §9    (build order)

Then continue from the "NEXT ACTION" in SESSION-STATE.md §3.
Do not restart or re-plan anything already marked complete.
Honour every ✅ and 🔴 item in docs/OWNER-REQUESTS.md.
```

That's all you ever need to type. Everything else is recorded in the files.

### Quick environment reminders
| | |
|---|---|
| Run it | `npm run dev` → **http://localhost:4310** (not 3000 — a foreign service worker owns 3000) |
| Verify | `npm run verify` = typecheck → lint → build |
| **Live** | **https://cni-crm.vercel.app** — Vercel project `cni-crm`, auto-deploys on every push to `main` |
| Verify the live site | `npm run smoke -- https://cni-crm.vercel.app` — 25 checks, both roles |
| Repo | https://github.com/habibaminhas989-blip/cni-crm (private, `main`) |
| **Owner requests** | [`docs/OWNER-REQUESTS.md`](OWNER-REQUESTS.md) — verbatim standing rules and design decisions. **Survives an account switch. Read it before any UI work.** |
| Browser testing | Use `http://192.168.100.131:4310` — Chrome here cannot reach `localhost` |
| After changing `public/brand/` | Delete `.next` and restart, or the image optimiser serves the stale asset |
| **After adding a route** | Run `npm run build` **first**. `tsc` cannot see a new page until the typed-route manifest regenerates, so `verify` fails on a route that exists. |
| Control sizing | Never set a height on a control. Import from [`components/ui/control.ts`](../components/ui/control.ts) and check `/design-system` → **Controls**. |
| Database | Supabase `rxjqbtvlzxigfakbiktw`. Schema lives in `lib/db/migrations/`; contract for using it in [`lib/db/README.md`](../lib/db/README.md) |
| Re-prove the security gate | Paste `lib/db/verify/005_super_admin_immutability.sql` into the SQL editor or the MCP. Self-cleaning, safe against production. Every row must read PASS. |
| After any migration | Regenerate `types/database.ts`, re-run the gate proof, and run `get_advisors(security)` |

---

## 2. 📍 WHERE WE ARE RIGHT NOW

| | |
|---|---|
| **Last updated** | 2026-08-06, Session 11 |
| **Tests** | `npm run test` → **640** · `npm run test:auth` → **30/30** (real DB) · `npm run smoke` → **25/25** (every route, both roles) |
| **⛔ Credential hygiene** | Three secrets were pasted into chat in Session 09 (Resend key, DB password ×2 — one echoed by my own script's error output). **All must be rotated.** Never paste a secret; `npm run check:db` redacts and is safe to share. |
| **Current phase** | **Phase 1 — Foundation & Security** |
| **Phase 1 progress** | ▓▓▓▓▓▓▓▓░░ Steps 1–4 complete · **5.1 complete** · **Phase 2 work core pulled forward and operational** |
| **Overall progress** | ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░ 72% |
| **Code written** | ✅ Step 1 scaffold + tokens · shell + dashboard · **Step 1c redesign** · **Step 2 migrations 001–006, RLS, Super Admin trigger** · **Step 2b Tasks screen** · **Step 3 permission matrix** · **Step 4 authentication** · **Step 5.1 first-run setup** |
| **✅ Deployed** | Live on Vercel, environment variables set, 25/25 signed-in route checks green against the real URL. Super Admin created and enrolled; `/setup` verified CLOSED in production. |
| **✅ MFA enrolment** | Built (Session 12). QR code plus a copyable setup key, the code proven before anything is stored, and `requireEnrolledUser()` enforcing FR-145 at the application boundary rather than by redirect alone. |
| **📋 THE PLAN** | [`docs/BUILD-PLAN.md`](BUILD-PLAN.md) — 8 steps to a complete system, owner approves each one. **Read it before doing anything.** |
| **➡️ NEXT** | **BUILD-PLAN Step 5 — editable settings**, carrying the one Step 4 item left open: step-up re-authentication (FR-149). Steps 1–4 done. 649 unit · 70 integration. |
| **🔑 MFA_ENCRYPTION_KEY is load-bearing** | Authenticator secrets are encrypted at rest as of Step 4. Lose that key and every enrolled authenticator stops working permanently, for everyone — recovery codes become the only way in. Back it up somewhere that is not this machine. | It is now the one thing standing between the demo and a system the team can actually be onboarded into. See §3 and [`DEMO-GUIDE.md`](DEMO-GUIDE.md). |

### What was completed in Session 08, part 2 — TASKS SCREEN + STEP 3

**Gate 3: ✅ PASSED** — 502 tests, all passing, ~470ms.

**Tasks screen (Step 2b)** — pulled forward from Phase 2 at the owner's request, the same way the shell was in Session 06.
- **List view** grouped by status, project or assignee, with collapsible groups
- **Board view** — eight columns, counts and effort totals, drag-and-drop
- Working filters: priority, assignee, hide-closed. Real view switching.
- Cards carry reference, project, priority stripe, effort, time-against-limit, blocked reason, comment/attachment/checklist counts
- Preview data expanded 6 → 18 tasks; `PREVIEW_STATUS_COUNTS` now **derived** from them, so the dashboard and the board cannot disagree
- **Not yet, and the UI says so:** nothing persists (Step 4), and the full transition table (doc 05 §2) arrives with `status-machine.ts` in Phase 2

**Step 3 — the permission matrix**
`lib/domain/permissions.ts` is doc 03 §3 transcribed into a table: **79 actions × 4 roles**, in document order, with doc 20 §5's frozen signatures `can()` and `requiresStepUp()`. Conditional rules (`self`, `own_task`, `self_created`, `not_assignee`, `outranks`, `in_project`) **fail closed** — a check that cannot prove it should pass, does not pass.

The suite has three independent layers, because a test that imports the table it is checking proves only that the reader works:
1. **Transcription** — doc 03 §3 written out a *second* time in the test file and compared
2. **Behaviour** — the full 79 × 4 cross product through `can()`, each conditional exercised with contexts built to satisfy **and** to violate it
3. **Prose** — named scenarios from the document's sentences: BR-002, BR-028, FR-156, FR-146, ADR-003, BR-003, BR-016, doc 03 §5

**The board now calls `can()`** for status changes, approvals and cancellations, so layer 4 holds no rules of its own. The "Preview as" role picker makes it visible: switch to Member and the board stops accepting other people's cards.

**Vitest** added — first new dependency since Step 1, dev-only. `npm run verify` is now typecheck → lint → **test** → build.

**Not visually verified:** the Chrome extension disconnected partway through the session, so `/tasks` was checked by build and rendered output rather than by eye. Worth a look before Step 4.

### What was completed in Session 08 (2026-08-06) — INTERFACE REDESIGN

**Gate 1c: ✅ PASSED** — verified in Chrome at 1600px in both themes.

**Owner feedback:** the CRM looked pale and unprofessional; the theme toggle repainted the whole interface including the sidebar; the white plate behind the logo looked bad.

**Why it looked flat — four causes, all fixed**
1. The sidebar was **white** in light theme. A white rail beside a near-white page has no edge, so the whole interface read as one undifferentiated sheet. This was the single biggest cause.
2. Page `#f4f8f8` against card `#ffffff` — a 2% step, so cards dissolved into the background.
3. Shadows at `0.06` alpha and `1px #dde7e8` borders — both effectively invisible.
4. Status shown as a 6px dot on a grey chip, so every state looked identical from a foot away.

**Theme-invariant chrome** ([doc 18 §6a](18-DESIGN-SYSTEM-AND-BRANDING.md))
The `--sidebar-*` tokens now live in one `:root` block that **neither theme block may redefine**. The rail is identical in light and dark. Token names were unchanged, so no component needed editing. This is what ClickUp, Linear, Asana and Notion all do — the rail is where the brand lives all day, and it should not flip to white half the time.

**Gold logo glow** ([doc 18 §9a](18-DESIGN-SYSTEM-AND-BRANDING.md))
The white plate is gone. Four stacked layers: warm cream core, gold body, falloff to fully transparent, wide low-alpha bloom. No rectangle, no border, **no edge anywhere** — so the "white space" has no boundary left to notice. Two iterations were needed: a near-white core just looked like the plate again, and centring the bright point on the *mark* rather than the *whole artwork* left the dark-teal wordmark hard to read. Both fixed and re-verified.

**Depth, colour and primitives**
Surfaces deepened, borders and shadows raised to visible values, `--page-ambience` wash, softer radii. Badges are properly tinted pills whose contrast holds in both themes from one `color-mix()` expression (text mixed 70% toward `--text-primary`, which darkens on light and lightens on dark). Eleven new primitives: StatCard, Sparkline, TrendPill, ProgressBar, ProgressRing, SegmentedBar, IconTile, PageHeader, ViewTabs, FilterChip, AvatarStack, PriorityFlag, IconButton.

**Dashboard rebuilt**, reordered around how the screen is used: where the work stands → the four figures that matter → what needs me today → who is overloaded → detail.

**Known and deliberate:** eight of the nine nav destinations are still phase placeholders (restyled, but placeholders) — those screens belong to Phase 2 and Phase 5.

**One self-inflicted break worth noting:** a CSS comment was opened without its `/*`, which broke the build and the owner saw the error. Fixed, `.next` cleared, all 12 routes re-verified at 200.

### What was completed in Session 07 (2026-08-06) — PHASE 1, STEP 2

**Gate 2: ✅ PASSED** — 35 assertions, 35 PASS. Re-run after the hardening migration: still 35/35.

**Registry first, code second** (doc 20 §10). Reading the specs surfaced five real conflicts; all are recorded in [doc 19 §9](19-MASTER-SPECIFICATION-REGISTRY.md) with binding resolutions, and doc 04's deltas in §9a:

| | |
|---|---|
| **C-13** | Doc 09 §4 recommends **Supabase Auth**; doc 16 mandates our own Argon2id hashes, our own `sessions` table with device binding and rotation, a 3-attempt lock, our own MFA. **Doc 16 wins** (doc 19 §1 gives it every auth decision). ⇒ **We implement authentication ourselves. Supabase provides Postgres, Storage and Realtime — not Auth.** |
| **C-14** | That removes `auth.uid()`. RLS instead keys off a transaction-local identity: `SET LOCAL ROLE cni_app; SET LOCAL app.user_id = '…'`. `cni_app` is `NOBYPASSRLS`; `postgres` is not. **No identity ⇒ every predicate false** (fail-closed). |
| **C-15** | Verifying a password happens *before* an identity exists. That gap gets a narrow, named `SECURITY DEFINER` surface in schema `app` — **never a `postgres` connection**. Written in Step 4; the seam is documented now so it can't be filled in ad hoc. |
| **C-16** | `lib/db/migrations/*.sql` is the schema's single source of truth. `types/database.ts` is **generated**. Doc 20 §3's `schema.ts` would have been a second hand-maintained declaration — guaranteed drift. |
| **C-17** | `invitations.purpose` gains `account_unlock`: FR-155a's unlock keeps the existing password, so it is neither a reset nor an activation. |

**Built — enforced in the database, so it holds when the application is wrong**
- `super_admin` rows writable only by themselves (BR-027, FR-140) · no self-demotion, deactivation, suspension or lock (FR-156) · **at most one `super_admin` row, ever**, via a partial unique index (BR-028) · no account changes its own role · Admins manage downward only · **no user row is ever deleted** (BR-007)
- Super Admin always keeps ≥1 verified MFA factor (FR-146) — read as protecting the *invariant*, so replacing a lost phone still works
- `audit_log` / `security_events` / `login_attempts` append-only by **trigger** as well as revoked grants — a `REVOKE` cannot bind a table owner, and doc 19 §6 says "any role, including `super_admin`"
- `token_hash ~ '^[0-9a-f]{64}$'` — "the raw token is never stored" is now an invariant, not a promise
- `break_glass`: RLS on, **zero policies**, all privileges revoked (doc 04 §5)
- Member isolation proven **by direct database query**, not via the UI — the Phase 1 exit criterion, met early

**Two real holes found and closed**
- Supabase grants `anon` and `authenticated` everything in `public` by default — and the `anon` key ships inside the browser bundle. Revoked, default privileges included.
- `user_directory` is a simple single-table view running as its owner, which makes it **auto-updatable** in Postgres. Writable, it would have been a complete RLS bypass on `users`. Write privileges revoked explicitly.

**Migration 006** cleared all 7 Supabase linter warnings raised by 005 (`search_path = ''` on every `app` function; `EXECUTE` revoked from `PUBLIC` on the platform event-trigger function, which a revoke from `anon`/`authenticated` cannot reach). One INFO remains and is correct — `break_glass` has RLS with no policies, exactly as doc 04 §5 requires. The table comment says so, so nobody "fixes" it.

**Deliberately deferred, not forgotten:** the `queries/` layer and `withUser()` → Step 4, with the code that needs them. Starter skills library → Step 6 (doc 20 §9, 6.1). `system_settings` is intentionally **empty** — overrides only, falling back to `SYSTEM_DEFAULTS`.

**Owner action outstanding:** Resend account + SPF/DKIM/DMARC on the sending domain. Needed by **Step 5**, not before. See §3.

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
| **Supabase** | Project `rxjqbtvlzxigfakbiktw` — used from Step 2 |
| **Supabase MCP** | Configured in **`.mcp.json`** (project scope). Was named `mcp.json` and therefore never loaded — Claude Code only reads `.mcp.json`. Requires a Claude Code restart, then approval, then OAuth via `/mcp`. |

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

**State on close:** Phase 1 Steps 1 (Gate 1 ✅), 1b (Gate 1b ✅), 1c (Gate 1c ✅), **2 (Gate 2 ✅)**, 2b (Tasks screen) and **3 (Gate 3 ✅, 502 tests)** complete. Everything committed and pushed. Working tree clean. `npm run verify` clean — typecheck, lint, test, build.

### ✅ Step 4, part 1 is DONE (Session 08) — rules + database

**599 domain tests passing. Pre-auth database gate: 32/32.**

- `lib/domain/lockout.ts` · `password-policy.ts` · `session-policy.ts` — the rules, pure and exhaustively tested
- **Migration 007** — the 13-function pre-auth `SECURITY DEFINER` surface (registry C-15)
- **Migrations 008 and 009** — two real defects the proof caught on its first run
- `lib/db/verify/007_pre_auth_surface.sql` — the gate proof, self-cleaning, safe against production

The lock is **derived** from the append-only ledger, never counted in a column, and the rule lives in TypeScript only — SQL supplies the inputs and caches the verdict, so a security control has one implementation rather than two.

### ✅ Also done in Session 08 — the control scale, and the auth screens

**Owner feedback:** *"Some buttons are big and some are small. Some buttons and some dropdowns are bigger than the normal screen."*

Both had one cause: the tasks toolbar had five controls in a row at four different heights (28/30/32/36px), each styled by hand. Nothing was wrong individually — there was no shared scale to be wrong against.

- **`components/ui/control.ts`** is now that scale — 32/36/44px with matched padding, type, gap, icon size and one radius. Button, IconButton, Select, Input, SearchInput, FilterChip, ToggleGroup, ToggleButton and ThemeToggle all import from it. **No component sets its own height any more.**
- **The dropdowns** were bare `<select>` elements rendering the *operating system's* widget — its own font, its own height ignoring the one set, a chunky native arrow. Fixed with `appearance-none` plus our own chevron. Audited: **every `<select>` on every route now carries it, zero native widgets remain.** It stays a real `<select>` — reimplementing it as a div-and-listbox loses keyboard navigation, type-ahead, screen-reader semantics and the mobile picker.
- **"Bigger than the screen"** — controls must be `shrink-0` or flexbox squashes them unevenly, which makes a flex row exactly as wide as its contents; if that exceeds the viewport the *page* scrolls sideways. The new `Toolbar` wraps instead.
- **`/design-system` → Controls** shows one of everything, at every size, over a ruled guide. A control off the scale breaks the line there. **This is how it stays fixed, and how you can check it without a browser on my side.**

**Auth screens** — `/login` and `/forgot-password`. Pure UI, no database needed. FR-155e's never-reveal copy and FR-148's warn-before-lock are already correct on them, and both say plainly that they are not wired up.

### ✅ Session 09 — Step 4 COMPLETE (Gate 4 ✅) + dashboard readability

**Gate 4: ✅ PASSED — 13/13 integration tests against the real database.** `npm run test:auth`

Sign-in is live end to end: identity lookup → **lock checked before the password** → Argon2id → TOTP → device-bound session. Plus the emailed unlock path, session revocation on password change, and refresh-token reuse detection.

| Built | |
|---|---|
| `lib/auth/hashing.ts` | Argon2id, m=64MiB t=3 p=1 — **chosen by measurement** (14ms / 99ms / 130ms tried) |
| `lib/auth/tokens.ts` | 256-bit tokens bare-SHA256; 6-digit codes **peppered** (a million possibilities is enumerable) |
| `lib/auth/totp.ts` | RFC 6238, proven against the spec's **own known-answer vectors** |
| `lib/auth/session.ts` | Opaque signed cookie — deliberately **not** a JWT |
| `lib/db/client.ts` | `withUser()` / `withAppRole()` / `withBreakGlass()` |
| `lib/db/queries/auth.ts` | Typed wrappers, no logic |
| Migrations 007–010 | The pre-auth `SECURITY DEFINER` surface |
| `/login`, `/forgot-password`, `/mfa-setup` | Live screens |

#### ⚠️ THREE REAL BUGS FOUND BY TESTING, NOT REVIEW

1. **C-18 — the pooler drops the URL role option.** The app was connecting as `postgres`, which has `BYPASSRLS`, so **every RLS policy was being skipped, silently.** The role is now taken per transaction with `SET LOCAL ROLE`. Found by `npm run check:db`.
2. **C-19 — the lockout was evaluated against the wrong clock.** `login_attempts.created_at` is written by the *database*; `evaluateLockout()` was handed the *app's* clock. It discards future-dated attempts, so with **22 seconds of measured skew** every fresh failure was thrown away and **the lockout never tripped.** Found by the Gate 4 integration test — two assertions failed and "my test is wrong" was the wrong conclusion.
3. **The decoy hash for constant-time failure was invented rather than real.** Argon2 rejects a malformed hash *while parsing*, before allocating memory — so it returned in <1ms and left the 99ms timing oracle wide open.

None of these were findable by reading. Each lived at a seam that only an end-to-end check crosses.

#### Dashboard readability (owner feedback)

Researched professional CRM dashboard structure first (Salesforce, Domo, monday.com, template teardowns). The consistent pattern was the opposite of what had been built.

- **The legend was a genuine defect.** Three facts on one line, 6px apart, in 12px/11px grey — one grey smear rather than five numbers. Now a grid of discrete tiles with the count large and in primary text.
- **"Everything on top of each other" was literally spacing.** Five identical-weight blocks 16px apart with no headings. New `PageSection` primitive: heading, numbered reading order, 32px between sections.
- **KPI cards moved to the top.** The page used to open with a chart nobody had context for. The preview notice moved to the foot — it is a caveat, not a headline.

### ✅ Session 10 — Step 5.1 COMPLETE: the first-run Super Admin setup route

**Verified 8/8 against the live database, in a rolled-back transaction.** `npm run verify` clean — typecheck, lint, 640 tests, build.

This was chosen as the first slice of Step 5 because it unblocks everything else: until it exists there is no account to sign in as, so none of Step 4's working authentication can actually be used by a human.

| Built | |
|---|---|
| **Migration 011** | `app.setup_is_available()` and `app.setup_super_admin(full_name, email, password_hash, recovery_hashes[])`. The second creates the user, the password identity, ten recovery codes, a **CRITICAL** security event and an audit row **in one transaction** — a partial setup would leave an account that exists but cannot be signed into, in a system whose only remedy is the account it just failed to create. |
| `app/(auth)/setup/actions.ts` | Validates against `validatePassword({ role: 'super_admin' })` — a **16-character** minimum, not 12 (SA-2), because this is the one account worth attacking. Hashes with Argon2id, generates and hashes ten recovery codes, returns the plaintext codes **once**. |
| `app/(auth)/setup/page.tsx` | `force-dynamic`. If setup is already done it renders a closed-door page instead of a form that could only ever fail. |
| `app/(auth)/setup/setup-form.tsx` | On success, the ten codes in a 2-column mono grid with a print button and an explicit "I have saved them" step. The copy says outright that this is the only time they will ever be shown. |

#### Why "self-disabling" is not a flag

Migration 001's `users_single_super_admin_idx` — a partial unique index on `((true)) where role = 'super_admin'` — means at most one such row can exist in this database, **ever** (BR-028). Delete the guard clause and `setup_is_available()` entirely and the route is *still* single-use; the database refuses the second insert. Those two only exist so a second attempt produces a readable sentence instead of a unique violation.

That is the difference between a route that is *disabled* and one that is *impossible*, and it is why the constraint lives in an index rather than in a boolean somebody could flip back.

#### One defect the build caught

`await` inside a tagged template passed to a **non-async** arrow — `withAppRole((tx) => tx\`… ${await hashPassword(p)} …\`)` — is a syntax error, not a type error, so `tsc` never sees it; Turbopack rejected it. The hash and the code hashes are now computed into locals before the query. Worth remembering: anything awaited inside a `withUser`/`withAppRole` callback must be hoisted unless the callback itself is `async`.

### ➡️ NEXT: Step 5.2 — the invitation chain

FR-141's provisioning chain: Super Admin → Admin → Coordinator/Member. A `SECURITY DEFINER` issue-and-redeem pair over `invitations`, whose `token_hash ~ '^[0-9a-f]{64}$'` check (migration 001) already makes "we never store the raw token" a database invariant. 48-hour expiry, single-use, and the four `purpose` values including C-17's `account_unlock`.

**Passwords are never emailed** (doc 16 §3) — an invitation carries a link, and the invitee chooses their own password on activation (5.3).

Remaining in Step 5: **5.2** invitations · **5.3** activation + the MFA enrolment ceremony · **5.4** wiring `/forgot-password` to the real code path · **5.5** email templates and Resend (the only external dependency) · **5.6** login and anomaly alerts.

### What Step 4 involves

Password hashing (Argon2id, FR-147), sign-in, device-bound sessions with rotation and reuse detection (FR-150), rate limiting and the 3-attempt lockout (FR-155a), MFA — TOTP, WebAuthn, recovery codes (FR-145) — and step-up re-authentication (FR-149). Gate: lockout, unlock and MFA all work end to end.

It also builds the two pieces Step 2 deliberately deferred, both documented in [`lib/db/README.md`](../lib/db/README.md):
- the `queries/` layer and the `withUser()` helper that sets the RLS identity (registry C-14)
- the narrow pre-auth `SECURITY DEFINER` surface in schema `app` (registry C-15)

**Step 4 is the first step that needs `.env.local` filled in.** See §3's checklist below — in particular `DATABASE_URL` must end with `?options=-c%20role%3Dcni_app`, or the app connects as `postgres`, bypasses row-level security, and silently disables half the security model.

Phase 1 step order ([doc 20 §9](20-IMPLEMENTATION-CONTRACTS.md#9-phase-1--the-concrete-build-order)):

```
STEP 1  ✅ Scaffold + design tokens + theme provider + constants   GATE 1 PASSED
STEP 1b ✅ Application shell + dashboard + logo correction        GATE 1b PASSED
STEP 2  ✅ Data foundation — migrations 001–006, RLS,
           Super Admin immutability trigger                       GATE 2 PASSED
STEP 3  ⬜ Domain — permissions matrix + exhaustive tests
STEP 4  ⬜ Authentication — hashing, sessions, lockout, MFA, step-up
STEP 4  ✅ Authentication — hashing, sessions, lockout, MFA, step-up  GATE 4 PASSED
STEP 5  🔶 Provisioning & recovery
           5.1 ✅ first-run Super Admin setup route (migration 011, 8/8)
           5.2 ⬜ invitation chain — hashed token, 48h, single-use
           5.3 ⬜ activation + MFA enrolment ceremony
           5.4 ⬜ forgot-password wired to the real code path
           5.5 ⬜ email templates + Resend
           5.6 ⬜ login and anomaly alerts
STEP 6  ⬜ Team management — skills, members, profile, theme persistence
STEP 7  ⬜ Shell, first-run wizard, responsive pass, deploy to preview
```

### What Step 3 involves

`lib/domain/permissions.ts` — the whole of [doc 03 §3](03-ROLES-AND-PERMISSIONS.md) as **data**, not scattered `if` statements, plus exhaustive tests covering every role × every action. Layer 2, so it stays pure: no database, no framework, no clock.

**It needs nothing from you** — no credentials, no accounts, no decisions. Doc 03 §3 is already complete and the gate is a test suite. It will also need a test runner installed (Vitest), which is the first new dependency since Step 1.

### 🔧 Two things only you can do — neither blocks Step 3

**1. Resend + email deliverability — needed by Step 5, not before**
- Create a free Resend account (3,000 emails/month covers 7 people comfortably)
- Verify the sending domain, and set up **SPF, DKIM and DMARC** on it
- This one genuinely matters: the entire account-recovery design ([ADR-007](decisions/ADR-007-account-recovery.md)) depends on a reset email actually arriving. Without those three records it lands in spam, and a locked-out user stays locked out.

**2. Fill in `.env.local` — needed by Step 4**
- `cp .env.example .env.local`, then fill it in. [`.env.example`](../.env.example) lists every variable, says which step needs it, and says what breaks if it is wrong.
- **Do not send me any of these values.** I don't need them — the database work goes through the Supabase MCP, which authenticates as you.
- The one item worth reading twice: `DATABASE_URL` must end with `?options=-c%20role%3Dcni_app`. Without it the app connects as `postgres`, which bypasses row-level security, and half the security model silently stops applying. [`lib/db/README.md`](../lib/db/README.md) §2 explains why.

### Two questions answered by default, reversible on request

Both were ambiguities in the specs that the trigger and the policies had to settle. Full reasoning in [doc 13](13-OPEN-QUESTIONS.md):

- **Q-054** — "Admin sees the audit log, *own scope*" was never defined. Built as: an Admin reads everything **except entries whose actor was the Super Admin.**
- **Q-055** — Does the automatic 3-attempt lock apply to the Super Admin? Built as: **yes.** The alternative is unlimited password guesses against the most valuable account in the system. He cannot lock *himself* (FR-156), and nobody else can lock him either.

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
| **Authentication** | **Our own, not Supabase Auth.** Argon2id in `auth_identities`, our own `sessions` table with device binding, role-scoped TTL, rotation + reuse detection. Supabase supplies Postgres, Storage and Realtime only. | doc 19 §9 **C-13** |
| **RLS identity** | No `auth.uid()`. Every request opens a transaction and declares itself: `SET LOCAL ROLE cni_app; SET LOCAL app.user_id = '…'`. `cni_app` does **not** bypass RLS; `postgres` does. No identity set ⇒ every predicate false. | doc 19 §9 **C-14** |
| **Schema SSOT** | `lib/db/migrations/*.sql`. `types/database.ts` is **generated** and never hand-edited. There is no `schema.ts`. | doc 19 §9 **C-16** |
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
| 07 | 2026-08-06 | **PHASE 1, STEP 2 — DATA FOUNDATION. GATE 2 PASSED, 35/35.** Registry first: five conflicts resolved (C-13 → **we implement our own auth**, Supabase is Postgres/Storage/Realtime only; C-14 → RLS keys off `SET LOCAL app.user_id` under the `NOBYPASSRLS` role `cni_app`, fail-closed; C-15 → narrow pre-auth definer surface; C-16 → SQL migrations are the schema SSOT and types are generated; C-17 → `account_unlock` purpose), plus doc 04 deltas in §9a. Migrations 001–006 applied: identity, MFA, recovery codes, break-glass, append-only audit and security logs, skills, settings, RLS on all 13 tables, and the Super Admin immutability trigger enforcing BR-027, FR-140, FR-156, BR-028, FR-146, doc 03 §5 and §3. Found and closed two real holes: Supabase's default `anon`/`authenticated` grants on `public`, and `user_directory` being an auto-updatable owner-run view. Migration 006 cleared all 7 linter warnings. 35-assertion gate proof checked in, `BEGIN…ROLLBACK`, safe against production. Types generated. `.env.example` written. Q-054 and Q-055 raised and built to defaults. | **Awaiting go-ahead for Step 3** |
| 08 | 2026-08-06 | **INTERFACE REDESIGN — Gate 1c PASSED.** Owner: the CRM looked pale and unprofessional. Root cause was the **white sidebar in light theme** — no edge against a near-white page, so the whole interface read as one flat sheet — compounded by a 2% page-vs-card step, 0.06-alpha shadows and 6px status dots. **Theme-invariant chrome** added as a new token layer so the rail is identical in both themes. **White logo plate replaced by a four-layer gold glow** with a warm cream core centred on the whole artwork, keeping the dark-teal wordmark legible with no rectangle and no visible edge. Surfaces deepened, real elevation, tinted badge formula that holds contrast in both themes, eleven new primitives, dashboard rebuilt and reordered. Docs 18 §6a/§6b/§6c/§9a amended. Verified in Chrome in both themes; all 12 routes 200. | **Step 3 authorised — next** |
| 08b | 2026-08-06 | **TASKS SCREEN + STEP 3 — Gate 3 PASSED, 502 tests.** Tasks screen pulled forward from Phase 2: list with grouping and collapsible groups, board with eight columns and drag-and-drop, working filters, rich cards. Preview data 6 → 18 tasks with **derived** status counts. **Step 3:** `lib/domain/permissions.ts` — doc 03 §3 as a table, 79 actions × 4 roles, frozen signatures, conditional rules failing closed. Test suite in three independent layers (second transcription · full cross product · prose scenarios). Board rewired to call `can()`. Vitest added; `verify` now includes tests. | **Awaiting go-ahead for Step 4** |
| 09 | 2026-08-06 | **STEP 4 COMPLETE — GATE 4 PASSED, 13/13 against the real database.** Argon2id (parameters chosen by measurement), peppered short codes, hand-written RFC 6238 TOTP proven against the spec's own vectors, opaque device-bound sessions with rotation and reuse detection, `withUser`/`withAppRole`/`withBreakGlass`, migrations 007–010, and the `/login`, `/forgot-password`, `/mfa-setup` screens. **Three real bugs found by testing, none findable by reading:** C-18 the pooler drops the URL role option so RLS was being bypassed silently; C-19 the lockout was evaluated against the app's clock against a 22-second skew and so never tripped; and the constant-time decoy hash was invented rather than real, so Argon2 rejected it during parsing in <1ms and left the timing oracle open. Dashboard readability rebuilt after owner feedback (legend as tiles, KPI cards first, `PageSection` spacing) following research into professional CRM dashboards. Hover-collapse rail built, then **corrected to push rather than cover** at the owner's direction, then corrected again so the collapsed icons no longer jump. `docs/OWNER-REQUESTS.md` created so the owner's standing rules survive an account switch. | **Step 5 authorised** |
| 10 | 2026-08-06 | **STEP 5.1 COMPLETE — the first-run Super Admin setup route, verified 8/8.** Migration 011 adds `app.setup_is_available()` and `app.setup_super_admin(…)`, the latter creating the user, password identity, ten recovery codes, a CRITICAL security event and an audit row in one transaction. `/setup` renders the form only while no Super Admin exists and shows the ten recovery codes exactly once, with a print step. Single-use is **structural** — migration 001's partial unique index permits one `super_admin` row ever, so the guard clause exists only to produce a readable error. Fixed a stale comment in `sidebar.tsx` that still described the rail as overlaying the content, contradicting owner decision D7. `npm run verify` clean: 640 tests, build green, `/setup` correctly dynamic. | **Awaiting go-ahead for Step 5.2** |

---

## 8. 🧭 IF YOU'RE COMPLETELY LOST

Read these three files, in this order, and you'll have the full picture in about ten minutes:

1. [`00-INDEX.md`](00-INDEX.md) — what every document is for
2. [`01-PROJECT-BRIEF.md`](01-PROJECT-BRIEF.md) — what we're building and why
3. [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md) — exactly what's done and what isn't

If you want the short version of what makes this system different from ClickUp, read [`11-BENCHMARK-CLICKUP-AND-PEERS.md`](11-BENCHMARK-CLICKUP-AND-PEERS.md) §4 — it's one table.

---

## 10. 🎨 SESSION 09 (part 2) — hover-collapse rail + readability

**Owner request:** the nav rail should collapse to icons when the cursor leaves it and expand on hover; the logo space should be used well when narrow; the workload bars and percentages are too small to read.

### Hover-to-expand rail
- Rail is **72px at rest** on desktop (`--sidebar-width-collapsed`), **264px on hover**, 240ms.
- ⚠️ **It PUSHES the content, it does not cover it.** *(Corrected after the owner tried the first version.)* My initial choice was to overlay, reasoning that pushing reflows the layout on mouse-over. The owner was clear that covering the dashboard is worse — hiding part of the page to reveal a menu defeats the point of the menu. The content is left-padded by `--rail`, which tracks the rail width and animates with it at the same 240ms, so the page narrows and re-centres.
- `has-[aside:hover]` on the shell root is what lets a **sibling** react to the rail being hovered. `group-hover` cannot do it — hovering anywhere in the shell would trigger it.
- Labels, section headings, counter chips and the footer text fade with `lg:opacity-0 lg:group-hover/rail:opacity-100`. The rail is `overflow-hidden`, so they are clipped; the opacity transition is what stops the clipping being visible mid-animation.
- **Mobile is untouched** — it stays a full-width drawer. All the collapse rules are `lg:`-prefixed.

### Logo at 72px
Two logos, CSS-swapped: the compact glowing mark at rest, the full lockup on hover. Clipping the 4:3 artwork to 72px would show its left edge, which looks broken rather than deliberate.

### Workload readability
`ProgressBar` `sm` → `lg`, avatar `sm` → `md`, and the percentage from `text-body-sm` to `text-h3`. That bar answers *"how loaded is this person?"* — the question the whole capacity model exists for — and it was the smallest element on screen carrying the most important number.

### Scope note — recorded so it is not misread later
The owner clarified that **sales management and workflow automation are NOT wanted** and were offered only as examples of what professional CRMs contain. They are a possible *future* direction once the system is in real use. **Do not implement them.** Doc 01's scope is unchanged.

### Still not visually verified by Claude
No browser on this side for several sessions. Everything builds and every route returns 200, but the hover animation in particular is the kind of thing that needs an eye on it.
