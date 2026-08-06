# 🎬 DEMO GUIDE — running the CRM in front of someone

> Written for the CEO demo on 2026-08-06. Everything below is real: the data is in
> Postgres, every action writes to it, and every refusal comes from a rule in the
> specification rather than from a mock.

---

## 1. Before you start — three commands

```bash
npm run dev            # http://localhost:4310
npm run seed:demo      # only if the team is missing; prints the credentials
npm run smoke          # 25 checks: every route renders for an Admin and a Member
```

`npm run smoke` is the one to trust. It signs in as two real users and fetches
every screen as each of them, so a green run means the demo will not fall over.

---

## 2. Who to sign in as

| Account | Role | Use it for |
|---|---|---|
| **`kashif@cni-demo.com`** | Team Coordinator | **Start here.** Sees the whole board, assigns work, approves reviews, and needs **no second factor** — so the sign-in is one step. |
| `sana@cni-demo.com` | Admin | The full picture: Team, Settings, capacity overrides. **Requires a TOTP code** — see below. |
| `yusra@cni-demo.com` | Team Member | Showing isolation: she sees only her own work, and the other screens refuse her. |

**Password for every demo account:** `Marigold-Harbour-92`

### The Admin needs an authenticator

Two-factor is mandatory for Admin and Super Admin (FR-145), and the sign-in
enforces it — an Admin without a verified factor is sent to the enrolment screen
and cannot get in. `npm run seed:demo` prints the TOTP secret and a currently
valid code; paste the secret into Google Authenticator once and it works from
then on.

If you have no authenticator to hand, demo as Kashif. **The Admin's MFA prompt is
worth showing deliberately** — it demonstrates that the security model is real.

---

## 3. The flow — roughly eight minutes

### ① Dashboard — "where does the division stand?"
Sign in as Kashif. You land on the dashboard.

- Four figures across the top: open tasks, completed, **team utilisation**, over time limit.
- **Where the work stands** — every task by status, with readable counts.
- **Needs a decision today** — blocked first (that work is *stopped*), then overdue, then reviews.
- **Who is carrying what** — each person's load as a percentage of capacity.

**The line worth saying out loud:** *"None of these numbers are stored. Utilisation
is effort × priority × status weight, summed over open work, computed every time
you open the page — so it cannot drift out of date."*

### ② Create a task — press `N`
The dialog opens from anywhere.

- Effort is **a size, not a number** — "A full day", not "4". The points are derived.
- Pick the project **Misc / Ad-hoc** and watch a required field appear asking what
  the work actually is. That is BR-012: ad-hoc work has to explain itself, and the
  database refuses the row without it.

### ③ Assign it to someone near their limit
Assign to **Emaan Tariq** (he is around 90%). Give it an XL estimate.

- Under 100% you get a **warning and it proceeds**.
- Over 100% a Coordinator is **blocked outright**, and the message says only an
  Admin can override.
- Signed in as Sana, the same attempt asks for a **written reason**, which is then
  stored on the task and shown on it.

**This is the feature the whole capacity model exists for.** Soft threshold warns,
hard threshold blocks (BR-003, BR-004).

### ④ Move work on the board
Drag a card between columns — the move is saved.

- Drag anything to **Blocked** and it stops to ask *why*. A blocked task with no
  reason is useless to whoever has to unblock it (FR-043).
- Open a task **in review** and try to approve it as its own assignee. It refuses:
  *"You cannot review your own work."* That is BR-002, and **no rank satisfies it** —
  not Admin, not Super Admin.

### ⑤ Open a task — click any card
The drawer holds the status, the assignee, the timer, the checklist and the
comments. Start the timer; the elapsed time is measured by the **database's**
clock, not the browser's.

### ⑥ Workload — "who is in trouble?"
Busiest first. The formula is printed next to the figures on purpose: *a number
nobody can reconstruct gets ignored the first time it disagrees with their gut.*

Below it, **what to do about it** — what could move off an overloaded person and
who has headroom. Suggestions, not automatic moves.

### ⑦ Projects — the ad-hoc audit
The card at the top shows the share of committed effort sitting in **Other**
projects. Above 15% it turns amber.

**Worth saying:** *"Favours and one-off jobs used to be invisible — they consumed
real days and appeared in no plan. Making the category mandatory, with a written
explanation, turns that into a number somebody can act on."*

### ⑧ The finish — sign in as Yusra
Sign out, sign in as `yusra@cni-demo.com`.

- Her sidebar has **four items**. No Dashboard, no Team, no Workload.
- She sees **only her own tasks**.
- Type `/team` into the address bar. **It refuses.**

**The point:** *"That is not the interface hiding buttons. Every one of those rules
is enforced in the database, so a bug in the application cannot leak another
person's work."*

---

## 4. What is honestly not built yet

Say these before anybody finds them, because each is a deliberate position rather
than an omission:

| Not there | Why |
|---|---|
| **Adding a team member** | Needs the invitation chain — a hashed single-use token, a 48-hour expiry, an activation ceremony and an email that arrives. Half of it would create accounts nobody can sign in to. Next step. |
| **Any email** | Needs the Resend account. Nothing is sent yet, so no password reset completes end to end. |
| **File attachments** | The table exists; uploads need Supabase Storage configured. |
| **Editing settings** | The screen shows the live values and says it is read-only. A Save button that quietly did nothing would be worse. |
| **Live updates between browsers** | Realtime is Phase 4. Refresh to see somebody else's change. |
| **Smart assignment recommendations** | The scoring weights are defined and shown on Settings; the ranking UI is Phase 3. |

---

## 5. If something goes wrong mid-demo

| Symptom | Do this |
|---|---|
| A screen errors | Refresh. Every page reads fresh; there is no cached state to be stuck in. |
| Sign-in refuses | Three wrong passwords locks the account for 30 minutes. Use another demo account, or re-run `npm run seed:demo -- --wipe` then `npm run seed:demo`. |
| A drag does nothing | The column refused it. Open the card instead — the status dropdown lists only legal moves and says why the others are missing. |
| Board looks stale | Refresh. Changes made in another browser do not push yet. |
| Everything looks wrong | `npm run smoke` tells you in ten seconds whether it is the app or the data. |

---

## 6. Resetting afterwards

```bash
npm run seed:demo -- --wipe    # removes the demo tasks and projects
npm run seed:demo              # rebuilds it, dates relative to today
```

The wipe **deactivates** the demo accounts rather than deleting them, because
BR-007 forbids deleting a user row and a trigger enforces it. The activity trail
also stays — `activity_log` is append-only, and "history is not editable by any
role" applies to the demo tooling too.
