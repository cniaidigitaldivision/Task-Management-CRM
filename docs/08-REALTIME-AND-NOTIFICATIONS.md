# 08 — Real-time Updates & Notifications

> Your requirement: *"Whenever needed it should be updated in real time as well."*

---

## 1. What "real time" means here, concretely

| Scenario | Expected behaviour |
|---|---|
| Yusra drags a task to *In Progress* | The Admin dashboard, open on another screen, shows the move within ~2 seconds. No refresh. |
| Admin assigns a task to Kashif | A toast appears on Kashif's screen; his "My Work" count increments; the notification bell badges. |
| Two people open the same task | Both see each other's comments appear live. Both see a "Kashif is viewing" presence indicator. |
| Someone crosses the overload threshold | The workload bar changes colour live on every open dashboard. |
| A task goes *Blocked* | The Admin's "Needs attention" widget updates immediately. |
| A member is added to the team | They appear in assignee dropdowns for everyone, immediately, without a reload. |

**Target latency: under 2 seconds end-to-end (NFR-003).**

---

## 2. How it's implemented

**Recommended: database-level change streaming.**

```
   Kashif's browser                    Admin's browser
        │                                    ▲
        │ 1. status change                   │ 4. live event pushed
        ▼                                    │
   ┌──────────────────┐              ┌───────────────┐
   │  Server action   │              │  Realtime      │
   │  (validates      │──2. write───▶│  channel       │
   │   permissions)   │              │  (per-team,    │
   └──────────────────┘              │   per-task)    │
        │                            └───────▲───────┘
        │                                    │
        ▼                                    │
   ┌────────────────────────────────────────┴────┐
   │           PostgreSQL                         │
   │  3. change captured & broadcast              │
   └──────────────────────────────────────────────┘
```

Concretely, with the recommended stack (doc 09), this is **Supabase Realtime** subscribing to Postgres changes on `tasks`, `comments`, `notifications`, and `users`. It's built in, requires no separate WebSocket server, and respects row-level security so a member never receives an event for a task they can't see.

**Alternative if we don't use Supabase:** Vercel Functions now support WebSockets natively (no Pusher/Ably needed), or plain Server-Sent Events for a one-way push. Both are viable; Supabase Realtime is simply less work.

### Optimistic UI (NFR-002)
When a user acts, the UI updates **instantly** and reconciles with the server response. Dragging a card feels immediate even on a slow connection. If the server rejects it (permission, capacity block), the card animates back with an explanation.

### Channel design
| Channel | Subscribers | Carries |
|---|---|---|
| `team:global` | everyone | member added/removed, settings changes |
| `team:tasks` | Lead/Admin/Super Admin | all task events |
| `user:{id}:tasks` | that member | events on their own tasks |
| `task:{id}` | anyone viewing that task | comments, edits, presence |
| `user:{id}:notifications` | that member | their notification feed |

Scoping matters: a 7-person team won't strain anything, but scoped channels mean we never leak a task to someone who shouldn't see it.

---

## 3. Notification catalogue

Every event, who gets it, and on which channels.

| Event | Notifies | In-app | Email | Push (opt) |
|---|---|:--:|:--:|:--:|
| Task assigned to you | Assignee | ✅ | ✅ | ✅ |
| Task reassigned away from you | Previous assignee | ✅ | — | — |
| You were @mentioned | Mentioned user | ✅ | ✅ | ✅ |
| Comment on your task | Assignee + watchers | ✅ | ⚙️ | — |
| Your task sent to **Revisions** | Assignee | ✅ | ✅ | ✅ |
| Your task **approved / Done** | Assignee | ✅ | — | — |
| Task moved to **In Review** | Lead + Admins | ✅ | ⚙️ | — |
| Task marked **Blocked** | Lead + Admins | ✅ | ✅ | — |
| Task **due tomorrow** | Assignee | ✅ | ⚙️ | — |
| Task **due today** | Assignee | ✅ | ✅ | ✅ |
| Task **overdue** | Assignee + Admins | ✅ | ✅ | ✅ |
| Overdue **3+ days** | Super Admin | ✅ | ✅ | — |
| Blocked **2+ days** | Admins | ✅ | ✅ | — |
| In Review **2+ days** | The reviewer | ✅ | ✅ | — |
| Member crosses **soft threshold** | Admins | ✅ | — | — |
| Member crosses **hard threshold** | Admins + Super Admin | ✅ | ✅ | — |
| Rebalance suggestion available | Admins | ✅ | — | — |
| New member added | Everyone | ✅ | — | — |
| Dependency you're blocking is now unblocked | Assignee of dependent task | ✅ | — | — |
| Daily digest | Everyone | ✅ | ✅ | — |
| Weekly team summary | Admins + Super Admin | ✅ | ✅ | — |

⚙️ = user-configurable, off by default

---

## 4. Notification design principles

1. **Silence by default for noise.** Only genuinely actionable events get email. If people start ignoring notifications, the system has failed.
2. **Batching.** Five comments on one task in ten minutes = one notification, not five.
3. **Quiet hours.** Configurable per user (default 21:00–08:00). Non-urgent notifications queue until morning.
4. **Every notification is a link.** Clicking always lands on the exact task, not a generic dashboard.
5. **Read state syncs across devices** in real time.
6. **Nothing is unmutable.** Every category can be turned off per-user, except direct assignment to you.

---

## 5. The daily digest (FR-076)

Sent at a configurable time (default 09:00, team timezone).

**For a Member:**
```
Good morning, Kashif 👋

TODAY
  ⚡ CNI-142  Edit Ramadan reel                    High · due today
  ○  CNI-149  Thumbnail set for YouTube            Medium · due Thu

OVERDUE (1)
  🔴 CNI-138  Client testimonial cut               2 days late

AWAITING YOUR REVIEW (2)
  CNI-144 from Member C · CNI-146 from Yusra

YOUR WEEK
  Load: 18 / 40 pts (45%) 🟢  ·  Completed last week: 6  ·  On time: 5/6
```

**For an Admin:**
```
Team summary — Monday 5 Aug

  In progress 11   ·   In review 3   ·   Blocked 2   ·   Overdue 4

⚠️ NEEDS YOUR ATTENTION
  • Yusra is at 96% capacity (10 open tasks) — rebalance suggested
  • CNI-131 blocked since Thursday: "waiting on client assets"
  • 3 tasks awaiting your approval for 2+ days

📊 WORKLOAD
  Kashif    ████████░░░░░░░░░░  45%  🟢
  Yusra     ███████████████████ 96%  🟠
  Member C  █████░░░░░░░░░░░░░  30%  🟢
  Member D  ████████████████░░  83%  🔵
  Member E  ████████████████████ 103% 🔴
  Member F  ███████████░░░░░░░  60%  🔵

  💡 Move CNI-118 from Yusra → Member C to even this out.  [ Do it ]
```

That last line turns a report into a decision. It's the difference between a dashboard you glance at and one you act on.

---

## 6. Channels — what to actually wire up

| Channel | Recommendation | Notes |
|---|---|---|
| **In-app** | ✅ v1, required | Notification centre + toasts. No external dependency. |
| **Email** | ✅ v1 | Via a transactional provider (Resend/Postmark, provisioned through Vercel Marketplace). Needed anyway for invites and password resets. |
| **Browser push** | ⚪ v2 | Web Push API. Works on desktop and Android; iOS requires the app be added to the home screen. |
| **WhatsApp** | ⚙️ **Q-011** | Realistically the highest-signal channel for a small team that already lives there. Requires WhatsApp Business API — approval process and per-message cost. |
| **Telegram** | ⚙️ **Q-011** | Far easier than WhatsApp: a bot token, free, five minutes of setup. Strong recommendation *if* the team uses Telegram. |
| **Slack / Discord** | ⚪ v2 | Trivial via webhook if you use either. |
| **SMS** | ❌ | Expensive, low value here. |

> My recommendation: **in-app + email in v1**, then add **Telegram in v2** if the team is on it. WhatsApp is worth it only if the team genuinely won't check the app — it's the most friction to set up.

---

## 7. Offline & reconnection behaviour

| Situation | Behaviour |
|---|---|
| Connection drops | A subtle "reconnecting…" indicator. The UI stays usable read-only. |
| Reconnects | Missed events are replayed from the last-seen timestamp; the board reconciles automatically. |
| Action attempted while offline | Queued and retried on reconnect, or rejected with a clear message — never silently lost. |
| Two people edit the same field simultaneously | Last write wins, with a "Member C also edited this just now" notice. Full conflict resolution is out of scope for a 7-person team. |
