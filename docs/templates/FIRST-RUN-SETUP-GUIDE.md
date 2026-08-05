# First-Run Setup Guide

**Replaces:** `TEAM-ROSTER-TEMPLATE.md` (retired — see [`../decisions/ADR-009`](../decisions/ADR-009-no-seeded-roster.md))

> **You don't need to give me any team information.** The system ships empty except for the Super Admin account. Your sister builds the team through the application, exactly as you asked. This document is what she'll follow on day one.

---

## The setup sequence

```
1. Super Admin account created          (one-time, at deployment)
        ↓
2. Super Admin signs in, enrols MFA, saves recovery codes
        ↓
3. Super Admin creates the Admin account       → sister
        ↓
4. Admin activates via email link, enrols MFA
        ↓
5. Admin reviews the skills library, edits to match the team
        ↓
6. Admin creates the first project
        ↓
7. Admin creates team members                  → Kashif, Yusra, others
        ↓
8. Members activate via email link, set their own passwords
        ↓
9. First tasks created and assigned
```

The application walks through steps 2–9 as a guided wizard. Nobody faces a blank screen.

---

## Step 1 — Super Admin creation (one time)

The only account that exists at deployment. Created through a one-time setup route that **disables itself permanently** once used.

Required: full name · email · password (min 16 chars, breach-checked) · MFA enrolment · recovery codes downloaded.

The setup route cannot run again. There is no way to create a second Super Admin through the interface.

---

## Step 2 — What the Super Admin does first

| | |
|---|---|
| ✅ | Enrol MFA — passkey preferred, authenticator app accepted |
| ✅ | **Download the 10 recovery codes and print them.** Do not store them on the same device. |
| ✅ | **Print and seal the master recovery credential.** Home safe or bank locker. |
| ✅ | Confirm the login alert email arrived — that's the early-warning system working |
| ✅ | Review Settings → thresholds, working hours, capacity defaults |
| ✅ | Create the Admin account |

---

## Step 3 — Creating an account (Super Admin → Admin, or Admin → anyone)

The form:

| Field | Notes |
|---|---|
| Full name | |
| Email | Their login identity; the activation link goes here |
| Access level | Admin / Team Coordinator / Team Member |
| Job title | "Video Editor", "Ads Manager" — free text |
| Weekly capacity | Defaults to **36 points**. Lower it for part-timers. |
| Max concurrent tasks | Defaults to **5** |
| Skills + proficiency | Pick from the library, rate 1–5, mark one as primary |
| Send invitation | On by default |

**What happens:** the account is created with **no password at all**. A single-use, 48-hour activation link is emailed. The person clicks it, sets their own password, enrols MFA if their role requires it, and lands in the app. **No password is ever sent by email.**

Optionally, tick *"also generate a temporary password"* — it's shown once on screen for you to relay by WhatsApp or phone, never emailed, expires in 24 hours, must be changed at first login.

---

## Step 4 — The skills library

Ships with a starter set the Admin edits to match the real team. A blank library would make assignment recommendations useless on day one; a fixed one would make them wrong.

**Creative / Video** — `video-editing` · `motion-graphics` · `videography` · `colour-grading` · `audio-editing` · `subtitling` · `thumbnail-design`

**Design** — `graphic-design` · `ui-design` · `ux-design` · `branding` · `illustration` · `figma` · `photo-editing`

**Marketing / Ads** — `ads-management` · `ad-copywriting` · `meta-ads` · `google-ads` · `tiktok-ads` · `seo` · `analytics-reporting` · `campaign-strategy`

**Content / Social** — `copywriting` · `content-strategy` · `social-media` · `community-management` · `scriptwriting`

**Technical** — `frontend-dev` · `backend-dev` · `wordpress` · `automation`

**Client / Ops** — `client-communication` · `project-coordination` · `quality-review`

Every entry can be renamed, deleted, or added to. Each skill also carries **keywords** used for fallback matching when a task has no explicit skill tags — typing *"edit the reel in Premiere"* matches `video-editing` through `{reel, edit, premiere}`.

### Proficiency scale
| | |
|---|---|
| **5** | Expert — the person you'd give the hardest version of this to |
| **4** | Strong — handles it independently, good quality |
| **3** | Capable — can do it well enough, may need review |
| **2** | Basic — can help, needs supervision |
| **1** | Learning — assign only for development |

These numbers drive 40% of the assignment score, so they're worth a few minutes of thought. They can be adjusted any time.

---

## Step 5 — The first project

Every task belongs to a project ([ADR-006](../decisions/ADR-006-projects-and-other-category.md)), so at least one must exist before any task can be created.

The system pre-creates one permanent project — **"Misc / Ad-hoc"** (type: Other) — so there is always a valid choice. Anything filed there requires a written description of what the work actually is.

Then create real projects. Type is chosen first, and the rest of the form adapts to it.

---

## Setup checklist

```
□ Super Admin account created; setup route now disabled
□ Super Admin MFA enrolled
□ Recovery codes printed and stored off-device
□ Master recovery credential printed and sealed
□ Login alert email confirmed working
□ Admin account created and activated
□ Admin MFA enrolled
□ Thresholds and working hours reviewed
□ Skills library edited to match the real team
□ First real project created
□ All team members created and invited
□ Every member has activated and signed in
□ Every member has skills and capacity set
□ A member has confirmed they cannot see anyone else's data
□ First tasks created, assigned, and time limits set
□ Password manager rolled out to the team (Q-036)
```

---

## Team-wide settings to confirm

Pre-set from your answers; confirm they're right.

```
Company name          : Crescent Nova International (CNI)
Timezone              : Asia/Karachi
Working days          : Monday – Saturday
Working hours         : 09:00 – 17:00
Default capacity      : 36 points/week
Soft threshold        : 85%
Hard threshold        : 100%
Max concurrent tasks  : 5
"Other" work warning  : 15% of capacity
Failed logins to lock : 3
Brand colours         : [ not yet provided — Q-023 ]
Logo                  : [ not yet provided — Q-023 ]
```
