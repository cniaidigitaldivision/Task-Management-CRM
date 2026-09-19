# 17 · The stage moves itself — a plan

> Owner, 2026-09-19: *"Manually changing each state is very hectic. It's not
> something it should be… These things will be done automatically by you, you can
> say, by observing the chat record."*
>
> And, in the same message: *"The next action should not be compulsory when I
> manually change something. If he wants to do something, then he can add on."*

**Planning only. Nothing in this file is built.**

---

## 1 · What is true today, measured

Exactly **one** automatic stage change exists in the entire database. Found by
asking Postgres rather than by reading:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'app'
   and pg_get_functiondef(p.oid) ~* 'update +public\.crm_leads[^;]*set[^;]*stage';
-- → crm_advance_sequences   (the Nurture park, 206 — and 208 proved it cannot fire)
```

Everything else is a human moving a dropdown. So the owner is not describing a
preference; they are describing the whole pipeline being hand-cranked.

**And it is already leaking.** On 19 Sep:

| Lead | Stage | What the record says |
|---|---|---|
| Umm e e Habiba | `new` | we wrote, she replied — **should be `contacted`** |
| habiba minhas | `new` | we wrote, she replied — **should be `contacted`** |
| Hina Shahzad | `proposal_pending` | she enquired 12 Sep, we answered 17 Sep, **she has not replied since** |

Two leads are behind where they should be. The third matters more — see §4.

---

## 2 · The one distinction this whole plan turns on

The owner said *"done automatically by you… by observing the chat record"*, which
sounds like one feature. It is two, and they carry completely different risk:

| | What decides it | Can it be wrong? |
|---|---|---|
| **Mechanical** | a row we already wrote — a message, a quotation, an appointment | Only if the code is wrong. It cannot hallucinate |
| **Judgement** | what the conversation *means* | Yes, quietly, and in a way nobody notices for weeks |

⚠️ **SIX OF THE OWNER'S SEVEN EXAMPLES ARE MECHANICAL.** Quotation sent, visit
scheduled, visit done, proposal sent, contacted, parked — every one is a fact
already recorded in a table. None of them needs a model, and putting a model in
front of them would make them slower, dearer, and occasionally wrong at random.

`docs/crm-ai/01-THE-AGENT-LADDER.md` already says this about Tier 0: *"routinely
mistaken for AI, and it is ~80% of the value."* This is that, again.

**Only `qualified` is judgement.** It is the one the owner described in the most
words, and the one to build last.

---

## 3 · The ladder

### Tier A · Mechanical, build first, no model

| → Stage | The signal, exactly | Where it lives |
|---|---|---|
| `contacted` | an inbound message that arrives **after** one of ours, **or** a logged `call_connected` | §4 |
| `proposal_pending` | a document of kind `proposal` sent to this lead | ⚠️ **no such kind exists** — see §7 |
| `quotation_sent` | a `crm_quotations` row reaching `status = 'sent'` | trigger on the table |
| `visit_scheduled` | a `site_visit` appointment exists, in the future, not cancelled | trigger on `crm_appointments` |
| `visited` | that appointment reaches `completed` | same trigger |
| `nurture` | every step sent, no reply — **already specified (206)** | must be made reachable first |

### Tier B · Judgement, needs a model, build last

| → Stage | What has to be true |
|---|---|
| `qualified` | the client has answered the qualifying questions — what they want, budget, timeline, who decides |

### Never automatic

`negotiation` · `won` · `lost`

The owner said `negotiation` is the salesperson's to set, and that is right for
all three. ⚠️ **And `won`/`lost` is not a preference, it is the foundation of the
report this CRM exists for:** the campaign-vs-staff answer is computed from
outcomes, so an inferred `lost` fills the nine lost reasons with fiction and makes
that question permanently unanswerable. Already written down in
`docs/crm-ai/05-GUARDRAILS.md` §3.

---

## 4 · `contacted` — the rule, and why the obvious version is wrong

The owner's definition, in their own words: the client enquires (**`new`**), we
answer, **they answer back** — now it is `contacted`.

The obvious implementation is `exists(inbound) and exists(outbound)`. **It is
wrong, and the live data proves it.** A Meta lead form arrives as an inbound
message, so almost every lead has one before we have said anything:

```
Hina Shahzad   first inbound 12 Sep 21:40   first outbound 17 Sep 14:10
               → she wrote first, we answered five days later,
                 and she has never written back.
```

The naive rule calls her `contacted`. By the owner's own definition she is not —
nobody has had a conversation with her. **The rule must be an inbound that is
*later* than one of ours:**

```sql
exists (
  select 1 from crm_lead_messages i
   where i.lead_id = l.id and i.direction = 'inbound'
     and i.occurred_at > (select min(o.occurred_at) from crm_lead_messages o
                           where o.lead_id = l.id and o.direction = 'outbound'))
```

⚠️ **A CONNECTED CALL COUNTS TOO.** `call_connected` in `crm_lead_activity` is a
salesperson saying *I spoke to this person*. A CRM that only believed WhatsApp
would leave every phone-worked lead sitting in `new`.

---

## 5 · The five laws every automatic move must obey

These are the difference between a feature the team trusts and one they turn off.

**1 · It only ever moves forward.**
`STAGE_ORDER` is a sequence. A signal may advance a lead; it may never move one
back. A client who replies to a lead already in `negotiation` has not become
`contacted` again.

**2 · It never closes, and never parks a lead that spoke.**
`won`, `lost`, `negotiation` are human. `nurture` only on silence.

**3 · A human's decision outranks a signal, and stays outranked.**
If a salesperson set the stage by hand, automation may still advance it — but
never contradict it. ⚠️ **The commonest way this feature dies** is a salesperson
setting a stage, watching software change it back, and never trusting the field
again.

**4 · Every automatic move says what moved it, in the timeline.**
`crm_leads_record_activity` already writes a row for every stage change with
`from`/`to`. The automatic ones must put the *evidence* in `detail` — "quotation
QT-2051 marked sent", "client replied 19 Sep 13:52" — so the Activity tab answers
*why is this lead in Quotation Sent* without anybody guessing.

**5 · It lives in the database, not in a screen.**
A trigger on `crm_quotations` fires whoever sent the quotation — the salesperson,
the scheduler, the agent later. The same rule written in a server action fires
only for the one button somebody remembered to wire.

---

## 6 · `qualified`, the only one that needs a model — and it still never writes a stage

The owner: *"When a salesperson asks a major question about your business, what
type of property you need, or what your requirements are… then it will be a
qualified lead."*

There is already a path for this. Migration 167 sets `qualified` when the
qualification answers are saved, and `docs/crm/07-AI-PLAN.md` Tier A already
plans an AI that reads a thread.

**So the design is: the model proposes the ANSWERS, a person confirms, and the
existing path sets the stage.**

```
thread → model → "Budget: 50–80 lakh · Purpose: investment · Timeline: 3 months"
              → shown in the Qualify panel, pre-filled, labelled as read from the chat
              → salesperson presses Confirm
              → 167 sets `qualified`
```

⚠️ **NO MODEL EVER WRITES A STAGE.** One click is the whole safety mechanism, and
it costs the salesperson a second instead of the minute they spend now. It also
produces the thing the CRM actually needs: **real qualification answers**, not
just a stage that claims they exist.

⚠️ **AND IT NEEDS A DECISION THAT HAS NOT BEEN ASKED YET.** Reading a thread means
sending a client's private circumstances to OpenAI — `05-GUARDRAILS.md` §9. For
Chitral that is a client's customer list. Must be settled before this is built.

---

## 7 · What is missing before Tier A can be built

| Gap | Why it blocks |
|---|---|
| **No `proposal` document kind** | `crm_document_kind` is letterhead, brochure, site_plan, price_list, legal, quotation, other, receipt, invoice. There is no proposal, so `proposal_pending` has no signal to fire on |
| **Nurture cannot fire** | Proved 19 Sep. Must be fixed first, or Tier A ships with one rule that silently does nothing |
| **No "set by a human" marker** | Law 3 needs to know whether the current stage was chosen by a person. `crm_lead_activity` knows (`actor_id`), but it is a scan; a column on the lead is the honest way |

---

## 8 · The next action must stop being compulsory

> *"The next action should not be compulsory when I manually change something…
> maybe I have set some other follow-ups. I don't need these follow-ups."*

The rule lives in `lib/domain/crm-outcomes.ts`:

```ts
const closing = input.stage === 'won' || input.stage === 'lost';
if (!closing && !input.nextAction?.trim()) {
  problems.push('Set the next action. An open lead with nothing planned is one that goes quiet.');
}
```

⚠️ **THE INTENT WAS RIGHT AND THE TEST IS WRONG.** The owner's original rule was
*"every open lead should leave the form with a next action"* — meaning **no open
lead goes quiet**. But the check asks *"did you type one just now?"* instead of
**"does this lead have anything planned?"** A lead with a three-step sequence
running is not going quiet, and demanding a fourth thing is the form arguing with
a plan the same person made an hour ago.

**What it should do instead:** the form is told what is already scheduled — a
pending follow-up, a live sequence, a booked appointment — and

- **something is planned** → show it (*"Second nudge · Sunday 10 AM — already
  scheduled"*) and the next action is **optional**;
- **nothing is planned** → ask, exactly as now. That is the case the rule was
  written for, and it is still right.

**And the same message's second complaint, which is a separate default:**
`pauseSequence` starts `true` in `record-outcome.tsx`. Recording any outcome
therefore offers to pause a running plan by default. That is correct for *client
replied* and wrong for a salesperson simply moving a stage. It should default
from the outcome, and say what it will do.

⚠️ **AND THIS IS WHAT MAKES THE AUTOMATION SAFE TO BUILD.** If the stage moves by
itself while the form still demands a next action every time, the owner gets more
interruptions, not fewer. **§8 ships before §3.**

---

## 9 · Build order

| | | Why here |
|---|---|---|
| 1 | The next action stops being compulsory (§8) | One file, today's irritation, and a precondition for the rest |
| 2 | Make Nurture reachable | It is specified, shipped, and dead |
| 3 | `quotation_sent`, `visit_scheduled`, `visited` | Triggers on tables that already exist. Nothing new to model |
| 4 | `contacted` (§4) | Highest volume — 677 leads sit in `new` — and needs the ordering rule right |
| 5 | `proposal` document kind, then `proposal_pending` | Needs a schema addition first |
| 6 | `qualified` from the chat (§6) | Last. Needs the data-sharing decision, and a person still confirms |

---

## 10 · What the owner still has to decide

1. **How long after the last unanswered follow-up does a lead park in Nurture?**
   Suggested 3 days. Blocks step 2.
2. **Is a proposal a document we send, or something else here?** Blocks step 5.
3. **May a model read a client's WhatsApp thread?** `05-GUARDRAILS.md` §9. Blocks
   step 6 and nothing before it.
4. **When a signal and a salesperson disagree, who wins?** This plan says the
   human, always, and the signal may only advance — never contradict.
