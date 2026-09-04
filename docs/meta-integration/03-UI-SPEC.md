# 🎨 UI SPEC — Trend & Engagement Studio

> **Status: specified, nothing built.** No route, no component file exists.
>
> ⚠️ **THIS IS A SEPARATE PAGE, NOT A PROJECT TAB.** The owner changed the plan
> explicitly on 2026-09-04: *"before I was saying data within the project… I
> don't want that to change anything inside of the project. I want to create a
> separate page."* Nothing under `app/(app)/projects/` may be modified.

---

## 1 · Where it lives

**Route:** `/studio` · **Sidebar:** under `PROJECTS`, below the existing
*Projects* item · **Label:** `Trend & Engagement Studio`

Access: `team_coordinator` and above, matching `/reports`. Scope inside is
row-level security, not this file.

---

## 2 · The shell

```
┌──────────────────────────────────────────────────────────────┐
│ ⟦T⟧  Trend & Engagement Studio                               │
│      ┌──────────────────────┐              ┌───────────────┐ │
│      │ AI & Digital Div.  ▾ │              │ Sep 1 – Sep 30│ │
│      └──────────────────────┘              └───────────────┘ │
│  [ f ] [ ig ] [ + ]                        connected accounts │
├──────────────────────────────────────────────────────────────┤
│  Overview │ Content & Posts │ Meta Accounts │ Analytics │ …   │
└──────────────────────────────────────────────────────────────┘
```

- **Project dropdown** — lists only projects that have at least one linked Meta
  account. A project with no social media never appears; the owner was explicit
  that those keep their current layout and are not part of this.
- **Connected platform icons** — large Facebook and Instagram marks, plus a `+`
  to link another. Uses the existing `PlatformIcon` and `PLATFORM_MARKS`.
- **Date range** — defaults to this month. ⚠️ Cap the picker at ~30 days back
  until enough history has accumulated; offering "last 6 months" against a table
  holding 30 days draws an honest-looking empty graph.
- **Platform filter** — All / Facebook / Instagram, applying to the whole tab.

### Tabs

| Tab | Phase |
|---|---|
| **Overview** | **Now — the only one being built** |
| Content & Posts | Later |
| Meta Accounts | Later |
| Analytics & Insights | Later |
| Reports & Exports | Later |
| Settings & Sync | Later |

Render the later tabs as visible-but-disabled with a "coming soon" state, so the
information architecture is legible from day one rather than appearing later as a
surprise.

---

## 3 · Overview — the only tab in scope

### 3.1 · KPI row — 6 cards

| Card | Source |
|---|---|
| **Monthly Target** | `projects` cadence × days in month. Progress bar + "N days left" |
| **Achieved** | Posts published this period, from `meta_posts` |
| **Remaining** | Target − achieved, plus "needed per day" |
| **Total Followers** | `meta_accounts.followers`, summed across platforms |
| **Engagement Rate** | `total_interactions ÷ reach`, as a percentage |
| **Total Views** | `views` summed over the period |

Each carries a **vs previous period** delta, coloured by direction. That is the
owner's *"this month versus previous month"* comparison, and it belongs on every
card rather than as a separate control.

⚠️ **A delta must compare like with like.** A card showing a month-to-date figure
against a full previous month is the `+1640%` bug from the dashboard, in a new
place. Compare the same number of elapsed days.

### 3.2 · Charts

| Panel | Shape | Notes |
|---|---|---|
| **Engagement Trend** | Line, daily | Big current rate + delta above it |
| **Followers Growth** | Filled area, daily | The "is it growing" answer |
| **Weekly Performance** | Stacked bars | Reach / Engagement / Views / Clicks per week |
| **Engagement Heatmap** | 7 × 24 grid | Day-of-week × hour. ⚠️ Only if hourly data exists — Meta's day-period metrics do **not** carry an hour, so this needs post timestamps instead. If it cannot be built honestly, drop it rather than fake it |
| **Delivery Progress** | Donut | Delivered / Scheduled / Remaining against target |
| **Content Type Mix** | Donut or bars | Reels / Posts / Stories / Videos from `media_product_type` |

### 3.3 · Lists

- **Top-Performing Posts** — thumbnail, caption, platform icon, date, engagement,
  rate. Sortable. ⚠️ **The whole row is a link to `meta_posts.permalink`,
  `target="_blank"`** — the owner's *"if I want to see some post, I will just
  click it and it will bring me to that post."* Verified available.
- **Recent Activity** — new posts, follower milestones, sync results.

### 3.4 · Audience — ⚠️ blocked, decision needed

**Top Locations** and **Age & Gender** are in the screenshots and **cannot be
drawn for the current account.** `follower_demographics` returns empty below 100
followers, and the account has 16 (`01-VERIFIED-API-FACTS.md` §5).

Options: hide until available · show with *"Available once the account passes 100
followers — Meta's privacy threshold"* · omit entirely for now.

**Recommend the second** — it explains an absence the owner would otherwise read
as a bug. Awaiting the answer in `00-STATE-AND-TRACKER.md` §7.

---

## 4 · Design direction

Owner: *"unique, sleek, beautiful, interactive… no white space anywhere in the
performance matrix."*

- **Use the existing design system.** `styles/tokens.css`, teal brand, gold
  accent, the type scale. This must look like Taskly, not a bolted-on dashboard.
- **Dense grid, deliberate gaps.** Every panel earns its area. The "no white
  space" instruction means no dead regions inside cards — not cramped spacing.
- **Both themes.** Every token used must have a light and a dark definition, or
  the panel renders one theme's text on the other's ground.
- **Charts:** SVG, built to the existing `ChartSpec` vocabulary where it fits.
  ⚠️ Chart colour tokens ending `-l` are **fills, not ink** — using them for text
  fails contrast in light theme. Recorded in memory from an earlier session.
- **Interactive:** hover tooltips with exact values, clickable posts, working
  platform filter, range picker.
- **Every panel needs three states** — loading (skeleton), empty ("no data yet,
  first sync runs at …"), and error (which account failed and why). ⚠️ The empty
  state is not optional: for the first day after launch, **every** panel is
  empty, and a page of blank cards reads as broken.

---

## 5 · Where the data comes from

⚠️ **The page never calls Meta.** It reads only Taskly's own tables. Owner: *"I
will not fetch live things… I will set a cron job… We will fetch data from the
database and show and draw a graph there."*

```
Meta Graph API ──(cron, every 1–2h)──▶ meta_* tables ──▶ /studio
```

This is why a slow or failing Meta API can never make the page slow or broken —
it makes it *stale*, and the Settings & Sync tab says so.
