# 🏗️ PROJECTS — what it is, what you asked for, and the gap

> **Status: analysis only. Nothing has been built.** Owner instruction, 2026-08-19:
> *"I don't want you to rush to start implementing. I want you to first go and see
> what things you have already done in the project page and what things I have told
> you."*

---

## 1 · What I understood about how the agency actually works

**Attari Group of Companies is an umbrella.** Inside it sit CNI itself, Danyal
Marketing, Chitral Housing Society, AGC Interior, GC Royal and ImPremium. So a
large share of the work is **internal** — one sister company serving another —
and the rest is **external** clients. Events (the Shne Subhanur expo was the
example) are a third shape again.

Every engagement, internal or external, is sold as a **package**: Starter,
Growth, and so on, plus bespoke ones for particular clients. The package is not
a label. It is the contract, and it decides everything downstream:

- **how many social platforms** are handled (Growth ≈ 2, say Facebook and
  Instagram) — some fixed by the package, some chosen from a list up to the
  package's limit
- **whether a website** is built or maintained
- **whether a CRM** is built (basic, not the full thing this application is)
- **the posting target** — how many static posts and how many reels, per
  platform, per week or month

That target is the spine of the whole system. Daily tasks are not "work items";
they are **deliverables against a target**: this platform, this content type
(static or reel), this date. Progress on a project *is* the count of what was
published against what was promised.

From that, the CEO wants to be able to ask — daily or monthly:

- how many projects are we running, and what state is each in
- **who** is on each project, so a delay or a blunder has an owner
- what was published yesterday, on which platform, for which client
- is this project hitting the target its package promised, or falling behind

Every project also carries **credentials** (domain registrar, CRM login, the
client's Gmail, each social account) and **documents** (their brochures, contact
lists, raw video, whatever they send). A Drive folder named after the project
should exist from the moment the project does.

And finally: a report worth sending to a CEO — charts, not a spreadsheet dump —
which you want generated through the ChatGPT API into a presentable, downloadable
PDF.

**One thing I want to check with you:** you said *"two categories: internal or
external"* and later described event projects. I have read that as **three**
(internal / external / event). It is also possible an event can itself be
internal or external, in which case it is a second dimension rather than a third
category. See the questions at the end.

---

## 2 · What the Projects page is today

### The database

`public.projects` holds: `name`, `type`, `code`, `description`, `status`,
`owner_id`, `start_date`, `target_end_date`, `start_time`, `target_end_time`,
`is_permanent`, `type_fields` (jsonb), `drive_folder_id`, `is_draft`.

`project_type` is an enum: **`event | client | business | self_promotion |
other`**.

### The screens

Two files: a list/grid workspace and a create/edit dialog. **There is no project
detail page.** Clicking a project does not take you anywhere — everything is a
row in a list, which is exactly why you cannot see one project's whole story in
one place.

### The per-type fields

Beyond the real columns, each type asks for extra fields stored in the
`type_fields` JSONB blob:

| Type | Fields it asks for |
|---|---|
| event | venue, expected_attendance |
| client | client_name, engagement_type, contract_end, contact_person, contact_email, contact_phone, retainer_hours_per_month, priority_tier |
| business | objective, area, internal_sponsor, target_completion |
| self_promotion | channel, campaign_goal, target_publish_date |
| other | requested_by, reason_not_a_project |
| *(all types)* | expected_scale (Small/Medium/Large) |

---

## 3 · ⚠️ The central problem, and it is not a missing field

**The current design is a generic project tracker. You are describing an agency
delivery system.** Those are different things, and the difference is not
cosmetic.

The clearest symptom is `type_fields`. It is a **free-form JSONB blob**. That
was a reasonable way to let five project types each ask their own questions —
but it means:

- nothing in it can be counted, grouped, filtered or charted reliably
- `channel: "Instagram + YouTube"` is a sentence, not two platforms
- there is no way to ask "how many projects include Instagram", because the
  answer lives in prose

**Your single biggest requirement is reporting.** A report is an aggregation, and
you cannot aggregate a paragraph. So the work is not "add a package field" — it
is to move the things you actually manage out of prose and into real, countable
structure.

The second symptom: `type` mixes two unrelated ideas. `client` and `business`
are really *who it is for* (external vs internal), while `event` is *what shape
of work it is*. Because they share one enum, an internal event and a client event
cannot both be expressed.

---

## 4 · What is already there and is genuinely good

I want to be clear about what does **not** need rebuilding, because two of these
you may not know you already have.

### ✅ Credentials are already properly encrypted

You said *"I'm not satisfied with that bit because it's not advanced and not as
secure as I want."* Worth knowing exactly what is there:

- `public.credentials` already has `project_id` — **credentials are already
  per-project**
- secrets are sealed with **AES-256-GCM** (`lib/auth/secret-box.ts`), an
  authenticated cipher, keyed from an environment variable that never reaches
  the browser
- the sealing happens in the query layer, so there is no code path that can
  write a plaintext secret, and a database constraint refuses one anyway
- there is already `kind`, `username`, `url`, `notes`, `expires_at`,
  `last_rotated_at`

The encryption is not the weak part. What is missing is **the shape**: a project
needs *several* credentials organised by what they are for (domain, hosting,
CRM, each social account), and they should be visible **on the project**, not
only on a separate Vault page. That is a UI and grouping problem, not a
cryptography problem.

### ✅ The reporting engine exists

`/reports` already produces Completion, Workload & capacity, Project status, and
Time & overrun, with **PDF (via print), Excel and CSV** export. The plumbing for
periods, filters and export is built.

What it reports on is **task mechanics** — how many done, how late, how much
time. Not *deliverables against a package target*. So the engine is reusable; the
questions it asks are the wrong ones for a CEO of an agency.

### ✅ Drive is half-wired

`projects.drive_folder_id` exists, and a Drive folder can already become a draft
project. The reverse — **create a project, get a folder** — is not wired, though
`createFolder` now exists and is used by the Documents screen.

### ✅ Sensible existing fields worth keeping

`client_name`, `contact_person`, `contact_email`, `contact_phone`,
`contract_end`, `venue`, `expected_attendance`, and `start_date` already
defaulting to today.

---

## 5 · The "extra things" — what I would remove

You said some things are *"very extra"*. Reading them against how you actually
work, these are the ones that earn nothing:

| Field | Why it should go |
|---|---|
| `priority_tier` | Free text, placeholder `"A"`. Nobody can define A vs B, and nothing reads it. |
| `expected_scale` (Small/Medium/Large) | Asked of every project. Never used in any report or decision. The package now says how big the work is. |
| `retainer_hours_per_month` | An hours-based retainer model you do not sell. You sell **deliverables** — posts and reels. |
| `internal_sponsor` | Duplicates `owner_id`, which is a real column with a real foreign key. |
| `reason_not_a_project` | An audit field for a category (`other`) that should not exist once internal/external/event covers reality. |
| `campaign_goal`, `objective`, `area` | Three different prose boxes for "why are we doing this". One optional description covers it. |
| `channel` (free text) | Actively harmful — it is the platform list written as a sentence, so it cannot be counted. Replaced by real platform rows. |
| `engagement_type` (Retainer/One-off) | Superseded by the package, which says this properly. |
| `is_permanent` | A column with no meaning in an agency where engagements have packages and renewal dates. |

That is nine fields out. Not to be tidy — every one of them is a question asked
of a human being that no report will ever answer.

---

## 6 · What is missing

| What you asked for | Today |
|---|---|
| internal / external / event | ✗ `type` is event/client/business/self_promotion/other |
| Which company in the group (CNI, Danyal, AGC Interior…) | ✗ nothing records this |
| **Package** (Starter / Growth / Custom) | ✗ does not exist in any form |
| Package defines platforms, website, CRM | ✗ |
| Platform list, limited and pre-ticked by package | ✗ |
| **Targets** — N static, N reels, per platform, per period | ✗ |
| A task knowing its platform and content type | ✗ tasks have no such fields |
| Published-vs-target progress, charted | ✗ |
| Explicit **team assignment** to a project | ⚠️ derived from task assignees only. No `project_members` table, so "who is on this project" cannot be stated, only inferred — and a person with no task yet is invisible |
| Credentials grouped and shown on the project | ⚠️ data model is there, the placement is not |
| Drive folder auto-created with the project | ⚠️ half |
| **A project detail page** | ✗ does not exist at all |
| CEO report on deliverables | ⚠️ engine exists, asks the wrong questions |
| AI-written PDF with graphics | ✗ |

---

## 7 · The shape I would propose

Not a build plan yet — the shape, so you can tell me where I have it wrong.

**Packages become real rows, not a dropdown of names.** A `packages` table:
name, whether it includes a website, whether it includes a CRM, how many
platforms it allows, and its default targets. Editable by you, because your
offering will change and it must not need a developer. A project points at a
package; a **custom** package is the same row type, just belonging to one project.

**Platforms become rows too.** A `project_platforms` table: this project, this
platform, and its own targets — because Instagram might be 3 reels a week while
Facebook is 1. The package sets the limit and the defaults; the project can tick
the rest up to that limit.

**A task gains a platform and a content type.** This is the join that makes
everything else possible: `platform` and `content_kind` (static / reel / story /
website / other) on the task. Then "what did we publish yesterday, for whom, on
what" is a query rather than a guess, and progress-against-target is arithmetic
instead of opinion.

**A `project_members` table.** Explicit, with a role on the project (manager,
designer, developer, coordinator). Accountability has to be recorded, not
inferred from who happened to be assigned a task.

**A `company` dimension** — Attari Group and its members — so internal work can
be attributed to the right business, and the CEO can ask "how much are we doing
for AGC Interior".

**One project detail page, tabbed**, so nothing needs scrolling: Overview
(package, targets, progress charts) · Platforms & posts · Team · Credentials ·
Documents. You said it exactly: *"switch here, see this, switch there, see this."*

**Reports last**, because they are downstream of all of it. A report can only be
as good as the structure underneath, and the AI/PDF layer is the very last step —
it makes a good report beautiful; it cannot make a missing one exist.

---

## 8 · What I need from you before building

1. **The packages PDF** you mentioned. Names, what each includes, platform
   counts, posting targets. This is the spine — I would rather wait for it than
   invent a Starter/Growth/Pro and have you correct it later.
2. **Internal / external / event — three categories, or is `event` a separate
   dimension?** An internal event and a client event both seem real to me.
3. **Which platforms** do you actually handle? (Facebook, Instagram, TikTok,
   LinkedIn, YouTube, X, WhatsApp, Threads, Pinterest, Snapchat…)
4. **Which content kinds** count as deliverables? I have static post, reel,
   story, carousel — is that the list?
5. **Are targets per platform or per project?** "Growth = 2 platforms, daily
   static" reads per-platform to me, but confirm.
6. **The group companies** — is Attari Group the only umbrella, and is the list
   in §1 complete?
7. **Existing projects.** There are 7 today. Do they get migrated onto packages,
   or archived and re-created?

---

## 9 · What I would deliberately not build

- **Billing, invoicing or payments.** You did not ask, and a half-built money
  feature is worse than none.
- **A full social-media scheduler.** You publish elsewhere; this records and
  measures what was published. Actually posting to Meta's API is a different
  product with a different failure mode.
- **A client-facing portal.** Not mentioned, and it changes every access rule in
  the system.

If any of those is wrong, say so now rather than later — each one changes the
schema.
