# ADR-004 — Working Calendar & Default Capacity

**Date:** 2026-08-06
**Status:** ✅ Accepted (capacity figure pending confirmation — Q-038)
**Decided by:** Project owner
**Relates to:** Q-010, Q-004, [`../06-WORKLOAD-CAPACITY-ENGINE.md`](../06-WORKLOAD-CAPACITY-ENGINE.md)

## Context
Overdue calculation, digest timing, capacity windows and deadline-fit scoring all depend on knowing the working calendar.

## Decision

| Setting | Value |
|---|---|
| Timezone | **Asia/Karachi (PKT, UTC+5)** |
| Working days | **Monday – Saturday** (6 days) |
| Working hours | **09:00 – 17:00** (8 hours/day) |
| Nominal weekly hours | **48** |
| **Default weekly capacity** | **36 points** ⚠️ *not 48 — see below* |
| Weekend | Sunday |
| Overdue evaluated at | 17:00 PKT on the due date |
| Daily digest | 09:00 PKT |

## Why 36 points, not 48

This is the part worth reading.

**Attendance hours are not productive hours.** A person present for 48 hours a week does not deliver 48 hours of focused task output. The gap is consumed by:

- breaks, prayers, and lunch
- meetings, briefs, and client calls
- email, WhatsApp, and coordination
- context switching between tasks
- reviewing other people's work
- equipment, file transfers, uploads, rendering waits
- the ordinary friction of a working day

Industry planning practice puts realistic focused output at **65–80%** of attendance. At 75% of 48 hours, that is **36 points**.

**Why this matters more than it sounds:** if capacity is set to 48, everyone will read as comfortably under-loaded right up to the moment they're drowning. The thresholds would never fire, the whole overload-prevention system would sit silent, and you would have built it for nothing. **Setting capacity too high is the single most common way workload systems fail.**

Starting at 36 and adjusting upward from real data (E-002, estimate calibration) is far safer than starting at 48 and discovering the thresholds are decorative.

## Threshold implications

| Band | Utilisation | Points (of 36) |
|---|---|---|
| 🟢 Available | 0–59% | 0 – 21 |
| 🔵 Healthy | 60–84% | 21 – 30 |
| 🟠 Near limit | 85–99% | 30 – 36 |
| 🔴 Over limit | 100%+ | 36+ |

## Consequences
- Per-member capacity remains individually editable — part-timers and heavy-meeting roles get their own number.
- After ~20 completed tasks per person, real logged time replaces the 75% assumption with measured data.
- If the team is genuinely delivering more than 36 points a week consistently, raise it — but raise it on evidence, not optimism.

## Open
**Q-038** — Confirm 36 points as the default, or set a different figure. If your team does very little meeting and coordination overhead, 40 may be more accurate.
