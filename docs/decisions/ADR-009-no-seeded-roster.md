# ADR-009 — No Seeded Roster: the Admin Builds the Team

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-001, FR-010, FR-011, [`../03-ROLES-AND-PERMISSIONS.md`](../03-ROLES-AND-PERMISSIONS.md) §6

## Context
Sessions 01 and 02 treated the team roster as a blocking input — I asked repeatedly for names, emails and skills so members could be seeded at setup. The owner rejected the premise:

> *"I don't want you to add any roster or anything. This would be created by the admin. Make this an option for the admin to create their team members, assign them roles, his email, and his skills, whatever is required on the field."*

## Decision
**The system ships with no team data.** Setup creates exactly one account: the Super Admin. Everything else is built through the application.

```
Setup            → Super Admin account only
Super Admin      → creates the Admin account
Admin            → creates Coordinators and Members, sets their
                   role, job title, email, skills, proficiency,
                   weekly capacity, and max concurrent tasks
```

No names, emails, skills, or capacities appear anywhere in the codebase, in seed scripts, or in configuration.

**Consequently, `templates/TEAM-ROSTER-TEMPLATE.md` is retired.** It is replaced by [`templates/FIRST-RUN-SETUP-GUIDE.md`](../templates/FIRST-RUN-SETUP-GUIDE.md) — a walkthrough for whoever performs the initial setup — and the skills library ships as an editable starter list rather than a fixed one.

## Why
The owner is right, and the earlier approach was the weaker one.

- The original brief already required that adding a team member be *"a dynamical system… updated in real time"* with no code change (FR-011). A hard-coded roster would have contradicted a requirement already agreed.
- Seeded data becomes stale the first time someone joins or leaves, and creates two paths for the same operation — one through code, one through the UI — which is exactly how bugs and drift appear.
- **It forces the team-management UI to be genuinely complete on day one.** If the only way to create a member is the form, the form has to work properly. Nothing can be quietly deferred by pre-loading the database.
- It removed a blocker that was holding up the entire project for information that was never actually needed.

## Consequences
**Easier:** no blocker; one code path for member creation; the "add member #8" flow is proven from the first day because it's the only flow that exists.

**Harder:** the very first login is an empty system, so first-run experience matters more. Addressed by a guided setup wizard: create the Admin, create the first project, add the first member, create the first task — with the interface explaining each step rather than presenting a blank page.

**Skills library:** ships with a starter set of ~35 common creative, marketing and technical skills (see the setup guide) that the Admin can edit, rename, delete or extend. A blank skills library would make the assignment engine useless on day one; a fixed one would make it wrong. Editable defaults are the correct middle.
