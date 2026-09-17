# 04 · Reading how a salesperson actually sells

> Owner, 2026-09-16: *"I want performance like how [a salesperson] personally
> replies to a client: whether they reply professionally, whether they are
> replying late, whether he is very active or not, how his response time is, and
> everything like that… These things will definitely be shared with the project
> manager and I will discuss it with you later."*

Noted as a requirement and **deliberately left unbuilt**, because this is the one
feature in the whole system that can damage the team it is meant to help. It is
worth getting the design right before any of it exists.

---

## The three things being asked for, and they are very different

| | What it is | Risk |
|---|---|---|
| **Speed** | Time from lead arriving to first reply; from client message to answer | Low — a clock, already partly measured |
| **Activity** | How many leads worked, messages sent, visits held, outcomes recorded | Low — counting |
| **Quality** | *Was the reply professional?* | ⚠️ **High.** A model judging a colleague |

The first two are arithmetic and should be built when the rest of the CRM is
running. The third needs the rules below or it should not be built at all.

---

## Speed — already half-built, and the honest caveats

`median_response_minutes` exists and the rota already reads it. Four refinements
the lifecycle spec identified, each of which prevents a specific unfairness:

1. **A recent window** — last 30 days. A fast month in June should not excuse a
   slow September.
2. **⚠️ A minimum sample before the figure is shown at all.** Two leads answered
   quickly is not a response time, and publishing it as one puts a new joiner top
   of a table on noise.
3. **Working-hours aware.** ⚠️ The owner's position is that the team answers from
   mobile at any hour, so the raw clock is fairer here than in most companies —
   but a lead arriving at 3am must not read as a five-hour breach at 8am.
4. **`nulls last`** — never treat "no history" as "fastest". Already correct in
   migration 133, and it was a deliberate decision then.

---

## Quality — the part that needs rules first

A model reading a salesperson's messages and rating them is **surveillance
wearing an analytics badge**, unless all of the following hold. These are not
negotiable-later niceties; each one prevents a specific, predictable failure.

### 1 · ⚠️ It describes; it does not score.

*"Three client questions went unanswered for over a day"* is a fact somebody can
act on. *"Communication quality: 6.2/10"* is a number that will be argued about
in a salary review and cannot be defended, because nobody can say what would have
made it 7.

### 2 · ⚠️ The salesperson sees their own reading first, and always.

Before any manager does. A person who learns they are being read by seeing it in
somebody else's report has been surveilled, whatever the intent was.

### 3 · ⚠️ It never ranks people against each other.

Speed can be compared — it is one measurement of one thing. "Professionalism"
compared across people is a model's register preference dressed as performance.
⚠️ **And it will systematically penalise whoever writes in Urdu or Roman Urdu**,
or whose English is plainer — while often being the better salesperson, because
they sound like the client.

### 4 · ⚠️ It is coaching input, never a pay input.

The owner mentions *"counted toward their pay… how many leads they closed"*.
**Closures are a fine pay input** — they are an outcome the salesperson controls.
**A model's opinion of their tone is not**, and the moment it touches pay, people
write for the model instead of for the client. The measured behaviour changes and
the actual selling gets worse.

### 5 · ⚠️ Nothing is read without the team being told, in advance, plainly.

Not in a settings page. Told.

---

## What is genuinely worth building, in order

1. **First-response time** against the SLA, per person, with the four caveats.
2. **Unanswered client questions** — a client message with no reply for N hours.
   ⚠️ **This is the highest-value item on the page**, it needs no judgement of
   quality at all, and it catches the thing that actually loses deals.
3. **Activity counts** — leads worked, visits held, outcomes recorded, quotations
   raised.
4. **Thread summaries on demand**, for a manager reviewing one deal. Read-only,
   per lead, not a standing profile of a person.
5. **Coaching observations**, descriptive, to the salesperson first. Last, and
   only under all five rules above.

---

## What not to build, and why

- ❌ **A leaderboard of communication quality.** It will be gamed within a month.
- ❌ **"Active or not" from login or session activity.** The lifecycle spec
  already rejected this: a tab left open is not availability, and presence
  monitoring changes how people feel about the tool that measures them. *"Replied
  to a client in the last N minutes"* is defensible; *"browser was open"* is not.
- ❌ **Any reading a salesperson cannot see.** If it cannot be shown to them, it
  should not be computed.
- ❌ **Sentiment scoring of the salesperson.** Of the *client's* messages —
  useful, it flags a deal going cold. Of the colleague's — a number nobody can
  defend.
