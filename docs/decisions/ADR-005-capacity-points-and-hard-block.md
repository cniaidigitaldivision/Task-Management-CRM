# ADR-005 — Capacity Points, Not Task Count · Hard Block Enforced

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner (defaults accepted)
**Relates to:** Q-004, Q-008, [`../06-WORKLOAD-CAPACITY-ENGINE.md`](../06-WORKLOAD-CAPACITY-ENGINE.md)

## Context
The original brief proposed limiting the number of tasks per member ("Yusra already has 10 tasks"). Session 01 argued that a raw count is the wrong primary measure.

## Decision

**1. Workload is measured in weighted capacity points, not task count.**

```
task_load    = effort_points × priority_weight × status_weight
current_load = Σ task_load over the member's open tasks in the window
utilisation  = current_load / effective_capacity
```

**2. Task count is retained as a secondary guard** — max concurrent *active* tasks, default 5. It catches attention fragmentation, which points alone miss.

**3. The hard threshold is a genuine block, not a warning.**

| Band | Behaviour |
|---|---|
| 🟢 0–59% | Preferred in recommendations |
| 🔵 60–84% | Normal |
| 🟠 85–99% | Warning shown, assignment proceeds |
| 🔴 100%+ | **Blocked.** Admin and Super Admin may override with a typed reason, which is logged. **Team Coordinator cannot override.** |

## Why

**On points vs. count:** ten "repost this story" tasks ≈ 1 hour. Two "build and launch a campaign" tasks ≈ 3 days. A count-based system ranks the first person as five times busier when they are in fact far less busy. In the worked example in doc 06 §4, the member at 103% capacity has only **two** tasks — a count-based system would have given him more work.

**On the block being real:** the owner's stated goal was preventing overload. A warning that everyone clicks through is not a threshold, it is a speed bump. Requiring a typed reason means the override is a deliberate, attributable decision rather than a reflex — and the audit log makes the pattern visible if it becomes habitual.

**On Coordinators not overriding:** override authority is an operational-risk decision. Kashif coordinates work; deciding to knowingly overload a colleague is a management call that belongs with the Admin and Super Admin.

## Consequences
**Requires:** effort estimates on every task an Admin assigns to someone else (BR-010). Without estimates the maths is meaningless, so this is enforced rather than encouraged.
**Enables:** honest utilisation, meaningful thresholds, deadline-fit scoring, the Rebalance Advisor, and per-project capacity reporting.
**Risk:** estimates drift from reality over time. Mitigated by E-002, estimate calibration from logged time.
