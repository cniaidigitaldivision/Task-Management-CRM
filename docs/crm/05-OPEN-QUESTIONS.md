# Open questions

Only the owner can answer these. Each one says what changes depending on the
answer, so none of them is a preference — they all move code.

**Q1–Q5 block Phase 1.** The rest can be answered as we go.

Answers get written into `00-STATE-AND-TRACKER.md` as they arrive, with the date.

---

## Blocking

### Q1 · AI & Digital has no ads. Where do we actually start?

Verified: AI & Digital Division's system user reaches **0 ad accounts and 0 lead
forms**. Chitral Royal Homes has **615 leads**. CNI has 3 forms and no leads yet.

- **(a)** Start with Chitral — real data, immediately, and the 90-day clock is
  ticking on it.
- **(b)** Assign AI & Digital's ad account to its system user first, then start
  there. Costs days, and the leads only start from the day it is connected.
- **(c)** Both.

*Changes:* which account the importer is pointed at first, and whether there is
anything to look at in week one.

**Recommendation: (a).** Build against the account that has data.

---

### Q2 · Who may read a lead?

A lead is a stranger's name and phone number — the most sensitive rows this
product will hold.

- Super Admin / Admin: all leads?
- Team Coordinator: all leads, or only their projects' leads?
- Staff (Member): **only leads assigned to them**, or all leads on their projects?

*Changes:* the RLS policies, which are the hardest thing to change later, and
whether a staff member can see a colleague's pipeline.

**Recommendation:** Admin+ all; Coordinator by project; Member assigned-only.
Widening later is easy, narrowing takes access away from people used to it.

---

### Q3 · Does a lead belong to a project?

The owner said the CRM should have a project dropdown like the Studio. That
implies yes. But a Meta lead form does not know about Taskly projects.

- **(a)** Map each lead **form** to a project once; every lead from that form
  inherits it.
- **(b)** Map each **page** to a project. Coarser, simpler.
- **(c)** Leads arrive unassigned; somebody assigns the project by hand.

*Changes:* whether `project_id` is nullable, and whether the dropdown can be the
main navigation of the whole CRM.

**Recommendation: (a).** Chitral's six forms would each be pinned to the Chitral
project once, and it is then automatic for ever.

---

### Q4 · What are the stages, in the words your team says out loud?

The task board's statuses get used because they are the words people already use.
Same principle here.

A starting point from the PropForce screenshot: **New → Contacted → Follow Up →
Qualified → Visit Scheduled → Negotiation → Won / Lost.**

- Are those right?
- What are the **lost reasons** worth recording? ("wrong number", "budget", "not
  serious", "bought elsewhere") — this is what makes campaign reporting useful.
- Is "hot / warm / cold" set by hand, or derived?

*Changes:* an enum in a migration, the board, and every report.

---

### Q5 · Three roles — what exactly is the third?

The owner said *"there should be three roles"*. Taskly already has four:
Super Admin, Admin, Team Coordinator, Member.

- Is CRM staff = the existing **Member** role?
- Or a new role — someone who sees the CRM and not the task board?
- Should a Coordinator see their team's leads, as a middle tier?

*Changes:* whether this is a permission on existing roles or a new role, which is
a much larger change touching every rank comparison in the product.

**Recommendation:** use the existing roles. A new rank is expensive and the
existing four already have the right shape.

---

## Answerable as we go

### Q6 · Which phone number does WhatsApp open from?
A `wa.me` link works today with no integration. Real API sending needs the
WhatsApp Business API number and template approval. **Is there a number Taskly can
use?**

### Q7 · Email — from which address, and what does the first template say?
Taskly already sends email. This is templates and logging, not new plumbing.

### Q8 · Call system — which provider?
Everything about call logging and recording follows from this. Deferred by the
owner; noted so it is not forgotten.

### Q9 · Contact management — is a "client" separate from a "lead"?
PropForce shows "Khurram · 16 Leads" — one person with many leads. Do we need a
**contacts** table that leads hang off, or is a lead the whole record?
*Changes:* one table or two, and whether duplicate detection merges or links.

### Q10 · The testing staff account
The owner said they will add a testing staff member. **Which role, and on which
project?** Everything staff-side gets tested through it.

### Q11 · How far back should the backfill go?
Everything Meta still holds (recommended), or only from a date?

### Q12 · What does "smart dashboard" mean to you, concretely?
The most useful version of this answer is one sentence describing the first thing
you would want it to tell you when you open it in the morning.

---

## Answered

*(Nothing yet — 2026-09-09.)*
