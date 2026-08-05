# 10 — UI Screens & Views

Every screen, who sees it, and what's on it. Layouts are indicative, not final design.

> **⚠️ Session 04 — all colours in this document are superseded.** Every colour, spacing value and token comes from [`18-DESIGN-SYSTEM-AND-BRANDING.md`](18-DESIGN-SYSTEM-AND-BRANDING.md). Where a mockup below shows amber for *In Progress*, read **violet**; purple for *In Review*, read **pink**; amber for *near limit*, read **orange**. (Contradiction [C-01](19-MASTER-SPECIFICATION-REGISTRY.md).)
>
> **⚠️ Every screen must render correctly in both light and dark themes** (FR-201–FR-209). The mockups here are structural, not chromatic.
>
> **New screens added since this document was written:** Profile → Appearance (theme toggle, all roles) · one-time setup · activation · forgot-password · locked-account · MFA enrolment · security dashboard. Their specifications live in [doc 16 §3, §6](16-SECURITY-AND-IDENTITY.md) and [doc 18 §6](18-DESIGN-SYSTEM-AND-BRANDING.md). The authoritative route list is [doc 20 §3](20-IMPLEMENTATION-CONTRACTS.md).
>
> **Session 02 amendments — read alongside this document:**
> - **Projects list, project detail, new-project form, and the Member Activity Preview** are specified in [`15-PROJECTS-AND-PROJECT-TYPES.md`](15-PROJECTS-AND-PROJECT-TYPES.md) §5–7.
> - **Login, activation, MFA enrolment, and the security dashboard** are specified in [`16-SECURITY-AND-IDENTITY.md`](16-SECURITY-AND-IDENTITY.md) §3–4.
> - **Navigation below is superseded by [`03-ROLES-AND-PERMISSIONS.md`](03-ROLES-AND-PERMISSIONS.md) §4.** Under [ADR-003](decisions/ADR-003-member-data-isolation.md), a Team **Member**'s sidebar contains only **My Work · My Tasks · My Projects · My Profile**. They have no access to the Tasks-all, Workload, Dashboard, Team, or Reports screens.
> - "Team Lead" throughout this document now means **Team Coordinator** ([ADR-002](decisions/ADR-002-four-role-model.md)).
> - Every task card and task detail now carries its **project chip and project context card** (doc 15 §5).

---

## 1. Navigation structure

```
┌─ Sidebar ─────────────┐
│  🏠 My Work           │  ← default landing for Member
│  📋 Tasks             │     list / board / calendar toggle
│  📊 Workload          │     Lead, Admin, Super Admin
│  📈 Dashboard         │     Lead (read-only), Admin, Super Admin
│  👥 Team              │     Admin, Super Admin
│  📁 Projects          │     everyone (if enabled — Q-006)
│  📑 Reports           │     Lead (read-only), Admin, Super Admin
│  ⚙️  Settings          │     Super Admin (Admin: partial)
│  🗑️  Trash             │     Admin, Super Admin
└───────────────────────┘

Top bar: [ 🔍 Search ]  [ + New Task ]  [ 🔔 3 ]  [ 👤 Avatar ▾ ]
```

Members see only: My Work · Tasks · Projects. Clean and uncluttered — they don't need the machinery.

---

## 2. My Work (Member landing page)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Good morning, Kashif                        Your load: 45% 🟢 18/40 │
├──────────────────────────────────────────────────────────────────────┤
│  ⚠️ OVERDUE (1)                                                       │
│  🔴 CNI-138  Client testimonial cut     High   2 days late  [In Prog]│
├──────────────────────────────────────────────────────────────────────┤
│  📅 DUE TODAY (2)                                                     │
│  ⚡ CNI-142  Edit Ramadan reel          High   M    [ In Progress ▾ ] │
│  ○  CNI-151  Export final deliverables  Med    S    [ To Do ▾ ]       │
├──────────────────────────────────────────────────────────────────────┤
│  📆 THIS WEEK (3)                                            [expand]│
├──────────────────────────────────────────────────────────────────────┤
│  🔄 AWAITING REVIEW (1)   — submitted, waiting on approval           │
│  ↩️  NEEDS REVISION (1)    — sent back to you                         │
│  ✅ COMPLETED THIS WEEK (4)                        On time: 4/4 🎉    │
└──────────────────────────────────────────────────────────────────────┘
```

The status dropdown is inline — a member updates their status in one click without opening the task. That single detail determines whether the system actually gets used.

---

## 3. Task Board (Kanban)

```
[ List | ▣ Board | Calendar ]   Group by: Status ▾   Filter: Assignee ▾ Priority ▾ Project ▾

┌─Backlog(4)─┐ ┌─To Do(6)──┐ ┌─In Progress(5)┐ ┌─Blocked(2)┐ ┌─Review(3)┐ ┌─Done(12)─┐
│┌──────────┐│ │┌─────────┐│ │┌────────────┐ │ │┌─────────┐│ │┌────────┐│ │┌────────┐│
││CNI-160   ││ ││CNI-151  ││ ││CNI-142  ⚡ │ │ ││CNI-131 🔴││ ││CNI-144 ││ ││CNI-140 ││
││New intro ││ ││Export…  ││ ││Ramadan reel│ │ ││Blocked: ││ ││Landing ││ ││Logo    ││
││ 🎬 Kashif││ ││ 🎬 Kashif││ ││ 🎬 Kashif  │ │ ││client   ││ ││ 🎨 C   ││ ││ 🎨 C   ││
││ M · Low  ││ ││ S · Med ││ ││ M · High   │ │ ││assets   ││ ││awaiting││ ││ ✅ Thu ││
││          ││ ││ Due Thu ││ ││ Due TODAY  │ │ ││ 📢 Yusra││ ││approval││ ││        ││
│└──────────┘│ │└─────────┘│ │└────────────┘ │ │└─────────┘│ │└────────┘│ │└────────┘│
└────────────┘ └───────────┘ └───────────────┘ └───────────┘ └──────────┘ └──────────┘
```

- Drag between columns to change status. Blocked transitions prompt for a reason.
- A card a member isn't allowed to move (e.g. → Done) simply won't drop there, with a tooltip explaining why.
- Cards colour-code by priority; overdue cards get a red left border.
- Column headers show count and total capacity points.

---

## 4. Workload View — the fairness screen

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TEAM WORKLOAD          Week of 4–10 Aug 2026    [ ‹ ] [ Today ] [ › ]   │
│  Team average: 69%   ·   Total open: 31 tasks / 166 pts                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🎬 Kashif      Video Editor / Lead                                      │
│     ████████░░░░░░░░░░░░  18 / 40 pts   45%  🟢 Available   · 4 tasks   │
│                                                                          │
│  📢 Yusra       Ads Manager                                              │
│     ███████████████████░  38.5 / 40 pts 96%  🟠 Near limit  · 10 tasks  │
│     ⚠️ 4 pts from the limit. 3 tasks due Thursday.        [ Rebalance ] │
│                                                                          │
│  🎨 Member C    Graphic Designer                                         │
│     ██████░░░░░░░░░░░░░░  12 / 40 pts   30%  🟢 Available   · 3 tasks   │
│     💡 Lowest load on the team — good candidate for new work.           │
│                                                                          │
│  ✍️ Member D    Content Writer                                           │
│     ████████████████░░░░  33 / 40 pts   83%  🔵 Healthy     · 6 tasks   │
│                                                                          │
│  💻 Member E    Web Developer                                            │
│     ████████████████████▓ 41 / 40 pts  103%  🔴 OVER LIMIT  · 2 tasks   │
│     🚨 Over capacity for 3 days running.                  [ Rebalance ] │
│                                                                          │
│  📱 Member F    Social Media Manager                                     │
│     ████████████░░░░░░░░  24 / 40 pts   60%  🔵 Healthy     · 5 tasks   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  💡 REBALANCE SUGGESTIONS                                                │
│  1. Move CNI-118 (S·Low) Yusra → Member C     Yusra 96→92%   [ Apply ]  │
│  2. Split CNI-133 (XL) from Member E across 3 people          [ Apply ]  │
│  3. Push CNI-125 (Low, due Fri) to next week  Yusra 92→88%   [ Apply ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

This is the screen that answers *"who should I give this to?"* at a glance, before you even open a task.

Expanding a member row shows their individual tasks with per-task point cost, so you can see exactly what's making them heavy.

---

## 5. Task Detail

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CNI-142                                             [ ⋯ ] [ Watch ] [×] │
│  Edit Ramadan campaign reel — 30s vertical                               │
│  ┌────────────────────────────────┬─────────────────────────────────────┐│
│  │ DESCRIPTION                    │ Status    [ In Progress ▾ ]         ││
│  │ Cut a 30-second vertical reel  │ Assignee  🎬 Kashif      [change]   ││
│  │ from the Ramadan shoot. Brand  │ Priority  🟠 High                   ││
│  │ colours, subtitles, logo end   │ Effort    M (4 pts) · 5 pts loaded  ││
│  │ card.                          │ Due       Today, 5 Aug              ││
│  │                                │ Project   Ramadan Campaign 2026     ││
│  │ CHECKLIST              3/5     │ Skills    video-editing, subtitles  ││
│  │ ☑ Rough cut                    │ Watchers  👤 Admin, 📢 Yusra        ││
│  │ ☑ Colour grade                 │ Blocks    CNI-143 (Yusra's post)    ││
│  │ ☑ Subtitles                    │─────────────────────────────────────││
│  │ ☐ Brand end card               │ TIME                                ││
│  │ ☐ Export 3 aspect ratios       │ Estimated 4h · Logged 2h 30m        ││
│  │                                │ [ + Log time ]                      ││
│  │ ATTACHMENTS (3)                │─────────────────────────────────────││
│  │ 🎞 raw_footage.mp4  · 🖼 brand  │ ACTIVITY                            ││
│  │ 📄 brief.pdf                    │ 09:00 Admin created & assigned      ││
│  │ [ + Upload ]                   │ 11:20 Kashif → In Progress          ││
│  ├────────────────────────────────┤ 14:00 Kashif → Blocked              ││
│  │ 💬 COMMENTS (4)                 │       "waiting on raw footage"      ││
│  │ 👤 Admin: @Kashif please keep  │ Wed 10:00 Kashif → In Progress      ││
│  │    the intro under 3 seconds   │ Wed 18:30 Kashif → In Review        ││
│  │ 🎬 Kashif: done, resubmitted   │ Thu 09:15 Admin → Revisions         ││
│  │ [ Write a comment…       @ 📎 ]│                                     ││
│  └────────────────────────────────┴─────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 6. New Task + Smart Assignment

Two-step. Step 1 captures the work; step 2 is where the intelligence appears.

```
STEP 1 — What needs doing
┌──────────────────────────────────────────────────────────────────────┐
│  Title      [ Design new landing page UI for Eid campaign         ]  │
│  Description[ …                                                   ]  │
│  Project    [ Eid Campaign 2026 ▾ ]     Priority [ 🟠 High ▾ ]      │
│  Effort     [ XS ][ S ][ M ][ ●L ][ XL ]   Due [ 9 Aug 2026 📅 ]    │
│  Skills     [ ui-design ×] [ figma ×]  🤖 suggested from title       │
│                                              [ Next: Assign → ]      │
└──────────────────────────────────────────────────────────────────────┘

STEP 2 — Who should do it   ← the recommendation panel from doc 07 §4
```

Members creating a task for themselves skip step 2 entirely.

---

## 7. Admin Dashboard

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ TO DO  │ │IN PROG │ │ REVIEW │ │BLOCKED │ │OVERDUE │ │ DONE   │      │
│  │   6    │ │   5    │ │   3    │ │   2 🔴 │ │   4 🔴 │ │ 12 wk  │      │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘      │
├──────────────────────────────────────────────────────────────────────────┤
│  🚨 NEEDS ATTENTION                    │  📊 TEAM WORKLOAD              │
│  • Member E over capacity (103%) 3 days│  Kashif    ████░░░░  45% 🟢    │
│  • CNI-131 blocked since Thursday      │  Yusra     ███████▓  96% 🟠    │
│  • 3 tasks awaiting your approval 2+d  │  Member C  ███░░░░░  30% 🟢    │
│  • 4 tasks overdue                     │  Member D  ██████░░  83% 🔵    │
│                                        │  Member E  ████████ 103% 🔴    │
│  💡 Rebalance available    [ Review ]  │  Member F  █████░░░  60% 🔵    │
├────────────────────────────────────────┴───────────────────────────────┤
│  📈 THIS WEEK              │  🕐 RECENT ACTIVITY (live)                 │
│  Completed      12  ▲ +3   │  2m  Yusra → In Progress  CNI-155         │
│  On-time rate   83% ▼ −5   │  8m  Kashif → In Review   CNI-142         │
│  Avg cycle     2.4d ▲      │  15m Admin assigned CNI-160 → Member C    │
│  Revision rate  18% ▼      │  1h  Member D completed   CNI-149         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Team Management

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TEAM (6 active)                                    [ + Add member ]     │
├──────────────────────────────────────────────────────────────────────────┤
│  Name       Role title      Access    Skills               Load  Actions │
│  🎬 Kashif  Video Editor    Team Lead video-editing:5      45%🟢  ✏️ ⋯   │
│                                       motion-graphics:4                  │
│  📢 Yusra   Ads Manager     Member    ads-management:5     96%🟠  ✏️ ⋯   │
│                                       ad-copywriting:4                   │
│  🎨 C       Graphic Designer Member   ui-design:4 figma:5  30%🟢  ✏️ ⋯   │
│  ✍️ D       Content Writer   Member   copywriting:5        83%🔵  ✏️ ⋯   │
│  💻 E       Web Developer    Member   frontend:5 ui:3     103%🔴  ✏️ ⋯   │
│  📱 F       Social Media Mgr Member   social:4 ads:3       60%🔵  ✏️ ⋯   │
├──────────────────────────────────────────────────────────────────────────┤
│  ADD MEMBER                                                              │
│  Name [            ]  Email [            ]  Role title [           ]     │
│  Access level [ Member ▾ ]   Weekly capacity [ 40 ] pts                  │
│  Max concurrent tasks [ 5 ]                                              │
│  Skills  [ + add skill ]  → [ video-editing ▾ ] proficiency [ ●●●●○ ]   │
│  ☐ Send invite email now                        [ Cancel ] [ Add ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

This is FR-011 in practice — a 60-second form, and member #8 is live and assignable everywhere, with no code change.

---

## 9. Settings (Super Admin)

Tabbed: **Capacity & Thresholds** · **Statuses** · **Skills library** · **Assignment weights** · **Notifications** · **Projects** · **Audit log** · **Backup**

```
CAPACITY & THRESHOLDS
  Default weekly capacity      [ 40 ] points
  Soft threshold (warning)     [ 85 ] %   🟠
  Hard threshold (block)       [100 ] %   🔴
  Critical alert               [130 ] %
  Max concurrent active tasks  [  5 ]
  Workload window              [ Week ▾ ]
  Who can override a block     [ Admin + Super Admin ▾ ]

  Status load weights   Backlog [0.25]  In Review [0.50]
  Priority weights      Urgent [1.5] High [1.25] Medium [1.0] Low [0.75]
  Effort points         XS[1] S[2] M[4] L[8] XL[16]
```

Everything you might want to tune is here, in the UI, with no developer involved.

---

## 10. Mobile (NFR-007)

| Screen | Mobile treatment |
|---|---|
| My Work | Full — this is the main mobile use case. Vertical card list, one-tap status change. |
| Board | Horizontal swipe between status columns |
| Task detail | Full, stacked single column |
| Workload | Full — stacked bars read well on mobile |
| Dashboard | Stat cards stack 2-up, then widgets |
| Team management | Read-only list; adding members is desktop-first |
| Settings | Desktop-first |

Bottom tab bar on mobile: **My Work · Tasks · + · Notifications · Profile**

---

## 11. Design principles for the interface

1. **Status change is always one click**, from anywhere a task appears. If it takes three, people revert to WhatsApp.
2. **Load is always visible.** Every screen showing a person shows their utilisation. Fairness stays in view, not buried in a report.
3. **Never colour alone** (NFR-008). Every 🟢🟠🔴 carries a text label too.
4. **Empty states teach.** "No tasks yet — create your first one" with a button, not a blank page.
5. **Destructive actions confirm**, and say exactly what will happen.
6. **Recommendations explain themselves.** Never a bare number without a reason in words.
7. **Keyboard first for power users.** `⌘K` command palette, `N` new task, `/` search.
