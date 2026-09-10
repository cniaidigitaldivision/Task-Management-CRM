# ADR-012 — Departments, Alongside the Four Roles

**Date:** 2026-09-10
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** [`ADR-002`](ADR-002-four-role-model.md), migrations 117 & 118, [`../crm/00-STATE-AND-TRACKER.md`](../crm/00-STATE-AND-TRACKER.md)

## Context

The CRM needed an answer to "who may read a lead", and the four-role ladder could
not give one.

Owner, 2026-09-10: *"This whole CRM will be hidden by the other team members,
except admin, super admin, and these tester IDs that I have added, because these
are in the sales department so they can see."* And on the shape of the company:
*"Right now in the main office there are a lot of departments: the AI and digital
department, in which the team manager is Kashif Ayaz… the sales team, in which
they have one sales manager and all other sales persons… the finance department,
whose team I will create… There is also a development team."*

**The rank ladder cannot express this.** `acting_at_least('team_coordinator')`
admits everybody at that rank *and above* — right for "may approve work", wrong
for "works in this department". The three sales staff are `member`, the bottom of
the ladder, and the desk is their entire job; the Team Coordinator sits above
them and has no lead work at all.

Two existing columns look like the answer and are not:

- **`users.office_team`** is a LOCATION — `blue_area` or `wah`. Attendance,
  `employee_compensation` and `expenses.office_team` all read it as a site.
- **`users.role_title`** is free text, and the live rows show why that settles
  it: `'SalesMan'`, `'sales manager'`, `'sale person'`, `'Lead Manager/Coodinator'`,
  `'Developer Interne'`. Three spellings for one team and two typos, entered by
  hand over ten days. An access rule matching on it would admit whoever spelled
  their title the way the code expected.

## Decision

**A `departments` table, and two new columns on `users`.**

| | |
|---|---|
| `departments.key` | The stable handle. Policies compare against this, never the name. |
| `departments.name` | What people read. Free to change without touching a policy. |
| `users.department_id` | Which department somebody is in. Nullable. |
| `users.department_role` | `manager` or `member` **of that department**. ⚠️ Not an app rank. |

**The four roles of ADR-002 are unchanged.** There is no fifth rank. The sales
manager is `member` in `users.role` and `manager` in `users.department_role` —
seniority inside a department is a different question from authority over the
application, and conflating them is what would have required a new rank.

**Eight departments to start:** Management, AI & Digital, Development, Sales,
Finance & Accounts, HR & People, Operations, Support. The last four are empty by
design — the owner asked for them ready so the first hire is a dropdown rather
than a migration.

**CRM access becomes:**

```
Admin  ·  Super Admin  ·  anybody in the Sales department
```

with the sales **manager** seeing every lead in the department, and a
sales **person** seeing only the leads assigned to them.

### ⚠️ This supersedes the answer of 2026-09-09

Q2 was answered *"Team Coordinator: yes, included"*, and migration 111 wrote that
into six policies. The owner has since separated the two jobs — *"That was the
team coordinator, not the sales manager. The team coordinator will be part of a
digital creator team. He will manage their tasks… But for the salespersons or for
the management of the lead, all this CRM belongs to the sales manager and the
salespersons."*

**Nothing else the Coordinator does is touched.** Tasks, workload and approvals
live in their own policies and are unchanged. What changed is exactly one thing:
he can no longer read 615 strangers' phone numbers, because that was never his
job.

## Why

- **A department is what the company actually has.** The owner described the org
  by department without being prompted; modelling anything else would mean
  translating every future instruction.
- **A table, not an enum,** because *"the finance department, whose team I will
  create"* was said in the same breath as describing the ones that exist. A
  company grows departments, and each one should cost a row.
- **`key` is what keeps that safe.** Renaming Sales to "Sales & Business
  Development" changes a heading and nothing else.
- **Only Admin and above may move anybody**, because moving somebody into Sales
  is an access grant — quieter than promoting them to Admin, and no less
  consequential. It asks for re-authentication for that reason.

## Consequences

**Easier:** "who can see the CRM" is one sentence and one join. Adding a
department is a row. The org chart is on the team page, so nobody has to ask who
runs what.

**Harder:** two things now describe a person's place — rank and department — and
both have to be right. A new account defaults to no department, which is the safe
direction (it grants nothing) but means a hire is not finished until somebody
files them.

**Kept in step by hand:** `crmIsOpenTo()` in `lib/auth/current-user.ts` mirrors
`app.crm_is_open_to_caller()` in migration 118. There is no way to share an
expression across TypeScript and a policy. The worst case if they drift is a page
that opens and shows nothing — never a leak, because the database is the floor.

**Not done here:** `owner_id` is still absent from migration 116's column grant,
so nobody can reassign a lead yet. That is Step 7, with the rule that only the
sales manager may.
