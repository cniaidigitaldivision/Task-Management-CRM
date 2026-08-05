# 17 — Task Timers, Time Limits & Extensions

**Added:** 2026-08-06 (Session 03)
**Status:** Planned, not built
**Locked by:** [`decisions/ADR-010`](decisions/ADR-010-task-time-limits.md)

---

## 1. What you asked for

> *"I want you to add the timers for the tasks every member will have. Every member cannot be executing a task beyond the time limits that they will be assigned for the tasks. This admin will set the task limit and/or the coordinator will set the task limits for each task of the team members… If a task's time limit is reached and the member is requesting further time, only the admin can further give the time. The system should also intelligently remind the member that his task is incomplete and is due for this time."*

---

## 2. Two different things that both sound like "deadline"

This is the most important distinction in this document. The system tracks **both**, and they answer different questions.

| | **Due date** | **Time limit** ← *new* |
|---|---|---|
| Question it answers | *When must this be finished?* | *How much working time is it allowed to consume?* |
| Unit | A calendar date | Hours and minutes of actual work |
| Example | "Due Thursday" | "Allowed 4 hours" |
| Violated when | Thursday passes, task not Done | 4 hours of tracked work elapse, task not Done |
| Who sets it | Admin, Coordinator | Admin, Coordinator |
| Who extends it | Admin, Coordinator | **Admin only** |

A task can be **on time but over limit** (finished Wednesday, but it ate 9 hours instead of 4 — the estimate was wrong, or something went badly). It can also be **within limit but overdue** (only 2 of its 4 allowed hours used, but nobody started until Friday — a scheduling problem, not an effort problem).

**Telling those two failures apart is the whole value of this feature.** One means your estimates are wrong; the other means your scheduling is. They need completely different fixes, and until now nothing in the system could distinguish them.

---

## 3. How the timer works

### Default limit is suggested, not typed from scratch
Effort sizing already maps to hours (doc 05 §5), so the system pre-fills the limit and the Admin adjusts:

| Effort size | Points | **Suggested time limit** |
|---|:--:|---|
| XS | 1 | 1h 00m |
| S | 2 | 2h 00m |
| M | 4 | 4h 00m |
| L | 8 | 8h 00m |
| XL | 16 | 16h 00m |

Set an estimate, get a limit. Override it whenever the work is unusual.

### The timer runs automatically
No start/stop button to forget. **The timer runs whenever the task's status is *In Progress* and the member is inside working hours.**

```
Status → In Progress   ▶️  timer starts
Status → Blocked       ⏸️  auto-pause  (not the member's fault)
Status → In Review     ⏸️  auto-pause  (out of their hands)
Status → Revisions     ▶️  resumes     (back with them)
Status → Done          ⏹️  stops, final time recorded
17:00 Mon–Sat          ⏸️  auto-pause  (outside working hours)
09:00 next working day ▶️  auto-resume (only if still In Progress)
Sunday                 ⏸️  paused all day
Approved leave         ⏸️  paused
Manual pause           ⏸️  reason required
```

**Working-hours pausing is not a nicety — it is what makes the number mean anything.** Without it, a task started at 16:30 on Saturday would show 65 hours consumed by Monday morning, every limit would breach overnight, and the whole feature would be noise inside a week.

### Two guards against garbage data
| Problem | Handling |
|---|---|
| Member forgets to move a task out of *In Progress* and goes home | Working-hours pause caps the damage at one day; plus an idle prompt after **2 hours** of no activity: *"Still working on EVT-142?"* Unanswered for 30 min → auto-pause, flagged for review. |
| Member forgets to set *In Progress* at all and works untracked | End-of-day nudge: *"You logged no time today but have 3 active tasks. Add time?"* Manual entry allowed, marked as `manual`. |

Manual adjustments are permitted but always **marked as manual and visible to Admins** — because a timer everyone quietly edits is worse than no timer.

---

## 4. Thresholds and reminders

> *"The system should also intelligently remind the member that his task is incomplete and is due for this time."*

Escalating, and deliberately not annoying below 75%.

| Consumed | What the member sees | Who else is told |
|:--:|---|---|
| **50%** | Quiet progress ring turns amber on the task card. No notification. | — |
| **75%** | 🔔 *"EVT-142 — you've used 3h of your 4h limit. About 1h left."* | — |
| **90%** | 🔔 *"EVT-142 — 24 minutes left. Need more time?"* with a **[ Request extension ]** button right in the notification | — |
| **100%** | 🚨 Task flagged **⏱ OVER LIMIT**. Banner on the task. Must either mark it complete or request an extension. | Admin + Coordinator notified |
| **120%** | 🚨 Daily reminder while it stays open | Admin notified again |
| **150%** | 🚨 Escalation | Admin + **Super Admin** |

Plus a **daily digest line** while any task is over limit:
> *"⏱ EVT-142 is 2h 15m over its time limit and still In Progress. Request an extension or mark it complete."*

### What happens at 100% — the design call

You said *"every member cannot be executing a task beyond the time limits."* There are three ways to enforce that, and I'm recommending the middle one:

| Option | Behaviour | Assessment |
|---|---|---|
| **A — Hard stop** | Task locks. Member cannot continue until an Admin grants an extension. | ❌ **Recommend against.** You cannot stop someone mid-render or mid-export. What actually happens is they finish the work outside the system and update it later — which destroys the data the whole feature exists to collect. It also makes the member idle while waiting for an approval that might come tomorrow. |
| **B — Enforced stop-and-account** ⭐ | Task is flagged **OVER LIMIT** and a blocking banner appears. Before doing anything else with that task, the member must choose: **mark complete**, **request extension**, or **explain why it's still open**. Work isn't physically prevented, but it cannot continue silently. Admin is notified immediately. | ✅ **Recommended.** Achieves your intent — nobody runs past their limit unnoticed or unaccountably — without pushing work off the books. |
| **C — Soft warning** | Notification only, work continues. | ❌ Too weak. Becomes background noise within a fortnight. |

**Q-041** confirms this choice.

---

## 5. Extension requests — Admin only

> *"Only the admin can further give the time."*

Locked. The Coordinator can *set* the original limit but **cannot grant more time.** That separation is deliberate and sound: setting a budget is planning, extending it is a cost decision.

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. MEMBER REQUESTS                                               │
│    ⏱ EVT-142 has reached its 4h limit.                          │
│    Additional time needed:  [ 2h 00m ]                           │
│    Reason (required):                                            │
│    ┌────────────────────────────────────────────────────────┐    │
│    │ Client sent replacement footage at 3pm, had to redo    │    │
│    │ the colour grade from scratch.                         │    │
│    └────────────────────────────────────────────────────────┘    │
│                                        [ Send to Admin ]         │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. ADMIN DECIDES  (notified instantly, in-app + email)           │
│                                                                  │
│    Kashif requests +2h on EVT-142 "Edit exhibition showreel"     │
│    Original limit 4h · Consumed 4h 12m · Requested +2h           │
│    Reason: "Client sent replacement footage at 3pm…"             │
│                                                                  │
│    📊 Context the system adds automatically:                     │
│    • Kashif is at 94% capacity this week                         │
│    • This is extension request #1 on this task                   │
│    • Similar video-edit tasks average 5h 20m actual vs 4h est.   │
│      → the original estimate was probably low, not the work slow │
│    • Due Thursday — 2 days left, extension fits                  │
│                                                                  │
│    [ Approve 2h ]  [ Approve partial ▾ ]  [ Decline ]           │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. RESULT                                                        │
│    • Approved → limit becomes 6h, timer resumes, member notified │
│    • Partial  → e.g. +1h granted with a note                     │
│    • Declined → reason required; member notified; task must be   │
│                 completed, handed over, or escalated             │
│    • Capacity engine updated: +2h is +2 points on Kashif's load  │
│    • Everything written to the audit log                         │
└──────────────────────────────────────────────────────────────────┘
```

**The context block in step 2 is the intelligent part.** An Admin approving blind is just rubber-stamping. Being told *"similar tasks actually take 5h 20m, so your 4h estimate was the problem, not Kashif"* turns each approval into a small correction to how the team estimates.

---

## 6. Permissions

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Set a task's time limit | ✅ | ✅ | ✅ | ❌ |
| Edit the limit before work starts | ✅ | ✅ | ✅ | ❌ |
| Edit the limit after work has started | ✅ | ✅ | ❌ | ❌ |
| **Approve an extension** | ✅ | ✅ | ❌ | ❌ |
| Decline an extension | ✅ | ✅ | ❌ | ❌ |
| Request an extension | ✅ own | ✅ own | ✅ own | ✅ own |
| Start / pause own timer | ✅ | ✅ | ✅ | ✅ |
| Pause someone else's timer | ✅ | ✅ | ✅ | ❌ |
| Manually adjust own logged time | ✅ | ✅ | ⚠️ reason required, flagged | ⚠️ reason required, flagged |
| Adjust someone else's logged time | ✅ | ✅ | ❌ | ❌ |
| See own time data | ✅ | ✅ | ✅ | ✅ |
| See anyone's time data | ✅ | ✅ | ✅ | ❌ *(ADR-003)* |
| See time/extension reports | ✅ | ✅ | ⚠️ read-only | ⚠️ own only |
| Set the default limit-from-estimate ratio | ✅ | ✅ | ❌ | ❌ |

---

## 7. Data model additions

### `tasks` — new columns
| Column | Type | Notes |
|---|---|---|
| `time_limit_minutes` | int null | The budget. Defaults from `effort_points × 60`. |
| `time_limit_set_by_id` | uuid FK null | Admin or Coordinator |
| `time_limit_set_at` | timestamptz null | |
| `time_spent_minutes` | int | Accumulated from `time_entries` |
| `timer_state` | enum | `not_started` \| `running` \| `paused` \| `stopped` |
| `timer_started_at` | timestamptz null | Current running segment |
| `timer_paused_reason` | text null | `status_change` \| `outside_hours` \| `leave` \| `idle` \| `manual` |
| `is_over_limit` | boolean | Computed: `time_spent > time_limit` |
| `over_limit_since` | timestamptz null | Drives escalation |
| `over_limit_acknowledged_at` | timestamptz null | Member responded to the banner |
| `total_extensions_granted_minutes` | int | Sum of approved extensions |
| `extension_count` | int | How many times extended |

### `time_entries` — replaces and extends `time_logs`
Every timer segment is its own row. Nothing is overwritten, so the history is auditable.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `task_id` | uuid FK | |
| `user_id` | uuid FK | |
| `started_at` / `ended_at` | timestamptz | |
| `duration_minutes` | int | |
| `source` | enum | `timer` \| `manual` \| `adjustment` |
| `pause_reason` | text null | why the segment ended |
| `note` | text null | |
| `adjusted_by_id` | uuid FK null | set when an Admin corrects it |
| `adjustment_reason` | text null | **required** for manual/adjustment |
| `is_within_working_hours` | boolean | flags out-of-hours work |

### `time_extension_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `task_id` | uuid FK | |
| `requested_by_id` | uuid FK | |
| `requested_minutes` | int | |
| `reason` | text | **mandatory** |
| `status` | enum | `pending` \| `approved` \| `partially_approved` \| `declined` \| `cancelled` |
| `reviewed_by_id` | uuid FK null | **must be Admin or Super Admin** |
| `granted_minutes` | int null | may be less than requested |
| `review_note` | text null | mandatory on decline |
| `requested_at` / `reviewed_at` | timestamptz | |

### `system_settings` — new keys
| Key | Default |
|---|---|
| `default_minutes_per_effort_point` | 60 |
| `timer_auto_pause_outside_hours` | true |
| `timer_idle_prompt_minutes` | 120 |
| `timer_idle_autopause_minutes` | 150 |
| `time_limit_warning_thresholds` | `50,75,90,100,120,150` |
| `over_limit_behaviour` | `enforced_stop_and_account` (Q-041) |
| `extension_approver_roles` | `admin, super_admin` |
| `require_reason_for_manual_time` | true |

---

## 8. How this makes the rest of the system smarter

The timer isn't a standalone feature — it feeds four things that were previously running on guesswork.

| System | What changes |
|---|---|
| **Capacity engine** (doc 06) | Load was based on *estimates*. Now real consumed time is known, so utilisation reflects what's actually happening. An over-limit task consumes more capacity than planned, and the workload view shows it immediately rather than at week's end. |
| **Estimate calibration** (E-002) | This was the missing input. With real timer data, after ~20 tasks the system knows Kashif's "M" is really 5h 20m and silently corrects his capacity maths. **The timer is what makes E-002 possible at all.** |
| **Assignment engine** (doc 07) | Deadline-fit scoring (S3) becomes real: *"Member C has 6 free working hours before Thursday and this task needs 4."* Currently that's an estimate against an estimate. |
| **Reports** (doc 05, doc 15) | Estimate accuracy per person and per skill; extension rate per task type; true cost per project and per client — including whether ABC Traders' retainer is actually profitable. |

### The report that will change how you plan

**Extension patterns by skill:**
```
Video editing      62% of tasks extended · avg +1h 40m over a 4h limit
Ads management     11% of tasks extended · avg +20m
Graphic design     18% of tasks extended · avg +35m
```

Read that correctly. It does **not** say Kashif is slow. It says **video editing tasks are being estimated at roughly 60% of what they truly take.** The fix is to change the estimates, not to pressure the editor — and without timer data you'd almost certainly have concluded the opposite.

---

## 9. UI

### On a task card
```
┌────────────────────────────────────────────┐
│ 🎪 Expo Karachi — Oct 2026                 │
│ EVT-142  Edit exhibition showreel          │
│ 🎬 Kashif · High · due Thu                 │
│ ⏱ 3h 12m / 4h 00m   ████████████░░░  80%  │
└────────────────────────────────────────────┘
```

### On task detail — the timer panel
```
┌─ ⏱ TIME ───────────────────────────────────────────────┐
│                                                        │
│   3h 12m  ▶️ running          of 4h 00m limit          │
│   ████████████████████░░░░░  80%                       │
│                                        48m remaining   │
│   [ ⏸ Pause ]  [ ✓ Mark complete ]  [ + Request time ] │
│                                                        │
│   Limit set by Sana (Admin) · 5 Aug                    │
│   Extensions: none                                     │
│                                                        │
│   TODAY'S SEGMENTS                                     │
│   09:14 – 11:02   1h 48m   timer                       │
│   11:40 – 13:04   1h 24m   timer                       │
│   13:04 – now     ▶️ running                            │
│   ⏸ 17:00 yesterday — auto-paused, outside hours       │
└────────────────────────────────────────────────────────┘
```

### Over limit
```
┌────────────────────────────────────────────────────────┐
│ 🚨 OVER TIME LIMIT — 4h 47m used of 4h 00m (+47m)     │
│                                                        │
│ This task has passed its allowed time. Please choose:  │
│                                                        │
│ [ ✓ Mark complete ]  [ + Request more time ]           │
│ [ Explain why it's still open ]                        │
│                                                        │
│ Your Admin has been notified.                          │
└────────────────────────────────────────────────────────┘
```

### Admin dashboard widget
```
┌─ ⏱ TIME & EXTENSIONS ──────────────────────────────────┐
│ ⚠️ Over limit now (3)                                  │
│    EVT-142  Kashif   4h47m / 4h00m   +47m              │
│    CLI-088  Yusra    9h10m / 8h00m   +1h10m            │
│    OTH-205  Kashif   6h30m / 5h00m   +1h30m            │
│                                                        │
│ 📥 Extension requests awaiting you (2)                 │
│    Kashif  +2h on EVT-142   "replacement footage"      │
│    Yusra   +1h on CLI-091   "extra revision round"     │
│                              [ Review all ]            │
│                                                        │
│ 📊 This week: 14 tasks · 3 over limit (21%)            │
│    Estimate accuracy: 78% · ▼ 6% vs last week          │
└────────────────────────────────────────────────────────┘
```

---

## 10. Requirements added

| ID | Requirement | Priority |
|---|---|---|
| FR-170 | Every task may carry a **time limit** in minutes, distinct from its due date. | P0 |
| FR-171 | The limit is pre-filled from the effort estimate (default 60 min per point) and is overridable. | P0 |
| FR-172 | Admin, Super Admin and **Team Coordinator** can set a task's time limit. | P0 |
| FR-173 | Only Admin and Super Admin may edit a limit after work has started. | P0 |
| FR-174 | A timer runs automatically while the task is *In Progress*. | P0 |
| FR-175 | The timer auto-pauses on status change away from *In Progress*/*Revisions*. | P0 |
| FR-176 | The timer auto-pauses outside working hours (Mon–Sat 09:00–17:00 PKT) and on Sundays and approved leave. | P0 |
| FR-177 | Idle prompt after 2h of inactivity; auto-pause 30 min later if unanswered. | P1 |
| FR-178 | Every timer segment is stored as its own immutable row in `time_entries`. | P0 |
| FR-179 | Manual time entry and adjustment is allowed, requires a reason, and is flagged as manual. | P1 |
| FR-180 | Reminders fire at 50%, 75%, 90%, 100%, 120% and 150% of the limit. | P0 |
| FR-181 | At 100% the task is flagged **Over Limit** and the member must mark it complete, request an extension, or explain why it remains open. | P0 |
| FR-182 | Admin and Coordinator are notified when a task goes over limit. | P0 |
| FR-183 | Members can request a time extension with a mandatory reason and a requested amount. | P0 |
| FR-184 | **Only Admin and Super Admin may approve, partially approve, or decline an extension.** Coordinators cannot. | P0 |
| FR-185 | The extension review screen shows automatic context: member's capacity, prior extensions, historical actuals for similar tasks, and remaining time to the due date. | P1 |
| FR-186 | Declining an extension requires a written reason. | P0 |
| FR-187 | Approved extensions increase the limit, resume the timer, and update the member's capacity load. | P0 |
| FR-188 | All limit changes, extensions and manual adjustments are written to the audit log. | P0 |
| FR-189 | Task cards and task detail show elapsed time against the limit with a progress indicator. | P0 |
| FR-190 | Admin dashboard shows over-limit tasks and pending extension requests. | P0 |
| FR-191 | Members see their own time data only (ADR-003). | P0 |
| FR-192 | Real consumed time feeds the capacity engine, replacing estimate-only load. | P1 |
| FR-193 | Estimate-accuracy and extension-pattern reports by member, skill, project type and client. | P1 |
| FR-194 | Daily digest includes any over-limit tasks and pending extension requests. | P1 |
| FR-195 | Out-of-working-hours work is flagged on time entries and reported. | P2 |

### Business rules
| ID | Rule |
|---|---|
| BR-017 | A time limit is distinct from a due date. Both may be breached independently. |
| BR-018 | Only Admin and Super Admin may grant additional time. Coordinators set limits but never extend them. |
| BR-019 | The timer never accrues outside configured working hours, on Sundays, or during approved leave. |
| BR-020 | Manual time entries and adjustments always require a reason and are always visibly flagged. |
| BR-021 | An over-limit task cannot be left unaddressed — the member must complete, request, or explain. |
| BR-022 | Declining an extension requires a written reason. |
| BR-023 | Time entries are append-only. Corrections create a new adjustment row; nothing is overwritten. |

---

## 11. Further enhancements

| ID | Idea | Value | Phase |
|---|---|:--:|---|
| **T-E1** | **Smart limit suggestion from history** — *"Similar video-edit tasks averaged 5h 20m. Suggest 5h 30m instead of 4h?"* Attacks the root cause rather than managing the symptom. | ⭐⭐⭐ | 5 |
| **T-E2** | **Auto-approve trivial extensions** — under 15 min with a reason, auto-granted and logged, to save Admin interruptions on trivia. Configurable, off by default. | ⭐⭐ | 6 |
| **T-E3** | **Pomodoro / focus mode** — optional structured work blocks with breaks for long editing sessions. | ⭐ | 7 |
| **T-E4** | **Time-based capacity forecasting** — *"At Kashif's current rate, his 7 open tasks need 31 hours. He has 22 working hours left this week."* Far sharper than point-based estimates. | ⭐⭐⭐ | 5 |
| **T-E5** | **Client time reports** — true hours per client vs. retainer, straight from timer data (pairs with P-03 in doc 15). | ⭐⭐⭐ | 5 |
| **T-E6** | **Overtime detection** — flags sustained out-of-hours work. Handle as a wellbeing signal, not a productivity metric. | ⭐⭐ | 6 |
| **T-E7** | **Timer on mobile** — start, pause, and request extensions from a phone. Essential for anyone shooting or on site. | ⭐⭐⭐ | 6 |
| **T-E8** | **Bulk limit setting** — set limits across a project's whole task list at once. | ⭐⭐ | 6 |
| **T-E9** | **"Why did this overrun?" tagging** — a one-tap reason on every over-limit task (client change · scope grew · technical issue · underestimated · blocked · interrupted). After 50 tasks this becomes the most actionable report in the system. | ⭐⭐⭐ | 5 |

**T-E9 is the one I'd push hardest for.** Knowing *that* tasks overrun is mildly useful. Knowing that 70% of overruns are tagged *"client change"* tells you to change your contracts, not your team.

---

## 12. Open questions

- **Q-041** — Over-limit behaviour: **B, enforced stop-and-account** *(recommended)*, A hard stop, or C soft warning? See §4.
- **Q-042** — Should time limits be **mandatory on every task**, or optional and set only where they matter?
  *Default: mandatory whenever an Admin or Coordinator assigns to someone else (mirrors BR-010); optional on self-created tasks.*
- **Q-043** — Should the timer be **fully automatic** (recommended) or should members start and stop it manually?
  *Default: automatic on status. Manual timers get forgotten and produce data worse than none.*
- **Q-044** — Is the **2-hour idle prompt** right, or too soon for long video renders?
  *Default: 2 hours. Editing sessions run long, so this may need to be 3.*
- **Q-045** — Should **Coordinators see pending extension requests** (read-only) even though they can't approve them?
  *Default: yes, read-only — Kashif coordinates the work and should know what's slipping.*
- **Q-046** — When an extension is **declined**, what happens to the task?
  *Default: it stays open and flagged; the Admin is expected to reassign, reduce scope, or accept the overrun. The system doesn't force an outcome.*
- **Q-047** — Should **out-of-hours work be blocked or just recorded**? If someone chooses to work Sunday, does the timer refuse to run?
  *Default: recorded but not counted toward the limit, with an option to have an Admin approve it in.*
