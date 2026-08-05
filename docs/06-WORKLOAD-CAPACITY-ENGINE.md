# 06 — Workload & Capacity Engine

> Your requirement, restated: *"I don't want the overloading of tasks to a single member… set a threshold… if Yusra already has 10 tasks, the system should intelligently tell me what to do next."*

This document defines exactly how "overloaded" is measured and what the system does about it.

---

## 1. Why a raw task count is the wrong measure

Your example was "Yusra already has 10 tasks". That's the right instinct, but counting tasks alone breaks immediately:

- 10 tasks of *"repost this story"* (5 minutes each) ≈ **1 hour of work**
- 3 tasks of *"build and launch a full ad campaign"* ≈ **3 days of work**

A pure count would say Yusra is 3× busier than the person with 3 campaigns. She isn't — she's far less busy.

**So we measure two things at once:**

| Measure | What it catches | Default limit |
|---|---|---|
| **Capacity points (primary)** | Actual volume of work | 100% of weekly capacity |
| **Concurrent active tasks (secondary)** | Context-switching / attention fragmentation | 5 tasks *In Progress* at once |

Both matter. A person can be at 40% capacity and still be dysfunctional if they're juggling 12 things simultaneously. Your instinct about task count is preserved — it's just the *second* guard rather than the only one.

---

## 2. The core formula

### Step 1 — Cost of a single task

```
task_load = effort_points × priority_weight × status_weight
```

| Component | Source |
|---|---|
| `effort_points` | XS=1, S=2, M=4, L=8, XL=16 (doc 05 §5) |
| `priority_weight` | Urgent 1.5 · High 1.25 · Medium 1.0 · Low 0.75 (doc 05 §4) |
| `status_weight` | Backlog 0.25 · To Do 1.0 · In Progress 1.0 · Blocked 1.0 · In Review 0.5 · Revisions 1.0 · Done 0 · Cancelled 0 |

### Step 2 — A member's current load

```
current_load = Σ task_load  for all their open tasks in the active window
```

Default window = **current week (Mon–Sun)**. A task counts toward a week if its `due_date` falls in it, or if it's already *In Progress* regardless of due date.

### Step 3 — Their effective capacity

```
effective_capacity = weekly_capacity_points × availability_multiplier
```

| Situation | Multiplier |
|---|---|
| Normal full week | 1.0 |
| 2 days of approved leave (of 5) | 0.6 |
| Public holiday Monday | 0.8 |
| On leave all week | 0.0 → **excluded from all recommendations** (BR-005) |

### Step 4 — Utilisation

```
utilisation_pct = (current_load / effective_capacity) × 100
```

---

## 3. Thresholds — the traffic light

| Band | Utilisation | Colour token | System behaviour |
|---|---|---|---|
| **Available** | 0 – 59% | 🟢 `load-available` | Preferred in recommendations. Boosted in ranking. |
| **Healthy** | 60 – 84% | 🔵 `load-healthy` | This is the target zone. Normal recommendation. |
| **Near limit (soft threshold)** | 85 – 99% | 🟠 `load-warning` **orange** | Recommended with a **visible warning**: *"Yusra is at 91% — assigning this puts her near capacity."* Assignment proceeds. (BR-004) |
| **At/over limit (hard threshold)** | 100%+ | 🔴 `load-over` | **Blocked.** Admin/Super Admin can override, but must type a reason, which is logged. **Team Coordinator cannot override at all.** (BR-003) |
| **Critical** | 130%+ | 🔴 `load-over` + alert | Proactive alert to Admins even without a new assignment attempt. Rebalance Advisor auto-triggers. |

> **Amended Session 04** ([C-01](19-MASTER-SPECIFICATION-REGISTRY.md#9--contradiction-sweep--session-04)): *Near limit* is **orange** `#F97316`, not amber — amber collided with the brand gold. Exact values live in [doc 18 §5](18-DESIGN-SYSTEM-AND-BRANDING.md).

All four boundaries are editable in Settings by Super Admin (FR-062). Nothing here is hard-coded.

### The secondary guard

```
IF active_task_count >= max_concurrent_tasks (default 5)
   → Amber warning regardless of capacity utilisation
IF active_task_count >= max_concurrent_tasks + 3
   → Hard block, override required
```

---

## 4. Worked example — the team on a Monday morning

> **Note (Session 02):** the default weekly capacity is now **36 points**, not 40 — see [`decisions/ADR-004`](decisions/ADR-004-working-calendar-and-capacity.md). Your working week is Mon–Sat 09:00–17:00 = 48 nominal hours, but realistic focused output is ~75% of attendance. Setting capacity to 48 would mean the thresholds never fire and the whole overload system sits silent — the most common way workload tools fail.
>
> The example below is left at 40 points because the *ratios* are what it illustrates. The arithmetic is identical at 36.

Weekly capacity: 40 points each. Soft 85% (34 pts), hard 100% (40 pts).

| Member | Role | Open tasks | Load (pts) | Utilisation | Band |
|---|---|:--:|:--:|:--:|---|
| **Kashif** | Video Editor / Lead | 4 | 18.0 | 45% | 🟢 Available |
| **Yusra** | Ads Manager | 10 | 38.5 | 96% | 🟠 Near limit |
| **Member C** | Graphic Designer | 3 | 12.0 | 30% | 🟢 Available |
| **Member D** | Content Writer | 6 | 33.0 | 83% | 🔵 Healthy |
| **Member E** | Web Developer | 2 | 41.0 | 103% | 🔴 Over limit |
| **Member F** | Social Media Mgr | 5 | 24.0 | 60% | 🔵 Healthy |

Read this table against your own example. Yusra has 10 tasks — the most on the team — and yes, she's at 96%, genuinely near her limit. But note **Member E**: only **2 tasks**, and *over capacity*, because those two are XL builds. A task-count system would have handed him more work. This system won't.

### What the Admin sees when trying to assign a new ad task

```
┌────────────────────────────────────────────────────────────────┐
│  Assign: "Launch Eid sale campaign — Meta + TikTok"           │
│  Skills needed: ads-management · Estimate: L (8 pts) · High    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ⚠️  Yusra is your best skill match but is at 96% capacity.    │
│      Adding 10 pts would take her to 121% — over the limit.    │
│                                                                │
│  RECOMMENDED INSTEAD                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Member F — Social Media Manager          Score 78 🟢  │  │
│  │    ads-management: 3/5 · 60% → 85% after this            │  │
│  │    Can finish 2 days before the deadline                 │  │
│  │    [ Assign ]                                            │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ 2. Yusra — Ads Manager                      Score 71 🟠  │  │
│  │    ads-management: 5/5 (expert) · 96% → 121% ⛔          │  │
│  │    Requires override with reason                         │  │
│  │    [ Override & assign ]                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  OR RESOLVE THE BOTTLENECK                                     │
│  • Move CNI-118 (S, Low) from Yusra → Member C  [ Do it ]      │
│    Frees 1.5 pts. Yusra drops to 92%.                          │
│  • Push the due date to next Wednesday          [ Do it ]      │
│    Yusra's next-week load is only 34%.                         │
│  • Split into 2 subtasks: creative + scheduling [ Do it ]      │
│    Kashif takes creative (45%), Yusra takes scheduling.        │
└────────────────────────────────────────────────────────────────┘
```

That last block — *"OR RESOLVE THE BOTTLENECK"* — is the direct answer to your question *"the system should intelligently tell me what I should do next."* It doesn't just refuse. It offers concrete, one-click ways forward.

---

## 5. The Rebalance Advisor (FR-056)

Runs continuously and appears as a card on the Admin dashboard whenever the team's distribution goes lopsided.

**Trigger conditions (any one):**
- Any member ≥ hard threshold
- Spread between highest and lowest utilisation > 40 percentage points
- Any member red for 3 consecutive days (FR-066)
- Team average > 90% (a capacity problem, not a distribution problem — different advice)

**What it proposes**, ranked by benefit-to-disruption ratio:

| Move type | Example |
|---|---|
| **Reassign** | *"Move CNI-118 from Yusra (96%) to Member C (30%). Member C has ads-management:2 — capable, not expert. Frees 1.5 pts."* |
| **Defer** | *"CNI-125 is Low priority, due Friday. Push to next week — Yusra's next-week load is 34%."* |
| **Split** | *"CNI-131 is XL (16 pts). Split into 3 subtasks across Kashif, Member C and Yusra."* |
| **Escalate** | *"The whole team is above 90%. This is not a distribution problem — you are under-resourced this week. Consider deferring the lowest-priority 5 tasks or extending deadlines."* |

Every proposal is **a suggestion with a button**, never an automatic action. The human decides. (Principle 2, doc 01.)

---

## 6. Guarding against gaming and drift

| Risk | Mitigation |
|---|---|
| People under-estimate effort so they look free | `time_logs` (FR-094) track actual vs estimate. After ~20 tasks the system shows a per-person **estimation accuracy factor** and can auto-adjust their loads. |
| People never close tasks, so load looks permanently high | Stale-task detection: *In Progress* with no activity for 5+ days is flagged. |
| Everything gets marked Urgent to jump the queue | Urgent-ratio guard (E-011, doc 05 §4). |
| Backlog quietly fills up and becomes invisible debt | Backlog counts at 25% and has its own dashboard widget with an ageing indicator. |
| Estimates are missing entirely | BR-010: an Admin cannot assign a task to someone else without an effort estimate. |
| One person is *under*-loaded and nobody notices | Green members are surfaced in recommendations first, and the dashboard shows the lowest-utilised member explicitly. |

---

## 7. Settings summary (all Super-Admin editable)

| Setting | Default | Range |
|---|---|---|
| Default weekly capacity | **36 points** (ADR-004) | 5–80 |
| "Other" work warning threshold | 15% of capacity | 0–100% |
| Project-type shed order | Client › Event › Business › Self-Promo › Other | configurable (Q-027) |
| Per-member capacity override | — | per user |
| Soft threshold | 85% | 50–99% |
| Hard threshold | 100% | 60–150% |
| Critical alert threshold | 130% | — |
| Max concurrent active tasks | 5 | 1–20 |
| Workload window | Week | Day / Week / Fortnight |
| Backlog status weight | 0.25 | 0–1 |
| In-Review status weight | 0.50 | 0–1 |
| Priority weights | 1.5 / 1.25 / 1.0 / 0.75 | any |
| Effort point values | 1/2/4/8/16 | any |
| Who may override a hard block | Admin + Super Admin | role picker |

---

## 8. Project-type awareness — added Session 02

With projects now required ([`15-PROJECTS-AND-PROJECT-TYPES.md`](15-PROJECTS-AND-PROJECT-TYPES.md)), workload gains a second dimension: **not just how much, but what kind.**

- The workload view and Member Activity Preview break load down by project type.
- The Rebalance Advisor sheds work in a configurable type order — by default **Client › Event › Business › Self-Promotion › Other**, so unbilled ad-hoc work is dropped before client work.
- "Other" (uncategorised) work exceeding **15%** of a member's or the team's capacity raises a warning. That's roughly 1.5 days a week of work nobody can account for.
- Self-promotion capacity is reported explicitly, because it is always the first thing to silently reach zero.

---

## 9. Decisions locked in this area

| | |
|---|---|
| ✅ **Q-004** | Thresholds 85% / 100% / 5 concurrent — **accepted** (ADR-005) |
| ✅ **Q-008** | Hard block is a **real block**; Admin/Super Admin override with a typed logged reason; Coordinator cannot override (ADR-005) |
| ✅ **Q-010** | Asia/Karachi, Mon–Sat, 09:00–17:00 (ADR-004) |

## 10. Still open

- **Q-007** — Weekly or daily capacity window? *Default: weekly, with a daily breakdown on hover.*
- **Q-025** — Is 15% the right warning threshold for "Other" work?
- **Q-027** — Is `Client › Event › Business › Self-Promotion › Other` the right shed order?
- **Q-038** — Confirm **36 points** as the default weekly capacity (vs. 40). See ADR-004 for the reasoning.
