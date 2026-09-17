# 06 · What the next conversation has to know

> Owner, 2026-09-17: *"Each time he starts a conversation with any client, he
> must first read those notes and respond accordingly. That's the main mindset
> behind all this."* … *"Whether it's an AI agent or the salesperson wants to
> continue, each time he should know what we have discussed above."*

This is the requirement that makes the agent usable rather than embarrassing, and
it is worth more care than the model choice. **A conversation that starts by
asking what was already answered is the exact irritation this whole system exists
to avoid.**

---

## The two records, and why both are needed

| | What it is | Who reads it |
|---|---|---|
| **The thread** | Every message, verbatim, in whatever language it was said. `crm_lead_messages` — already built | A human reviewing a dispute |
| **The memory** | The short written record: what was agreed, what was quoted and **why**, what they objected to, what to do next | ⚠️ **Read before EVERY reply**, by the agent and the salesperson alike |

⚠️ **THE THREAD IS NOT THE MEMORY, AND SUBSTITUTING ONE FOR THE OTHER IS THE
COMMON MISTAKE.** Forty WhatsApp messages across three weeks is a record, not
something anybody reads before a call. And re-summarising the whole thread on
every reply is slow, expensive, and different every time — so the *same* history
would produce a different answer on Tuesday than on Monday. **The memory is
written once, when something happens, and then it is stable.**

---

## What goes in it

The owner named the contents precisely — *"the summary, the important points,
notes, quotations, and anything that he discussed that should be important for
further conversation"*:

1. **What was quoted, and why.** ⚠️ *"I gave this quotation because of their
   budget or this type of key point."* The reason matters more than the figure —
   the figure is already on the quotation row. The reason is what stops the next
   person, or the next version, contradicting it.
2. **What they objected to**, in their own words.
3. **What was agreed** — a visit, a callback, a deadline.
4. **What changed** about the lead: budget revised, decision-maker appeared,
   timeline moved.
5. **What to do next**, which already has a home in `next_action`.

⚠️ **NOT A RUNNING SUMMARY OF EVERYTHING.** A memory that grows without bound
stops being read, and then it is decoration. It holds what the *next*
conversation needs.

---

## ⚠️ The language rule — SETTLED BY THE OWNER, 2026-09-17

> *"The AI agent must be trained in or must have knowledge of English, Urdu, and
> Roman English… but any key point you want to note should always be in English."*

**Speak three. Record one.**

| | Language |
|---|---|
| **To the client** | English · Urdu · **Roman Urdu**, mirroring whatever they use |
| **The memory, notes, summaries, key points** | ⚠️ **Always English, whatever the conversation was in** |

**Why this is the right call, and it is not obvious:** the notes are read by the
manager, by the reports, by the next salesperson and by the model itself. A
record half in Urdu script and half in Roman Urdu cannot be searched, sorted or
compared — and *"budget kam hai"*, *"budget kum he"* and *"budget is low"* would
be three different facts to any query that tried.

⚠️ **AND ROMAN URDU IS THE ONE THAT WILL BE UNDERESTIMATED.** It is not a
transliteration with rules — spelling varies by person and by message, the same
writer is inconsistent within one sentence, and it is the register most of this
market actually types in. Any matching, keyword rule or sentiment reading built
on it will be less reliable than on the other two. **Recording in English is
what keeps that unreliability out of the record.**

⚠️ **TEMPLATES ARE PER LANGUAGE, AND THAT IS REAL WORK.** Every WhatsApp template
is submitted, reviewed and approved in one language. Three languages is three
submissions per message, three approvals to wait for, and three things to keep in
step when the wording changes. ⚠️ **Whether Roman Urdu is submitted under an
English locale or an Urdu one needs checking against Meta's own template
languages before the first submission** — it is not a standard locale and I have
not verified how their list handles it.

---

## When the memory is written

| Moment | What gets written |
|---|---|
| A quotation is raised | The price, the version, **and the reason for it** |
| An outcome is recorded | What happened, in the words the salesperson chose |
| A visit is written up | What was said at it |
| The agent hands over | ⚠️ What it could not answer — see `03-HANDOVER.md` |
| A conversation goes quiet and resumes | A short catch-up line, so the gap is explained |

⚠️ **WRITTEN AT THE MOMENT, NOT RECONSTRUCTED LATER.** A summary generated from
the thread a week afterwards is the model's reading of what happened; a note
written when it happened is what the person who was there believed. Only one of
those survives a disagreement with a client.

---

## What this needs that does not exist

Measured 2026-09-17:

| | State |
|---|---|
| `crm_lead_messages` — the thread | ✅ built, 17 messages |
| `crm_lead_notes` | ⚠️ **exists and is EMPTY — 0 rows.** And it is bare: `id, lead_id, author_id, body, created_at`. No kind, no language marker, nothing distinguishing a passing note from the memory |
| **"Why this price" on a quotation** | ❌ no column. `approval_note` belongs to the approver, not the preparer |
| **A summary the agent maintains** | ❌ nothing |
| **"Read the memory before replying"** | ❌ nothing, because there is no agent yet |

⚠️ **THE NOTES TABLE NEEDS A KIND BEFORE ANY OF THIS WORKS.** Everything above
would otherwise land in one undifferentiated `body` column, and *"read the notes
first"* would mean reading every passing remark anybody ever typed. A kind is one
enum and it has to exist before the first summary is written, not after.

---

## ⚠️ The rule that makes it trustworthy

**The memory is written by whoever did the thing, and marked with who that was.**

An agent-written note and a salesperson-written note must be
distinguishable at a glance. When a client disputes a price, *"the note says 40
lakh"* is only an answer if somebody can say whether a person or a model wrote
it — and `crm_lead_notes.author_id` cannot express "the agent" today.
