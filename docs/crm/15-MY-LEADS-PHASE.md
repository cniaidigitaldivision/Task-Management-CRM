# 15 · My leads — everything needed before that page can be drawn

**The page:** the sales consultant's **My leads**, from the owner's reference of
2026-09-14. **This is the phase being built now.** `14-SALES-WORKSPACE-PHASES.md`
has the wider order; this file is the parts list for one screen.

**The interaction rule, in the owner's words:**

> *"I don't want to go somewhere else to view any details… He will stay or she
> will stay on their lead page and view a specific row."*

So: **row click opens a drawer, not a page.** The name is the one thing that
navigates, to the full record. Everything else — the message, the next action,
WhatsApp, email, follow-up — opens over the list without losing the row.

---

## Every element, against what exists today

### ✅ Already there — no new data

| Element | Where it comes from |
|---|---|
| Assigned leads · Needs attention · Due today · Unread replies | `crmDueCounts`, already RLS-narrowed to the caller |
| Tabs: All · Needs attention · Waiting for reply | `due` filter, incl. `waiting` |
| Project picker · search · Quick actions | the lead desk's, reused |
| Lead name · project · city · next action · due | `crm_leads` |
| Latest conversation body and time | `crm_lead_messages` (138) |
| Avatar initials (FR, AB, HS…) | derived from the name — no column needed |
| Name → full record | `/leads/[id]` exists |

### 🔨 Must be built for this page

| # | Item | Why |
|---|---|---|
| 1 | **`/sales` workspace and its rail** | The page has no home yet. Rail: My sales desk · My leads · My follow-ups · Conversations · Appointments · My quotations · **Attendance** · My tasks · Calendar · My performance · Help. ⚠️ Only entries whose screen does something appear |
| 2 | **`/sales/leads`** | RLS already narrows to the caller, so this is a view, not a new query path |
| 3 | **The lead drawer** | The owner's core requirement. Slide-over with the lead's detail, tabs for Overview · Conversation · Follow-ups · Related |
| 4 | **Inline stage dropdown** | The design edits the stage *in the row*. Needs a server action + optimistic update, and it writes `crm_lead_activity` like any other stage change |
| 5 | **`priority`** | New column. See the decision below |
| 6 | **Source widening** | See the decision below |
| 7 | **Tabs: Upcoming · Closed** | Two new `due` values — `upcoming` (a future next action) and `closed` (won or lost) |
| 8 | **Stage as a dropdown filter** | Today it is a chip strip. The design wants a select beside "More filters" |
| 9 | **Composers over the list** | WhatsApp and email open on top of the row, not on another page |

### ⏸️ In the design, deferred on purpose

| Element | Blocked on |
|---|---|
| `5 Marla Plot - A-101, Block A` under each name | **Properties — Phase C.** Absent until then, not faked |
| Quotation amount and validity | **Quotations — Phase D** |
| "Email connected · sarah@…" in the footer | ⚠️ There is **no email integration**. It would be a green dot backing nothing — it stays grey and says "not connected", as the lead desk already does |
| A "subject" line on the latest conversation | Subjects are an email concept. WhatsApp has a body and no subject; showing a fabricated one would be inventing content |
| Message → Conversations, next action → Follow-ups | Those screens are later phases. Until they exist, both open the **drawer** on the matching tab — same information, no dead link |

---

## ⚠️ Three decisions needed before code

These are genuine forks, not details. Guessing any of them wrong means a
migration to undo.

### 1 · The stage names in this design do not match anything else

| The design shows | Our enum | The lifecycle spec wanted |
|---|---|---|
| Initial contact | `contacted` | contacted |
| **New reply** | — | — |
| **Proposal pending** | — | — |
| **Site visit** | `visited` / `scheduled` | visit_scheduled |
| Quotation sent | — | quotation_sent |
| Won | `won` | won |

⚠️ **"New reply" is not a stage — it is a conversation state**, and putting it in
the stage column means a lead that replies loses its real position in the funnel.
The design already carries that information twice: the green WhatsApp mark and
the "Unread replies" card. Recommend it stays out of the stage list.

**Proposed final list** (the same one in `12-LIFECYCLE-SPEC.md`, extended to
cover this design):

> new · contacted · qualified · **proposal_pending** · **quotation_sent** ·
> **visit_scheduled** · visited · negotiation · won · lost

with `follow_up` demoted to an activity state, as the spec asks.

### 2 · Priority, or temperature — or both?

The design has a **Priority** column: `Normal · High · Low`.
We already have **temperature**: `hot · warm · cold`.

These are different axes and it matters which is meant:

| | Answers | Set by |
|---|---|---|
| **Temperature** | how likely are they to buy? | the salesperson, after talking |
| **Priority** | who do I ring first? | the rota, the manager, or an SLA |

⚠️ **Keeping both means every row carries two ratings that look like the same
thing**, and the pair will drift the first week. Three ways out — the owner
picks:

| | |
|---|---|
| **a** | **Priority replaces temperature.** Simplest. Loses "warm/cold", which nothing currently reads except a badge |
| **b** | **Keep both, show only Priority here.** Honest, but two fields to maintain |
| **c** | **Priority is derived, not stored** — overdue + unanswered reply = High, plan set = Normal, closed = Low. ⚠️ **Recommended:** nothing extra to keep up to date, and it is always true |

### 3 · Source needs more values than the enum has

Design: Facebook · Google · LinkedIn · Website · Instagram · Referral, each with
a sub-label — *Lead ad · Search ad · Contact form · Existing client*.
Ours: `meta_lead_ad · whatsapp · website · manual`.

Proposed: widen the enum to the channels and add a **`source_detail`** text
column for the sub-label. ⚠️ Two columns rather than one long enum, because
"Lead ad" and "Search ad" are the ad *type*, and enumerating every channel ×
type combination is how an enum reaches thirty values nobody can read.

---

## Build order inside this phase

Each step is checkable on its own; none needs the next one to be useful.

1. **`/sales` shell + rail + the page's header, cards and tabs** — no new tables.
2. **The table**, with the columns that have data today.
3. **The drawer** — the owner's main requirement, and the biggest piece.
4. **Inline stage edit**, once the stage list is settled (decision 1).
5. **Priority** (decision 2) and **Source** (decision 3).
6. **Upcoming / Closed tabs** and the stage filter.
7. **Composers over the list.**

---

## How to check it — at every step

> Sign in as **Sarah** → `/sales/leads`.
>
> · The list holds **only her leads** — Sahad's must not appear. Sign in as Sahad
>   and confirm a different set. ⚠️ **Do not verify this as an Admin.** An Admin
>   sees everything, so this exact check has passed six times over a broken page;
>   see migrations 105, 121, 125, 129, 130, 140.
> · The four cards must agree with the tabs — press **Needs attention**, count
>   the rows.
> · **Click a row** → the drawer opens over the list. The list must still be
>   behind it, on the same page and the same scroll position.
> · **Click the name** → the full record at `/leads/[id]`.
> · Change a stage in the row → reopen the lead; the activity log must carry the
>   change, with Sarah's name on it.

---

## Built · Add Lead (2026-09-15)

The spec's order of operations, and where each step lives.

> *"Before creation: Normalize phone and email; Check duplicates; Check whether
> an open lead exists; Check existing customer history; Check previous lead
> ownership."* · *"After creation, call the existing automatic assignment
> function."*

| Step | Where |
|---|---|
| Normalise phone | `toE164` in `lib/domain/phone.ts`, before the write |
| Check duplicates, open leads, customer history | `app.crm_lead_duplicates` (158) |
| Refuse / warn | `duplicateVerdict` in `lib/domain/crm-new-lead.ts`, and `CRM05`/`CRM06` |
| Create | `app.crm_create_lead` (158) |
| Assign | `app.crm_lead_rota` (156), called once, inside the same transaction |
| Record why | `crm_lead_assignments.reason` + `reason_text` (154), frozen |

### Migrations

| # | What |
|---|---|
| **156** | `whatsapp_consent` (+`_at`), `preferred_channel`, `preferred_time`, `users.crm_max_open_leads`; `app.crm_eligible_owners`; the rota now filters |
| **157** | `crm_activity_kind` gains `created` — alone, because a new enum label cannot be used in the transaction that adds it |
| **158** | `app.crm_lead_duplicates`, `app.crm_create_lead` |
| **159** | `app.crm_add_lead_projects` — the picker |

### The five decisions worth remembering

**1 · The owner is not a parameter.** *"The salesperson must not select an
owner."* Enforced by three signatures that have no field for one — the component,
the action, and `app.crm_create_lead`. A rule that cannot be expressed cannot be
forgotten by a second call site.

**2 · Eligibility gates; working hours still only order.** Migration 133 was
right that filtering on working hours means a lead arriving at 2am is assigned to
nobody. Leave is different — somebody on a week's holiday is not coming back
tonight — so 156 splits the filter in two:

- **hard** — inactive, not a salesperson, over capacity. Never relaxed.
- **soft** — on leave. Relaxed only when respecting it would leave nobody, which
  is one Eid holiday row away.

`users.crm_max_open_leads` is **NULL for everybody**. A default cap nobody chose
would quietly starve a working salesperson.

**3 · Consent has three states.** `true` / `false` / **NULL, meaning nobody
asked** — which is not the same as a refusal, and the sequence engine has to be
able to tell them apart before it may send.

**4 · One duplicate finding cannot be overridden.** An **open** lead for this
person, on this project, belonging to **somebody else**. Refused by the database
(`CRM05`), and the message names the colleague so the next step is "add a note to
Sahad's lead" rather than "this is a duplicate". A lead on another project is
**not** a duplicate — `crm_clients` has no `project_id` for exactly this reason.

**5 · A landline is not a refusal.** `toE164` returns null for `051-1234567`, and
`CRM04` tests the **raw** phone, not the normalised one. What is lost without an
E.164 form is duplicate matching and WhatsApp, and the form says so.

### Two bugs this phase found

**The membership predicate, for the seventh time.** `crmAddLeadProjects` was
written as a query on `public.projects` with the department rule in its `WHERE`.
RLS applies first, so the rule never ran and the picker held **zero** projects —
the form could not be used at all. Invisible from an Admin session, which passes
`project_is_visible` and sees a picker that works. Found by
`scripts/check-add-lead.mjs`, fixed by migration 159. Migration 125 had already
written the warning on the wall.

**A unit from another project.** `crm_leads.property_id` references
`crm_properties` and nothing else, so a plot from Chitral could be attached to an
Executive Housing lead — and every later quotation, payment plan and price would
describe a property the client was never shown. Reachable from the screen: the
form loads the catalogue for the project in view and lets the project be changed.
Now refused by `CRM07` and hidden by the form.

### How to check it

    node scripts/check-add-lead.mjs

Runs the whole path under **each real person's session** — never an Admin's — and
cleans up after itself. It proves: the picker is not empty, a salesperson can
create a lead at all, the rota owns it with its figures on record, the lead is
flagged as test data without anybody ticking a box, a colleague cannot read it
but **is** told it exists, retyping it is refused, and somebody outside sales can
neither create a lead nor use the duplicate reader as a phone directory.

⚠️ **A self-check that can silently skip is worse than none.** The foreign-unit
check in 158 was first written as a lookup for a property on another project —
both properties in the database are on the demo project, so it read as proof
while proving nothing. It now creates its own fixture and raises if it cannot.

### Still open

- The **rendered form has not been looked at in a browser** — signing in needs
  the owner. Everything behind it is measured; the layout is not.
- `next_action_type` is collected but no reminder reads it yet — Phase G.
- A manager cannot yet set `crm_max_open_leads` from a screen.
