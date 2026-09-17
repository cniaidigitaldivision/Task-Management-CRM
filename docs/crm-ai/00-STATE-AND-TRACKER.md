# State & tracker — the AI layer

**Read this first.** Same convention as `docs/crm/00-STATE-AND-TRACKER.md`: this
is the only file in this folder that changes every session, and it is maintained
**without being asked** (owner's standing order, 2026-09-16).

| | |
|---|---|
| **Status** | 📋 **PLANNED. Nothing built. No migration, no code, no model call.** |
| **Where this sits** | `docs/crm-ai/` — deliberately outside `docs/crm/`, and now listed in `docs/00-INDEX.md` |
| **Tier reached** | **Tier 0 not started** — that is Phase G of the CRM's own build order |
| **Blocked on** | The CRM working with humans first. See below |
| **Opened** | 2026-09-16, at the owner's request, as a folder deliberately separate from `docs/crm/` |
| **Last updated** | 2026-09-17 |

---

## Why nothing here can start yet — measured, not asserted

Read from the live database on 2026-09-16:

| | |
|---|---|
| Real leads | **641** |
| Ever contacted by a human | **0** |
| Leads with a recorded budget | **0** |
| `whatsapp_consent` never asked | **640** |
| Follow-ups, sequences, leads in a sequence | **0 · 0 · 0** |
| Average lead age | **58 days** |

⚠️ **There is no human baseline to automate.** The ladder's governing rule —
*never automate a step a human has not done well fifty times* — is not a
formality here; it is the literal state of the data. An agent trained or prompted
on this business today would be imitating nothing.

⚠️ **AND THE CONSENT FIGURE IS A LOADED GUN.** 640 leads where nobody has ever
asked permission to message them. The first automation that treats NULL as yes
messages the entire client database once, irreversibly. `05-GUARDRAILS.md` §5.

---

## The order, and where the gate is

```
  CRM, operated by humans          ← docs/crm/ — being built now
        │
        ▼
  Tier 0 · rules, no model         ← Phase G. NOT AI, and ~80% of the value
        │
        │   gate: a few hundred real messages, sent and replied to
        ▼
  Tier 1 · model drafts, human sends
        │
        │   gate: most drafts going out unedited, several weeks, >1 person
        ▼
  Tier 2 · agent converses, inside a fence
        │
        ▼
  Tier 3 · agent decides           ← REFUSED, not deferred
```

---

## Decisions already taken

| Date | Decision |
|---|---|
| 2026-09-16 | **This folder exists and is separate.** Owner: *"documented in a separate folder that will not impact this current folder or these current parts."* Nothing here alters `docs/crm/`. |
| 2026-09-16 | **Implement the CRM first, then layer AI on each step.** Owner's explicit order. |
| 2026-09-16 | **The agent answers only from approved knowledge.** Owner: *"The AI will not answer or reply outside of that document."* The single hardest constraint in the design, and the right one. |
| 2026-09-16 | **The physical visit stays human**, and so does the outcome recorded after it. Owner's own point. |
| 2026-09-17 | ✅ **NEGOTIATION IS THE SALESPERSON'S — SETTLED.** Owner: *"Major things can be asked by the AI agent but main negotiation — a paper agreement, the paper payment settlements, cheques received, payment transfer — and all these types of negotiation and terms and conditions should be handled by the salesperson itself."* The agent may ask and answer the published facts; it may not close. ⚠️ **The discount at quotation stage was not named explicitly** and is recorded in `05-GUARDRAILS.md` §2 as my reading, not the owner's words. |
| 2026-09-17 | ✅ **LANGUAGE — SETTLED. Speak three, record one.** Owner: *"The AI agent must be trained in English, Urdu, and Roman English… but any key point you want to note should always be in English."* Converse in whatever the client uses; every note, summary and key point in English. ⚠️ Templates are per language — three submissions per message, and whether Roman Urdu goes under an English or Urdu locale is unverified. |
| 2026-09-17 | ✅ **THE AGENT READS THE MEMORY BEFORE IT REPLIES.** Owner: *"Each time he starts a conversation with any client, he must first read those notes and respond accordingly."* Applies to the salesperson equally. See `06-CONVERSATION-MEMORY.md`. |
| 2026-09-17 | **A quotation records WHY it was that price**, written by whoever raised it. ⚠️ No column for this today — `approval_note` belongs to the approver. |
| 2026-09-16 | **Performance reading is designed but unbuilt**, under the five rules in `04`. Owner: *"I will discuss it with you later."* |

---

## Open questions, for the owner

1. ✅ **CLOSED 2026-09-17 — the agent does not negotiate.** See the decisions log.
   ⚠️ **One nuance remains:** may it offer a DISCOUNT at quotation stage? The
   owner settled the negotiation *stage* (agreements, payments, cheques,
   transfer) and did not name discounting. `05-GUARDRAILS.md` §2 currently says
   no, marked as my reading rather than theirs.
2. ⚠️ **Tier C consent — may a model read WhatsApp conversations?** Q18 permitted
   names and numbers. A thread carries far more, and Chitral's threads are a
   *client's* customer data. Must be asked separately.
3. ✅ **CLOSED 2026-09-17 — all three, mirroring the client; notes always in
   English.** See the decisions log and `06-CONVERSATION-MEMORY.md`. ⚠️ Still to
   verify against Meta: which template locale Roman Urdu is submitted under.
4. **Whose name is on the messages?** Recommended: the business, never a person.

---

## Next, when this folder becomes live work

1. Finish the CRM's Phase G — the scheduler, stop-conditions, quiet hours. **That
   is Tier 0 and it is not in this folder.**
2. Gather the message corpus that Tier 1 needs. It accumulates by itself once
   humans are using the system.
3. Write the knowledge base per `02` — approver, date, expiry on every entry.
   ⚠️ **This is the owner's work, not the code's, and it is the long pole.** It
   can start any time and should.
4. Settle the two open consent/negotiation questions above.
