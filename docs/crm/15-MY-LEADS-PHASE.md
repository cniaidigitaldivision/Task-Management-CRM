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
