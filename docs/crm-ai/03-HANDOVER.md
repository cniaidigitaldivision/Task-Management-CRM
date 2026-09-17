# 03 · Handover — the agent and the salesperson, in both directions

> Owner: *"At a further stage when I say that now it's out of the AI agent or
> should involve some human, these leads will be handled by Sarah. Definitely all
> these things will be visible to Sarah or anyone else. On their behalf AI is
> doing it but on any part or any step they want to involve, they can involve."*

This is the part most agent products get wrong, and it is worth more care than
the model itself. **A conversation with two owners and no protocol is worse than
one with nobody.**

---

## The state a lead is in, at any moment

One field, three values. ⚠️ **Not a boolean** — "agent on / agent off" cannot
express the case that matters, which is a salesperson who has stepped in and
intends to step back out.

| State | Who answers | How it ends |
|---|---|---|
| **`agent`** | The agent, within its tier | It hands over, or a human takes over |
| **`human`** | The salesperson only. ⚠️ Agent fully silent | The salesperson explicitly releases it |
| **`agent_paused`** | Nobody automatic; the agent is waiting on an answer it cannot give | The salesperson answers, then releases |

---

## Agent → human: when it must hand over

Each of these is a hard trigger, not a judgement:

1. **No grounding for the answer.** See `02`. The commonest and most important.
2. **Anything about price beyond the list price** — discount, instalment
   flexibility, "best rate".
3. **A complaint, a legal question, or anger.** ⚠️ Detected loosely and handed
   over eagerly. A false positive costs a salesperson thirty seconds; a false
   negative is an agent being cheerful at somebody threatening to involve a
   lawyer.
4. **The client asks for a person.** Immediately, without persuasion.
5. **The stage reaches `visited`.** Everything past the visit is human by design.
6. **The same question asked three times.** The agent is not landing, and
   repetition is exactly the irritation this system exists to avoid.
7. **A booking, a date, or any commitment** is being asked for.

**What handover does:** sets state to `agent_paused`, notifies the owner of the
lead with *what it could not answer* — not merely "handover" — and tells the
client a person is coming, without apologising for the agent.

⚠️ **THE NOTIFICATION MUST CARRY THE QUESTION.** "Ayesha Noor needs you" makes
Sarah open and re-read. "Ayesha asked whether the possession date moved — not in
the knowledge base" is a reply she can send from the notification.

---

## Human → agent: taking over, and giving back

**Taking over is implicit and instant.** The moment a salesperson sends a message
into a thread the agent is running, the lead becomes `human`. ⚠️ **No confirmation
dialog, no toggle to remember.** A salesperson who has to switch a control off
before answering will one day forget, and the client gets two replies.

**Giving back is explicit.** A deliberate "the agent can continue" — because
handing a live client conversation to software should never happen by timeout or
by accident.

---

## What Sarah sees

- The agent's messages in the **same thread**, marked as the agent's, alongside
  hers. ⚠️ **Never a separate log.** The thread is the record.
- Live while it happens — the docked panel already polls every 5s.
- What each message was grounded on, on demand.
- A clear marker at the point of handover, so she can see where to pick up.

---

## What the client sees

- ⚠️ **One identity, and it is the business, not a fake person.** Messages come
  from Chitral Royal Homes. There is no "Sarah" who turns out to be software —
  see `05-GUARDRAILS.md` §6.
- No announcement at handover. *"I'm connecting you to a human"* invites the
  client to re-litigate everything already discussed. Sarah simply continues,
  with the context she can see.

---

## The measurements that say whether this is working

| | What it tells you |
|---|---|
| **Handover rate, and the reason** | A rising "no grounding" rate is a knowledge-base gap, not a model problem |
| **Time from handover to human reply** | The agent creates a promise; this is whether it is kept |
| **Takeovers within 2 minutes of an agent message** | ⚠️ The real quality signal. A salesperson rushing to correct the agent is the clearest possible sign it is not ready |
| **Client replies after an agent message vs after a human one** | Whether the agent's messages actually work |

⚠️ **The third one is the one to watch and the one nobody instruments.** It is
the only metric that catches an agent that is confidently wrong, because a
confidently wrong message never triggers a handover — it triggers a human
scrambling.
