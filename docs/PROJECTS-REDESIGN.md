# 🏗️ PROJECTS — the agency model, and how the page has to change

> **Status: analysis and agreed decisions. Nothing built yet.**
> Owner asked on 2026-08-19 for the audit first, then supplied the package
> documents and answered the schema questions. This file now records both.

---

## 1 · How the agency actually works

**Attari Group of Companies** is the umbrella. Work is either **internal** (a
sister company) or **external** (a paying client).

| Internal | External |
|---|---|
| CNI / Crescent Nova | GC Royal |
| Danyal Marketing | ImPremium |
| Chitral Housing Society / Chitral Royal Homes | …and every other client |
| AGC Interior | |

> ⚠️ **This list is not going into the code.** Owner, 2026-08-19: *"Definitely I
> will add all of the project by myself, by putting in a proper internal or
> external. You just organize all of the form, its presentation, and its handling
> in a proper way."*
>
> So internal-vs-external is a **field the owner sets per project**, and the
> company list is data they maintain — not an enum a developer has to redeploy to
> change. The table above is context for understanding, nothing more.

Every engagement is sold from one of **eight monthly growth packages**, and may
additionally buy from **fifteen one-off or monthly services**. The package is the
contract: it fixes how many platforms are managed, how many content assets are
published a month, how many of those must be reels, and whether a website or CRM
is included.

That target is the spine. A daily task is not a work item — it is **a deliverable
against a target**: this platform, this content kind, this date. Progress on a
project *is* published-versus-promised.

---

## 2 · The eight growth packages — the seed data

Read from **page 3 of `CNI_AI_Digital_Packages_2026_Final_Expanded.pdf`**, the
"Package Comparison & Add-Ons" matrix. This page is the authority: it states all
eight packages in one table, so it cannot disagree with itself the way the rate
card and the booklet do.

Poppler is now installed (`winget install oschwartz10612.Poppler`), so the PDF was
read directly. ⚠️ It is an **image-based** PDF — `pdftotext` returns 31 bytes —
so pages must be rendered with `pdftoppm` and read visually. Text extraction is
not an option for these documents.

| | SPARK | STARTER | GROWTH | MOMENTUM | PERFORMANCE | SCALE | PLATINUM | ENTERPRISE |
|---|---|---|---|---|---|---|---|---|
| **Retainer (PKR/mo)** | 50,000 | 85,000 | 125,000 | 175,000 | 250,000 | 350,000 | 500,000 | 750,000+ |
| **Platforms** | 2 | 3 | 4 | 5 | 5 | Multi-location | Multi-market | Custom |
| **Monthly assets** | **14–16** | **22–25** | **30–32** | **40** | **up to 75** | **up to 120** | High-volume | Enterprise capacity |
| Paid ads | 1 basic Meta | 2 Meta | Meta + Google | Multi-channel | Lead-gen | Advanced perf. | Multi-market | Enterprise |
| Website | none | 1 landing page | 1 landing + optimisation | 5-page site | 10-page corporate | Advanced / redesign | Custom portal | Full SaaS |
| CRM | none | Basic lead tracking | Light CRM | Intermediate | Advanced | Advanced + BI | ERP/CRM integration | Custom CRM |
| Automation / AI | WhatsApp auto-reply | Follow-up sequence | WhatsApp follow-up | CRM automation + AI-UGC | AI Sales Agent | AI Voice Agent | Videography + multilingual | Executive + governance |
| Reporting | Monthly | Bi-weekly | Weekly + dashboard | Advanced dashboard | Executive dashboard | BI dashboard | Board-level | Custom executive |
| Free benefit | Visibility Consultation | Growth Guidance | Performance Audit | Expo Promotion | Growth Workshop | Brand Authority Film | Leadership Brand Film | Executive Documentary |

**Named platforms** (only the lower tiers name them; the rest give a count):

- SPARK — Facebook, Instagram
- STARTER — Facebook, Instagram, TikTok

So the schema must allow **both**: platforms fixed by the package, and platforms
chosen per project up to a limit.

**Popular add-ons** (page 3): Extra Reel Pack from 25,000 · Shoot Day from
40,000 · Landing Page Design from 35,000 · CRM Setup from 60,000 · WhatsApp
Automation from 75,000 · Meta/Google Ad Creative Pack from 30,000 · Brand
Identity Mini Refresh from 50,000 · Website Design/Revamp quoted separately.

### ⚠️ The reel minimum is not stated for most packages

This matters, because the agreed model is "reels are inside the asset total, with
a reel minimum".

- **SPARK** states it: *"2 reels / short videos included"*
- **STARTER** does not. It says *"static posts, reels and carousel content mix"* —
  a mix, with no number
- the comparison matrix has no reel row at all

So a reel minimum can only be enforced where the document gives one. See the open
question in §13.

**Content kinds are confirmed** by STARTER's wording: **static post, reel,
carousel**.

### On the earlier "conflict"

Owner, 2026-08-19: *"the assets that are provided in each package must be the
same"* — correct. The comparison matrix agrees with the per-package booklet
(SPARK 14–16 in both). What differs between documents is **pricing and package
subtitles**, not deliverables. My earlier reading of "1–8 assets" came from a
low-resolution phone image of the rate card and was simply wrong. **Assets are
consistent; treat them as authoritative.**

---

## 3 · The fifteen services

CRM Solutions (150k/mo) · WhatsApp API Automation (125k/mo) · Website Development
(from 75k) · SEO & AI Visibility (60k/mo) · Automatic Social Media Setup (from
55k) · Dealer App (180k) · Customer Portal (250k) · Executive Portal (180k) · App
Development (from 120k) · Real Estate ERP (650k) · ERP Solutions (1m) · POS
System (250k) · Custom Software (on demand) · Branding (from 3.5k) · Printing
(from 9k).

**Agreed:** a project may hold a package **and** services. A monthly GROWTH
retainer plus a one-off POS build is one project with both.

---

## 4 · Decisions taken (owner, 2026-08-19)

| Question | Decision |
|---|---|
| Ranges like "14–16" | **Store min and max. The minimum is the promise.** 14 published = target met; 15–16 = bonus. "Up to 75" = max 75, no minimum. |
| Reels vs assets | **Reels are inside the total.** 14–16 assets of which ≥2 reels. Reported as two bars: assets vs target, reels vs reel minimum. A project can hit 16 assets and still be short if none were reels. |
| Services | **A project can have a package and services.** |
| Internal / external | **The owner sets it per project.** No hardcoded company list. |
| `event` | **A separate dimension, not a third category.** My call, stated for correction: an internal event and a client event are both real, so `event` cannot sit in the same field as internal/external. A project is internal-or-external *and* has a shape (retainer / one-off build / event). |

---

## 5 · What already exists and does not need rebuilding

- **Credentials are already AES-256-GCM sealed** (`lib/auth/secret-box.ts`),
  already carry `project_id`, and have no plaintext write path. The
  dissatisfaction is about **placement and grouping** — they belong on the
  project, sorted by purpose — not about the cryptography.
- **The reporting engine exists** with PDF/Excel/CSV export. It asks about task
  mechanics rather than deliverables; the plumbing is reusable.
- `projects.drive_folder_id` exists and folder→project sync works. The reverse,
  **project→folder on creation**, is not wired, though `createFolder` now exists.
- `start_date` already defaults to today.

## 6 · The nine fields to remove

`priority_tier` · `expected_scale` · `retainer_hours_per_month` ·
`internal_sponsor` · `reason_not_a_project` · `campaign_goal`/`objective`/`area` ·
`channel` · `engagement_type` · `is_permanent`.

Each is a question asked of a person that no report can answer. **`channel` is
the actively harmful one** — it is the platform list written as prose, which is
exactly why nothing can currently be counted.

---

## 7 · ⚠️ The reason all of this matters: JSONB cannot be reported on

`type_fields` is a free-form JSONB blob. It let five project types each ask their
own questions, and it means nothing in it can be counted, grouped or charted.
`channel: "Instagram + YouTube"` is a sentence, not two platforms.

The owner's largest requirement is reporting. A report is an aggregation, and
prose does not aggregate. **The work is not "add a package field" — it is moving
what the agency actually manages out of prose and into countable structure.**

---

## 8 · The shape to build

- **`packages`** — name, monthly fee, platform count, `assets_min`/`assets_max`,
  `reels_min`, includes-website, includes-CRM, active. Editable in the app: the
  offering changes and must not need a developer.
- **`services`** — the fifteen, with price and unit (monthly / per project).
- **`project_services`** — which a project bought, and its delivery state.
- **`project_platforms`** — this project, this platform, its own targets. Because
  Instagram might carry 3 reels a week while Facebook carries one.
- **`project_members`** — explicit, with a role on the project. Today "who is on
  this project" is *inferred* from task assignees, so a person with no task yet is
  invisible. Accountability must be recorded, not deduced.
- **`tasks.platform` + `tasks.content_kind`** — static / reel / story / carousel /
  website / other. **This is the join that makes everything else possible**: with
  it, "what went out yesterday, for whom, on what" is a query.
- **`companies`** — a list the owner maintains, with internal/external on the
  project.

**One project detail page, tabbed** — Overview (package, targets, progress
charts) · Platforms & posts · Team · Credentials · Documents. The owner's words:
*"switch here, see this, switch there, see this."* There is no detail page at all
today; clicking a project goes nowhere.

---

## 9 · The document library

Owner wants the agency's own PDFs — rate card, per-package booklet, front/back
print card — stored and **viewable in a tab, not downloaded every time**, and
named so the right one is findable.

- Supabase Storage, private bucket, served through a signed URL and rendered
  inline (`Content-Disposition: inline`), exactly as the Drive file route now
  does for documents.
- A **category** on each: `package_card` · `package_detail` · `booklet` ·
  `brochure` · `other` — so "show me the packages" is a filter, not a hunt.
- Named on a convention rather than as uploaded, e.g.
  `packages/2026/cni-packages-rate-card-2026.pdf`.
- ⚠️ Owner asked that each document be **read before filing** so it is named for
  what it contains. `pdftoppm` is missing, so that cannot be automated here yet.

## 10 · The report pipeline

`CHATGPT_API_KEY` is in `.env.local` (confirmed present, server-side, absent from
the committed template).

**⚠️ The figures must never come from the model.** They are computed from the
database — assets published vs package minimum, per project, per platform — and
passed in. An LLM asked to total a column will occasionally be wrong and will
always sound certain, and a board report is the last place for that. The model
composes and presents; it does not calculate.

Flow: query → figures → prompt → generated graphic → embedded in a PDF →
viewable and downloadable.

---

## 11 · Build order

1. Schema — packages, services, platforms, members, task fields
2. Seed the eight packages and fifteen services from the source documents
3. Project create/edit form rebuilt around package → platforms → targets
4. The project detail page
5. Progress reporting against targets
6. Document library
7. AI report composition

Reports come last on purpose: a report can only be as good as the structure
beneath it, and the AI layer makes a good report beautiful — it cannot make a
missing one exist.

## 13 · ⚠️ RESOLVED — the package is a template, the project holds the truth

Owner, 2026-08-19: *"the package should appear in the field. Definitely by
default the package has that value but we can adjust those values at the time of
creation of a project. We can put how many reels, how many static posts."*

So: pick SPARK, the form fills in 14–16 assets and 2 reels, and any of it can be
edited before the project is saved.

### The consequence, which decides the schema

**The agreed targets are COPIED onto the project, not looked up from the package
at report time.** This is the single most important decision in the model, and
getting it the other way round would quietly corrupt every historical report.

If a project merely pointed at `packages.assets_min`, then editing the SPARK
package next year — raising it from 14 to 18 — would retroactively change what
every existing SPARK client had been promised. Reports run over last quarter
would suddenly show projects missing a target nobody had agreed to at the time.
History would rewrite itself every time the offering changed.

The same reasoning as writing the price onto an order line rather than reading it
from the product: **you record what was agreed, not what is currently on the
shelf.**

So `packages` supplies defaults for the form, and the project stores
`assets_target_min`, `assets_target_max`, `reels_target_min` and the agreed fee
as its own columns. Change a package tomorrow and every existing project is
untouched.

It also disposes of the reel-minimum gap entirely: SPARK seeds 2 because the PDF
says so, the other seven seed null, and the owner sets each one the first time
they create a project on that package — or edits the package once and every
future project inherits it.

---

## 14 · Superseded — the reel minimum

The agreed model is "reels sit inside the asset total, with a minimum". Only
SPARK states one (2). STARTER says "static posts, reels and carousel content mix"
with no number, and the comparison matrix has no reel row.

Three ways to handle it, and this needs the owner's answer:

1. **Reel minimum is a field on the package that the owner fills in.** Nothing is
   invented; SPARK starts at 2 and the rest are set once, in the app.
2. **No reel minimum except where printed.** SPARK enforces 2; every other package
   reports reels published without judging them against a promise.
3. **Set per project, not per package**, because a restaurant and a law firm on the
   same package want a different mix.

Option 1 is the least work and the most honest — the number exists, it simply
lives in the owner's head rather than in the PDF.

---

## 12 · Deliberately not building

Billing and invoicing · a real social-media scheduler (this records what was
published; posting to Meta's API is a different product) · a client-facing
portal. None was asked for, and each would change the schema.
