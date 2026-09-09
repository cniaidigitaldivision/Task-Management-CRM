# Database management

Owner, 2026-09-10: *"and you didn't tell me about database management"* — correct,
and it is the right question to ask before a table starts taking a few hundred
rows a day from an external source we do not control.

---

## Where things stand today

Measured 2026-09-10 on the live Supabase project:

| | |
|---|---|
| Database size | **26 MB** |
| Tables | 80 |
| Tasks | 740 |
| Meta metric rows | 1,947 |
| Meta posts | 255 |

The whole product, after months of use, is 26 MB. This matters for the estimate
below: the CRM will not be what fills the database.

---

## What the CRM will actually add

Honest arithmetic, not a guess.

**A lead row** — name, phone, a handful of columns, plus the raw answers as
jsonb. The verified Chitral form has six answers. Call it **~1.5 KB per lead**
including its indexes.

**Activity rows** — a worked lead accumulates maybe 10–20 over its life. ~200
bytes each, so **~3 KB per lead**.

**Notes** — a few hundred bytes each, a handful per lead.

So roughly **5 KB per lead, fully worked**.

| Volume | Storage |
|---|---|
| 615 leads (today's backfill) | ~3 MB |
| 10,000 leads | ~50 MB |
| 100,000 leads | ~500 MB |

⚠️ **The conclusion worth stating plainly: storage is not the constraint.** Even
100,000 worked leads — years of volume at this division's rate — roughly doubles
the current database twenty times over and is still under a gigabyte. Supabase's
free tier is 500 MB; the paid tiers start at 8 GB. Nobody needs to plan around
running out of room.

**What actually degrades first is query time on the list screen**, and that is an
index problem, not a size problem. See below.

---

## The rules this CRM follows

### 1 · Database-first, always

⚠️ Your instruction, recorded as a rule: *"first save in a database and always
fetch from the database."*

- The importer writes to our tables. **No screen ever calls Meta.**
- Reports are computed, **stored**, and read back from storage — so a report
  generated in October still says in December what it said in October, even
  though Meta deleted the underlying leads at 90 days.
- The same rule the Studio already follows, for the same reason: *"I will not
  fetch live things… we will fetch data from the database and show."*

This is not only about speed. **Meta deletes lead data at 90 days.** Our copy is
the only permanent record that will exist.

### 2 · Nothing is hard-deleted without a reason

- A lead removed from the list is soft-hidden, not destroyed.
- ⚠️ Activity is **append-only** — no UPDATE or DELETE policy at all, the same as
  `report_exports`. An activity log somebody can edit is not evidence of
  anything.
- Notes follow `project_remarks`: a real DELETE by the author, because a
  soft-delete via `deleted_at` cannot work when the SELECT policy filters on it
  — PostgreSQL applies SELECT policies to the NEW row of an UPDATE, so a row
  cannot be updated into invisibility. Learned on migration 104.

### 3 · Every import is idempotent

Upsert on `(source, external_id)`. The importer will be run twice — by a retry,
by an overlapping cron, by somebody testing. Running it twice must change
nothing, and that is asserted in the migration's self-check rather than assumed.

### 4 · RLS is the floor

Not the query. A list query that forgets a `where owner_id = …` leaks every
lead in the division to a junior salesperson. A policy cannot be forgotten.

⚠️ And the importer runs with **no session**, where RLS fails closed — a blocked
insert returns zero rows and reports success. Every writer the cron uses is
SECURITY DEFINER, and the migration self-checks as `cni_app` with `app.user_id`
unset, because a check that runs as the schema owner bypasses RLS and proves
nothing.

---

## Performance — what to build in from the start

The list screen is the only query that will ever be hot: "leads for this project,
this stage, this owner, ordered by next action". Indexes for exactly that, from
migration 110 rather than after somebody complains:

| Index | Serves |
|---|---|
| `(project_id, next_action_at)` | The default list and its sort |
| `(owner_id, next_action_at)` | The staff view |
| `(source, external_id)` unique | Import idempotency — and it is the safety rail, not an optimisation |
| `(phone_e164)` | Duplicate detection, and finding a caller by number |
| `(campaign_id)` | The campaign filter and campaign reporting |
| GIN on `answers` | Only if searching inside the raw answers becomes real. Not by default — an unused GIN index costs every write. |

⚠️ **Pagination from day one.** A list that loads 615 rows today loads 20,000 next
year on the same code path. The existing `usePagination` is already used
elsewhere in the product.

---

## Backups and recovery

The product's existing standard (NFR-005) is an automated daily snapshot with at
least 7 days of retention, which Supabase provides on the current plan.

⚠️ **One CRM-specific point worth making explicitly.** For every other table in
this product, the source of truth exists elsewhere — tasks were typed by people
who remember them, Meta metrics can be re-fetched. **Lead data cannot be
re-fetched after 90 days.** Once Meta deletes it, our backup *is* the only copy
in existence.

That raises the value of the backup from "convenient" to "the only record", and
it is worth confirming with Supabase's dashboard that point-in-time recovery is
on for this project rather than assumed.

---

## Retention and privacy

Leads are personal data — a stranger's name and phone number, given to a specific
business for a specific purpose.

Three things to decide, and they are the owner's call rather than mine:

1. **How long do we keep a lost lead?** Indefinitely is a decision, not a default.
2. **Can a person be deleted on request?** If somebody asks to be removed, is
   there a button, and does it remove the activity trail too?
3. **What leaves our servers?** The AI features send lead text to OpenAI. Almost
   all of them work with names and numbers stripped — see `07-AI-PLAN.md`.

None of these blocks Step 1. All of them are cheaper to decide before there are
20,000 rows.

---

## Migration discipline, unchanged from the rest of the product

- Numbered files in `lib/db/migrations/`, applied with `scripts/migrate.mjs`.
- CRM starts at **110**.
- Every migration carries a **self-check that runs as `cni_app` with a session
  matching how the code will actually call it** — and, for anything the cron
  touches, with no session at all.
- ⚠️ `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it.
  Adding `sales` to `project_role` means the enum value lands in one migration
  and anything that references it in the next. Migrations 106 and 107 were split
  for exactly this reason.
