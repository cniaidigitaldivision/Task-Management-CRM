# Manuals — one per person, in their own words

Owner, 2026-10-01:

> *"If I say to keep maintaining a manual, person by person — for example a sales
> manager can do this, salespersons can do this, and an executive can do this —
> can you keep maintaining that folder? I will just give it to someone like a
> sales manager or salespersons to understand the system or to test this system.
> Plus whether I forget it, you will keep maintaining everything over there."*

So these are **not** developer documentation. Everything in `docs/crm/` is written
for whoever builds the next thing. These are written for the person who has to
use it on Monday morning, and they are meant to be handed over as they are.

| File | Hand it to |
|---|---|
| [`01-SALESPERSON.md`](01-SALESPERSON.md) | Sarah, Sahad — anyone working their own leads |
| [`02-SALES-MANAGER.md`](02-SALES-MANAGER.md) | whoever hands leads out and answers for the numbers |
| [`03-EXECUTIVE.md`](03-EXECUTIVE.md) | the Executive |
| [`04-ADMIN.md`](04-ADMIN.md) | you, and anyone else you make an Admin |

---

## ⚠️ THE STANDING RULE — these are kept current without being asked

**Every change to a CRM screen updates the manual that describes it, in the same
commit.** Not "later", not "when somebody asks". The owner said plainly she
should not have to remember; so forgetting is the failure mode this rule exists
to prevent.

In practice, after any piece of work, ask: *would a person following one of these
manuals now be reading something untrue?* If yes, fix it before committing.

### ⚠️ And nothing goes in a manual that has not been driven

A manual is read by somebody who then does exactly what it says, in front of a
client or a new hire. A sentence describing a button that moved, or a screen
that was renamed, is worse than no sentence at all — it costs them their trust
in the whole document and then in the product.

So every instruction here was performed against the running application, as that
role, with a real session. Where something is **not** built, the manual says so
in those words rather than leaving a gap somebody will read as their own mistake.

### ⚠️ Three things these manuals must always carry

1. **What the person cannot do, and who can.** Half the support questions in any
   CRM are "why is this greyed out" — answered in advance, they never get asked.
2. **What is not built yet.** Somebody testing needs to tell a bug from a gap.
   A gap presented honestly is a roadmap; a gap discovered by surprise is a
   complaint.
3. **A short "try this" at the end.** The owner's stated use is *"to test this
   system"* — so each manual finishes with a walk somebody can do in ten minutes
   that touches everything that matters.

---

## Before anybody can test: the CRM preview list

**This is the single most common reason somebody sees an empty screen.**

The CRM is still restricted to named people (migration 143). Measured on
2026-10-01, signing in as each:

| Person | On the preview list | What they see at `/leads` |
|---|---|---|
| sale manager tester | yes | the desk, 74 leads readable |
| Sarah | yes | the desk, her own 44 leads |
| Saad Mustafa (Executive) | **no** | the desk opens, **no leads at all** |
| Farhan Shah (member) | **no** | bounced to his own dashboard, no CRM menu |

If somebody you hand a manual to sees nothing, check this first — it is almost
never a bug in the screen they are looking at.

The list lives in `crm_preview_members`. Adding somebody is a decision for the
owner, not a code change.
