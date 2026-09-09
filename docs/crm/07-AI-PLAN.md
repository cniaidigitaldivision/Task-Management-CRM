# The AI plan

Owner, 2026-09-09: *"I want a full intelligent CRM, full intelligence in the form
of AI for everything… if I click to some lead, it will read everything about it.
It will tell me: this is what you have, this is what you can improve, this is the
way you can talk… The smart dashboard will tell me that this campaign is getting
these leads… and then tell me where my weaknesses are. If you say that you are
getting 6,000 leads and you are not closing even one lead, then maybe the problem
is with the staff person… maybe the problem is with your campaign."*

And: *"Give us honest AI solutions with a proper analysis, with proper learning…
as an analyst, as a sales marketer, as a salesperson. Honest."*

This file takes the "honest" seriously. It separates what AI can genuinely do
today from what it can only appear to do.

---

## The one principle everything here follows

**AI can only be as good as the record underneath it.**

The owner's own example is the proof: *"6,000 leads and you are not closing even
one — maybe the problem is the staff person, maybe the campaign."* To answer that,
the system must know:

- which leads each staff member was given, and when
- what they did about each one, and when
- what happened as a result

None of those three exist yet. Build the record first and the intelligence is
straightforward. Build the intelligence first and it invents things — which is
worse than nothing, because a confident wrong answer gets acted on.

⚠️ So every AI feature below names what it needs. Where the input does not exist
yet, that is stated rather than glossed.

---

## Tier A — Works from day one, needs no history

These only need the lead itself, which we already have.

### A1 · Lead summary in two lines
Reads the form answers, the notes and the activity, and writes what this person
wants. *"Wants a 5-marla plot in Islamabad, budget not discussed, asked twice
about instalments."*
**Needs:** the lead row. Available immediately.

### A2 · Talking points before a call
The owner's *"this is the way you can talk"*. Given the answers and the note
history, suggest three things to open with and one thing to avoid.
**Needs:** the lead row + notes. ⚠️ Must be labelled as a suggestion. A script
presented as fact makes a junior salesperson sound like a robot.

### A3 · Draft the follow-up message
WhatsApp or email, in the client's language, referencing what was actually
discussed. The person edits and sends — never auto-sent.
**Needs:** the lead row + notes.

### A4 · Data quality flags
"Phone number is not a valid Pakistani mobile." "This lead answered 'just
looking'." "Duplicate of a lead from three weeks ago."
**Needs:** nothing but the row. ⚠️ Rules, not a language model — cheaper, instant,
and it never hallucinates.

---

## Tier B — Needs a few weeks of real activity

### B1 · Lead scoring that means something
Rank leads by how likely they are to convert, learned from **actual outcomes**.

⚠️ **Do not ship this before there are outcomes.** A score computed with no won
or lost leads is a number with no information in it, dressed as certainty. People
trust numbers. The first version should be a transparent rule ("answered the
budget question + replied within a day = hot") that the team can argue with, and
only becomes learned once there are a few hundred closed leads.

**Needs:** ~200+ leads with a final stage.

### B2 · The staff-vs-campaign diagnosis — the owner's headline ask
Given 6,000 leads and no closes, which is it?

The answer is a comparison, not a model:
- **Same campaign, different staff** → if one person closes and another does not,
  it is the person.
- **Same staff, different campaigns** → if the same person closes on one campaign
  and not another, it is the campaign.
- **Nobody closes anything** → look at lead quality: are the phone numbers real,
  are people answering, what do the "lost" reasons say?

⚠️ This is arithmetic, and it should be shown as arithmetic — a table anybody can
check — with the AI writing the sentence over the top of it. A conclusion nobody
can reconstruct gets ignored the first time it disagrees with somebody's gut.

**Needs:** leads assigned to staff + outcomes + campaign attribution.

### B3 · Response-time analysis
Time from lead arriving to first contact, per person and per campaign. Response
time moves conversion more than almost anything else, and it is measurable from
day one of the activity log.
**Needs:** the activity log.

### B4 · Ageing and neglect alerts
"14 leads assigned to Ali have had no activity for 6 days." Sent to the bell.
**Needs:** the activity log. ⚠️ A rule, not a model.

---

## Tier C — Needs the integrations that are not built

### C1 · Call transcription and summarisation
Transcribe the call, write three lines, extract the objection and the next step,
attach to the timeline. This is the single biggest quality-of-record improvement
available — a salesperson who does not have to write notes writes better notes.
**Needs:** a call system with recordings. Deferred by the owner.

### C2 · Sentiment and coaching from real conversations
"This lead has gone cold — the last two replies were one word." Genuine, and
genuinely dependent on having the conversation text.
**Needs:** WhatsApp API or call transcripts.

### C3 · WhatsApp qualification agent
Answers the first message, asks two or three qualifying questions, scores, books
a call, hands to a human.
**Needs:** WhatsApp Business Platform + approved templates. ⚠️ And a hard rule
about when it hands over — an AI that will not let a person reach a human is a
brand problem, not a feature.

---

## What NOT to build, and why

Said plainly so it does not creep back in:

| Tempting | Why not |
|---|---|
| An AI number on the dashboard with no explanation | People trust numbers. An unexplainable one gets believed until it is wrong once, then nothing is believed again. |
| Auto-sending AI messages to leads | One bad generated message goes to a real client under the division's name. Draft-and-approve until there is a track record. |
| Scoring before outcomes exist | See B1. Confident noise. |
| "AI insights" that restate the table | If the sentence adds nothing the table did not say, it is decoration and it costs a call to the model every page load. |

---

## Cost and mechanics

- The owner has an OpenAI key. ⚠️ It goes in **Supabase Vault**, not the
  environment — the same path the Meta suite tokens took, so a key rotation is a
  script and not a redeploy.
- **Summaries are cached on the row and regenerated only when the lead changes.**
  Generating on every page load is the difference between a few dollars a month
  and a few hundred.
- ⚠️ **Personal data leaves our servers when we call the model.** A lead's name
  and phone number go to OpenAI. That is a decision the owner should make
  knowingly — the alternative is to send the answers and the notes with the
  identifiers stripped, which works for almost every feature above.

---

## The honest summary

The features that need nothing but the lead row — summary, talking points, draft
message, quality flags — can be built in Phase 2 and will feel like the product
is intelligent from the first week.

Everything the owner is *most* excited about — the staff-vs-campaign diagnosis,
scoring, coaching — needs the boring layer underneath: assignments, activity, and
outcomes, recorded consistently. That layer is Phase 1 and Phase 2.

**The fastest route to the intelligent CRM is to build the record properly first.**
Not the slowest. The intelligence is a few weeks of work once the data is real,
and impossible before.
