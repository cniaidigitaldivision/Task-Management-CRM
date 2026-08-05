# 09 — Tech Stack & Architecture

> **Status: RECOMMENDED, NOT LOCKED.** This is my proposal with reasoning. Confirm or change it via **Q-012** before Phase 1 begins.

---

## 1. The recommendation at a glance

| Layer | Choice | Why this one |
|---|---|---|
| **Framework** | **Next.js 16 (App Router) + TypeScript** | One codebase for UI and API. Server Components keep the app fast. TypeScript catches an entire class of bugs before runtime — worth it on a system with this many rules. |
| **UI** | **Tailwind CSS + shadcn/ui** | shadcn gives production-quality accessible components (tables, dialogs, drag-and-drop, command palette) that we own and can restyle. Not a locked-in library. |
| **Database** | **PostgreSQL** (Neon or Supabase, via Vercel Marketplace) | The data model is deeply relational — tasks↔users↔skills↔projects. Postgres is the right tool. Row-level security enforces permissions at the data layer, not just the UI. |
| **ORM** | **Drizzle** | Type-safe queries derived from the schema. Migrations are plain, readable SQL. Lighter than Prisma. |
| **Auth** | **Supabase Auth** *or* **Clerk** | Both give email invites, password reset, and session management out of the box. Clerk has a nicer UI; Supabase keeps everything in one place. See §4. |
| **Real-time** | **Supabase Realtime** (or Vercel Functions WebSockets) | Postgres change streams straight to the browser. No separate server to run. |
| **File storage** | **Vercel Blob** or **Supabase Storage** | Video previews and design files need real object storage, not a database column. |
| **Email** | **Resend** (via Vercel Marketplace) | Invites, password resets, digests. |
| **Hosting** | **Vercel** | Push-to-deploy, preview URLs for every change, generous free tier. Sized correctly for a 7-person internal tool. |
| **Charts** | **Recharts** | Workload bars, burndown, trend lines. |
| **AI (optional, v2)** | **Vercel AI Gateway + AI SDK** | Model-agnostic. Swap providers without touching code. Only if Q-009 is yes. |

---

## 2. Why not the alternatives

| Alternative | Why not |
|---|---|
| **Just use ClickUp / Asana / Trello** | Genuinely worth saying out loud: off-the-shelf tools cost ~$50–70/month for 7 people and would work *today*. But none of them do skill-aware assignment recommendations or hard capacity blocks with override reasons — that's your core requirement, and it's exactly the part they don't have. You're building this for the intelligence layer, not the task list. |
| **MongoDB** | Your data is relational to its bones. Modelling many-to-many skills, dependencies, and workload aggregation in a document store means reinventing joins badly. |
| **Firebase** | Excellent real-time, weak relational queries. The workload engine needs aggregate SQL. Wrong fit. |
| **MERN from scratch** | Two codebases, two deployments, hand-rolled auth, hand-rolled real-time. Weeks of work that Next.js + Supabase give you on day one. |
| **WordPress plugin** | No. |
| **Laravel / Django** | Both perfectly good. Choose one only if you or a developer on your team already knows it well — that outweighs everything else. **Tell me via Q-012 if so.** |

---

## 3. System architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          BROWSER (any device)                          │
│  Next.js React app · Tailwind + shadcn/ui                              │
│  ┌────────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐ │
│  │ My Work    │ │  Board    │ │ Workload  │ │ Admin    │ │ Task     │ │
│  │            │ │  (Kanban) │ │  View     │ │ Dashbrd  │ │ Detail   │ │
│  └────────────┘ └───────────┘ └───────────┘ └──────────┘ └──────────┘ │
│         ▲                    ▲                                         │
│         │ optimistic UI      │ live subscription                       │
└─────────┼────────────────────┼─────────────────────────────────────────┘
          │                    │
┌─────────▼────────────────────┼─────────────────────────────────────────┐
│                    VERCEL (Next.js server)                             │
│                              │                                         │
│  SERVER ACTIONS / API ROUTES │                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  auth guard  →  permission check  →  business rule  →  write      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  DOMAIN SERVICES (the brain — pure, testable, no framework)            │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ │
│  │ workload-engine    │ │ assignment-engine  │ │ notification-svc   │ │
│  │  · load calc       │ │  · 5-factor score  │ │  · fan-out         │ │
│  │  · thresholds      │ │  · eligibility     │ │  · batching        │ │
│  │  · rebalance       │ │  · explanations    │ │  · digest          │ │
│  └────────────────────┘ └────────────────────┘ └────────────────────┘ │
│  ┌────────────────────┐ ┌────────────────────┐                        │
│  │ permission-svc     │ │ audit-svc          │                        │
│  └────────────────────┘ └────────────────────┘                        │
│                                                                        │
│  CRON JOBS (Vercel Cron)                                               │
│   · 08:00 overdue scan   · 09:00 daily digest                          │
│   · hourly escalation checks  · nightly recurring-task generation      │
└────────────┬───────────────────────────────────┬───────────────────────┘
             │                                   │
   ┌─────────▼──────────┐              ┌─────────▼──────────┐
   │   PostgreSQL       │              │   Object Storage   │
   │   + Row-Level Sec  │              │   (attachments)    │
   │   + Realtime       │              └────────────────────┘
   └────────────────────┘
             │
   ┌─────────▼──────────┐   ┌────────────────────┐   ┌──────────────────┐
   │  Email (Resend)    │   │ AI Gateway (v2)    │   │ Telegram (v2)    │
   └────────────────────┘   └────────────────────┘   └──────────────────┘
```

### The one architectural rule that matters

**The workload engine and assignment engine are pure functions in `/lib/domain/`.** They take data in, return scores out. No database calls, no framework imports.

Why this matters to you: it means those two engines can be **unit tested exhaustively** — we can prove the capacity maths is right with dozens of test cases instead of hoping. It also means if you ever change hosting or framework, the intelligence survives untouched. This is the part of the system that must not be fragile.

---

## 4. Auth decision

| | Supabase Auth | Clerk |
|---|---|---|
| Cost at 7 users | Free | Free (up to 10k MAU) |
| Setup effort | Low | Very low |
| Invite-by-email flow | Manual-ish | Built in, polished |
| Role storage | Your own `users` table | Clerk metadata + your table |
| Everything in one vendor | ✅ | ❌ (separate service) |
| Row-level security integration | ✅ Native | Requires a JWT bridge |

**My recommendation: Supabase Auth**, purely because it makes row-level security trivial — the database itself knows who is asking, which is the strongest possible enforcement of doc 03's permission matrix. Clerk is the better product in isolation; Supabase is the better fit for this design.

---

## 5. Repository structure (once we build)

```
cni-crm/
├── docs/                       ← these planning documents
├── app/
│   ├── (auth)/                 login, invite-accept, reset
│   ├── (app)/
│   │   ├── my-work/            member landing page
│   │   ├── tasks/              list + board + calendar
│   │   │   └── [reference]/    task detail
│   │   ├── workload/           team capacity view
│   │   ├── dashboard/          admin overview
│   │   ├── team/               member management
│   │   ├── projects/
│   │   ├── reports/
│   │   └── settings/           thresholds, skills, statuses, weights
│   └── api/
│       ├── cron/               overdue, digest, recurring
│       └── webhooks/
├── components/
│   ├── ui/                     shadcn primitives
│   ├── task/                   task-card, task-form, status-picker
│   ├── workload/               capacity-bar, workload-grid
│   └── assignment/             recommendation-panel, override-dialog
├── lib/
│   ├── domain/                 ★ THE BRAIN — pure, fully unit-tested
│   │   ├── workload-engine.ts
│   │   ├── assignment-engine.ts
│   │   ├── scoring.ts
│   │   ├── permissions.ts
│   │   └── __tests__/
│   ├── db/                     schema.ts, queries/, migrations/
│   ├── realtime/
│   └── notifications/
├── types/
└── tests/                      e2e (Playwright)
```

---

## 6. Security posture

| Concern | Measure |
|---|---|
| Permission bypass | Checked in the server action **and** enforced by Postgres RLS. Two independent layers. |
| Session hijack | HTTP-only secure cookies, short-lived JWT with refresh |
| Data at rest | Managed Postgres encryption (provider default) |
| File uploads | Type + size validation, signed URLs, no public bucket listing |
| Audit | Append-only `activity_log`; no UPDATE or DELETE grant on it for any role |
| Secrets | Vercel environment variables, never committed. `vercel env pull` for local dev. |
| Rate limiting | On auth endpoints and file uploads |
| Backups | Automated daily snapshot, 7-day retention minimum (NFR-005) |

---

## 7. Realistic cost

| Service | Free tier covers us? | If we outgrow it |
|---|---|---|
| Vercel Hobby | ✅ Comfortably at this scale | Pro $20/mo |
| Supabase Free | ✅ 500MB DB, 1GB storage, 200 concurrent realtime | Pro $25/mo |
| Resend Free | ✅ 3,000 emails/month | $20/mo |
| Vercel Blob | Small usage free | Pay per GB |
| AI Gateway (v2, optional) | — | ~$2–10/mo at this volume |
| Domain (optional) | — | ~$12/year |

**Realistic v1 running cost: $0/month.** The likely first upgrade is storage, if you attach a lot of video.

Compare: ClickUp Business for 7 users is roughly $84/month. Worth keeping in view.

---

## 8. Environments

| Environment | Purpose | Data |
|---|---|---|
| **Local** | Development | Seeded fake data, mirrors the real team shape |
| **Preview** | Auto-deployed per change, for you to click through and approve before it goes live | Separate database, seeded |
| **Production** | The real thing | Real data, backed up daily |

You'll get a preview URL for every feature — you can try each one on your phone before it reaches the team.

---

## 9. Open decisions

- **Q-012** — Is this stack acceptable? Do you or anyone on your team already know a different one (Laravel, Django, MERN)?
- **Q-013** — What timeline are you working to?
- **Q-019** — Do you want a custom domain (e.g. `crm.yourcompany.com`) or is a `*.vercel.app` URL fine?
- **Q-020** — Where should the database live geographically? (Affects latency — closest region to your team.)
