# ✅ TASKS — the Google Sheet, and what the schema actually needs

> **Status: analysis. One correction to my own migration 033 identified.**
> Owner described the real working process on 2026-08-19: a Google Sheet kept by
> the team coordinator, shared with the team and the CEO.

---

## 1 · The sheet as it works today

One row per piece of content, created by the team coordinator:

| Column | Meaning |
|---|---|
| Date | when the task is for |
| Created by | the coordinator |
| Who is making it | the person shooting/editing |
| Description | which business or project this video is for |
| **Google Drive link** | the raw material — clips, photos, brief |
| Graphics | done / not done |
| **Reels Drive link** | the finished asset |
| **Facebook post link** | where it went live |
| **Facebook reel link** | " |
| **Instagram post link** | " |
| **Instagram reel link** | " |
| **TikTok reel link** | " |
| **YouTube video link** | " |
| Status | in process → done |

**Why the links matter most:** owner, 2026-08-19 — *"When I give a report to a
super admin, he can click on that link and directly go to that page or that exact
post."* A report that says "12 assets published" is a claim. A report where each
one is a link to the live post is evidence.

---

## 2 · ⚠️ The three "task types" already exist. Adding them would be the mistake I just criticised

Owner: *"some are daily tasks and some are progressive tasks… some tasks are very
urgent tasks. Do this right now. I need a logo within an hour."*

All three are already expressible, and I want to be explicit about it rather than
add three fields that duplicate working machinery — that is exactly the
`priority_tier` / `expected_scale` problem from the Projects audit, which I
recommended deleting nine fields over.

| What the owner called it | What already exists |
|---|---|
| **Urgent task** — "a logo within an hour" | `task_priority` already includes **`urgent`**. And `time_limit_minutes` + the timer already express "within an hour" precisely, with alerts. |
| **Progressive task** — a website, showing progress | `task_status` is already an eight-state flow: `backlog → todo → in_progress → blocked → in_review → revisions → done / cancelled`. And `parent_task_id` exists, so a website is a parent with subtasks and its progress is "4 of 7 done" — a real fraction, not a guessed percentage. |
| **Daily task** — daily posting | `recurrence_rule` already exists and already spawns the next occurrence. |

**So no new "task kind" enum.** What the sheet needs is not a new way to classify
work — it is the columns that record *what was produced and where it went*.

The one thing worth adding is a way to *see* those three shapes on screen: a
filter for "urgent", "recurring", "has subtasks". That is a view, not a column.

---

## 3 · ⚠️ MY MISTAKE: `tasks.platform_id` cannot work

Migration 033 gave a task **one** `platform_id`. The sheet shows why that is
wrong: a single video is published to Facebook as a post *and* a reel, to
Instagram as a post *and* a reel, to TikTok, and to YouTube. **One asset, six
placements, six different URLs.**

A single column can hold one of them. The other five would have nowhere to go, and
the CEO's clickable report — the entire point — would be impossible.

### The correction

```
tasks.content_kind        stays.  WHAT this deliverable is (reel, static, …)
tasks.platform_id         GOES.   cannot express one-to-many
tasks.published_on        stays.  when the asset first went out

task_placements           NEW.    one row per platform it was published to
  task_id
  platform_id
  content_kind            post vs reel ON THAT PLATFORM — a video can be
                          both a Facebook post and a Facebook reel
  url                     the clickable link the CEO follows
  published_on            per placement, because they rarely go out together
```

Plus two link columns on the task itself, which are about the *work*, not about
publication:

```
tasks.source_drive_url     the raw material — the sheet's "Google Drive link"
tasks.asset_drive_url      the finished file — the sheet's "Reels Drive link"
```

`platform_id` has never been read by any code — 033 added it and the UI was never
built — so removing it costs nothing and breaks nothing.

---

## 4 · ⚠️ OPEN, AND IT CHANGES EVERY NUMBER IN THE REPORT

**Does one video posted to four platforms count as one asset, or four?**

The packages say *"14–16 monthly content assets"*. The sheet's shape — one row,
one video, many links — reads as **one asset with several placements**. So:

- **assets** = count of tasks (one row of the sheet = one asset)
- **placements** = where it went, and the evidence trail

I have modelled it that way in §3 because it matches both the sheet and the
package wording. But if the agency counts a cross-post as a separate asset, every
target in the system is wrong by a factor of three or four, so this must be
confirmed rather than assumed.

---

## 5 · What the task form needs to become

Grouped, because the current form asks for everything at once and this sheet has
three distinct phases:

**The brief** — project, description, assignee, date, priority, effort. Mostly
exists.

**The material** — content kind (static / reel / carousel), source Drive link,
finished asset Drive link. The Drive link should be **pickable from the folder
registry** we already built, not pasted: owner asked that *"all the Google Drive
folders should appear"*, and migration 027's `drive_folders` is exactly that list.

**The publication** — a row per platform with a URL and a date, added as each one
goes live. This is what turns the task list into the sheet the CEO wants.

Status stays the eight-state flow. "In process → done" is already two of its
states, and a website build gets `in_review` and `revisions` for free.

---

## 6 · The documents inventory

Found in `Downloads/AI & Digital/`:

| File | Pages | What it is |
|---|---|---|
| `CNI_AI_Digital_Packages_2026_Final_Expanded.pdf` | 31 | Full package booklet — one page per package, plus the comparison matrix on p3 |
| `CNI_AI_Digital_Combined_Booklet_Final_Updated.pdf` | 21 | Combined booklet |
| `CNI_AI_Digital_Full_Package_Deck_Arranged (1).pdf` | 14 | Deck; p1 is the rate card |
| `CNI_AI_Digital_Packages_Front_Back_Print (1).pdf` | — | Print card, front/back |
| `CNI_Selected_Exact_AI_Package/` | — | Design sources: `.ai`, `.eps`, `.svg`, 300dpi `.png` |

⚠️ The `.ai` / `.eps` / `.svg` files are **design sources, not documents**. They
are 25–28 MB each and no browser will preview them. They belong in the library as
downloads with a clear label, not as things anyone will try to open in a tab.

### ⚠️ A defect in the rate card itself

On the deck's page 1, SPARK's asset line renders as **"1-4 B Monthly Assets"**
instead of "14–16". I cropped and enlarged it to be sure. The comparison matrix
(p3) and SPARK's own booklet page both say **14–16** clearly, so the seeded value
is right — but **the rate card that goes out to clients has a corrupted number on
it.** Probably a font-embedding problem in whatever exported it. Worth fixing at
the source before it is sent again.

---

## 7 · Build order for this area

1. Migration 034 — drop `tasks.platform_id`, add `task_placements`, add the two
   Drive link columns
2. Task form grouped into brief / material / publication, with the Drive folder
   picker
3. Placement rows, so links accumulate as each platform goes live
4. Progress: assets and reels published this month vs the project's agreed target
5. The CEO report, where every figure carries its links
