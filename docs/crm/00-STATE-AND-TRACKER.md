# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | ⚠️ **`main`.** The CRM was merged and deployed 2026-09-12; `crm` still exists but is behind. |
| **Route** | `/leads` · `/clients` · `/lead-reports` · nav: Growth → Campaign & Lead Desk |
| **Phase** | ⏸️ **PAUSED 2026-09-12, at Steps 1–10 of 12 — LIVE IN PRODUCTION.** The desk works, the importer runs itself, and a demo testbed exists for proving the rest. Paused by the owner to restructure the company's teams first. |
| **Scope** | Chitral Royal Homes (real, 625 leads) + a removable demo project for testing. |
| **Last updated** | 2026-09-12 |
| **Last migration applied anywhere** | **134.** CRM next: 135. |

---

## ⏸️ PAUSED — read this before starting anything

**Paused 2026-09-12 by the owner**, to restructure the company's teams before
any more CRM work.

> *"Right now just one team, the AI and Digital team, is implemented. No finance
> team, no sales team, no HR team, and no other team… Not even their form is
> properly working so I want that to be properly working first. Then I will come
> back to this CRM and maybe it will be easier for me to tell you which things I
> will assign to which."*

⚠️ **THIS IS THE RIGHT ORDER, AND THE CRM IS THE REASON.** Every unanswered
question left in this file is a question about PEOPLE: who specialises in what,
who a lead should go to, who may read a report. The CRM cannot answer any of
them while Sales, Finance and HR exist as rows in a `departments` table with
nobody meaningfully in them. Restructuring the teams is not a detour from this
work — it is the input this work is waiting on.

**The next work happens on a new branch** (`team-restructuring` or similar),
which merges to `main` before the CRM resumes. Nothing here is half-built:
everything committed is deployed, tested and working.

### ⛔ Still genuinely blocked, and on what

| Blocked | Waiting on | Workaround |
|---|---|---|
| **WhatsApp sending** | ⚠️ **Business verification — applied for, ~12 days as of 2026-09-12.** Meta refuses to add a test recipient until the business is verified. | The `wa.me` link works today. Receiving is already proven. |
| **Step 12 · campaign vs staff** | Weeks of real use. Nothing is closed. | None, and honestly so. |
| **Step 7c · specialisation matching** | ⏳ The **sales manager**, once there is one. Owner will ask what each person handles and bring back the real answer. ⚠️ The field must not be invented meanwhile. | ✅ **Nothing waits on it.** The four-signal router in `10-LEAD-ASSIGNMENT.md` uses none of it. |

### ✅ What is left, in order — updated 2026-09-13

Steps 1–10 are live. The four-signal router landed 2026-09-13 (migration 133).
What follows is everything still to do, with what each one actually involves.

| # | Step | Needs | What it is |
|---|---|---|---|
| ~~1~~ | ✅ **Live updates** — done 2026-09-13 (no migration; the pulse carries a lead count) |  |
| ~~2~~ | ✅ **Editing an existing person** — done 2026-09-13 |  |
| ~~3~~ | ✅ **Importer-failure alert** — done 2026-09-13 (migration 134) |  |
| **4** | **Manager dashboard** | nothing | Its own page rather than a panel under the list: trend over time, per-campaign comparison, who is overdue right now, SLA breaches. |
| **5** | **Salesperson dashboard** | nothing | "My day" — what is due, what is overdue, what went quiet, my own response time. |
| **6** | **Step 11 · per-lead AI** | ✅ key in Vault, ✅ Q18 answered | Two-line summary, talking points, a drafted message the person edits. ⚠️ Never auto-sent. Cached on the row and regenerated only when the lead changes — generating per page load is the difference between a few dollars a month and a few hundred. |
| **7** | **Specialisation in the rota** | ⏳ the sales manager | Once there is a real answer, it becomes a FILTER in front of the router, not a replacement for it. ⚠️ Do not invent the taxonomy — Q19. |
| **8** | **WhatsApp conversations** | ⛔ business verification | Two tables (a thread per lead, the messages in it), a reply box on the record, matched to the lead by normalised number. Verification was applied for ~2026-09-12 and takes around 12 days. |
| **9** | **Step 12 · campaign vs staff** | ⏳ weeks of real use | The owner's headline question. Same campaign different people → the person; same person different campaigns → the campaign. Arithmetic, with the model writing the sentence over it. |

⚠️ **Steps 4, 5 and 6 need NOTHING from anybody** — 1, 2 and 3 are done and can run straight through. Only
7, 8 and 9 wait on the outside world.

### ⚠️ Two owner tasks that are still not done

- ~~**The ERP and Taskly projects do not exist.**~~ ⚠️ **CLOSED 2026-09-13, and
  it was never a task.** This file said for three days that two campaigns had
  "nowhere to file to". Untrue: the AI & Digital PAGE already maps to the
  **AI & Digital Division** project, so every lead from the ERP, CRM and Taskly
  campaigns lands there and routes to Kashif — no extra record needed.

  Owner: *"I just want to run a campaign which is definitely for the AI digital
  campaigns… No need to assign or link to some project. The DBN itself is
  enough."* Correct. Two `type = 'tool'` rows were created on that mistaken
  reading and have been deleted again.

  ⚠️ **AND THE CAMPAIGNS STAY DISTINGUISHABLE ANYWAY** — which was the original
  worry. Migration 127 files a lead by its FORM, and the desk's "Came from"
  column shows that form, so an ERP enquiry is still tellable from a Taskly one
  while both sit on one project. Separate projects were never what made that
  work.
- **`procurment` is spelled wrong** — created while testing the new department
  button. Rename fixes it and the key underneath does not move.


---

---

## ⏸️ PAUSED — read this before starting anything

**Paused 2026-09-10 by the owner**, to move onto the public homepage on `main`.

> *"Everything is still paused because of the WhatsApp business verification. I
> still didn't get the correct document, so WhatsApp integration is pending, Meta
> app verification is pending, and everything is pending… we can't proceed right
> now."*

⚠️ **NOTHING HERE IS HALF-BUILT.** Steps 1–10 are complete, tested and
committed on the `crm` branch. The three remaining items are each waiting on
something outside the code, and none of them can be honestly built first.

### What is blocked, and on what

| Blocked | Waiting on | Can it be worked around? |
|---|---|---|
| **WhatsApp integration** | Business verification documents, then the six owner steps in the setup brief | **No.** No number means no messages. The `wa.me` link on every lead keeps working meanwhile. |
| **Meta app review** | The same verification | **No.** Also the reason `campaign_name` is empty on every lead. |
| **Step 11 · per-lead AI** | The OpenAI key into Supabase Vault, and Q18 — may a lead's name and number leave our servers, or be stripped first | **No.** A summariser with no key is a button that fails. |
| **Step 12 · campaign vs staff** | A few weeks of real use. **Zero leads have ever been contacted** | **No**, and this is the honest one: the arithmetic is already built in Step 10. It has nothing to divide. |
| **Step 7c · matching by specialisation** | What each salesperson handles — there is no field for it, and inventing one before the owner says what goes in it is guessing | Partly. Step 7's load balancing already works and may be all that is wanted. |
| **ERP + Taskly campaigns filing correctly** | Two projects that do not exist yet | ⚠️ **This one is the owner's to do and takes minutes.** See below. |

### ⚠️ The one thing that is not blocked and is not done

**Two of the three live AI & Digital campaigns have nowhere to file to.** The
projects are `Internal CRM`, `Social Media Automation Tool` and
`WhatsApp Business API Automation` — there is **no ERP project and no Taskly
project**. Migration 127 makes a lead follow its FORM's project, so the mechanism
is ready; the destinations are not.

To fix: create the two projects, then for each campaign's form call
`app.crm_refile_form('<meta form id>', '<project id>', false)`. Admin only.
Until then all three campaigns' leads land under one project together.

### ⚠️ And one gap worth closing when work resumes

**A broken import is silent.** The owner is renewing the CNI access token
(*"some things I have changed definitely will not be working more with the old
assets"*), which will break `META_SYSTEM_USER_TOKEN_CNI`. When it does,
`crm_lead_sync_runs.errors` records it and **nobody is told** — Step 8 notifies
about leads going quiet, not about the importer dying. Small to fix; the
notification kinds and the hourly job already exist.

### How to resume

1. Read this file top to bottom.
2. Check whether Meta verification has landed. If not, nothing above changes.
3. Do the ERP/Taskly projects, which need nobody but an Admin.
4. `08-TWELVE-STEPS.md` has the order and the reasoning for everything else.

---

## ⚠️ 2026-09-12 — THE DAY IT WENT LIVE, AND FIVE BUGS ONLY A REAL USER FOUND

The single most important entry in this file. Everything below was found by the
owner logging in as the people the software is *for* — which nobody had ever
done, because every previous check was made from an Admin session.

### It is deployed, and the importer was never broken

`pg_cron` had been firing every fifteen minutes and getting a **404** since
2026-09-09. The diagnosis took one comparison:

| Endpoint | Response | Meaning |
|---|---|---|
| `/api/meta-sync` | 401 | route exists, refused a missing token |
| `/api/crm/lead-sync` | **404** | route does not exist |

Production served `main`; every line of the CRM lived on `crm`. Not an API
fault, not a token, not Meta — **the CRM had never been deployed.** Merged
(cleanly) and released; the very next cron run returned 200 and imported
**8 new leads and 2 forms** nobody had seen. It has run clean every 15 minutes
since.

⚠️ **AND META'S DELETION IS NO LONGER THEORETICAL.** The 553-lead form read 537
three days later. Exactly 16 of our leads had passed 90 days — the arithmetic
closes: 615 held − 16 deleted + 8 missing = 607, which is what Meta reported.
**Those 16 people now exist only in our database.** The backfill of 9 September
has paid for itself, visibly.

### ⚠️ THE SAME BUG, FIVE TIMES, ON FIVE TABLES

`projects_select` is `app.project_is_visible(id)` — it needs project
**MEMBERSHIP**. A salesperson is not a member of the project whose leads they
work; that is the *premise* of department routing. Every time a query touches
`projects` on their behalf, it returns nothing, and **RLS failing closed reads
as "no data" rather than "not allowed"**:

| # | Migration | What broke | How it looked |
|---|---|---|---|
| 1 | 105 | remark authors | "Former member" |
| 2 | 121 | lead owner names | "Former member" |
| 3 | 125 | the project dropdown | *"No projects are visible to you yet"* above 615 readable leads |
| 4 | **129** | **`getCurrentDepartment`** | **the whole CRM was unreachable** — no nav item, and `requireCrmAccess` redirected the sales team away |
| 5 | **130** | **`getCrmLead`** | **every lead 404'd** for its own owner |

⚠️ **NUMBER 4 MEANS THE SALES TEAM COULD NEVER OPEN THE CRM AT ALL.**
`getCurrentDepartment` asked through `withAppRole` — no `app.user_id` — so
`users_select` hid every row and it returned `NO_DEPARTMENT`. And even with a
session set, the `EXISTS` over `projects` was false anyway. Two independent
faults, either sufficient alone.

⚠️ **NUMBER 5 MEANS THE LEAD RECORD HAD NEVER WORKED FOR ANYBODY IT WAS FOR.**
Not "worked then broke" — every lead, every salesperson, since Step 5. The bell
said a lead was theirs and the link 404'd. The owner diagnosed it from the
symptom alone: *"it was showing that the project actually does not exist."*

⚠️ **WHY ALL FIVE SURVIVED: `crmIsOpenTo()` SHORT-CIRCUITS ON RANK.** An Admin
is a member of nothing and sees everything, so an Admin session cannot reach any
of these paths. **A screen signed off from an Admin account has not been tested.**

### And what else changed

- **The demo testbed** — `scripts/seed-crm-demo.mjs`. 18 leads about our own
  products on their own Sales-routed project, three designed tester profiles,
  `--remove` clears it. ⚠️ Sixteen carry `(demo — no number)` so they are
  **unmessageable by construction**; only two hold the owner's own handset.
- **A temporary test form** on the desk — admin-only, demo-project-only, stands
  in for a Meta lead arriving so the rota can be watched deciding. ⚠️ **Marked
  for deletion in all three files.**
- **"All leads" chip** on the stage strip. The toggle always existed; nothing on
  screen said so.
- **Lead reports narrowed to managers** — `crmReportsOpenTo()`. They name and
  compare people.
- **The WhatsApp webhook is proven on both halves** — the GET handshake echoes
  byte-exactly, and a correctly-signed POST returns `EVENT_RECEIVED`. ⚠️ Green
  in Meta only ever proves the GET; a wrong `META_APP_SECRET` verifies fine and
  then rejects every real message with a 403 that surfaces nowhere.

⚠️ **AND ONE FALSE ALARM, RECORDED SO IT IS NOT REPEATED.** `META_APP_SECRET`
was reported as mismatched and the owner was sent to re-copy a correct value.
The fault was a naive `.env.local` parser keeping a trailing `# comment` as part
of the value. **Parse the way dotenv does — quoted group first — or a
diagnostic tool confidently blames a credential that was always right.**

---

## Where we are, in one paragraph

Module 1 is finished and Module 2 is done bar assignment. The tables exist,
the importer has pulled **615 real Chitral Royal Homes leads** and re-run without
duplicating one of them, the pg_cron job fires every fifteen minutes, `/leads`
shows the leads themselves — filtered, paged and sorted by what is owed — and
clicking one opens the whole person: every answer Meta captured, where they came
from, the note thread and the timeline. Thirteen other projects sit in the same
dropdown saying "not connected", which is the truth rather than a placeholder.
And the desk now **works**: stage, temperature, next action, call outcomes and
notes all save from the lead itself, the timeline writes itself from the
database, and response time is stamped where nobody can edit it. What is still
missing is nothing on the desk itself: a manager shares leads out and sees who
holds what, a salesperson opens the same screen and sees only theirs, and the
rota gives each lead to whoever holds the fewest open ones. The manager also has
a **sales team panel** showing who is carrying what and how fast they answer. And
nothing sits untouched quietly: a due strip on the desk, a morning reminder in
the bell, and a neglect alert to the manager — all rules, all from pg_cron with
no route in between.

**And the company now has departments.** Eight of them, with the CRM belonging to
Sales: the two accounts that run the company plus the three sales testers, and
nobody else. The Team Coordinator was admitted until 2026-09-10 and is not any
more — see the decisions log, and ADR-012.

---

## Done

- [x] Branch `crm` created and pushed
- [x] `/leads` page + layout + nav entry (scaffold, no data, Admin-only floor)
- [x] Nav fixture test updated so the route is pinned
- [x] Verified ad accounts per suite — see `01-VERIFIED-FACTS.md`
- [x] Verified lead forms and lead counts per page
- [x] Verified lead data is readable, with its field shape
- [x] Confirmed Graph API v26.0 (unaffected by the v20.0 sunset)
- [x] Market research on CRM features — see `02-FEATURE-MAP.md`
- [x] Data model drafted — see `03-DATA-MODEL.md`
- [x] Phases written — see `04-PHASES.md` (superseded by `08-TWELVE-STEPS.md`)
- [x] **Step 1 · migration 110** — `sales` added to `project_role`
- [x] **Step 1 · migration 111** — six CRM tables, 15 policies, 23 indexes, RLS on
      all six, self-check green: a member sees only leads assigned to them, a
      duplicate Meta lead is refused, a lost lead needs a reason, and the
      activity log refuses deletion at every rank including Admin
- [x] **Step 2 · migration 112** — `app.crm_lead_sources` reader and
      `app.crm_record_leads` writer, both SECURITY DEFINER, self-checked with NO
      session exactly as the cron will call them
- [x] **Step 2 · the importer** — `lib/crm/lead-import.ts`, `lib/crm/lead-fields.ts`,
      `lib/domain/phone.ts`, `/api/crm/lead-sync`, 32 new tests
- [x] **Step 2 · THE BACKFILL RAN.** 615 Chitral leads imported, 6 forms, 615
      activity rows. Second run: 0 new, 615 updated — idempotency proved on real
      data, not just in the self-check.

### ⚠️ What the backfill found

| | |
|---|---|
| Leads | **615**, all with a name, phone and city |
| Oldest lead | **2026-06-11** — 91 days old. Past Meta's 90-day window; caught with days to spare, and some older ones are likely already gone. |
| Newest | 2026-09-09 |
| Phone numbers normalised | **612 of 615** |
| The 3 that were not | 2 are Meta test leads (`<test lead: dummy data…>`), 1 is a 10-digit number that is not a mobile. All three correctly refused rather than guessed — the raw value is kept. |
| **Duplicate numbers** | 615 leads, **597 distinct numbers** — so ~18 leads share a phone with another. Real people who enquired twice. Worth surfacing in Step 6. |
| ⚠️ Meta test leads | 2 rows are Meta's own test submissions. They are noise in a sales pipeline. Owner's call whether to delete or flag them. |

- [x] **Step 3 · migration 113** — `crm_lead_sync_runs` (a record of every run,
      so a broken import is visible rather than silent), `app.crm_record_sync_run`,
      `app.trigger_crm_lead_sync`, and the pg_cron job **on Supabase**,
      `*/15 * * * *`. Verified: job active, secret present, run rows written.

- [x] **Step 4 · the list screen** — `app/(app)/leads/page.tsx` rewritten from
      scaffold to the real desk, `components/crm/lead-desk.tsx`,
      `lib/domain/crm-stages.ts` (+12 tests), `crmOwnerOptions`, and the counts
      strip. Project dropdown in the Studio's pattern; stage strip doubling as
      the stage filter; filters for temperature, owner, form and date range;
      search across name, raw phone and normalised phone; `tel:` and `wa.me`
      links. **2973 tests green, tsc and eslint clean.**

  ⚠️ **No migration.** Step 4 is a read. A SECURITY DEFINER reader for the
  owner's name was written and then deleted: its own self-check proved it
  redundant, because a Member only ever sees leads assigned to *them*, so the
  join reads their own `users` row and succeeds. The trap this leaves behind is
  recorded at the top of `lib/db/queries/crm-leads.ts` — widening
  `crm_leads_select` to project-wide visibility breaks the join and reintroduces
  the "Former member" bug from 2026-09-08, so that change must restore the reader
  in the same migration.

  ⚠️ **The date filter compares in Karachi, not UTC** — measured, not assumed:
  **109 of 615 leads (18%) have a different UTC date from their Karachi date.**
  A UTC comparison would show the wrong rows for a fifth of the table.

- [x] **Step 5 · the lead record** — `/leads/[id]`, `components/crm/lead-record.tsx`,
      `lib/domain/crm-answers.ts` (+15 tests), `getCrmLead`, and **migration 114**.
      Every answer Meta captured, where the lead came from, the note thread, the
      timeline, and a warning when the same number is on another lead. A route
      rather than a drawer, because Step 7's assignment notification needs a URL
      to point the bell at — and the list's filters travel with the link, so
      "back" returns to page 9 of the filtered list it was opened from.
      **3020 tests green, tsc and eslint clean.** Looked at in a browser, light
      and dark, desktop and 400px.

  ⚠️ **Migration 114, and it is NOT the reader Step 4 deleted.** Step 4's owner
  join is safe because a Member only sees leads assigned to *them*, so the owner
  they read is themselves. A note's author and an activity's actor are somebody
  else by design — an Admin assigns the lead and the `assigned` row's actor is
  that Admin. `users_select` hides them, the join returns NULL, and the screen
  calls a working colleague "Former member". **114's self-check asserts the bug
  is real** rather than assuming it: it fails loudly if a Member can ever read an
  author's name directly, which is the same discipline that got Step 4's reader
  deleted.

  It is unreachable today — `/leads` is Admin-only and an Admin reads the staff
  table fine — but that floor is the narrow start and **Step 7 is what moves it**.
  A safety that holds only because of a floor scheduled to move is a bug with a
  date on it.

  ⚠️ **`crm_leads_select` was deliberately NOT rewritten to share the predicate.**
  The tidy version — the policy calling `app.crm_lead_is_visible` — turns a
  row-local comparison into an index probe on every row of the only query this
  CRM runs at volume. So 114 holds a second copy for the by-id case, and its
  self-check proves the two agree for a coordinator, an assigned member and an
  unassigned member.

- [x] **Step 6 · the desk saves** — `app/actions/crm-leads.ts`,
      `components/crm/lead-actions.tsx`, six mutations in `crm-leads.ts`, and
      **migrations 115 + 116**. Change the stage, mark it hot, set what is owed
      and when, log a call, write a note, mark it lost with a reason from the
      agreed list, and open WhatsApp with a first line already in the box.
      **3034 tests green, tsc and eslint clean.** Looked at in a browser, light
      and dark, desktop and 400px.

  ⚠️ **THE TIMELINE IS WRITTEN BY THE DATABASE, NOT BY THE CALLER.** The obvious
  build is "update the lead, then insert the activity row". It works, and the
  SECOND caller is the one that forgets — a bulk action, a script, a fix run by
  hand — and a timeline with a hole in it looks complete. 116's triggers write
  every derived entry, so a stage change carries its own history whatever
  changed it.

  ⚠️ **AND THE GUARDS ARE THE WHOLE TRICK.** The importer updates all 615 leads
  every fifteen minutes. A trigger that logged "updated" would write **615 rows
  a run, ~59,000 a day**, and bury every row that means something. The
  self-check proves an importer-shaped update writes nothing at all.

  ⚠️ **A session can change exactly five columns.** 111's policy decides which
  ROWS; nothing decided which columns, so an owner could have refiled their lead
  to another project, rewritten the number Meta captured, or backdated
  `first_contacted_at` to flatter their own response time. 116 revokes the blanket
  grant: `stage`, `temperature`, `lost_reason`, `next_action`, `next_action_at`,
  and nothing else. ⚠️ **Step 7 must add `owner_id`** — the trigger that logs an
  assignment is already written and waiting.

  ⚠️ **And a session may only log what a PERSON does.** `crm_lead_activity_insert`
  now names the five contact kinds. Without it, anybody who can see a lead could
  insert a `won` row into an append-only log that nobody can delete, and the
  pipeline reports read that log.

  ⚠️ **Response time is stamped from `occurred_at`, not from the clock.** A call
  logged an hour late happened an hour ago, and `least(...)` means a backdated
  entry can only move first contact EARLIER. "No answer" counts — it measures our
  responsiveness, not the lead's.

- [x] **The org structure** — **migrations 117 + 118**, `ADR-012`. Eight
      departments, `users.department_id` and `users.department_role`, the
      department shown on every team row, and an Admin-only **Move department**
      action that asks for re-authentication. `lib/auth/current-user.ts` gains
      `getCurrentDepartment` and `requireCrmAccess`; the nav gains a department
      dimension. **3047 tests green, tsc and eslint clean.**

  ⚠️ **NEITHER `office_team` NOR `role_title` COULD BE USED, and both looked like
  the answer.** `office_team` is a LOCATION — `blue_area` / `wah` — that
  attendance, compensation and expenses all read as a site. And `role_title` is
  free text: the live rows hold `'SalesMan'`, `'sales manager'` and
  `'sale person'` for one team of three, plus `'Coodinator'` and
  `'Developer Interne'`. An access rule matching on it would have admitted
  whoever spelled their title the way the code expected.

  ⚠️ **RANK CANNOT EXPRESS THIS AT ALL.** `acting_at_least('team_coordinator')`
  is a LADDER — it admits that rank and everything above. Sales staff are
  `member`, the bottom of it, and the desk is their whole job; the Coordinator
  sits above them and has none. So the CRM policies stopped asking about rank.

  ⚠️ **AND THE SALES MANAGER IS STILL `member` IN `users.role`.** ADR-002 fixed
  the app at four ranks and this does not add a fifth. Seniority inside a
  department is a different question from authority over the application.

- [x] **Step 7 · assignment and the staff view** — **migrations 119 + 120 + 121**,
      `assignLeadAction`, `shareOutLeadsAction`, `OwnerControl`, `ShareOutControl`,
      `app.crm_next_owner()`, `app.crm_sales_roster()`, and a `lead_assigned`
      notification. **3056 tests green, tsc and eslint clean.**

  ⚠️ **DISTRIBUTION IS ARITHMETIC, AND AN EARLIER NOTE IN THIS FILE WAS WRONG
  ABOUT IT.** Step 7c was parked as "not yet — needs outcomes". That reasoning
  applies to SCORING ("this lead is 80% likely to close"), not to dividing work.
  Owner: *"one salesperson has 2 leads. Definitely the person who has fewer leads
  will get the lead. Proper intelligence, right?"* — correct. Fewest OPEN leads,
  then whoever waited longest.

  ⚠️ **OPEN, NOT LIFETIME.** Counting every lead somebody has ever held would
  permanently punish whoever closes fastest — they would sit at the bottom of the
  queue for ever while a colleague sat on five untouched ones.

  ⚠️ **ONE `crm_next_owner()` CALL PER LEAD**, not one per batch. Each assignment
  changes the counts the next call reads; reusing one answer would hand the whole
  batch to whoever happened to be lowest at the start.

  ⚠️ **`owner_id` NEEDED A TRIGGER, NOT A GRANT.** PostgreSQL has no per-column
  policy, so a plain grant would have let any salesperson push an awkward lead
  onto a colleague — `crm_leads_update` allows it, because the row is theirs.

- [x] **Step 7b · what the manager sees** — `components/crm/sales-team.tsx`,
      `responseTime()` and `responseBand()` (+8 tests). Who holds what, how many
      closed, how fast they answer, when they were last given a lead. **No
      migration** — `app.crm_sales_roster()` was already written in 120.
      **3070 tests green, tsc and eslint clean.**

  ⚠️ **A TABLE, NOT A CHART.** Three people, four measures. A grouped bar chart
  of that is four colours carrying no meaning. Only workload is genuinely
  compared across people, so only workload gets a bar.

  ⚠️ **"No calls yet", NEVER "0m"** — a null median rendered as zero would say a
  salesperson answers instantly, which is the most flattering possible reading of
  no data at all.

  ⚠️ **NO CONVERSION RATE while nothing is closed.** "0%" for everybody reads as
  a fact about the people and is a fact about the calendar.

- [x] **Step 8 · follow-ups and reminders** — **migrations 122 + 123**, a due
      strip on the desk that also filters, `crmDueCounts`, and two notification
      kinds. **3074 tests green, tsc and eslint clean.**

  ⚠️ **NO HTTP ROUTE.** The lead sync needs one because it calls Meta; this calls
  nothing, so pg_cron invokes the function directly — which removes the
  `CRON_SECRET`, the bearer token, the unread `pg_net` response and, notably,
  **the 404-until-deployed problem** that still affects `crm-lead-sync`. It
  worked the moment 123 landed.

  ⚠️ **HOURLY, BUT ONCE A DAY.** Runs 08:00–19:00 Karachi so one missed firing
  does not cost a day; the once-a-day check is read from the `notifications`
  table rather than a new column, because a second record of what was sent is a
  second thing to get wrong.

  ⚠️ **ONE NOTIFICATION PER PERSON, NOT PER LEAD** — twenty due leads is one
  message saying twenty, not twenty messages.

  ⚠️ **AN IMPORT IS NOT ACTIVITY.** All 615 leads carry an `imported` row;
  counting it would make an untouched lead look freshly worked.

- [x] **Leads route to a department** — **migrations 124 + 125**. A project's
      leads belong to a department, not to Sales. `projects.lead_department_id`,
      six helper functions, eleven policies rewritten, the rota and roster made
      per-project, and the nav's department list replaced with a capability.
      **3076 tests green, tsc and eslint clean.**

  ⚠️ **THIS REPLACES THE RULE MIGRATION 118 WROTE.** 118 put `d.key = 'sales'`
  into eleven policies on the owner's instruction at the time. That was true of
  the only project with leads and stopped being true the moment the division
  advertised its own products — owner, 2026-09-10: *"we are going to start an ERP
  ad campaign and a CRM ad campaign… the system should be smart enough to know
  which campaign these leads are coming from and which project they are from."*

  **Chitral → Sales. The division's own products → AI & Digital, under Kashif.**
  Measured after the refactor: identical to before it. Nobody gained access.

- [x] **Step 9 · clients** — **migration 126**, `/clients`, `crmClients`,
      `ClientList` (+13 tests). Winning a lead makes a client; the same number
      stays one person. **3087 tests green, tsc and eslint clean.**

  ⚠️ **`Won` IS THE CONVERSION, AND I ARGUED THE OWNER OUT OF THEIR FIRST
  ANSWER.** They proposed engagement and invited my view. Engagement would have
  produced hundreds of "clients" who had paid nothing and would have made Step
  12's *"not one closed"* meaningless. Their own 9 Sept answer was better and
  they agreed.

  ⚠️ **THE SAME NUMBER STAYS ONE PERSON.** ~18 of the 615 enquired twice;
  winning a second lead links to the existing client rather than making a twin,
  matched on `phone_e164`. That is what makes the lead-count column possible.

  ⚠️ **REOPENING DOES NOT UNMAKE THEM.** A client is a person who may have notes
  and other leads — deleting them on a stage change would turn a mis-click into
  data loss.

  ⚠️ **A nameless lead still converts.** `crm_clients.full_name` is NOT NULL and
  three of the 615 have no name, so the number stands in — a won lead must not
  fail because Meta's form did not ask.

- [x] **The form decides the project** — **migration 127**. A lead now inherits
      its FORM's project, falling back to the page. `app.crm_refile_form()` lets
      an Admin point a form at a project.

  ⚠️ **URGENT, AND IT ARRIVES TODAY.** Owner, 2026-09-10: *"its three
  campaigns will be live today: ERP campaign, CRM campaign, Taskly campaign…
  smartly link."* All three run on ONE page, and 112 filed leads by PAGE — so
  all three would have landed on one project, with an ERP enquiry
  indistinguishable from somebody asking about Taskly.

  ⚠️ **THE CAMPAIGN CANNOT ANSWER IT** — `campaign_name` is empty on every
  lead (see `06-CAMPAIGNS-AND-COVERAGE.md`). The FORM is the only key Meta gives
  us on every lead, and 112 had already had the foresight not to overwrite a
  form's project on re-import. The hook existed and nothing used it.

  ⚠️ **RE-FILING DOES NOT MOVE LEADS ALREADY IMPORTED** unless asked. That
  would change who can read a stranger's phone number, and is not something a
  fifteen-minute cron should do.

- [x] **Step 10 · reports, stored** — **migration 128**, `/lead-reports`,
      `lib/domain/crm-reports.ts` (+24 tests), and a CSV download that writes the
      FROZEN payload through the existing writers. **3111 tests green, tsc and
      eslint clean.**

  ⚠️ **THE STATED REASON FOR STORING THEM WAS WRONG.** `08-TWELVE-STEPS`
  said it was Meta's 90-day deletion — but we keep the leads, so that has no
  bearing. The real reason: a report is a statement made on a date, and
  re-running it later legitimately gives different numbers.

  **Proved live:** stored an ageing report, won five leads, the live count moved
  615 → 610, and the frozen copy still read 615.

  ⚠️ **APPEND-ONLY FOR EVERYBODY** — no UPDATE, no DELETE, not even Admin.

  ⚠️ **AND NOTHING INVENTS A RATE.** NULL survives from SQL to the screen and
  renders as an em dash in a TEXT cell, so a spreadsheet averaging win rates
  excludes it rather than being dragged down by a zero nobody measured.

### ⚠️ What Step 10 turned up

| | |
|---|---|
| ⚠️ **553 of 615 open leads are over a month old, and NOT ONE has been contacted** | 90% of them; the oldest at 90 days, past Meta's window. The ageing report exists to say this out loud rather than leave it in a migration comment. It also reframes the owner's question: leads arriving and nobody ringing them is a different problem from leads arriving and not converting, and only one of those is the campaign's fault. |
| ⚠️ **A client component imported VALUES from a `server-only` module** | `REPORT_KINDS` and `REPORT_LABEL` were in `lib/db/queries/crm-reports.ts`. That type-checks and **breaks the production build**. `design-tokens.test.ts` guards exactly this and caught it; the vocabulary moved to `lib/domain/`, where doc 20 §1 says it belongs. Types are fine — they are erased. |
| ⚠️ **`react-hooks/purity` refused `Date.now()` in a render** | The default period was computed in the component. A render that reads the clock is not a pure function of its props, so server and browser disagree and React reports a hydration mismatch rather than the clock problem. Computed on the server and passed down — the same lesson `lib/view/relative-age.ts` already documents. |
| **`/lead-reports`, not `/reports/leads`** | `/reports` requires `team_coordinator` and above, and the sales manager is `member` (ADR-012). A nested layout cannot widen a parent's floor — the parent runs first and redirects — so the natural URL would have blocked exactly the person these reports are for. |

### ⚠️ What the campaign work turned up

| | |
|---|---|
| ⚠️ **Three projects do not exist** | The campaigns are ERP, CRM and Taskly. The projects are `Internal CRM`, `Social Media Automation Tool` and `WhatsApp Business API Automation`. **There is no ERP project and no Taskly project**, so two of the three campaigns have nowhere to file to. The owner needs to create them, then re-file each form. |
| ⚠️ **`CREATE OR REPLACE` cannot change a signature** | 127 renamed a return column and dropped two parameter defaults without meaning to. Both are signature changes and PostgreSQL refuses them — the hint says to DROP, which for `crm_record_leads` would leave the only path that writes leads absent if anything later in the file failed. The fix was to match 112's signature exactly, including `forms_written` and both `default '[]'::jsonb`. |
| ⚠️ **The old CNI token may stop working** | Owner: *"some things I have changed definitely will not be working more with the old assets. I will renew that access token."* `META_SYSTEM_USER_TOKEN_CNI` is in the Vault and the importer uses it. When it breaks, `crm_lead_sync_runs.errors` records it and **nobody is told** — Step 8 notifies about leads, not about a broken import. Worth closing. |

### ⚠️ One WhatsApp number PER BUSINESS

Owner, 2026-09-10: *"This WhatsApp business number will just work for the one
app… Chitral Royal Homes will have a different WhatsApp business number. In the
same way every business has a different business number, right? The lead belongs
to the number that belongs to the project."*

⚠️ **So the WhatsApp config is per project, in the DATABASE** — one row each,
the same shape as `meta_accounts` — and **not** a global
`WHATSAPP_PHONE_NUMBER_ID` env var. The setup brief was written with a single
global number and has been corrected; the webhook stays shared, because each
event names the number it arrived on.

### ⚠️ What Step 9 turned up

| | |
|---|---|
| **`/clients`, not `/leads/clients`** | A static segment beside `/leads/[id]` resolves — but it makes a lead whose id was the string "clients" unreachable, and means anybody reading the tree has to know Next's precedence rule. Its own route costs nothing. |
| **The pinned nav fixture earned its keep** | Adding the route failed `nav-active.test.ts` immediately, exactly as its own comment promised it would. |
| ⚠️ **A loose test needle, for the fourth step running** | `%` matches the page header's own CSS lengths, so "prints no percentage" failed against a page with none. Before that: `>Won<` matched a stage chip, `Overdue` matched a table cell, and `>wrong_number<` matched a form value. The habit to fix is asserting on markup where the intent is about what a reader sees. |

### ⚠️ What the routing change turned up

| | |
|---|---|
| ⚠️ **`type = 'tool'` projects were EXCLUDED from the desk** | My own comment read *"a product has no leads and never will"* — reasonable when every campaign was a client's. `Internal CRM`, `Social Media Automation Tool` and `WhatsApp Business API Automation` are all `type = 'tool'`, and the owner is about to advertise two of them. Those leads would have imported and then been **invisible**. |
| ⚠️ **The sales team saw 0 projects in the dropdown** | `projects_select` is `app.project_is_visible(id)`, which needs project MEMBERSHIP — and a salesperson is not a member of Chitral. So the desk would have said *"No projects are visible to you yet"* above **615 readable leads**. Migration 125 is a definer reader; **the third time this exact shape has appeared** after 105 and 121. |
| **A migration cannot drop a function a policy uses** | And `DROP … CASCADE`, which the error suggests, would take the policies with it and leave the tables open if anything later in the file failed. Every dependent policy is dropped explicitly, in the same transaction that puts it back. |
| **My verification query read through RLS** | 124's self-check confirmed the rota's pick by joining `users` while still acting as the sales manager — who sees one row of that table. It failed against a rota that was correct. Reading a team through RLS while acting as somebody who cannot see the team proves nothing. |

### ⚠️ What Step 8 turned up

| | |
|---|---|
| **A test needle matched the table, not the chip** | Third time in three steps: `Overdue` also appears in a lead ROW as "Overdue · 8 Sept", so the cases asserting the strip was absent failed against a correct screen. `>Overdue</span>` is the needle. Same shape as `>Won<` in 7b and `%` matching bar widths. |
| **`app/api/digest/route.ts` carries a stale claim** | Its header says *"There is no cron in this application and adding one would mean a long-running process to own it."* Untrue since migration 102. Left alone — it sends email and its schedule is somebody else's decision — but noted in 123's header where a reader will find it. |

### ⚠️ What Step 7b turned up

| | |
|---|---|
| ⚠️ **`feedback-success` fails as ink — 3.77:1 in light** | I wrote the "answers fast" figure in it and measured it afterwards. Passing in dark (8.40), which is why review would not catch it. It is the `chart-tokens-fail-as-text` trap again: those hues are FILLS. The **`money-*`** family exists precisely for coloured figures — measured `money-in` 5.48/8.40 and `money-out` 6.47/5.84, and both are now used instead. |
| **A zero should draw no bar** | The bar had a 2px minimum width, so the manager holding nothing showed a stub — which reads as a small quantity rather than none. |
| **`>Won<` also matches a stage chip** | A test asserting the Won column was absent failed against a panel that was correct: "Won" is a legitimate stage in the strip above. `>Won</th>` is the needle. `%` alone matched the bar widths too. |

### ⚠️ What Step 7 turned up

| | |
|---|---|
| ⚠️ **The 2026-09-08 bug came back, and was caught before it shipped** | The sales manager is `member` in `users.role`, so `users_select` shows them ONE row of the staff table — their own. The lead list read the owner's name with a plain join, so **every colleague would have rendered as "Former member"** on the one screen the manager opens to see who holds what. Measured under their own session, then fixed by migration 121; its self-check asserts the bug so the reader can be deleted if `users_select` ever widens. 114's header predicted this exact moment. |
| **`now()` is transaction start time** | 120's first self-check assigned to A then B and asserted A had "waited longer". Both rows shared one timestamp to the microsecond, the ordering fell through to `full_name`, and the check failed against a function that was correct. ⚠️ Not a production problem: a bulk share-out stamps identically too, but the OPEN COUNT changes as each lead lands, so the tie-break is never reached inside a batch. |

### ⚠️ The rota, measured on live data

Run against the three real sales accounts, then rolled back:

| Starting position | 4 new leads arrive | Result |
|---|---|---|
| Sale Tester **2**, Sale 2 tester **0** | 1 → Sale Tester, **3 → Sale 2 tester** | level at 3 each |
| both level | ten leads | **5 and 5** |
| the sales manager | — | **0 in both runs** — they run the rota |

It corrects an imbalance first rather than simply alternating.

### ⚠️ Who can see the CRM now — measured, not asserted

Every active person, under their own session, counting `crm_leads`:

| | |
|---|---|
| Umm-e-Habiba · admin · Management | **615** |
| Ammar Afzal Khan · super_admin · Management | **615** |
| **sale manager tester** · member · Sales **(manager)** | **615** |
| Sale Tester · member · Sales | 0 — nothing assigned yet (Step 7) |
| Sale 2 tester · member · Sales | 0 — nothing assigned yet (Step 7) |
| **Kashif Ayaz · team_coordinator · AI & Digital (manager)** | **0** ⚠️ this is the change |
| The other 7 in AI & Digital | 0 |
| Junaid Ahmad, Lararib Rafique · Development | 0 |

### ⚠️ What Step 6 turned up

| | |
|---|---|
| **An RLS refusal is `42501`, not `23514`** | 116's own self-check caught its forged-`won` insert with `when check_violation`, the real error escaped, and a migration whose policy was working perfectly failed. A policy's WITH CHECK and a CHECK constraint read almost the same in English and are different SQLSTATEs. |
| **Every failure message was read off the database first** | Measured as `cni_app` under a real session: an UPDATE on a lead you cannot see returns **0 rows and never throws**; an INSERT on one **throws 42501**. So an update returns a boolean and an insert is wrapped. Assuming both behaved alike would have produced a screen that said "saved" when nothing was. |
| ⚠️ **"Due" dates failed contrast, and had never rendered** | `text-tertiary` at 3.94:1 against a 4.5 floor, on both the record and the desk — invisible until Step 6 because **no lead had ever had a next action**. The same shape as the four badges Step 5 found. Both fixed. |

### ⚠️ What Step 5 turned up

| | |
|---|---|
| **jsonb loses the form's question order** | `answers` is jsonb, and jsonb sorts keys by length then bytewise. Meta's original sequence was gone at INSERT. Any code written to "show the answers in the order they were asked" would look correct and be wrong; the order is ours and chosen — what they asked for first, contact details last. |
| ⚠️ **Four badges failed WCAG in light and nobody could have seen it** | `follow_up` 4.35:1, `visited` 3.32:1, `scheduled` 3.72:1, `warm` 3.72:1 — all against a 4.5:1 floor, and **all fine in dark**, which is why review passes. And **every one of the 615 leads is `new`, so no other badge has ever rendered on a screen.** They would have appeared for the first time the day somebody moved a lead in Step 6, on a page already signed off. Replaced with measured tokens in `lib/domain/crm-stages.ts`; all 24 badges now pass in both themes. |
| `chart-3` was the same green as `won` | The old `follow_up` token was 161°, identical to `feedback-success` — a funnel whose third chip matched its last. Fixed by the same change. |
| **~18 leads share a number** | 615 leads, 597 distinct numbers. The record now says so and links across, so two salespeople do not ring the same person. ⚠️ It renders only when it finds something: a sales member sees only the sibling leads assigned to *them*, so a printed count would be a number the page cannot stand behind. |

### ⚠️ The cron 404s until this branch is deployed

Fired the trigger by hand: request accepted, response **404**. The job calls
`https://taskly.aidigitaldivision.com/api/crm/lead-sync`, and that route exists
only on the `crm` branch — production is still on `main`.

**This is not a fault and needs no fix.** It starts working by itself the moment
the branch is merged and deployed, which is why the job was left ACTIVE rather
than disabled: an active job that heals itself beats a disabled one somebody has
to remember to switch on. Until then it is 96 harmless 404s a day.

⚠️ **Do not read an empty `crm_lead_sync_runs` as "the import is broken" before
the merge.** Nothing is recorded because nothing reaches the route.

## Blocked — on the owner, in Meta rather than in code

- [ ] **Three pages running live lead campaigns are unreadable.** The Executive
      Housing (302982680199394), AGC Construction (1145446828660442) and
      Investo 21 (107426385582365) are in no portfolio our system user can reach.
      Their leads are accumulating where we cannot see them, and the 90-day clock
      is running on them. See `06-CAMPAIGNS-AND-COVERAGE.md`.
- [ ] **`campaign_name` on a lead is empty** because the page and the ad account
      that runs its campaign sit in different portfolios. One permission change in
      Meta removes a whole subsystem — see the same file.
- [ ] **Which project does each of the 6 campaigns belong to?** The names already
      read like project names, so this is a five-minute confirmation.

## Next — the build order is now `08-TWELVE-STEPS.md`

**Scope narrowed by the owner 2026-09-10:** *"first start working on Chitral
Royal Homes. First make them live and mention that for other projects whose leads
you can't read, it's coming soon or not connected."*

Steps 1–3 (tables, Chitral importer + backfill, schedule) need **nothing from the
owner** and can start on their word. Everything else is sequenced in that file
with its dependencies named.

---

## ⚠️ The deadline nobody set for us

**Meta deletes lead data 90 days after submission.**

- Today: 2026-09-09
- The 553-lead form's newest lead: **2026-07-28** (43 days old)
- Its oldest leads are materially older and some may already be gone

Every day without an importer costs leads permanently. This is the reason Phase 1
is "capture", not "design".

---

## Decisions log

Answers to open questions get recorded here with the date, so a later session can
see not just what was decided but when and why.

| Date | Question | Answer |
|---|---|---|
| 2026-09-09 | Q1 Where to start | **Chitral first.** AI & Digital's ad account is being created by the owner's ads person — "we will work on that tomorrow". All projects appear in a dropdown, the same pattern as the Studio. |
| 2026-09-09 | Q2 Who reads a lead | **Admin and Super Admin: all.** **Team Coordinator: yes, included.** **Sales staff: the leads assigned to them**, with the full record — name, phone, project, everything relevant. |
| 2026-09-09 | Q3 Project link | **Yes, every lead belongs to a project.** Plus a **campaign column** on the table, and campaign filters, so "which campaign produced this lead" is answerable per project. |
| 2026-09-09 | Q4 Stages | New · Contacted · Follow-up · Qualified · Visited · Scheduled · Negotiation · Won · Lost. Lost reasons start: wrong number, not serious, budget not enough — owner wants more suggested. |
| 2026-09-09 | Q5 Roles | **Existing four roles, no new rank.** CRM access = Admin, Super Admin, Team Coordinator, plus **project members marked as sales team**. Developers, content creators and campaign staff are excluded. |
| 2026-09-09 | Q7 Client vs lead | **Two things.** A lead is an enquiry. It becomes a **client** when they engage — accept a quotation, or work starts. One client can have many leads. |
| 2026-09-09 | Q10 Testing account | One staff member added to the **sales team**; all leads assigned to them to exercise the staff view. |
| 2026-09-09 | Storage | ⚠️ **Database-first, always.** Leads and reports are stored in our database and every screen reads from there — never live from Meta. Same rule the Studio already follows. |
| 2026-09-09 | Q9 Smart dashboard | Owner has an OpenAI key and wants deep intelligence: per-lead coaching, campaign-vs-staff diagnosis, recording of calls/chats/notes. See `07-AI-PLAN.md`. |
| 2026-09-10 | Scope | **Chitral Royal Homes only, first.** Other projects show "Not connected" with a reason. Owner has PAGE access to Executive Housing / AGC Construction / Investo 21 but **not their business portfolios** — will confirm when that lands. |
| 2026-09-10 | Build order | Twelve steps, four modules — `08-TWELVE-STEPS.md`. |
| 2026-09-10 | Database | Growth, indexes, backups and retention written up in `09-DATABASE-MANAGEMENT.md`. Storage is not the constraint; ~5 KB per fully worked lead. |
| 2026-09-10 | Column order | **Lead name first, then next action.** Step 4 originally listed next action first, following the PropForce reference. The name is what the eye goes to when finding a specific caller; the **sort** — unchanged, next action first — is what makes this a list you work from, not the column position. |
| 2026-09-10 | Campaign column | **Labelled "Came from", showing the form.** No lead carries a campaign yet (`crm_campaigns` is empty), so a column headed "Campaign" would print a word the data underneath does not support. It shows the campaign the moment Step 8 links them. |
| 2026-09-10 | Paging | **Paged in SQL, 25 a page**, against this app's usual client-side `usePagination`. 615 rows and growing every fifteen minutes; payload size is where this application's slowness has actually been. |
| 2026-09-10 | Page access | **Still Admin and above**, unchanged. Migration 111's policies already describe the wider rule, but the door stays where it is until assignment exists in Step 6 — widening it now would hand 615 phone numbers to people with no lead to work. |
| 2026-09-10 | ⚠️ **Scope, confirmed** | **One project: Chitral Royal Homes.** Build the whole CRM for it end to end — capture, desk, follow-through, intelligence — before any second project. Owner: *"I'm not saying that you carry 2 or 3 projects at a time, their leads at a time, and every stuff at a time."* |
| 2026-09-10 | ⚠️ **Who sees the CRM — SUPERSEDES Q2** | **Admin, Super Admin, and the Sales department.** Owner: *"That was the team coordinator, not the sales manager… the team coordinator will be part of a digital creator team. He will manage their tasks… But for the salespersons or for the management of the lead, all this CRM belongs to the sales manager and the salespersons. Plus admin and super admin are by default added."* Migration 118. The 2026-09-09 answer admitting the Coordinator no longer holds. |
| 2026-09-10 | Sales manager vs salesperson | **Manager sees every lead and who holds it, and can move a lead between salespeople.** A salesperson sees only their own. Owner also asked for automatic, AI-assisted distribution and for the manager to see response times and quotations — Steps 7, 11 and 12. |
| 2026-09-10 | Departments | **Eight**, as a table rather than an enum — Management, AI & Digital, Development, Sales, Finance & Accounts, HR & People, Operations, Support. Owner asked for *"those five plus HR, Operations and Support"*. See ADR-012. |
| 2026-09-10 | Reports are frozen, not cached | Computed once, stored whole, never refreshed. The reason is not Meta's deletion (we keep the leads) but that a report is a statement made on a date. Append-only for every rank. |
| 2026-09-10 | ⚠️ **One WhatsApp number per business** | Chitral has its own, AI & Digital has its own, every client business has its own. Config lives per project in the database, not in the environment. The webhook is shared. |
| 2026-09-10 | Campaign → project, by FORM | `campaign_name` is empty on every lead, so the form is the key. Migration 127; an Admin re-files a form with `app.crm_refile_form()`. |
| 2026-09-10 | ⚠️ **Live today: ERP, CRM and Taskly campaigns** | On the AI & Digital page, routing to Kashif's department. ⚠️ Two of the three have no project to file to yet. |
| 2026-09-10 | ⚠️ **Leads route by DEPARTMENT — supersedes 118** | **Chitral → Sales. ERP, CRM and automation → AI & Digital, under Kashif.** Owner: *"the Chitral lead will definitely be sent to the sales team… this is the CRM and automation lead so this will be handled by the developer team"*, then chose *"AI & Digital owns them, under Kashif"* over splitting by campaign. Migration 124. |
| 2026-09-10 | ⚠️ **Q17 — what makes a client** | **Reaching `Won`.** The owner proposed engagement and asked for my view; I argued engagement is too early — it would produce hundreds of "clients" who have paid nothing and would make Step 12's *"not one closed"* meaningless. Their own 9 Sept answer (*"accept a quotation, or work starts"*) was better, and `Won` IS that moment. "They engaged" is the `qualified` stage, which already exists. |
| 2026-09-10 | Q16 — client scope | **One project**, as the owner said. Nothing is lost: `crm_leads.client_id` still allows one person to hold leads across several projects. |
| 2026-09-10 | No campaign-level routing | Offered and declined in favour of department-owns-project. `crm_campaigns` is also still empty. One routing rule rather than two that can disagree. |
| 2026-09-10 | Neglect threshold | **5 days**, as a function parameter rather than a constant — it is a judgement, not a measurement, and there is not one closed lead to derive it from. Changeable in the cron schedule without a migration. |
| 2026-09-10 | ⚠️ **Automatic distribution — an earlier refusal reversed** | **Built, in Step 7.** It was parked as needing outcomes; that is true of SCORING and not of dividing work. Owner: *"I think it's not as difficult as you are expecting… the person who has fewer leads will get the lead."* Fewest OPEN leads, then whoever waited longest. |
| 2026-09-10 | The tie-break | **Whoever went longest without a lead**, decided by me at the owner's invitation — *"You can decide to whom it will give it, right?"* Fair, predictable, and checkable from a person's own timeline. Response time replaces it once there are calls logged. |
| 2026-09-10 | Who may hand out a lead | **The sales manager and an Admin.** A salesperson cannot push a lead onto a colleague — migration 120's trigger. |
| 2026-09-10 | A third sales tester | Owner added **Sale 2 tester** so assignment between two salespeople can be exercised: *"I definitely need one more sales tester… so you can implement all these things in a proper intelligent way."* |
| 2026-09-10 | Schema stays multi-project | ⚠️ The TABLES keep `project_id` even though only one project is used. Hardcoding one project would make "later on I will do the same thing for the other projects" a rewrite instead of a row. Costs nothing now; saves the whole second build. |
| 2026-09-12 | ⚠️ **Deploy, not a fix** | The importer's 404 was never a fault. Production served `main`; the CRM lived on `crm` and had never been released. Merged and deployed; the next cron run imported the 8 stranded leads by itself. |
| 2026-09-12 | ⚠️ **Q18 — personal data and the AI. ANSWERED: SEND IT** | Owner: *"I said: add name and number. No problem with that."* Names and phone numbers go to OpenAI with the rest of the record. ⚠️ **I recorded the opposite for one day** — read a sentence break wrongly — and it is corrected rather than overwritten. The implications were put to the owner (it leaves our servers; Chitral's leads are a *client's* data) and the owner decided. ⚠️ **This does NOT settle Tier C** — letting the AI read WhatsApp conversations sends far more than a name, and gets asked separately. |
| 2026-09-12 | ⚠️ **Q19/7c — specialisation. DEFERRED, NOT CLOSED** | Owner: *"Definitely I will ask the salespersons what their specialties are… Right now I don't know because I'm not a salesperson."* There is no field today and there will be one later, filled from what the **sales manager** actually says. ⚠️ **Do not invent it meanwhile** — owner: *"Please don't do that."* The router in `10-LEAD-ASSIGNMENT.md` needs none of it, so nothing waits on this. Questions to ask are listed in `05-OPEN-QUESTIONS.md`. |
| 2026-09-12 | **Lead reports are the manager's** | Owner: *"lead reports will not be seen by the salesperson… the sales manager should see it. Also admin/super admin by default will see everything."* `crmReportsOpenTo()` — Admin, Super Admin, or the **manager** of a department the leads route to. Keyed off `department_role`, never `users.role`. |
| 2026-09-12 | ⏳ **The sales manager's rank — OPEN, owner will decide** | They asked to raise them to `team_coordinator`; that rank also unlocks **Finance — invoices, payments, expenses, payroll** — plus Workload and the company's Reports. The narrow grant they wanted (lead reports) was delivered through `department_role` instead, so nothing is blocked. Owner: *"I will know about that."* ⚠️ Revisit after the team restructuring, when it is clear what a sales manager here actually does. |
| 2026-09-12 | **Test on our own business, never a client's** | Owner: *"Chitral Royal Homes or any other project is my client. I can't use their data for testing purposes. I will use my own."* The demo project, its 18 leads and the test form all exist for this. **Client data is captured and kept; it is never the material we experiment on.** |
| 2026-09-12 | ⚠️ **Dummy leads are unmessageable by construction** | 16 of 18 carry `(demo — no number)`, which normalises to NULL, and both screens gate the call and WhatsApp buttons on `phone_e164`. A plausible-looking invented Pakistani number belongs to a real stranger who would receive the first test message. |
| 2026-09-12 | **Meta Cloud API direct, not a BSP** | Twilio and 360dialog were considered. The committed webhook verifies `X-Hub-Signature-256`; a BSP uses its own scheme and its own send API, so going through one is a rewrite plus a permanent per-message markup. |
| 2026-09-12 | ⚠️ **Coexistence is NOT available for our own number** | Meta's own documentation: *"You must already be a Solution Partner or Tech Provider"* and *"this feature applies to business customers only — not your own organization."* ⚠️ **And it would undermine the goal anyway:** replies sent from a shared handset arrive as echoes with no way to tell WHICH salesperson sent them, which destroys per-person response time — the measurement this CRM exists for. |
| 2026-09-12 | **Meta's free test number first** | Proves the whole flow without deleting the business number from WhatsApp — the one irreversible step. ⚠️ Blocked: Meta refuses to add a test recipient until business verification clears (~12 days from 2026-09-12). |
| 2026-09-12 | ⚠️ **PAUSED for team restructuring** | Owner: *"Right now just one team, the AI and Digital team, is implemented. No finance team, no sales team, no HR team… Then I will come back to this CRM and maybe it will be easier for me to tell you which things I will assign to which."* **The right order** — every open question here is a question about people. Next work on a `team-restructuring` branch, merged to `main` before the CRM resumes. |

---

## Facts that will go stale

Re-verify rather than trust, after roughly 2026-10-09:

- Lead counts per form (they change daily)
- Which forms are ACTIVE
- Whether AI & Digital has been given an ad account since
- Whether `leads_retrieval` is granted via App Review or only working because the
  caller is an asset admin

The exact calls to re-run are at the foot of `01-VERIFIED-FACTS.md`.

---

## How to resume cold

1. **Read this file top to bottom**, especially the 2026-09-12 section. Five
   access bugs were found in one afternoon by logging in as somebody who was not
   an Admin, and nothing else in this documentation would have predicted them.
2. **Check whether the team restructuring has landed.** The CRM is paused for
   it, and it is the input several open questions are waiting on. Its branch
   merges to `main` before this work resumes.
3. **Check whether Meta business verification has cleared** (~12 days from
   2026-09-12). Only WhatsApp sending depends on it; nothing else does.
4. **`10-LEAD-ASSIGNMENT.md` is the next build**, and it needs nothing from
   anybody — four signals, no AI, no new credentials, no closed leads.
5. `08-TWELVE-STEPS.md` holds the overall order. `04-PHASES.md` is superseded
   and kept only for the reasoning behind it.

### ⚠️ The one habit this project has had to learn five times

**A screen signed off from an Admin session has not been tested.** An Admin is a
member of nothing and sees everything, so every predicate that turns on
membership or department silently passes for them. Migrations 105, 121, 125,
129 and 130 are all the same bug on five different tables, and every one of
them was found by a real person logging in as themselves.

Before calling anything done: open it as a salesperson, as their manager, and as
somebody in a department that should see nothing.
