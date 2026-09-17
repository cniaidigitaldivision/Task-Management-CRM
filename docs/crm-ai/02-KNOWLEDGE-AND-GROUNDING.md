# 02 · What the agent is allowed to know

> Owner: *"First of all it should know it has all the documents, all the
> knowledge… First give this, then after settlement or on the basis of the
> customer reply…"* and *"The AI will not answer or reply outside of that
> document."*

Those two sentences are one design. The agent is only as safe as the fence around
what it may say, and the fence is this: **every factual claim it makes must be
traceable to a row or a document somebody approved.**

---

## The three kinds of knowledge, and they are not equal

### 1 · Structured — the database. Authoritative, live, never summarised.

Prices, sizes, blocks, availability, payment plans, quotation figures,
appointment times. These come from `crm_properties`, `crm_payment_stages`,
`crm_quotations`, `crm_appointments`.

⚠️ **THESE ARE READ, NEVER REMEMBERED.** A price the model saw at training,
embedding or summarising time is a price that has since changed. Every figure in
every message is fetched at the moment of sending, from the row, through the same
RLS the salesperson reads it under. **A number in a prompt is a number that will
eventually be wrong.**

⚠️ **And the agent reads them as the salesperson**, not as a service account. An
agent with wider sight than the person it works for will eventually quote a
plot on a project that person has no access to.

### 2 · Documented — the approved knowledge base. The only source for prose.

Location and access, development status, what the society offers, transfer
process, payment terms in words, what a booking involves, the common objections
and the approved answers.

**Each entry needs:** who approved it, when, and when it expires. ⚠️ **An entry
with no expiry becomes a lie on a schedule** — "possession by December" was true
when written and is a complaint in January.

⚠️ **Per project.** Chitral's answers are not Executive Housing's, and AI &
Digital's are not either. One shared knowledge base is how a plot answer reaches
a software enquiry.

### 3 · Learned — how this business actually writes. Style only, never fact.

Drawn from real `crm_lead_messages` once there are enough. It teaches tone,
greeting, register, when to use Urdu — **not what is true.**

⚠️ **THIS IS THE ONE MOST LIKELY TO CAUSE THE FIRST INCIDENT.** A salesperson
once wrote *"possession in about a year"* in a thread. Learn from that message as
style and it is fine; let it leak into the factual layer and the agent has a
belief about possession that no document supports and nobody approved.

---

## What "will not answer outside the document" means in practice

Three things, and all three are needed:

1. **Retrieval before generation.** The answer is assembled from retrieved rows
   and entries. Nothing is answered from the model's own memory.
2. **A citation on every claim, internally.** Not shown to the client, but stored
   with the message. When a client says *"your system told me X"*, the thread
   shows which entry produced it. ⚠️ Without this, every dispute is unresolvable
   and the honest answer becomes "we don't know why it said that".
3. **A refusal path that is used.** No retrieval → no claim → handover. And the
   handover is phrased as service, not as failure: *"Let me get Sarah to confirm
   that for you exactly."*

---

## Where the knowledge base should live

⚠️ **In the database, under `crm_*`, not in a file in the repository.**
`16-EXTRACTING-THE-CRM.md`'s rules apply — the CRM must stay liftable — and a
knowledge base is CRM data. It also needs to be editable by the owner without a
deploy, versioned, and per-project. A markdown file in `docs/` is none of those.

**Sketch only — not a schema, and not to be migrated until Tier 2 is entered:**
an entry belongs to a project, has a question-shaped title and a body, an
approver, an approved date, an optional expiry, and a status. A retired entry is
kept, never deleted — *"what were we telling people in September"* is the same
question the frozen lead reports exist to answer.

---

## Before the agent may use any of it

- [ ] Every entry has a named approver and a date.
- [ ] Every entry that states a date, a timeline or a legal status has an expiry.
- [ ] The catalogue is read live; **no price exists in any prompt template**.
- [ ] Retrieval failure produces handover, and that path is tested.
- [ ] Each message stores what it was grounded on.
- [ ] Knowledge is per project, and cross-project retrieval is impossible.
