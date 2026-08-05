# 07 — Smart Assignment Engine

> Your requirement, restated: *"If I want to assign a task that includes video editing or creating a UI, the system should see all the team members, see their roles, and intelligently show me who is available for assignment."*

This is the feature that separates this CRM from a spreadsheet. Here is precisely how it works.

---

## 1. What it does, in one sentence

When you go to assign a task, the engine scores **every active member** against that specific task and returns a **ranked shortlist with human-readable reasons** — never a silent auto-assignment.

---

## 2. The pipeline

```
   Task being created
   ("Edit Ramadan reel", skills: video-editing, L, High, due Friday)
            │
            ▼
   ┌─────────────────────────────────────────────────────┐
   │ STAGE 1 — ELIGIBILITY FILTER (hard gates)           │
   │  Remove anyone who is:                              │
   │   • inactive / deactivated                          │
   │   • on approved leave covering the due window       │
   │   • a Guest account                                 │
   │  → Candidate pool                                   │
   └────────────────────┬────────────────────────────────┘
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │ STAGE 2 — SCORE each candidate on 5 dimensions      │
   │   S1 Skill match          40%                       │
   │   S2 Availability headroom 30%                      │
   │   S3 Deadline fit          15%                      │
   │   S4 Fairness              10%                      │
   │   S5 Past performance       5%                      │
   └────────────────────┬────────────────────────────────┘
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │ STAGE 3 — APPLY PENALTIES & FLAGS                   │
   │   over soft threshold  → −15, amber flag            │
   │   over hard threshold  → −40, red flag, block       │
   │   at max concurrent    → −10, amber flag            │
   │   zero skill match     → −25, "stretch" flag        │
   └────────────────────┬────────────────────────────────┘
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │ STAGE 4 — RANK, EXPLAIN, and if nobody fits,        │
   │            GENERATE ALTERNATIVES                    │
   └────────────────────┬────────────────────────────────┘
                        ▼
              Admin sees the shortlist and chooses
```

---

## 3. The scoring dimensions in detail

### S1 — Skill match (weight 40%)

The task declares required skills with a weight (`essential` 3 / `important` 2 / `nice-to-have` 1). Each member has skills with proficiency 1–5.

```
skill_score = Σ (skill_weight × proficiency / 5) ÷ Σ (skill_weight) × 100
```

**Example — task needs `video-editing` (essential, w=3) and `motion-graphics` (nice, w=1):**

| Member | video-editing | motion-graphics | Score |
|---|:--:|:--:|:--:|
| Kashif | 5 | 4 | (3×1.0 + 1×0.8) / 4 = **95** |
| Member C | 2 | 3 | (3×0.4 + 1×0.6) / 4 = **45** |
| Yusra | — | — | **0** → "stretch" flag |

**Fallback when no skills are tagged (FR-055):** the engine matches the task title and description against each skill's `keywords` array. Typing *"Edit the Ramadan reel in Premiere"* matches `video-editing` via `{reel, edit, premiere}` and the engine proceeds as if you'd tagged it — then asks *"Tag this task as video-editing? [Yes]"* so the data gets better over time.

### S2 — Availability headroom (weight 30%)

Directly from [`06`](06-WORKLOAD-CAPACITY-ENGINE.md). Rewards people with room.

```
projected_utilisation = (current_load + this_task_load) / effective_capacity

availability_score = 100 − (projected_utilisation × 100)   clamped to 0–100
```

| Projected utilisation | Score |
|---|:--:|
| 35% | 65 |
| 60% | 40 |
| 85% | 15 |
| 100%+ | 0 |

### S3 — Deadline fit (weight 15%)

Can they actually finish it by the due date, given what's already on their plate?

```
free_capacity_before_due = effective_capacity_in_window − committed_load_before_due
deadline_score = min(100, free_capacity_before_due / task_load × 100)
```

Someone at 45% overall but with everything due Thursday is *not* a good fit for a Wednesday deadline. This dimension catches that; S2 alone would not.

### S4 — Fairness (weight 10%)

An explicit anti-favouritism term. Rewards members who have received fewer new assignments recently, so the same reliable person doesn't quietly absorb everything.

```
fairness_score = 100 − (assignments_to_member_last_14d / team_total_last_14d × 100 × team_size)
```
Clamped 0–100. A perfectly even distribution scores 100 for everyone.

### S5 — Past performance (weight 5%)

Deliberately the smallest weight — this should nudge, never dominate, and must never become a surveillance tool.

```
performance_score = (on_time_rate × 70) + ((1 − revision_rate) × 30)
```

Uses the last 90 days. New members with fewer than 5 completed tasks get a neutral 75 rather than being penalised for having no history.

### S6 — Project familiarity (weight 6%) — *added Session 02*

Someone already working on the Expo project scores higher for another Expo task. Context switching between unrelated projects has a real cost, and this is where the projects layer (doc 15) feeds the engine.

```
familiarity_score = min(100, open_tasks_in_project × 25 + (has_worked_on_project ? 30 : 0))
```

### Final score — REBALANCED Session 04

```
score = 0.38×S1 + 0.28×S2 + 0.14×S3 + 0.09×S4 + 0.05×S5 + 0.06×S6 − penalties
        ────────────────────────────────────────────────────────────────
        skill   avail    deadline  fair   perf   familiarity   = 1.00
```

> ⚠️ **Corrected in Session 04** ([C-06](19-MASTER-SPECIFICATION-REGISTRY.md#9--contradiction-sweep--session-04)). When S6 was added in Session 02 the other weights were not reduced, leaving the total at **1.05** — which would have inflated every score by 5% and made the "usability floor" threshold in §5 meaningless. The six weights above sum to exactly **1.00**.
>
> **Phase 4 exit gate includes a test asserting the weights sum to 1.00** ([doc 20 §8](20-IMPLEMENTATION-CONTRACTS.md)), so this class of error cannot recur.

All six weights are Super-Admin configurable (FR-057). If your team values specialist quality over fairness, raise S1 and lower S4 — but the total must always be 1.00, and the settings screen enforces it.

---

## 4. Full worked example

> **Task:** *"Design new landing page UI for the Eid campaign"*
> Skills: `ui-design` (essential, 3), `figma` (important, 2)
> Size: L (8 pts) · Priority: High (×1.25) → **task_load = 10 pts** · Due: in 4 days

| Member | Skills | Load / Cap | S1 | S2 | S3 | S4 | S5 | Penalty | **Score** |
|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Member C** (Graphic Designer) | ui-design:4, figma:5 | 12/40 (30%) | 88 | 45 | 100 | 90 | 82 | — | **🟢 75.7** |
| **Kashif** (Video Editor) | ui-design:2, figma:3 | 18/40 (45%) | 42 | 30 | 80 | 70 | 88 | — | **🔵 47.3** |
| **Member E** (Web Developer) | ui-design:3, figma:2 | 41/40 (103%) | 56 | 0 | 0 | 95 | 70 | −40 | **🔴 5.4** |
| **Yusra** (Ads Manager) | — | 38.5/40 (96%) | 0 | 0 | 0 | 40 | 90 | −40 | **🔴 −31.5** |

### What the Admin actually sees

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 RECOMMENDED FOR: "Design new landing page UI — Eid campaign"     │
│     ui-design · figma  ·  L (8 pts) · High · due in 4 days           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ★ BEST MATCH                                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 🟢  Member C — Graphic Designer                    Score 76    │  │
│  │     ▸ Strong skill match: Figma 5/5, UI Design 4/5             │  │
│  │     ▸ Light workload: 30% (12 of 40 pts) — lowest on the team  │  │
│  │     ▸ Has 28 free points before Friday — fits comfortably      │  │
│  │     ▸ After assigning: 55% 🔵 Healthy                          │  │
│  │                                            [ Assign to C ]     │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ALTERNATIVES                                                        │
│  🔵 Kashif — Video Editor                              Score 47      │
│     Partial skill match (UI 2/5). 45% → 70% after.                   │
│     ⓘ A stretch, but he has capacity and it builds his UI skills.   │
│                                                       [ Assign ]     │
│                                                                      │
│  🔴 Member E — Web Developer                           Score 5       │
│     Good skill fit (UI 3/5) but already at 103% — over the limit.    │
│     Assigning would take him to 128%.        [ Override & assign ]   │
│                                                                      │
│  ✗ NOT SUITABLE                                                      │
│  Yusra — no ui-design or figma skills, and at 96% capacity.          │
│  Member D — on approved leave until Thursday.                        │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [ Ignore recommendations — assign manually ▾ ]                      │
└──────────────────────────────────────────────────────────────────────┘
```

Note what's happening in that panel:
- It **names the person and the reason** in plain language, not just a number.
- It shows the **before → after** utilisation so you see the consequence of your click.
- It surfaces the **stretch assignment** (Kashif) as a legitimate option with a growth rationale, rather than hiding it.
- It **explains the exclusions** so you're never left wondering why someone is missing.
- The **manual override is always one click away.** The system advises; you decide.

---

## 5. When nobody fits (FR-054)

If every candidate scores below a usability floor (default 35), the engine stops recommending people and starts recommending *actions*:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚠️  NO GOOD MATCH FOR THIS TASK                                     │
│                                                                      │
│  Nobody with ui-design skill has capacity before Friday.             │
│                                                                      │
│  WHAT YOU CAN DO                                                     │
│                                                                      │
│  1️⃣  Extend the deadline to Tuesday                                  │
│      → Member C opens up to 62% free.        [ Set due Tue ]        │
│                                                                      │
│  2️⃣  Split into two subtasks                                         │
│      → "Wireframe" (S, Member C) + "Visual design" (M, Kashif)      │
│                                              [ Split it ]            │
│                                                                      │
│  3️⃣  Free up Member C by moving 2 low-priority tasks                 │
│      → CNI-118 and CNI-122 → Member F (60% → 71%)                   │
│                                              [ Rebalance ]           │
│                                                                      │
│  4️⃣  Assign anyway with an override                                  │
│      → Records the reason. Flags the risk on the dashboard.         │
│                                              [ Override ]            │
│                                                                      │
│  5️⃣  This skill is a team gap — 0 members above proficiency 3.       │
│      → Consider hiring or outsourcing.       [ Log as skill gap ]   │
└──────────────────────────────────────────────────────────────────────┘
```

Option 5 is quietly valuable: over time the system builds a **skill gap report** showing where your team is structurally thin — real hiring intelligence out of ordinary task data.

---

## 6. Where the "AI" actually lives

Two distinct layers. Be clear about which is which, because they have very different costs and failure modes.

### Layer 1 — Deterministic scoring engine (v1, required)
Everything described above. Pure arithmetic over your own data. It is **fast, free, private, explainable, and testable**. It never hallucinates and it always shows its working. This is where the real intelligence is, and it needs no LLM at all.

### Layer 2 — LLM assistance (v2, optional, additive)
An actual language model on top, for things arithmetic can't do:

| Capability | Example |
|---|---|
| Natural-language task creation | *"Kashif needs to cut the Eid reel by Thursday, it's urgent"* → fully-formed task with assignee, due date, priority, skills, and estimate pre-filled |
| Auto-tag required skills | Reads the description, proposes skill tags with confidence |
| Auto-estimate effort | *"Similar past tasks took ~6 hours — suggest size M"* |
| Auto-split large tasks | Proposes a sensible subtask breakdown for anything XL |
| Daily standup summary | *"Yesterday: 4 done, 2 blocked. Yusra is at 96% — consider moving CNI-118."* |
| Narrative explanations | Turns the score breakdown into one fluent sentence |
| Weekly retro | *"Revision rate on video tasks rose to 40% this month — worth checking the brief quality."* |

**Recommended for v2**, wired through Vercel AI Gateway so the model is swappable. Estimated cost for a 7-person team: a few dollars a month at most. **This is Q-009.**

> **Important:** Layer 2 never overrides Layer 1. The LLM drafts and explains; the deterministic engine decides. That keeps the system trustworthy — you can always ask "why?" and get real numbers, not a vibe.

---

## 7. Learning over time

| Signal collected | What it improves |
|---|---|
| `time_logs` actual vs. estimate | Per-person estimation accuracy → more honest capacity maths |
| Which recommendation the Admin actually picked | If you consistently pick #2 over #1, the weights are wrong — the system surfaces this |
| `assignment_score` stored on the task + eventual outcome | Correlates "high score" with "delivered on time, no revisions" — validates the model |
| Revision rate per member per skill | Refines effective proficiency beyond the manually-set number |
| Overrides and their reasons | Reveals where the rules don't match reality |

After ~3 months of use the system can propose: *"Your assignments deviate from recommendations 60% of the time on video tasks. Kashif's video-editing tasks come back with revisions 8% of the time versus a 22% team average — consider raising his proficiency weighting."*

---

## 8. Open decisions in this area

- **Q-009** — Do you want the LLM layer (Layer 2)? It's genuinely useful but adds an API dependency and a small cost.
- **Q-017** — Should the engine ever auto-assign for low-priority XS tasks, or is human confirmation always required?
- **Q-018** — Should members see their own score/performance metrics, or is that Admin-only?
