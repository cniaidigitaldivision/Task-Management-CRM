# 📊 LINKING PROJECTS TO META — PLANNING & UNDERSTANDING

> **Planning only.** Owner, 2026-09-03: *"I will just suggest a planning phase,
> just a planning and understanding phase."* Nothing in this document has been
> built. No migration, no table, no code. It exists so the shape of the thing is
> agreed before any of that starts.
>
> **Scope:** Facebook Pages and Instagram. TikTok is deliberately out —
> *"Right now I am not focusing on TikTok but later on definitely I will."*
> §11 records what changes when it comes in.

---

## 1 · The short answer

**Yes, this is possible.** Meta publishes exactly the numbers you are asking for
— reach, views, engagement, follower counts, per-post performance — through the
Graph API, free of charge.

**But the code is the easy half.** The hard half is access, and almost none of it
is something I can do:

| What | Who does it | Lead time |
|---|---|---|
| Each client's Instagram converted to **Business/Creator** | The client, or you with their login | Minutes each |
| Each client's Facebook Page granting your agency access | The client | Days — chasing people |
| A **Meta Business** account holding those Pages | You | An hour |
| **App Review + Business Verification** | You, with my help on the write-up | **1–6 weeks** |
| Then: the integration itself | Me | ~2–3 weeks of build |

⚠️ **App Review is the long pole and it starts from a standing start.** Everything
in §7 phases around that fact.

⚠️ **One thing genuinely cannot be recovered later, and it decides the build
order.** Meta keeps only a short window of history — Instagram's daily follower
series covers roughly the **last 30 days** and nothing before it. So the day you
start recording a daily snapshot is the day your history begins. Every week of
delay is a week of "is this account growing?" you can never answer retroactively.
That is why §7 puts the snapshot job *before* any screen is built. Collect first,
draw graphs later.

---

## 2 · What you asked for, restated

Reading back your description, there are five distinct questions, and they need
different data:

| Your words | What it really needs |
|---|---|
| *"how many page engagements are coming"* | Page/account daily insights |
| *"how many page views or post views"* | Page insights + per-post insights |
| *"how the followers are increasing"* | **Daily follower snapshot we own** |
| *"what followers we recorded last week / previous month"* | A time series with history |
| *"whether the account is growing or still at the same position"* | Period-over-period comparison |
| *"after all these posts… what's happening"* | Cadence (we have) × outcome (we don't) |

The last row is the interesting one and the reason this is worth building. Taskly
already knows **what you promised and what you posted** — the tracker, the
package, `static_posts_per_day`, `reels_per_week`, every `task_placements` row
with its URL and date. What it has never known is **whether any of it worked.**
This integration closes that loop.

---

## 3 · ⚠️ A caveat about metric names, stated up front

My knowledge runs to **May 2026**, and Meta deprecates and renames insight
metrics aggressively — several times a year, with breaking effect. Two examples I
know of: a large batch of Page Insights metrics was retired, and Instagram's
`impressions` was replaced by `views`.

**So treat every metric name in this document as a candidate, not a fact.** Phase
1 includes a deliberate half-day of calling the live API against one real Page
and writing down what actually comes back for the current API version. The data
model in §5 is shaped specifically so that being wrong about a metric name costs
a row in a lookup table instead of a migration.

I would rather tell you this now than have you find it when a graph is empty.

---

## 4 · What Meta will and will not give you

### It will

- **Account-level, daily:** reach, impressions/views, profile or page views,
  engagement, follower count, follows and unfollows
- **Per-post:** reach, impressions/views, likes, comments, saves, shares, and
  video views for reels
- **Demographics:** follower city, country, age, gender — aggregate only
- **Instagram Stories:** reach, taps forward/back, exits, replies
- Roughly **2 years** of account-level history for Instagram, shorter for some
  metrics

### It will not

- ⚠️ **Give you anything for a personal Instagram account.** Insights exist only
  for **Business** and **Creator** accounts, and the account must be linked to a
  Facebook Page. A client on a personal account returns nothing at all — not an
  error, just no data. **This is the single most common blocker and it needs
  checking per client before anything else.**
- Give follower demographics for accounts under **100 followers** (privacy floor)
- Give you competitor data
- Let you backfill follower history beyond its own retention window (§1)
- Work at all for a Page your Business account has no role on

---

## 5 · The data model, and the one decision that matters

### 5.1 Where the link lives — a table that is already waiting

`project_platforms` already exists and already has the right shape:

```
project_platforms
  project_id, platform_id
  handle          text   -- NULL on every row today
  page_url        text   -- NULL on every row today
  assets_target, reels_target
```

Daniyal Marketing has a Facebook row and an Instagram row, **both with
`handle` and `page_url` null.** The join point was built and never filled in.

So this needs no new linking table — it needs two columns on that one:

```
+ meta_object_id   text    -- the Facebook Page ID, or the IG user ID
+ linked_at        timestamptz
+ link_error       text    -- why the last sync failed, in words
```

⚠️ **The ID, not the URL, is the identity.** A page URL is a vanity slug the
client can change at any time, silently breaking the link. The numeric object ID
never changes. Keep `page_url` for humans to click; sync on `meta_object_id`.

### 5.2 The connection and its token

`drive_connection` is the precedent to copy — it already solves this exact
problem:

```
drive_connection
  account_email, refresh_token_encrypted, connected_by_id,
  connected_at, last_error, last_error_at
```

Sealed with `seal()` / `open()` from `lib/auth/secret-box.ts` under
`MFA_ENCRYPTION_KEY`, read through one `SECURITY DEFINER` function that
**deliberately cannot return the token** (migration 029). A `meta_connection`
table takes the same shape and the same rules.

⚠️ **One difference from Drive, and it is not cosmetic.** Drive is a singleton —
one Google account for the whole division. Meta is not: you hold **one user
token** but derive **one Page access token per Page**, and those are what the
sync actually uses. So the token store is one row per linked Page, not one row
total.

### 5.3 ⚠️ The metrics table — narrow, not wide, and here is why

Two ways to store a daily number, and the choice is load-bearing:

**Wide** — a column per metric:
```
metric_days(project_platform_id, on_date, reach, views, engagement, followers, …)
```
Reads beautifully. **And every time Meta renames or retires a metric it needs a
migration**, which §3 says will happen repeatedly.

**Narrow** — a row per metric:
```
platform_metric_days
  project_platform_id, on_date, metric_key, value numeric
  primary key (project_platform_id, on_date, metric_key)
```
Slightly clumsier to query. **A new or renamed metric is one row in a catalogue
table and nothing else.** A retired metric simply stops arriving, and the history
already collected stays queryable for ever.

**Recommendation: narrow**, with a `platform_metrics` catalogue giving each key a
label, a format and a display order — the same pattern `platforms` already uses.
Given §3, this is the difference between Meta's churn costing an afternoon and
costing a migration each time.

### 5.4 Followers deserve their own table

```
platform_follower_days
  project_platform_id, on_date, followers integer, delta integer
```

Technically a metric like any other, kept separate for one reason: **it is the
answer to the question you actually asked** — *"whether the account is progressing
or still at the same position."* It is read on its own, compared period over
period, and it is the series that must never have a gap. Its own table makes the
gap visible and makes "snapshot every account every day, no matter what else
fails" a rule the schema states rather than a hope.

### 5.5 Per-post metrics, and a real gotcha

```
platform_post_metrics
  task_placement_id, meta_post_id, fetched_on,
  reach, views, likes, comments, shares, saves
```

⚠️ **Matching a pasted URL to a Meta post is the hard part, and it is worth
knowing before it is promised.** Your team pastes a permalink into
`task_placements.url`. Going from a permalink back to the API's post ID is
unreliable — for Instagram it is effectively not supported.

Three options, in order of how well they work:

1. **Capture the ID at publish time** — best, and impossible while posting
   happens by hand in the Meta apps rather than through Taskly.
2. **Match by date** — pull the account's recent media, line it up against
   placements by `published_on`. Works well at one post a day, ambiguous the
   moment two go out on the same day.
3. **Ask the person to paste the ID** — reliable and nobody will do it.

**Recommendation: option 2, and be honest in the UI when it cannot match.** A row
reading *"couldn't match this post"* is worth more than a confidently wrong
number. This is also the argument for doing account-level metrics first (§7) —
they need none of this and answer most of your questions.

---

## 6 · Turning numbers into the answer

Data alone is not what you asked for. You asked *"whether they are growing"* and
*"whether they are lacking."* That is a judgement, and it needs stating in code.

### The comparison

For any project, platform and period: this period against the one before it.
Followers, reach, views, engagement — each with a direction and a percentage.
`lib/domain/report-charts.ts` and its `bucketsFor(period)` already do the period
bucketing for reports; this reuses it rather than inventing a second calendar.

### Cadence × outcome — the loop you actually want closed

Taskly knows the promise (`static_posts_per_day`, `reels_per_week`, the package)
and knows what went out (`task_placements`). Meta will know what came of it. Put
side by side:

> **Daniyal Marketing — August**
> Promised 1 static/day + 1 reel/week → **28 of 31 posted**
> Followers **1,240 → 1,318 (+6.3%)**
> Reach **+18%** · Engagement **−4%**
> *Reach is up with posting. Engagement per post is down — more people are
> seeing it, fewer are acting on it.*

⚠️ **Two honesty rules, or this feature becomes a liability:**

1. **Never claim causation.** Posting more and followers rising in the same month
   is not proof one caused the other. The wording says what both did, and lets
   the reader draw the line. A client will eventually read one of these.
2. **Below a floor, say nothing.** On an account with 200 followers, +6 is noise.
   The verdict tolerance already learned this the hard way in the project report
   — a fully-missed day read as "on track" because a 10% tolerance swallowed it.
   Same trap, same fix: **no verdict below a threshold**, and the threshold is
   stated on screen.

---

## 7 · Phasing — ordered by what cannot be recovered

**Phase 0 · Prerequisites — you, not me. Start today.**
Check every client account is Business/Creator and linked to a Page (§4). Create
the Meta Business account, get Pages shared to it, register the app, submit App
Review and Business Verification. **No code, and it gates everything.**

**Phase 1 · Connect and identify.** OAuth flow, sealed tokens, and a screen that
lists the Pages and IG accounts you can reach so you tick which belongs to which
project — writing `meta_object_id` onto the `project_platforms` rows that have
been sitting null. Ends with the half-day of API reconnaissance from §3.

**Phase 2 · ⚠️ The daily snapshot. Do this before any UI.**
A cron beside the existing two in `vercel.json` (`0 19 * * *` = midnight Karachi,
the repeat runner's slot). Every linked account, every night: followers and the
account-level metrics. Writes `platform_follower_days` and
`platform_metric_days`, and records a failure per account rather than dying on
the first one.

Nothing is visible after this phase, and it is still the most valuable one —
**it is the only phase whose delay costs data you can never get back** (§1).

**Phase 3 · The overview.** Now that history exists, draw it. Per-platform cards
on the project overview, today's table (posts, reach, views, engagement), and
month-over-month graphs through the existing `ChartSpec`.

**Phase 4 · Per-post metrics.** The date-matching from §5.5, and honest gaps.

**Phase 5 · The summary.** §6's cadence × outcome paragraph, into the project
overview and the generated report PDF.

**Later · TikTok.** §11.

---

## 8 · What the screens would show

**Project overview — a card per platform**
Followers with its 30-day direction, reach, views, engagement. Last synced, and
plainly if a sync is failing.

**Today's table** — your words: *"today's post, Facebook post reach, Instagram
reach, Instagram views, engagement"*

| Post | Platform | Reach | Views | Engagement |
|---|---|---|---|---|

Built from `task_placements` for today joined to whatever metrics matched, with
*"not matched yet"* where §5.5 could not line it up.

**Growth graphs** — followers over time, reach per week, engagement rate; the
promised cadence drawn against what was delivered.

⚠️ **Insights are for the team, not the client.** A client-facing figure in a
report PDF is a number you are accountable for. Anything client-facing gets
labelled with its source and its sync date.

---

## 9 · Risks, honestly

| Risk | Weight | What to do |
|---|---|---|
| **App Review rejected or slow** | **High** | Start Phase 0 now; it blocks all of it |
| Client IG is personal, not Business | **High** | Audit every client this week — it is free to check |
| Metric names wrong (§3) | Medium | Narrow table (§5.3); reconnaissance in Phase 1 |
| Post↔placement matching fails | Medium | Account-level first; show gaps honestly |
| Client revokes access | Medium | `link_error` surfaced on the project, not silent |
| Token expiry | Low | Drive's refresh pattern already solves this |
| Rate limits | Low | ~15 accounts nightly is nothing; batch anyway |
| Small-account noise (§6) | Medium | Verdict floor, stated on screen |

**Cost:** the Graph API is free. No new spend.

---

## 10 · Open questions — yours to answer, not mine

1. **How many client accounts, and are they Business accounts?** This decides
   whether Phase 0 is a morning or a month. It is free to check today.
2. **Does the agency already have a Meta Business account** with these Pages, or
   does that start from nothing?
3. **Who owns each client's Page** — you, or the client? Changes how access is
   granted and how easily it is withdrawn.
4. **Do these numbers go in client-facing reports,** or stay internal? §8 —
   affects wording and accountability, not the build.
5. **Which single project is the pilot?** Daniyal Marketing has both platforms
   and a defined cadence, which makes it the obvious candidate.
6. **Is paid advertising in scope?** Ad spend and ROAS are a different permission
   set and a much larger surface. I have assumed **organic only**.

---

## 11 · When TikTok arrives

TikTok has its own Display and Business APIs, its own review process, and its own
metric vocabulary. The design above absorbs it without rework — `platforms`
already has the `tiktok` slug, `project_platforms` already has its row, and a
narrow metrics table (§5.3) takes new keys without a migration.

What will **not** carry over is anything that assumes Meta's shapes: token
handling, the API client, the metric catalogue entries. Keep the sync code behind
a per-platform interface from the start and TikTok is an addition rather than a
rewrite.

---

## 12 · What I recommend you do next

**This week, without me:**

1. **Audit the client accounts** — Business or personal? Linked to a Page? Free,
   and it is the answer that most changes the plan.
2. **Confirm the Meta Business account position** (question 2).

**Then, together:** pick the pilot project, and I will draft the App Review
submission — it needs a written use-case, a screencast and a privacy policy, and
that is a document I can write for you.

⚠️ **Do not wait for App Review to be finished before Phase 2.** Development
mode gives full access to Pages your own app has a role on, which is enough to
build and test the entire snapshot pipeline against one real account — and enough
to start accumulating the history that §1 says cannot be backfilled.
