# ADR-008 — Single-Tenant Architecture

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-034, Q-015, [`../16-SECURITY-AND-IDENTITY.md`](../16-SECURITY-AND-IDENTITY.md) §13

## Context
The owner intends to sell this as a product eventually (Q-015). Session 02 recommended adding an `organisation_id` column to every table now, arguing that retrofitting tenancy later is expensive. The owner declined:

> *"I'll sell this eventually but for now we are focusing on the company's CRM… We cannot make it a generic application yet that could be sold across multiple tenants."*

## Decision
**Build single-tenant. No `organisation_id`, no tenant scaffolding, no multi-tenant abstractions.** The system is built for Crescent Nova International specifically.

## Why
The owner's reasoning is sound and worth stating properly rather than treating as a compromise:

- A product built for one real team, used daily by that team, is the *only* reliable way to discover what the product should be. Designing for hypothetical future customers before the first real one is satisfied is how internal tools become generic and useful to nobody.
- Multi-tenant scaffolding adds complexity to every query and every security policy, on day one, in exchange for a benefit that arrives at an unknown future date.
- The retrofit is expensive but **bounded and well-understood** — it is not an unsolvable problem, just a chunk of work.

## The hedge we take anyway (zero cost, no decision required)

| Practice | Effect |
|---|---|
| All database access flows through one query layer in `lib/db/queries/` | Tenant scoping, if ever added, is applied in one place |
| RLS policies live in named, versioned migration files | Adding a tenant predicate later is editing a known file set, not archaeology |
| No hard-coded company name, logo, or colours in components — all from config | Branding is already parameterised |

These are ordinary good practice and would be done regardless. They happen to keep a future migration contained.

## Consequences
**Easier:** simpler schema, simpler queries, simpler RLS, faster delivery of the thing that's actually needed now.

**Harder later, recorded so the estimate is not a surprise:** turning this into a SaaS product means adding the column to every table, backfilling to a single organisation, adding the predicate to every RLS policy, adding tenant resolution to the session layer, and testing hard for cross-tenant leakage. Real work, and the leakage testing is the part that must not be rushed — cross-tenant data exposure is the worst class of bug a SaaS product can ship.

**Revisit when:** a second organisation actually wants to use it. Not before.
