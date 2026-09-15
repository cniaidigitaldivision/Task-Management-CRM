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

**Routes.** `/sales` becomes Sarah's home, with the rail the owner asked for:
My sales desk · My leads · My follow-ups · Conversations · Appointments ·
My quotations · **Attendance** (the owner spotted it missing) · My tasks ·
Calendar · My performance · Help.

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

> **How to check it.** Sign in as **Sarah** → `/sales`. You should see your own
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

### Phase C · Properties
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

### Phase D · Quotations
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

### Phase E · Appointments
*Depends on: B. Unlocks the whole **Today's plan** rail. Lifecycle Phase 7.*

Calls, meetings and site visits against a lead: when, where, who, outcome. The
rail is this table ordered by time, for today, for the signed-in salesperson.

> **How to check it.** Book a site visit for Ayesha Noor at 3:00 PM. It appears
> in Today's plan at 3:00 PM with her name and project. Book one for Sahad's lead
> — it must **not** appear on Sarah's rail.

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
