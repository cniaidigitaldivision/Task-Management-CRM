# State & tracker — the AI layer

**Read this first.** Same convention as `docs/crm/00-STATE-AND-TRACKER.md`: this
is the only file in this folder that changes every session, and it is maintained
**without being asked** (owner's standing order, 2026-09-16).

| | |
|---|---|
| **Status** | 📋 **PLANNED — with ONE piece built at the owner's request:** the conversation summary (migration 180, 2026-09-17). No agent, no auto-sending, nothing that talks to a client. |
| **Where this sits** | `docs/crm-ai/` — deliberately outside `docs/crm/`, and now listed in `docs/00-INDEX.md` |
| **Tier reached** | **Tier 0 not started** — that is Phase G of the CRM's own build order |
| **Blocked on** | The CRM working with humans first. See below |
| **Opened** | 2026-09-16, at the owner's request, as a folder deliberately separate from `docs/crm/` |
| **Last updated** | 2026-09-17 |

---

## 🧩 2026-09-17 — THE ONE PIECE BUILT: THE CONVERSATION SUMMARY · 180

The Summary view in the lead drawer's Conversations tab. Written by `gpt-4o` —
the provider Q18 already cleared — and stored in its own table.

| Concern in `06-CONVERSATION-MEMORY.md` | How it is met |
|---|---|
| *"Different every time"* | Stored, and rewritten only when the fingerprint moves — message count, newest message, note count. Temperature 0.2 |
| *"Expensive"* | Written when somebody opens the Summary view AND it is out of date. Never on page load, never for a drawer opened on Overview. The action re-checks the fingerprint in the database first, so a second reader pays nothing |
| *"Agent-written and salesperson-written must be distinguishable"* | Own table (`crm_lead_conversation_summaries`), never a row in `crm_lead_notes`; labelled **AI**; says what it was written from. The salesperson's notes sit under it, typed only by people |
| *Always English* | In the prompt, and checked live on a Roman Urdu thread |
| *Not evidence* | Not in `crm_lead_activity`; nothing counts it |

**The four headings are the owner's own** — *"I have told him this, I have heard
this, and we are in agreement on this"* — as **What we told them · What they told
us · Agreed · Still open**.

### ⚠️ What the live runs caught that no test would have

1. **JSON mode is not a schema.** Asked for `{"kind", "text"}`, gpt-4o returned
   `{"we_said": "…"}`. The strict parser dropped every point silently and the
   summary rendered as an overview with no headings — correct-looking and empty.
   The prompt now shows the exact shape and the parser reads both.
2. **"Scheduled" from a request.** The client wrote *"please contact me tomorrow
   morning"*; the overview said *"a follow-up call is scheduled"*. Nobody agreed to
   anything. The overview is now bound by the same both-sides rule as **Agreed**.
3. **Under-used headings.** A visit we proposed and they accepted came back as two
   separate points and no **Agreed**; a price we said we would check never reached
   **Still open**. Both now stated explicitly, and confirmed on a rerun.
4. **A failed send is not something we said.** Excluded from the brief — tested.

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
| 2026-09-17 | ✅ **A MODEL MAY READ THE CONVERSATION — TO SUMMARISE IT.** Owner: *"I will not add the summary. If I want to add it I can add it on, but the AI will also summarize my chat. I want there to be a summary of my chat that will be auto-summarized."* Closes open question 2 **for summaries only** — it does not authorise an agent replying. Built: see below. |
| 2026-09-16 | **Performance reading is designed but unbuilt**, under the five rules in `04`. Owner: *"I will discuss it with you later."* |

---

## Open questions, for the owner

1. ✅ **CLOSED 2026-09-17 — the agent does not negotiate.** See the decisions log.
   ⚠️ **One nuance remains:** may it offer a DISCOUNT at quotation stage? The
   owner settled the negotiation *stage* (agreements, payments, cheques,
   transfer) and did not name discounting. `05-GUARDRAILS.md` §2 currently says
   no, marked as my reading rather than theirs.
2. ✅ **CLOSED 2026-09-17, FOR SUMMARIES — a model may read the thread to
   summarise it.** The owner asked for it outright. ⚠️ **Still open for an agent
   that REPLIES** — reading to summarise and reading to answer the client are
   different permissions, and only the first has been given.
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
