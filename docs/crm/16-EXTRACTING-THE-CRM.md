# 16 · Lifting the CRM out — what it would take, and how to keep it cheap

> Owner, 2026-09-15: *"Implement this CRM in such a way that when I say I want to
> just copy and paste this whole CRM to somewhere else — in a sub-subdomain —
> you can easily extract that modularly and start working on it. Is that
> possible?"*

**Yes. Measured 2026-09-15, not estimated.** The CRM is already close to
separable, and this file exists to keep it that way as it grows — because
extractability is not something you add at the end, it is something you stop
losing.

---

## 1 · The seam, measured

**What the CRM needs from Taskly — the database.** Two tables. That is all.

| Taskly table | CRM tables that reference it |
|---|---|
| `public.users` | 15 — every table that records who did something |
| `public.projects` | 8 — every table that belongs to a business |

**What Taskly needs from the CRM.**

| | |
|---|---|
| Foreign keys from Taskly into `crm_*` | **0** |
| Non-CRM code importing CRM modules | `app/api/pulse/route.ts` (one call: `crmLeadPulse`) |
| Navigation | `components/layout/sidebar.tsx` — two booleans that only ADD links |

⚠️ **The dependency is one-directional, and that is the whole game.** Nothing in
Taskly would break if every `crm_*` table were dropped tomorrow — except the
pulse route, which is one import, and the sidebar, which hides the links anyway.
A module you can delete is a module you can move.

**What the CRM borrows from the codebase.**

- `components/ui/*` — toast, card, button, badge, select, pagination. A design
  system, and it travels with you.
- `lib/utils`, `lib/view/relative-age`, `lib/domain/phone` — generic helpers.
- ⚠️ **`lib/db/client` (`withUser`) and `lib/auth/current-user` (`requireUser`,
  `requireCrmAccess`)** — these two are the REAL seam. Everything the CRM knows
  about identity passes through them.

---

## 2 · What extraction would actually involve

In order, and none of it is speculative:

1. **Take the `crm_*` tables and the `app.crm_*` functions.** Migrations 111–162,
   already a contiguous block that touches almost nothing else.
2. **Provide `users` and `projects` in the new home.** They can be anything — a
   table, a view over an API, a synced copy — as long as they have an `id`, and
   `users` carries `department_id`, `department_role` and `is_active` for the
   rota, and `projects` carries `lead_department_id`.
3. **Reimplement two functions:** `withUser(actorId, fn)` — set `role` and
   `app.user_id`, which is what every RLS policy reads — and `requireUser()`.
4. **Copy `components/crm/*`, `lib/domain/crm-*`, `lib/db/queries/crm-leads.ts`,
   `lib/crm/*`, `app/actions/crm-leads.ts` and the `app/(app)/{leads,my-leads,
   lead-overview,lead-reports,clients}` routes.**
5. **Take `components/ui/*` and the design tokens.**
6. **Delete the one import in `app/api/pulse/route.ts`.**

⚠️ **The RLS policies come for free.** They are written against `app.user_id` and
the CRM's own helper functions, not against Taskly concepts. A new host that sets
that one setting inherits the whole access model.

---

## 3 · The rules that keep this true

Extractability is lost one convenient import at a time. These are the four that
matter, and they cost nothing to follow today.

**1 · ⚠️ NO NEW FOREIGN KEY FROM A `crm_*` TABLE TO A NON-CRM TABLE, other than
`users` and `projects`.** If a CRM table needs to point at a task, a document or
an invoice, that is the moment the CRM stopped being liftable. Carry the id
without a constraint, or ask whether the thing belongs inside the CRM.

**2 · ⚠️ NOTHING OUTSIDE THE CRM MAY IMPORT FROM INSIDE IT.** Today exactly one
file does (`api/pulse`), and that is a known, single, deletable line. Every
addition to that list is a thread to cut later, at a moment when nobody
remembers why it is there.

**3 · ⚠️ IDENTITY GOES THROUGH `withUser` AND `requireUser`, ALWAYS.** Never read
a session, a cookie or a Taskly role directly from CRM code. Those two functions
are the port; everything else is the adapter's problem.

**4 · ⚠️ CRM CODE LIVES UNDER A `crm` NAME.** `components/crm/`,
`lib/domain/crm-*`, `lib/crm/`, `crm_*` tables, `app.crm_*` functions. A file
that has to be found by reading it is a file that gets left behind.

> The check, in one command:
>
>     # any new coupling shows up here
>     grep -rlE "from '@/(components/crm|lib/domain/crm-|lib/db/queries/crm-|lib/crm/)" \
>       --include=*.ts --include=*.tsx app components lib | grep -vE "/crm/|crm-"
>
> It should list the CRM's own routes and `app/api/pulse/route.ts`. Anything
> else is new coupling — decide deliberately, or undo it.

---

## 4 · What is deliberately NOT done yet

The owner, same day: *"Definitely later on I will create everything separately…
right now I will manage everything over here."*

So this is a **contract, not a refactor**. Nothing has been moved into a package,
no build boundary has been drawn, no interface has been abstracted for its own
sake. The CRM sits in the Taskly codebase and shares its database — and the four
rules above mean that when the day comes, the work is copying files and providing
two tables, rather than untangling.

⚠️ **The one thing that WILL need real work** is the data: 659 leads, their
messages, notes and activity all carry `users.id` and `projects.id` values that
must mean the same thing in the new home. That is an export/import problem with a
mapping table, and it gets harder the longer the two systems share a database —
worth remembering when the subdomain is more than an idea.
