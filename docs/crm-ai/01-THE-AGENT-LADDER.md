# 01 · The agent ladder — three tiers, and what earns the next one

**Read `05-GUARDRAILS.md` before building any of this.**

The ladder exists because "put AI on it" is not one decision, it is about fifteen,
and they get progressively harder to take back. A tier is a group of capabilities
that share a risk level. **You do not start a tier because the previous one
works. You start it because the previous one has produced evidence.**

---

## Tier 0 · Rules, no model at all
*This is Phase G of `docs/crm/14-SALES-WORKSPACE-PHASES.md`, and it is not AI.*

⚠️ **LISTED HERE BECAUSE IT IS ROUTINELY MISTAKEN FOR AI, AND IT IS ~80% OF THE
VALUE.** A sequence that fires on a schedule, pauses when somebody replies and
stops when a quotation expires is arithmetic and a cron job. Calling it AI is how
people end up paying a model to do a `WHERE` clause — slower, dearer, and
occasionally wrong.

| Capability | Mechanism |
|---|---|
| Follow-up sequences, step 1..n | `crm_sequence_steps` + scheduler |
| Pause the moment the client replies | a stop-condition, checked before every send |
| Visit reminders | the appointment's own time, minus an offset |
| First-contact SLA and its breach alert | a clock and a notification |
| Quiet hours, chase frequency cap | rules in the scheduler |
| Stage suggestions from a recorded outcome | a lookup table |

**Entry condition:** none. Build it now.

**What it must produce before Tier 1 may start:** a few hundred real messages
sent and replied to, so there is a corpus of *what a good reply from this
business actually sounds like*.

---

## Tier 1 · The model drafts · a human sends
*The safe tier. Everything here is reversible, because a person is between the
model and the client.*

| Capability | Why it is safe |
|---|---|
| **Draft the follow-up** in the salesperson's own voice, Urdu / English / Roman Urdu | Sarah reads it before it goes. A bad draft costs five seconds, not a client |
| **Summarise a long thread** — forty messages into four lines | Read-only. The worst case is a summary somebody re-reads the thread to check |
| **Suggest the next action** and the due time | A suggestion in a field somebody confirms |
| **Suggest a temperature** from the BANT answers | ⚠️ Suggest. The salesperson sets it — see `05-GUARDRAILS.md` |
| **Flag a deal going cold** — tone shift, lengthening gaps, hedging language | An alert to a human, never an action |
| **Draft the quotation covering note** | The figures come from the catalogue, never the model |

⚠️ **THE SEND BUTTON IS THE WHOLE SAFETY MECHANISM.** Every capability in this
tier is defined by a person pressing it. The day a Tier 1 feature sends anything
by itself, it is a Tier 2 feature that skipped its entry condition.

**Entry condition:** Tier 0 running, and a real message history to learn the
voice from.

**What it must produce before Tier 2:** a measured **unedited-send rate**. If
salespeople are rewriting most drafts, the model does not yet know the business
and must not be allowed to send. A sensible bar is *most drafts going out
untouched, over several weeks, across more than one salesperson.*

---

## Tier 2 · The agent converses · inside a fence
*The owner's core ask. The first tier where a stranger reads words no colleague
approved.*

| Capability | The fence around it |
|---|---|
| **First response within seconds, day or night** | ⚠️ The single biggest win in the system. A greeting, an acknowledgement and one opening question — a *narrow* script, not an open conversation |
| **Conduct the BANT conversation** | Four things to find out. It may ask them, re-ask them, and record them. It may not discuss anything else |
| **Answer FAQs about a plot** | Only from the catalogue and the approved knowledge base. Anything outside it → handover, never a guess |
| **Book a visit from "Sunday works"** | Writes a real appointment, tells the salesperson, and never books outside the diary's rules |
| **Run the chases** and pause on reply | Tier 0's engine with Tier 1's wording |

⚠️ **PRICE IS NOT IN THIS TIER, AND THAT IS THE LINE THAT MATTERS MOST.** The
agent may state the **list price from the catalogue** as a fact. It may never
discount, never negotiate, never "see what I can do", and never imply
flexibility. The owner's own rule already says a discount needs a second person —
an agent that bargains defeats it silently. *"All the bargaining tricks"* is
exactly the capability to withhold until a human has been in every one of those
conversations first.

**Entry condition:** Tier 1's unedited-send rate met, the knowledge base written
and signed off (`02-KNOWLEDGE-AND-GROUNDING.md`), and every guardrail in `05`
implemented and tested.

⚠️ **AND IT STARTS ON THE DEMO PROJECT.** *"Chitral Royal Homes is my client. I
can't use their data for testing purposes."* — the owner's own standing rule.
A client's customers are not the test bed for a first conversational agent.

---

## Tier 3 · The agent decides
*Not planned. Written down so it is recognised if it arrives by accident.*

Moving a lead to `lost` by itself · changing a price · promising a date ·
committing the company to anything. **These are not deferred, they are refused.**

⚠️ The reason is not capability, it is accountability. When a client says *"your
system told me 4.2 million"*, somebody has to be able to say who decided that.
"The agent inferred it" is not an answer that survives a dispute — and in
property, disputes are the expensive kind.

---

## Where the human always stays

Regardless of tier:

| Always human | Why |
|---|---|
| **The site visit** | The owner's own point. It is a physical act |
| **The visit outcome** | Only the person who stood there knows how it went |
| **Any discount** | Already a two-person rule. An agent must not be one of them |
| **Negotiation** | Payment terms, documents, transfer — judgement and liability |
| **The booking** | Money changing hands and a unit coming off the market |
| **Marking a lead lost** | A closed lead is a decision with a reason. See `05` |

---

## What happens to Sarah

Worth stating, because it is the question the sales team will actually ask.

The agent removes the ninety identical opening messages and the chasing. It does
not remove the visit, the relationship, the negotiation or the close — the parts
that decide whether a deal happens. **The measurable effect should be that a
salesperson carries more leads at the same quality, not that fewer salespeople
carry the same number.** If the rota's weighted-workload figures do not rise per
person after Tier 2, the agent is not working and something else is wrong.
