# ADR-001 — Tech Stack

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** Q-012, [`../09-TECH-STACK-AND-ARCHITECTURE.md`](../09-TECH-STACK-AND-ARCHITECTURE.md)

## Context
A stack had to be chosen before any code. The system needs relational data, strict server-side authorisation, real-time updates, and file storage, for a team of 7 at near-zero cost.

## Decision
**Next.js 16 (App Router) + TypeScript + Supabase + Tailwind CSS + shadcn/ui, deployed on Vercel.**

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Real-time | Supabase Realtime |
| File storage | Supabase Storage |
| ORM | Drizzle |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Hosting | Vercel |
| Email | Resend (via Vercel Marketplace) |
| Charts | Recharts |

## Why
- The data model is deeply relational — Postgres is correct, and document stores would mean reinventing joins.
- Supabase Row-Level Security lets the permission matrix (doc 03) and member isolation (ADR-003) be enforced **inside the database**, not just in application code. Given the security requirements in doc 16, that second independent layer matters.
- Realtime, Auth and Storage in one service removes three integrations we would otherwise hand-build.
- One codebase for UI and API.
- $0/month at this scale.
- TypeScript catches a whole class of bugs before runtime, which matters in a system with this many business rules.

## Consequences
**Easier:** real-time, auth, RLS, storage, deployment, preview environments per change.
**Harder:** some coupling to Supabase. Mitigated by keeping the workload and assignment engines as pure functions in `lib/domain/` with no database or framework imports — the intelligence survives any infrastructure change.
**If we changed our minds:** Postgres is portable; Supabase-specific features (Realtime, RLS syntax, Auth) would need replacing. Moderate cost, not catastrophic.
