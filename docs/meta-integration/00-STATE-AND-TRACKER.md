# 🔄 STATE & TRACKER — READ THIS FIRST

> **If you are a new session, start here and read this file completely before
> touching anything.** It is the single source of truth for what is done, what is
> next, and what must not be touched. Every other file in this folder is
> reference; this one is the state.
>
> **Last updated:** 2026-09-04 · **Branch:** `meta-integration` · **Phase:** 1 of 6

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

### ⏳ NEXT — Phase 2, not started

Waiting on the owner's answers in §7 before any code is written. See
`04-PHASES.md` for the full sequence.

### ❌ NOT STARTED

Everything else. **No migration has been written. No table exists. No UI file
exists. No cron is registered.** The database is untouched.

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

## 7 · ⛔ BLOCKED ON THE OWNER — questions that change the build

These are in `04-PHASES.md` §Questions with full context. Short form:

1. **Cron frequency** — owner said 1–2 hours. Confirm 2 hours? (Meta's daily
   figures only change a few times a day; hourly mostly re-reads the same rows.)
2. **What happens below 100 followers?** Demographics return **empty**, so "Top
   Locations" and "Age & Gender" cannot be drawn for the current account. Hide
   the panels, or show them with an explanation?
3. **Are client pages already shared to the Business account,** or only this one?
4. Is the Meta app in **Live** mode, and has Business Verification been done?
5. Which project is second, so the multi-project path gets designed rather than
   retrofitted?

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
| 2026-09-04 | Branch created. Token and all four env vars verified live. Full API reconnaissance: working metric lists for FB + IG on v26.0, per-post data, permalinks, 30-day window limit, demographics threshold. Planning docs written. **No code, no migration, no schema change.** | Awaiting answers to §7 |
