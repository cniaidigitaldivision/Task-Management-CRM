# The CRM — Campaign & Lead Desk

**If this session closed and you are picking it up cold, read `00-STATE-AND-TRACKER.md` first.**
It says what is done, what is next, and what is blocked. Everything else here is
reference.

| File | What it holds |
|---|---|
| `00-STATE-AND-TRACKER.md` | Live status. The one file that changes every session. |
| `01-VERIFIED-FACTS.md` | What was proved against the real Meta API, with dates. Not assumptions. |
| `02-FEATURE-MAP.md` | Every feature the owner named, plus researched ones, sorted by whether they earn their place. |
| `03-DATA-MODEL.md` | The proposed tables. Draft until the open questions are answered. |
| `04-PHASES.md` | Order of work, and why that order. |
| `05-OPEN-QUESTIONS.md` | What only the owner can decide, and what each answer changes. |
| `06-CAMPAIGNS-AND-COVERAGE.md` | Which campaigns exist, which pages they post to, and the three we cannot read. |
| `07-AI-PLAN.md` | What the AI can honestly do, in what order, and what it needs first. |
| `08-TWELVE-STEPS.md` | **The build order.** Twelve shippable steps, four modules, and what each needs from the owner. |
| `09-DATABASE-MANAGEMENT.md` | Growth, indexes, backups, retention, and the rules the data follows. |

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
