# ADR-006 — Projects, Project Types, and the "Other" Category

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-006, [`../15-PROJECTS-AND-PROJECT-TYPES.md`](../15-PROJECTS-AND-PROJECT-TYPES.md)

## Context
Session 01 proposed a Client/Project layer as an *optional* enhancement (E-001). The owner made it a firm requirement in Session 02, with a specific set of project types and a specific rule about how ad-hoc work is surfaced.

## Decision

**1. Projects are a required v1 feature.** Created and managed by Admin and Super Admin only.

**2. Five project types, each with type-specific fields:**

| Type | Key fields | Special behaviour |
|---|---|---|
| 🎪 **Event** | Event date, venue, deliverables offset | Fixed date drives backwards deadline scheduling |
| 🤝 **Client** | Client, contact, retainer hours, billable | Capacity consumed per client is tracked |
| 🏢 **Business** | Objective, area | Internal company work |
| 📣 **Self-Promotion** | Channel, campaign goal | % of capacity reported — this work is first to silently slip |
| 📦 **Other** | **Mandatory description**, requested by | Surfaced separately everywhere; warns above 15% of capacity |

**3. Every task belongs to exactly one project. There are no orphan tasks** (BR-011).

**4. Tasks in an Other project cannot be saved without a written description of what the work is** (BR-012).

**5. A Member Activity Preview** (doc 15 §6), available to Admin, Super Admin and Coordinator, shows a member's tasks grouped by project type with Other given its own distinct, prominent section — including each task's written explanation and a one-click promote-to-real-project action.

**6. Project context travels with the task** — name, type, and type-specific detail appear on task cards and on the task detail page, so a member working across several projects always knows which one they're in.

## Why

**On projects being required rather than optional:** the owner called this a CRM. Without a client/project dimension it is a task list. The project layer is what connects work to *who it is for*, which is what makes questions like "which client is consuming my team?" answerable.

**On types changing the form:** a type that only changes a chip colour is decoration. A type that changes which fields appear — event date for events, retainer hours for clients — carries real information and enables type-specific behaviour like backwards scheduling and retainer tracking.

**On the Other category:** in every small team, the work that quietly consumes the week is the work nobody wrote down — favours, "quick" requests, unbilled extras. Making Other a first-class, mandatory-description, separately-surfaced category turns invisible work into visible work. This is arguably the most valuable single feature in the projects subsystem, and it came directly from the owner's requirement.

## Consequences
**Easier:** per-client and per-type capacity reporting; project familiarity as an assignment factor; type-aware rebalancing priority; catching unbilled work.
**Harder:** slightly more friction at task creation — a project must be selected. Mitigated by a permanent "Misc / Ad-hoc" Other project always existing (Q-024), so there is always a valid choice.
**Follow-on:** members see only projects they have a task in (BR-016, consistent with ADR-003).
