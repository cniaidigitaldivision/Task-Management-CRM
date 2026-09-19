# 07 · The greeting, agent mode, and the bell — is it possible?

> Owner, 2026-09-19: *"The most important thing over here is that I want a basic
> greeting message that should be automatically sent… I want an agent mode on/off
> radio button… By default it will be on… the salesperson should be notified at
> the top, bold, like a notification bell that rings… When I click on it, it
> should directly bring me to that chat… Is that possible?"*

**Short answer: yes, and most of it is already built. But one thing has to happen
at Meta before ANY of it can send a single message, and it is not code.**

**Planning only. Nothing here is built.**

---

## 1 · The fact that decides the whole design

Measured on the live database, 2026-09-19:

| Leads arrived by | Count | Ever sent us a WhatsApp message |
|---|---|---|
| **Meta lead ad** | **660** | **0** |
| facebook / instagram / google / website / other | 29 | 9 |

⚠️ **660 OF 689 LEADS HAVE NEVER SENT US A WHATSAPP MESSAGE.** A lead-ad form is
not a WhatsApp conversation — the person typed their number into Facebook. So for
**96% of new leads the 24-hour service window is shut at the moment they arrive**,
and WhatsApp refuses free text. See `05-GUARDRAILS.md` §4, and the standing note
that the test number lies about this while a production number does not.

**Therefore the greeting must be an approved template.** Not as a fallback — as
the normal case. Any design that assumes free text works on a new lead is a design
that will send nothing and report success.

---

## 2 · What is approved today, read from Meta

```
APPROVED  MARKETING  quotation_follow_up [en_GB]   0 variables
APPROVED  UTILITY    hello_world [en_US]           Meta's sample
APPROVED  …          jaspers_market_* ×4           Meta's samples
```

⚠️ **THERE IS NO GREETING TEMPLATE. NOTHING CAN BE GREETED TODAY**, whatever is
built. This is the first blocker and it belongs to the owner, not to code.

**What to submit** (Meta Business Manager → WhatsApp Manager → Message templates),
category **UTILITY**, which is the right category for a reply to an enquiry and is
approved faster and cheaper than MARKETING:

> Assalam-o-Alaikum {{1}}, thank you for your enquiry with {{2}}.
> I'm {{3}} and I'll help you with it. Could you tell me a little about what you
> are looking for?

Approval is usually minutes to hours.

⚠️ **AND A SECOND, SMALLER GAP IS OURS.** The sender deliberately sends templates
with **no parameters** — `followup-sender.ts` says so in place, because nothing
records the variable order. So greeting somebody *by name* needs that closed
first. Small, and it is a prerequisite for the template above.

---

## 3 · The greeting needs no new sending machinery at all

This is the good news, and it is worth stating plainly because it changes the
size of the job:

**A greeting is a one-step sequence with `delay_days = 0`, started when the lead
arrives.** Everything it needs already exists and has been proved live:

| Already built | Migration |
|---|---|
| The engine that queues a step | 170 / 206 / 207 |
| The 24-hour window, decided from our own records | 187 |
| The sender, with a claim guard so nothing goes twice | 204 |
| Writing the message into the lead's thread | 190 |
| Business hours and quiet hours | 187 |
| **Pausing the moment the client replies** | **208, today** |

What is genuinely new is **a trigger that starts it on lead creation**, and the
template. That is it.

⚠️ **AND THIS IS TIER 0 — THERE IS NO AI IN IT.** `01-THE-AGENT-LADDER.md` already
says the thing routinely mistaken for AI is ~80% of the value. A greeting sent in
seconds is exactly that: **response time is the single strongest lever on
conversion in this whole system, and it needs no model at all.**

---

## 4 · The rule that keeps the greeting from being an incident

⚠️ **IT FIRES ONLY FOR LEADS THAT ARRIVE FROM NOW ON. NEVER RETROACTIVELY.**

`whatsapp_consent` is **NULL for 688 of 689 leads** — nobody was asked.
`05-GUARDRAILS.md` §5 says NULL is not permission, and the reason is exactly this
feature: a greeting that backfilled would message the entire client database in
one run. That is one incident, not six hundred small ones.

New leads are different, and the difference is defensible: a person who filled in
a lead form handed us their number and asked to be contacted. **The owner should
confirm that reading**, and then it applies only forward.

---

## 5 · Agent mode — the radio button, and the state behind it

The owner wants **On / Off**, defaulting to On. `03-HANDOVER.md` argued for three
states. Both are right, and they reconcile cleanly:

| What the salesperson sees | What the record holds | How it got there |
|---|---|---|
| **On** | `agent` | default, or they switched it back on |
| **Off** | `human` | **they** turned it off |
| **Off**, with the lead flagged | `agent_paused` | **the agent** turned it off and asked for help |

⚠️ **THE HANDOVER *IS* THE TOGGLE FLIPPING ITSELF OFF.** That is exactly what the
owner described — the agent reaches a quotation, stops, and the salesperson is
told. One control, three truths, and no separate concept to learn.

⚠️ **AND TYPING TAKES OVER, WITHOUT TOUCHING THE TOGGLE.** The moment a
salesperson sends a message into a thread the agent is running, it goes to Off.
Nobody should have to remember to switch software off before answering a client;
one forgotten toggle means the client gets two replies, which is worse than
getting none.

**Turning it back on is deliberate**, as the owner said — never by timeout.

---

## 6 · The bell — mostly built already

`notifications` already has `kind`, `title`, `body`, `link_to`, `entity_id`, and
**one unread per lead** so six messages in a row are one line and not six.
`lead_replied` already deep-links straight into the conversation.

| Needed | Size |
|---|---|
| A new kind `agent_handover` | one enum value |
| Link to `/conversations?lead=…` — the page the owner actually uses now | one string; `lead_replied` still points at the old drawer route |
| **The title carries WHAT, not that something happened** | prompt + copy |
| A sound | see below |

⚠️ **"This lead needs your attention" IS THE VERSION THAT FAILS.** `03-HANDOVER.md`
§ already says it: a notification that makes Sarah open the thread and re-read it
to find out why costs more than it saves. It must say *"Umm e Habiba agreed to the
quotation"* or *"asked for a price the agent may not give"* — something she can
act on from the bell.

⚠️ **ABOUT THE RINGING.** Browsers refuse to play audio until the person has
interacted with the page, so a sound is reliable **while the tab is open and has
been clicked**, and not otherwise. For a salesperson who is not looking at the
screen, the honest answer is a **push notification or a WhatsApp/email nudge**,
not a sound the browser will silently drop. Worth deciding which.

---

## 7 · "Try to change the lead to convert" — the honest answer

The thing in this whole document most likely to convert a lead is **not** the
agent's cleverness. It is **answering in seconds instead of hours**, and that is
§3 — a template, a trigger, and machinery that already runs.

Everything past the greeting — conducting the qualification, answering questions
about the product, knowing when to stop — is `01-THE-AGENT-LADDER.md` Tier 2, and
it still needs the thing that has not been written: **a knowledge base saying what
Taskly is, what it costs, and what we will not promise.** No model can be honest
about a product nobody has described to it.

---

## 8 · Order, with who owns each step

| | Step | Owner |
|---|---|---|
| 1 | **Submit the greeting template** (§2) — nothing sends until this is approved | **The owner** |
| 2 | Let a step carry its template variables | Code |
| 3 | Greeting = one-step sequence, started on arrival, forward-only (§3, §4) | Code |
| 4 | `agent_mode` field + the On/Off control + typing takes over (§5) | Code |
| 5 | `agent_handover` notification → Conversations page, carrying the question (§6) | Code |
| 6 | The agent that actually converses | Blocked on the knowledge base |

**Steps 1–3 are worth doing on their own, and are not AI.** If nothing past step 3
were ever built, every new lead would still get an instant, named, on-brand reply
— which is the measurable part.

---

## 9 · What the owner has to decide

1. **Submit the greeting template?** Blocks everything. §2 has the wording.
2. **Is a lead-ad form submission consent for one reply?** §4. My reading is yes,
   forward-only, never backfilled.
3. **Sound, or a real push?** §6. A browser sound is unreliable by design.
4. **Which projects?** The standing rule is the demo project first — *"Chitral
   Royal Homes is my client. I can't use their data for testing purposes."*
   Chitral also has **no WhatsApp number connected**, so it could not send today
   in any case.

---

## 10 · Meta's own agent — researched 2026-09-19

> Owner: *"Meta has recently launched its AI agent for WhatsApp Business. Is this
> agent provided in the API?"*

**Yes.** It is **Meta Business Agent**, announced 3 June 2026, and it is
configured through its own **Meta Business Agent Platform API** — separate from
the Cloud API we send on. You give it a knowledge base, "skills" that set tone and
brand voice, and connections to your own APIs so it can take actions; it then
"acts as the primary responder" and hands control back to your app.

⚠️ **TWO DIFFERENT META ANNOUNCEMENTS ARE EASY TO CONFUSE, AND ONLY ONE IS THIS.**

| | What it is |
|---|---|
| **Meta Business Agent** (3 Jun 2026) | The customer-facing AI. Answers questions, books appointments, qualifies leads, reroutes to a person |
| **WhatsApp Business Tools MCP** (15 Sep 2026) | An MCP server for AI *coding* agents — creates a WABA, verifies a number, **writes message templates from a description** and reports their approval status |

The second is a developer convenience, not an agent that talks to clients — but it
is directly useful here: **the greeting template of §2 is exactly what it
generates.** Worth trying before filling in the form by hand.

### What is confirmed

- Requires **Cloud API**, not the WhatsApp Business app. ✅ we are on Cloud API
- Excluded verticals: Finance, Government, Health, Alcohol, Gambling, OTC drugs,
  matrimony. ✅ neither property nor software is excluded
- Paid through **WhatsApp Business Premium**; large businesses billed per token
- Can hand control back to the business's own app

### What is NOT confirmed, and must not be assumed

⚠️ **"Available globally" and "available to you" are different sentences.** Meta's
own help centre says it is *"currently only available in limited countries to
select businesses"*, with a waitlist. **Whether Pakistan is authorised is not
published**, and I could not confirm it.

⚠️ **Language.** Meta states not all languages are supported and that the agent's
language *is determined by the business's phone number*. Urdu and Roman Urdu — the
languages these clients actually write in — are unconfirmed.

⚠️ **The handover mechanics are undocumented publicly.** Whether our webhook still
sees an inbound message while the agent is answering decides whether the CRM's
thread, the 24-hour window arithmetic and `stop_on_reply` keep working at all.
That single question has to be answered before anything is switched on.

### ⚠️ And the finding that outranks all of it

Read from Meta on 2026-09-19 with our own token:

```
phone number : +1 555-660-8298   verified_name: "Test Number"
WABA         : "Test WhatsApp Business Account"   platform: CLOUD_API
```

**We are still on Meta's free sandbox number.** It reaches only a handful of
pre-registered recipients, it shows a US number to the client, and the agent's
language would be inferred from a `+1`. **No production agent — Meta's or ours —
runs on this.** A real registered business number is a prerequisite for
everything in this document, and it is a bigger blocker than the greeting
template.

### The recommendation

**Join the waitlist and evaluate it — but do not wait for it, and do not hand a
conversation to it blind.**

Meta's agent answers from knowledge held at Meta. It does not know
`crm_quotations`, the sequence engine, the stages, or the two-person discount
rule, and **our guardrails cannot be enforced inside somebody else's model.** The
owner's own asks — agent mode per lead, the handover bell landing on our
Conversations page, "this quotation needs your attention" — are CRM concerns
either way.

The greeting of §3 is unaffected by any of this, needs no model, and remains the
fastest measurable win.
