# Open questions

Only the owner can answer these. Each one says what changes depending on the
answer, so none of them is a preference — they all move code.

**Q1–Q5 block Phase 1.** The rest can be answered as we go.

Answers get written into `00-STATE-AND-TRACKER.md` as they arrive, with the date.

---

## Blocking

### Q1 · AI & Digital has no ads. Where do we actually start?

Verified: AI & Digital Division's system user reaches **0 ad accounts and 0 lead
forms**. Chitral Royal Homes has **615 leads**. CNI has 3 forms and no leads yet.

- **(a)** Start with Chitral — real data, immediately, and the 90-day clock is
  ticking on it.
- **(b)** Assign AI & Digital's ad account to its system user first, then start
  there. Costs days, and the leads only start from the day it is connected.
- **(c)** Both.

*Changes:* which account the importer is pointed at first, and whether there is
anything to look at in week one.

**Recommendation: (a).** Build against the account that has data.

---

### Q2 · Who may read a lead?

A lead is a stranger's name and phone number — the most sensitive rows this
product will hold.

- Super Admin / Admin: all leads?
- Team Coordinator: all leads, or only their projects' leads?
- Staff (Member): **only leads assigned to them**, or all leads on their projects?

*Changes:* the RLS policies, which are the hardest thing to change later, and
whether a staff member can see a colleague's pipeline.

**Recommendation:** Admin+ all; Coordinator by project; Member assigned-only.
Widening later is easy, narrowing takes access away from people used to it.

---

### Q3 · Does a lead belong to a project?

The owner said the CRM should have a project dropdown like the Studio. That
implies yes. But a Meta lead form does not know about Taskly projects.

- **(a)** Map each lead **form** to a project once; every lead from that form
  inherits it.
- **(b)** Map each **page** to a project. Coarser, simpler.
- **(c)** Leads arrive unassigned; somebody assigns the project by hand.

*Changes:* whether `project_id` is nullable, and whether the dropdown can be the
main navigation of the whole CRM.

**Recommendation: (a).** Chitral's six forms would each be pinned to the Chitral
project once, and it is then automatic for ever.

---

### Q4 · What are the stages, in the words your team says out loud?

The task board's statuses get used because they are the words people already use.
Same principle here.

A starting point from the PropForce screenshot: **New → Contacted → Follow Up →
Qualified → Visit Scheduled → Negotiation → Won / Lost.**

- Are those right?
- What are the **lost reasons** worth recording? ("wrong number", "budget", "not
  serious", "bought elsewhere") — this is what makes campaign reporting useful.
- Is "hot / warm / cold" set by hand, or derived?

*Changes:* an enum in a migration, the board, and every report.

---

### Q5 · Three roles — what exactly is the third?

The owner said *"there should be three roles"*. Taskly already has four:
Super Admin, Admin, Team Coordinator, Member.

- Is CRM staff = the existing **Member** role?
- Or a new role — someone who sees the CRM and not the task board?
- Should a Coordinator see their team's leads, as a middle tier?

*Changes:* whether this is a permission on existing roles or a new role, which is
a much larger change touching every rank comparison in the product.

**Recommendation:** use the existing roles. A new rank is expensive and the
existing four already have the right shape.

---

## Answerable as we go

### Q6 · Which phone number does WhatsApp open from?
A `wa.me` link works today with no integration. Real API sending needs the
WhatsApp Business API number and template approval. **Is there a number Taskly can
use?**

### Q7 · Email — from which address, and what does the first template say?
Taskly already sends email. This is templates and logging, not new plumbing.

### Q8 · Call system — which provider?
Everything about call logging and recording follows from this. Deferred by the
owner; noted so it is not forgotten.

### Q9 · Contact management — is a "client" separate from a "lead"?
PropForce shows "Khurram · 16 Leads" — one person with many leads. Do we need a
**contacts** table that leads hang off, or is a lead the whole record?
*Changes:* one table or two, and whether duplicate detection merges or links.

### Q10 · The testing staff account
The owner said they will add a testing staff member. **Which role, and on which
project?** Everything staff-side gets tested through it.

### Q11 · How far back should the backfill go?
Everything Meta still holds (recommended), or only from a date?

### Q12 · What does "smart dashboard" mean to you, concretely?
The most useful version of this answer is one sentence describing the first thing
you would want it to tell you when you open it in the morning.

---

## Answered — 2026-09-09

The full text is in the decisions log in `00-STATE-AND-TRACKER.md`. In short:

- **Q1** Start with Chitral. AI & Digital's ad account is being created.
- **Q2** Admin + Super Admin see all. Coordinator included. Sales staff see the
  leads assigned to them, with the whole record.
- **Q3** Yes, project-scoped, with a campaign column and campaign filters.
- **Q4** Stages agreed. Lost reasons started; more suggested below.
- **Q5** Existing four roles. CRM access = Admin, Super Admin, Coordinator, and
  project members marked **sales**.
- **Q7** Lead and client are different things; a lead becomes a client on
  engagement.
- **Q10** One testing staff member in the sales team, all leads assigned to them.
- **Q12** See `07-AI-PLAN.md`.

---

## Raised by what the answers revealed — 2026-09-09

### Q13 · Which project does each campaign belong to?

Six live lead campaigns, and their names already read like project names:

| Campaign | Best guess |
|---|---|
| chitral royal homes campaign | Chitral Royal Homes |
| The Executive housing Project campaign | The Executive Housing Project |
| AGC Construction & Leads campaign | AGC Construction & Interior Design |
| investo 21 campaign for Etemaad 100 | Investo 21 — **or** ETEMAAD100 GROUP? |
| Female model Hiring campaign of attari gourp page | Attari Group – AGC. ⚠️ This is *hiring*, not sales. Should hiring leads even enter the sales CRM? |
| CNI_KSA_LeadGen_RYD-JED_Sep26 | Crescent Nova International |

*Two real questions in there:* which project owns "investo 21 for Etemaad 100",
and whether a **hiring** campaign belongs in a sales pipeline at all.

### Q14 · Three pages cannot be read at all

The Executive Housing, AGC Construction and Investo 21 run live lead campaigns on
pages no Taskly token can reach. Their leads are invisible and expiring.
**Will you assign those three pages to a portfolio the Taskly-App system user can
access?** Nothing in code can substitute for it.

### Q15 · Lost reasons — the fuller list

Owner gave: wrong number, not serious, budget not enough. Suggested additions,
each one chosen because it changes a decision somebody makes:

| Reason | What it tells you |
|---|---|
| Wrong / invalid number | Lead quality — the campaign form or the audience |
| Never answered after N attempts | Response time, or bad hours |
| Budget too low | Targeting is bringing the wrong income band |
| Wrong location | Geo targeting |
| Just browsing / not serious | Creative is attracting curiosity, not intent |
| Bought from a competitor | Lost on price, product or speed — worth a follow-up question |
| Wants something we do not offer | Product gap, and a real signal |
| Duplicate | Data hygiene, not a loss |
| Timing — revisit later | ⚠️ Not a loss at all. Should be its own stage, so these are not written off. |

### Q16 · Does a client belong to one project, or to the division?

A lead belongs to a project. But if Khurram enquires about Chitral *and* about
Executive Housing, is that one client with two leads across two projects, or two
clients? *Changes whether `clients` sits above projects or inside them.*

### Q17 · What makes a lead a client, exactly?

The owner said: engagement, a quotation accepted, or work starting. For the system
this has to be one moment. **Is it reaching the "Won" stage, or a separate
"convert to client" action a person takes?**

### Q19 · What does each salesperson specialise in? — ⏳ DEFERRED, NOT CLOSED

Owner, 2026-09-12: *"Definitely I will ask the salespersons what their
specialties are and on what things they have trained. I will definitely add that
to the sales team… Right now I don't know because I'm not a salesperson. I don't
know what the things are and what the working phenomena are. Definitely I will
ask the sales manager."*

**There is no specialisation field today, and there will be one later.** The
owner will ask the sales manager and the salespeople directly once the team
exists, and bring back the real answer.

⚠️ **DO NOT INVENT THE COLUMN IN THE MEANTIME** — owner, on being warned:
*"Please don't do that."* A `specialisation` filled in by guesswork would route
real leads on made-up information and look authoritative while doing it. The
field arrives when somebody who actually sells has said what belongs in it.

**So Step 7c is deferred, not cancelled.** `10-LEAD-ASSIGNMENT.md` builds a
router that needs none of it — workload, response speed, availability and recent
activity — so nothing waits on this. When the answer arrives it becomes a filter
in front of that router rather than a replacement for it.

**What to ask the sales manager, when there is one:**

- Does anybody handle a particular **product** — ERP versus CRM versus marketing?
- A particular **city or region**?
- A **budget band** — who takes the large enquiries?
- A **language** — Urdu, English, Pashto?
- Is anybody **new enough** to need a lighter or easier share?

⚠️ Any of those that comes back as "no" should be recorded as a no. A field with
one real value and four invented ones is worse than no field.

### Q18 · Personal data and the AI — ✅ ANSWERED 2026-09-12: SEND THEM

Owner: *"Question number 18: strip identifiers. No I didn't say that. I said:
add name and number. No problem with that."*

**The lead's name and phone number go to OpenAI with the rest of the record.**

⚠️ **THIS REVERSES WHAT THIS FILE SAID FOR ONE DAY, AND THE MISTAKE WAS MINE.**
I read a sentence break in the wrong place and wrote down the opposite answer.
Recorded rather than quietly overwritten: a decisions log that silently changes
its mind is worth less than one that shows where it was corrected.

#### What is being chosen, stated rather than argued again

- The data leaves our servers and leaves Pakistan; a US company processes it.
- OpenAI does not train on API data by default but retains it for a period for
  abuse monitoring. ⚠️ Check their current terms rather than a figure quoted
  here — these change.
- ⚠️ **Chitral's leads are a CLIENT's data, not ours.** We are an agency holding
  a developer's customer list. That is a commercial and trust question rather
  than a technical one. It was put to the owner and the owner decided.

#### What it changes in the build — less than expected

Of every planned AI feature only the drafted message genuinely *wants* a name.
The summary, the talking points, the quality flags and every per-person analysis
work identically either way, and the **phone number is read by none of them** —
the model never dials anyone. So identifiers travel because the owner is content
for them to, not because a feature needs them.

⚠️ **THE LARGER QUESTION IS STILL OPEN AND MUST NOT INHERIT THIS ANSWER.**
Letting the AI read WhatsApp *conversations* (Tier C) sends far more than a
name: what somebody can afford, their family situation, why they are moving.
Ask that separately when it arrives. See `07-AI-PLAN.md`.
