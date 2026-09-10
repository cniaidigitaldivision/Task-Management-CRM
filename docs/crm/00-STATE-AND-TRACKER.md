# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | `crm` (from `main` at `0726704`) |
| **Route** | `/leads` · nav: Growth → Campaign & Lead Desk |
| **Phase** | **Steps 1–7b DONE.** The desk saves, the CRM belongs to the **Sales department**, and leads are handed out — by hand or shared across the team automatically. Step 7b (what the manager sees) is next and needs nothing. |
| **Scope** | ⚠️ **Chitral Royal Homes only.** One project, end to end. |
| **Last updated** | 2026-09-10 |
| **Last migration applied anywhere** | **121.** CRM next: 122. Step 7b needed **no** migration — `crm_sales_roster()` already existed. |

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
a **sales team panel** showing who is carrying what and how fast they answer.

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
| 2026-09-10 | ⚠️ **Automatic distribution — an earlier refusal reversed** | **Built, in Step 7.** It was parked as needing outcomes; that is true of SCORING and not of dividing work. Owner: *"I think it's not as difficult as you are expecting… the person who has fewer leads will get the lead."* Fewest OPEN leads, then whoever waited longest. |
| 2026-09-10 | The tie-break | **Whoever went longest without a lead**, decided by me at the owner's invitation — *"You can decide to whom it will give it, right?"* Fair, predictable, and checkable from a person's own timeline. Response time replaces it once there are calls logged. |
| 2026-09-10 | Who may hand out a lead | **The sales manager and an Admin.** A salesperson cannot push a lead onto a colleague — migration 120's trigger. |
| 2026-09-10 | A third sales tester | Owner added **Sale 2 tester** so assignment between two salespeople can be exercised: *"I definitely need one more sales tester… so you can implement all these things in a proper intelligent way."* |
| 2026-09-10 | Schema stays multi-project | ⚠️ The TABLES keep `project_id` even though only one project is used. Hardcoding one project would make "later on I will do the same thing for the other projects" a rewrite instead of a row. Costs nothing now; saves the whole second build. |

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

1. Read this file.
2. Read `01-VERIFIED-FACTS.md` — what is true, and what was never checked.
3. Check the decisions log above. If Q1–Q5 are still unanswered, the job is to
   get them answered, not to start building.
4. `04-PHASES.md` has the order of work and the reason for that order.
