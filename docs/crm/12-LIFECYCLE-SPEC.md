# 12 · The lead lifecycle — the owner's specification, and the road to it

**Status: SPECIFICATION AND TRACKER. Nothing here was implemented on the day it
was written (2026-09-14).** Owner: *"After reading all this it's still a planning
phase. Do not implement anything. Just understand all this."*

**This is the file to read before building anything else in the CRM.** It holds
the owner's own research, what the system already does against it, measured
rather than remembered, and the order the rest should be built in.

---

## The rule the whole system hangs on

Owner's words, and the best sentence in the specification:

> **Every open lead must always have an owner, a current stage, a last outcome
> and a next action with a due time.**

⚠️ **This is an invariant, not a guideline, and it is worth treating as one.** It
is the thing that makes every screen answerable: a desk sorted by "what is owed"
only works if nothing can sit there owing nothing. Today the database does not
enforce it — `owner_id` and `next_action_at` are both nullable, and **629 of 652
leads have neither**. Closing that gap is what turns the desk from a list into a
system.

⚠️ **AND THE SECOND-BEST SENTENCE IS THE SEPARATION.** The owner's §8 table —
Lead vs Stage vs Assignment vs Conversation vs Follow-up vs Sequence vs Task vs
Quotation vs Property vs Appointment vs Activity log — is correct data modelling,
and it is the part most CRMs get wrong by collapsing three of them into one
table. It should be treated as binding.

---

## Where we actually are — measured 2026-09-14

| Spec concept | Today | Evidence |
|---|---|---|
| **Lead record** | ✅ built | `crm_leads`: name, phone, phone_e164, email, city, project, source, campaign, answers, submitted_at, stage, temperature, lost_reason, next_action(+at), owner |
| **Lead capture — Meta lead ads** | ✅ built | the importer, migrations 112/113, 632 real leads |
| **— website form** | ⚠️ enum only | `crm_lead_source` has `website`; no endpoint writes it |
| **— WhatsApp** | ⚠️ partial | inbound messages attach to an EXISTING lead (138, 142). A stranger messaging creates nothing |
| **— manual entry** | ⚠️ test form only | `crm-test-lead.ts`, demo project only, marked for deletion |
| **— CSV / API** | ❌ | — |
| **WhatsApp permission / opt-out** | ❌ | no column. Needed before any sequence sends |
| **Duplicate checking at capture** | ❌ | `external_id` gives idempotency per source, nothing more. ~18 of 615 leads already share a number; `alsoEnquired` only *shows* siblings after the fact |
| **Eligibility filter (leave, capacity, region, access)** | ❌ | the rota ranks the whole Sales roster |
| **Rota / auto-assign** | ✅ built | migration 133, four signals |
| **Assignment reason ("why this person")** | ❌ | nothing is recorded |
| **Assignment notification** | ✅ built | `lead_assigned` (119/120) |
| **First-contact task** | ❌ | — |
| **Response SLA clock** | ❌ | `median_response_minutes` measures it after the fact; no deadline, no breach |
| **My Sales Desk** | ✅ built | `/my-leads`, migration 136 |
| **Contact outcomes** | ⚠️ partial | 13 activity kinds incl. call_connected/no_answer, whatsapp_sent, email_sent, won, lost. **Missing:** wrong number, not interested, interested later, appointment requested |
| **Stages** | ⚠️ 9 of the spec's shape | new · contacted · follow_up · qualified · visited · scheduled · negotiation · won · lost. **No `quotation_sent`** |
| **Lost reasons** | ✅ built, and good | wrong_number · not_serious · budget_too_low · wrong_location · no_answer · bought_elsewhere · wants_what_we_dont_offer · duplicate · **revisit_later** (the spec's "nurture") |
| **Qualification fields** (budget, size, timeline, purpose…) | ❌ | only the raw `answers` jsonb from the Meta form |
| **Conversation — WhatsApp** | ✅ built | 138–145: send, receive, media both ways, status, bell on reply, 24-hour window shown |
| **Conversation — email** | ❌ | `mailto:` only. No integration, and the footer says so |
| **Follow-up (one next action)** | ✅ built | `next_action` + `next_action_at`, due counts, notifications (122/123) |
| **Sequence (multi-step)** | ⚠️ state only | migration 147 stores where a lead sits. **No steps table, no scheduler, nothing advances it** |
| **Task** | ⚠️ exists elsewhere | Taskly's own task system is not wired to leads |
| **Quotation** | ❌ | no table, no numbering, no versioning, no PDF |
| **Property / item catalogue** | ❌ | — |
| **Appointment** | ❌ | — |
| **Activity log** | ✅ built | `crm_lead_activity`, 13 kinds, append-only |
| **Manager approval (discounts)** | ❌ | — |
| **Admin monitoring / performance** | ✅ built | `/lead-reports`, `/lead-overview`, the sales team panel |

**Roughly: the capture→assign→work→converse half is built. The
qualify→quote→visit→close half is not.** That is a fair description of where the
line falls, and it is also why the specification reads as mostly new: it is
mostly about the half we have not started.

---

## Is the research good?

**Yes, and specifically so.** Four things in it are better than what we have:

1. **Eligibility before ranking.** Our rota ranks everyone in Sales. A person on
   leave, at capacity, or without access to that project should never reach the
   comparison at all. Filtering first also makes the *reason* explainable: "three
   people were eligible, Sarah won on workload" is a sentence; "Sarah scored
   0.71" is not.

2. **Weighted workload.** Counting open leads is the weakest of our four signals
   and the owner is right about why: ten dormant leads outweigh three that are
   waiting on a reply this morning. The suggested weights (3 for a new lead or an
   unanswered client reply, 2 for due-today or an active qualified lead, 1 for a
   future follow-up, 0 for closed) are a sound first cut.

3. **Response-time caveats.** Four of the five are real gaps in ours: recent
   window, working-hours-only measurement, a minimum sample before the figure
   counts, and not letting one fast person collect everything. ⚠️ The fifth —
   "do not treat a new employee with no history as the fastest" — **we already
   got right**, `nulls last` in migration 133, and it was a deliberate decision at
   the time.

4. **Quotation versioning.** "Create QT-1042 Version 2 instead of silently
   changing the original" is the single most important line in §5. A price that
   changes under a client is a dispute, and the audit trail is the whole defence.

### Three things I would push back on

⚠️ **"Follow-up should be an activity status rather than the main sales stage"
contradicts our schema, and the owner is right — but it is not free.**
`follow_up` is one of our nine stages today, 5 leads sit in it, and the strip,
the rota's stage weights (133) and the reports all read that list. Removing it is
a migration with consequences, not a rename. **It should be decided deliberately,
early, and once** — the longer it stays, the more reads depend on it.

⚠️ **"Internet or session activity, if you track it safely" — I would leave this
out.** A tab left open is not availability, so the signal is weak; and staff
presence monitoring changes how people feel about the tool they are measured by.
The other five availability inputs (hours, check-in, leave, break status,
capacity) are stronger and carry none of that. If something like it is ever
wanted, "actively typing in a lead thread in the last N minutes" is defensible
where "browser is open" is not.

⚠️ **The 35/30/20/15 weighted score should stay on the shelf.** The owner already
says ordered rules are easier to debug for v1 — agreed, and there is a second
reason: a salesperson who believes the rota is unfair can be shown an ordered
rule and argue with it. A weighted score can only be asserted at them. Keep the
score as a later experiment, measured against the ordered rules, not as a
replacement for them.

### One tension to resolve before building

The spec wants `quotation_sent` **added** as a stage and `follow_up` **removed**
from the stages. Both are defensible; together they change the shape of the
funnel, the strip, the board's columns and every stage-weighted calculation. ⚠️
**Decide the final stage list once, in one migration, before Phase 4** — changing
it later means rewriting history in `crm_lead_activity`.

Proposed, for the owner to accept or change:

> new · contacted · qualified · **quotation_sent** · visited · negotiation ·
> won · lost
>
> with `follow_up` becoming an *activity state* — a lead in any stage can be
> awaiting a follow-up — and `scheduled` folding into the appointment record
> rather than being a stage of its own.

---

## Can it all be built? Yes. Honestly, though —

Every item is ordinary CRM work with no research risk left in it. What it is
**not** is small. Quotations with versioning and PDF, a property catalogue,
appointments with approvals, and a sequence engine with stop-conditions are four
separate modules, each of them days rather than hours, and each needing UI the
owner will want to review.

⚠️ **The one hard dependency worth knowing now:** the sequence engine cannot
send anything until WhatsApp message templates exist and are approved by Meta,
because every step past the 24-hour window is a template send. That approval is
outside our control and takes hours to days. **It should be started long before
Phase 6 needs it.**

---

## The phases

Ordered by dependency, not by appetite. The owner's own suggested order is
followed closely; where it differs, the reason is given.

### Phase 1 · The invariant, and who owns what
*Nothing else is trustworthy until this holds.*

- Decide the final stage list (see the tension above) and migrate to it once.
- `crm_lead_assignments` — who, when, why, by what rule. The "reason" the spec
  asks for, stored rather than rendered.
- Eligibility filter in front of the rota: active · has project access · not on
  leave · under capacity.
- Weighted workload replacing the raw open count.
- Response-time window: last 30 days, working hours only, minimum sample.
- **Exit test:** every open lead has an owner and a next action, and the desk can
  print why each owner has it.

### Phase 2 · Capture and duplicates
- Duplicate check at capture: phone, email, existing open lead on the project.
- An enquiry matching an open lead joins that lead's conversation and **stays
  with its current owner** — the owner's rule, already true for WhatsApp (142),
  not yet true at capture.
- Website form endpoint, CSV import.
- WhatsApp opt-in / opt-out column. ⚠️ Before any sequence can send.

### Phase 3 · The salesperson's day
- Contact outcomes completed: wrong number, not interested, interested later,
  appointment requested.
- ⚠️ **"Never finish an interaction without selecting the next action"** — this
  is the invariant made into a UI rule, and it is the cheapest place to enforce
  it.
- First-contact task and the response SLA clock, ⚠️ working-hours aware, or every
  overnight lead is breached before anyone reads it.
- After-hours policy: on-call, or a queue whose SLA starts at the next shift.

### Phase 4 · Qualification
- Structured qualification fields: requirement, size, location, budget, payment
  method, timeline, purpose, preferred contact time, site-visit interest,
  objections.
- Stage moves gated on them where it makes sense — a lead cannot reach
  `quotation_sent` with no property and no price.

### Phase 5 · Properties and quotations
- Property/item catalogue, per project. ⚠️ Real estate has plots; AI & Digital
  sells services. This needs a per-project switch or the module reads as wrong on
  half the projects.
- `crm_quotations`: number, version, lead, property, prices, payment plan,
  valid-until, terms, approval status, PDF.
- ⚠️ **Version, never silent edit.**
- Discount approval routed to the manager.

### Phase 6 · Sequences
- `crm_sequence_steps` and a scheduler.
- ⚠️ Stop-conditions checked **before every send**: client replied · quotation
  expired · lead closed · opted out · already booked.
- Needs approved WhatsApp templates (see the dependency above).

### Phase 7 · Appointments and closing
- Appointments: call, meeting, site visit; reminders; outcomes.
- Won: stop sequences, record the property, create the booking, preserve history.
- Lost: reason required — ⚠️ the enum already exists and already covers it.

### Phase 8 · Email
- Real email send/receive against a lead, so "Conversation" means both channels.
- Until then the desk says "Email not connected", which is the honest state.

---

## Where the demo project fits

Owner: *"Definitely we will just be working on that demo project only."*

Every phase above is built and proved on **Demo — Product Enquiries [demo]**,
which now carries the seven showcase leads from the reference design
(`scripts/seed-desk-showcase.mjs`). ⚠️ **Chitral's 632 real leads are not a test
bed** and nothing in these phases should write to them until the owner says the
phase is finished.

## Naming, for clarity in conversation

Renamed 2026-09-14 at the owner's request, so a sentence like "give this to
Sarah" is unambiguous:

| Was | Now |
|---|---|
| Sale Tester | **Sarah** |
| Sale 2 tester | **Sahad** |
| sale manager tester | unchanged, for now |
