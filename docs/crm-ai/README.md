# The CRM's AI layer — planned, not built

> Owner, 2026-09-16: *"I want to keep this part 8, automation and AI, in this
> staging properly documented in a separate folder that will not impact this
> current folder or these current parts. I want to implement it first with this
> one and then I want to put AI on everything or each step that will automate
> it."*

⚠️ **NOTHING IN THIS FOLDER IS IMPLEMENTED, AND NOTHING HERE CHANGES `docs/crm/`.**
That folder is the CRM being built now — a system a human operates. This folder
is what goes on top of it afterwards. Keeping them apart is deliberate: an
automation plan mixed into a build tracker is how half-finished ideas end up
being read as commitments.

| File | What it holds |
|---|---|
| `00-STATE-AND-TRACKER.md` | Live status of the AI work. Nothing started. The one file that changes each session once this begins. |
| `01-THE-AGENT-LADDER.md` | **The build order.** Three tiers, what each can do, and the rule for when a tier is allowed to start. |
| `02-KNOWLEDGE-AND-GROUNDING.md` | What the agent is allowed to know, where that knowledge lives, and why it may never answer from outside it. |
| `03-HANDOVER.md` | How work passes between the agent and the salesperson, in both directions, without either losing the thread. |
| `04-PERFORMANCE-AND-COACHING.md` | Reading how a salesperson actually replies — speed, tone, professionalism — and what may and may not be done with that reading. |
| `05-GUARDRAILS.md` | The things the agent must never do, each with the damage it would cause. Read before writing any agent code. |
| `06-CONVERSATION-MEMORY.md` | ⭐ **What the next conversation has to know** — the notes, the summaries, why a price was given, and the language rule: speak three, record one. |

---

## The vision, in the owner's words

> *"The lead came, my AI agent will see it and respond back. Then he collects
> these BANT gates… It can be conducted by AI. After getting the information he
> can give us a specific temperature… then send proposals, get quotations, send
> quotations, get agreement, set an appointment, give them a reminder. At that
> time physical human involvement is like a physical visit, which is a human
> act… If it was visited then a human came back, put a reminder, and put feedback
> on it: interested or not interested. On the basis of that it will move the
> stages again."*

And the constraint, which is the most important sentence in this folder:

> *"The AI will not answer or reply outside of that document."*

---

## The shape of it

The agent does not replace the salesperson. It does the part of the job that is
**typing the same thing to the ninetieth person**, and it hands over the moment
the work becomes judgement.

```
  LEAD ARRIVES
      │
      ▼
  🤖 first response, in seconds, day or night      ← the biggest single win
      │
      ▼
  🤖 BANT conversation — budget, authority,
      need, timeline, gathered as a chat
      │
      ▼
  🤖 proposes a temperature · salesperson confirms  ← never fully automatic
      │
      ▼
  🤖 quotation drafted from the catalogue
      👤 salesperson sends it                       ← a price is always human
      │
      ▼
  🤖 chases, pauses on reply, books the visit
      │
      ▼
  👤 THE VISIT — a human act, and the handover point
      │
      ▼
  👤 outcome recorded by the person who was there
      │
      ▼
  🤖 moves the stage from what was recorded
      👤 negotiation and booking — human throughout
```

⚠️ **The salesperson sees everything the agent does, as it happens, and can take
the conversation at any point.** An agent whose work only becomes visible when it
goes wrong is not an assistant, it is a liability.

---

## The rule that governs the whole folder

**Never automate a step a human has not done well fifty times.**

Automation makes a process faster, not better. A bad qualification script
automated is a bad qualification script delivered to six hundred strangers before
anybody notices. Every tier in `01-THE-AGENT-LADDER.md` names the human evidence
required before it may start, and those are not suggestions — they are the only
thing standing between this and an expensive, fast mistake.

⚠️ **And today the evidence is zero.** 641 real leads, **none ever contacted**.
There is no human baseline to automate yet. That is not an argument against any
of this; it is the reason the CRM is being built first.
