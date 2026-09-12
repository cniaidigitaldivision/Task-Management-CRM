# How leads get assigned — and whether it is honestly "intelligent"

Written 2026-09-12, in answer to the owner's question:

> *"If a person has fewer leads auto-assigned to them, that's a good thing. My
> big question to you is: is this one figure, or is this one check enough for a
> smart system to assign leads to a salesperson? Is that smart? If I claim that
> my system is an AI intelligent, AI smart, or AI-powered system, is this one
> check, what do you think, enough to claim as this big thing about my system?"*

It is a fair question and it deserves a straight answer before any more code.

---

## The short answer: no, and you should not make that claim yet

What exists today is **capacity-based routing with a fairness tiebreak**:

```
app.crm_next_owner(project)
  → whoever holds the FEWEST OPEN leads on this project
  → ties broken by whoever went longest without being given one
  → the department's manager is excluded; they run the rota
```

That is a real, respected algorithm. The 2026 lead-routing literature names it
the correct default for a small team, and it beats round-robin outright. It also
**prints its own reasoning** on screen, which most commercial CRMs do not.

But it is **arithmetic, not intelligence**. One signal, no learning, no
adaptation. Asked *"what makes it smart?"*, the honest answer today is
*"it counts."* Claiming AI on top of that is a claim the system cannot support,
and the first person to ask what the model does will find out.

⚠️ **This matters commercially, not just intellectually.** The division sells
CRM and automation. A demo whose "AI" turns out to be a `count(*)` costs more
credibility than never having claimed it.

---

## What a defensible claim actually needs

| Property | Today |
|---|---|
| Uses several signals, weighted | ❌ one |
| Explains its decision | ✅ *"held 7 — fewest (Sale 2 tester 8)"* |
| Adapts from real outcomes | ❌ nothing has closed |
| Knows when it does not know | ✅ refuses rates with no data behind them |

Two of four — and the two missing are the two the word "intelligent" rests on.

---

## The four signals to add, none of which need AI

All four are computable **today**, from data the system already holds. Together
they turn one number into a weighted decision that can be explained line by line.

### 1 · Who actually answers fastest ⭐ the highest-value one

`crm_project_roster()` already returns `medianResponseMinutes`. Right now a
person who never replies is handed leads at the same rate as one who replies in
twenty minutes.

**Why it matters most:** replying within 5 minutes rather than 30 makes a lead
**21× more likely to qualify** and roughly **100× more likely to be reached at
all** (MIT / InsideSales). No other signal available here moves conversion that
far.

⚠️ **Null is not zero.** Somebody with no calls logged has no response time, and
must be treated as *unknown* — not as instant, which is the most flattering
possible reading of no data.

### 2 · Who is actually at work ⭐ the one no competitor has

**Taskly already holds attendance.** Handing a lead to somebody who checked out
at 18:00, or is on leave, wastes the only hour that matters.

⚠️ **This is a genuine competitive advantage and it is nearly free.** PropForce
and Ladder cannot do it because they do not own the attendance system. We do —
it is two tables away.

### 3 · Weight by stage, not by headcount

Five leads in `negotiation` is a week's work; five untouched `new` ones is an
afternoon. Counting both as "5 open" is the crudest part of the current rule.

A weight per stage — `new` 1, `contacted` 1.5, `qualified`/`negotiation` 3 —
turns a headcount into a workload.

### 4 · Has this person gone quiet?

Somebody who has logged nothing for three days should not be handed a fifth
lead. The neglect job (migration 123) already computes this; the router does not
read it.

---

## ⚠️ And one signal to deliberately LEAVE OUT

**Do not let conversion rate drive the assignment.** The routing literature is
unusually direct: performance-based routing *"works best as a tiebreaker within
another model, not as the primary method."*

The reason is a reinforcement loop. Give the best leads to the best closer and
it becomes **statistically impossible** for anybody else to improve — their
numbers can never recover because they never receive comparable material. Within
months there is a two-tier team, and the measurement that caused it reads as
proof it was right.

**Performance is a tiebreak. It is never the router.**

---

## What it would look like

A score per person, lowest wins, every term visible:

```
load      = Σ (open leads × stage weight)          signal 3
speed     = median response minutes, or UNKNOWN    signal 1
available = at work right now?                     signal 2
active    = logged anything in the last 3 days?    signal 4

not available        → skipped entirely, with the reason
load lowest          → wins
tie                  → faster median response wins
still tied           → longest without a lead wins        (today's rule)
```

⚠️ **THE EXPLANATION IS THE FEATURE.** It already prints *"held 7 open leads —
fewest on the team (Sale 2 tester 8)"*, and that sentence is why a salesperson
can check the rota rather than suspect it. Every signal added must extend that
sentence, never replace it with a score nobody can reconstruct — the same rule
the workload page follows, and the same reason `07-AI-PLAN.md` refuses an
unexplained number on a dashboard.

---

## What to call it

**"Intelligent lead distribution"** — accurate, demonstrable, and it explains
itself on screen.

**Not "AI-powered".** Save that for when a model genuinely decides something,
which is Steps 11 and 12. The gap between the two phrases is small in marketing
and total in a technical conversation.

---

## Where the AI genuinely belongs

Not in the routing. In these, in this order:

| | Needs |
|---|---|
| **Per-lead summary, talking points, drafted message** | The OpenAI key ✅ in Vault, and Q18 ✅ answered — **strip identifiers** |
| **Matching a lead to the right person** | ⛔ **Closed.** Owner, 2026-09-12: there is no specialisation to match on. Revisit only if that changes. |
| **Lead scoring from outcomes** | ~200 closed leads. No shortcut exists. |
| **Campaign versus staff** (Step 12) | Weeks of real use by real people. |

---

## What this needs from the owner

**Nothing.** That is the point of choosing these four signals.

- No specialisation field — deliberately, since there is none
- No OpenAI key — it uses no model at all
- No WhatsApp — unaffected by the verification wait
- No closed leads — it measures effort, not outcome

⚠️ **One thing it does need, and it is the reason the CRM is paused:** more than
three test accounts in one department. A rota is a comparison, and a comparison
needs people. **This is exactly what the team restructuring provides**, which is
why building it first is the right order rather than a detour.

---

## The order to build it

1. **Stage weights** (signal 3) — pure SQL, no new data, immediately visible
2. **Response time** (signal 1) — the column already exists
3. **Availability** (signal 2) — the interesting one; joins attendance
4. **Gone quiet** (signal 4) — reuses migration 123's logic
5. **Extend the printed sentence** at every step, never after

Each ships on its own and each makes the decision better on its own. None of
them requires the next.

---

## Sources

- [Lead Routing: The Complete Operator's Guide](https://www.thegtmadvisor.com/blog/lead-routing-guide) — The GTM Advisor Group
- [Lead Routing & Assignment: The 2026 CRM SLA Framework](https://www.digitalapplied.com/blog/lead-routing-assignment-2026-crm-sla-framework) — carries the MIT/InsideSales response-time figures
- [Round Robin Lead Distribution Best Practices](https://www.leandata.com/blog/round-robin-lead-distribution-best-practices/) — LeanData
