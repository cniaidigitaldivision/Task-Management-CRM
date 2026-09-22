# 📌 OWNER REQUESTS — verbatim log

> **Why this file exists.** The owner may switch accounts or start a fresh session at any time. Chat history does not travel; this file does. **Read it after `SESSION-STATE.md`** and before doing any UI work.
>
> Requests are recorded **in the owner's own words**, because a paraphrase loses the thing that mattered. Each has a status and, where it is done, a note on what was actually changed.

---

## ▶️ PASTE THIS TO RESUME (any account, any session)

```
Resume the CNI Taskly project.

⚠️ 2026-09-22 — THE CRM IS PAUSED. The team's live problems with the system come
first. Read, in this order:

  1. docs/crm/19-HANDOVER.md        ⭐ the ten-minute briefing: what exists, what
                                      is proved, what is left, the traps
  2. docs/TEAM-ISSUES.md            ⭐ THE ACTIVE WORK — the triage board
  3. CLAUDE.md (repo root)          Rule Zero: the interface answers immediately
  4. docs/OWNER-REQUESTS.md         my standing requests, in my own words
  5. docs/crm/00-STATE-AND-TRACKER.md   the log — newest entry at the top

Only when I say I am coming back to the CRM:
  6. docs/crm/20-BUILDING-A-SCREEN-FROM-A-DESIGN.md  before ANY UI work
  7. docs/crm/14-SALES-WORKSPACE-PHASES.md           the build order

Do not restart or re-plan anything already marked done. Update
docs/crm/00-STATE-AND-TRACKER.md every session without asking.
```

---

## 🔴 STANDING RULES — never violate these

| # | Rule, in the owner's words | Where it is enforced |
|:--:|---|---|
| R1 | *"Do not implement any phase without my permission. When I say to you to implement the phase then you will implement the phase. Go from each phase step by step but do not go all in on a single phase."* | Stop at every step boundary and report. |
| R2 | *"Commit, push to GitHub and update these docs after every change — not batched at session end."* | Every commit. |
| R3 | *"Everything needs to be reported and everything needs to be documented as well, what we do and what we update in the project. Keep documenting that so if we have to re-continue the session, you can continue from there."* | `SESSION-STATE.md`, `PROGRESS-TRACKER.md`, this file. |
| R4 | ~~**Sales management and workflow automation are NOT to be built.**~~ *"I don't want you to implement it… I was just giving you an example that professional CRMs look like this."* **AMENDED 2026-08-15 — see R4a.** | Doc 01 scope unchanged for sales. |
| R4a | **Workflow IS now wanted, in one narrow form only.** Owner asked for the workflow editor from `crm model options ui/` to be built. R4 was put to them with their own words quoted; they chose **E-004 task handoff chains wearing that editor's node-canvas UI**. So: the *look* of the reference — dot-grid canvas, node cards, connectors, breadcrumb — over the behaviour already designed in doc 12 E-004 ("Kashif finishes the reel → the system creates the next task and assigns it to Yusra via the smart engine"). **Sales management remains out of scope, and so does the reference's actual engine.** ⛔ The nodes are CRM concepts — task template, assignee rule, notification. **Never Shell Script, HTTP Request or Web Hook**, which is what the reference's nodes really are: arbitrary code execution and outbound SSRF, inside a system whose whole design is RLS, least privilege and a credentials vault. Adding those would be a new security boundary, not a feature. | Built after UI steps 7–9. Doc 12 E-004. |
| R5 | **Never handle the owner's secrets.** Three were pasted into chat in Session 09 — Resend key, DB password twice (one echoed by a Claude diagnostic script's error output). All need rotating. `npm run check:db` redacts and is safe to share; the connection string is not. | `.env.example` carries a warning at the Resend line. |

---

## ✅ DESIGN DECISIONS THE OWNER HAS MADE — do not reverse these

| # | Decision, in the owner's words | Status |
|:--:|---|:--:|
| D1 | *"I want some things like the sidebar and the option packages to remain in the dark colour no matter what the theme is."* → the nav rail is **theme-invariant**. Tokens live outside both theme blocks (doc 18 §6a). | ✅ |
| D2 | *"The white plate behind it… does not look good. Behind the logo just add a gradient glow of gold colour and make it more shaded."* → four-layer gold aura, no rectangle, no border (doc 18 §9a). | ✅ |
| D3 | *"Some buttons are big and some are small. Some dropdowns are bigger than the normal screen."* → one control scale in `components/ui/control.ts`; **no component sets its own height**. Verify on `/design-system` → **Controls**. | ✅ |
| D4 | *"The legend on the CRM dashboard is absolutely not readable."* → rebuilt as a grid of tiles with the count large and in primary text. | ✅ |
| D5 | *"It looks like a clunk of tasks all jumbled up together… everything is just on top of each other."* → `PageSection` primitive: headings, numbered reading order, 32px between sections. | ✅ |
| ~~D6~~ | ~~*"If my cursor is not on it it should just close and only show the icons, and when I put my cursor on it it should come back."*~~ → **SUPERSEDED by D10 (Session 17).** The collapsed resting state it asked for is kept. The hover trigger is gone. | ⛔ |
| D7 | *"I don't want it to cover the page. I want it to push its space into the page… it should just expand or squeeze the page but not cover the contents."* → the content's left padding tracks the rail and animates with it. **Claude initially chose overlay and was wrong; do not revert to overlay.** | ✅ |
| D8 | *"Once it closes and only the icons appear… they just move a little bit up… they jump up and leave a lot of space in the bottom. The icons should stay where they were when the sidebar was opened."* → the brand block is a **fixed `h-[148px]`**, so swapping the full lockup (112px tall) for the compact mark (30px tall) no longer drags every nav item up by 82px. | ✅ |
| D9 | *"The icons are like small and the bars are really small. I want them very readable and very visually appealing."* → workload bar `sm` → `lg`, avatar `sm` → `md`, percentage `text-body-sm` → `text-h3`. | ✅ |
| **D10** | *"When I hover on the sidebar it opens by itself. I don't want that functionality — I want it to open when I click the small button beside it."* → **reverses D6.** Hover expansion removed from the rail and from the shell; the Phase 6 tab is the only control. **D7 is NOT reversed — it still pushes, never covers.** | ✅ |
| **D11** | *"Two settings icons — I don't want that. Below the user I can go to the profile, I can do the settings… I don't want that there."* → `/settings` appeared twice, in the nav's System section and as "Workspace settings" under the user. The duplicate under the user is gone. | ✅ |
| **D12** | *"It's a little bit left sided than the original icons — centre it like the other icons in the sidebar."* → there were three icon axes in one rail (32.5 / 38 / 28px). The footer now uses a nav link's exact geometry; everything measures **32.5px**. | ✅ |
| **D13** | *"The dashboard should be above the My Work option in the sidebar."* → done in `nav-config.ts`. A Member has no Dashboard (ADR-003), so their rail still opens on My Work. | ✅ |
| **D14** | *"If I click the search it should just search there… the cursor should start blinking over there… I don't want it to pop up and give another screen, it's looking very bad. There should be a small magnifier I can click."* → a real `<input>` in the top bar with results anchored under it. No overlay, no backdrop. ⌘K focuses it. | ✅ |
| **D15** | *"It just blurs — I don't want it to blur, I want the task to remain as it is."* · *"It should fit into the next column, push the other ones down… like a magnet is pulling it towards it. I don't want it flickering around."* → the native HTML5 drag API can do none of that (its drag image is unstyleable, `dragover` is coarse, there is no drop position, nothing animates). Board rebuilt on pointer events with a real gap and FLIP. | ✅ |
| **D17** | *"For scrolling towards the left or right the scrollbar is literally at the bottom — I don't want to scroll down to the bottom just for moving to the right."* → six options offered; the owner chose **a floating bar pinned to the bottom of the viewport**. A scrollbar-height proxy mirrors the board's scroll, `position: sticky; bottom: 0` keeps it on screen until the board's real end appears, and the board's own bar is hidden so there is only ever one. [REDESIGN-PLAN §8.6](REDESIGN-PLAN.md). | ✅ |
| **D16** | *"Whenever I drag one task to another column the other tasks just start flickering… they move up and down up and down… they start shivering."* → the first rebuild had **three** causes of exactly that, and proving the fix exposed a fourth that stopped the animation entirely. All four are documented in the header of `components/task/task-board.tsx` and in [REDESIGN-PLAN §8.5a](REDESIGN-PLAN.md). Measured, not eyeballed: 0 style writes across 25 moves with the gap stationary; 69 when it moves; gap index monotonic over a 64-step sweep. | ✅ |

### 🔴 OPEN — twenty-six changes requested in Session 20

One instruction covering 26 separate changes — 9 bugs and 17 features. Written up
in full, with the owner's own words against each, in
[**`CHANGE-PLAN.md`**](CHANGE-PLAN.md). **Nothing has been built yet**; the
owner's instruction was *"ask me questions… confirm to me every single thing…
and after I have confirmed, document them, then implement them."*

Twelve decisions were taken before documenting, and each one is recorded in that
file's second section. The three that reversed or narrowed what was literally
asked for, so they are not silently lost:

| Asked | Decided | Why |
|---|---|---|
| *"Make the Clear button's functionality deleting the selected task"* | **Clear stays Clear.** A separate **Cancel selected** is added, plus **Purge** for the Super Admin behind step-up | A button that silently changed from "deselect" to "destroy" is the worst possible reading of the request |
| *"Delete"* | **Cancel** (reversible, keeps history) for everyone; **Purge** (irreversible) Super Admin only | `task.purge` already exists in the permission matrix and has never had a screen |
| *"Pagination… after every 12 or 13 rows"* | **Tables and lists only, 12 rows.** Not the board | Dragging a card to a task on another page is impossible — paging the board would break what Sessions 17–19 fixed |

Four things need the owner before they can be built: a **public Supabase bucket**
for avatars, a **migration** for per-type project fields (rule R1), **one new
dependency** for real `.xlsx` export, and the **Resend sending domain** — until
that exists the password-reset status trail will honestly say *"not sent — no
mail domain"* rather than imply an email arrived.

### 🔴 OPEN — the supplied task-board design has never been planned

> *"The file I have told you to redesign is totally not there."* — Session 17

`CNI-AI-Digital-Task-Board.html` has sat in the repository root since commit
`141669f` and **is referenced by no planning document at all**. The whole
seven-phase redesign was written and executed without it, which is why work the
owner expected never appeared — it was never on any list.

It is now [REDESIGN-PLAN §9](REDESIGN-PLAN.md). **It needs a decision from the
owner before any code**, because it collides with doc 18 and ADR-011: its palette
and type system are close to, but not the same as, the tokens the whole
application is built on. Guessing which of "restyle the board", "adopt it
everywhere", or "build that page for real" was meant would be worse than asking.

### ⚠️ The trap in D8 — read this before touching the rail

Anything inside the rail that **changes height** between the collapsed and expanded states will drag every item below it. Fading with `opacity` is safe (the element keeps its space); swapping elements of different heights is not.

If a nav item ever appears to "jump" during the animation, look for a height change above it first — that is almost certainly the cause, not the animation itself.

---

## 🎯 STANDING QUALITY BAR

In the owner's words, across several sessions:

> *"I want it to look professional, easy to use, sleek, and very vibrant… I want good combinations of colour, good effects, and some aesthetics so it looks visually appealing while using it and doesn't look dry and pale."*
>
> *"I want you to design the cards in such a way that they are so easy and so plain to read and so easy to understand… so whenever a user opens it, it catches their eye and instantly tells them what the CRM is about."*
>
> *"This is going to be used in the main company and I don't want it to look bad and pale."*
>
> *"Go through professional CRMs if you have to. Learn from them, analyse them."* → done in Session 09; the researched pattern is **KPI cards first → one primary visualisation → supporting tables last → named, spaced sections**, and *"add a chart only when a list stops answering the question."*

---

## 🔴 SESSION 11 — "make everything operational, I am demoing tonight"

The owner's instruction, in their words:

> *"Right now don't implement that [5.2] first but firstly implement all the operations of the CRM first. I want my CRM to be completely working — everything on the dashboard, everything on the sidebar, every option, every mechanic, every logic, every single thing should work… because I have to show the working of the CRM to my CEO tonight."*

**What this means for anybody picking the project up:** functional work was deliberately pulled ahead of the security roadmap. Phase 2's work core and Phase 4's workload engine were built out of order, on purpose, and the sequencing in doc 20 §9 no longer describes what happened. That was the owner's explicit call and it stands.

| Delivered | |
|---|---|
| Migrations 012–014 | 14 work-core tables, 34 RLS policies, session resolution |
| Domain | `task-machine.ts` (doc 05 §2 as an allowlist), `workload.ts` (doc 06) |
| Operations | task create/edit/assign/status/comment/checklist/delete/timer, project create/edit, capacity + skills + leave, profile, theme |
| Screens | all ten routes real — dashboard, my work, tasks, projects, workload, team, reports, settings, profile, security |
| Proof | 640 unit · 30 integration · **25 signed-in route checks** (`npm run smoke`) |
| Demo | [`DEMO-GUIDE.md`](DEMO-GUIDE.md) — accounts, an eight-minute flow, and what is honestly missing |

**Two real bugs this found, both invisible to a build:**

1. **The login form never submitted.** `Button` defaults to `type="button"`, so the submit button did nothing. Every integration test called the action directly, so nothing caught it — the sign-in page had never actually worked from a browser. Now fixed, with the reason written next to it in both auth forms.
2. **A Member could reach `/team` and `/workload` by URL.** Row-level security meant nothing leaked, but the page was reachable. `requireRole()` now enforces the floor (registry C-21).

---

## 📋 OUTSTANDING — not yet done

| # | Item | Note |
|:--:|---|---|
| O1 | **Step 5 — Provisioning & recovery** | Authorised, **in progress**. **5.1 done** (Session 10) — the one-time self-disabling Super Admin setup route at `/setup`, migration 011, verified 8/8. Remaining: 5.2 invitation chain (hashed, 48h, single-use) · 5.3 activation + MFA enrolment · 5.4 forgot-password wiring · 5.5 email templates (needs Resend) · 5.6 login and anomaly alerts. |
| O1a | ✅ **Done — Super Admin created (Session 12).** `/setup` is now permanently closed, which also removed the risk of a stranger claiming ownership once the URL is public. Authenticator enrolment now exists too. | Original note: |
| O1b | **Walk `/setup` yourself, once, and keep the codes** | `npm run dev` → http://localhost:4310/setup. It shows ten recovery codes **once** and never again — only their hashes are stored, so nobody, including this system, can reproduce them. Print them. After you submit, the route closes permanently: at most one `super_admin` row can exist in this database, ever. |
| O2 | **Rotate three secrets** | Resend key + DB password ×2. See R5. |
| O3 | **Create the Resend account** | Step 5's only external dependency. Sandbox sender `onboarding@resend.dev` needs no DNS — but only delivers to the Resend account's own address, so one person can walk the flow and the team cannot be onboarded until a real domain is verified. |
| O4 | ~~Owner has not visually reviewed most of the UI~~ | **Session 11: reviewed in Chrome.** Login, dashboard, tasks board, task drawer, the rail hover-expand pushing the content, light and dark mode all verified by eye at 1600px. Two gaps remain: **(a)** narrow-viewport layout is unverified — Chrome on Windows will not resize below ~500px, so 375px is still untested by eye, and **(b)** HTML5 drag-and-drop cannot be driven by synthetic mouse events, so the drag was not exercised in automation. The status dropdown in the task drawer takes the same code path and was verified end to end. |
| O5 | **Narrow-viewport pass** | Every layout uses responsive grids and the mobile drawer is -gated, but nobody has looked at it on a phone. Worth ten minutes on a real device before the team uses it. |

---

## 🗓️ 2026-09-22 — THE CRM SESSIONS (follow-ups, AI Knowledge, clients)

Recorded verbatim, newest last. Every one of these is **done and deployed**
unless it says otherwise. The reasoning and the measurements are in
`docs/crm/00-STATE-AND-TRACKER.md`; the method is in
`docs/crm/20-BUILDING-A-SCREEN-FROM-A-DESIGN.md`.

| # | The owner's words | What was done | Status |
|:--:|---|---|:--:|
| S1 | *"The client is just asking to confirm the appointment time … any decision-making, then it should be handed over to the salesperson. Otherwise it should engage the client again."* | The agent answers "when is my appointment"; it hands over only decisions, changes and commitments | ✅ |
| S2 | *"These are not tabs. I don't want them colorful because they are not clickable … white color, and these colored icons are fine."* | Statistic cards are white and still; colour lives in the icon. Applied on Follow-ups **and** Clients | ✅ |
| S3 | *"They are highlighted and they are underlined."* | A selected tab carries weight, colour **and** a bar — set inline, because the class lost to the global border colour (measured) | ✅ |
| S4 | *"The background overlay is not on the whole screen … the modal should be in the center."* | Overlays are portalled to `document.body`; a transformed ancestor was trapping `position: fixed` | ✅ |
| S5 | *"When I click on 'Open this lead,' it shouldn't bring me to that lead page … unless it is an open conversation."* | Details open as a modal in place. Only a conversation navigates | ✅ |
| S6 | *"It should be instant for everything."* | Rule Zero. Opening, closing, tabs, views and page turns touch no network | ✅ |
| S7 | *"In the completed follow-ups, display 10 and add pagination … all filters in one row … custom range."* | Done, plus the date-range popover moved so it is never clipped | ✅ |
| S8 | *"I want the exact same UI, same colors, same design … but wired up logically … isolated."* (AI Knowledge) | The page built to the design, on real data, with no invented figures | ✅ |
| S9 | *"Knowledge health … according to the project selected."* + *"let him upload a source or delete a source … I want my agent to respond with the latest information."* | Per-project knowledge; delete a source takes its answers with it (migration 248, admin-only); multi-file upload | ✅ |
| S10 | *"Test agent: a wider drawer with conversation preview, selected project, answer source and handoff result."* | Built | ✅ |
| S11 | *"Here is the proposed Taskly Clients page … create this page accordingly … isolated and will not break any other working thing."* | The Clients page, on the client model that already existed (migration 249) | ✅ |
| S12 | *"The client is basically those persons who are … buying from us."* | Confirmed and written into the model: a client is a relationship, not every lead | ✅ |
| S13 | *"Don't show the export option in the import client … export would be available in Excel and PDF … in the PDF the proper header … a proper table."* | Import offers only import + blank template; Export is its own control with Excel · CSV · PDF; the PDF carries the invoice letterhead | ✅ |
| S14 | *"There is a WhatsApp button. You are showing just one button."* | Every row and card draws WhatsApp, call and email — disabled with a reason when there is no number or address | ✅ |
| S15 | *"If I'm saying that I need the exact same UI, it means you have to put each color, each icon, each styling, and everything the same … Why do I have to tell you again and again?"* | The palette is now **sampled from the image**, the type **solved from ink widths**, the grid **read from the rules in the PNG** — and the method is written down so it is not asked again | ✅ |
| S16 | *"Some bold boards have blurred text … like it is blasting."* | The real cause: the dev server could not reach Google Fonts and drew **Arial** while production shipped Inter. All three faces are self-hosted now | ✅ |
| S17 | *"Add some dummy data … emails, numbers and everything could be visible. I have quotations and I have invoices."* | 12 demo clients covering every status, with quotations, bookings, invoices, appointments and follow-ups — on the demo project, and proved unable to message anybody | ✅ |
| S18 | *"PKR 85.00 … is not properly visible … make them small enough that a full quotation value, a full phone number, and a full email should be kept visible."* | Columns re-budgeted against the longest real strings; checked on every client, both views, both roles — nothing cut | ✅ |
| S19 | *"It's Sarah's dashboard … the owner column you can exclude … in the salespersons' or executive sales role maybe this column will be valuable."* | The Owner column, its filter and "Assigned to" appear only when more than one person owns what is listed | ✅ |
| S20 | *"Later on it should be dynamic data … whatever the project is, those projects will automatically be added to a filter. Is that already doing that?"* | It already was — project, owner and city are built from the rows. Now proved by a test | ✅ |
| S21 | *"Document each and every thing … next time when I come back … he should know exactly what things are, how to prioritize them."* | `docs/crm/19-HANDOVER.md`, `docs/crm/20-BUILDING-A-SCREEN-FROM-A-DESIGN.md`, `docs/TEAM-ISSUES.md`, and these resume prompts | ✅ |
| S22 | *"Right now my team and I are facing a lot of issues with the system so prioritize them … then I will come back to this CRM."* | **The CRM is paused.** The active board is `docs/TEAM-ISSUES.md` | ⏸️ active |
