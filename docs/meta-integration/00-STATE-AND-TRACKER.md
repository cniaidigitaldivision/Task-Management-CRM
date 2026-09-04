# 🔄 STATE & TRACKER — READ THIS FIRST

> **If you are a new session, start here and read this file completely before
> touching anything.** It is the single source of truth for what is done, what is
> next, and what must not be touched. Every other file in this folder is
> reference; this one is the state.
>
> **Last updated:** 2026-09-04 · **Branch:** `meta-integration` · **Phase:** 4 of 6 ✅

---

## 1 · The one-paragraph summary

The AI & Digital Division manages Facebook and Instagram accounts for clients.
Taskly already knows what was *promised* (package targets) and what was *posted*
(`task_placements`). It has never known whether any of it **worked**. This
integration pulls performance figures from Meta into a new page — **Trend &
Engagement Studio** — so growth, reach and engagement sit beside the work that
produced them.

**Owner instruction, 2026-09-04:** build it on a branch, do not touch `main`, and
do not push or deploy anything without being told.

---

## 2 · ⚠️ HARD RULES — DO NOT BREAK THESE

| Rule | Why |
|---|---|
| **Never commit to `main`.** Work only on `meta-integration`. | Owner: *"I don't want to disrupt the main branch. I want to keep the main branch working as it is."* |
| **Never push or deploy without explicit instruction.** | Owner: *"Without my instruction don't implement anything in that branch."* Building and committing locally is fine; `git push` and Vercel are not. |
| **Never print or commit the token/secret values.** | `.env.local` is gitignored and must stay that way. Refer to variables by NAME only. |
| **Never modify anything under `app/(app)/projects/`.** | Owner: *"I don't want that to change anything inside of the project."* The Studio is a **separate page**, not a project tab. |
| **Do not alter existing tables.** Add new ones. | The 2 644 existing tests and the live system must keep passing untouched. |
| **Projects with no social media keep the current layout.** | Owner: an internal-tool project *"has no social media. For that we will keep this layout."* |

---

## 3 · Where things stand

### ✅ DONE

| # | What | Evidence |
|---|---|---|
| 1 | Branch `meta-integration` created from the deployed state | `git branch --show-current` |
| 2 | Meta env vars located and inventoried | §4 below |
| 3 | **System user token verified against the live Graph API** | `01-VERIFIED-API-FACTS.md` |
| 4 | Working metric list established for FB and IG on v26.0 | `01-VERIFIED-API-FACTS.md` §2–3 |
| 5 | Page + Instagram account discovered and confirmed reachable | §5 below |
| 6 | Per-post data and permalinks confirmed available | `01-VERIFIED-API-FACTS.md` §4 |
| 7 | Planning documents written (this folder) | you are reading them |
| 8 | Owner answered all six questions | §7 below |
| 9 | **Phase 2 — migrations 091–093 written and APPLIED** | `meta_tables = 6`, self-checks passed |
| 10 | Migrations 094 + 095 — SECURITY DEFINER readers for the cron | see §10, the RLS trap |
| 11 | **Phase 3 — the sync job, working against the live API** | 407 metric rows, 50 posts, 0 duplicates |
| 12 | AI & Digital Division linked (FB + IG) and backfilled 29 days | `meta_accounts` has 2 rows |
| 13 | Cron registered in `vercel.json`, every 2 hours | ⚠️ inert until deployed |

| 14 | **Phase 4 — the Overview tab at `/studio`** | verified against real data, see below |

### ⏳ NEXT — Phase 5, the remaining tabs

Content & Posts, Meta Accounts, Analytics & Insights, Reports & Exports, Settings
& Sync — each shipped whole, in that order. They are already drawn in the tab
strip as disabled with a "soon" chip, so the information architecture is settled.

### ⚠️ NOT VERIFIED VISUALLY — the one gap in Phase 4

Everything was checked end-to-end **as data**: the real queries and KPI builder
run against the live database and produce sane figures (36 followers = 20 FB + 16
IG, 213K reach labelled Instagram-only, 29 days with data and 1 gap preserved,
real permalinks). **But nobody has seen it rendered.**

The demo accounts in `visual-verification-setup` (`kashif@cni-demo.com`) DO NOT
EXIST in this database — it is the live one, and the real users' passwords are
theirs. The test suite is `environment: 'node'` with no jsdom, so there is no
React render harness either.

**The owner can see it**: a dev server is running on **http://localhost:4310/studio**.
A future session should ask them for a screenshot rather than assume the layout is
right — the 120% and +1640% dashboard bugs were both invisible to tests.

### ❌ NOT STARTED

Phase 5's tabs. Nothing is deployed and nothing is pushed to any remote.

---

## 10 · ⚠️ THE RLS TRAP THAT BIT TWICE — read before adding any sync code

The sync runs from a cron with **no signed-in user**. Every `meta_*` table has an
RLS policy that fails closed for an anonymous session — correctly. So a direct
`select` from the sync returns **zero rows and no error**, and the run reports a
clean success having written nothing.

It happened twice:

| Attempt | Symptom | Fix |
|---|---|---|
| Reading `meta_accounts` | `0 accounts`, silent success | `app.meta_accounts_to_sync` (094) |
| Reading `meta_metric_catalogue` | `0 days, 25 posts` — posts landed, metrics did not | `app.meta_catalogue_for` (095) |

⚠️ **Do NOT fix this by relaxing a policy.** `lib/db/client.ts` says so directly
in its note on `withAppRole`. Every table the sync touches is now covered — 094
and 095 for reads, 093 for writes — so there is no third instance waiting.

---

## 4 · The environment variables

All four live in `.env.local`, are **already working**, and were verified against
the live API on 2026-09-04.

| Variable | Value / shape | Notes |
|---|---|---|
| `META_APP_ID` | `1109373768423508` | Not secret |
| `META_APP_SECRET` | 57 chars | **Secret.** Used only for `debug_token` |
| `META_API_VERSION` | `v26.0` | Every call must use this, never a hardcoded version |
| `META_SYSTEM_USER_TOKEN` | 201 chars | **Secret.** Type `SYSTEM_USER`, **never expires** |

⚠️ **The owner mentioned business ID, page ID and Instagram user ID, but those
are NOT in `.env.local`.** They do not need to be — they are discoverable from
the token (§5) and will live in the database, one row per project. Hardcoding
them would break the moment a second project is added.

⚠️ **`META_SYSTEM_USER_TOKEN` never expires.** This removes the entire
token-refresh subsystem the first plan assumed. Do not build one.

---

## 5 · What the token actually reaches, today

Verified live, 2026-09-04:

```
System user   taskly-sync (122095549035473601)
Facebook Page 1183663484837998 — "CNI Ai & Digital Division" — 20 followers
Instagram     17841439385217280 — @cniaianddigitaldivision — 16 followers, 49 posts
```

That is **one** page and **one** Instagram account. `me/businesses` returns
empty for this token, which is normal for a system user — assets are reached
through `me/accounts`, not through the business.

⚠️ **Two access tokens, not one, and this is the single most common mistake.**
Instagram calls use `META_SYSTEM_USER_TOKEN` directly. **Facebook Page insights
do NOT** — they return *"(#190) This method must be called with a Page Access
Token"*. The Page token is derived per page:

```
GET /{page-id}?fields=access_token   (with the system user token)
```

---

## 6 · Which project this maps to

Owner: *"I'm just focusing on the first project, which is the ai-digital
project."*

The Taskly project is **AI & Digital Division**. Its `project_platforms` rows for
Facebook and Instagram already exist with `handle` and `page_url` **null** — the
join point was built and never filled. Phase 2 fills them.

Other projects follow the same path later. Projects with no social media
(e.g. internal tool development) keep the existing layout and never appear in the
Studio's dropdown.

---

## 7 · ✅ ANSWERED BY THE OWNER, 2026-09-04

1. **Cron: every 2 hours.** Owner took the recommendation.
2. **Sub-100 demographics: build the panels.** Show clearly-labelled sample data
   plus a message that real figures appear once the account passes 100 followers.
   ⚠️ **The "sample" labelling must be impossible to miss** — an unlabelled
   placeholder that later reads as real is the failure mode to design against.
3. **Client pages are already shared** into the Business account. Projects that
   are internal tool development have none, by nature.
4. ⚠️ **The Meta app is UNPUBLISHED (development mode).** It works for the
   business's own assets, which is why the reconnaissance succeeded. The owner
   has the paperwork for Business Verification ready. **Not a blocker for this
   project; may become one for client pages.**
5. **Second project: later.** For now, selecting any other project in the
   dropdown shows a **"coming soon"** state.
6. **Facebook reach: label honestly.** Show Views and Engagement for Facebook and
   do not invent a reach figure.

---

## 8 · How to resume, mechanically

```bash
git checkout meta-integration        # never main
git log --oneline -5                 # what the last session actually did
```

Then read, in order: this file → `01-VERIFIED-API-FACTS.md` (so you do not
re-discover the API) → `04-PHASES.md` (what is next) → `02-DATA-MODEL.md` and
`03-UI-SPEC.md` when you start building.

**Update §3 of this file at the end of every working session.** A tracker that is
not updated is worse than none, because the next session trusts it.

---

## 9 · Session log

| Date | Session did | Left at |
|---|---|---|
| 2026-09-04 (1) | Branch created. Token and all four env vars verified live. Full API reconnaissance: working metric lists for FB + IG on v26.0, per-post data, permalinks, 30-day window limit, demographics threshold. Planning docs written. **No code, no migration, no schema change.** | Awaiting answers to §7 |
| 2026-09-04 (5) | **Content & Posts and Meta Accounts tabs built** to the owner's references. `lib/domain/meta-content.ts` (33 tests) + the per-account series in `accountDetailsForProject`. Verified live: tabs All 50 / Reels 9 / Images 16 / Drafts 3; Facebook 20 followers, 29 days held, history 2026-08-07 -> 2026-09-04, HEALTH **[Behind]** (correct -- the cron is registered and this branch is not deployed). ⚠️ `syncHealthSummary` lets the WORST account set the verdict, and `fleetBanner` is allowed to report bad news, because both reference cards are fixed congratulatory text. | Reports & Exports |
| 2026-09-04 (9) | **Analytics & Insights built — the Studio is complete, all six tabs live.** New `lib/domain/meta-analytics.ts` (31 tests) + `components/studio/analytics-charts.tsx` with five shapes the Studio lacked: stacked area, radar, scatter, funnel and grouped weekday bars, beside the existing line, donut and heatmap. `KIND_TOKENS` moved into the domain layer so Content and Analytics cannot colour a Reel differently. ⚠️ The file exists mostly to hold ONE rule: **Facebook and Instagram barely share a metric name**, so every cross-platform comparison goes through `COMPARABLE` and Facebook's absent reach stays absent rather than becoming zero. Verified against live data: funnel 213,063 → 237 → 308 → 217 (a real >100% conversion), radar all three axes populated both sides, **1 negative `saves` row to clamp**, scatter 25 plotted / 25 excluded. | The Studio is done; next is whatever the owner asks for |
| 2026-09-04 (8) | **Settings & Sync built, and the sync became rule-driven.** Migrations **099** (`meta_sync_settings`, `meta_sync_rules`, three SECURITY DEFINER functions) and **100** (the default-sync reader returns a NAME, without which a ruled project synced twice a cycle). New `lib/domain/meta-sync-settings.ts` (20 tests), `lib/meta/rules.ts`, `lib/db/queries/meta-sync-settings.ts`, `app/actions/meta-sync-settings.ts`, `components/studio/settings-sync.tsx` (5 sub-tabs). New permission `meta.sync.configure` (Admin+). ⚠️ **Rules are additive**: no active rule → today's two-hourly pull, unchanged. **Proven live**: a rule scoped to `{instagram}` + `{profile}` ran 1 account, wrote 1 day and **0 posts** (the category scoping is real), while the default pull correctly took **0 accounts** (no double sync), and the rule's next run landed 24.0h out. | Analytics & Insights |
| 2026-09-04 (7) | **Reports & Exports rebuilt to the owner's reference.** Migration **098**: `sections`, `formats`, `accent`, `icon` on `report_templates`, and the library grown to **24 built-ins** — every one still naming an engine that runs today. New `lib/brand/file-type-marks.ts` + `components/brand/file-type-icon.tsx` (PDF · Excel · PPT · CSV · Google Slides, drawn on one shared page shape so the row of five aligns). `components/studio/reports-exports.tsx` rewritten: six KPI cards, the reference's filter row, a card grid with per-card menus, pagination with a per-page select, and the detail drawer (Sections Included, Sample Preview, Export Formats, Use This Template, Preview Full Report). Verified as `cni_app`: 24 templates, 20 AI blocks, 5 formats, 0 empty section lists. | Analytics & Insights, Settings & Sync; then the per-template PDF layouts, for which `sections` is the brief |
| 2026-09-04 (6) | **Reports & Exports tab built and proven end to end.** Migrations **096** (`report_templates` with 9 built-ins, `report_template_favourites`, `report_schedules`, append-only `report_exports`, `app.record_template_use`) and **097** (`app.report_schedules_due` / `app.record_schedule_run`, SECURITY DEFINER). New: `lib/domain/report-templates.ts` (22 tests), `lib/db/queries/report-templates.ts`, `app/actions/report-templates.ts`, `components/studio/reports-exports.tsx` (4 sub-tabs), `lib/reports/schedule-runner.ts`, `app/api/report-schedules` on a 19:05 UTC cron. **The report generator moved out of `app/actions/project-report.ts` into `lib/reports/generate.ts` VERBATIM** -- see §11. Proven live: 9 templates readable as `cni_app`; the runner filed a real September report (target 39, achieved 0 -- correct for the 4th) and its history row; test artifacts removed afterwards. | Analytics & Insights, Settings & Sync |
| 2026-09-04 (4) | **Phase 4 complete.** `/studio` with project dropdown, connected-account marks, platform filter, six tabs (Overview live, five disabled). Overview: 6 KPI cards with same-length period deltas, followers/engagement/views trends, content mix donut, top posts linking to Meta, by-platform bars, sync footer naming any failing account, and the sample-audience panel. `lib/domain/meta-studio.ts` (pure, 20 tests) + `lib/db/queries/meta-studio.ts`. Nav item added under Projects (LEAD_UP). ⚠️ Not seen rendered — see the note above. | Phase 5, the remaining tabs |
| 2026-09-04 (3) | **Phase 3 complete.** `lib/meta/client.ts`, `lib/meta/sync.ts`, `app/api/meta-sync/route.ts`, cron every 2h. Migrations 094–095 added for the RLS trap (§10). Linked AI & Digital Division's FB + IG and backfilled: **407 metric rows over 29 days, 50 posts all with permalinks, 0 duplicate keys across three runs.** Found and fixed: `metric_type=total_value` needs `since=D, until=D+1` — a same-day window returns null silently. | Phase 4, the Overview tab |
| 2026-09-04 (2) | Owner answered all six questions. **Phase 2 complete:** migrations 091–093 written and applied — `meta_accounts`, `meta_metric_catalogue` (15 verified metrics seeded), `meta_metric_days`, `meta_posts`, `meta_post_metrics`, `meta_sync_runs`, plus `app.record_meta_sync` / `app.record_meta_sync_failure`. All self-checks passed; 2 644 tests still green; projects/tasks/attendance counts unchanged. Three schema surprises found by the migration refusing to commit: `projects.type` not `project_type`, `code` is NOT NULL, and `projects_code_format` demands exactly three uppercase letters. | Phase 3, the sync job |


---

## 10 · ⚠️ FOUR TRAPS THIS FEATURE HAS ALREADY FALLEN INTO

Kept here because each one produced a **falsely successful** result, which is the
only kind of bug a session cannot see.

1. **RLS fails closed for a cron, silently.** A cron has no session, so
   `app.current_user_id()` is NULL and every policy evaluates false — no error,
   ZERO ROWS, and the job reports "0 due, ok" forever. Migrations 094, 095 and
   097 are all SECURITY DEFINER readers written for this. **Never widen a policy
   to fix it**; that hands the same rows to every signed-in path.

2. **`metric_type=total_value` needs `until = D + 1`.** A same-day window returns
   null with a 200. The IG backfill wrote 30 rows instead of ~300 and reported OK.

3. **TypeScript cannot check a SQL identifier.** Twice in one session: the Meta
   export queries guessed `d.metric_date` / `po.account_id` (really `d.on_date`,
   `po.meta_account_id`), and `u.name` reached the owner's browser as a 500 —
   the column is `users.full_name`. `tsc`, `eslint` and 2 724 tests were all
   green. **Run every new query against `information_schema` or the live
   database before believing it.**

4. **A figure that only counts half its sources.** The first schedule runner
   filed reports without bumping `usage_count`, so a template running monthly
   forever would have read "Never used" while the card called it usage. Found by
   reading the row back after the run, not by reasoning.

---

## 11 · ⚠️ WHAT SESSION 6 MOVED, AND WHY YOU MUST NOT "TIDY" IT

`app/actions/project-report.ts` used to hold the whole report generator. Its body
now lives in **`lib/reports/generate.ts`** as `generateProjectReport(actor, …)`,
and the action is a six-line wrapper.

**The move was verbatim** — the local variable is still called `user` — because
the owner approved that document's every panel over three rounds of screenshots,
and a tidy-up during a move is how a figure quietly changes. Do not rename or
reflow it without a reason.

**It must not go back into a `'use server'` file.** There, every exported async
function is an endpoint the browser may call with arguments of its choosing, and
this one takes its ACTOR as a parameter — so exporting it from an action file
would let anybody generate a report as anybody. It takes an actor because the
cron runs a scheduled report as whoever set it up.

---

## 12 · Where the Reports & Exports tab tells the truth instead of the reference

The owner's reference asserts several things this system cannot do. Each is drawn
and each is honest; the reasoning is in the file headers, and tests pin it.

| Reference says | What is there | Why |
|---|---|---|
| Total Templates **24** | **24** — a count of the table | Session 7 grew the library to 24. Every one still names an engine that runs today; what is not yet true is that each produces a DIFFERENT document, which is later work with `sections` as its brief. |
| Supported Formats **5** (PDF/Excel/PPT/CSV/Slides) | **5** offered; the footnote names the **2** that write | Offered and writable are different facts and the card carries both. All five marks are drawn in full colour; the three without a writer are dashed in the drawer and carry their reason on hover. |
| **AI Summary Blocks 42** | a real count — **20** today | It totals `INSIGHT_SECTIONS` across the library, which is what the reference's own footnote ("Across all templates") says it is. Hard-coding 42 would make the one card nobody can check also the only one that is wrong. ⚠️ Nothing WRITES those blocks yet; the keys are the brief. |
| **Sections Included** as checkboxes | ticks, from the template's own `sections` | Per-template layouts are later work, so they are not choices yet. A tick states what the report contains — the fact somebody needs when choosing between two templates. |
| A **Team** filter | an **Origin** filter (built-in / custom) | No column makes a template belong to a team. Who made it is the real distinction. |
| Recipients on a schedule | no recipients field at all | Outbound mail is dead — Resend's domain is `status: failed`. A scheduled report FILES itself; somebody still sends it. |
