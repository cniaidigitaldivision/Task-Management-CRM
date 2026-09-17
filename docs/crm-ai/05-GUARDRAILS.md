# 05 · Guardrails — what the agent must never do, and what it costs when it does

**Read this before writing any agent code.** Every line below is a rule with a
consequence attached, because a guardrail without a stated consequence is the
first thing dropped when a deadline arrives.

> Owner, 2026-09-16: *"One wrong answer with the dispute. That's why I'm saying
> that we will document each and everything. The AI will not answer or reply
> outside of that document."*

---

## 1 · ⚠️ It may never state a fact that is not in the knowledge base

Not "it should prefer". **May not.** If the answer is not in the catalogue, the
project record or the approved knowledge base, the only permitted response is to
say it will find out, and hand over.

**What it costs:** a plausible invented possession date, NOC status or plot
dimension is a representation made by the company to a buyer. In property that is
not an error, it is a misrepresentation, and the person who acts on it is
somebody's client. The owner's standing rule already forbids invented documents —
*"Legal document not uploaded"* rather than a generated NOC. **The same rule
applies to invented sentences.**

⚠️ **"I don't know" must be a rewarded answer, not a failure mode.** If handover
is measured as the agent underperforming, it will be tuned until it guesses.

---

## 2 · ⚠️ It may never close a negotiation — SETTLED BY THE OWNER, 2026-09-17

> *"Major things can be asked by the AI agent but main negotiation — a paper
> agreement, the paper payment settlements, cheques received, payment transfer —
> and all these types of negotiation and terms and conditions should be handled
> by the salesperson itself."*

**The line, as the owner drew it:**

| The agent may | The salesperson must |
|---|---|
| Ask and answer the *major things* — what a plot costs at list price, what the payment plan looks like, what a booking involves | **The agreement.** Any paper a client signs |
| Gather what the client wants, and record it | **The payment settlement** — schedule, instalments, what is due when |
| Explain terms that are already written down and approved | **Cheques received**, and anything acknowledging money |
| Hand over the moment the conversation turns to committing | **The transfer**, and every term and condition negotiated rather than published |

⚠️ **AND THE SAME LOGIC REACHES BACK TO THE DISCOUNT, which the owner did not
name explicitly.** It may state the list price from the catalogue as a fact. It
may not go below it, hint that it could, or say *"let me check with my manager"*
as a gambit. **This is my reading of the rule above rather than the owner's own
words — if a discount is meant to be within the agent's reach, it needs saying
separately, because the reasoning below is why I would argue against it.**

**What it costs:** the two-person discount rule — RLS refusing 42501, the CHECK
refusing 23514 — exists so no salesperson can price alone. An agent that bargains
is a third party with no rank, no accountability and no approval queue, quietly
defeating a rule enforced at two database layers. And in property, a price said
by software and remembered differently by a client is the dispute that has no
witness.

---

## 3 · ⚠️ It may never mark a lead lost

Only a human closes a lead, and only with a reason.

**What it costs:** the owner's headline question — *which campaign works, which
salesperson works* — is answered from outcomes. An agent that writes `lost` by
inference fills the nine lost reasons with fiction, and **the campaign-vs-staff
analysis this CRM exists for becomes permanently unanswerable.** A lead that goes
quiet becomes `revisit_later` and stays alive.

---

## 4 · ⚠️ It may never send outside the 24-hour window without a template

**Decided from `crm_lead_messages`, never from whether the API accepted the last
attempt.**

**What it costs:** measured live on 2026-09-15, Meta's test number accepted a
free-text message **26.3 hours** after the last inbound — the window was shut and
it went through anyway. A production number refuses it. **So an agent tested on
the test number will pass every test and fail silently in the field**, and the
failure lands as messages never delivered to real clients. This must be arithmetic
in the scheduler, never a `catch` block reacting to a refusal that will not arrive
during testing. See `docs/crm/14-SALES-WORKSPACE-PHASES.md` Phase G.

---

## 5 · ⚠️ It may never send to somebody who was never asked for consent

`whatsapp_consent` has three states: `true`, `false`, and **`NULL` — nobody
asked**. NULL is not permission.

**What it costs:** **640 of 641 real leads are NULL today.** An agent that treats
NULL as yes would message the entire client database on its first run. That is
one incident, not six hundred small ones.

---

## 6 · ⚠️ It may never present itself as a person

If asked whether it is a human, it says no, plainly, and offers the salesperson.

**What it costs:** a buyer who discovers mid-negotiation that the "Sarah" they
trusted was software does not become annoyed, they become suspicious of every
figure they were given. That is unrecoverable, and it contaminates the
salesperson who then has to take over.

---

## 7 · ⚠️ Everything it does is visible to the salesperson as it happens

Not a log read after a complaint. The same thread, the same drawer, live.

**What it costs:** the owner's design has the agent handing over to Sarah
mid-conversation. Sarah cannot take over a conversation she has not been able to
watch — she will repeat questions the client already answered, which is precisely
the irritation this system is meant to prevent.

---

## 8 · ⚠️ It must stop the moment a human takes over

A salesperson typing into a thread suspends the agent on that lead until they
release it.

**What it costs:** two parties answering the same client is worse than nobody
answering. And it is the failure that breaks a salesperson's trust in the tool
permanently — after one instance, they will work around it.

---

## 9 · ⚠️ A lead's data goes to the model; a lead's data is a client's asset

Q18 was answered: names and numbers may go to OpenAI. ⚠️ **That answer does not
extend to conversations.** Letting a model read a WhatsApp thread sends what
somebody can afford, their family situation and why they are moving.

**What it costs:** Chitral's leads are **a client's customer list** that we hold
as an agency. A decision to send it is theirs to be told about, not ours to
assume. This must be asked separately before Tier 2. See `docs/crm/07-AI-PLAN.md`
Tier C.

---

## 10 · ⚠️ It is proved as a salesperson, never as an admin

Every agent path runs under a real user's session in testing.

**What it costs:** the same membership-predicate bug has shipped **eight times**
in this codebase, every time invisible from an admin login. An agent acting with
the wrong effective identity either sees nothing and does nothing, or sees
everything and acts on another salesperson's leads.

---

## The test before any agent capability ships

1. What does it say when the answer is not in the knowledge base? *(must be
   handover, verifiably)*
2. What does it do when the 24-hour window is shut? *(must be template or
   nothing, decided from our own records)*
3. What does it do when `whatsapp_consent` is NULL? *(must be nothing)*
4. Can Sarah see it happening, and stop it, right now?
5. Was it tested as Sarah, not as an admin?
6. Was it tested on the demo project, not on Chitral's real clients?

⚠️ **Any "no" is a blocker, not a note for the backlog.** Each of these has a
specific, named thing it goes wrong with, listed above.
