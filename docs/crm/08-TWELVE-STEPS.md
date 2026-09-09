# The twelve steps

Owner, 2026-09-10: *"you can't implement all the things in one go… divide it into
phases, divide it module-wise, divide it feature-wise, and implement it step by
step, 12 steps, and implement it logically."*

And on scope: *"first start working on Chitral Royal Homes. First make them live
and mention that for other projects whose leads you can't read, it's coming soon
or not connected."*

**Branch: `crm` throughout.** Nothing reaches `main` until the owner says so.

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

### Step 4 · The list, project-scoped ⏳
The screen replaces the current placeholder page.

- **Project dropdown**, the same pattern and position as the Studio.
- Chitral shows real leads. Every other project shows an honest state:
  **"Not connected"** with one line saying why — no page access, or no leads yet.
- Columns, in the PropForce order because it is right: next action · last outcome
  · owner · temperature · lead name and when they came · project · **campaign** ·
  actions.
- ⚠️ Sorted by **next action**, not created date. That is the difference between
  a list you work from and a list you scroll.
- Filters: stage, owner, temperature, campaign, date range.

**Needs from you:** which project each campaign belongs to (Q13), and whether the
hiring campaign belongs in a sales pipeline at all.

**Delivers:** you can see the leads and filter them.

---

### Step 5 · The lead detail 🔓
Click a row, get the whole person: every answer Meta captured, the note thread,
the activity timeline, the campaign and form that produced them.

**Delivers:** the record a salesperson actually needs before ringing somebody.

---

### Step 6 · Working the lead 🔓
The actions that need no new integration and cover most of the daily job:

- Change stage · set the next action and its date
- Log a call outcome — attempted, connected, no answer, wrong number
- Add a note ⚠️ the owner's example: *"what quotation I have given him"*
- Mark temperature — hot / warm / cold
- **WhatsApp button** — `wa.me/{phone}` opens the chat, pre-filled. Zero setup.
- Mark lost, with a reason from the agreed list

**Delivers:** the desk works. A salesperson can run their day from it.

---

### Step 7 · Assignment and the staff view ⏳
- Assign a lead to a sales team member; bulk-assign from the list.
- The staff view: the same component, pre-scoped to "mine", same filters.
- ⚠️ One component, two scopes — so the two views cannot drift apart.
- A notification when a lead is assigned to you, through the existing bell.

**Needs from you:** the testing staff account, and which project members are the
sales team.

**Delivers:** the two-dashboard split you asked for.

---

# MODULE 3 · Follow-through — stop leads going cold

---

### Step 8 · Follow-ups and reminders 🔓
- Due next actions surface on the dashboard and in the bell.
- Overdue and neglect alerts: *"14 leads assigned to Ali, no activity in 6 days."*
- ⚠️ Rules, not AI. Instant, free, and it cannot hallucinate.

**Delivers:** nothing sits untouched without somebody being told.

---

### Step 9 · Clients ⏳
A lead is an enquiry; a client is someone who engaged. One client, many leads —
the *"Khurram · 16 Leads"* column in your reference screenshot.

**Needs from you:** what exactly converts a lead into a client (Q17), and whether
a client belongs to one project or to the division (Q16).

**Delivers:** contact management, and the repeat-enquiry picture.

---

### Step 10 · Reports, stored 🔓
⚠️ Your rule, recorded: *"first save in a database and always fetch from the
database."* Every report is computed, **stored**, and read back from storage —
the same shape `report_exports` already uses, so a report you generated in
October still says in December what it said in October.

- Source and campaign → conversion
- Per-staff: leads, response time, closes
- Ageing and stage funnel
- Reuses the existing CSV / XLSX / PDF writers.

**Delivers:** "which campaign is worth the money", answerable.

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
