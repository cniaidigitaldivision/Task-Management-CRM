# 13 — Open Questions

**Updated:** 2026-08-06 (Session 03)

> ✅ **Nothing here blocks Phase 1 any more.** Everything below has a documented default. Answer what you care about; silence means the default applies.

Answer format: reply with `Q-0NN: your answer` for anything you want to change.

---

## ✅ ANSWERED — locked, do not reopen

| ID | Question | Your answer | Recorded in |
|---|---|---|---|
| **Q-001** | Team roster | **Not needed.** No seeded data — the Admin creates members in-app with role, email, skills and capacity. | [ADR-009](decisions/ADR-009-no-seeded-roster.md) |
| **Q-022** | Company name | **Crescent Nova International (CNI)** | — |
| **Q-030** | Account recovery | **"Forgot password" on all 4 roles** → emailed one-time code → reset. **3 failed attempts locks the account**, cleared by emailed unlock code. | [ADR-007](decisions/ADR-007-account-recovery.md) |
| **Q-034** | Multi-tenancy | **No.** Single-tenant, built for CNI only. | [ADR-008](decisions/ADR-008-single-tenant.md) |
| **Q-038** | Default weekly capacity | **36 points** confirmed | [ADR-004](decisions/ADR-004-working-calendar-and-capacity.md) |
| — | Task time limits & timers | **Added as a requirement.** Admin + Coordinator set limits; **only Admin extends.** | [ADR-010](decisions/ADR-010-task-time-limits.md), [doc 17](17-TASK-TIMERS-AND-TIME-LIMITS.md) |
| — | Phase permission | **No phase starts without explicit go-ahead.** Step by step within a phase, then stop. | [`SESSION-STATE.md`](SESSION-STATE.md) §2 |
| **Q-002** | Role model | **4 roles: Super Admin · Admin · Team Coordinator · Team Member.** Super Admin manages Admins and is immutable by anyone else. | [ADR-002](decisions/ADR-002-four-role-model.md) |
| **Q-003** | Can members see each other? | **No.** Members see only their own tasks, workload and projects — not other members' roles, skills, capacity or work. | [ADR-003](decisions/ADR-003-member-data-isolation.md) |
| **Q-004** | Thresholds | Defaults accepted: soft 85%, hard 100%, max 5 concurrent | [ADR-005](decisions/ADR-005-capacity-points-and-hard-block.md) |
| **Q-006** | Client/Project layer | **Yes — required in v1**, with 5 project types | [ADR-006](decisions/ADR-006-projects-and-other-category.md) |
| **Q-008** | Hard block real or warning? | **Real block.** Admin/Super Admin override with typed logged reason. Coordinator cannot. | [ADR-005](decisions/ADR-005-capacity-points-and-hard-block.md) |
| **Q-010** | Timezone & working week | **Asia/Karachi · Monday–Saturday · 09:00–17:00** | [ADR-004](decisions/ADR-004-working-calendar-and-capacity.md) |
| **Q-012** | Tech stack | **Next.js + TypeScript + Supabase + Tailwind** (+ shadcn/ui, Vercel, Drizzle) | [ADR-001](decisions/ADR-001-tech-stack.md) |
| **Q-015** | Sell as SaaS later? | **Yes eventually — single company for now.** Drives Q-034. | doc 16 §13 |

---

## 🟠 NEW — from the branding work (Session 04)

### Q-049 · Do you have the logo as a vector?
The supplied file is a **JPEG on a white background**, so it can't sit on a dark surface — and dark theme is now a requirement. I need SVG variants with transparency.

If you have the original AI/EPS/SVG, that's ideal. If not, **I can trace the mark to SVG from the JPEG** — good enough at interface sizes and it solves the transparency problem.
**Default: I trace it.**

### Q-050 · What is the app called in the interface?
The logo belongs to the **AI & Digital Division** (8th division). The CRM may serve wider than that division.
**Default: sidebar shows the division lockup; browser tab reads "CNI CRM".**

### Q-051 · Default theme for a new user?
**Default: `system` — follows their operating system.**

### Q-052 · Are there official CNI brand hex values?
My palette is sampled from the JPEG and is close, but exact brand values would be better if they exist.
**Default: use my sampled values.**

### Q-053 · Serif headings, or sans throughout?
The wordmark is serif. Using a serif for page titles echoes it; sans throughout is plainer.
**Default: serif for page titles and auth screens only; sans everywhere else.**

---

## 🟠 From the timer and recovery work (Session 03)

### Q-039 · MFA after the email code for Super Admin and Admin resets?
Your recovery flow stays exactly as you described. The question is whether privileged accounts also tap their authenticator after entering the email code.

**Why it matters:** without it, whoever controls your brother's mailbox can reset his password and own the CRM. With it, a hacked Gmail is not enough. For two people who already carry MFA, it's one extra tap.
**Default: yes for Super Admin and Admin. Coordinators and Members go straight through.**

### Q-040 · Recovery email format
6-digit code, click-link, or both?
**Default: both in the same email** — the link is faster on a phone, the code works when a mail client mangles the link.

### Q-041 · What happens when a task hits its time limit?
| Option | |
|---|---|
| **A** | **Hard stop** — task locks until an Admin grants time |
| **B** ⭐ | **Enforced stop-and-account** — task flagged Over Limit, blocking banner, member must mark complete / request extension / explain. Admin notified. Work not physically blocked. |
| **C** | Soft warning only |

**Default: B.** A hard lock can't stop someone mid-render — what actually happens is the work moves off the system and gets back-filled later, destroying the data the feature exists to collect. B achieves your intent (nobody overruns silently) without pushing work off the books. Full reasoning in [doc 17](17-TASK-TIMERS-AND-TIME-LIMITS.md) §4.

### Q-042 · Are time limits mandatory on every task?
**Default: mandatory whenever an Admin or Coordinator assigns work to someone else; optional on self-created tasks.**

### Q-043 · Automatic timer or manual start/stop?
**Default: automatic, driven by task status.** Manual timers get forgotten and produce data worse than none.

### Q-044 · Idle prompt timing
Prompt after 2 hours of no activity, auto-pause 30 min later. Long renders and edit sessions might warrant 3 hours.
**Default: 2 hours.**

### Q-045 · Should Coordinators see pending extension requests?
They can't approve them (your rule), but should Kashif see what's slipping?
**Default: yes, read-only.**

### Q-046 · What happens when an extension is declined?
**Default: the task stays open and flagged. The Admin is expected to reassign, cut scope, or accept the overrun. The system doesn't force an outcome.**

### Q-047 · Out-of-hours work — blocked or recorded?
If someone works Sunday, does the timer refuse to run?
**Default: recorded but not counted toward the limit, with an option for an Admin to approve it in.**

### Q-048 · How long does a locked account stay locked if nobody requests an unlock code?
**Default: auto-clears after 30 minutes**, so a deliberate lock-out attack can't hold someone hostage.

---

## 🟠 From the Projects and Security work (Session 02)

### Q-024 · Permanent "Misc / Ad-hoc" project?
Should one Other-type project always exist so there's always a valid choice at task creation, or must an Admin create one each time?
**Default: one permanent "Misc / Ad-hoc" project, plus the ability to create more.**

### Q-025 · "Other" work warning threshold
Warn when uncategorised work exceeds what share of capacity?
**Default: 15%** (≈ 1.5 days a week).

### Q-026 · Task reference format
`EVT-142` / `CLI-088` / `OTH-205` (self-describing), or plain `CNI-142`?
**Default: type-prefixed** — saying "OTH-205 is blocking me" instantly tells everyone it's uncategorised work.

### Q-027 · What gets dropped first when someone is overloaded?
**Default: `Client › Event › Business › Self-Promotion › Other`** — client work is protected, ad-hoc favours are shed first.

### Q-028 · Can a Team Coordinator create projects?
**Default: no.** Kashif assigns within existing projects; only Admin and Super Admin create them.

### Q-029 · Can an Event project link to a Client project?
An event *for* a client.
**Default: yes** — Event has an optional client link.

### Q-031 · Credential provisioning method
| Option | |
|---|---|
| **A** ⭐ | Activation link only. Nothing sensitive ever in email. |
| **B** | Also allow a temporary password shown **once on screen** to the creating Admin (never emailed), to relay by WhatsApp or phone. Expires 24h, forced change at first login. |

**Default: A as standard, B available as a tick-box** — so you get your exact flow when you want it.

### Q-032 · MFA for regular Members
Mandatory for Super Admin and Admin regardless. For Members?
**Default: optional, but prompted at every login until enrolled.**

### Q-033 · Country lock (Pakistan-only sign-in) for privileged accounts?
Blocks the overwhelming majority of automated attacks. Will block sign-in while travelling unless break-glass is used.
**Default: off initially, easy to switch on later.**

### Q-035 · Hardware security key for your brother?
A YubiKey (~$25–50) or a phone-based passkey. Both are phishing-resistant; the hardware key is slightly stronger.
**Default: phone passkey — free, and nearly as strong.**

### Q-036 · Shared password manager for the team?
Bitwarden is free. This eliminates password reuse, which is the most likely way any of these accounts actually gets breached.
**Default: yes, strongly recommended.**

### Q-037 · Cross-member dependencies under member isolation
If Yusra's task is blocked by Kashif's task, and she can't see his work — what does she see?
| Option | |
|---|---|
| **A** ⭐ | A minimal reference: *"Waiting on EVT-141 — assigned to a teammate."* No title, no name, no detail. |
| **B** | Full detail of the blocking task only |
| **C** | Nothing — she just sees "Blocked" |

**Default: A.** She needs to know she's blocked without seeing anyone else's work.

### Q-038 · Confirm default weekly capacity
**36 points** (75% of your 48 nominal hours) or something else? Reasoning in [ADR-004](decisions/ADR-004-working-calendar-and-capacity.md) — setting this too high makes every threshold silent.
**Default: 36.**

---

## 🟡 USEFUL — decide later

| ID | Question | Default |
|---|---|---|
| **Q-005** | What can Admin change vs. Super Admin only? | Admin: skills library, notification defaults, "Other" threshold. Super Admin only: capacity thresholds, scoring weights, workflow, security settings. |
| **Q-007** | Weekly or daily capacity window? | Weekly, with daily breakdown on hover |
| **Q-009** | Do you want the optional LLM layer? | Build v1 without it; add in Phase 7 if wanted. Core intelligence needs no AI. |
| **Q-011** | Notification channels beyond in-app + email? | In-app + email in v1. Tell me if the team lives on WhatsApp or Telegram. |
| **Q-013** | Timeline? | No fixed deadline; ship phase by phase |
| **Q-014** | External client read-only access? | No in v1 — parked as P-10 (Phase 7) |
| **Q-016** | English only, or Urdu/bilingual? | English |
| **Q-017** | Should the system ever auto-assign? | No. Human confirms every assignment. |
| **Q-018** | Can members see their own performance metrics? | Yes, their own only. Admins see everyone's. |
| **Q-019** | Custom domain? | vercel.app to start; custom domain is a 10-minute change later |
| **Q-020** | Database region? | Singapore (closest to Pakistan) |
| **Q-021** | Existing task data to import? | Starting fresh |
| **Q-023** | Logo and brand colours? | Neutral professional palette |

---

## Fastest path forward

Nothing blocks Phase 1. If you're happy with the recommendations:

```
Defaults are fine. Start Phase 1.
```

Or pick out any of Q-039 – Q-048 you want to decide differently first. The two I'd most want your view on are **Q-039** (MFA on privileged password resets) and **Q-041** (what happens at the time limit).
