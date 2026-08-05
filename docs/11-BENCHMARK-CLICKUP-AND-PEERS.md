# 11 — Benchmark: ClickUp & Peers

> **Note on sourcing:** you invited me to browse ClickUp. This document is written from established knowledge of these products, **not** from a live hands-on session. If you want me to actually open ClickUp in a browser and walk its workload and automation screens to check for anything that's changed, say so — it's tracked as **T-002** in [`PROGRESS-TRACKER.md`](PROGRESS-TRACKER.md).

---

## 1. How ClickUp organises work

```
Workspace  →  Space  →  Folder  →  List  →  Task  →  Subtask  →  Checklist
```

Powerful, and the main reason ClickUp is famously overwhelming. Five nesting levels is right for a 200-person agency and wrong for seven people.

**Our decision:**
```
Project (optional)  →  Task  →  Subtask  →  Checklist
```
Three levels, and the top one is optional. If you never create a project, everything just lives in one team task list and the system works perfectly. **This is the single most important thing to *not* copy.**

---

## 2. Feature-by-feature verdict

| ClickUp feature | What it does | Our decision |
|---|---|---|
| **Custom statuses per list** | Each list defines its own workflow | ✅ **Adopt, simplified** — one team-wide workflow (doc 05), editable by Super Admin. Per-list workflows are chaos at this size. |
| **Workload view** | Bar chart of capacity per person, by time estimate or task count | ✅ **Adopt and go further.** Theirs shows the problem. Ours also shows *what to do about it* — the Rebalance Advisor (doc 06 §5) has no ClickUp equivalent. |
| **Capacity setting** | Per-person hours/week or points/week | ✅ **Adopt**, with availability/leave folded in, which ClickUp handles poorly. |
| **Time estimates** | Per task, rolls up to workload | ✅ **Adopt** as T-shirt sizes → points. Faster to enter than hour estimates, which is why estimates actually get filled in. |
| **Priority flags** | Urgent / High / Normal / Low | ✅ **Adopt**, and go further — ours **multiplies capacity cost** (doc 05 §4), not just sorts. |
| **Assignees (multiple)** | A task can have several | ❌ **Reject.** One assignee (BR-001). Shared ownership means nobody owns it, and it wrecks capacity maths. Watchers cover the "keep me informed" case. |
| **Dependencies** | Blocking / waiting-on | ✅ **Adopt**, simplified to `blocks` and `relates_to`. |
| **Automations** | "When status → Done, assign to X" | ✅ **Adopt a narrow version** — handoff chains (E-004). ClickUp's builder has ~100 triggers; we ship 5 that match your actual flow. |
| **AI (ClickUp Brain)** | Summaries, task generation, standups | ⚪ **v2, optional** — our Layer 2 (doc 07 §6). Note that ClickUp's AI does *not* do skill-aware assignment scoring. That's our differentiator. |
| **Views (List/Board/Calendar/Gantt/Table/Mind Map/Timeline/Activity…)** | 15+ view types | ⚠️ **Adopt 4:** List, Board, Calendar, Workload. Gantt only if you ask (E-014). The rest are feature-count marketing. |
| **Custom fields** | Arbitrary fields per list | ⚪ **v2.** Nice, but a fixed well-chosen schema beats infinite configurability at this size. |
| **Docs / Wiki / Whiteboards / Chat / Email / Goals / Forms** | Full productivity suite | ❌ **Reject all.** This is scope creep that turned ClickUp into a product people complain about. You use Notion/Drive/WhatsApp already. |
| **Goals & targets** | OKR tracking | ⚪ Parked (E-015) |
| **Recurring tasks** | Repeat schedules | ✅ **Adopt** (FR-029) — essential for weekly ad reports. |
| **Templates** | Save and reuse task shapes | ✅ **Adopt** (FR-030). |
| **Time tracking** | Start/stop timer, manual entry | ✅ **Adopt** manual entry (FR-094). A timer is v2 — timers get forgotten and produce garbage data. |
| **Guest access** | External read-only users | ⚪ v2 (Q-014) |
| **Mobile app** | Native iOS/Android | ⚪ Responsive web v1, PWA v2 |

---

## 3. What the others do better than ClickUp

### Asana
- **"My Tasks" with Today / Upcoming / Later** — the cleanest personal view in the category. **We copy this** as *My Work* (doc 10 §2).
- **Workload view with effort points** — same idea as ClickUp's, better executed.
- **Rules** — simpler automation than ClickUp's builder. Our handoff chains follow Asana's model.

### Monday.com
- **Colour-first status boards** — status is legible from across the room. **We copy the colour discipline**, with text labels alongside for accessibility (NFR-008).
- **Excellent mobile app.** A high bar for our responsive design.

### Linear
- **Speed and keyboard-first design.** `⌘K` command palette, single-key shortcuts. **We copy this** (doc 10 §11.7).
- **Task references like `ENG-142`** — usable in conversation. **We copy this** (FR-032).
- **Ruthless minimalism.** Linear ships fewer features on purpose and is beloved for it. This is the philosophy we're following, not ClickUp's.

### Trello
- **The onboarding is a drag-and-drop board and nothing else.** Anyone gets it in 30 seconds. **We copy the simplicity of first contact** — a new member's first screen should need no explanation.

### Jira
- **Sprints, burndown, deep workflow configuration.** **We reject all of it.** Wrong industry, wrong team size.

---

## 4. What none of them do — and we will

This is the honest answer to *"why not just buy ClickUp?"*

| Our feature | Do they have it? |
|---|---|
| **Skill-aware assignment recommendation** — scores every member on proficiency in the exact skills the task needs | ❌ **None of them.** ClickUp/Asana show you who's free; none know who's *qualified*. |
| **Hard capacity block with logged override reason** | ❌ None. They all warn at most. You can always dump work on an overloaded person. |
| **Ranked candidates with plain-English reasoning** | ❌ None. You get a dropdown of names. |
| **Rebalance Advisor with one-click fixes** | ❌ None. They show the imbalance; you solve it yourself. |
| **"Nobody fits — here are 5 alternatives"** | ❌ None. |
| **Priority as a capacity multiplier** | ❌ None. Priority is just a sort key everywhere else. |
| **Skill-gap reporting from task data** | ❌ None. |

**That's the case for building this.** Everything else in the system is table stakes that we're implementing because you need a working task manager to hang the intelligence on. The five rows above are the actual product.

---

## 5. Anti-patterns to deliberately avoid

Learned from where these tools fail small teams:

| Anti-pattern | How we avoid it |
|---|---|
| **Too many nesting levels** | Max 3, top level optional |
| **Too many views** | 4 views, each with a clear job |
| **Configuration overwhelm** | Sensible defaults that work day one; settings exist but nobody must touch them |
| **Notification fatigue** | Batched, quiet hours, granular mutes, email reserved for genuinely actionable events (doc 08 §4) |
| **Estimates nobody fills in** | T-shirt sizes not hours; mandatory only when an Admin assigns to someone else (BR-010) |
| **Dashboards nobody acts on** | Every dashboard insight carries a button (doc 08 §5) |
| **The tool becomes the work** | If a status update takes more than one click, we've failed |
| **Feature creep into docs/chat/wiki** | Explicitly out of scope (doc 01 §6) |
| **Metrics used as surveillance** | Performance is 5% of the score, capped, and never the reason someone is refused work (Q-018 covers visibility) |

---

## 6. Summary — the positioning

> **ClickUp is a Swiss Army knife. We're building a scalpel.**
>
> One team. One workflow. Four views. But it *knows your people* — who can do what, how well, and how much they're carrying right now — and it uses that at the exact moment you're deciding who does the next thing.
>
> That's the whole bet.
