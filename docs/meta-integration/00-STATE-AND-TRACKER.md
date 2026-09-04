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
| 2026-09-04 (4) | **Phase 4 complete.** `/studio` with project dropdown, connected-account marks, platform filter, six tabs (Overview live, five disabled). Overview: 6 KPI cards with same-length period deltas, followers/engagement/views trends, content mix donut, top posts linking to Meta, by-platform bars, sync footer naming any failing account, and the sample-audience panel. `lib/domain/meta-studio.ts` (pure, 20 tests) + `lib/db/queries/meta-studio.ts`. Nav item added under Projects (LEAD_UP). ⚠️ Not seen rendered — see the note above. | Phase 5, the remaining tabs |
| 2026-09-04 (3) | **Phase 3 complete.** `lib/meta/client.ts`, `lib/meta/sync.ts`, `app/api/meta-sync/route.ts`, cron every 2h. Migrations 094–095 added for the RLS trap (§10). Linked AI & Digital Division's FB + IG and backfilled: **407 metric rows over 29 days, 50 posts all with permalinks, 0 duplicate keys across three runs.** Found and fixed: `metric_type=total_value` needs `since=D, until=D+1` — a same-day window returns null silently. | Phase 4, the Overview tab |
| 2026-09-04 (2) | Owner answered all six questions. **Phase 2 complete:** migrations 091–093 written and applied — `meta_accounts`, `meta_metric_catalogue` (15 verified metrics seeded), `meta_metric_days`, `meta_posts`, `meta_post_metrics`, `meta_sync_runs`, plus `app.record_meta_sync` / `app.record_meta_sync_failure`. All self-checks passed; 2 644 tests still green; projects/tasks/attendance counts unchanged. Three schema surprises found by the migration refusing to commit: `projects.type` not `project_type`, `code` is NOT NULL, and `projects_code_format` demands exactly three uppercase letters. | Phase 3, the sync job |
