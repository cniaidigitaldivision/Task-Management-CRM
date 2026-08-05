# 05 — Task Lifecycle & Statuses

You said: *"These statuses should show if they're done, they're under process, stuff like that, you know better."*
Here is the proposed set, designed for a creative/marketing team where work gets reviewed and often revised.

---

## 1. The status set

| # | Status | Colour token | Category | Counts toward workload? | Meaning |
|---|---|---|---|:--:|---|
| 1 | **Backlog** | `status-backlog` slate | `not_started` | ⚠️ Partially (25%) | Captured, not scheduled yet. An idea or a "someday" item. |
| 2 | **To Do** | `status-todo` blue | `not_started` | ✅ Yes | Committed. Assigned, scheduled, waiting to be picked up. |
| 3 | **In Progress** | `status-progress` **violet** | `active` | ✅ Yes | Actively being worked on right now. |
| 4 | **Blocked** | `status-blocked` red | `waiting` | ✅ Yes | Cannot proceed. **Reason is mandatory.** |
| 5 | **In Review** | `status-review` **pink** | `waiting` | ⚠️ Partially (50%) | Work submitted, waiting on Coordinator/Admin approval. |
| 6 | **Revisions** | `status-revisions` orange | `active` | ✅ Yes | Reviewed and sent back with changes requested. |
| 7 | **Done** | `status-done` emerald | `done` | ❌ No | Approved and complete. |
| 8 | **Cancelled** | `status-cancelled` zinc | `cancelled` | ❌ No | Dropped. Not going to happen. |

> **Colour amended in Session 04** ([ADR-011](decisions/ADR-011-design-system.md), contradiction [C-01](19-MASTER-SPECIFICATION-REGISTRY.md#9--contradiction-sweep--session-04)).
> *In Progress* moved from amber to **violet** and *In Review* from purple to **pink**, because the original amber collided with the brand gold — see [doc 18 §3](18-DESIGN-SYSTEM-AND-BRANDING.md). **[Doc 18 §5](18-DESIGN-SYSTEM-AND-BRANDING.md) holds the exact hex values; this table names the tokens only.**

### Why *Backlog* counts at 25% and *In Review* at 50%
- **Backlog** work is real future load, but not imminent — counting it fully would make everyone look permanently overloaded.
- **In Review** work is out of the member's hands but not finished — if it comes back as *Revisions*, they'll pay for it again. Counting it at half keeps the number honest.

These weights are configurable in `system_settings`.

---

## 2. Allowed transitions

```
                              ┌──────────────────────────────────┐
                              │                                  │
    ┌─────────┐   ┌────────┐  │  ┌─────────────┐   ┌───────────┐ │  ┌────────┐
    │ Backlog │──▶│ To Do  │──┴─▶│ In Progress │──▶│ In Review │─┴─▶│  Done  │
    └─────────┘   └────────┘     └──────┬──────┘   └─────┬─────┘    └────────┘
         │             ▲                │  ▲             │
         │             │                ▼  │             ▼
         │             │          ┌─────────┐      ┌───────────┐
         │             └──────────│ Blocked │      │ Revisions │
         │                        └─────────┘      └─────┬─────┘
         │                                               │
         │                                               ▼
         │                                        ┌─────────────┐
         │                                        │ In Progress │
         │                                        └─────────────┘
         │
         └──────────────────────▶ Cancelled  ◀── (from any status)
```

### Transition rules table

| From → To | Who can do it | Condition |
|---|---|---|
| Backlog → To Do | Assignee, Lead, Admin+ | Must have an assignee and an effort estimate |
| To Do → In Progress | Assignee, Lead, Admin+ | Warns if blocking dependencies unfinished (BR-008); warns if member already at max concurrent tasks |
| In Progress → Blocked | Assignee, Lead, Admin+ | **Reason required** (FR-043). Notifies Admins. |
| Blocked → In Progress | Assignee, Lead, Admin+ | Clears reason, logs resolution |
| In Progress → In Review | Assignee, Lead, Admin+ | Notifies reviewer(s) |
| **In Review → Done** | **Lead, Admin+ only** | ❌ Assignee cannot approve own work (BR-002) |
| **In Review → Revisions** | **Lead, Admin+ only** | Comment explaining what to change is required |
| Revisions → In Progress | Assignee, Lead, Admin+ | |
| Revisions → In Review | Assignee, Lead, Admin+ | Resubmit after fixing |
| Any → Cancelled | Lead, Admin+ (Member only on self-created tasks) | Reason required |
| Done → In Progress (reopen) | Admin+ only | Logged as a reopen; affects on-time metrics |
| Any → Backlog (deprioritise) | Lead, Admin+ | |

**Anything not in this table is not permitted** and the UI will not offer it.

---

## 3. A worked example — the team's real flow

> **Task CNI-142: "Edit Ramadan campaign reel — 30s vertical"**
> Assigned to Kashif · Priority: High · Estimate: M (4 pts) · Due: Fri

| Time | Status | Who | What happened |
|---|---|---|---|
| Mon 09:00 | **To Do** | Admin (sister) | Created and assigned. System recommended Kashif (video-editing:5, 45% utilised). |
| Mon 11:20 | **In Progress** | Kashif | Started. Board updates live on Admin's screen. |
| Tue 14:00 | **Blocked** | Kashif | Reason: *"Waiting on raw footage from client."* Admins notified instantly. |
| Wed 10:00 | **In Progress** | Kashif | Footage arrived. Unblocked. |
| Wed 18:30 | **In Review** | Kashif | Submitted. Load drops to 50% weight. Admin notified. |
| Thu 09:15 | **Revisions** | Admin | *"Cut the intro by 2 seconds, brand colours are off."* Kashif notified, full load restored. |
| Thu 13:00 | **In Review** | Kashif | Resubmitted. |
| Thu 15:00 | **Done** ✅ | Admin | Approved. Load released. `completed_at` set. On-time: ✅ (before Fri). Revision count for this task: 1. |

Then it flows onward: the reel goes to **Yusra** as a new task *"Schedule Ramadan reel across Meta + TikTok"* — see **E-004 Task Handoff Chains** in [`12-ENHANCEMENT-BACKLOG.md`](12-ENHANCEMENT-BACKLOG.md), which automates exactly this.

---

## 4. Priority levels

| Priority | Weight (multiplies effort points) | Meaning | SLA suggestion |
|---|:--:|---|---|
| 🔴 **Urgent** | 1.5× | Drop other things | Same day |
| 🟠 **High** | 1.25× | This week, definitely | 2–3 days |
| 🟡 **Medium** | 1.0× | Normal work | Within the week |
| ⚪ **Low** | 0.75× | When there's room | No hard date |

Priority weight is a **load multiplier**, not just a label — urgent work genuinely costs more of a person's attention, and the capacity engine reflects that.

> **Guard rail:** if more than 30% of a member's open tasks are Urgent, the system flags it — because when everything is urgent, nothing is. This is **E-011**.

---

## 5. Effort sizing

Members and Admins pick a T-shirt size; the system converts it to capacity points.

| Size | Points | Rough meaning |
|---|:--:|---|
| **XS** | 1 | Under an hour. Quick fix, single post. |
| **S** | 2 | Half a day-ish. |
| **M** | 4 | A full working day. |
| **L** | 8 | Two to three days. |
| **XL** | 16 | A week. **System suggests splitting this into subtasks.** |

Alternatively an exact hour estimate can be entered and converted at 1 point ≈ 1 hour.

Anything above XL triggers: *"This looks large. Consider breaking it into subtasks so progress is visible and load is spread."*

---

## 6. Overdue & escalation

| Condition | System behaviour |
|---|---|
| Due date is tomorrow | Reminder notification to assignee |
| Due date is today | Reminder at the start of the working day |
| Past due, not Done | Task turns red; assignee + Admins notified; appears in the Overdue widget |
| Past due by 3+ days | Escalated to Super Admin in the daily digest |
| Blocked for 2+ days | Escalated to Admins — *"CNI-142 has been blocked since Tuesday"* |
| In Review for 2+ days | Escalated to reviewer — *"3 tasks are waiting on your approval"* |

Overdue is evaluated at end-of-day in the team's configured timezone (BR-009, Q-010).
