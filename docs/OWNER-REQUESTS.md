# 📌 OWNER REQUESTS — verbatim log

> **Why this file exists.** The owner may switch accounts or start a fresh session at any time. Chat history does not travel; this file does. **Read it after `SESSION-STATE.md`** and before doing any UI work.
>
> Requests are recorded **in the owner's own words**, because a paraphrase loses the thing that mattered. Each has a status and, where it is done, a note on what was actually changed.

---

## ▶️ PASTE THIS TO RESUME (any account, any session)

```
Resume the CNI CRM project.

Read these files first, in this order:
  1. docs/SESSION-STATE.md                     (where we stopped)
  2. docs/OWNER-REQUESTS.md                    (my standing requests, verbatim)
  3. docs/PROGRESS-TRACKER.md                  (done vs remaining)
  4. docs/19-MASTER-SPECIFICATION-REGISTRY.md  (settles any doc conflict)
  5. docs/20-IMPLEMENTATION-CONTRACTS.md §9    (build order)

Then continue from the "NEXT ACTION" in SESSION-STATE.md §3.
Do not restart or re-plan anything already marked complete.
Honour every ✅ and 🔴 item in docs/OWNER-REQUESTS.md.
```

---

## 🔴 STANDING RULES — never violate these

| # | Rule, in the owner's words | Where it is enforced |
|:--:|---|---|
| R1 | *"Do not implement any phase without my permission. When I say to you to implement the phase then you will implement the phase. Go from each phase step by step but do not go all in on a single phase."* | Stop at every step boundary and report. |
| R2 | *"Commit, push to GitHub and update these docs after every change — not batched at session end."* | Every commit. |
| R3 | *"Everything needs to be reported and everything needs to be documented as well, what we do and what we update in the project. Keep documenting that so if we have to re-continue the session, you can continue from there."* | `SESSION-STATE.md`, `PROGRESS-TRACKER.md`, this file. |
| R4 | **Sales management and workflow automation are NOT to be built.** *"I don't want you to implement it… I was just giving you an example that professional CRMs look like this."* A possible direction once the system is in real use. | Doc 01 scope unchanged. |
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
| D6 | *"If my cursor is not on it it should just close and only show the icons, and when I put my cursor on it it should come back."* → hover-to-expand rail, 72px ↔ 264px, 240ms. | ✅ |
| D7 | *"I don't want it to cover the page. I want it to push its space into the page… it should just expand or squeeze the page but not cover the contents."* → the content's left padding tracks the rail and animates with it. **Claude initially chose overlay and was wrong; do not revert to overlay.** | ✅ |
| D8 | *"Once it closes and only the icons appear… they just move a little bit up… they jump up and leave a lot of space in the bottom. The icons should stay where they were when the sidebar was opened."* → the brand block is a **fixed `h-[148px]`**, so swapping the full lockup (112px tall) for the compact mark (30px tall) no longer drags every nav item up by 82px. | ✅ |
| D9 | *"The icons are like small and the bars are really small. I want them very readable and very visually appealing."* → workload bar `sm` → `lg`, avatar `sm` → `md`, percentage `text-body-sm` → `text-h3`. | ✅ |

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
| O1a | **Walk `/setup` yourself, once, and keep the codes** | `npm run dev` → http://localhost:4310/setup. It shows ten recovery codes **once** and never again — only their hashes are stored, so nobody, including this system, can reproduce them. Print them. After you submit, the route closes permanently: at most one `super_admin` row can exist in this database, ever. |
| O2 | **Rotate three secrets** | Resend key + DB password ×2. See R5. |
| O3 | **Create the Resend account** | Step 5's only external dependency. Sandbox sender `onboarding@resend.dev` needs no DNS — but only delivers to the Resend account's own address, so one person can walk the flow and the team cannot be onboarded until a real domain is verified. |
| O4 | ~~Owner has not visually reviewed most of the UI~~ | **Session 11: reviewed in Chrome.** Login, dashboard, tasks board, task drawer, the rail hover-expand pushing the content, light and dark mode all verified by eye at 1600px. Two gaps remain: **(a)** narrow-viewport layout is unverified — Chrome on Windows will not resize below ~500px, so 375px is still untested by eye, and **(b)** HTML5 drag-and-drop cannot be driven by synthetic mouse events, so the drag was not exercised in automation. The status dropdown in the task drawer takes the same code path and was verified end to end. |
| O5 | **Narrow-viewport pass** | Every layout uses responsive grids and the mobile drawer is -gated, but nobody has looked at it on a phone. Worth ten minutes on a real device before the team uses it. |
