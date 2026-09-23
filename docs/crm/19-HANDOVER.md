# ⭐ HANDOVER — read this first, every time

> **Owner, 2026-09-22:** *"Next time when I come back I instruct the session
> agent: go and read what we were doing, how much we have done, what is left, and
> everything. He should know exactly what things are, how to prioritize them,
> what things to keep in mind … He should know how to work next."*

This file is that briefing. It is written for somebody who has never seen this
codebase and has no memory of the conversation. Read it top to bottom — it takes
about ten minutes — and you will know what exists, what is proved, what is left,
and how to work here without breaking anything.

| | |
|---|---|
| **Written** | 2026-09-22 |
| **Branch** | `main` (the CRM was merged and deployed 2026-09-12; the old `crm` branch is behind and should not be used) |
| **Deployed** | Vercel, region `sin1`. Every push to `main` deploys. Live at **https://taskly.aidigitaldivision.com** |
| **Head commit** | `14da113` — *Clients: nothing is cut off, and the Owner column earns its place* (deploy **success**) |
| **Database** | Supabase, `ap-southeast-1`. Last migration applied **249**. Next CRM migration number: **250** |
| **Tests** | 149 files, 3778 tests, all passing. Typecheck, lint and `scripts/smoke.mjs` all green at the head commit |
| **Where the work stopped** | The CRM is **paused on the owner's instruction**. The next work is the team's live problems with the system — see §8 |

---

## 1 · What this product is, in five lines

Taskly is the division's internal system (tasks, projects, attendance, content
studio, finance). Inside it lives a **CRM — the Campaign & Lead Desk** — for
leads produced by Meta campaigns and worked by the sales team: leads arrive,
salespeople work them over WhatsApp, an AI agent answers routine questions and
hands over anything that is a decision, quotations and invoices follow, and a
won lead becomes a **client**.

It is in **preview**: the CRM pages are visible only to Sarah, Sahad, the sales
manager tester, and admin/super_admin (migration 143).

**Two organisations matter and they are not the same thing.**
*Crescent Nova International — AI & Digital Division* is us. *Chitral Royal
Homes* is a **client of ours** whose 641 real leads live in the system.

---

## 2 · The rules that outrank everything

These are not preferences. Each was learned by something breaking, and the owner
has asked for several of them more than once.

### Rule Zero — the interface answers immediately

`CLAUDE.md` at the repo root carries it in full, and it **outranks every other
instruction in the repository**. The one sentence:

> Every click must change the screen in its own frame. If the answer needs the
> network, show the part you already have and let the rest arrive underneath it.

Five laws follow it (opening and closing is free · the URL records what is open
but does not gate it · never re-fetch what the page already holds · fetch in one
wave not a chain · a policy helper must not be re-evaluated per row). Read it
before writing any component. `docs/20-UI-RESPONSIVENESS.md` has the
measurements behind it.

### ⚠️ Client data is never used for testing

Owner, 2026-09-12: *"Chitral Royal Homes or any other project is my client. I
can't use their data for testing purposes. I will use my own."*

Everything is built and demonstrated on the project whose name ends `[demo]` —
**Demo — Product Enquiries [demo]**. Never move, message, or count a Chitral row
to try something out. Every seed script in `scripts/` refuses to run if it cannot
find the demo project.

### ⚠️ No message ever reaches a real person by accident

Several database triggers send WhatsApp automatically (a new lead is greeted, a
booked appointment is confirmed and reminded, a received payment is
acknowledged). All of them stand down on `whatsapp_consent = false`, and the
greeting also stands down on `app.crm_quiet_insert = 'on'`. Test rows use
`+92 300 000 00NN` (an unallocated range) and `.example` addresses.
**A seed script proves this rather than claiming it** — see
`scripts/seed-clients-showcase.mjs`, which counts queued auto-sends afterwards
and fails if the count is not zero.

### ⚠️ The tracker is updated every session, without asking

Owner's standing order. `docs/crm/00-STATE-AND-TRACKER.md` is the chronological
log: newest entry at the top, what changed, what was measured, what is still
open. Never ask permission to update it.

### ⚠️ Nothing is reported as working until it has been watched working

Tests passing is not evidence that a screen is right. A PDF with twelve passing
tests once printed "Posts Publishe / d". The recipes in §7 are how things get
checked here: a real browser, a real session, a real file read back.

---

## 3 · The CRM, page by page

Every page below is **built, deployed and in use**. "Proved" means it was driven
in a browser as a real user, not that it compiles.

| Page | Route | What it is | State |
|---|---|---|---|
| **Campaign & Lead Desk** | `/leads` | The manager's view of every lead, the campaigns behind them, and the importer | Done |
| **My leads** | `/my-leads` | The salesperson's own list. ⭐ **The reference implementation of Rule Zero** — copy its patterns (`use-panel.ts`, `leadFromRow`, the one query wave) | Done |
| **Conversations** | `/conversations` | The WhatsApp thread per lead, the agent's replies, hand-over to a person | Done |
| **Appointments** | `/appointments` | Site and office visits, calendar and list, outcomes, confirmation | Done |
| **Follow-ups** | `/follow-ups` | What is owed now and what will be sent: My queue · Scheduled · Sequences · Completed, with per-follow-up conditions | Done |
| **My to-dos** | `/todos` | The salesperson's own tasks | Done |
| **AI Knowledge** | `/knowledge` | What the agent may say: sources, answers, policy per project, gaps, and a test drawer | Done |
| **Clients** | `/clients` | ⭐ **The most recent work.** Relationships, not leads: table and cards views, preview panel, import, export, add/edit | Done — three passes, see §4 |
| **Lead reports** | `/lead-reports` | Manager reporting | Done |
| **Live overview** | `/lead-overview` | Manager's live view | Done |

**The AI agent** (`lib/ai/agent-brain.ts`, `lib/crm/agent-runner.ts`) answers a
client on WhatsApp inside the 24-hour window. Its rule, in the owner's words:
answer questions; hand over **decisions, changes and commitments**. It may say
when an existing appointment is, but not move it.

---

## 4 · What happened in the last four sessions, in order

This is the part a returning session most needs. Each row is a real commit on
`main`; each deployed on push and was verified.

| Commit | What shipped |
|---|---|
| `4ce0638` | The agent stops escalating simple questions; the screen shows a hand-over |
| `5328ba2` | The eight-message limit is gone — the agent keeps engaging |
| `ef5bbb5` | **The Follow-ups page**: what is owed now, and what will be sent |
| `dfbecab` | Asking *when* an appointment is, is not asking to change it |
| `8ade26a` | Still (white) cards, drawn tabs, and follow-up conditions the sender obeys |
| `3e38023` | Nine things the owner found on Follow-ups, each measured before it was changed |
| `4b57399` | The date-range popover opens where it can be seen |
| `8a83047` | **The AI Knowledge page** — the owner's design, and not one invented number |
| `c434dc0` | AI Knowledge: a policy that works, per-project knowledge, delete a source, test drawer |
| `201a4b8` | **The Clients page** — the owner's design, on the client model that already existed (migration 249) |
| `db0c12c` | Clients, 2nd pass: the design read out of the PNG; exports in Excel, CSV and PDF; self-hosted fonts |
| `14da113` | Clients, 3rd pass: nothing is cut off; the Owner column appears only when it means something |
| `593f571` | **Team performance** — one page for how a person is actually doing |
| _(head)_ | Performance, 2nd pass: the owner's reference, matched by measurement |

### The Performance page in detail (2026-09-23)

`/performance`, Coordinator-and-above. It answers *"how is this person doing"*;
`/reports` still produces the document, and is **untouched** — the header's
"Export report" button links there rather than growing a second exporter.

- **Built to the owner's image by measurement**, per
  `20-BUILDING-A-SCREEN-FROM-A-DESIGN.md`: colours sampled out of the PNG into a
  `.perf-ui` token block, type sizes solved from **ink widths** (⚠️ see §3 of
  that doc — the first build solved them from cap heights and every string came
  out 20–35% too large), lengths divided by the 0.9 zoom.
- **The pill says "Live data".** The reference's says "Sample data"; same pill,
  same place, true word, because every figure is read from the database.
- **A gap never looks like a zero.** No deadline in the period shows `—`, not
  `0%`; a strip names how many completed tasks are unverified.
- **The four filters are the data** — period, team (9 live departments), project
  (18 with tasks), person. ⚠️ Projects are filtered on `is_draft`, **not**
  `deleted_at`: migration 053 adds that column and has never been applied.
- **Only the period, team and project touch the server.** The person filter, the
  tabs, the selection and the drawer are client state (Rule Zero laws 1–3); the
  three that re-read rows go through the URL under `useTransition`, so the old
  table dims rather than disappearing.
- **The AI panel is right before any model is called.** Its four blocks are
  computed from the figures on the page; asking replaces the sentence with
  gpt-4o's prose and never supplies a figure. `verifyFigures` still reports any
  number the model wrote that is not in the fact sheet, and an evidence link is
  shown only while the prose still names what the link opens.
- **Compare, Projects & teams, Assessments and Reports tabs** say what they will
  hold and which of them the data already supports. Assessments is the one that
  genuinely cannot be built yet — a self-review is written by a person, so it
  needs a table of its own.

### The Clients page in detail

A **client** is a person we have a relationship with — somebody who is buying:
quotations, invoices, bookings. They are linked to projects **through their
leads** (migration 111's rule), so one person enquiring about two things is one
client, and visibility follows the leads.

- **Migration 249** added the relationship fields (company, source, owner,
  preferred channel, status, archive, `CLI-01001`-style number) and the page's
  one reader `app.crm_client_board()` — which computes access **once per
  project**, not per lead (Rule Zero law 5); its own self-check compares it with
  the older reader per person and refuses to commit on any difference.
- ⚠️ **A client added by hand gets a lead, and that lead is NOT won** — it opens
  as `contacted`, because a won lead would count as a sale in every report.
- ⚠️ **And it is not greeted** unless the box is ticked; imports never greet.
- **Exports**: Excel (`lib/view/xlsx-write.ts`, dependency-free), CSV, and PDF
  (`lib/pdf/client-list-pdf.ts`) on the company letterhead. The ids come from the
  screen but the rows are re-read as the caller, so a PDF cannot hold a client
  that person may not see.
- **Imports**: CSV and .xlsx, columns found by their names, every row checked
  before anything is written, 500 at a time, one notification per sheet.
- **The Owner column is decided by what is on screen**, not by a role: if every
  client listed belongs to the person reading it, the column, the "All owners"
  filter and the panel's "Assigned to" disappear and their width goes to the
  email.
- **The filters are the data** — project, owner and city are built from the rows,
  so a new project appears in the filter the moment its first client does. Only
  Relationship and Source are fixed lists, because both are database enums.

---

## 5 · Demo data — what exists and how to control it

| Script | What it makes | Undo |
|---|---|---|
| `node scripts/seed-crm-demo.mjs` | The demo project and its 18 enquiries | `--remove` |
| `node scripts/seed-desk-showcase.mjs` | The seven lead-desk rows from the owner's design | re-run |
| `node scripts/seed-clients-showcase.mjs` | ⭐ **12 clients** covering every status and colour, with quotations, bookings, invoices, appointments, follow-ups and messages | `--remove` |
| `node scripts/seed-catalogue.mjs` | Demo properties and prices | — |

The 12 showcase clients are `CLI-01009`…`CLI-01020`, owned by Sarah and Sahad,
all on the demo project. They are what the Clients page was designed and
measured against. **Only Sarah's nine are visible to Sarah** — which is also how
the RLS is checked.

---

## 6 · What is left

⚠️ **First: `docs/TEAM-ISSUES.md`.** The CRM is paused (§8).

**Waiting on the owner's designs** — the Performance tabs. The owner said the
other tab images are coming; the page says so on screen rather than pretending
they are built.

| Tab | Data ready? |
|---|---|
| Compare | Yes — every figure exists per person and per project |
| Projects & teams | Yes — a grouping of what Overview already reads |
| Assessments | **No.** Needs a table: an assessment is written by people |
| Reports | `/reports` already exports CSV, Excel and PDF, unchanged |

Nothing on the Clients page is outstanding. These are the honest next items,
in the order they are worth doing **once the owner returns to the CRM**:

1. **Invoices page.** The owner said it is next: *"Definitely I will work on the
   next invoice page."* The data is all there (`crm_invoices`, the letterhead,
   `lib/pdf/invoice-pdf.ts`); the screen is not.
2. **Answer the two open questions in §9** before they become rework.
3. **Phase F of `14-SALES-WORKSPACE-PHASES.md`** — the sales workspace order
   continues from there.
4. **A real project for the demo clients.** They all sit on one project, so the
   project filter has one entry. Nothing is wrong; it just cannot be *seen*
   working until a second project has a client.
5. **Urdu in PDFs.** pdf-lib with the standard fonts cannot draw Urdu script —
   such names become dashes in a PDF (CSV and Excel keep them). Fixing it means
   embedding a Unicode font with fontkit. Nobody has asked yet.

---

## 7 · How to check anything (the recipes that actually catch bugs)

⚠️ **`npm run <script>` does not work here** — the `&` in the folder path breaks
it. Call the binaries directly.

```bash
node_modules/.bin/tsc --noEmit -p .            # typecheck
node_modules/.bin/eslint <paths>               # lint
node_modules/.bin/vitest run                   # the whole suite (~10s)
node scripts/smoke.mjs                         # every route renders, for both roles
node scripts/migrate.mjs lib/db/migrations/NNN_name.sql
```

⚠️ **Never run `next build` while the owner's dev server is up** (port 4310) —
they are usually looking at it.

### Seeing a page as a real person

The demo `@cni-demo.com` accounts are gone, so a probe **mints a session**: write
a row into `public.sessions` with `refresh_token_hash = sha256(token)`, then set
the cookie `cni_session=<token>.<hmac-sha256(token, SESSION_SECRET)>` (base64url).
Drive it with Playwright from `C:/Users/ummeh/AppData/Local/Temp/pwdrive`. The
last session's probes are the template: `full.mjs` (screenshots + a clipping
audit), `nothing-cut.mjs` (clicks every row and checks every value fits),
`export-probe.mjs` (exports all three formats and reads them back),
`pdfshot.mjs` (renders a PDF's pages to PNG so the layout is *looked at*).
Always delete the session row afterwards.

### The measurements that decide UI arguments

- The app renders at **`zoom: 0.9`** — a 32px control in a design is `2.2rem`
  here. Divide every reference pixel by 0.9.
- Sample a design's colours from the PNG: fills from the **most common** pixel of
  a flat area, ink from the **most saturated** pixel of a glyph (anti-aliasing
  lightens edges, so a darkest-average reads too pale).
- Solve a font size instead of guessing it: measure the ink width of a known
  string in the reference, then `size = px / (canvas.measureText(s).width / 100)`.
- Prove nothing is cut off: walk the DOM for `scrollWidth > clientWidth`.

`20-BUILDING-A-SCREEN-FROM-A-DESIGN.md` is the full method, written up after the
owner had to ask twice.

---

## 8 · ⏸️ The CRM is paused — the live system issues come first

Owner, 2026-09-22: *"Right now my team and I are facing a lot of issues with the
system so prioritize them also. Definitely they are working so I want to resolve
them first. Then I will come back to this CRM again."*

**So: do not start new CRM work.** The active file is **`docs/TEAM-ISSUES.md`** —
the triage board for what the team reports. It carries the intake shape, the
priority scale, and the rule that a reported problem is reproduced before it is
fixed. Read it and work from it.

When the owner says they are coming back to the CRM, return to §6.

---

## 9 · Open questions — waiting on the owner

| # | Question | Why it matters | Asked |
|---|---|---|---|
| **C1** | Should a **salesperson** be able to approve AI Knowledge answers and upload sources? Today they can — Sarah approved all 28. | An approved answer is what the agent says to a client without a human seeing it. If approval should be the manager's, it is a policy change (`crm_knowledge_update`). | 2026-09-22 |
| **C2** | Is **"Sales consultant"** a real role or just a job title? It does not exist in the system — only `role_title`, which is free text. | If it is real it needs its own permissions; if not, the mock-ups should stop implying it. | 2026-09-22 |
| **C3** | The PDF export uses the **existing invoice letterhead** (`system_settings → invoice_company`). Is that the header you want, or is there a specific image? | Changing it later is a settings edit, not code — but the answer decides whether any code is needed at all. | 2026-09-22 |

Answered already, recorded so nobody re-asks:

- **`/security` is admin-and-up** (owner's decision, 2026-08-22).
- **A walk-in added by hand gets no greeting** unless the box is ticked — the
  owner confirmed this is what they want.
- **A client is somebody who is buying** — quotations, invoices — not every lead.

`05-OPEN-QUESTIONS.md` holds the older ones and what each answer changes.

---

## 10 · The traps that have already cost a day each

Every one of these is real, and most are invisible until something is wrong.

| Trap | What happens | What to do |
|---|---|---|
| **The dev server silently drops webfonts** | `next dev` cannot reach Google Fonts here, logs a warning into `.next/dev/logs/`, and draws **Arial**. Every local judgement about type was wrong for months. | The three faces are self-hosted in `app/fonts/` now. Never add a `next/font/google` import to the app shell. |
| **A `STABLE` policy helper runs per row** | 659 leads took 1,214 ms; at 200k rows that is six minutes. | Write the rule argument-free and wrap it as a scalar subquery — `(select app.fn())` is an InitPlan, computed once. Never mark such a helper `IMMUTABLE`: it would leak one person's answer to another. |
| **`fr` grid tracks keep `min-width: auto`** | One long email widened its own column and cut the phone number beside it. | `minmax(0, 1fr)`, always. |
| **A fixed overlay inside `space-y-*`** | The page shifts and grows a scrollbar when a panel opens. | Render overlays outside the column, portalled to `document.body` — a transformed ancestor also traps `position: fixed`. |
| **Live function bodies are CRLF** | A migration that injects into `pg_get_functiondef` with `\n` matches nothing. | Use `\r?\n` — and have the migration check its own injection afterwards. |
| **A cap height is not a type size** | Every string on the Performance page came out 20–35% too large, and six labels shipped clipped. | Solve the size from the string's **ink WIDTH** through a canvas in the app's own resolved font. A width is 60–450px of signal; a height is 10–24, and anti-aliasing owns two of them. |
| **`--pf-on-teal` flips in the dark theme** | White ink on the violet button became `#04181c` — correctly, since the dark teal it was named for is light. | Ink on a fill that is dark in **both** themes needs its own token (`--pf-on-solid`). |
| **Python heredocs eat regex escapes** | `\b` became a literal backspace inside a `.ts` file; tests failed for a reason the source did not show. | Write the script to a `.py` file and build backslashes with `chr(92)`. |
| **Supabase returns 400 for a missing object** | A delete "fails" although the object was never there. | Read the body: `not_found` / `NoSuchKey` is a success. |
| **An admin session cannot test access** | One membership-predicate bug shipped seven times. | Check every change as **Sarah** (a salesperson) as well as an admin. |
| **`withAppRole` narrows harder than you think** | A bare table read under it returns zero rows for everybody. | Read through the definer function, or with `withUser`. |
| **Turbopack bundles pdfjs away from its worker** | Every quotation PDF reported "not a PDF". | `serverExternalPackages`, and never set `workerSrc`. |
| **The WhatsApp test number lies** | It accepted free text 26 hours after the last inbound. | The 24-hour window is enforced in code, not discovered by testing. |

---

## 11 · The map of the documentation

| File | What it is for |
|---|---|
| **`docs/crm/19-HANDOVER.md`** | ⭐ this file — the cold start |
| `docs/crm/00-STATE-AND-TRACKER.md` | The chronological log. Newest first. Updated every session |
| `docs/crm/20-BUILDING-A-SCREEN-FROM-A-DESIGN.md` | ⭐ how to build a screen from one of the owner's images, and the mistakes that made it necessary |
| `docs/TEAM-ISSUES.md` | ⭐ the live triage board — **the current work** |
| `docs/OWNER-REQUESTS.md` | Every standing request in the owner's own words, with status |
| `docs/crm/05-OPEN-QUESTIONS.md` | What only the owner can decide |
| `docs/crm/14-SALES-WORKSPACE-PHASES.md` | The build order for the sales workspace (phases A–H) |
| `docs/crm/12-LIFECYCLE-SPEC.md` | The owner's own lifecycle research, measured against what the system does |
| `docs/crm/03-DATA-MODEL.md` · `09-DATABASE-MANAGEMENT.md` | The tables and the rules they follow |
| `docs/TASK-MANAGEMENT-STUDY.md` · `docs/TASKS-FIX-PLAN.md` | How tasks actually work, and the flaws found in them |
| `CLAUDE.md` (repo root) | **Rule Zero.** Outranks everything |
| `docs/20-UI-RESPONSIVENESS.md` | The measurements behind Rule Zero |
| `docs/18-DESIGN-SYSTEM-AND-BRANDING.md` | Tokens, type and the brand |
