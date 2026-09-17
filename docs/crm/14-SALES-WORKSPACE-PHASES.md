# 14 · The Sales Workspace — build order, with a check for every phase

**The page being built:** Sarah's **My sales desk**, from the owner's reference
design of 2026-09-14, plus the nine screens in its left rail.

**How to read this file.** `12-LIFECYCLE-SPEC.md` describes the *system* — what a
lead is and how it moves. This file is the *build order for one workspace*, and
every phase here says which lifecycle phase it draws on. Each one ends with
**"how to check it"**, written so the owner can verify it without asking.

---

## ⚠️ Why the page cannot be built in one pass

The reference is a finished screen. Read it closely and it is showing data from
four features that do not exist yet:

| What the design shows | What has to exist first |
|---|---|
| `5 Marla Plot · Block A` under the lead's name | **Properties** |
| `PKR 4,500,000 · Valid till 30 Sep 2026` in Latest update | **Quotations** |
| The whole **Today's plan** rail — 10:30, 11:00, 3:00 | **Appointments** |
| **Site visits booked · 4 of 6** | **Goals**, and appointments to count |
| The `Visit scheduled` stage badge | the stage-list decision |
| `Sequence paused` and the green replied banner | the **sequence engine** |

So the honest order is: **build the page in layers, and let each layer light up
part of the design.** Phase A alone delivers most of what is on screen, because
most of the left-hand side is data we already hold.

⚠️ **Nothing is drawn against invented data.** A card that shows "4 of 6" before
goals exist is a number somebody will act on. Where a phase has not landed, the
section is absent — not faked, not zeroed.

---

## The phases

### Phase A · The workspace, and everything that already works
*Depends on: nothing. This is the one to start.*

**Routes.** ⚠️ **SUPERSEDED 2026-09-16 — there is no `/sales` route and none is
to be created.** The owner settled it: *"The sales or my leads page is the same
page. You can consider it as the same… but the sales desk for Sara will be a
different page."*

| Rail entry | Route | State |
|---|---|---|
| **My leads** | **`/my-leads`** | ✅ built — the list, the drawer, stage edits, outcomes, Add Lead. **This IS "/sales".** |
| **My sales desk** | — | ⬜ a *separate* page: greeting, the four cards, Today's plan, the approval queue, the Phase F goal card |
| **Appointments** | `/appointments` | ✅ built 2026-09-16 — the whole diary, with *Needs recording* leading |
| My follow-ups · Conversations · My quotations · My performance | — | ⬜ Phase H |
| **Attendance** · My tasks · Calendar · Help | existing routes | ✅ already in the product |

⚠️ **One screen, one URL.** An alias like `/sales/leads` pointing at the same
list is two places for a bug to hide and two things to keep in step.

The rail the owner asked for, in order: My sales desk · My leads · My follow-ups ·
Conversations · Appointments · My quotations · **Attendance** (the owner spotted
it missing) · My tasks · Calendar · My performance · Help.

⚠️ **A rail entry only appears when its screen does something.** Six of those are
later phases; until then they are not in the rail. A nav that leads to "coming
soon" teaches people to stop clicking the nav.

**The page itself, built from data we already hold:**

- Header, the greeting by name, the date in Asia/Karachi, `Assigned to you`.
- The four cards — **My assigned leads · Due today · Overdue · Unread replies**.
  All four already exist: `crmDueCounts` narrows by RLS to the caller, and
  "unread replies" is `waitingForReply`, the leads whose last WhatsApp message
  came from them.
- The tabs — **Needs attention · Today · Upcoming · Waiting for reply**.
- Project picker, search, Filters.
- The table: Lead / project · Stage · Latest update · Next follow-up ·
  Quick actions, with the row shape and colours already settled on the lead desk.
- The footer band with the division's contact details.

**Deliberately absent in A:** the property line, the quotation line, Today's
plan, My goal.

> **How to check it.** Sign in as **Sarah** → **`/my-leads`** (⚠️ not `/sales`,
> which does not exist — see the route table above). You should see your own
> leads only — not Sahad's, not all 653. The four figures must match the tabs:
> press **Overdue** and the list should show exactly that many rows. Sign in as
> **Sahad** and the same page should show a different set.
>
> From a terminal, the same numbers without the UI:
> `node scripts/check-sales-desk.mjs` *(written in this phase)*.

---

### Phase B · The stage list, settled once
*Depends on: A. ⚠️ Blocks C, D and E.*

The design shows **Visit scheduled** and **Quotation sent**; the lifecycle spec
wants `follow_up` demoted to an activity state. These are one decision, and
⚠️ **it must be made before any history accumulates against the new stages** —
afterwards it means rewriting `crm_lead_activity`.

Proposed final list, for the owner to accept or change:

> new · contacted · qualified · **quotation_sent** · **visit_scheduled** ·
> visited · negotiation · won · lost

with `follow_up` becoming an activity state (any stage can be awaiting one) and
`scheduled` folding into the appointment record.

> **How to check it.** The stage strip on both desks shows the new list, the
> board grows the new columns, and every existing lead still sits in a valid
> stage — the migration's self-check proves the second part before it commits.

---

### Phase C · Properties — ✅ DONE 2026-09-16
*Depends on: B. Unlocks `5 Marla Plot · Block A`. Lifecycle Phase 5.*

`crm_properties` per project, seeded from `13-PROPERTY-AND-QUOTATION-TESTPACK.md`
— PROP-A101 and PROP-B201 exactly as specified. A lead gains an *interest*: which
property they are asking about.

⚠️ **`marla_sqft_standard` lives on the PROJECT, not in code.** The owner's own
note says a Marla varies by region; a constant would be wrong the first time a
second project used a different one.

⚠️ **Per-project switch.** Chitral sells plots; AI & Digital sells services. The
property fields must not appear on a project that has no catalogue.

> **How to check it.** Faisal Rehman's row reads `5 Marla Plot · Block A` under
> the project. Open the lead and the property is named with its size, block and
> price. A demo lead on a service project shows no property line at all.

---

### Phase D · Quotations — ✅ DONE 2026-09-16
*Depends on: C. Unlocks `PKR 4,500,000 · Valid till 30 Sep 2026`. Lifecycle Phase 5.*

`crm_quotations` with **number and version as separate columns**, the payment
plan stored as rows, the approval flow, and a PDF.

⚠️ **Version, never silent edit** — QT-1042 v2 is a new row. A price that changes
under a client is a dispute and the version history is the whole defence.

⚠️ **Approval recomputes the plan**, because the plan is derived from the net
price. The test pack's own numbers prove it: 8,200,000 → 8,000,000 gives
1,600,000 / 800,000 / 200,000 × 20.

⚠️ **`pending_approval` is refused in the server action**, not by hiding a
button.

> **How to check it.** Faisal's row shows the amount and validity. Hina's QT-1043
> sits amber, cannot be sent, and notifies the manager. Approve it as the manager
> → the total becomes 8,000,000, the schedule regenerates, a **version 2** row
> appears, and the activity log records who approved it. ⚠️ Try to send it while
> pending — it must refuse.

---

**C built:** the catalogue in the drawer's Related tab — every unit with its
payment plan, and attaching one to a lead.

⚠️ **A salesperson reads it and cannot change it** (150's policy). There is no
price field in the picker at all; a price is the company's, not the seller's.
⚠️ **Sold units are listed and marked, not hidden** — somebody asked "what about
B-201?" has to be able to say *that one is gone*, or the catalogue disagrees
with the board on the wall.
⚠️ **And 166 had to grant `property_id` and `budget`** — 150 added both columns
and never added them to 116's UPDATE grant, so they had been unwritable by the
application ever since. `app.crm_create_lead` got away with it by being SECURITY
DEFINER, exactly as the outcome columns did (162).

**D built:** raising one from the drawer, the net recomputed as it is typed, a
manager's approval queue on the desk, approve / approve-less / reject.

⚠️ **A discount needs somebody else; list price does not.** The owner's rule is
about the discount, not the document — a manager in the way of every full-price
quotation is how people end up sending prices from WhatsApp.
⚠️ **The approved figure may differ from the asked-for one**, and the net is
recomputed from what was AUTHORISED so the document never prints a price nobody
agreed to.
⚠️ **Self-approval is refused at TWO layers** — RLS (42501) stops a salesperson
setting `approved` at all, and the CHECK (23514) would stop it even if the policy
let it through. `scripts/check-quotations.mjs` asserts the row's final state
rather than an error code, because a test coupled to one layer fails the day the
other does the work.

**Still missing in D:** no PDF (`pdf_path` exists and is unused), and no v2
versioning (`supersedes_id` likewise).

---

### Phase E · Appointments — ✅ DONE 2026-09-15
*Depends on: B. Unlocks the whole **Today's plan** rail. Lifecycle Phase 7.*

Calls, meetings and site visits against a lead: when, where, who, outcome. The
rail is this table ordered by time, for today, for the signed-in salesperson.

> **How to check it.** Book a site visit for Ayesha Noor at 3:00 PM. It appears
> in Today's plan at 3:00 PM with her name and project. Book one for Sahad's lead
> — it must **not** appear on Sarah's rail.

---

**Built:** booking (from the "site visit requested" outcome), **Today's plan** on
`/my-leads`, the lead's own appointments in the drawer's Follow-ups tab, and
recording what happened — completed · no-show · cancelled.

⚠️ **Booking has worked since the outcome form learned to write one; the missing
half was that nothing SHOWED them.** A visit booked from the outcome form
vanished the moment it was made — `crmLeadRelated` had been reading appointments
since 152 and no screen rendered the result.

⚠️ **Today's plan renders nothing when the diary is empty**, rather than showing
"no appointments". A permanent empty panel above the list is dead space on the
screen a salesperson opens between two calls, and it teaches the eye to skip
exactly the strip that matters on the day something IS booked.

⚠️ **And it reads from the START OF THE DAY in Karachi, not from `now()`.** A
visit at 9am is still today's business at 10am — somebody has to record what
happened at it. A rail that dropped each entry the moment it began would empty
itself over the course of the morning, which is when it is most looked at.

**Checked:** the diary lists a past appointment until it is recorded; recording
succeeds as the owner; one remains scheduled afterwards; and a colleague sees
none of it.

**Still missing:** rescheduling — the `replaces_id` column is there and unused,
and cancel-then-rebook is the workaround.

⚠️ **THE STANDALONE SCREEN LANDED 2026-09-16** and it was not the duplicate it
looked like. Today's plan is a *rail*: seven days forward, cancellations hidden,
absent entirely when empty. `/appointments` is a *record*, and it answers the one
question nothing else could — **which visit have I still not written up?** An
appointment nobody recorded is the commonest way a lead goes quiet, and there was
no screen anywhere that could list them.

⚠️ **It also closed a hole nobody had noticed: a booked visit could not be
cancelled.** `crmCloseAppointment` has accepted `cancelled` since 152 and no
screen ever sent it, because Today's plan only offers its buttons on a visit that
has already happened. A client ringing to call off tomorrow left the diary
uncorrectable.

---

### Phase F · Goals
*Depends on: E, to have something to count. Unlocks **Site visits booked 4 of 6**.*

A monthly target per salesperson, set by the manager. The card counts real
appointments against it.

⚠️ **The figure comes from the appointments table, never from a stored counter.**
A counter and a table disagree eventually, and the day they do the salesperson is
arguing about their own number.

> **How to check it.** Manager sets Sarah a target of 6 site visits. Book four →
> the card reads 4 of 6 and the bar shows 67%. Book a fifth → it moves without a
> page reload of anything else.

---

### Phase G · Follow-up sequences
*Depends on: D. Unlocks `Sequence paused` and the green banner. Lifecycle Phase 6.*

`crm_sequence_steps` and a scheduler on top of migration 147's state.

⚠️ **CORRECTION, 2026-09-15. This phase was recorded as blocked on Meta
approving templates. That was wrong, and the owner caught it:** *"I can't test
all these templates on a tester receptor. Why can't I do that? Please give me an
exact answer."*

The exact answer, checked against Meta's documentation and against the live
account on 2026-09-15:

| Claim that was made | What is actually true |
|---|---|
| Approval is not ours to schedule | **We create templates ourselves** — WhatsApp Manager or the Message Templates API, up to 100/hour per account |
| We are waiting on Meta | Review is **automatic, up to 24 hours**, usually minutes |
| A test number cannot send templates | Test accounts are **made for this** — relaxed limits, no payment method needed |
| Nothing is approved yet | **Five templates were already APPROVED on the live account**, including `hello_world` |

⚠️ **The real blocker was ours and it was one missing function.**
`lib/crm/whatsapp.ts` could send free text and media and had **no way to send a
template at all**. `sendTemplate` and `listTemplates` were added on 2026-09-15.

⚠️ **AND A SEQUENCE CANNOT BE TESTED ON FREE TEXT ALONE.** Step one usually
lands inside the 24-hour window, where `sendText` works. Step two is three days
later, where the API **refuses** it. An engine built and tested on text only
would pass every test and fail silently on the second step in the field.

⚠️ **The templates on the account are Meta's samples** (`jaspers_market_*`).
Real ones — a visit reminder, a quotation follow-up — still have to be written
and submitted. That is an afternoon and a wait of minutes, not a dependency.

#### ⚠️⚠️ THE TEST NUMBER DOES NOT ENFORCE THE 24-HOUR WINDOW. MEASURED.

Proven live on 2026-09-15 against `+923121531511` (Mohsin Testing), whose last
inbound message was **26.3 hours** earlier — the window was closed, and the
database's record is the whole record:

| Sent at 26.3h after the last inbound | Meta's answer |
|---|---|
| `type: text` (free-form) | **ACCEPTED** — `wamid.HBgMOTIzMTIxNTMxNTExFQIAERgSNTMzRTdFQTNBMDE1QjIyODA4AA==` |
| `type: template` (`hello_world`) | **ACCEPTED** — `wamid.HBgMOTIzMTIxNTMxNTExFQIAERgSNDBCMDNGMkUwRUZFRjQ3MTM3AA==` |

Meta's documentation says the customer service window applies in test scenarios.
On this test number, at 26.3 hours, it did not. Test numbers ship with *"relaxed
messaging limits"* and this is evidently one of them.

**What this means for Phase G, and it is the opposite of reassuring:**

⚠️ **A sequence engine tested only on this number will pass every test and then
fail in the field.** The test environment accepts the exact call that a
production business number refuses. Nothing in testing will catch it.

So the rule cannot be discovered by trial — it has to be **built in by
construction**:

> **Any step that fires more than 24 hours after the customer's last inbound
> message MUST use a template. Decided from `crm_lead_messages`, never from
> whether the API happened to accept the last attempt.**

The 24-hour arithmetic belongs in the scheduler, as a stop-condition alongside
the five already listed — not in a `catch` block reacting to a refusal that will
never arrive during testing.

⚠️ And `sendText` succeeding is therefore **not evidence the window is open.**
Any code that infers the window state from a successful send is wrong, and would
be wrong in the direction that reaches real customers.

⚠️ **Stop-conditions checked before every send**: client replied · quotation
expired · lead closed · opted out · already booked.

> **How to check it.** Start the three-step quotation sequence on Faisal. Reply
> from your own phone as the client → the sequence pauses within a minute, the
> green banner appears on Sarah's desk, and no further step sends.

---

### Phase H · The remaining rail screens
*Depends on: the phase each one shows.*

My leads · My follow-ups · Conversations · Appointments · My quotations ·
My performance. Each is a filtered view of something already built — none of them
is new machinery, which is why they come last rather than first.

**Appointments — ✅ DONE 2026-09-16, `/appointments`.** No migration; 152 already
had the table and its policies. Three tabs, all client state: **Needs recording**
(past and still open) · **Upcoming** · **Done**. 60 days back, 300 rows, and the
screen says so rather than implying it holds everything.

⚠️ **It is not Today's plan twice.** That is a rail — seven days forward,
cancellations hidden, absent when empty. This is a record, and *"which visit have
I still not written up?"* is a question nothing else in the product could answer.

⚠️ **The `join public.projects` bug was written here again and caught before it
shipped** — see the tracker's 2026-09-16 entry. Eighth occurrence.

⚠️ **`--text-tertiary` measured 3.94:1 in light** and is not AA-safe as ink;
four uses were raised. `PageHeader`'s eyebrow fails the same way at 3.41:1 **on
every page in the product** and was left alone deliberately — a shared component
is not something to change inside one screen's build. Worth raising.

> **How to check it.** As **Sarah**, open a lead → Record Outcome → *site visit
> requested*, with a time in the last hour. `/appointments` opens on **Needs
> recording** with it there. Press **It happened**, type what was said → it moves
> to **Done** with the note under it. Book one for next week → it is under
> **Upcoming** with **Call it off** and no write-up buttons, and calling it off
> asks why first. Sign in as **Sahad** — none of it appears.
>
> From a terminal, under each real person's session rather than an admin's:
> `node scripts/check-appointments-screen.mjs`

---

## Dependency, in one picture

```
A  workspace shell + what already works
│
├── B  stage list  ──┬── C  properties ── D  quotations ──┐
│                    │                                    │
│                    └── E  appointments ── F  goals      │
│                                                         │
│                                          G  sequences ←─┘
│                                          (also needs Meta templates)
└── H  the remaining rail screens — each follows its own phase
```

**A is the only one with no prerequisite. B blocks three others, so it is the
decision to make early.** G's real blocker is outside the building.

---

## What "done" means, every time

A phase is finished when all four hold:

1. The screen shows it, with **real data**, for **Sarah and Sahad differently**.
2. `tsc`, `eslint`, the full test suite and `next build` are clean.
3. Any migration carries a **self-check that proves the behaviour**, run under
   real user sessions — not a schema assertion.
4. ⚠️ It is verified as a **salesperson**, never only as an Admin. Six bugs in
   this codebase reached the owner because an Admin session cannot reach the
   broken path; see `admin-sessions-cannot-test-access` and migrations 105, 121,
   125, 129, 130, 140.

## Scope, standing

Everything is built and demonstrated on **Demo — Product Enquiries [demo]**.
⚠️ **Chitral's 632 real leads are not a test bed.**
