# 🚨 TEAM ISSUES — the live triage board

> **Owner, 2026-09-22:** *"Right now my team and I are facing a lot of issues
> with the system so prioritize them also. Definitely they are working so I want
> to resolve them first. Then I will come back to this CRM again."*

**This is the active work.** The CRM is paused until the owner says otherwise
(`docs/crm/19-HANDOVER.md` §8). Anything reported here comes before new features.

---

## How this board works

### Intake — what a session writes down when something is reported

The owner usually describes a problem the way a person experiences it ("it is
slow", "it did not save", "the button does nothing"). Record it **in their
words**, then add what only a session can add: the page, the person, the time,
and what the system actually did.

```markdown
### T-00 · <what the person experienced, short>
| | |
|---|---|
| **Reported** | 2026-09-22, by <role: the owner / a salesperson / finance> |
| **In their words** | *"…"* |
| **Where** | /route · which panel or button |
| **Who it hits** | everyone · one role · one person |
| **How often** | every time · sometimes · once |
| **Priority** | P0 / P1 / P2 / P3 (see below) |
| **Status** | reported → reproduced → cause found → fixed → deployed → confirmed |

**Reproduced:** what was done, as whom, and what happened.
**Cause:** the real one, verified — not the first plausible one.
**Fix:** commit, migration, and what was measured afterwards.
```

### Priority

| | Means | Answer |
|---|---|---|
| **P0** | Somebody cannot work, or data is wrong, or a client could be messaged by mistake | Drop everything. Fix, deploy, tell the owner |
| **P1** | A daily job takes far longer than it should, or a feature is unusable in one role | Same session |
| **P2** | Annoying but there is a way round it | Batched into the next session |
| **P3** | Polish, wording, a nice-to-have | Backlog — only when the owner asks |

### Two rules that stop wasted work

1. ⚠️ **Reproduce before fixing.** A displayed error message is often not the real
   cause — this codebase has a written-down history of catch blocks naming a
   guessed cause. Sign in as the person who hit it (a salesperson, not an admin —
   an admin session cannot test access) and watch it happen.
2. ⚠️ **Fix the cause, then prove it with the thing that failed.** Not with a new
   test that passes; with the same click, the same file, the same person.

### Where to look first, by symptom

| Symptom | Look at |
|---|---|
| "It's slow" | Payload size and the router cache **first** — never assume the database or the region. `docs/20-UI-RESPONSIVENESS.md` §"Where the slowness actually is"; `node scripts/perf.mjs` |
| "It didn't save" | Was the write refused by RLS, a guard trigger, or a `GRANT`? "Permission denied" is a grant, not a policy. Reproduce the write as that person |
| "I can't see X" but a colleague can | Membership predicate, not a bug in the screen. Check as them; never from an admin session |
| "It logged me out" | Session rotation and the absolute expiry in `public.sessions` |
| "The client got a message they shouldn't have" | **P0.** `whatsapp_consent`, `app.crm_quiet_insert`, and the auto-send triggers. Stop the scheduler before investigating |
| "The number is wrong" | Karachi vs UTC — `current_date` is a different day for five hours every evening |
| Something looks broken only here | The dev server draws a fallback font when offline; check `document.fonts` before touching CSS |

---

## Open

*(Nothing recorded yet — the owner is about to describe them. Each one gets an
entry above, newest first, and the tracker gets a line when it is fixed.)*

---

## Closed

*(Fixed and confirmed items move here with their commit, so the same report is
never investigated twice.)*
