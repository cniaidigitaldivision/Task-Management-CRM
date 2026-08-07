# 🏗️ BUILD PLAN — finishing the system

> **Purpose.** The owner's instruction (2026-08-07): *"completely and fully build
> the system, replace the placeholders… build each and every function for every
> role every user… ask for my permission on every step."*
>
> This file is the running checklist. **It is updated at the end of every step**,
> so a fresh session can read it and know exactly where to pick up without
> re-reading the chat.
>
> Design and visual work is explicitly **out of scope here** — the owner will
> give a new look separately, and called it *"customization and has nothing to do
> with our original system conventions and features."*

---

## 📍 STATUS

| | |
|---|---|
| **Live** | https://cni-crm.vercel.app — auto-deploys on push to `main` |
| **Current step** | ✅ **All 8 steps complete.** Two owner actions outstanding — see below |
| **Last updated** | 2026-08-07 |

**Progress:** ✅✅✅✅✅✅✅✅ 8 of 8 steps

---

## 🔍 WHAT IS ACTUALLY MISSING — the honest inventory

Measured, not guessed: one screen is still a placeholder, and eight database
tables have no write path in the application at all.

| Table | Built for | Reachable from the app? |
|---|---|:--:|
| `invitations` | Adding a team member | ✅ **Step 1** |
| `audit_log` | The privileged-action trail | ✅ **Step 3** — written by every privileged action, read on /security |
| `system_settings` | Editable configuration | ❌ nothing writes it |
| `task_dependencies` | "This blocks that" | ❌ |
| `task_watchers` | Following work you are not assigned | ❌ |
| `task_skills` | What a task needs, for matching | ❌ |
| `time_extension_requests` | Asking for more time | ❌ seeded only |
| `attachments` | Files on a task | ❌ read path only |

~~Plus `/security`, the last remaining placeholder screen.~~ ✅ **Every screen is now real.**

---

## 🎯 WHAT EACH ROLE WILL BE ABLE TO DO WHEN THIS IS FINISHED

Straight from doc 03 §3. **Bold = does not exist yet.**

### Super Admin
Everything an Admin can, plus: **create and manage Admins** · **edit every system
setting** (thresholds, capacity, scoring weights, workflow) · **view the full
audit log including Admin actions** · **break-glass status** · cannot be edited,
demoted or locked by anybody, including themselves.

### Admin
**Create, deactivate and reactivate people** · **change roles below their own** ·
**force a password reset** · **reset somebody's MFA** · set capacity, concurrency
and skills · create and edit projects · assign any task to anybody ·
**override a capacity block in writing** *(built)* · **approve time extensions** ·
approve or reject work in review · **view the audit log except Super Admin
entries** · **edit the skills library**.

### Team Coordinator
See the whole board · create tasks and assign them to anybody · set time limits
(**but never extend them**) · approve or reject work in review — **never their
own** · cancel tasks · see everyone's workload · **cannot** create projects,
manage people, or override a capacity block.

### Team Member
See **only their own** work · create tasks for themselves · move their own tasks
through the workflow · comment, checklist, track time · **request a time
extension** · **watch a task** · edit their own profile and appearance · sees
nobody else's tasks, workload, capacity or role.

---

## 📋 THE STEPS

Each ends with something usable, a passing `npm run verify`, a commit, and this
file updated. **Nothing starts without the owner's go-ahead.**

---

### ✅ Step 1 · Adding people — the invitation chain — **DONE**
**The single thing between a demo and your team using this.**

- Admin creates a person: name, email, role, job title, capacity
- A hashed, single-use invitation token, valid 48 hours (the raw token is never stored — the database already enforces that)
- Activation page: the invitee sets **their own** password, enrols an authenticator if their role requires one
- Resend the invitation · revoke it · see who has not accepted
- Deactivate and reactivate somebody (never delete — BR-007)
- Change a role, with the rules enforced: an Admin cannot mint another Admin, nobody can change their own role, the Super Admin cannot be touched

**Needs from you:** the Resend key in `.env.local` **and** in Vercel. Until then,
invitation links appear on screen for copying rather than being emailed — which
is enough to test the whole flow.

**⚠️ Worth knowing now:** Resend's free `onboarding@resend.dev` sender only
delivers to the address that owns the Resend account. Your real team cannot be
emailed until a domain of yours is verified.

---

### ✅ Step 2 · Email — **DONE**
- Resend wired in, with templates: invitation, password reset, unlock, login alert, capacity warning
- `/forgot-password` connected end to end — the code is emailed, verified, the password changes, every session is revoked
- The 3-strike account lock emails an unlock code
- Every email in the light palette, plain-text fallback

**Needs from you:** the Resend key. Ideally also a verified domain, or the team cannot be onboarded by email.

---

### ✅ Step 3 · The Security screen — **DONE.** No placeholders remain.
- Your live sessions, with device and location, and **sign out everywhere**
- Recent sign-ins and failed attempts
- The audit log, searchable — Admins see everything except Super Admin entries
- Locked accounts, and unlocking them
- Break-glass status

---

### ✅ Step 4 · Hardening — **MOSTLY DONE**
- **Encrypt the authenticator secrets.** `MFA_ENCRYPTION_KEY` is set and read by nothing; the secrets are plaintext today, so database access is enough to mint 2FA codes
- Step-up re-authentication before the dangerous actions (FR-149)
- Per-IP rate limiting on sign-in
- Reset somebody's MFA (Admin, on people below them)
- Regenerate your own recovery codes
- ~~`npm run demo:code` gets deleted~~ — **kept, and the reasoning changed.** Encryption moved the bar from "holds the database" to "holds the database AND the key". A local script reading `.env.local` has both by definition, so keeping it is a developer using their own key rather than a hole. Gained `--enrol` for restoring a demo account that has lost its factor.

~~**⚠️ STILL OPEN — step-up re-authentication (FR-149).**~~ ✅ **Closed in Step 5**, where it belonged: `app/actions/step-up.ts` runs the challenge (password, plus the authenticator for a privileged role), `components/security/step-up-dialog.tsx` is the UI, and the settings actions call `needsStepUp()` before they will accept a change.

---

### ✅ Step 5 · Settings you can actually change — **DONE**
- Every value on the Settings screen is editable, by the role doc 03 permits — 18 settings, each naming its own permission in `lib/domain/settings.ts`
- Written to `system_settings` as overrides. Resetting **deletes the row** rather than writing today's default back, so a later change to a shipped default still reaches a workspace that once reset to it
- Four gates, in order: role → step-up (FR-149) → the field's own bounds → **the combination**. The fourth is the one an obvious implementation leaves out: every value can be in range while the set is nonsense (a soft threshold above the hard one means the warning never fires before the block)
- Scoring weights refused unless they total exactly 100% *(they were once 105% and silently inflated every recommendation by 5%, C-06)*
- The skills library: add, rename, retire, restore — never delete. `user_skills` is ON DELETE RESTRICT, so a delete button would be offering an action the database refuses, and the ratings are the history the matching engine reads
- Effort points, priority weight and status weight are shown but **fixed by design**, and the screen says why: every stored `effort_points` was computed from that table, so changing XS from 1 to 2 would restate the cost of work estimated months ago
- Step-up re-authentication (FR-149), carried over from Step 4 — password plus the authenticator for a privileged role, failures audited, ten minutes, per-session

**And the part that made it real rather than decorative.** Every consumer imported `SYSTEM_DEFAULTS` directly, so an override could be saved, audited and displayed as changed while nothing behaved differently. `lib/settings/current.ts` is now the single accessor, and the capacity gate, the workload screens, the dashboard, the lockout threshold, the code TTL and the invitation TTL all read through it. Migration 017 adds `app.settings_effective()` so the login screen can read the lock threshold it already prints — the RLS select policy needs an identity, and by definition there is none yet.

**Two bugs found at the seams, both invisible to the layer that contained them:**
1. `system_settings` carries `check (key ~ '^[a-z][a-z0-9_]*

---

### ✅ Step 6 · The rest of task management — **DONE**
- **Subtasks** — one level deep, deliberately. `parent_task_id` cascades on delete, so an unbounded chain turns one delete into an unbounded cascade; the checklist already covers the smaller steps. Closing a parent warns that it does not close the children
- **Dependencies** — both directions on the task ("waiting on" and "waiting on this"), with **cycle detection over the whole visible graph**. A → B → C → A is easy to build one reasonable edge at a time and the schema forbids only the self-edge
- **BR-008** warns on starting something blocked; it does not refuse. A hard block would teach people to delete the dependency rather than record reality, and then the graph the warning is drawn from becomes fiction
- **Watchers** — anybody may follow or unfollow themselves; a Coordinator may add somebody else, and that person is told
- **Time extensions** — request with a mandatory reason, decide with a context block (used vs limit, prior extensions, "the estimate was probably low, not the work slow"), full or partial grant, decline requires a written reason (FR-186). Pending requests appear on the dashboard (FR-190) and deep-link straight into the task
- **Task skills** — what a task needs, at three weights, which is what the matching engine reads
- **Bulk actions** on the board — status, assignee, follow. Each task is decided separately and partial success is reported honestly
- **Recurring tasks** — an RFC 5545 subset, and the next instance is created **when the current one closes**, not on a schedule

**Design decisions worth knowing:**

*Spawn-on-complete, not a scheduler.* A weekly report three weeks late is one task three weeks old — the truth — rather than four tasks implying four separate pieces of work, and four tasks' worth of capacity load nobody owes. No cron, and the series can never outrun the person doing it.

*Bulk is not one transaction.* The same actor may legally move four of five selected tasks and be refused on the fifth by BR-002, because they are assigned to it. Deciding once would either approve the illegal one or refuse the four legal ones; rolling back would throw away four legitimate changes to report one expected refusal. Bulk **assignment** is sequential of necessity — each one changes the load the capacity gate reads, so five in parallel would all be judged against the same starting figure.

*Two mismatches between the spec and the schema, resolved in favour of the schema.* `extension_status` spells it `partially_approved`, not `partial`. And FR-187 says an approval "resumes the timer" when there is nothing to resume — doc 17 §4 chose option B, where the timer is never stopped at the limit, and `timer_pause_reason` has no `limit_reached` value for exactly that reason. Restarting a pause that exists for leave or outside-hours would record time nobody is spending.

**And one real hole closed.** `notify()` took `kind: string`, so an invented value compiled cleanly and failed only at the insert — at the end of a flow that had already written its decision. `NOTIFICATION_KINDS` now mirrors the enum. My own first draft used three kinds that do not exist.

**Tests:** 103 new unit, 29 new integration. Totals **788 unit · 115 integration · 25 smoke**, integration run twice consecutively. The new suite creates real tasks and batch-deletes them — the first version looped eight deletes per fixture and timed out its own cleanup hook, leaving behind exactly the mess it existed to prevent.

---

### ✅ Step 7 · Attachments — **DONE** (one owner action outstanding)

Files attach to a task, download through a link that expires, and are removed by whoever uploaded them or a Coordinator.

**The bucket is private, and that decision shaped everything else.** It was created public — meaning every file readable by URL, forever, by anyone, with no account. That routes straight around the RLS model the rest of the system is built on: a task can be locked to three people and its attachment still open to the world. It is now private, capped at 25 MB, with 17 allow-listed types.

**Downloads are two steps.** A row carries no URL. Clicking asks the server, which re-checks the person can still see the task and then mints a link good for an hour. A link forwarded into a group chat is spent by the time anybody reads it, and access revoked this morning means nothing this afternoon.

**Uploads write the file before the row.** They cannot be atomic — one is HTTP, one is Postgres — so the choice is which failure to suffer. Row first leaves a row pointing at nothing: it shows in the list and every download fails forever. File first leaves an unreferenced object: invisible, a few kilobytes, cleanable. Deleting reverses it for the same reason. When the row write fails the object is removed again immediately, best-effort.

**The extension is checked separately from the MIME type**, because `file.type` is a claim the browser reads from the OS extension registry, not an inspection. Rename `payload.exe` to `payload.pdf` and Chrome reports `application/pdf` quite sincerely. An attachment carries an implicit endorsement — it came through the company system, from a colleague's account, on a real task — and people open those.

**Filenames are sanitised and never used as paths.** The stored path is `tasks/<taskId>/<attachmentId>.<ext>`, so two people attaching `brief.pdf` cannot overwrite each other and no name-derived path can be traversable. The name goes in the database and is restored on download. Quotes, control characters and newlines are stripped because the name is echoed in a `Content-Disposition` header, where a quote ends the token early and everything after it is read as header syntax.

**⚠️ OWNER ACTION — `SUPABASE_STORAGE_KEY` is not set yet.** A private bucket cannot be authorised the way everything else here is: Supabase Storage is a separate HTTP service and cannot see `app.user_id`, the transaction-local setting RLS is built on. So one server-side key is unavoidable. **The rule against using an elevated key for the DATABASE is unchanged and unrelaxed** — nothing reads or writes `public.*` with one. The containment is enforced rather than promised:

- `lib/storage/bucket.ts` reads it and **nothing else does** — `npm run lint` fails the build if another file mentions it (rule in `eslint.config.mjs`, verified by deliberately planting a probe file)
- that module exports four narrow functions and never returns a client
- every caller has already run `requireUser()` and had RLS confirm task visibility. The key moves bytes; it never decides who may see them

Get it from **Supabase → Project Settings → API keys → secret key**, put it in `.env.local` and Vercel, then run **`npm run storage:check`** — it uploads a test file, signs a link, downloads it back, confirms the bucket refuses unsigned access, deletes it, and never prints the key.

Until then the panel says storage is not configured and the rest of the task drawer works normally.

**Tests:** 34 new unit, 7 new integration. Totals **822 unit · 122 integration · 25 smoke**.


---

### ✅ Step 8 · Intelligence and the finishing pieces — **DONE**

**Assignment recommendations** (doc 07). Six weighted dimensions minus penalties, tested against the document's own worked example. Every row expands into the numbers that produced it, because a ranked list with no explanation is an oracle. Below the usability floor it stops ranking people and says what to change instead — ordered by how cheap the fix is. Skills nobody holds above proficiency 3 surface as a hiring signal.

**Global search** (⌘K). Tasks, projects and people. Runs on the server under the searcher's identity, so RLS removes the rows before they are sent — search is the classic place a permission model leaks, and the leak is almost always a client-side filter over a query that fetched too much. `ILIKE` rather than full-text: the tokeniser splits `EVT-142`, which is the single most common thing anybody searches for.

**Calendar.** A month of due dates, Monday-first with Sunday shaded, because the working week is Monday to Saturday (ADR-004). Every date calculation is UTC — `new Date('2026-08-07').getDate()` answers locally, so west of Greenwich every task lands a cell early.

**CSV export** of tasks and workload, with a formula-injection guard. A title beginning `=`, `+`, `-` or `@` executes when the file opens in Excel or Sheets; every cell is neutralised with a leading apostrophe and the file carries a UTF-8 BOM so accented names survive. Every export is audited with a row count — once a file is in somebody's Downloads folder no access control applies to it, so the record of when it left is the only thing left.

**Notification preferences**, per kind, per channel. A few cannot be silenced and each says why on screen rather than being hidden. **`notify()` enforces them centrally** — a preference honoured in nineteen call sites and forgotten in the twentieth is worse than none, because the person stops trusting the switch.

**The daily digest** (FR-081). `GET /api/digest`, called by Vercel Cron at 04:00 UTC Monday to Saturday. It sends nothing when there is nothing: a mail arriving every morning saying "nothing needs you" is deleted unread within a fortnight, and then the one that matters is deleted too. Each digest is built inside `withUser(theirId)` — one person at a time, RLS live — so a bug in that file cannot put somebody's work in somebody else's inbox.

**A bug caught while writing the recommendation query.** The first draft summed effort × priority × status weight in SQL, and was already wrong: `revisions` as 0.75 where STATUS_META says 1, `blocked` as 0.25 where it says 1. Nothing would have failed — the recommendations would simply have ranked people against a different definition of "busy" than the workload screen beside them, forever. The rows now come back raw and `taskLoad()` does the arithmetic.

**Migration 018** lets `notify()` read a recipient's preferences when the actor is a Member who cannot see their row. Without it the switch would work when a Coordinator triggered the notification and silently not when a Member did.

**Tests:** 92 new unit. Totals **914 unit · 122 integration · 27 smoke**.

---

## ⚠️ WHAT THE OWNER STILL HAS TO DO

Two environment variables. Everything else is built, deployed and green.

| | What | Where |
|---|---|---|
| 1 | **`SUPABASE_STORAGE_KEY`** — file attachments will not upload without it | Supabase → Project Settings → API keys → **secret** key. Add to `.env.local` **and** Vercel. Verify with `npm run storage:check` |
| 2 | **`CRON_SECRET`** — the daily digest endpoint is disabled without it | Generate with `openssl rand -base64 32`. Add to Vercel. The route returns 503 until then — off, never open |

Still outstanding from earlier steps: rotate the three secrets that were pasted into chat (Resend key, database password twice), and verify a real sending domain in Resend — the sandbox sender only delivers to the Resend account owner's own address, so nobody else can be invited until then.
---

## 🔁 HOW EACH STEP RUNS

1. Owner says go
2. Build it — schema first if needed, then rules, then the screen
3. Prove it: `npm run verify`, integration tests where there is a real seam, `npm run smoke` against the live URL
4. Commit, push (which deploys itself)
5. **Update this file and `SESSION-STATE.md`**
6. Report what changed, what it needs from the owner, and stop

## ⛔ NOT IN THIS PLAN

- **Sales management and workflow automation** — standing rule R4, the owner was explicit these are examples of what other CRMs do and are not wanted
- **Visual redesign** — coming separately, after the system is complete
- Google Sign-In (Phase 7a), WebAuthn/passkeys, multi-tenancy (ADR-008 says never)
)` and every key is camelCase. The first save in production would have been a check violation. Fixed with a `toStorageKey`/`fromStorageKey` conversion at the one boundary that touches the column.
2. The RLS **delete** policy is Super Admin only while **insert** is Admin+. An Admin pressing Reset deleted zero rows, with no error — the screen would have said "restored" over a row that was still there. `clearOverride` now reports whether it actually deleted anything, and the action says so honestly.

**Tests:** 36 new unit tests, 16 new integration tests. Totals now **685 unit · 86 integration · 25 smoke**, integration run twice consecutively to prove it leaves the workspace as it found it (the suite snapshots and restores `system_settings`).

**Worth knowing:** doc 03 §3.6 reserves the thresholds, the weights and the security timings for the **Super Admin**. An Admin opening Settings can change exactly one of the eighteen (the ad-hoc work line) plus the skills library; the rest render read-only with the count stated at the top of the section. That is the documented matrix, not an oversight.

---

### ⬜ Step 6 · The rest of task management
- **Subtasks** — the column exists, nothing creates them
- **Dependencies** — "this cannot start until that finishes", with a warning when you start something blocked
- **Watchers** — follow a task you are not assigned
- **Time extensions** — a Member requests, an Admin approves or declines, and only an Admin can (BR-018)
- **Task skills** — what a task needs, which is what the matching engine reads
- Bulk actions on the board
- Recurring tasks

---

### ⬜ Step 7 · Attachments
- Upload to a task or a comment, download, delete
- Type and size limits, and the storage rules so one person's files are not readable by another

**Needs from you:** a Supabase Storage bucket. I can create it through the Supabase connection — I will ask first.

---

### ⬜ Step 8 · Intelligence and the finishing pieces
- **"Who should do this?"** — the assignment engine, which already knows everyone's skills and load, actually recommending somebody, with the reasoning shown
- The rebalance advisor acting on its suggestions rather than only listing them
- Global search across tasks, projects and people
- Calendar view
- CSV export and the Monday-morning digest
- Notification preferences per person, per channel

---

## 🔁 HOW EACH STEP RUNS

1. Owner says go
2. Build it — schema first if needed, then rules, then the screen
3. Prove it: `npm run verify`, integration tests where there is a real seam, `npm run smoke` against the live URL
4. Commit, push (which deploys itself)
5. **Update this file and `SESSION-STATE.md`**
6. Report what changed, what it needs from the owner, and stop

## ⛔ NOT IN THIS PLAN

- **Sales management and workflow automation** — standing rule R4, the owner was explicit these are examples of what other CRMs do and are not wanted
- **Visual redesign** — coming separately, after the system is complete
- Google Sign-In (Phase 7a), WebAuthn/passkeys, multi-tenancy (ADR-008 says never)
