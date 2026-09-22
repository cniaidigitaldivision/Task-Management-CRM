# The CRM — Campaign & Lead Desk

**If this session closed and you are picking it up cold, read `19-HANDOVER.md` first.**
It is the ten-minute briefing — what exists, what is proved, what is left, how to
check anything, and the traps. `00-STATE-AND-TRACKER.md` is the history behind
it. Everything else here is reference.

⏸️ **2026-09-22 — the CRM is paused on the owner's instruction.** The active work
is `docs/TEAM-ISSUES.md`.

| File | What it holds |
|---|---|
| `19-HANDOVER.md` | ⭐ **The cold start.** Read first, every time. |
| `20-BUILDING-A-SCREEN-FROM-A-DESIGN.md` | ⭐ **How to build a screen from one of the owner's images** — sampling colours, solving type sizes, the 0.9 zoom, proving nothing is cut off, and the things the owner has already had to say once. |
| `00-STATE-AND-TRACKER.md` | Live status. The one file that changes every session. |
| `01-VERIFIED-FACTS.md` | What was proved against the real Meta API, with dates. Not assumptions. |
| `02-FEATURE-MAP.md` | Every feature the owner named, plus researched ones, sorted by whether they earn their place. |
| `03-DATA-MODEL.md` | The proposed tables. Draft until the open questions are answered. |
| `04-PHASES.md` | ⚠️ Superseded by `08-TWELVE-STEPS.md`. Kept for the reasoning behind the order. |
| `05-OPEN-QUESTIONS.md` | What only the owner can decide, and what each answer changes. |
| `06-CAMPAIGNS-AND-COVERAGE.md` | Which campaigns exist, which pages they post to, and the three we cannot read. |
| `07-AI-PLAN.md` | What the AI can honestly do, in what order, and what it needs first. |
| `08-TWELVE-STEPS.md` | **The build order.** Twelve shippable steps, four modules, and what each needs from the owner. |
| `09-DATABASE-MANAGEMENT.md` | Growth, indexes, backups, retention, and the rules the data follows. |
| `10-LEAD-ASSIGNMENT.md` | **How leads are handed out, and the honest answer to "is that AI?"** The four signals to add, and the one to leave out. |
| `17-AUTOMATIC-STAGES.md` | ⭐ **How the stage stops being hand-cranked.** Six of the owner's seven examples are arithmetic, not AI; only `qualified` needs a model, and even then a person confirms. The five laws an automatic move must obey, the `contacted` rule the obvious version gets wrong, and why the next action must stop being compulsory first. |
| `15-MY-LEADS-PHASE.md` | ⭐ **The phase in progress.** The salesperson's My leads page: every element against what exists, what must be built, what is deferred and why, and the three decisions needed before code. |
| `14-SALES-WORKSPACE-PHASES.md` | ⭐ **The current build order.** Sarah's My sales desk and its nine rail screens, phased A–H with a dependency map and a "how to check it" the owner can run for every phase. |
| `13-PROPERTY-AND-QUOTATION-TESTPACK.md` | The owner's property + quotation test data, arithmetic re-checked, with the four things in it that need a decision and the safety flags read as requirements. The fixture Phase 5 gets built against. |
| `12-LIFECYCLE-SPEC.md` | ⭐ **READ THIS BEFORE BUILDING ANYTHING ELSE.** The owner's own lifecycle research (2026-09-14), what the system does against it measured line by line, the three things I would push back on, and the eight phases in dependency order. |
| `11-CALLING.md` | **Calling — researched 2026-09-14, parked until the tier is earned.** Whether WhatsApp does voice, whether he can talk on his mobile (yes — SIP), and the three dead ends. Read this whenever the owner says "call recording" or "auto-dial". |

---

## What this is

A lead-management CRM inside Taskly, for leads produced by Meta campaigns and
worked by the division's staff. Branch: `crm`. Route: `/leads`. Nav heading:
**Growth → Campaign & Lead Desk**.

The owner's reference points, given 2026-09-09:

- **PropForce / Zameen.com** (screenshot) — a real estate CRM the division wants
  to compete with. Left rail: Clients, Leads, Todos, Tasks, Pipeline, Sales
  Dispute, Call Recordings. Top nav: Dashboard, Clients & Leads, Projects &
  Inventory, Staff, Management, Reports, Accounts, Policies, Workflows.
- **Ladder CRM** (advert screenshot) — the feature list it advertises: Lead
  Capture, Lead Assignment, Call & Voice System, Auto Follow-ups, Contact
  Management, CRM Reports, Smart Dashboard.

Owner, in their own words: *"My system, my CRM, and my lead management system
should compete with them: this type of logic, this type of proper
implementation, this type of advancement."*

---

## The one thing to know before anything else

**Meta deletes lead data 90 days after it is submitted.** There are real leads in
the account right now — 615 across the Chitral Royal Homes page — and the oldest
of them are already close to that edge or past it. Every day without an importer
is leads permanently gone.

This is why Phase 1 in `04-PHASES.md` is "capture and store", not "build the
screen". The screen can be rebuilt next month; a deleted lead cannot.

---

## Ground rules carried over from the rest of this codebase

These are not style preferences. Each one was learned by something breaking.

1. **No invented figures.** A screen shows a number only when a real one exists.
   The current `/leads` page deliberately has no stat cards for this reason.
2. **RLS is the floor, not the query.** Anything that filters by person is
   enforced in a policy, because a query that forgets a `where` clause leaks and
   a policy cannot be forgotten. See `03-ROLES-AND-PERMISSIONS.md` in `docs/`.
3. **A migration carries its own self-check**, run as `cni_app` with a session,
   because a check that runs as the schema owner bypasses RLS and proves nothing.
4. **Personal data is different.** A lead is a stranger's name and phone number.
   Who may read one is a decision to make before the table exists, not after.
