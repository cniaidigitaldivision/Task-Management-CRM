# Data model — the tables, the keys, the relationships

Owner, 2026-09-10: *"Are you properly creating tables? Are you properly managing
each lead relevant to each project and the relevant campaign? Who will handle
that lead? These are the database terms: proper keys and everything should be
properly implemented so that every filter, every report, and every last thing
could easily be done."*

Straight answer: **yes, and here is exactly how.** Six new tables, every
relationship a real foreign key, and at the foot of this file every filter and
report you have asked for, mapped to the column that serves it.

⚠️ Nothing is built yet. This is the design being proposed — migration **110**.

---

## The shape, in one picture

```
                    projects  (exists)              users  (exists)
                        │                              │
        ┌───────────────┼──────────────┐               │
        │               │              │               │
        ▼               ▼              ▼               │
  crm_campaigns   crm_lead_forms   crm_clients         │
        │               │              ▲               │
        │  campaign_id  │  form_id     │ client_id     │ owner_id
        └───────┬───────┴──────────────┴───────────────┘
                ▼
            crm_leads  ◄──────────────────────┐
                │                             │
        ┌───────┴────────┐                    │
        ▼                ▼                    │
 crm_lead_notes   crm_lead_activity ──────────┘
```

Read it as a sentence: **a lead comes from a form, which belongs to a campaign,
which belongs to a project; the lead is owned by a user, may become a client, and
accumulates notes and activity.**

---

## Your four questions, answered by four keys

| Your question | The key that answers it |
|---|---|
| "each lead relevant to each project" | `crm_leads.project_id → projects.id`, **NOT NULL** |
| "and the relevant campaign" | `crm_leads.campaign_id → crm_campaigns.id` |
| "who will handle that lead" | `crm_leads.owner_id → users.id` |
| "which form it came from" | `crm_leads.form_id → crm_lead_forms.id` |

Every one is a real foreign key with a real constraint — not a text field
somebody types, and not a number that means nothing when the row it pointed at is
gone.

---

## 1 · `crm_campaigns` — a Meta campaign, mapped to one project

This is the table that makes "which campaign produced this lead" answerable, and
it is where the **project mapping** lives.

```sql
create table public.crm_campaigns (
  id                 uuid primary key default gen_random_uuid(),

  -- ⚠️ THE MAPPING YOU ASKED FOR. One campaign belongs to one project.
  project_id         uuid not null references public.projects(id) on delete restrict,

  -- Meta's own id. UNIQUE, so importing twice updates rather than duplicates.
  meta_campaign_id   text not null unique,
  name               text not null,

  ad_account_id      text,           -- act_1383869210625183
  page_id            text,           -- which page its ads post to
  objective          text,           -- OUTCOME_LEADS
  status             text,           -- ACTIVE / PAUSED

  -- ⚠️ NOT EVERY CAMPAIGN IS A SALES CAMPAIGN. "Female model Hiring campaign"
  -- is recruitment. False keeps its leads out of the sales pipeline and out of
  -- every conversion report, rather than quietly ruining both.
  is_sales           boolean not null default true,

  created_at         timestamptz not null default now()
);

create index on public.crm_campaigns (project_id);
```

**`on delete restrict`** on the project, deliberately: deleting a project that
still has campaigns and leads under it should fail loudly, not cascade away a
year of lead history.

---

## 2 · `crm_lead_forms` — the form a lead was actually submitted on

A separate table because **leads arrive attached to a form, not to a campaign**.
Meta gives us the form id on every lead; the campaign has to be resolved
separately (see `06-CAMPAIGNS-AND-COVERAGE.md`). Keeping them apart means the
importer never blocks on attribution it cannot get.

```sql
create table public.crm_lead_forms (
  id             uuid primary key default gen_random_uuid(),

  -- ⚠️ THE FALLBACK PATH TO A PROJECT. If campaign attribution is unavailable,
  -- the form still knows its project, so no lead is ever unfiled.
  project_id     uuid not null references public.projects(id) on delete restrict,
  campaign_id    uuid references public.crm_campaigns(id) on delete set null,

  meta_form_id   text not null unique,
  name           text not null,
  page_id        text not null,
  status         text,
  created_at     timestamptz not null default now()
);

create index on public.crm_lead_forms (project_id);
create index on public.crm_lead_forms (campaign_id);
```

---

## 3 · `crm_leads` — the row everything else hangs off

```sql
create table public.crm_leads (
  id              uuid primary key default gen_random_uuid(),

  -- ── The four relationships ──────────────────────────────────────────────
  project_id      uuid not null references public.projects(id)     on delete restrict,
  form_id         uuid          references public.crm_lead_forms(id) on delete set null,
  campaign_id     uuid          references public.crm_campaigns(id)  on delete set null,
  owner_id        uuid          references public.users(id)          on delete set null,
  client_id       uuid          references public.crm_clients(id)    on delete set null,

  -- ── Where it came from ──────────────────────────────────────────────────
  source          public.crm_lead_source not null,   -- meta_lead_ad | whatsapp | website | manual
  external_id     text,                              -- Meta's lead id

  -- ── The person ──────────────────────────────────────────────────────────
  full_name       text,
  phone           text,          -- exactly as they typed it
  phone_e164      text,          -- +923001234567 — derived, and what we match on
  email           text,
  city            text,

  -- ⚠️ EVERY ANSWER, RAW. Meta's field keys are whatever the advertiser typed:
  -- "which__size_are_you_interested_in?_". A column per question needs a
  -- migration per campaign, so the questions that matter get real columns above
  -- and the whole answer set is kept here, losing nothing.
  answers         jsonb not null default '{}'::jsonb,

  -- ── Working it ──────────────────────────────────────────────────────────
  stage           public.crm_stage not null default 'new',
  temperature     public.crm_temperature,            -- hot | warm | cold
  lost_reason     public.crm_lost_reason,
  next_action     text,
  next_action_at  timestamptz,

  -- ── Time ────────────────────────────────────────────────────────────────
  submitted_at    timestamptz not null,   -- when THEY filled the form
  imported_at     timestamptz not null default now(),
  first_contacted_at timestamptz,         -- response time is measured from this
  closed_at       timestamptz,

  created_by_id   uuid references public.users(id) on delete set null,

  -- ⚠️ THE CONSTRAINT THAT MAKES THE IMPORTER SAFE TO RUN TWICE. Without it, a
  -- retry, an overlapping cron or a manual re-run duplicates every lead — and
  -- the cron WILL overlap eventually.
  constraint crm_leads_source_external unique (source, external_id)
);
```

### The enums, as agreed with you

```sql
create type public.crm_stage as enum (
  'new', 'contacted', 'follow_up', 'qualified',
  'visited', 'scheduled', 'negotiation', 'won', 'lost'
);

create type public.crm_temperature as enum ('hot', 'warm', 'cold');

create type public.crm_lost_reason as enum (
  'wrong_number', 'not_serious', 'budget_too_low', 'wrong_location',
  'no_answer', 'bought_elsewhere', 'wants_what_we_dont_offer',
  'duplicate', 'revisit_later'
);
```

⚠️ **Enums, not free text.** A text field fills up with "wrong no.", "Wrong
Number", "wrng number" and no report can group it. An enum is the difference
between a lost-reason report that means something and a list of typos.

---

## 4 · `crm_clients` — a lead that engaged

Your rule: *"once he is interested, or we give some quotation and he accepted…
that would become our client."* One client, many leads — the "Khurram · 16 Leads"
column in your screenshot.

```sql
create table public.crm_clients (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  phone_e164     text,
  email          text,
  city           text,
  first_lead_at  timestamptz,
  converted_at   timestamptz not null default now(),
  converted_by_id uuid references public.users(id) on delete set null,
  notes          text
);

create unique index on public.crm_clients (phone_e164) where phone_e164 is not null;
```

⚠️ **No `project_id` here, on purpose.** A person who enquires about Chitral and
then about Executive Housing is one person, not two clients. The link to projects
comes through their leads — `crm_leads.client_id` — so "16 leads across 3
projects" is one query. *(This is Q16; say the word if you want clients scoped to
a project instead.)*

---

## 5 · `crm_lead_notes` — what was said and quoted

Your example: *"what quotation I have given him."*

```sql
create table public.crm_lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.crm_leads(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index on public.crm_lead_notes (lead_id, created_at);
```

`on delete cascade` from the lead — a note about a deleted lead is orphaned data.
But `on delete set null` from the author: a person leaving must not erase what
they wrote, the same rule `project_remarks` follows.

---

## 6 · `crm_lead_activity` — the timeline

Every call, message, stage change and assignment, in one place. This is what
renders "Call – Contacted Client · 9 days ago", and what the AI later reads.

```sql
create table public.crm_lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  kind        public.crm_activity_kind not null,
  outcome     text,             -- "no answer", "asked to call Friday"
  detail      jsonb,            -- stage from→to, who it was assigned to
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index on public.crm_lead_activity (lead_id, occurred_at desc);
```

⚠️ **`occurred_at` is separate from `created_at`.** A call logged an hour later
happened an hour ago, and response-time reporting that confuses the two is wrong
by however long the salesperson took to write it down.

⚠️ **Append-only.** No UPDATE or DELETE policy at all. An activity log somebody
can edit is not evidence of anything.

---

## 7 · One change to an existing table

```sql
alter type public.project_role add value 'sales';
```

`project_members.role` is currently `manager, content, design, development, ads,
video, other`. Adding `sales` is how a person becomes sales team on a project —
which is the CRM's access rule, as you specified: Admin, Super Admin, Team
Coordinator, plus project members marked sales.

⚠️ This must be its **own migration**, applied before anything references it.
`ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it — the
same split migrations 106 and 107 needed.

---

## Every filter and report you asked for, mapped to a key

This is the test of whether the design is right.

| What you want | How it is served |
|---|---|
| Leads for one project (the dropdown) | `crm_leads.project_id` + index |
| "Which campaign brought this lead" — the column | `crm_leads.campaign_id → crm_campaigns.name` |
| Filter by campaign | `crm_leads.campaign_id` + index |
| "How many campaigns are live for Chitral" | `count(*) from crm_campaigns where project_id = … and status = 'ACTIVE'` |
| "How many leads per campaign" | `group by campaign_id` |
| A staff member sees only their leads | `crm_leads.owner_id` + RLS policy |
| "Who is handling this lead" | `owner_id → users.full_name` |
| Filter by stage / temperature / date | Indexed columns, not jsonb |
| Sort by next action | `(project_id, next_action_at)` index |
| Find a caller by number | `phone_e164` index |
| Duplicate detection | `phone_e164`, and the unique `(source, external_id)` |
| One client, many leads | `crm_leads.client_id` |
| Lost-reason report | `lost_reason` enum — groupable because it is an enum |
| Response time per person | `first_contacted_at − submitted_at`, grouped by `owner_id` |
| "6,000 leads, no closes — staff or campaign?" | `group by owner_id` × `group by campaign_id` over `stage` |
| Search inside the form answers | `answers` jsonb, with a GIN index **only if this becomes real** |

⚠️ **Notice what is *not* in jsonb.** Everything you filter, sort or report on is
a real column with a real index. The jsonb holds only the raw answers, so nothing
Meta sent is lost — but no report ever depends on digging into it.

---

## Row-level security — who sees what

| Role | Policy |
|---|---|
| Super Admin / Admin | Every lead |
| Team Coordinator | Every lead |
| Project member with `role = 'sales'` | Leads where `owner_id = app.current_user_id()` |
| Anyone else | Nothing |

⚠️ Three traps this codebase has already paid for, and each is designed around
here rather than discovered later:

1. **`users_select` hides the staff table from a Member.** Joining to get an
   owner's name returns null for a sales member and renders as "Former member" —
   exactly the bug found on 2026-09-08. Fixed with a SECURITY DEFINER reader
   scoped to rows the caller can already see, never a wider `users_select`.
2. **The importer runs with no session**, where RLS fails closed and a blocked
   insert returns zero rows while reporting success. Its writer is SECURITY
   DEFINER, and the migration self-checks with `app.user_id` unset.
3. **A CHECK constraint passes when its expression is NULL.** Any "required when"
   rule uses an explicit `is not null`, or it accepts exactly the row it exists to
   refuse. Migration 107 proved this twice in one evening.
