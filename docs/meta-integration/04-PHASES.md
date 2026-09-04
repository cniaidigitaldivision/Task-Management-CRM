# 🚦 PHASES — build order and exit criteria

> Each phase ships something verifiable and leaves the system working. Nothing
> half-lands. **Current phase: 1 (complete). Phase 2 is blocked on the questions
> in §Questions below.**

---

## Phase 1 · Reconnaissance ✅ COMPLETE

Verify the credentials and learn what the API actually returns before designing
against assumptions.

**Done:** branch created; all four env vars verified live; working metric lists
established for both platforms on v26.0; four dead Facebook metrics identified;
the `metric_type=total_value` requirement discovered; per-post data and
permalinks confirmed; the 30-day window cap and the 100-follower demographics
threshold found. Written up in `01-VERIFIED-API-FACTS.md`.

**Cost of skipping it:** the four dead metrics would each have been found at
build time, one at a time, as `(#100)` errors that read like typos.

---

## Phase 2 · Schema — ⏳ NEXT, BLOCKED

Migrations 091–093 from `02-DATA-MODEL.md` §8.

**Exit:** tables exist; catalogue seeded from verified metric names; RLS proven
by querying as three roles; the existing 2 644 tests still pass; a fingerprint
over every touched table is identical before and after.

**Blocked on:** questions 1–2 below.

---

## Phase 3 · The sync job

`lib/meta/client.ts` (typed Graph wrapper), `lib/meta/sync.ts` (the pull),
`app/api/meta-sync/route.ts`, cron in `vercel.json`.

⚠️ **Backfill the 30 days on first run.** This is the phase whose delay costs
data that cannot be recovered.

⚠️ **One account's failure must not stop the others.** Each writes its own
`meta_sync_runs` row. A revoked client page is a named row, not a dead job.

**Exit:** invoked manually against AI & Digital Division, ~30 days of rows land
for both platforms, a second run is idempotent (no duplicates, corrections
applied), an account with a deliberately broken ID records a failure and the
others still succeed.

---

## Phase 4 · The Overview tab

Route, shell, project dropdown, platform filter, and the panels in
`03-UI-SPEC.md` §3. **Overview only.** Other tabs visible but disabled.

**Exit:** real numbers on screen matching the database; loading, empty and error
states all reachable; both themes verified; posts click through to Meta;
`tsc` / `eslint` / `vitest` / `next build` clean.

---

## Phase 5 · The remaining tabs

Content & Posts, Meta Accounts, Analytics & Insights, Reports & Exports, Settings
& Sync — in that order, each shipped whole.

---

## Phase 6 · The second project

The first project that is **not** AI & Digital Division. Proves the multi-account
path and flushes out anything accidentally hardcoded.

⚠️ Needs the client's Page shared into the Business account first — a
conversation, not code.

---

## ❓ Questions — answers change the build

**1 · Cron frequency.** You said 1–2 hours. **I recommend every 2 hours.** Meta's
daily aggregates change only a few times a day, so hourly mostly re-reads
identical rows and doubles the API budget for nothing. Posts and their metrics
move faster — those can be checked more often later if it matters. *Confirm 2
hours?*

**2 · Sub-100-follower demographics.** Top Locations and Age & Gender **cannot be
drawn** for the current account (`01-VERIFIED-API-FACTS.md` §5). Hide the panels,
or show them with "available once the account passes 100 followers"? *I
recommend showing the explanation* — an unexplained absence reads as a bug.

**3 · Client pages.** Is only *CNI Ai & Digital Division* shared into the
Business account today, or are client pages (Daniyal Marketing, etc.) already
there? This decides whether Phase 6 is a morning or a month.

**4 · App mode and verification.** Is the Meta app in **Live** mode, and is
Business Verification done? The token works on the business's own page; client
pages may need more.

**5 · The second project.** Which one? Designing for it now is cheaper than
retrofitting.

**6 · Facebook reach.** No working reach metric was found in v26.0
(`01-VERIFIED-API-FACTS.md` §6). Options: keep hunting, derive from post-level
data, or show Views and Engagement for Facebook and label them honestly. *I
recommend the third for now* — a labelled real number beats a guessed one.

---

## Standing verification

Every phase, before it is called done:

```
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint <changed paths>
./node_modules/.bin/vitest run          # 2 644 must still pass
./node_modules/.bin/next build
```

⚠️ npm scripts are broken in this repo — the `&` in the directory path breaks
`npm run`. Call the binaries in `node_modules/.bin` directly, as above.

⚠️ **Migrations on disk are not necessarily applied.** Check
`information_schema` before assuming a column exists.
