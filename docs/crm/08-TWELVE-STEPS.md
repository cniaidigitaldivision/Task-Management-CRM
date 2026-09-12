# The twelve steps

Owner, 2026-09-10: *"you can't implement all the things in one go… divide it into
phases, divide it module-wise, divide it feature-wise, and implement it step by
step, 12 steps, and implement it logically."*

And on scope: *"first start working on Chitral Royal Homes. First make them live
and mention that for other projects whose leads you can't read, it's coming soon
or not connected."*

**Branch: `crm` throughout.** Nothing reaches `main` until the owner says so.

---

## ⚠️ ONE PROJECT: CHITRAL ROYAL HOMES

Owner, 2026-09-10: *"just choose one project, like Chitral Royal Homes, and
implement this whole CRM. Later on I will do the same thing for the other
projects. I'm not saying that you carry 2 or 3 projects at a time, their leads at
a time, and every stuff at a time."*

So all twelve steps are built and finished for **Chitral Royal Homes alone**.
Every other project shows **"Not connected"** with one line saying why.

⚠️ **But the tables keep `project_id`.** Building single-project into the SCHEMA
would turn "later on I will do the same for the other projects" into a rewrite
rather than a row in a table. The column costs nothing today and saves the entire
second build. What is narrowed is the WORK and the DATA — one importer, one
project in the dropdown, one pipeline to get right — not the shape underneath.

That distinction is the whole reason project #2 will take an afternoon instead of
a month.

---

## How to read this

Every step is **shippable on its own** — it ends with something that works, not
with scaffolding waiting for the next step. Each names what it needs from the
owner, so nothing stalls silently.

| Symbol | Meaning |
|---|---|
| 🔓 | Needs nothing — can start immediately |
| ⏳ | Needs something from the owner |
| ⚠️ | Carries a risk worth reading before starting |

---

# MODULE 1 · Capture — get the leads and keep them

The 90-day clock lives here. Nothing else matters until this module is done.

---

### Step 1 · The tables 🔓
**Migration 110.** `crm_leads`, `crm_lead_notes`, `crm_lead_activity`, plus a
`sales` value on `project_role` so a project member can be marked sales team.

- RLS from the first minute: Admin/Super Admin all; Coordinator by project; sales
  member sees leads assigned to them.
- ⚠️ Self-check runs as `cni_app` **with no session**, because the importer will
  run that way and RLS fails closed — a policy that blocks the cron returns zero
  rows and reports success.
- ⚠️ Any "required when" rule uses an explicit `is not null`. A CHECK that
  evaluates to NULL passes; migration 107 proved it twice in one evening.

**Delivers:** somewhere for leads to live. Nothing visible yet.
**Verify:** migration self-check passes; a Member cannot read an unassigned lead.

---

### Step 2 · The Chitral importer, and the backfill ⚠️🔓
The urgent one.

- Read Chitral's lead forms, page every lead, upsert on `(source, external_id)`.
- Store `full_name`, `phone`, `phone_e164`, every raw answer as jsonb,
  `form_id`, `form_name`, `submitted_at`.
- **Run the one-off backfill the same day.** 615 leads, oldest already at the
  edge of Meta's 90-day deletion.

⚠️ Chitral only, deliberately. CNI has three forms and no leads; the other three
projects are unreadable until their pages are in a reachable portfolio.

**Delivers:** the leads are ours. The clock stops mattering.
**Verify:** row count matches Meta's `leads_count` per form; running it twice
changes nothing.

---

### Step 3 · Scheduling and health 🔓
- `pg_cron` every 15 minutes, the same pattern as the Meta sync.
- A sync-run record per import: how many found, how many new, how many failed.
- ⚠️ Failure is recorded and visible, never a silent zero. The Studio learned
  this the hard way.

**Delivers:** leads arrive on their own, and you can tell when they stop.
**Verify:** watch two consecutive runs; break a token deliberately and confirm
the failure is visible.

---

# MODULE 2 · The desk — make them workable

---

### Step 4 · The list, project-scoped ✅ DONE 2026-09-10
The screen replaces the placeholder that stood here from 2026-09-09.

- **Project dropdown**, the same pattern and position as the Studio. All 14
  projects; Chitral reads "615 leads", the other 13 read "not connected".
- **Three states, not two** — `live`, `no-leads-yet`, `not-connected`. "A form is
  linked but nothing has come through" and "no form is linked" send a reader to
  two different places, and collapsing them is what makes somebody redo setup
  that was already done.
- Columns: lead · next action · stage · temperature · last outcome · owner ·
  came from · reach them. ⚠️ **Lead first, not next action** — see the decisions
  log. No project column: the dropdown already scopes the page, so it would print
  the same value 25 times.
- ⚠️ Sorted by **next action**, `nulls last`, then newest first. Unchanged, and it
  is the difference between a list you work from and a list you scroll.
- **The stage strip doubles as the stage filter**, and shares one `where` clause
  with the table — written as two queries, a date filter would leave the strip
  reading "New 615" above a table of 21 rows.
- Filters: stage, owner, temperature, form, date range, plus search across name,
  raw phone and normalised phone.

⚠️ **Four columns are empty and stay drawn.** Owner, temperature, next action and
outcome are null for all 615 leads because assignment and calling are Steps 6–7.
A banner says so and removes itself the moment one lead is assigned. A column
that appears only once it has data is a column nobody plans around.

**Still needed from you:** which project each campaign belongs to (Q13), and
whether the hiring campaign belongs in a sales pipeline at all. Neither blocked
this step — the column shows the form until campaigns are linked in Step 8.

**Delivered:** you can see the leads, filter them, and reach any of them.

---

### Step 5 · The lead detail ✅ DONE 2026-09-10
Click a row, get the whole person: every answer Meta captured, the note thread,
the activity timeline, the campaign and form that produced them.

- **A route, `/leads/[id]`, not a drawer.** A lead is a destination somebody is
  SENT to — "ring this person" is a link pasted into WhatsApp, and Step 7's
  assignment notification needs a URL to point the bell at.
- ⚠️ **The list's filters travel with the link**, so "back" returns to page 9 of
  the filtered list it was opened from rather than to an unfiltered page 1.
- **The question is asked in words.** Meta's key is
  `which__size_are_you_interested_in?_`; the screen says "Which size are you
  interested in?" and keeps the raw value on hover as evidence.
- ⚠️ **A missing lead and a lead you may not read render the SAME 404.** With a
  uuid in the URL, confirming that a particular lead exists is the whole of what
  an attacker wants.
- **"This number enquired before"** — ~18 of the 615 share a number with another
  lead. Worth knowing before ringing somebody a colleague already spoke to.

⚠️ **NOTHING ON THIS PAGE WRITES, and it does not pretend to.** Stage, notes and
call outcomes are Step 6. The tempting version draws the controls now and wires
them later — a stage dropdown that does not save, a note box with a Post button.
That is the worst state this page could be in: somebody types what they quoted a
client, presses the button, and the record silently does not have it.

**Delivered:** the record a salesperson actually needs before ringing somebody.

---

### Step 6 · Working the lead ✅ DONE 2026-09-10
The actions that need no new integration and cover most of the daily job:

- Change stage · set the next action and its date
- Log a call outcome — attempted, connected, no answer, wrong number
- Add a note ⚠️ the owner's example: *"what quotation I have given him"*
- Mark temperature — hot / warm / cold
- **WhatsApp button** — `wa.me/{phone}` opens the chat, pre-filled. Zero setup.
- Mark lost, with a reason from the agreed list

All six, in a **Work this lead** card at the top of the record — where somebody
between two calls looks first, rather than below the reading.

⚠️ **THE TIMELINE IS WRITTEN BY THE DATABASE.** Migrations 115 + 116: a stage
change, a temperature, a next action, an assignment and a note each write their
own history from a trigger, so it happens whatever made the change — this app, a
bulk action later, or a script somebody runs by hand. The caller cannot forget,
because the caller is not asked.

⚠️ **A session can change exactly five columns**, and `owner_id` is not one of
them — **Step 7 adds it**. Before 116 a salesperson could have refiled their lead
to another project, rewritten the number Meta captured, or backdated their own
response time.

⚠️ **Marking lost does not save on the select.** Every other stage does. Lost is
two decisions — that it is, and why — and the why is what makes the lost-reason
report worth reading.

⚠️ **Opening WhatsApp still logs nothing.** A chat window is not evidence a
message was sent. "WhatsApp sent" is its own button, next to the four others.

**Delivered:** the desk works. A salesperson can run their day from it — except
that nobody can be given a lead yet.

---

### Step 7 · Assignment and the staff view ✅ DONE 2026-09-10
- Assign a lead to a sales team member, from the lead itself.
- **Share out** — the unassigned leads, divided across the team automatically.
- The staff view: **the same component**, narrowed by migration 118's policy
  rather than by a second query, so the two cannot drift apart.
- A notification when a lead becomes yours, through the existing bell.

⚠️ **THE RULE IS ARITHMETIC, AND IT IS PRINTED ON THE SCREEN.** Owner:
*"one salesperson has 2 leads. Definitely the person who has fewer leads will get
the lead. Proper intelligence, right?"* — correct, and it needed no defending.
An earlier note in this file conflated distribution with SCORING; only the second
needs outcomes to learn from. Migration 120:

1. **Fewest OPEN leads.** ⚠️ Open, not lifetime — counting every lead somebody
   has ever held would permanently punish whoever closes fastest.
2. **On a tie, whoever waited longest**, read from the assignment history 116
   already writes. Somebody who has never had one goes first.
3. Oldest enquiry shared out first — those are closest to Meta's 90-day deletion.

Measured on the live database: from 2 leads vs 0, four new ones went **3 to the
person with fewer and 1 to the other**, ending level. Ten from level went **5 and
5**. The manager got none in either — they run the rota, and can still be handed
a lead by hand.

⚠️ **RESPONSE TIME IS THE BETTER TIE-BREAK AND IS NOT USED YET.** 116 stamps
`first_contacted_at` on every logged call, so it is accumulating from today.
Ranking people by a number computed from no data is the confident noise
`07-AI-PLAN.md` refuses. One clause in one `ORDER BY` when there is data.

⚠️ **A SALESPERSON CANNOT HAND A LEAD TO A COLLEAGUE.** `owner_id` was left out
of 116's column grant deliberately; 120 grants it and puts the rule in a trigger,
because PostgreSQL has no per-column policy and a plain grant would have let
anybody push an awkward lead onto somebody else.

⚠️ **AND THIS IS WHERE THE 2026-09-08 BUG CAME BACK.** The sales manager is
`member` in `users.role`, so `users_select` shows them ONE row of the staff
table — their own. The lead list read the owner's name with a plain join, so
every colleague would have rendered as **"Former member"** on the one screen the
manager opens to see who holds what. Measured under their own session before
migration 121 was written, and 121's self-check asserts the bug so the reader can
be deleted if `users_select` ever widens.

**Delivered:** the two-dashboard split. A manager shares leads out and sees who
holds what; a salesperson opens the same desk and sees only theirs.

---

### Step 7b · What the manager sees ✅ DONE 2026-09-10
The reporting half of what the owner asked for:

> *"who the person is on which lead, who is responsible for which lead, how they
> are responding, what talks with it, how quotations are given, how instantly
> they are replying or engaging with the client."*

A **sales team** panel under the list, for the manager and Admins only: who holds
what, how many they have closed, how fast they usually answer, and when they were
last given a lead. `app.crm_sales_roster()` computes it; nothing invents it.

⚠️ **A TABLE, NOT A CHART, AND THAT IS A DECISION.** Three people and four
measures each. A grouped bar chart of that is four colours carrying no meaning
and the reader still has to look up the numbers. The one thing genuinely COMPARED
across people is workload, so that gets a bar; everything else is a figure.

⚠️ **"No calls yet", NEVER "0m".** `median_response_minutes` is null until
somebody logs a contact, and rendering that as zero would tell a manager their
salesperson answers instantly — the most flattering possible reading of no data.
`responseTime()` returns null so it cannot be formatted by accident.

⚠️ **NO CONVERSION RATE, AND NO WON COLUMN, UNTIL SOMETHING IS CLOSED.** A "0%"
column reads as a fact about the salespeople and is a fact about the calendar —
the pipeline is three weeks old. The column appears the day somebody wins one.

⚠️ **THE RESPONSE-TIME THRESHOLDS ARE A JUDGEMENT AND ARE LABELLED AS ONE.**
Under an hour reads fast, over a day reads slow. Nothing in this division's data
says that is the line; it is the commonly cited one. Step 12 should replace it
with the line that actually predicts a close.

**Delivered:** the manager can see who is carrying what and who answers quickly.

---

### Step 7c · Distribution that reads the lead ⏳
Owner: *"AI-integrated ChatGPT API keys are integrated. You will just put that
into ChatGPT… these leads have 1 sale percent, these have 2 sale percent, and
this is the specification for that person."*

Matching a lead to the right person, rather than only to the least busy one.

⚠️ **What is missing is not the model — it is the specification.** There is no
field saying what a salesperson handles. The lead's own answers ARE structured
(`plots` vs `villa`, `10 marla (commercial)`, the city), so once each salesperson
has a focus recorded, most matching is a string comparison and needs no model at
all. Keep the AI for the fuzzy remainder and for writing the sentence over the
top — the same split `07-AI-PLAN.md` §B2 already argues for.

**Needs from you:** what each salesperson specialises in — or a decision that
they do not, in which case Step 7's load balancing is already the whole answer.

---

# MODULE 3 · Follow-through — stop leads going cold

---

### Step 8 · Follow-ups and reminders ✅ DONE 2026-09-10
- **A due strip on the desk** — overdue, due today, nothing planned. Each one
  filters the list.
- **A morning reminder in the bell**, to the salesperson: *"7 overdue and 3 due
  today."*
- **A neglect alert to the manager**: *"14 leads of Ali have gone quiet."*
- ⚠️ Rules, not AI. Instant, free, and it cannot hallucinate.

⚠️ **NO HTTP ROUTE, AND THAT IS THE DESIGN.** The lead sync needs one because it
calls Meta; this calls nothing, so **pg_cron invokes the function directly**.
That removes every one of the sync's operational problems at once: no
`CRON_SECRET` in three places, no bearer token, no `pg_net` response nobody
reads, and **no 404 until the branch is deployed** — it worked the moment
migration 123 landed.

⚠️ **ONE NOTIFICATION PER PERSON, NOT ONE PER LEAD.** Somebody with twenty leads
due today wants to be told once that today has twenty. `feed.ts` already records
what happens otherwise: *"a feed that is mostly noise gets ignored — which then
costs you the one notification that mattered."*

⚠️ **HOURLY, BUT ONCE A DAY.** The job runs 08:00–19:00 Karachi so that a single
missed firing does not cost a day of reminders; what stops twenty-four firings
becoming twenty-four notifications is a check against what was already sent
today, read from the `notifications` table itself. No `last_reminded_at` column —
a second record of what was sent is a second thing to get wrong.

⚠️ **AN IMPORT IS NOT ACTIVITY.** Every one of the 615 leads has an `imported`
row. Counting it would make a lead nobody has ever rung look freshly worked.

⚠️ **THE NEGLECT INTERVAL IS A JUDGEMENT AND IS A PARAMETER.** Five days by
default. Nothing in this division's data says that is the line — there is not one
closed lead to learn it from — so it is changeable in the cron schedule without a
migration, and Step 12 should replace it with the interval that predicts a loss.

⚠️ **AND THE DUE STRIP DISAPPEARS WHEN THERE IS NOTHING OWED.** A row of three
zeroes above every list is furniture, and furniture is what people stop reading.

**Delivered:** nothing sits untouched without somebody being told.

---

### Step 9 · Clients ✅ DONE 2026-09-10
A lead is an enquiry; a client is someone who engaged. One client, many leads —
the *"Khurram · 16 Leads"* column in the reference screenshot.

⚠️ **`Won` IS THE CONVERSION, AND THE OWNER'S FIRST ANSWER WAS DECLINED.** Asked
what converts a lead, they said: *"If they engage and we show some intro,
definitely that will convert the lead… maybe you are a sales expert or you know
better."* Put back with the reasoning — **engagement is too early**: within a
month there would be two hundred "clients" who had paid nothing, and the word
would stop carrying information. Their own 9 September answer was better
(*"accept a quotation, or work starts"*) and they agreed. "They engaged" is the
`qualified` stage, which already exists.

⚠️ **It also protects Step 12.** *"6,000 leads and not one closed"* only means
something if closed means money.

⚠️ **A TRIGGER, NOT A BUTTON.** The same reasoning as 116's timeline: the second
caller is the one that forgets, and a won lead that is not a client is a state
nobody can explain and every report has to allow for.

⚠️ **THE SAME NUMBER IS THE SAME PERSON.** 615 leads carry 597 distinct numbers,
so ~18 people enquired twice. Winning a second lead LINKS to the client who
exists — matched on `phone_e164`, never the raw `phone`, because `0300-1234567`
and `+92 300 1234567` are one person and two strings. That is what makes the
lead-count column possible at all.

⚠️ **REOPENING A LEAD DOES NOT UNMAKE THE CLIENT.** 116 clears `closed_at` and
`lost_reason` because those describe the lead. A client is a person, may have
notes, and may hold other leads — a trigger that deleted people on a stage change
would turn one mis-click into data loss. A mistake leaves a client who should not
be one: visible, and removable by an Admin.

⚠️ **AND IT COUNTS, IT DOES NOT RATE.** No conversion %, no average deal, no
lifetime value — each divides by a number that is zero or a price this system has
never been told. The same refusal as the sales team panel.

**Delivered:** contact management, and the repeat-enquiry picture. `/clients`,
its own route beside the desk.

---

### Step 10 · Reports, stored ✅ DONE 2026-09-10
Four reports at `/lead-reports`, each computed once and kept:

| | |
|---|---|
| **How long leads have been waiting** | Ageing buckets. ⚠️ The one with real signal today. |
| **Where the leads came from** | Per form: leads, contacted, won, lost, win rate. |
| **Lead funnel** | Every stage in pipeline order, including the empty ones. |
| **How the team is doing** | Per person: held, contacted, closed, response time. |

⚠️ **THE STATED REASON FOR STORING THEM WAS WRONG, AND A BETTER ONE HOLDS.**
This file said reports must be stored *"so a report you generated in October
still says in December what it said in October"*, because Meta deletes at 90
days. That is not it — **we keep the leads**, so Meta's deletion has no bearing.
The real reason is smaller and true: a report is **a statement made on a date**.
Re-running "September, by source" in December legitimately gives different
numbers, because leads get reassigned and stages move. What matters is what it
said when somebody read it.

**Proved on the live database:** an ageing report was stored, five leads were then
won, the live count moved 615 → 610, and the frozen copy still read 615.

⚠️ **AND IT IS NOT A CACHE.** Never refreshed, never invalidated. A stale
snapshot is the *correct* answer to "what did we report in September".

⚠️ **APPEND-ONLY, INCLUDING FOR ADMIN.** No UPDATE and no DELETE policy — the
same rule as `report_exports` and the activity log. A report somebody can quietly
revise is not evidence of anything.

⚠️ **NOTHING INVENTS A RATE.** A win rate arrives NULL from SQL while nothing
has closed and renders as an em dash, not 0% — as a text cell, so a spreadsheet
averaging the column excludes it rather than being dragged down by a zero nobody
measured. Same for response time.

⚠️ **AND EACH REPORT SAYS WHAT IT CANNOT YET TELL YOU.** The sources report
states that nobody has been contacted at all, so nothing in it judges a campaign;
the funnel says 615-at-New is a pipeline snapshot rather than a conversion
measure; the team report says there is nothing to compare until leads are shared
out. `lib/domain/reports.ts`: *"a number without its definition is how two people
read the same report and disagree."*

**What it turned out to say:** 553 of the 615 open leads are over a month old
— 90% of them — the oldest at 90 days, and **not one has ever been contacted.**

**Delivered:** "which campaign is worth the money" is answerable the day the
leads are worked. Today the reports answer a different and more urgent question,
and say so.

---

# MODULE 4 · Intelligence — once there is something to be intelligent about

Full reasoning in `07-AI-PLAN.md`. Short version: the honest AI needs the record
that Modules 1–3 build.

---

### Step 11 · Per-lead intelligence ⏳
Works from the lead row alone, so it lands as soon as Module 2 does:

- Two-line summary of what this person wants
- Talking points before a call — *"this is the way you can talk"*
- A drafted WhatsApp or email you edit before sending ⚠️ never auto-sent
- Data-quality flags: invalid number, duplicate, "just looking"

**Needs from you:** the OpenAI key (into Supabase Vault, not the environment), and
a decision on whether names and phone numbers may leave our servers or should be
stripped first (Q18).

---

### Step 12 · Campaign and staff intelligence ⏳
Your headline question — *"6,000 leads and not one closed: is it the staff or the
campaign?"*

- Same campaign, different staff → it is the person
- Same staff, different campaigns → it is the campaign
- Nobody closing → lead quality; read the lost reasons
- Response-time analysis per person and per campaign
- Then, and only then, lead scoring from real outcomes

⚠️ Shown as arithmetic anybody can check, with the AI writing the sentence over
the top. A conclusion nobody can reconstruct gets ignored the first time it
disagrees with somebody's gut — the same reason the workload page prints its
formula.

⚠️ **Scoring waits for ~200 closed leads.** A score with no outcomes behind it is
a confident number with no information in it, and people trust numbers.

**Needs from you:** a few weeks of real use. There is no shortcut.

---

## What can start today, with nothing from you

**Steps 1, 2 and 3** — the tables, the Chitral importer, the backfill and the
schedule. That is the whole urgent module, and it needs no decision, no
credential and no permission change.

Steps 4 and 6 follow immediately after and need only the campaign→project
mapping, which is a five-minute answer.

---

## What is parked, and why

| Parked | Waiting on |
|---|---|
| Executive Housing, AGC Construction, Investo 21 | Business-portfolio access. You have the pages; the portfolios are not yet reachable. Until then their tiles read "Not connected". |
| CNI leads | Its three forms have produced none yet. The importer will pick them up the day they do. |
| AI & Digital | Ad account being created. |
| WhatsApp API sending | A Business Platform number. The `wa.me` link works in the meantime. |
| Call & voice system | Provider decision. Deferred by you. |
