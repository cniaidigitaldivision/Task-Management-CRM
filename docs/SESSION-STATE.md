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
| **Last updated** | 2026-08-09, Session 22 |
| **Tests** | `npm run test` → **958** · `npm run test:auth` → **141** (real DB) · `npm run smoke` → **27/27** (every route, both roles) |
| **⛔ Credential hygiene** | Three secrets were pasted into chat in Session 09 (Resend key, DB password ×2 — one echoed by my own script's error output). **All must be rotated.** Never paste a secret; `npm run check:db` redacts and is safe to share. |
| **Current phase** | **Phase 1 — Foundation & Security** |
| **Phase 1 progress** | ▓▓▓▓▓▓▓▓░░ Steps 1–4 complete · **5.1 complete** · **Phase 2 work core pulled forward and operational** |
| **Overall progress** | ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░ 72% |
| **Code written** | ✅ Step 1 scaffold + tokens · shell + dashboard · **Step 1c redesign** · **Step 2 migrations 001–006, RLS, Super Admin trigger** · **Step 2b Tasks screen** · **Step 3 permission matrix** · **Step 4 authentication** · **Step 5.1 first-run setup** |
| **✅ Deployed** | Live on Vercel, environment variables set, 25/25 signed-in route checks green against the real URL. Super Admin created and enrolled; `/setup` verified CLOSED in production. |
| **✅ MFA enrolment** | Built (Session 12). QR code plus a copyable setup key, the code proven before anything is stored, and `requireEnrolledUser()` enforcing FR-145 at the application boundary rather than by redirect alone. |
| **📋 THE PLAN** | [`docs/BUILD-PLAN.md`](BUILD-PLAN.md) — 8 steps to a complete system, owner approves each one. **Read it before doing anything.** |
| **➡️ NEXT** | 🔴 **Waiting on the owner: what the supplied `CNI-AI-Digital-Task-Board.html` is meant to become** ([REDESIGN-PLAN §9](REDESIGN-PLAN.md)) — it was never in any plan, which is why nothing was ever built against it. Also unfinished and needing permission: **persisting board order** needs a migration ([§8.5](REDESIGN-PLAN.md)). All 8 build steps and redesign phases 1–8 are complete. 947 unit · 133 integration · 27 smoke. The owner has confirmed `SUPABASE_STORAGE_KEY` and `CRON_SECRET` are now set. |
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

> ### 📋 FOR A MID-BATCH RESUME, READ [`WORK-LOG.md`](WORK-LOG.md) FIRST
> This file records where we are **between batches**. That is too coarse to
> resume from if a session dies halfway through one.  §1 names the
> exact next action and §2 lists every finished step with its proof. Owner
> instruction, Session 23.


### ✅ Session 22 — CHANGE-PLAN Batch 2 COMPLETE

`958 unit · 141 integration · 27/27 smoke · every part checked in Chrome.`

**Next: Batch 3 (forms) — awaiting the go-ahead.**

#### Avatars (2.3)

Bucket `avatars` provisioned with the owner's approval: **public**, 2 MB,
JPEG/PNG/WebP only. `attachments` stays **private** — that was a deliberate
Step 7 fix and is untouched. An attachment is work and a permanent URL to one is
access forever; an avatar is a face drawn on every card, where a signing round
trip per person per page would protect a photograph the same people are already
looking at.

**Which makes the file check the important part.** A public bucket serves what
it is given, and an SVG is a document that can carry script.
`lib/storage/bucket.ts` decides the type from the file's **magic bytes**, never
from `File.type` — a claim by the client, not an inspection. Verified: an SVG
containing `<script>alert(1)</script>` declared as `image/png` was refused and
nothing reached the bucket.

**One component did it everywhere.** Every screen already rendered
`<Avatar name=… />`; adding `src` to that primitive put faces on the board, the
list, the drawer, Team, Workload, the dashboard and the rail at once. Initials
stay underneath, so a 404 falls back rather than showing a broken image.

**Resized in the browser** to 256px before sending — measured on a real upload,
560,200 bytes → 5,093. Canvas output carries no EXIF, so a phone photo's GPS
coordinates never leave the device. That is convenience, not a boundary; the
magic-byte check is the boundary.

**Two things the browser test caught:** a refused upload kept its preview, so a
rejection appeared to delete the existing picture; and `loading="lazy"` was
wrong for avatars — browsers defer lazy images entirely in a background tab, so
a board opened in a second tab showed no faces until it was looked at.

### ✅ Session 22 (part 1) — the impact dialog, Cancel, and Purge (migration 019)

**Built and verified in Chrome:** the shared impact dialog (2.1), bulk **Cancel
work**, and **Purge** — which needed migration 019 and the owner's approval to
be possible at all. **Still to do:** avatars (2.3).

**The blocker, measured rather than assumed:**

```
policies on public.tasks →  tasks_select (r)  tasks_insert (a)  tasks_update (w)
rows deleted as SUPER ADMIN via cni_app → 0
```

`public.tasks` had row-level security enabled and **no DELETE policy** — since
migration 013, through eight further migrations. With RLS on, a command with no
policy is refused for every row, and the refusal is **silent**: the statement
succeeds and reports zero rows. It would have reported success.

Session 11 hit this exact trap once already: *"the RLS delete policy being
Super-Admin-only meant an Admin's Reset deleted zero rows with no error."*

Worse: `purgeTasksAction` removes the attachment **storage objects first**, on
purpose — Postgres cascades every child table but cannot reach into Supabase
Storage, so deleting the rows first would lose the only record of which objects
to remove. Shipping it would have destroyed the files and left the tasks there.

**Migration 019 closed it.** `DELETE` was already granted to `cni_app` — only
the policy was absent, so the grant made it look permitted while RLS refused
every row:

```sql
create policy tasks_delete on public.tasks for delete to cni_app
  using (app.current_user_role() = 'super_admin');
```

Proven by `test/integration/task-purge.test.ts` — 8 assertions, every
destructive case inside a rolled-back transaction, re-read afterwards on a
**fresh** connection so a rollback that did not take fails loudly. Super Admin
deletes 1 row; an Admin and a Member delete 0; comments, checklist items, time
entries and watchers all cascade; and the audit trail **survives**, because
`entity_id` is a snapshot rather than a foreign key.

Then end to end in the browser as the Super Admin on a throwaway task: **Purge**
appeared (Admins do not see it), the dialog required the reference to be typed,
and afterwards the row was gone, its comment had cascaded, and `audit_log` held
a `task.purged` entry naming `ZZZ-8369`.

**`purgeTasksAction` now also fails outright if it destroyed nothing**, rather
than reporting a success that did not happen — and says so explicitly when
attachment files have already been removed from storage.

> A dead control is exactly what opened this batch — B1's Add task had no
> handler, B4's calendar tab was `disabled: true`. Shipping a third would have
> been worse than shipping nothing.

**Also built:** the per-task **Delete had no confirmation at all** and deleted on
a single click. It now opens the same impact dialog.

### ✅ Session 21 — CHANGE-PLAN Batch 1 COMPLETE: all nine bugs

`958 unit (11 new) · 133 integration · 27/27 smoke · every fix checked in Chrome.`

**Next: Batch 2 (tasks and the board) — awaiting the go-ahead.**

Three of the nine were not what they looked like.

**B2 — the password reset that "went black and got stuck" was not the reset.**
Replayed every database step against the real database: all five succeeded. The
fault was in `components/ui/dialog.tsx`, which **every dialog in the application
shares**, and it was two defects:

1. The open/close effect was keyed on `[open]`, so it only ran when that prop
   changed. `router.refresh()` re-renders the server tree, React reconciles, and
   the `<dialog>` node can be **recreated — and a recreated node is not open**,
   because `showModal()` state lives on the element, not in React. Measured in
   Chrome: `open` was `true`, the children were in the DOM, `dialog.open` was
   `false`. The confirmation was rendered and invisible.
2. The scroll lock was per-dialog. `PersonActions` closes its confirmation and
   opens its result dialog **in the same commit**, and the restore order decided
   whether the page stayed locked. Intermittent, hence "sometimes".

Two more in the caller: `run()` had **no try/catch**, so a thrown action left the
dialog open with a spinner forever — for every action on that menu, not just the
reset — and the refresh destroyed the result before it could be read.

Now: one **reference-counted** scroll lock for the whole app, the sync effect
runs every render, dialogs close on unmount, `try`/`catch`, and the refresh waits
until the result is dismissed.

**B3 — the localhost link was five copies of one line.** Replaced by
`lib/app-url.ts`, which derives the origin from the request. 11 unit tests.
⚠️ The environment variable still wins **on purpose** — a fixed value cannot be
influenced by a request header, and host-header poisoning in a reset email is a
real attack. Which is also the true cause: **`.env.local` pins
`NEXT_PUBLIC_APP_URL=http://localhost:4310`.** See the owner action below.

**B1 — the Add-task button was exactly as dead as it looked**: a `<button>` with
a class and no handler.

The rest — B4 calendar tab (`disabled: true`), B5 assignee pre-select, B6 refresh
that clears `?assignee=`, B7 "Add member", B8 "Lead", B9 scale dropdown — were as
described. Full detail and the browser evidence in
[`CHANGE-PLAN.md`](CHANGE-PLAN.md) §1.

> ⚠️ **OWNER ACTION — remove `NEXT_PUBLIC_APP_URL` from `.env.local`.** It is
> pinned to `http://localhost:4310`, which is why links said localhost even when
> the page was opened over the LAN. Delete or blank the line and the origin
> follows whatever host was used. `.env.example` now explains it. **Check Vercel
> too** — if it is set there it must be the real URL; if unset, links are now
> derived correctly instead of defaulting to localhost.

> **Worth remembering:** `router.replace()` and `router.refresh()` must not both
> fire on one click. Together they left the URL untouched — the filter reset
> while `?assignee=…` stayed in the address bar, because `refresh()` re-fetches
> the *current* route and raced the navigation.

### 🔴 THE OTHER 17 — planned, not built (Session 20)

The owner gave 26 separate changes in one instruction — **9 bugs and 17
features** — with the explicit sequence *"ask me questions… confirm to me every
single thing… and after I have confirmed, document them, then implement them."*

**Nothing has been built.** The plan is [`CHANGE-PLAN.md`](CHANGE-PLAN.md), in
seven batches, starting with the bugs by the owner's choice.

Twelve decisions were taken before writing it, all recorded in that file. The
three worth knowing without opening it, because each one **narrowed or reversed
what was literally asked for**:

1. *"Make the Clear button's functionality deleting the selected task"* →
   **Clear stays Clear.** A separate **Cancel selected** is added instead, plus
   **Purge** for the Super Admin behind step-up. A button that silently changed
   from "deselect" to "destroy" is the worst possible reading of that sentence.
2. *"Delete"* → **Cancel** (reversible) for everyone; **Purge** (irreversible)
   Super Admin only. `task.purge` has been in the permission matrix since Step 3
   and has never had a screen.
3. *"Pagination after every 12 or 13 rows"* → **tables and lists only, 12 rows.**
   Not the board: dragging a card to a task on another page is impossible, so
   paging the board would break what Sessions 17–19 fixed.

**Four things need the owner before those parts can be built:** a public Supabase
bucket for avatars (`attachments` stays private — that was a deliberate Step 7
fix), a migration for per-type project fields (rule R1), one new dependency for
real `.xlsx` export, and the Resend sending domain.

**Next action: the owner approves the plan, then Batch 1 (the nine bugs) begins.**

### ✅ Session 19 — the board's horizontal scrollbar follows you down the page

Owner: *"the scrollbar is literally at the bottom — I don't want to scroll down
to the bottom just for moving to the right."* The board is 2,420px wide against
~1,454px of room (966px of overflow) and as tall as its fullest column, so its
bar sat ~2,100px down the page.

Six options were offered; the owner chose **the floating bar**
([REDESIGN-PLAN §8.6](REDESIGN-PLAN.md)). New primitive
[`components/ui/floating-scrollbar.tsx`](../components/ui/floating-scrollbar.tsx),
reusable for any wide scroller.

- A scrollbar-height proxy holds a spacer exactly as wide as the real content, so
  its bar has identical proportions; the two scroll positions are mirrored.
- `position: sticky; bottom: 0` needs **no measurement at all** — it rides the
  bottom of the screen while the board's end is off-screen and parks under the
  board when that end arrives.
- The board's own bar is hidden with `.scrollbar-hidden`, which suppresses the
  BAR only. Wheel, shift-wheel, trackpad, keyboard and the drag auto-scroll all
  still drive the real element. **One bar, always reachable.**
- The legend was moved out of the scroller at the same time — it had been
  drifting sideways with the columns.

**Two bugs found by testing.** The first version measured off ResizeObserver's
initial callback; that callback never fires while a tab is not being rendered, so
the bar simply never appeared. It now reads through `useSyncExternalStore` (the
pattern already used for the theme and the rail pin), which re-reads the snapshot
right after subscribing and so does not depend on the observer firing at all. And
that snapshot must be a **string** — `useSyncExternalStore` compares by identity,
so a fresh object each call would re-render forever.

Measured: scroll ranges 966 = 966, both directions mirror exactly, no echo loop,
bar at the viewport bottom (730) at the top and middle of the page and parked
under the board at the end — and drag-and-drop unchanged by the restructure.

### ✅ Session 18 — the board stopped shivering

Owner report: *"whenever I drag one task to another column the other tasks just
start flickering… they move up and down up and down… they start shivering."*

**Three causes, all in `task-board.tsx`, and a fourth found while proving the
fix.** Full detail in [REDESIGN-PLAN §8.5a](REDESIGN-PLAN.md) and in the file's
own header, which is where it will actually be read.

1. **The FLIP effect was keyed on the pointer** — its dependency array held the
   drag state, which updated on every `pointermove`. Sixty times a second it
   re-measured mid-transition cards and restarted their animation. *That was the
   shiver.* It now runs only when the gap's column or index changes.
2. **The pointer position was React state** — every move re-rendered eight
   columns and thirty cards to move one absolutely-positioned element. The
   floating card is now positioned imperatively through a ref.
3. **The insertion index was measured off animating elements.**
   `getBoundingClientRect()` includes transforms, so the midpoints deciding the
   index moved while cards slid; two adjacent indices were each "correct" a frame
   apart, so the gap flipped between them, which restarted the animation, which
   moved the midpoints. A feedback loop — the "disturbing each other". The index
   now comes from a settled layout model of container geometry and card heights,
   which no transform can touch.
4. **Found while proving it:** the inline `ref` arrow is a new function every
   render, so React detaches it with `null` every render — and the detach handler
   was deleting that card's FLIP snapshot. Ref callbacks run during commit,
   *before* `useLayoutEffect`, so the snapshot was wiped in the very commit meant
   to consume it. Cards **jumped** rather than slid. Detach is now ignored and
   stale entries are pruned by `isConnected`.

**The lesson worth keeping: never measure something you are animating in order to
decide how to animate it.**

#### Proven with numbers, because "it looks smoother" is not evidence

A `MutationObserver` counting `style` writes on every card:

| | Before | After |
|---|---|---|
| 25 moves, gap **stationary** | a write per card per move | **0** |
| one move that shifts the gap (0 → 2) | 0 — bug 4, no animation at all | **69 writes, 65 with a transform** |
| gap index sweeping down then up | oscillated between neighbours | `0→1→2→3→4` / `4→3→2→1→0`, monotonic over 64 steps |

> **Testing note for next time:** the Chrome tab reports `visibilityState:
> "hidden"`, so `setTimeout` and `requestAnimationFrame` are throttled to roughly
> 1/second and any loop built on them appears to hang. `MessageChannel` is not
> throttled — 50 ticks in 3ms — so use it to yield between synthetic pointer
> events. Also: do not click the page to "focus" it mid-test; the click's
> `pointerup` ends the drag under test and silently voids the run.

### 🔴 WAITING ON THE OWNER — the supplied task-board design

`CNI-AI-Digital-Task-Board.html` has been in the repo root since commit `141669f`
and **was referenced by no planning document at all** — not the redesign plan,
not this file, not `OWNER-REQUESTS.md`, not doc 10. The owner expected work
against it; it was never on any list. That is now
[REDESIGN-PLAN §9](REDESIGN-PLAN.md), and **it needs a decision before any code**:
its palette and type system are close to but not the same as doc 18's tokens,
which ADR-011 locked. See §9 for the four things it could reasonably mean.

### ✅ Session 17 — interaction fixes (REDESIGN-PLAN §8)

Five owner instructions in one message. All five done and checked in Chrome.

| | What changed |
|---|---|
| **Rail opens on click, not hover** | Reverses D6, which asked for the opposite. D7 (push, never cover) is untouched. The Phase 6 tab is now the only control. |
| **One settings icon, not two** | `/settings` was in the nav's System section *and* as "Workspace settings" under the user. |
| **Every rail icon on one axis** | There were three (32.5 / 38 / 28px). All measure **32.5px** now. Only visible when collapsed — which, after the hover change, is the resting state. |
| **Dashboard above My Work** | `nav-config.ts`. |
| **Search is a box, not a pop-up** | A real `<input>` in the bar, results anchored under it. No overlay. ⌘K focuses it. |
| **Drag-and-drop rebuilt** | Off the native HTML5 API entirely — see below. |

#### Why the board had to leave the native drag API

The owner asked for four things — no blur on the dragged card, cards making room,
a magnetic drop, and no flicker. **The HTML5 drag API can deliver none of them**,
and not because it was used badly: its drag image is an unstyleable browser
snapshot (that *is* the blur), `dragover` fires on a coarse timer rather than per
frame (that *is* the flicker), it has a drop *target* but no drop *position*, and
nothing about it animates.

Now pointer events, with three pieces: the card in your hand is a fixed-position
copy at **full opacity**; the gap is a **real element** at the exact landing
index, so cards genuinely reflow around it; and **FLIP** makes that reflow smooth
(measure, re-measure, invert, release). On drop the card flies to the gap.

Plus horizontal auto-scroll while dragging, and a 220ms hold before a touch drag
so the board can still be scrolled by finger.

#### ⚠️ Not finished, and it needs permission

**Board order within a column does not survive a reload.** There is no ordering
column on `tasks` — only `checklist_items.sort_order` exists. The *status* change
persists exactly as before; the position does not. Fixing it is a migration, and
rule R1 says migrations wait for a go-ahead.

#### One thing worth remembering about the test

The first drag test looked like a bug — the card snapped home and nothing
committed. It was correct: Backlog may only go to **To Do** or **Cancelled**
(`lib/domain/task-machine.ts`), and the test was dropping it into In Progress.
A refused column deliberately opens no gap. Re-tested with a legal move: the card
landed at the chosen index and `CLI-115` was `todo` in the database.

### ✅ Session 16 — REDESIGN-PLAN Phase 2 COMPLETE: changing your sign-in address

**The last of the seven redesign phases. Nothing is now queued.**

`947 unit · 133 integration (11 new, real database) · 27/27 smoke · verified in Chrome, both themes.`

The Profile page had promised an email change since Step 6 and had nothing behind
it. It now exists, for **every** role on their own account — under Profile →
Security, above the three cards that only report a state, because it is the one
thing in that section you can act on.

| Built | |
|---|---|
| `lib/domain/email-address.ts` | Layer 2, pure. Migration 001's `users_email_shaped` transcribed into TypeScript, plus `normaliseEmail`, `sameEmail` and `maskEmail`. 33 unit tests, one of which reads the migration off disk so the two definitions cannot drift silently. |
| `changeOwnEmail()` in `queries/people.ts` | One statement, one round trip. A data-modifying CTE captures the old address atomically with the change. |
| `changeEmailAction` | Validate → confirm-match → step-up → write → audit + security event → alert the old address. |
| `emailChangedEmail` / `notifyEmailChanged` | The alert, sent to the **old** address, with the new one masked. |
| `components/team/email-form.tsx` | Two equal columns (Phase 4's rule), the step-up dialog wired to replay the held submission. |
| `test/integration/email-change.test.ts` | 11 assertions against the real database. |

**No migration, no new permission, no new row in the doc 03 matrix.** All three
were considered and all three were the wrong answer — see the header comment on
`changeEmailAction` for why a `user.change_own_email` action would have broken
the transcription test for no gain.

#### Three things worth remembering

1. **The typo, not the attacker, is the residual risk.** The alert to the old
   address handles a hijack. Nothing handles a mistyped address, which saves
   cleanly and locks the person out permanently — recovery mail would go to the
   mailbox that does not exist. Mitigated by asking twice (paste blocked on the
   second field), by a stricter-than-the-database validator, and by saying so on
   screen. **Properly fixed only by the verification link, which needs the Resend
   sending domain.** Recorded in [REDESIGN-PLAN §2](REDESIGN-PLAN.md).

2. **The app-side rule is deliberately stricter than the constraint, in one
   place.** The SQL pattern accepts `name@example.com,` — a trailing comma off a
   pasted list — because `com,` satisfies `[^[:space:]@]+`. Syntactically fine,
   can never receive mail. The last label of the domain must now be letters. The
   test asserts the safe direction only: everything the app accepts, the database
   accepts. Never the reverse.

3. **The Super Admin premise was proven, not assumed.** The whole phase rests on
   "migration 005's trigger does not block an email change on that row". There is
   exactly one Super Admin row and BR-028 forbids a stand-in, so the test changes
   the real one inside a transaction and rolls back — then re-reads the address on
   a **fresh** connection, so a rollback that did not take fails loudly instead of
   leaving somebody unable to sign in. The same test confirms the trigger still
   refuses self-deactivation (FR-156), so a pass cannot quietly mean the trigger
   is missing.


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
| 19 | 2026-08-09 | **THE BOARD'S HORIZONTAL SCROLLBAR NOW FOLLOWS YOU DOWN THE PAGE.** Owner: *"the scrollbar is literally at the bottom — I don't want to scroll down to the bottom just for moving to the right."* The board is 2,420px wide against ~1,454px of room, and as tall as its fullest column, so its bar sat ~2,100px down the page. Six options offered; the owner chose the floating bar. New reusable primitive `components/ui/floating-scrollbar.tsx`: a scrollbar-height proxy holding a spacer exactly as wide as the real content, so its bar has identical proportions, with the two scroll positions mirrored — each handler compares before it assigns, so the echo cannot loop. `position: sticky; bottom: 0` does the positioning with **no measurement at all**: the bar rides the bottom of the screen while the board's end is off-screen and parks beneath the board when that end arrives, including through the rail's 240ms width animation. The board's own bar is hidden by a new `.scrollbar-hidden` utility that suppresses the BAR only — wheel, shift-wheel, trackpad, keyboard and the drag auto-scroll still drive the real element — so there is exactly one bar at any moment, which was the owner's stated worry about this approach. The legend moved out of the scroller at the same time; it had been drifting sideways with the columns. **Two bugs found by testing:** the first version measured off ResizeObserver's initial callback, which never fires while a tab is not being rendered, so the bar simply never appeared — it now reads through `useSyncExternalStore`, which re-reads the snapshot right after subscribing and so does not depend on the observer at all; and that snapshot must be a **string**, because `useSyncExternalStore` compares by identity and a fresh object each call re-renders forever. Measured: ranges 966 = 966, both directions mirror exactly, bar at viewport bottom (730) at the top and middle and parked at the end, drag-and-drop unchanged by the restructure. | **🔴 Still awaiting the §9 decision** |
| 18 | 2026-08-08 | **THE BOARD STOPPED SHIVERING.** Owner: *"the other tasks just start flickering… up and down up and down… they start shivering."* Three causes in `task-board.tsx`, plus a fourth found while proving the fix. **(1)** The FLIP effect's dependency array held the drag state, which updated on every `pointermove` — so sixty times a second it re-measured mid-transition cards and restarted their animation. **(2)** The pointer position was React state, re-rendering eight columns and thirty cards to move one absolutely-positioned element; it is now imperative through a ref. **(3)** The insertion index was measured with `getBoundingClientRect()`, which includes transforms — so the midpoints deciding the index moved while the cards slid, two adjacent indices were each "correct" a frame apart, the gap flipped between them, and that restarted the animation which moved the midpoints again. A genuine feedback loop, and the "disturbing each other" in the report. The index now comes from a settled layout model of container geometry and card heights, which no transform can touch. **(4)** Found while proving it: the inline `ref` arrow is a new function every render, so React detaches it with `null` every render, and the detach handler was deleting that card's FLIP snapshot — ref callbacks run during commit *before* `useLayoutEffect`, so the snapshot was wiped in the very commit meant to consume it, and cards jumped rather than slid. **Proven with a MutationObserver counting style writes:** 0 across 25 moves with the gap stationary (was one per card per move), 69 on a move that shifts the gap (was 0), and a monotonic `0→1→2→3→4` / `4→3→2→1→0` gap index over a 64-step sweep (was oscillating). The lesson, recorded in the file header: never measure something you are animating in order to decide how to animate it. | **🔴 Still awaiting the §9 decision** |
| 17 | 2026-08-08 | **INTERACTION FIXES (REDESIGN-PLAN §8) + A REAL DOCUMENTATION GAP FOUND.** The gap first: `CNI-AI-Digital-Task-Board.html` has been in the repo root since `141669f` and **was referenced by no planning document at all**, so the entire seven-phase redesign was written without it and the owner's expected work never appeared. Now REDESIGN-PLAN §9, blocked on an owner decision because its palette and type system collide with doc 18 / ADR-011. Five instructions delivered: **rail opens on click not hover** (reverses D6, keeps D7 — the Phase 6 tab is now the only control); **the duplicate `/settings` icon under the user removed** — it was in the nav's System section as well; **every rail icon on one 32.5px axis**, where there had been three (32.5 / 38 / 28), which only shows when collapsed and collapsed is now the resting state; **Dashboard above My Work**; **search rebuilt as a real box in the bar** with results anchored under it instead of a full-screen palette over a dimmed backdrop. **Drag-and-drop taken off the native HTML5 API entirely** — it cannot do what was asked, at all: its drag image is an unstyleable browser snapshot (the "blur"), `dragover` fires on a coarse timer (the "flicker"), it has a drop target but no drop position, and nothing animates. Rebuilt on pointer events: full-opacity card in hand, a real gap element at the landing index so cards genuinely reflow, FLIP to make that smooth, a flight to the gap on release, horizontal auto-scroll, and a 220ms hold before touch drags. Verified in Chrome — a legal move landed at the chosen index and persisted; an illegal one opened no gap and flew home. **Not finished:** board order within a column does not survive a reload — there is no ordering column on `tasks`, and adding one is a migration that waits for permission (R1). | **🔴 Awaiting an owner decision on §9** |
| 16 | 2026-08-08 | **REDESIGN-PLAN PHASE 2 COMPLETE — the sign-in address can be changed. All seven redesign phases now done.** Available to every role for their own account, under Profile → Security. Password + authenticator (the Step 5 step-up challenge, which replays the held submission rather than making somebody re-enter it), applied immediately, with an alert to the **old** address as the control. **No migration, no new permission, no new row in the doc 03 matrix** — the trigger already permitted it, RLS already scoped it, and `security_events.event_type` is free text by design. New pure module `lib/domain/email-address.ts` with 33 tests, one of which reads migration 001 off disk so the TypeScript pattern and the SQL constraint cannot drift apart silently. **The validator is deliberately stricter than the database in exactly one place:** the SQL pattern accepts `name@example.com,` off a pasted list — valid shape, undeliverable forever — so the domain's last label must now be letters; the test asserts only the safe direction (everything the app accepts, the database accepts). 11 integration tests, including the phase's premise proven rather than assumed: the **real** Super Admin's address is changed inside a transaction and rolled back, then re-read on a fresh connection so a rollback that did not take fails loudly, with FR-156 self-deactivation still refused alongside it. Verified in Chrome in both themes; the step-up dialog fires and a wrong password is refused. **Residual risk recorded, not hidden:** a typo still locks somebody out permanently — mitigated by asking twice with paste blocked on the second field, but only properly fixed by the verification link, which needs the Resend sending domain. | **Nothing queued — awaiting direction** |
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
| 14 | 2026-08-07 | **BUILD-PLAN STEP 8 COMPLETE — ALL 8 STEPS DONE.** Assignment recommendations (doc 07's six dimensions, tested against its own worked example; below the usability floor it stops ranking people and recommends actions instead). Global search on ⌘K, server-side under the searcher's identity because search is where a permission model leaks. Calendar, Monday-first with Sunday shaded per ADR-004, all UTC. CSV export with a formula-injection guard — a title starting `=` executes on open in Excel — and every export audited, because once a file is in Downloads no access control applies to it. Notification preferences enforced centrally in `notify()` rather than at each call site. Daily digest at `/api/digest` for Vercel Cron, fail-closed without `CRON_SECRET`, and it sends nothing when there is nothing. **Caught:** the recommendation query duplicated the load weights in SQL and two were already wrong, so recommendations would have ranked against a different definition of "busy" than the workload screen forever; migration 018 was needed so a Member triggering a notification cannot bypass the recipient's preferences. | **Build complete — awaiting the new design** |
| 13 | 2026-08-07 | **BUILD-PLAN STEP 7 COMPLETE — file attachments.** The owner created the bucket **public**, which would have made every attachment readable by URL forever with no account — routing straight around the RLS model the rest of the system rests on. Explained and switched to **private**, 25 MB, 17 allow-listed MIME types. Downloads are two steps: the row carries no URL, and clicking asks the server to re-check visibility and mint a one-hour link, so a forwarded link expires and revoked access takes effect immediately. Uploads write the object BEFORE the row — they cannot be atomic, and an orphaned object is litter while an orphaned row is a broken promise on screen; the object is removed again if the row write fails. The extension is checked separately from the MIME type because `file.type` is a browser claim, not an inspection. Filenames are sanitised and never used as storage paths (`tasks/<taskId>/<attachmentId>.<ext>`). **One server-side storage key is unavoidable** — Supabase Storage is a separate HTTP service and cannot see `app.user_id` — so the containment is enforced by an ESLint rule that fails the build if any file other than `lib/storage/bucket.ts` mentions it, verified by planting a probe. The database rule is unchanged: nothing touches `public.*` with an elevated key. **Owner still needs to add `SUPABASE_STORAGE_KEY`**; `npm run storage:check` verifies it end to end. | **Awaiting go-ahead for Step 8** |
| 12 | 2026-08-07 | **BUILD-PLAN STEP 6 COMPLETE — subtasks, dependencies, watchers, task skills, time extensions, bulk actions and recurring tasks.** Dependencies keep ORDER and DECOMPOSITION apart — a dependency says "edit cannot start until the shoot finishes", a subtask says "edit is part of the showreel", and storing both in one table forces them to behave the same way. **Cycle detection walks the whole visible graph**, because A → B → C → A is easy to assemble one reasonable edge at a time and `task_dependencies` forbids only the self-edge; the search terminates even on a graph that is already cyclic. BR-008 warns rather than blocks, by design. **Recurring tasks spawn on completion, not on a schedule** — a weekly report three weeks late is one task three weeks old rather than four implying four separate pieces of work. Every recurrence date calculation is UTC, because `new Date('2026-03-29').getDay()` answers locally and "every Monday" silently becomes every Sunday west of Greenwich. Extensions carry doc 17 §5's context block, appear on the dashboard (FR-190) and deep-link into the task via `?task=`. **Caught before shipping:** `extension_status` is `partially_approved` not `partial`; FR-187's "resume the timer" has no referent under doc 17 §4 option B; `notify()` took `kind: string` so three invented notification kinds compiled cleanly and would have failed at the insert — now a union mirroring the enum; and `server-only` correctly refused a client component importing a label map from a query module, which would have pulled postgres into the browser bundle. | **Awaiting go-ahead for Step 7** |
| 11 | 2026-08-07 | **BUILD-PLAN STEP 5 COMPLETE — settings are editable, and they actually take effect.** 18 settings, each naming its own doc 03 permission, validated on four gates in order: role → step-up → the field's own bounds → **the combination** (a soft threshold above the hard one is individually legal and silently disables the warning). Scoring weights refused unless they total exactly 100% (C-06). Skills library: add, rename, retire, restore — never delete, because `user_skills` is ON DELETE RESTRICT and the ratings are the history the matcher reads. **Step-up re-authentication (FR-149) closed**, carried over from Step 4: password plus authenticator for a privileged role, failures audited, ten minutes, per-session. **The part that made it real:** every consumer imported `SYSTEM_DEFAULTS` directly, so an override could be saved, audited and shown as changed while nothing behaved differently — `lib/settings/current.ts` is now the one accessor and the capacity gate, workload screens, dashboard, lockout threshold, code TTL and invitation TTL all read through it (migration 017 adds `app.settings_effective()` so the login screen can read the lock threshold it prints, where there is no identity yet). **Two seam bugs found:** the table's `check (key ~ '^[a-z][a-z0-9_]* — the first-run Super Admin setup route, verified 8/8.** Migration 011 adds `app.setup_is_available()` and `app.setup_super_admin(…)`, the latter creating the user, password identity, ten recovery codes, a CRITICAL security event and an audit row in one transaction. `/setup` renders the form only while no Super Admin exists and shows the ten recovery codes exactly once, with a print step. Single-use is **structural** — migration 001's partial unique index permits one `super_admin` row ever, so the guard clause exists only to produce a readable error. Fixed a stale comment in `sidebar.tsx` that still described the rail as overlaying the content, contradicting owner decision D7. `npm run verify` clean: 640 tests, build green, `/setup` correctly dynamic. | **Awaiting go-ahead for Step 5.2** |

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
)` would have rejected every camelCase key on the first save, and the RLS delete policy being Super-Admin-only meant an Admin's Reset deleted zero rows with no error. | **Awaiting go-ahead for Step 6** |
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
