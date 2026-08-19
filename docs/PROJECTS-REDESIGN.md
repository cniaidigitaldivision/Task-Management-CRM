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

## 2 · The eight growth packages

From *CNI Digital Growth Packages & Rate Card 2026* and the per-package booklet.

| # | Package | Monthly fee (PKR) | Positioning |
|---|---|---|---|
| 1 | **SPARK** | 50,000 | Starter presence |
| 2 | **STARTER** | 85,000 | Active local business |
| 3 | **GROWTH** | 125,000 | Consistent growth |
| 4 | **MOMENTUM** | 175,000 | Stronger engagement |
| 5 | **PERFORMANCE** | 250,000 | Lead generation |
| 6 | **SCALE** | 350,000 | Scaling brands |
| 7 | **PLATINUM** | 500,000 | Full digital growth system |
| 8 | **ENTERPRISE** | 750,000+ | Dedicated growth department |

**SPARK, in full**, because it shows the shape every package shares:

- 2 managed platforms — **Facebook and Instagram**, named
- **14–16 monthly content assets**
- **2 reels / short videos**, *included within* that count
- monthly content calendar and post scheduling
- basic page management and community handling
- Google Business Profile setup or optimisation
- one basic Meta advertising campaign
- monthly performance report and review call
- *explicitly no CRM or website*

**PERFORMANCE**, for contrast: up to 75 monthly assets, AI Sales Agent, advanced
WhatsApp automation, 10-page website, up to 4 landing pages, advanced CRM,
monthly content shoot, SEO/AEO/GEO, up to 2 blogs, weekly strategy call.

⚠️ **Two things to resolve against the source documents before seeding:**

1. **The rate card and the booklet disagree.** The card labels package 5
   *"Scaling Domination Package"*; the booklet titles it *"Lead Generation
   Package"*. Similar drift on SPARK's asset count.
2. **Lower tiers name their platforms; higher tiers do not.** SPARK says
   "Facebook and Instagram"; PERFORMANCE gives a count and capabilities. So
   platform *identity* is fixed for small packages and chosen per project for
   large ones — the schema has to allow both.

I could not read the PDFs directly: **`pdftoppm` is not installed**, so PDF
rendering fails in this environment. Everything above came from the images. Before
seeding real package rows, either install poppler or confirm the numbers.

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

## 12 · Deliberately not building

Billing and invoicing · a real social-media scheduler (this records what was
published; posting to Meta's API is a different product) · a client-facing
portal. None was asked for, and each would change the schema.
