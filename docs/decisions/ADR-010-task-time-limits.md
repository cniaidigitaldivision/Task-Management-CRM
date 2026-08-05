# ADR-010 — Task Timers, Time Limits & Extension Authority

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** [`../17-TASK-TIMERS-AND-TIME-LIMITS.md`](../17-TASK-TIMERS-AND-TIME-LIMITS.md)

## Context
The owner added a requirement in Session 03: every task carries a time limit, members cannot run past it unnoticed, Admin and Coordinator set the limit, and only the Admin can grant more time.

## Decision

**1. A task has two independent deadlines:**
- **Due date** — when it must be finished (calendar)
- **Time limit** — how much working time it may consume (budget, in minutes)

Both can be breached independently, and they mean different things.

**2. The limit is pre-filled from the effort estimate** at 60 minutes per capacity point (XS=1h, S=2h, M=4h, L=8h, XL=16h) and is overridable.

**3. The timer runs automatically** while the task is *In Progress* or *Revisions*. It auto-pauses on any other status, outside working hours (Mon–Sat 09:00–17:00 PKT), on Sundays, during approved leave, and after 2.5 hours of unanswered idle.

**4. Authority is split:**

| Action | Super Admin | Admin | Coordinator | Member |
|---|:--:|:--:|:--:|:--:|
| Set the initial time limit | ✅ | ✅ | ✅ | ❌ |
| Edit the limit after work starts | ✅ | ✅ | ❌ | ❌ |
| **Grant additional time** | ✅ | ✅ | ❌ | ❌ |
| Request additional time | ✅ | ✅ | ✅ | ✅ |

**5. At 100% of the limit the task is flagged Over Limit** and the member must choose: mark complete, request an extension, or explain why it remains open. Work is not physically blocked (Q-041, option B).

**6. Extension requests carry a mandatory reason**, are reviewed only by an Admin or Super Admin, may be granted in part, require a written reason if declined, and are fully audited.

## Why

**On two deadlines rather than one:** a task finished on Thursday that consumed nine hours instead of four is a *different failure* from a task with hours to spare that nobody started until Friday. The first means the estimate was wrong; the second means scheduling was. Until now the system could not tell them apart, and they need opposite fixes.

**On working-hours pausing:** without it, a task started at 16:30 on Saturday would show 65 hours consumed by Monday morning. Every limit would breach overnight and the feature would be pure noise within a week. This is the detail the whole subsystem depends on.

**On not hard-blocking at 100%** (contrary to a literal reading of *"cannot be executing beyond the time limits"*): a hard lock cannot stop someone mid-render. What it actually produces is work done outside the system and back-filled later — which destroys the data the feature exists to collect — plus a member sitting idle waiting for an approval that may not arrive until tomorrow. The enforced stop-and-account model achieves the owner's intent, which is that nobody runs past their limit **silently or unaccountably**, without pushing work off the books.

**On extensions being Admin-only:** the owner's explicit instruction, and structurally correct. Setting a budget is planning; extending it is a cost decision. The Coordinator does the former, the Admin the latter.

## Consequences

**This unlocks four things that were previously guesswork:**
- Real consumed time replaces estimates in the capacity engine (doc 06)
- Estimate calibration (E-002) becomes possible — the timer is its missing input
- Deadline-fit scoring (S3, doc 07) becomes measured rather than assumed
- True cost per project and per client becomes reportable (P-03 in doc 15)

**Costs:** more moving parts, and a real risk of garbage data if timers are left running or never started. Mitigated by automatic status-driven timing, working-hours pausing, idle prompts, end-of-day nudges, and marking every manual adjustment visibly as manual.

**Cultural risk, worth naming:** timers can read as surveillance. The mitigations are deliberate — members see only their own data (ADR-003), out-of-hours work is treated as a wellbeing signal rather than a productivity metric, and reports are framed around **estimate accuracy** rather than individual speed. If video tasks are extended 62% of the time, that is a statement about the estimates, not about the editor.
