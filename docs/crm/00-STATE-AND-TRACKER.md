# State & tracker

**Read this first.** It is the only file here that changes every session.

| | |
|---|---|
| **Branch** | ⚠️ **`main`.** The CRM was merged and deployed 2026-09-12; `crm` still exists but is behind. |
| **Route** | `/leads` · `/my-leads` · `/clients` · `/lead-reports` · `/lead-overview` · nav: Growth → Campaign & Lead Desk |
| **Phase** | 🔒 **PREVIEW — Sales Workspace phases A–E done, F next.** The build order is `14-SALES-WORKSPACE-PHASES.md`. The CRM is visible ONLY to Sarah, Sahad and the sales manager, plus admin/super_admin (migration 143), until the owner says otherwise. |
| **Scope** | Chitral Royal Homes (real, 641 leads) + the demo project (21 leads, WhatsApp wired). ⚠️ Everything is built and demonstrated on **Demo — Product Enquiries [demo]**. |
| **Last updated** | **2026-09-16** |
| **Last migration applied anywhere** | **179** (verified against the live database, not remembered). CRM next: **180.** |

---

## 💬 2026-09-17 — THE CONVERSATION TAB, AND WHO A REPLY COMES FROM · 179

Built to the owner's second reference. One thread carrying both channels, a
banner when a reply has paused the chase, and a composer that names the number it
would send from.

### Migration 179 · the composer could not say who it was

⚠️ **`projects.whatsapp_phone_number_id` IS META'S INTERNAL ID** — a 15-digit
opaque string, not a phone number. There was nothing in this database that could
print *"CNI AI & Digital · +92 300 123 8726"* above a reply box, which is what
stops somebody sending a client's message from the wrong business.

`crm_project_settings` gains `whatsapp_display_name` and
`whatsapp_display_number` (E.164, CHECKed), and `app.crm_project_sender()`
answers both. ⚠️ **Configuration, never access** — 172 exists because
`crm_project_can_whatsapp` bundles the two and returns false from a sessionless
caller. Readiness gained `no_sender_number`, ⚠️ **raised only where sending
actually works**: nagging about a display number on a project that cannot send at
all is noise on top of the real problem.

### What the tab does

| | |
|---|---|
| **All · WhatsApp · Email** | Client-state filter over rows already on the page (law 3) |
| **The pause banner** | Fires from 170's own `pause_reason`, not a sentence written in the component — two explanations of one pause start disagreeing |
| **Email entries** | Subject, preview, and the attachment as a card |
| **WhatsApp bubbles** | ⚠️ Tinted by WHO SPOKE, not by channel — green is ours, plain is theirs, the convention every client already knows |
| **Ticks** | ⚠️ Ours only. An inbound message has no delivery state we own, and drawing one would be inventing a receipt |
| **A failure** | Shown on the message, not in a toast that has gone — *"did it send?"* is asked days later |

⚠️ **THE SORT LABEL NOW MATCHES THE ORDER.** The reference reads *"Newest
first"* above a thread running oldest to newest. A conversation is read
downwards, so the default is oldest-first and the control says so.

⚠️ **AND WHERE A PROJECT CANNOT SEND, IT SAYS WHICH THING IS MISSING** rather
than greying a box out. Chitral is in exactly that state: 641 real leads and no
number.

### The header and the four figures

Avatar, Active pill, the unit line, the unit kind and temperature as chips, and
call · WhatsApp · email · full record · close as round buttons. ⚠️ **Each control
is absent when it cannot work, never disabled** — 640 of 641 leads have no email,
so a greyed envelope would be the normal state rather than the exception.

Stage · Quotation · Value · Next follow-up. ⚠️ **The quotation shown is the LIVE
one, not the newest row** — a superseded v1 still exists (176), and printing its
figure would show a price nobody is offering to the person about to repeat it on
the phone.

⚠️ **THE SENDER RIDES ON `crmLeadRelated`, NOT ITS OWN FETCH.** It needs the
LEAD's project, which is not known until the lead is read — so a separate call
would have been a second wave waiting on the first. `tsc` caught it as
*"`record` used before its declaration"*, which is law 4 refusing to compile.

---

## 🎨 2026-09-17 — THE DRAWER'S OVERVIEW, REBUILT TO THE OWNER'S REFERENCE

A lifecycle strip, Lead details and a Qualification card on the left, Next action ·
Personal note · Recent activity on the right, and three actions fixed to the foot.
Moved out of `lead-drawer.tsx` into `lead-overview-tab.tsx` — it was the largest
thing in that file and it is the tab that will keep changing.

### ⚠️ THE STANDING RULE THE OWNER GAVE WITH IT

> *"I'm sharing with you a design idea for the UI. You have to implement it
> logically according to our data structure, our life cycles, and our flow. You
> will keep these things in mind. I will just show you UI things."*

**Take the LAYOUT from the screenshot, the CONTENT from the schema.** And ⚠️ **do
not stop to ask which** — I paused twice, on a 7-vs-10 stage strip and on a masked
phone number, and the reply was *"you did not implement the UI"*. Decide, build,
flag the deviation afterwards. Saved as `screenshots-are-ideas-not-specs`.

### The lifecycle, settled by the owner

> *"New · Contacted · Qualified · **Proposal sent** · **Quotation sent** · if it's
> real estate then definitely: Visit · Negotiation."* … *"One step you have missed
> is the quotation."*

⚠️ **PROPOSAL AND QUOTATION ARE TWO STEPS.** They were collapsed into one on the
first attempt and the owner caught it. They are different moments — a proposal
says what we would do, a quotation says what it costs — and a lead sitting between
them is in the commonest place a deal goes quiet.

⚠️ **AND VISIT IS REAL ESTATE ONLY.** Nobody visits a site to buy an ERP. The
strip reads `app.crm_lead_sells` (174): **8 steps for property, 7 for a service.**
⚠️ `lost` is absent on purpose — an exit, not a step. A funnel that draws losing
as progress is one that rewards it.

### Deviations from the picture, each deliberate

| | |
|---|---|
| **The phone is shown in full**, not masked | Hiding a number from the person whose job is to ring it is friction with no security behind it — RLS decides who sees the lead at all, and the desk behind the drawer prints it in full. Copy button kept |
| **The drawer widened to 46rem** | Two columns inside 36rem gave each about 250px, which wrapped every label |
| **Qualification is its own card** | Owner: *"remove the qualification things… add that it is qualified with the exact answers."* Four question-shaped rows among eight fact-shaped ones made the list read as a form. Now one line of chips — **T Within a month · N To build and live in · B 40–60 lakh · A Decides alone** — with ✓ Qualified and an Edit that opens the full form |
| **`budget` and `budget_band` are both shown, in different places** | They are different columns: what they said they would spend, and which bracket it falls in. Neither is printed twice |

### ⚠️ Three faults only looking at it could have found

1. **`bg-feedback-success` rendered as nothing** — three completed steps with no
   green circle at all. The token exists; Tailwind only emits a class it has
   SEEN, and the stylesheet snapshot predated the file. Now filled with inline
   CSS vars, the way `calendar-view` fills its status dots.
2. **`lg:grid-cols-2` inside a 736px drawer can never fire** — the two columns
   the reference draws would simply never have appeared. `sm:` now.
3. **`sm:col-span-2` on the Qualification card broke the grid** — it forced its
   own row and pushed the entire right-hand column beneath it, silently turning
   two columns into one. The left column is one child now.

⚠️ **AND THE SCREENSHOT HARNESS LIES ABOUT NEW CLASSES.** The dev server's
stylesheet is only as current as its last compile of the file being shot. Hit the
route first, then re-fetch the CSS, or a brand-new utility reads as a broken
style. Cost two wrong readings today.

---

## 📎 2026-09-17 — SOMEWHERE TO PUT THE LETTERHEAD · migration 178

The owner asked twice — *"give me some place where I can see all the documents
this project has"*, then *"you didn't provide me a place where I can upload
these documents"*. Fair: the letterhead had been the top blocking item on all 18
projects for a day with nowhere to put one.

**Where it lives:** ⚠️ **a tab on `/documents`, not a page of its own** — the
owner's instruction: *"add that tab and that will only be visible to salespersons
only."* Gated on `crmIsOpenTo()`, the same capability that opens the lead desk,
**not** on rank — the people whose job this is are `member`, the bottom of
Taskly's ladder.

⚠️ **THIS IS THE CRM'S SECOND FOOT OUTSIDE ITSELF, AND IT IS DELIBERATE.**
`16-EXTRACTING-THE-CRM.md` rule 2 says nothing outside the CRM may import from
inside it, and until today exactly one file did (`api/pulse`). Now two. It is one
import, one tab entry and three props in `documents-workspace.tsx` — a known,
deletable line rather than a thread somebody finds later. The coupling check in
that file now returns it, which is the check working.

**No new bucket.** The existing one already allows PDF, PNG, JPEG and SVG, already
has signed URLs, already has its mime allowlist. CRM files go under a `crm/`
prefix so they stay identifiable when the module is lifted.

| Rule | Why |
|---|---|
| **One letterhead per project** | A unique index. Two means the PDF generator picks one and the owner watches a corrected letterhead fail to take effect |
| **A lead's document follows the lead** | The policy asks `crm_leads` itself, under the caller — so this file never restates the membership rule and gets it wrong for the tenth time |
| **Delete is admin-only** | A signed booking form removed by accident is not recoverable. The same append-only stance `crm_lead_activity` takes |
| **The upload maintains the pointer** | `letterhead_path` is what the PDF generator and readiness read. One place to upload, one pointer — rather than asking the owner to do both and watching them disagree |
| **Recorded only after the bytes land** | A row written first lists a document that 404s, and the first one anybody clicks is the letterhead |

⚠️ **A TEST CAUGHT A REAL BUG WHILE BUILDING IT.** The upload form is a client
component and it imported `DOCUMENT_KINDS` and `documentKindLabel` from a
`server-only` query module — which drags server code into the browser bundle.
`design-tokens.test.ts` asserts exactly this and failed immediately. The
vocabulary now lives in `lib/domain/crm-documents.ts` with every other pure list
in this codebase.

**The shelf leads with what is MISSING** — *"N projects still have no
letterhead"*, naming them — because a list of what IS there would not have told
the owner what to do next.

---

## 💱 2026-09-17 — ONE SERVICE, SEVERAL PRICE LADDERS · 176, 177

**176 · the ladder exists.** `number`, `version` and `supersedes_id` have been on
`crm_quotations` since 151 and **every quotation ever raised was version 1 with a
brand new number** — 2 rows, 0 above v1, 0 chains. QT-1044, not QT-1042 v2. The
history the versioning rule depends on was never being written. ⚠️ **And the
unique (number, version) pair the test pack promised was not on the table** — a
documented invariant nothing enforces is a documented hope.

Now: one live version per number, a chain that must be a chain (same number, same
lead, consecutive versions), and **the old version retires inside the same
statement** so two live prices for one client are impossible by construction.
`app.crm_next_rung` reads the item's own 2 lakh / 1.5 / 1 and says whether it is
the floor. ⚠️ **A rung is not a discount** — the price is one the company already
set, so it needs nobody's approval; the two-person rule exists for a salesperson
inventing a number, which this is the opposite of.

**177 · the same service costs different money in a different campaign.**

> Owner: *"For the same CRM I am running a campaign for the US… one campaign
> could take the CRM quotation for Pakistan, which is different for the same
> project. The quotation for the USA and foreign countries would be different."*

⚠️ **ONE ITEM WITH SEVERAL LADDERS, NOT SEVERAL ITEMS.** The shortcut is a second
catalogue row — *CRM (Pakistan)* and *CRM (USA)*. Wrong for a reason that only
appears months later: the same service would exist twice, so every count of what
the division sells and every "which product wins" report double-counts it.

⚠️ **KEYED ON THE FORM, BECAUSE THAT IS WHAT A CAMPAIGN ACTUALLY IS HERE.**
`crm_campaigns` is still **empty and has been since 111**. 127 files a lead by its
form, 174 asks the form what it sells, and the demo project's three campaigns are
three forms. A NULL form is the item's default ladder.

⚠️ **AND A PRICE IN DOLLARS IS NOT A PRICE IN RUPEES.** `currency` travels with
the ladder and is **copied onto the quotation**, never read back — a quotation is
a statement made on a date, and re-reading would silently restate every one ever
issued if a market's currency changed.

⚠️ **TWO PARTIAL UNIQUE INDEXES, BECAUSE NULLS DO NOT COLLIDE.** A plain
`unique (item_id, form_id)` accepts any number of default ladders, since NULL is
never equal to NULL — and the resolver would then pick one at random. Silent, and
the standard trap.

⚠️ **THE FLOOR TRIGGER WAS WRONG THE MOMENT THIS LANDED, and 177 fixes it in the
same migration.** 171 read `crm_properties` directly, so a **USA quotation would
have been held to the Pakistan floor** — on a dollar ladder, not a floor at all.
It asks the resolver now.

**Also:** `crm_properties.demo_url` — the owner's per-service demo link, CHECKed
as a real URL because *"ask Sarah for the link"* in that field is something a
salesperson would send to a client.

### 🗂️ And the panel the owner asked to be put away

> *"Once I fill it, it is done… then it should be minimized and not show again.
> If I want to add it, then I can add it, but not all the time display them."*

Fair, and a fault in what shipped yesterday: the qualifying form sat **open on
every lead**, so four dropdowns and a textarea were the first thing anybody saw on
a record they had opened to READ. It is now a two-line summary — *Within a month ·
ERP · 1–3 lakh · Decides alone* — that opens on click and shuts itself after a
complete save. ⚠️ **It does not shut on a partial save**, or the outstanding
questions would be hidden and met again at the stage dropdown.

---

## ✉️ 2026-09-17 — "CONVERSATION" NOW MEANS BOTH CHANNELS · migration 175

> Owner: *"You didn't implement the email services… the proposal and the
> quotation, each time sent by WhatsApp and also auto-sent by email."*

Right, and it had never been wired. ⚠️ **The mailer itself was already there and
capable** — Resend, a verified `EMAIL_FROM`, `lib/email/send.ts`, and PDF
attachments already used by invoices. What did not exist was any lead email at
all. The plumbing was built; the pipe to the CRM was not.

⚠️ **ONE THREAD, NOT TWO TABLES.** `crm_lead_messages` gains `channel`,
`subject` and `email_message_id`. A `crm_lead_emails` table would mean every
conversation screen merges two sources and sorts them by hand, and the day they
disagree is the day somebody reads a reply before the message it answers.

⚠️ **A WHATSAPP MESSAGE MAY NOT CARRY A SUBJECT — enforced by a CHECK.**
`15-MY-LEADS-PHASE.md` refused to invent one: *"Subjects are an email concept…
showing a fabricated one would be inventing content."* Now that emails are real,
the column is real for them alone.

⚠️ **AND THE GRANT WAS THE 166 TRAP AGAIN.** `cni_app` holds a COLUMN-LEVEL
insert grant on this table, so all three new columns were unwritable by the
application until named. Every email the CRM sends goes through that insert.

### ⚠️ Two bugs, and only one of them was findable by a test

**1 · `sendEmail` RETURNS its failure, it does not throw.** Written first as a
try/catch, which would have reported **every failed send as a success** — a
missing API key, a rejected address and a provider error all come back as
`{ sent: false, reason }` and none of them raise. The thread would then have
carried *"sent"* against an email nobody received: a salesperson believing the
client has the price, and no longer chasing.

**2 · ⚠️ THE EMAIL WAS BRANDED AS THE WRONG COMPANY, and only the screenshot
caught it.** Built on Taskly's shared shell, a quotation **from Chitral Royal
Homes** arrived headed *"Taskly · AI & Digital Division"* with a footer reading
*"if you were not expecting this you may safely ignore this email"* — our
internal tool's branding, and a password-reset footer, on a document carrying a
price to somebody else's customer.

**Every other email this system sends is FROM Taskly TO a colleague. This one is
from a CLIENT'S BUSINESS to their customer**, which is a different letter
entirely. It now has the CRM's own shell, carries the business name, and borrows
only `esc` and `para` — which also means one less thing to unpick when the module
is lifted. Pinned by tests that assert Taskly's name never appears.

⚠️ **AND IT IS STILL NOT THE LETTERHEAD.** `crm_project_settings.letterhead_path`
exists (171) and is **NULL for all 18 projects**. Until one is uploaded the email
prints the business NAME in plain type — honest, and visibly not a letterhead,
rather than a generated one pretending to be the client's.

### Still to do on email

- **The proposal**, as opposed to the quotation. Same machinery, different words.
- **Auto-send alongside WhatsApp** — the action exists and is called by hand;
  nothing yet sends both from one press.
- **Inbound email.** Nothing receives a reply, so a client who answers by mail
  answers into a void. ⚠️ Worth knowing before the first one is sent.
- **The PDF** — `pdf_path` unused, `pdf-lib` already a dependency.
- ⚠️ **640 of 641 real leads have no email address at all**, because Meta's form
  never asked for one. The action refuses with a sentence naming the fix rather
  than an error.

---

## ❓ 2026-09-17 — AN ERP LEAD IS NOT ASKED ABOUT PLOTS · 173, 174

> Owner: *"If it is an ERP enquiry, definitely they are not real estate; they are
> AI services. Their questions will be different, their budget will be
> different… you are still showing me qualifying questions relevant to real
> estate. The system should be smart enough to know which question to display
> according to the campaign, according to the project."*

⚠️ **A REAL FAULT IN 167, AND THE OWNER FOUND IT BY LOOKING AT ONE LEAD.**
Measured: **every** demo lead arrives on *ERP enquiry*, *CRM enquiry* or *Taskly
enquiry* — all AI & Digital services — and all of them were being asked whether
they wanted the plot **for investment or to build a house on**, with budget bands
running from 20 lakh to over a crore. For a CRM priced at 2 lakh, exactly one
band can ever apply, so the answer carried no information at all.

### How it decides now — `app.crm_lead_sells(lead)`

Most specific fact wins:

| | |
|---|---|
| 1 · **The attached catalogue item** | If a 5 Marla plot is against this lead, they are discussing a plot, whatever form they arrived on |
| 2 · **The campaign** — `crm_lead_forms.sells` | ⚠️ The owner's own rule. One project runs several campaigns and they need not sell the same thing |
| 3 · **The project** — `crm_project_settings.sells` | The default |

⚠️ **THE CAMPAIGN HAD TO BE IN THERE, and the demo data is why.** Three service
campaigns share one project with two plots. A project-level answer alone would
have been wrong for every lead on it.

**Backfilled from evidence, not guesswork** — a form named for ERP, CRM, Taskly,
automation, marketing or website is a service campaign. Anything else is left
NULL and inherits, because silence is the honest answer where the name says
nothing.

### What changed in the questions

⚠️ **THE FOUR AXES DO NOT MOVE, AND NEITHER DOES THE GATE.** Budget, Authority,
Need and Timeline are universal. Only the wording and the options change. A
second set of columns would have meant a second gate, two definitions of
"qualified", and every report having to ask which kind it was looking at.

| | Property | Service |
|---|---|---|
| **B** | 20 lakh → over a crore | **Under 50,000 → over 5 lakh** |
| **N** | investment · build · rent · resale | **ERP · CRM · digital marketing · WhatsApp automation · task automation · website** |
| **T** | *"looking to buy soon?"* | *"when do you want it running?"* |
| **A** | "Decides with family" | **"Decides with partners"** — same stored value, different sentence |
| Block / area | asked | ⚠️ **absent, not relabelled** — inventing a question to fill the space is how a form collects noise |

⚠️ **THE `svc_` PREFIX IS PERMANENT.** Two scales share one column, and a report
that summed them would be adding lakhs to crores. A stored value is never
ambiguous about which world it came from.

The panel also says which kind it thinks the lead is, so if the system has it
wrong the salesperson sees that **before** answering four questions on the wrong
scale.

### ⚠️ AND IT EXPOSED A BUG IN THE DEMO FIXTURE — the owner's call

**Faisal Rehman and Hina Shahzad are ERP enquiries with 5 and 10 Marla plots
attached.** Earlier phases seeded property onto service leads. The resolution
rule is behaving correctly — an attached plot outranks the campaign — so they
still get property questions, which is right given the data and wrong given
reality.

⚠️ **NOT CHANGED, DELIBERATELY.** Both are the fixture the test-run artifact uses
for the whole quotation flow (QT-1042, QT-1043, PROP-A101, PROP-B201). Silently
detaching their plots would break the walkthrough the owner is working from.
**Two honest fixes, owner's choice:** move those two to a property campaign so the
data means what it says, or leave them as the property example and let the other
nine demonstrate the service path.

---

## 📦 2026-09-17 — THE CATALOGUE SELLS SERVICES, AND EVERY ITEM CARRIES THREE PRICES · 171, 172

> Owner: *"Give me three quotation files for CRM. Give me three quotation files
> for ERP. Total six files… keep them separate with their proper service
> names."* And for a plot: *"plot number, block number, size, marla, is corner or
> not… and quotation price 1, quotation price 2, quotation price 3."*

**171 · the catalogue generalises.** `crm_properties` now carries
`catalogue_kind` (plot · unit · service), `price_mid`, `price_floor` and
`scope_note`.

⚠️ **THE TABLE KEEPS ITS NAME ON PURPOSE.** Renaming it would rewrite 150's
policies, `crm_leads.property_id`, `crm_quotations.property_id`,
`crm_appointments.property_id` and every query over them — a large, risky change
that buys a better noun. **Read `crm_properties` as "a thing we can sell".** The
plot fields were already nullable, which is the only reason a service fits.

⚠️ **THE FLOOR IS ENFORCED, NOT ADVISED.** A trigger refuses a quotation below
`price_floor` — on the APPROVED figure as well as the asked-for one, because the
whole point of a floor is surviving a manager having a generous afternoon. At the
floor is allowed; the floor is the last quotation, not a wall one rupee above it.
A CHECK could not do this: it reads another table.

⚠️ **AND THE LADDER MUST DESCEND** — a constraint refuses a floor above list,
which would otherwise be found by a client quoted MORE for pushing back.

**Letterhead:** `crm_project_settings.letterhead_path`, per project — it is the
client's brand on the page, not ours. One shared letterhead would print Chitral's
quotation on the division's paper.

**Readiness:** `app.crm_project_readiness(project)` — the owner's *"mention it
again and again with a red flag"*, as a function rather than each screen's own
arithmetic, so the catalogue page, the quotation form, campaign setup and
eventually the agent cannot disagree about what "ready" means. ⚠️ **It names the
fix, not the fault** — *"upload the letterhead and a quotation can be printed"*.

### ⚠️ 172 · a bug in 171, found the same day, before any screen read it

Readiness called `app.crm_project_can_whatsapp()`, which answers **two** questions
at once: is a number configured, **and may YOU send**. Right for the desk's
button; wrong here. Readiness runs inside a definer with no `app.user_id`, so both
access predicates were false and **every project reported "no WhatsApp number"** —
including the demo project, which has one configured and 17 messages already sent
through it. ⚠️ **It would have been wrong for an admin too**, who is a member of
nothing.

⚠️ **THIS ONE MATTERED MORE THAN THE USUAL, and the reason is the feature
itself:** a red-flag list that is wrong on every row teaches people to ignore red
flags. Fixed to read the column. **The regression guard is that the answer is now
identical asked as nobody, as a salesperson and as an admin** — reading it once,
as somebody with access, would have passed before the fix too.

**Tenth occurrence** of an access predicate asked a question that was not about
access — 105, 121, 125, 129, 130, 140, `crmAddLeadProjects`, and twice more
yesterday.

### 📋 What the owner now has to provide — measured, all 18 projects

| Missing | Projects |
|---|---|
| 🔴 **Letterhead** | **18 of 18** — nothing can be printed for any project |
| 🔴 **Catalogue** | **17 of 18** — only the demo has anything listed at all |
| 🔴 **Prices 2 and 3** | the demo's 2 items have only tier 1 |
| 🟠 WhatsApp number | 17 of 18. ⚠️ **Chitral genuinely has none** — messaging was only ever proved on the demo project |
| 🟠 A follow-up sequence | 18 of 18 |

⚠️ **CHITRAL HAVING NO WHATSAPP NUMBER IS WORTH THE OWNER'S ATTENTION.** 641 real
leads, and nothing can message them.

### Still not built

**Email.** ⚠️ The owner is right that it was never wired. The mailer itself is
real and capable — Resend, `EMAIL_FROM` verified, `lib/email/send.ts`, templates,
and PDF attachments already used by invoices. **What does not exist is any lead
email at all**: no template, nothing that sends a quotation or proposal, and no
record of a sent email in the lead's thread. The plumbing is there; the pipe to
the CRM is not.

**Also outstanding from the owner's spec:** campaign-scoped prices (⚠️
`crm_campaigns` is still EMPTY, so there is nothing to scope to yet), the
quotation PDF onto the letterhead, and `supersedes_id` linking v1 → v2 → v3.

---

## 🔁 2026-09-17 — PHASE G · THE SEQUENCE ENGINE · migration 170

153 built four tables and **nothing had ever advanced them.** This is the
machinery that moves them.

### ⚠️ The architecture decision: the scheduler QUEUES, it never SENDS

Postgres cannot call Meta's API and should not try. `pg_cron` decides what is due
and writes a `crm_follow_ups` row; a route outside picks those up and sends. That
split is what makes every rule below testable without a network, and what stops a
failed HTTP call rolling back a sequence's state.

⚠️ **AND `mode` ALREADY SAID WHO ACTS** — 153 gave follow-ups `remind_me`,
`review_first`, `auto_send`. Only the last goes by machine; the other two land on
**`/todos`**, which is exactly where a salesperson already looks. The two pieces
fitted without either being changed for the other.

### What it enforces

| Rule | How |
|---|---|
| **Stop-conditions before EVERY send** | `app.crm_sequence_stop_reason()` — closed · opted out · switched off · **client replied** · quotation dead · visit already booked |
| **A reply PAUSES; everything else STOPS** | Paused can be resumed by somebody who has read the reply. A closed lead does not become live again by waiting |
| **The 24-hour window** | `app.crm_window_is_open()` — arithmetic over `crm_lead_messages` |
| **Quiet hours** | Pushed to morning, never skipped — a dropped step leaves a hole in the sequence |
| **One chase per lead per day** | ⚠️ Counts only sequence steps. The owner was right: a visit reminder and the quotation itself are **transactional** and are never capped |

⚠️⚠️ **THE WINDOW RULE IS THE ONE THAT WOULD HAVE SHIPPED BROKEN.** Proved live
2026-09-15: Meta's test number accepted free text **26.3 hours** after the last
inbound, window shut. A production number refuses it. So an engine that inferred
the window from whether the API said yes would pass every test and fail silently
in the field — in the direction that reaches real customers. It is decided from
our own records **before anything is queued**, and a free-text step outside the
window is handed to a human rather than attempted at 3am.

**Proved:** 7 self-checks, each building its own fixture: a due step queues, a
template may send outside the window, free text may not, the daily cap holds, a
reply pauses within minutes, and a closed lead stops it for good.

### ⚠️ What Phase G still does NOT have

**The engine runs and nothing can reach a client yet.** Three pieces missing:

1. **The sender.** No route picks up `auto_send` rows and calls Meta.
   `sendTemplate` and `sendText` exist in `lib/crm/whatsapp.ts` (2026-09-15);
   nothing calls them on a schedule.
2. **Real templates.** The five on the account are Meta's samples
   (`jaspers_market_*`). A visit reminder and a quotation follow-up have to be
   written and submitted — ⚠️ **and now in THREE languages**, one submission
   each. The owner's afternoon, not a dependency.
3. **A screen to build a sequence or start one on a lead.** Today both are
   `insert` statements.

⚠️ **AND QUIET HOURS ARE IN THE OFFICE'S ZONE, NOT THE CLIENT'S.** Karachi/
Islamabad for everybody. **41 leads sit in the Gulf at PKT-1 to PKT-2** and would
get a 9am message at 7am. Known, unhandled, and cheap to fix once a lead carries
an offset — recorded here rather than discovered later.

---

## 💷 2026-09-17 — THE THREE-QUOTATION LADDER · corrected

⚠️ **I RECORDED THIS WRONG THE FIRST TIME AND THE OWNER CORRECTED ME.** I read
*"the final quotation will be close to their budget"* as pricing the last step to
whatever the client claimed they could afford, and wrote a long warning about it.
That is not the design. Kept visible rather than quietly rewritten, because a
decisions log that silently changes its mind is worth less than one that shows
where it was corrected.

### What the owner actually described

**Three prices per product, set by the company in advance.** The client's budget
chooses which one you OPEN at. It never decides where you end.

Owner's own worked example, for the division's own CRM product:

| Tier | Price | When it is the opener |
|---|---|---|
| **1 · list** | 2 lakh | The default. Anyone who has not pushed back |
| **2 · middle** | 1.5 lakh | *"If he says my budget is 80,000, you will give the first quotation as 1.5 lakh and say that it is negotiable"* |
| **3 · floor** | 1 lakh | ⚠️ **The last quotation. Never below it.** |

> *"After verifying, discussing, or showing the features… explain the feature we
> are providing, that's why our price is that. After that you can finally give
> the last quotation."*

### Why this is sound, and it answers the question I had asked

⚠️ **THE FLOOR ALREADY EXISTS IN THE OWNER'S MODEL — it is tier 3.** My previous
entry asked whether the floor should be a percentage of list or set per unit.
**Answered: set per unit, three explicit figures, decided before any client is
quoted.** That is the stronger of the two options and it needs no percentage rule
at all.

⚠️ **AND A STEP DOWN IS EARNED WITH VALUE, NOT GIVEN.** The owner's sequence is
*explain what we provide, THEN move* — which is the right instinct and the thing
most discount ladders miss. A concession handed over for nothing says the first
number was never real.

### The one residual risk, stated once

Using the stated budget to pick the opening tier still rewards understating it:
saying *"my budget is 80,000"* skips tier 1 and starts you 25% lower. ⚠️ **Far
smaller than what I wrongly described** — the floor caps the damage at one tier,
not at whatever the client claims — but worth knowing when tier 2 starts being
the usual opener rather than the exception. **Worth watching, not worth
redesigning.**

### ⚠️ Where it does NOT fit today, and this is a real gap

| | |
|---|---|
| `crm_properties.base_price` | **One number, not three.** The ladder needs a list, a middle and a floor per unit |
| **The CRM product itself has no catalogue row** | ⚠️ The owner's own example is *our CRM at 2 lakh* — an AI & Digital SERVICE. `crm_properties` is plot-shaped: `plot_number`, `block`, `size_marla`, `is_corner`. **There is nowhere to put a service's three prices at all.** This is the per-project switch Phase C flagged, arriving as a concrete blocker |
| `supersedes_id` | Exists, still unwritten — a v2 has no link to what it replaced |
| **"Why this price"** | No column. `approval_note` is the approver's, not the preparer's |

⚠️ **NEEDS A DECISION: does a service get a `crm_properties` row with the plot
fields left null, or its own catalogue table?** Recommend **the same table** — a
second catalogue means every quotation, appointment and lead join has to ask
which kind it is, and `crm_leads.property_id` points at one table only. Plot
fields are already nullable.

---

## ⏱️ 2026-09-16 — THE FIRST-RESPONSE CLOCK AND THE TO-DO LIST · 168, 169

The owner's own step two — *"a task is created for Sarah: you have to respond to
this new lead"* — was the only step in their whole flow with nothing behind it.
Built, with the list that surfaces it.

### Migration 168 · a notification kind, alone

⚠️ **ITS OWN FILE BECAUSE IT HAS TO BE.** A label added to an existing enum
cannot be USED in the transaction that adds it, and 169's self-check inserts a
notification of this kind. Migration 157 exists for the same reason.

⚠️ **AND IT IS ITS OWN KIND, NOT `lead_due`.** "You have work scheduled today" is
an ordinary morning; "a stranger asked to be contacted and nobody has" decays by
the hour. One kind for both would mean the one people mute is the one that
mattered.

### Migration 169 · `crm_project_settings`, the clock, the alert

**`crm_project_settings`** — ⚠️ **a `crm_*` table, NOT columns on `projects`.**
`16-EXTRACTING-THE-CRM.md` says a new host must supply `projects` with an `id`
and `lead_department_id`; every policy column bolted onto that table widens what
the next home has to provide. A CRM table with an FK **to** projects is the
direction the contract already allows, and it travels with the module.

| Setting | Default | Read by |
|---|---|---|
| `first_response_minutes` | 60 | ✅ the clock |
| `sla_night_from` / `sla_night_to` | 22 / 8 | ✅ the clock |
| `visit_before_quotation` | **false** — the owner was right, see the geography section | ⬜ nothing yet |
| `visit_reminder_minutes` | 120 — the owner's own choice | ⬜ nothing yet |

⚠️ **The last two are stored and unread**, recorded honestly here rather than
added in a later migration — both are decisions already taken, and the same state
as `crm_quotations.pdf_path` and `crm_appointments.replaces_id`.

**The clock.** ⚠️ **Starts at ASSIGNMENT, not at submission** — a lead imported
three days after Meta captured it cannot have been answered on day one, and an
alert that is always red is an alert nobody reads. ⚠️ **A handover does not
restart it**: the client has been waiting since the first assignment, and that is
our problem rather than theirs. ⚠️ **The night window pushes the deadline to the
morning but never delays assignment** — the owner's rule stands that a lead goes
out at 2am and is picked up on mobile.

**The alert.** Every 15 minutes, not hourly: a 60-minute target checked once an
hour can fire 59 minutes late, by which point the research this rests on says the
lead is gone. ⚠️ **Once per lead ever, keyed on the lead** — without that it
would say the same thing 96 times a day and the bell would be switched off.
⚠️ **It names the person and the delay, never a count** — *"Faisal Rehman has
been waiting 2 hours"* is somebody to ring; *"3 breached"* is a statistic.

**Proved:** 7 self-checks under a real salesperson's session, including that an
answered lead stops being a breach and that a salesperson can READ the target
being applied to them — a deadline you cannot see is a trap, not a target.

### ✅ `/todos` — the sales team's own list

> Owner: *"I want a separate thing for the sales team with the name to-dos where
> sales-related to-dos will just be displayed… For the sales team you have to
> clear your to-dos, then you can leave today."*

⚠️ **DERIVED, AND THERE IS NO `crm_todos` TABLE. THIS IS THE DESIGN DECISION.**
A stored to-do can be ticked off separately from the thing it refers to, and the
first time somebody clears *"ring Faisal"* without ringing Faisal the list stops
being true — permanently, because nothing reconciles them. **There is no tick box
on the page at all.** Every row is a question asked of real state and clears when
the work is done.

Six sources, **one `union all`** — six queries would be six round trips for one
screen (law 4). Bounded to everything overdue plus seven days ahead (law 5).

| Source | Row |
|---|---|
| Lead never contacted | Make first contact |
| `next_action_at` due | Do what you planned |
| Appointment ahead | Be there |
| Appointment past, no outcome | Write up what happened |
| Quotation `pending_approval`, not yours | Approve or refuse a discount |
| Quotation approved, unsent | Send the approved quotation |

⚠️ **A ROW WITH NO DATE IS OVERDUE, NOT "LATER".** A lead nobody planned a moment
for is unplanned work, which is exactly what this page exists to surface —
**640 of 641 leads are in that state.** Filing them under "coming up" would hide
the entire problem.

⚠️ **AND THE LABELS ARE INSTRUCTIONS, NOT NOUNS.** "Quotation" is a topic; "Send
the approved quotation" is something somebody can finish.

**Measured on the live data:** manager 1 to-do (a discount to approve), Sahad 9,
Sarah 8 — **and every single one of theirs is a first contact.** No lead appears
on two lists. `node scripts/check-todos.mjs`, run as each real person.

⚠️ **A bug the screenshot caught and tests would not have.** An undated first
contact sat under the red *Overdue* heading styled as calmly as next Tuesday's
call — the row and the group it was in disagreed about urgency, which is how
somebody learns to ignore the heading. Fixed and pinned by a test.

⚠️ **THE `join public.projects` TRAP, FOR THE NINTH TIME — caught again.** The
project name is resolved through `app.crm_project_name()` after the union, not
joined inside it.

⚠️ **AND BACKTICKS INSIDE A SQL TEMPLATE LITERAL, TWICE IN ONE DAY.** The file is
one template literal; a backtick in a SQL comment ends the string and `tsc`
reports three missing commas on a line that has none. The warning was already in
the file, forty lines away, both times.

---

## 🗺️ 2026-09-16 — WHERE EVERYONE ACTUALLY IS, AND A CORRECTION I OWE THE OWNER

The owner mentioned in passing that **the office is in Islamabad** and that they
work from **Karachi**. That one detail overturns advice I had given confidently
two hours earlier, so it is recorded here rather than quietly amended.

### ⚠️ I ARGUED VISIT-BEFORE-QUOTATION. THE OWNER SAID QUOTE FIRST. THE OWNER WAS RIGHT.

My reasoning was the standard one for real estate: *nobody buys land they have
not stood on, and the visit is what makes the price feel reasonable.* That holds
when the plot is a Sunday drive away. **Chitral is not.** Measured against the
641 real leads, by where they said they live:

| Segment | Leads | Share | What a site visit actually costs them |
|---|---|---|---|
| **Chitral itself** | 115 | **17.8%** | trivial — they can come tomorrow |
| **KP corridor** (Peshawar, Mardan, Swat, Dir…) | 193 | **29.9%** | a long day each way over the Lowari |
| **Islamabad / Pindi** | 154 | **23.8%** | ~10 hours each way — a two-day trip |
| **Rest of Pakistan** | 140 | 21.7% | further still |
| **⚠️ Gulf / overseas** | 44 | 6.8% | **will not visit before buying, ever** |

⚠️ **ONLY ABOUT 18% OF THIS MARKET CAN VISIT EASILY.** Asking the other 82% to
make a two-day journey before they know the price is not a sales technique, it is
a way of losing them. **Quote-first is correct for Chitral, and the general rule I
quoted was the wrong rule for this project.**

### What follows from it, and it is more than the ordering

1. ⚠️ **The site visit is a CLOSING event, not a discovery event.** It comes after
   the quotation, for buyers who are already serious. That is the opposite of how
   most CRM funnels are drawn, and it is why `visit_scheduled` sits after
   `quotation_sent` in the owner's own flow.
2. ⚠️ **Visits will be BATCHED, not booked one at a time.** With the team in
   Islamabad and the biggest market in Peshawar, a trip carries several clients.
   **The appointments model needs "who is waiting for a visit" so a trip can be
   filled** — a screen that only books one visit at a time does not fit how this
   business can physically operate. Not built, and worth designing before Phase F.
3. ⚠️ **Video has to do the job the visit does.** Drone footage, a live call from
   the plot. For 82% of leads that is what creates desire, and it is the single
   biggest content gap. It is also cheap.
4. ⚠️ **Visits are probably SEASONAL.** Chitral's access is hard in winter and
   flights are weather-cancelled. A booking flow that offers any date year-round
   will promise trips that cannot happen. **To confirm with the owner.**
5. **Peshawar is the biggest single city — 144 leads — and the office is not in
   it.** Islamabad is 109. Worth knowing when the sales team is staffed.

### ⚠️ Two things this changes in the engine

**Quiet hours must use the CLIENT'S timezone, not the office's.** 41 leads sit in
the Gulf at PKT-1 to PKT-2; a 9am automated message lands at 7am in Riyadh. The
rule is about not irritating a client, so it is measured where the client is.

**`Asia/Karachi` IS THE CORRECT ZONE FOR THE ISLAMABAD OFFICE — do not "fix" it.**
It is the IANA identifier for the whole of Pakistan, and Islamabad and Karachi
are the same clock. Somebody in the office will eventually read it as a bug.
⚠️ **So the SLA clock is unaffected by any of the above**, which is the one piece
of good news in this section.

---

## 🧭 2026-09-16 (later) — THE FLOW SETTLED, AND QUALIFICATION BECAME REAL

The owner walked their whole understanding of the lifecycle through and asked for
it to be checked by somebody thinking as a sales manager. Three questions were
answered, three things pushed back on, and one of them built.

### The three answers

| Question | Answer |
|---|---|
| **When is a lead `qualified`?** | **Right after `contacted`, before any quotation or visit.** It is a GATE, not a waypoint — its job is to decide whether to spend money on somebody, and a site visit is the most expensive thing a salesperson does. ⚠️ The owner's model had it after the visit; the code's order was already right. The lost reasons prove it: `budget_too_low`, `wrong_location`, `not_serious` are all qualification failures and all cheap only when found early. |
| **Where does the appointment come from?** | **It is a record, not a stage** — which is why it seemed to appear from nowhere. It occurs at up to three points in one deal: a `call` at qualification, the `site_visit` backing `visit_scheduled`, and a `meeting` to sign and take the booking. `visit_scheduled` is the funnel; the appointment is the diary behind it. |
| **Where does booking sit?** | **Between `negotiation` and `won`.** ⚠️ And `won` = **booking amount received, unit reserved** — the owner accepted this. The plot comes off the market, commission is earned, and the CRM's job ENDS there. Owner: *"I am creating a lead management system for CRM"* — instalments, collections and transfer are ERP work, not this. `crm_properties.status` goes `reserved` at won, `sold` at transfer. |

### The three pushbacks, and where each landed

| | Outcome |
|---|---|
| **Quotation before visit, or visit before quotation** | ⚠️ **SETTLED LATER THE SAME DAY, AND THE OWNER WAS RIGHT — see the geography section above.** I argued visit-first on the general real-estate rule; only ~18% of this market can reach Chitral easily, so quote-first is correct here. Still worth a per-project setting for the day a scheme sits beside a city. |
| **"No reply after one follow-up → lost"** | ⚠️ **Refused, and it is the expensive one.** Roughly 80% of sales need five-plus follow-ups. Worse, auto-lost fills the nine lost reasons with fiction and **makes Step 12 — campaign vs staff, the question this CRM exists for — permanently unanswerable.** Exhausted sequences go to nurture (`revisit_later`), never lost. |
| **One touch per lead per day** | ⚠️ **The owner was right and I was too blunt.** The distinction is **chase vs transactional**: cap the chases, never cap a visit reminder or the quotation itself. |

⚠️ **AND QUIET HOURS ≠ WORKING HOURS — I had conflated them.** Assigning a lead
at 2am is fine; the team answers from mobile and that is the job (133/156 already
only ORDER by working hours, never filter). Sending an automated WhatsApp to a
stranger at 2am is not. Soft night window on automated sends only, adjustable.

**Visit reminder: 1–2 hours before, the owner's choice.** ⚠️ Flagged once as
their sales manager: too late to refill the slot if they cancel. A T-24h confirm
should join it later.

### ✅ Built — migration 167 · qualification, and the gate

`0 of 641` real leads carried a budget. `qualified` was a badge somebody clicked.

**Four axes gated** — budget band · authority · purpose · timeline — plus payment
mode, location preference, and the objection in their own words. A trigger
refuses entry to `qualified` **or anything past it** without all four.

⚠️ **THE ENUMS ALL CARRY "unknown" / "not disclosed" ON PURPOSE.** The gate
refuses never having ASKED, not a client who would not answer. Four recorded
unknowns produce a `cold` suggestion, which is the correct answer.

⚠️ **A TRIGGER, NOT A CHECK.** A CHECK re-evaluates every row on every write and
would have frozen every demo lead already past `contacted` with no BANT.

⚠️ **AND IT GATES THE WHOLE RANGE, NOT JUST ONE STAGE** — a gate you can walk
around by picking the next option in the dropdown is decoration.

⚠️ **The temperature is SUGGESTED, never set** — owner: *"I will set their
temperature."* Two caps beyond the weighting: **`just exploring` and `not the
decider` can never be hot**, because hot means closeable *now*. Capped to warm,
never forced cold — both are good leads for later.

⚠️ **A BUG WORTH RECORDING: the explanation contradicted its own verdict.**
Ranking reasons by weight hid the signal that decided the answer — a lead capped
to warm for having no decision-maker was explained by three reasons that all
argue for hot. Caveats now lead and are never dropped. Locked by a test.

⚠️ **`qualified_at` / `qualified_by_id` are stamped by the trigger and left OUT
of the grant** — the same reason 116 keeps `first_contacted_at` out. A
response-time figure the measured party can edit is not a measurement.

**Proved:** 7 self-checks in the migration + `node scripts/check-qualification.mjs`,
every one under a real salesperson's session. A peer cannot rewrite a colleague's
qualification; **the manager can, by design**, and that is asserted rather than
assumed.

⚠️ **A working path was broken and then restored inside the same session.** 167's
gate made the stage dropdown's "Qualified" fail with no UI to satisfy it. The
`QualifyPanel` in the drawer's Overview tab is that UI, and `setStageAction` now
turns CRM08 into a sentence naming the missing answers rather than a 500.

### 📁 `docs/crm-ai/` — the automation plan, quarantined

> Owner: *"documented in a separate folder that will not impact this current
> folder or these current parts."*

Six files, nothing implemented, nothing in `docs/crm/` touched. Three tiers with
an evidence gate on each, the grounding rules behind *"the AI will not answer
outside that document"*, the handover protocol, the performance-reading design,
and ten guardrails each with the damage it prevents.

⚠️ **Two questions in there need the owner and are not mine to assume:** may the
agent negotiate (I recommend no — it silently defeats the two-person discount
rule), and may a model read WhatsApp *conversations* (Q18 covered names and
numbers only, and Chitral's threads are a client's data).

---

## 🔁 2026-09-16 — A LOST SESSION, AND WHAT THIS FILE HAD STOPPED SAYING

The owner's PC restarted and the session was gone. They came back to this file to
find out where to start — **which is the entire reason it exists — and it was two
days out of date.** It said the last migration was 143 with 144–166 applied, it
still carried the 2026-09-12 PAUSED banner that had already been lifted, and its
"How to resume cold" pointed at `10-LEAD-ASSIGNMENT.md` as the next build, three
days after that was built. The work of the 15th and 16th had gone into
`14-SALES-WORKSPACE-PHASES.md` and `15-MY-LEADS-PHASE.md` instead.

> Owner: *"The tracker is very important and you should keep maintaining it and
> keep updating it without my consultation sir."*

⚠️ **STANDING ORDER, NO LONGER A REQUEST.** Updating this file is part of
finishing a piece of work, like `tsc` and the test suite — never something to ask
permission for. And ⚠️ **the failure mode is not a missing entry, it is a stale
one left in place**: a PAUSED banner nobody deleted outranked three days of newer
text further down. Delete or mark what a session contradicts.

### The two days this file missed — migrations 144–166

All applied and verified against the live database on 2026-09-16.

| Phase | Landed | What |
|---|---|---|
| **B · the stage list** | 148, 149 | Settled once, as the tension in `12-LIFECYCLE-SPEC.md` demanded. **Ten active stages**; `follow_up` and `scheduled` retired and proved empty first. ⚠️ Both remain in the enum because PostgreSQL has no `DROP VALUE` — `RETIRED_STAGES` in `lib/domain/crm-stages.ts` is what keeps them out of every picker and count. |
| **C · properties** | 150, 166 | The catalogue in the drawer's Related tab; attaching a unit to a lead. Read-only to a salesperson — no price field in the picker at all. |
| **D · quotations** | 151 | Raise from the drawer, net recomputed as typed, the manager's approval queue, approve / approve-less / reject. ⚠️ **Still missing: the PDF and v2 versioning** — `pdf_path` and `supersedes_id` both exist and are unused. |
| **E · appointments** | 152 | Booking from the "site visit requested" outcome, **Today's plan** on `/my-leads`, recording completed · no-show · cancelled. ⚠️ **Still missing: rescheduling** (`replaces_id` unused) **and the standalone screen** — being built 2026-09-16. |
| — | 153–165 | Follow-ups and sequences tables, assignments with a frozen reason, outcomes, capture + eligibility, `app.crm_create_lead`, the Add Lead picker, Meta platform, demo rows flagged `is_test_data`, and **164/165 — Rule Zero's fifth law**, the access rule answered once per statement rather than once per row (552× on the manager count). |

### 📐 The page layout, settled by the owner today

`14-SALES-WORKSPACE-PHASES.md` Phase A specified a `/sales` route with an
eleven-entry rail. **No `/sales` route was ever created** — the desk, the drawer,
Today's plan, the approval queue, the unit picker and Raise Quotation all landed
on `/my-leads`. Docs and code had disagreed about what Phase A was.

> Owner: *"The sales or my leads page is the same page. You can consider it as
> the same… but the sales desk for Sara will be a different page."*

| Rail entry | Route | State |
|---|---|---|
| **My leads** | **`/my-leads`** | ✅ built. ⚠️ **This is also "/sales". There is no second route and none is to be created** — a `/sales/leads` alias would be two URLs for one screen and two places for a bug to hide. |
| **My sales desk** | — | ⬜ **A separate page**, still to build: the greeting, the four cards, Today's plan, the manager's approval queue, and the goal card when Phase F lands. |

### ✅ Built 2026-09-16 — the Appointments screen · `/appointments`

> Owner: *"It is done but I want to implement and also build its screen today so
> I can run it at least. Definitely I will improve its UI or screen later."*

**No migration — 152 already had the table and its policies.** The screen is one
query (`crmMyAppointments`), one client component, one nav entry.

| | |
|---|---|
| Route | `/appointments` — its own top level, not `/my-leads/appointments`, which would inherit that page's nine queries to draw a list owing them nothing |
| Tabs | **Needs recording · Upcoming · Done**, all client state — subsets of rows already on the page, so a tab press is a `filter()` and not a round trip |
| Window | 60 days back, 300 rows, and the screen **says so** rather than implying it holds everything |
| Proof | `node scripts/check-appointments-screen.mjs` — 12 assertions under **real salespeople's sessions**, never an admin's, cleaning up after itself |

⚠️ **THE `join public.projects` BUG WAS WRITTEN HERE AGAIN, AND CAUGHT BEFORE IT
SHIPPED.** The query first read the project name with a bare join. Under a
salesperson's session `projects_select` asks for membership, a salesperson is a
member of nothing, and every row would have rendered with **no project** — a
screen that looks merely sparse, and looks perfect from an admin login. It is
`app.crm_project_name()` now, and the check asserts the NAME rather than the row
count, because a count passes either way. That is migrations 105 / 121 / 125 /
129 / 130 / 140 and `crmAddLeadProjects`, for the **eighth** time.

⚠️ **AND CANCELLING A BOOKED VISIT DID NOT EXIST ANYWHERE IN THE PRODUCT.**
`crmCloseAppointment` has accepted `cancelled` since 152 and **no screen ever
sent it** — Today's plan only shows its buttons once an appointment is in the
past, so a client ringing to call off tomorrow's visit left the salesperson with
a diary they could not correct. `/appointments` is now the only place it can be
done, and it asks *why* first: a stray click there cancels a real client's visit,
which is the one thing on the screen that pressing something else cannot undo.

⚠️ **`--text-tertiary` IS NOT AA-SAFE AS INK IN THE LIGHT THEME.** Measured
through a canvas at 1440px: **3.94:1** on a surface, against 4.5 required — while
passing comfortably in dark, which is what makes it survive review. Four uses on
this screen were raised to `--text-secondary` (6.42 light / 8.07 dark). The
remaining `text-tertiary` here is all `aria-hidden` icons and separators.

⚠️ **AND `PageHeader`'s EYEBROW FAILS THE SAME WAY, ON EVERY PAGE IN THE
PRODUCT** — `text-micro` + `text-tertiary` = **3.41:1** in light. Left alone
deliberately: it is a shared component and a product-wide visual-weight decision,
not something to change inside one screen's build. **Worth raising with the
owner.** See `chart-tokens-fail-as-text`.

**Still missing:** rescheduling (`replaces_id` remains unused — cancel and
rebook is the workaround), and booking from this screen, which is deliberate —
`crmBookAppointment` reads the project, owner and unit **from the lead** so a
caller cannot name a different one, and a second write path would give that up.

⚠️ **Nothing was seeded.** `crm_appointments` is still **0 rows**, so the screen
opens on its own empty state, which names the control that fills it. Booking one
from Record Outcome → *site visit requested* is the owner's own test.

---

## 📋 2026-09-14 — THE OWNER'S LIFECYCLE SPEC ARRIVED · see `12-LIFECYCLE-SPEC.md`

The owner brought a full lead-lifecycle specification — capture, duplicates,
eligibility, assignment reasons, qualification, quotations, sequences,
appointments, closing — and asked for it to be understood and documented before
anything is built. **Nothing from it was implemented on the day it arrived.**

⚠️ **IT RESETS WHAT "DONE" MEANS.** Steps 1–11 of `08-TWELVE-STEPS.md` are still
done, and they are roughly the capture → assign → work → converse half. The spec
is mostly about the other half — qualify → quote → visit → close — which is why
it reads as almost entirely new. `12-LIFECYCLE-SPEC.md` has the line-by-line
measurement and the eight phases in dependency order.

Three things from it to decide EARLY, because they get more expensive daily:

| | |
|---|---|
| **The stage list** | The spec wants `quotation_sent` added and `follow_up` demoted to an activity state. Both are right; together they reshape the funnel, the strip, the board and every stage-weighted figure. ⚠️ Decide once, migrate once, before Phase 4 — later means rewriting `crm_lead_activity` history. |
| **WhatsApp templates** | The sequence engine cannot send anything past the 24-hour window without Meta-approved templates. Approval is outside our control. ⚠️ Start it long before Phase 6 needs it. |
| **Per-project catalogue** | Chitral sells plots; AI & Digital sells services. The property module needs a per-project switch or it reads as wrong on half the projects. |

Renamed at the owner's request so conversation is unambiguous: **Sale Tester →
Sarah**, **Sale 2 tester → Sahad**, the manager unchanged.

---

## 🔒 2026-09-14 — WHO CAN SEE IT, AND THE LAST OF STEP 8

### The CRM is a preview now — migration 143

Owner: *"tell me whether this CRM… is visible to Kashif Ayaz… any of the members
in AI Digital… Please hide it from them… I just want to work on it with just
these testers."*

It was visible to all nine of AI & Digital, and **Kashif Ayaz could also read the
lead reports** — the document that compares salespeople by name. Not a bug:
`crm_acting_department()` grants the desk to any department owning a lead-routed
project, and AI & Digital owns one because its own enquiries land there.

⚠️ **The routing model was NOT changed.** Taking the lead projects off AI &
Digital would undo the owner's own rule (*"AI & Digital leads → Kashif"*), which
is right and comes back the day this is shown. A preview list is asked in front
of it instead. Four predicates ask it — two gate the pages, two gate the rows.
Pages alone would leave a lead readable to anybody holding yesterday's URL; rows
alone would leave the nav advertising an empty desk.

| | Desk | Reports | Leads visible |
|---|---|---|---|
| AI & Digital — all nine incl. Kashif Ayaz | — | — | **0** |
| Development — Junaid, Lararib | — | — | 0 |
| Sale Tester · Sale 2 tester | ✅ | — | 11 · 9 (their own) |
| sale manager tester | ✅ | ✅ | 650 |
| Umm-e-Habiba (admin) · Ammar (super_admin) | ✅ | ✅ | 650 |

**Admins are not on the list and keep access** — every predicate short-circuits
on `acting_at_least('admin')` before the preview is consulted, which keeps the
owner's standing rule that admin/super_admin see everything. 143's header names
the line to change to remove the CEO too.

⚠️ **To end the preview:** `delete from public.crm_preview_members;`. An empty
table means no restriction, so there is nothing else to undo — and nothing to
tidy away by accident.

### 📞 Calling — researched and parked, see `11-CALLING.md`

Owner, 2026-09-14, after spotting that I had said "taking calls" too loosely:
*"Is the call facility available in the WhatsApp API?"* … *"Instead of talking on
a desktop, if he wants to talk on a mobile, is it not possible?"* … *"I'm not
talking about implementing this right now but definitely once the system is
running… I will implement this thing."*

Short version — **yes to all of it, and the blocker is a number that only real
use can move:**

| | |
|---|---|
| WhatsApp does voice calls | ✅ Business Calling API, both directions |
| He can talk on his **mobile**, not a desktop | ✅ **SIP → PBX → softphone.** Rings when locked; recording comes free, server-side |
| Can we start now | ❌ needs **≥ 2,000 recipients/day**; we are on **`TIER_250`** |
| Business-initiated from the test number | ❌ it is `+1`, and US numbers are blocked |

⚠️ **THE TIER RISES ONLY BY MESSAGING REAL PEOPLE WELL** — so the few weeks of
tester use are themselves the prerequisite, and this cannot be brought forward.

⚠️ **AND AN APK CANNOT RECORD CALLS.** Android closed that at 10; Google banned
the Accessibility workaround on 11 May 2022. Recording is server-side or it does
not happen — which is exactly why the SIP route is the one. `11-CALLING.md` has
the three dead ends written out so they are not researched twice.

### Four bugs in Step 8, each one worse than the last

| # | What | Fix |
|---|---|---|
| 1 | The desk and record WhatsApp icons opened `wa.me` — **the salesperson's own phone**. Nothing recorded: no thread, no response time, no "who replied". One click undid the feature beside it. | commit `7d3c15d` — both now open our docked chat; `wa.me` survives only where a project has no number |
| 2 | `crmProjectCanWhatsApp` read `projects` under the caller's session → **0 rows for the whole sales team** → "cannot send" → back to `wa.me`. Worked perfectly from an Admin session. | **migration 140** |
| 3 | ⚠️ **`whatsAppConfigFor` read the number through `withAppRole`.** `cni_app` has no BYPASSRLS, so RLS applied with no `app.user_id`: **0 rows for everyone, always.** Nothing had ever been sendable, and the refusal blamed the project's configuration. | **migration 141** |
| 4 | A reply landed on a **sibling lead sharing the number** (4 share `+923121531511`), so it was in the database and invisible on the screen that had sent to it. | **migration 142** |

⚠️ **Bug 3 is the general lesson.** `withAppRole` sets the role and no session —
it **narrows harder than `withUser`**, running every policy for a user that does
not exist. It is correct only where a policy admits an anonymous session on
purpose (the webhook's INSERT does, which is exactly why storing an inbound
message worked all along while reading a project's own number never did). Every
other `withAppRole` call in the codebase was swept 2026-09-14 and all of them go
through an `app.*` definer. **A bare `from public.<table>` inside a
`withAppRole` callback is the bug.**

⚠️ **And 142's first version was wrong in a way its own self-check passed.**
"The sibling with the most recent message wins" is self-sustaining: an inbound
*is* a message, so one misfiled reply pins every reply after it to the same wrong
lead. The anchor is the last thing **we** said. The corrected check fails on the
version written first.

### And the half of Step 8 that was never finished

`fetchMedia` had been written and **was called by nothing**. A lead sending a
photo produced a grey chip with a filename and no way to open it — while the
owner's ask was explicitly *"He can message. He can send an image. He can send
files."*

- `GET /api/whatsapp/media/[id]` — RLS-scoped by 138's policy, so an unauthorised
  reader gets the same 404 as a message that does not exist, and the route cannot
  be used to find out which ids are real. Fetches from Meta with the system
  token, streams the bytes, `private` cache only.
- Images render inline in the bubble and open full size; other files become a
  named link.
- ⚠️ **Outbound media now keeps its upload id.** It was being thrown away, so a
  file *we* sent was a filename in the record forever — and "what did he actually
  send the client" is one of the questions this log exists to answer. Messages
  sent before 2026-09-14 have no id and still show as a plain chip.
- ⚠️ **Meta keeps media ~30 days.** Past that the route answers 410 with a
  sentence about the age of the file, not a broken image icon.
- ⚠️ **Not copied into our own bucket on arrival** — that would mean a two-call
  download inside Meta's webhook retry window, and Meta retries a slow webhook,
  which is how the same photo arrives five times.

### Also landed 2026-09-13/14

- The docked WhatsApp panel **polls its own thread** every 5s while open, and
  only while the tab is in front, with a read on the way back. Previously a reply
  that arrived after render stayed invisible until a reload. One small RLS-scoped
  query, not `router.refresh()`, which re-ran the record, the roster and the
  cached AI reading to show one bubble.
- The panel's badge stopped counting every inbound message ever — a finished
  conversation wore a permanent count. It now shows inbound since the last thing
  we said.
- The refusals name the fault they actually found: "no number on the project" and
  "no `META_SYSTEM_USER_TOKEN` in this environment" are different faults with
  different owners and no longer share a sentence.
- `subscribed_apps` — the test WABA was delivering to Meta's own *"WA DevX
  Webhook Events 1P App"*, not Taskly. Fixed by POST; both are subscribed now.

---

## ✅ LIFTED — the 2026-09-12 pause. Kept for the reasoning only.

⚠️ **THIS PAUSE IS OVER.** Work resumed 2026-09-14 with the lifecycle spec and has
run continuously since; phases A–E of `14-SALES-WORKSPACE-PHASES.md` landed on the
15th and 16th. **This banner sat here unmarked for four days and was the single
thing that made this file mislead a cold resume on 2026-09-16** — it is the
worked example of why a stale entry is worse than a missing one.

The reasoning below is still sound and still unfinished: the department
restructuring did not happen, and Q19 (specialisation) is still waiting on it.
Nothing in the build waits on that.

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
| ~~**WhatsApp sending**~~ | ✅ **CLEARED 2026-09-13.** Verification landed; sending, receiving, media and status callbacks all proved on Meta's test number. | — |
| **Step 12 · campaign vs staff** | Weeks of real use. **Still nothing closed** — 650 leads, no outcomes to divide. | None, and honestly so. |
| **Step 7c · specialisation matching** | ⏳ The **sales manager**, once there is one. Owner will ask what each person handles and bring back the real answer. ⚠️ The field must not be invented meanwhile. | ✅ **Nothing waits on it.** The four-signal router in `10-LEAD-ASSIGNMENT.md` uses none of it. |

### ✅ What is left, in order — updated 2026-09-13

Steps 1–10 are live. The four-signal router landed 2026-09-13 (migration 133).
What follows is everything still to do, with what each one actually involves.

| # | Step | Needs | What it is |
|---|---|---|---|
| ~~1~~ | ✅ **Live updates** — done 2026-09-13 (no migration; the pulse carries a lead count) |  |
| ~~2~~ | ✅ **Editing an existing person** — done 2026-09-13 |  |
| ~~3~~ | ✅ **Importer-failure alert** — done 2026-09-13 (migration 134) |  |
| ~~4~~ | ✅ **Manager dashboard** — done 2026-09-13, `/lead-overview` (migration 135) |  |
| ~~5~~ | ✅ **Salesperson dashboard** — done 2026-09-13, `/my-leads` (migration 136) |  |
| ~~6~~ | ✅ **Step 11 · per-lead AI** — done 2026-09-13 (migration 137). Cached per lead; ~362 tokens, 3.2s, roughly $0.003 a read |  |
| **7** | **Specialisation in the rota** | ⏳ the sales manager | Once there is a real answer, it becomes a FILTER in front of the router, not a replacement for it. ⚠️ Do not invent the taxonomy — Q19. |
| ~~8~~ | ✅ **WhatsApp conversations** — done 2026-09-13 (migrations 138, 139). Verification cleared; sending and receiving both proved on Meta's test number |  |
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

## ✅ LIFTED — the 2026-09-10 pause. Kept for the reasoning only.

⚠️ **ALSO OVER.** WhatsApp verification cleared 2026-09-13 and sending, receiving
and media are all proved live. Everything in the table below has since been built
or re-answered; read it as history, not as a list of what is blocked.

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

### ⚠️ STALE — both items below were closed. Kept for the reasoning only.

⚠️ **The ERP/Taskly item was closed 2026-09-13 and was never a real task** — the
AI & Digital page already maps to the AI & Digital Division project, and
migration 127 files a lead by its FORM, so the campaigns stay tellable apart on
one project. The owner: *"The DBN itself is enough."*

⚠️ **The silent-import item was closed 2026-09-13 by migration 134**
(`app.crm_notify_import_health`), which checks SILENCE first — the September
outage wrote zero error rows, so an error-row check would have missed it.

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
| 2026-09-12 | ⚠️ **PAUSED for team restructuring** | Owner: *"Right now just one team, the AI and Digital team, is implemented. No finance team, no sales team, no HR team… Then I will come back to this CRM and maybe it will be easier for me to tell you which things I will assign to which."* **The right order** — every open question here is a question about people. Next work on a `team-restructuring` branch, merged to `main` before the CRM resumes. ⚠️ **Lifted 2026-09-14**; the restructuring itself has still not happened and Q19 still waits on it. |
| 2026-09-14 | **The stage list** | **Ten stages**, settled once as `12-LIFECYCLE-SPEC.md` demanded: new · contacted · qualified · proposal_pending · quotation_sent · visit_scheduled · visited · negotiation · won · lost. `follow_up` and `scheduled` retired — migrations 148/149, which proved no row wore either before committing. ⚠️ **"New reply" was refused as a stage**: a lead that replies during negotiation must still be in negotiation, or the funnel forgets where they were. |
| 2026-09-16 | ⚠️ **"My leads" and "/sales" are ONE page** | Owner: *"The sales or my leads page is the same page. You can consider it as the same."* `/my-leads` is it. **No `/sales` route is to be created** — the Phase A spec that called for one is superseded. Two URLs for one screen is two places for a bug to hide. |
| 2026-09-16 | **"My sales desk" is a separate page** | Owner: *"…but the sales desk for Sara will be a different page."* Still to build: greeting, the four cards, Today's plan, the manager's approval queue, the Phase F goal card. Distinct from My leads, which is the list. |
| 2026-09-16 | ⚠️ **The tracker is maintained without asking** | Owner: *"The tracker is very important and you should keep maintaining it and keep updating it without my consultation sir."* Standing order. Updating this file is part of finishing work, like `tsc`. ⚠️ **And stale entries get deleted or marked** — a four-day-old PAUSED banner is what made this file mislead a cold resume. |
| 2026-09-16 | **Appointments screen — working before finished** | Owner: *"I want to implement and also build its screen today so I can run it at least. Definitely I will improve its UI or screen later."* Explicitly a usable screen now, a polished one later. ⚠️ Rule Zero still applies to it — "improve the UI later" is about layout and density, never about a click that waits. |

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

⚠️ **Rewritten 2026-09-16.** The previous version of this list sent a cold reader
to a build that had been finished three days earlier.

1. **Read the dated sections of this file from the top.** They are newest-first.
   Anything marked ⏸️ or ⛔ further down has been checked against the top before
   you trust it — that is the failure this file has already had once.
2. **`14-SALES-WORKSPACE-PHASES.md` is the build order.** A–E are done, **F ·
   Goals is next** and has all its dependencies met. `08-TWELVE-STEPS.md` covers
   the earlier capture→converse half and is finished bar Step 12.
3. **`12-LIFECYCLE-SPEC.md` is the system's shape** — read it before building
   anything structural. `16-EXTRACTING-THE-CRM.md` holds the four rules that keep
   the module liftable; check any new import against them.
4. **Verify, do not remember.** The migration number in the header, the row
   counts and the applied state all get read from the live database — this file
   was wrong about all three on 2026-09-16.
5. **Then open it as Sarah**, as the sales manager, and as somebody in AI &
   Digital who should see nothing. See the habit below.

### ⚠️ The one habit this project has had to learn five times

**A screen signed off from an Admin session has not been tested.** An Admin is a
member of nothing and sees everything, so every predicate that turns on
membership or department silently passes for them. Migrations 105, 121, 125,
129 and 130 are all the same bug on five different tables, and every one of
them was found by a real person logging in as themselves.

Before calling anything done: open it as a salesperson, as their manager, and as
somebody in a department that should see nothing.
