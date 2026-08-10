# 📋 WORK LOG — step by step, not batch by batch

> **Why this file exists.** Owner instruction, 2026-08-09: *"record each and
> every step and every work as well, so it doesn't pick up from the phase start
> — rather it starts from where that phase had been completed till… so if I have
> to switch to a new session it picks up exactly from where this chat went dead."*
>
> [`SESSION-STATE.md`](SESSION-STATE.md) records **where we are between batches**.
> That is too coarse to resume from if a session dies halfway through one. This
> file records **every step inside a batch**, written as the step finishes, not
> at the end.
>
> **The rule: update §1 and append to §2 after every step, before moving on.**
> A step is not finished until it is written down here.

---

## 1. ▶️ RESUME POINT — read this first

| | |
|---|---|
| **Updated** | 2026-08-10 · Session 24 · **written for a handover to a new session** |
| **Current batch** | **Batch 4 — People & access** ([CHANGE-PLAN §4](CHANGE-PLAN.md)) |
| **Steps done in this batch** | **4.3a** pagination primitive · **4.2** Team switches · **4.3b** Team paginated · **4.z** migration 021 fixture purge · **4.3c** every remaining list paginated · **4.1a** migration 022 written, probed **and applied** |
| **⏭️ NEXT ACTION** | 🔴 **THE TREE DOES NOT COMPILE. Fix that first — it is three props.** `components/team/person-actions.tsx:391` renders `<ResetTrailDialog>` without the `trail` and `onChanged` props it now requires (`error TS2739`). See **§4 below** for the exact edits, which are written out line by line. Then finish 4.1: browser-verify the whole reset journey, run the suites, commit. |
| **Working tree** | ⚠️ **DIRTY AND NOT COMPILING.** 6 modified files + 1 new file, all part of step 4.1b, none committed. `npx tsc --noEmit` reports **one** error, listed above. Nothing else is wrong. |
| **Blocked on** | nothing — the owner approved both decisions this session (apply 022 ✅, honest delivery labels without a webhook ✅) |

### What is complete overall

| | |
|---|---|
| BUILD-PLAN | ✅ all 8 steps |
| REDESIGN-PLAN | ✅ phases 1–8 · 🔴 phase 9 (the supplied task-board HTML) needs an owner decision |
| CHANGE-PLAN | ✅ Batch 1 (9 bugs) · ✅ Batch 2 (impact dialog, Cancel, Purge, avatars) · ✅ **Batch 3 (forms)** · 🔨 Batch 4 (4.2, 4.3a–c and 4.1a done; **4.1b unfinished**) · ⬜ Batches 5–7 |
| Tests | 958 unit · 141 integration · 27/27 smoke — **all last run BEFORE step 4.1b, which is unverified** |
| Migrations applied | through **022** |

### Still needing the owner, whenever we reach them

| | |
|---|---|
| REDESIGN-PLAN §9 | What the supplied `CNI-AI-Digital-Task-Board.html` should become |
| Batch 5 | One new dependency for real `.xlsx` export — package and size to be named first |
| Anytime | The Resend sending domain. Until it exists, mail reaches only the Resend account owner |
| Board order | Persisting a card's position in a column needs a migration; never asked for |

---

## 2. 🗂️ THE STEPS

Newest last. Each entry is written when the step is **finished and verified**,
so anything not listed here has not been done.

### Batch 4 — People & access

| # | Step | State | What changed | Proof |
|:--:|---|:--:|---|---|
| — | *batch started* | — | Order within the batch: **4.3** pagination, **4.2** the Active/Inactive/Deactivated switches, then **4.1** the reset status trail. 4.1 last because it changes what forcing a reset does — today `forceResetAction` sets `account_state` and revokes sessions but **sends nothing**, so a status trail needs the email and the token to exist first. | — |
| 4.3a | **Pagination primitive** — `components/ui/pagination.tsx` | ✅ | `usePagination` + `Pagination`, **12 rows** (owner said "12 or 13"; 12 divides evenly). Pages **in the browser, not in SQL**: every screen already holds its full list, the queries are bounded by RLS, and each of those screens also filters and sorts client-side — so server paging would add a round trip per page turn AND make the page counts disagree with the filters. Page resets when the list shrinks under it, done as a render-time state adjustment rather than an effect (an effect paints the empty page once before fixing itself). Footer renders nothing at one page — "Page 1 of 1" is furniture. | `tsc`, lint, 958 tests, build clean |
| 4.2 | **Active / Inactive / Deactivated switches on Team** | ✅ | Three states because the schema holds **two independent facts**: `is_active = false` means the account was turned off (BR-007, never deleted), while `account_state <> 'active'` means it is on but unusable — awaiting activation, forced reset, MFA not set up, locked, suspended. Collapsing them would hide the difference between "gone" and "stuck", which an Admin acts on differently: one gets restored, the other unblocked. Counts on each switch; empty states name what is absent. | Browser: `Active · 8 · Inactive · 1 · Deactivated · 115`; switching filters the list and the pager follows |
| 4.3b | Pagination applied to **Team** | ✅ | Pages the FILTERED list, so the footer count and the switch count always agree. | Browser: page 1 `1–12 of 115` with 12 rows, page 2 `13–24 of 115` with 12 rows, and the rows genuinely differ. |
| ⚠️ | **Found: 115 deactivated accounts in the live database** | 🔴 noted | They are integration-test fixtures. `test/integration/provisioning.test.ts` cannot delete a user (BR-007 forbids it and a trigger enforces it), so it deactivates and renames them `retired-<uuid>@prov-test.invalid`. Correct behaviour for the test, but every run adds more, and they now outnumber real accounts 13:1 on the Team screen. **Owner decision needed** — see the report. Not touched. | Counted on the Team screen |
| 4.z | **Migration 021 — purged the 115 fixture accounts** (owner chose option 1) | ✅ | A **deliberate, documented BR-007 exception.** BR-007 exists so removing somebody preserves their tasks, comments and time logs — reasoning that does not apply to a row that never had any. Verified across all 115 before writing it: **0** comments, **0** tasks, **0** projects, **0** time entries, **0** attachments, **0** extensions, so every one of the eight `RESTRICT` foreign keys into `users` was unreferenced. Predicate is five conditions wide, including `.invalid` (RFC 2606 reserved — it can never be a real address). Uses the **documented break-glass path**, not a disabled trigger: `alter table … disable trigger` would have worked and left no trace, whereas break-glass makes each deleted row write its own `break_glass_used` CRITICAL event first. | 115 purged, then 5 more on a re-run. `users` 124 → 9. **116 critical security events** written (115 per-row + 1 `permanent_purge` summary). 958 unit · 141 integration · 27/27 smoke all green afterwards. |
| 4.3c | Pagination applied to **every remaining list** — Security ×4, Projects, Tasks list view | ✅ | **Security** got four independent pagers (sessions, login attempts, audit log, security events) — independent because they are four separate questions on one screen and paging one must not move the others. **Projects** pages the filtered set, while the toolbar's "open · pts" totals deliberately keep counting the WHOLE filtered set: a total that described only the visible page would contradict the pager beneath it. **Tasks list view** was the interesting one — it is grouped and collapsible, so a single pager over the flattened list would cut a group in half (page 2 of "Blocked" opening with rows whose heading is on page 1), and paging the *groups* would hide whole statuses. Rows were extracted into `GroupRows` so each group legitimately owns its own `usePagination` — a hook cannot be called inside `groups.map`. Group headings still show the group's **full** count, not the page's. Collapsing a group resets it to page 1, deliberately: re-opening a group you left on page 3 should not hide its first rows. | Browser, Super Admin: Security showed `1–12 of 17 attempts`, `1–12 of 70 entries`, `1–12 of 40 events`, and **no pager on sessions** because sessions fit one page — correct. Audit page 4 → `37–48 of 70`. ⚠️ **Projects (7) and every task group (max 10) are under 12 today, so their pagers cannot appear on real data.** Rather than assume, page size was temporarily set to 3 and rebuilt twice to see them: Projects `1–3 of 7 projects` → page 3 → `7–7 of 7`; task groups `1–3 of 6`, `1–3 of 10`, `1–3 of 8` with **no pager** on the 2- and 3-row groups, and sending "To Do" to page 4 left Backlog and In Progress on page 1 — genuinely independent. Reverted to 12 and rebuilt; `grep` confirms no temporary page size survived. |
| — | **Not paginated: the Reports tables** | ⬜ deferred to Batch 5 | Deliberate, not an oversight. `app/(app)/reports/page.tsx` is a **Server Component** and `usePagination` is a client hook, so paging it means extracting client components — and **Batch 5 rebuilds this screen entirely** (four report types plus export). Its two lists are also bounded by headcount and project count: **9 people, 7 projects** today, so a pager would render nothing either way. Doing it now would be work thrown away in the next batch. | Counted: 9 users, 7 projects, 38 tasks |
| 4.1a | **Migration 022 — written, probed, and APPLIED** (owner approved 2026-08-10) | ✅ | Adds the two things `invitations` cannot already answer. It already answers four: `created_at` = sent, `expires_at` = expiry, `consumed_at` = completed, `invalidated_at` = revoked. **"Delivered" is not one of them and this deliberately does not pretend otherwise:** the column is `email_state` (`accepted` \| `refused` \| `unreachable` \| `not_configured`) — what the provider *said* — because real delivery needs Resend to call a webhook back, which is worth nothing until a sending domain exists. `email_sandbox` is stored **per row**, not read from the environment at render time, so a trail can never retroactively claim a silently-dropped message arrived. **Found while reading the flow, and it forced a design decision:** the token hash is `hashScopedCode(purpose, email, code)`, and on `/reset-password?code=…` the email has not been typed yet — so the row **cannot be found from the URL** and an open cannot be recorded at all without another key. Hence `trail_ref`: an opaque non-secret carried in the link that grants nothing (the six-digit code stays the only secret, still hash-only), whose worst case if leaked is a false "opened". Three `app.auth_*` SECURITY DEFINER functions, following the existing pre-auth write rule rather than inventing a second way in. | **17/17 probes passed inside a transaction that was rolled back — nothing persisted**, confirmed by re-reading the live schema (0 new columns). Refusals proven, each in its own SAVEPOINT: short `trail_ref`, a state with no timestamp, a timestamp with no state, the value `'delivered'`, a duplicate `trail_ref`. Behaviour proven: two rows may both have no `trail_ref`; the first open stamps and the second is ignored **with the time unchanged**; an unknown, consumed or expired token stamps nothing; revoke works once and **refuses a completed reset**; the migration is re-runnable. ⚠️ First probe run reported two false failures — one expected refusal aborts the whole transaction, so every later probe was meaningless. Re-run with SAVEPOINTs. **Then applied for real** (`node scripts/migrate.mjs lib/db/migrations/022_reset_status_trail.sql` — note the path, a bare filename is not found) and re-verified against the live schema: 6 nullable columns, 3 constraints, 3 `app.auth_*` functions, the partial unique index, and **0 existing rows touched**. `types/database.ts` updated by hand for the `invitations` block only: the generator's full output differs from the committed file by **990 lines** of unrelated drift, so a wholesale replace would have buried this change in churn that is not ours. |
| 4.1b | **The forced reset now actually sends, plus the trail, Resend and Revoke** | 🔨 **UNFINISHED — see §4** | The substance is written and typechecks except for one prop-threading edit. **What it fixes:** `forceResetAction` revoked sessions and then told the Admin to *"send them to Forgot your password?"* — it sent **no email at all**, so there was nothing for a status to be about. It now issues a scoped `password_reset` token and emails it. Forcing and Resend share one `issueReset()` so a resend cannot drift into a near-copy; FR-155 already invalidates the previous code, so resending **is** re-issuing rather than a second live code. `created_by_id` is what distinguishes a forced reset from a self-service one in the trail — nobody provisions their own. **Honesty decisions, per the owner's answer:** no webhook, so the panel never says "delivered" — it says *accepted by the mail provider*, and when `email_sandbox` is true it says outright that it **was not delivered and will not arrive**, because the sandbox sender takes mail for anybody with a 200 and drops all but the Resend account's own address. `/reset-password?…&t=<trail_ref>` stamps `link_opened_at` and **deliberately ignores the result**, so the page renders identically for a live, dead or fabricated token — otherwise that route becomes the code-enumeration oracle its own header comment exists to prevent. **A design change made late and worth keeping:** the panel first fetched its trail from the client, which needed an effect that could not satisfy `react-hooks/set-state-in-effect` (the rule is right — the fetch was avoidable). It is now presentational and the data comes down with the page via `getForcedResetTrails`, one `distinct on (user_id)` query for the whole team. That removed the loading state, the error state and the effect. | `tsc` and `eslint` were clean for every file **before** the switch to server-supplied data; the one remaining error is the unfinished threading, not a defect in the logic. ⚠️ **Nothing here has been exercised in a browser or against the suites yet** — no reset has been forced, sent, opened or completed end to end. Treat the whole step as unverified. |
| ⚠️ | **The purge is a cleanup, NOT a fix — it came back within minutes** | 🔴 owner decision | The integration run used to VERIFY the purge immediately created **5 more**, all stamped 09:44. So it is ~5 per `npm run test:auth`, and 115 was roughly 23 runs. Migration 021 is idempotent and was re-run to clear them (0 again). Options for stopping it: **(a)** point the integration suite at a separate Supabase project — clean, biggest setup; **(b)** have the suite break-glass-delete its own fixtures in `afterAll` — cheap and permanent, but writes 5 CRITICAL security events per run into the Super Admin's alert feed, whose entire value is being signal; **(c)** leave it and re-run 021 occasionally. Not chosen. | 5 fixtures created at 09:44 by one test run |

### Batch 3 — Forms

| # | Step | State | What changed | Proof |
|:--:|---|:--:|---|---|
| — | *batch started* | — | Found: `projects.type_fields` is **already `jsonb`**, so the migration predicted for per-type fields is **not needed**. But `tasks.start_date` / `due_date` are **`date`** columns, so adding a time **does** need one. | schema read |
| 3.1a | **Migration 020** — `start_time` / `due_time` on `tasks`, `start_time` / `target_end_time` on `projects` | ✅ | Times are **additive `time` columns**, not a `date` → `timestamptz` change. Changing the type would have re-interpreted the partial index on `due_date`, both `dates_ordered` constraints, the whole UTC-calendar recurrence engine (already bitten once in Step 6), the calendar's day grouping and ADR-004's Mon–Sat workload window. `time` not `timetz`: one division, one timezone, so a wall-clock time is what is meant. New `tasks_times_ordered` / `projects_times_ordered` constraints cover the case dates cannot — same day, 17:00 → 09:00. | Applied. Probed in rolled-back transactions: same-day 09:00→17:00 **accepted**, same-day 17:00→09:00 **refused by `tasks_times_ordered`**, across-days 17:00→09:00 **accepted**, no times **accepted** |
| 3.1b | Times read and written end to end for **tasks** | ✅ | `TASK_SELECT` reads `start_time` / `due_time`; `toTask` maps them via a new `timeOnly()` (Postgres `time` arrives as `HH:MM:SS`, forms want `HH:MM`); `TaskRow` **requires** both, so `tsc` enforces the mapping; create and update persist them. Form gained **Start time** / **Due time** as `type="time"` — the browser's own picker, so AM/PM appears for a 12-hour locale without hard-coding either, while always posting 24-hour `HH:MM`. **Start pre-filled with now, due left empty**: a guessed deadline nobody chose looks like a commitment and drives the overdue count. Built from LOCAL date parts, not `toISOString()`, which returns UTC and hands back tomorrow east of Greenwich late in the evening. | Browser: create form pre-filled `2026-08-09` / `20:01`, due empty. Saved start 09:15 / due 17:30 → database held `09:15:00` / `17:30:00`. ⚠️ **Read-back into the EDIT form was not confirmed by eye** — the automation could not hold the nested dialog open. Covered by the SELECT, the required `TaskRow` fields and `tsc`, not by sight. Test task removed. |
| 3.1c | Same date+time treatment on the **project** form | ✅ | `ProjectRow` gained `startTime` / `targetEndTime`; `CreateProjectInput` and `UpdateProjectInput` carry them; insert and update persist them; the action reads both from the form. Form gained **Start time** and **Target end time**, start pre-filled with now and end left empty, matching the task form exactly. ⚠️ Caught while editing: the insert's column list had gained two columns while the VALUES list had not — Postgres would have rejected it at runtime, and `tsc` cannot see inside a tagged template. Fixed before it ran. | `tsc`, `eslint`, 958 unit tests and `next build` all clean. Not yet exercised in the browser — that happens with 3.2, which rebuilds the same form. |
| 3.2 | **The project form changes by type** | ✅ | **Scale moved to every type** (`SHARED_TYPE_FIELDS`) — it was event-only, so a client retainer had no size recorded and nothing could compare them. Event gained a **duration toggle**: *One day* shows **Date / Starts at / Ends at** and submits the end date as the start date (one possible answer is not a question), *Several days* shows all four. `event_date` removed — it duplicated the real `start_date` column that the calendar and every report already read. Added: expected attendance · contract end · engagement as a **Retainer/One-off dropdown** (was free text placeholder'd "retainer or project") · internal sponsor. Existing client contact fields **kept** — the confirmed spec was a list to add, not a list to reduce to, and dropping `contact_email` would have been a regression nobody asked for. | Browser: Client shows 18 fields, Event 12, **Scale on both**. Toggle flips *Date/Starts at/Ends at* ↔ *Start date/Start time/Target end date/Target end time*. Saved a one-day event → `start 2026-09-12 09:00`, `end 2026-09-12 17:00`, `type_fields` held venue, duration, scale **and attendance**. Test project removed. |
| 3.2a | 🐛 **The server allow-list silently dropped the new fields** | ✅ | `TYPE_FIELDS` in `app/actions/projects.ts` is a deliberate allow-list so a crafted POST cannot stuff the `type_fields` jsonb. New form fields not added to it **render, accept input and vanish on save**. Caught by checking the saved row rather than trusting the form closing: `expected_attendance` and `duration` were missing. Both lists now carry a warning that they must change together. | First save came back without `expected_attendance`; after the fix, present. |
| 3.2b | 🐛 **Every dialog closed when a button was activated by keyboard** | ✅ | Found while testing the duration toggle: a programmatic `.click()` closed the whole form. The backdrop test hit-tested `clientX/clientY` against the panel — and a button activated with **Space or Enter fires a click at (0, 0)**, which is outside every panel. So **every keyboard user closed any dialog the moment they used any control inside it.** `event.target === dialog` alone would have fixed that and reintroduced the bug the original author had already hit (a native `<select>` option list reports the dialog as its target). Now requires **both halves of the gesture** — pointerdown *and* click on the dialog itself — which no keyboard activation and no select popup can satisfy. Dead `panelRef` removed. | Browser: the toggle click that previously closed the form now leaves it open, and a `<select>` type change does not close it either. |
| 3.z | ⚠️ **Operational lesson: never run `test:auth` twice at once** | ✅ | A run reported **10 failed / 131 passed** and took over 600s instead of ~240s. Not a regression: a second suite was started while the first was still settling, and they share one database. `vitest.integration.mts` says exactly this — *"these share one database, and two suites creating fixtures concurrently would interfere"* — and `fileParallelism: false` only guards within a single process, not against two. A clean single run: **141 passed**. Nearly closed the batch on the bad number; always read the count, never the duration line. | 141/141 on a clean run |

---

## 3. 📌 HOW TO RESUME IF A SESSION DIES

1. Read §1 above — it names the exact next action.
2. Read the last few rows of §2 for what was just finished and how it was proved.
3. `git log --oneline -5` — every step is committed as it lands, so the tree and
   this file agree.
4. Continue from **⏭️ NEXT ACTION**. Do not restart the batch.

---

## 4. 🔧 HANDOVER — FINISHING STEP 4.1b EXACTLY

> Written 2026-08-10 because the owner is moving to a new account mid-step. This
> section is the only thing a new session needs in order to finish 4.1b. Delete
> it once the step is committed and verified.

### 4.1 · Why the tree does not compile

`components/team/reset-trail-dialog.tsx` was changed from *fetches its own data*
to *receives it*, so its props are now:

```ts
{ open, onClose, person, trail, onChanged }
```

`components/team/person-actions.tsx:391` still renders it with the first three.
That is the whole error. **Three edits close it, and they were the tool call the
owner interrupted — nothing else was in flight.**

### 4.2 · The three edits, in order

**a. `app/(app)/team/page.tsx`** — load the trails and pass them down. Only for a
viewer allowed to see them: a reset trail says when an account was locked out of
itself and where the link went, which is not general team information. `people`
and `canProvision` are already in scope there.

```ts
import { getForcedResetTrails } from '@/lib/db/queries/auth';

// Alongside the other queries. Admin and above only — a Coordinator or Member
// gets an empty object and the panel simply reports nothing forced.
const resetTrails = canProvision
  ? Object.fromEntries(
      [...(await getForcedResetTrails(user.id))].map(([id, t]) => [
        id,
        {
          id: t.id,
          sentToEmail: t.sentToEmail,
          sentAt: t.createdAt.toISOString(),
          expiresAt: t.expiresAt.toISOString(),
          expired: t.expiresAt.getTime() <= nowMs(),
          openedAt: t.linkOpenedAt?.toISOString() ?? null,
          completedAt: t.consumedAt?.toISOString() ?? null,
          revokedAt: t.invalidatedAt?.toISOString() ?? null,
          attemptCount: t.attemptCount,
          emailState: t.emailState,
          emailDetail: t.emailDetail,
          emailSandbox: t.emailSandbox,
          forcedByName: t.forcedByName,
        },
      ]),
    )
  : {};
```

…then `resetTrails={resetTrails}` on `<TeamWorkspace>`.

⚠️ That mapping duplicates the body of `getResetTrailAction` in
`app/actions/team.ts`. **Do not leave both.** Export the mapper from
`app/actions/team.ts` (or a small `lib/view/reset-trail.ts`) and call it from
both places — two copies of a date-shaping function will drift, and this one
decides whether a link reads as expired.

**b. `components/team/team-workspace.tsx`** — accept and forward:

- destructured prop `resetTrails`, typed
  `resetTrails: Readonly<Record<string, ResetTrailView>>`
  (`import type { ResetTrailView } from '@/app/actions/team';`)
- on the `<PersonActions>` call at ~line 275, add
  `resetTrail={resetTrails[person.id] ?? null}`

**c. `components/team/person-actions.tsx`** — accept and use:

- destructured prop `resetTrail`, typed `resetTrail: ResetTrailView | null`,
  added to the same import block as `TeamActionResult`
- on the `<ResetTrailDialog>` call at ~line 391, add
  `trail={resetTrail}` and `onChanged={() => router.refresh()}`

### 4.3 · Then decide the fate of `getResetTrailAction`

It is exported from `app/actions/team.ts` and, after edit (a), **nothing calls
it**. Either delete it, or keep it and have the page use it. Do not leave an
unused, permission-gated server action exported — an unreferenced action is still
a reachable endpoint.

### 4.4 · Then verify, because none of this has been run

Nothing in 4.1b has touched a browser or a test suite. In order:

1. `npx tsc --noEmit` · `npx eslint .` · `npm run test` (expect **958**)
2. `npm run build`
3. **The end-to-end journey**, which is the only thing that actually proves it.
   Mint a Super Admin session (see §4.6), then on `/team`:
   - force a reset on a **demo** account — never on the Super Admin, and never on
     the owner's own account
   - open **Reset status, resend or revoke**. Expect: *Reset forced* ✅ ·
     *Accepted by Resend — not delivered* with the sandbox caveat (there is still
     no verified sending domain) · *Link not opened yet* · *Waiting for them to
     set a password*
   - read the code out of the database (`select trail_ref from public.invitations
     order by created_at desc limit 1`, and the code itself is **not** stored —
     only its hash, so take the code from the email or re-issue and capture it in
     the action's return path if you need it)
   - open `/reset-password?code=…&t=<trail_ref>` and confirm the panel flips to
     **Link opened** with a time
   - complete the reset and confirm **New password set**
   - separately: press **Resend** and confirm the expiry moves and the old code
     stops working; press **Revoke link** and confirm the row reads
     *Link revoked — no password was set* and that Revoke then refuses
4. `npm run test:auth` — **one run at a time.** Two concurrent runs share one
   database and produce fake failures; read the pass count (**141**), never the
   duration line. It also creates ~5 fixture accounts per run, so re-apply
   migration 021 afterwards if the Team screen fills with `retired-…` rows.
5. `npm run smoke` (27/27)
6. Commit, push, and update §1 and §2 here.

### 4.5 · Things that will bite

- **No `.prettierrc` exists.** Never run `npx prettier --write` — it rewrote ~700
  lines to double quotes once and had to be reverted with `git checkout`.
- Backticks inside double-quoted bash get shell-expanded and mangle doc text. Use
  the Edit tool or a `node - <<'NODE'` heredoc.
- `router.replace()` and `router.refresh()` together leave the URL untouched. One
  or the other.
- `scripts/migrate.mjs` needs the **path**, not the bare filename.
- The dev server on `:4310` in this session was **`next start`** (a production
  build), so source edits need `npm run build` before they appear.

### 4.6 · Verifying in the browser

There is a throwaway session minter in the scratchpad, but it assumes
`<prefix>@cni-demo.com` and the Super Admin is a real address, so mint by **role**
instead. Whatever is minted, use `device_fingerprint = 'visual-check'` and revoke
it afterwards — `sessions_revocation_has_reason` requires `revoked_reason` to be
set in the same statement as `revoked_at`. Three such sessions were revoked at the
end of this session; none are live.

### 4.7 · Do not forget (unchanged, still outstanding)

- **R5 — three secrets were pasted into chat in Session 09 and all still need
  rotating**: the Resend key and the database password (twice). `npm run check:db`
  redacts and is safe to share; the connection string is not.
- `SUPABASE_STORAGE_KEY` may be read **only** in `lib/storage/bucket.ts`
  (ESLint-enforced, with `scripts/check-storage.mjs` the single exemption). The
  avatars bucket was provisioned from a script **outside the repo** rather than
  weakening that rule. Do the same next time.
- **R4 — sales management and workflow automation are NOT to be built.**
