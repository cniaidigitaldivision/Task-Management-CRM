# 20 · The interface answers immediately

**Status: binding, on every page and every module.** `CLAUDE.md` carries the
short form as Rule Zero; this file carries the reasoning, the measurements and
the patterns. Read this before building a screen, not after somebody complains
about one.

> Owner, 2026-09-15: *"I want a fast or very instant UI. I will not compromise on
> any delay or rendering or whatever stuff is there. Make sure that the UI should
> be instant and very fast everywhere, on every page, on everything… This should
> be the first, major, and most important rule that I don't want to repeat
> again."*

---

## 1 · What went wrong, so it is never argued about again

The owner reported `/my-leads` as slow. The honest diagnosis was not a slow
query — it was that the interface asked a server in Singapore for permission to
draw things it already had.

| Click | Was | Cause |
|---|---|---|
| Cross on a dialog | ~1.4 s | `router.push()` re-ran **every query on the page** |
| Drawer tab | full page render | to switch between five already-loaded panels |
| Add Lead | waited for a navigation | the dialog's data was on the page already |
| Row → drawer | waited for everything | the row already held most of the panel |
| Page render | 2606 ms | three `await` waves with no dependency between them |

Their own words, and they were correct on every count:

> *"This is totally bullshit. It's the UI effect so it's a UI thing. As for the
> payload all the data should be loaded, right? These are just UI clicks to view
> the same data in detail, which is already loaded."*

⚠️ **The lesson is not "optimise queries".** Every query involved was already
fast. The bug was spending a network round trip on a question the browser could
answer by itself.

---

## 2 · The measurements

Taken 2026-09-15 from Karachi against the `ap-southeast-1` pooler, connections
already warm.

| | ms |
|---|---|
| One round trip | **101** |
| One `withUser()` doing nothing | 504 (≈5 trips: BEGIN, set_config, work, COMMIT) |
| `/my-leads?lead=…`, three waves | **2606** |
| the same, one wave | **1412** |
| The list query itself (10 rows) | ~12 kB of JSON |

⚠️ **A dev laptop exaggerates chains, it does not invent them.** `vercel.json`
pins `regions: ["sin1"]` and the pooler is `ap-southeast-1`, so production is
co-located and the absolute numbers collapse. A serial waterfall is still wasted
time there, and a navigation to close a dialog is still a whole server render.

---

## 3 · The patterns

### 3.1 · The optimistic URL

`components/crm/use-panel.ts` is the reference.

```tsx
const urlValue = search.get('lead');
const [wish, setWish] = React.useState<string | null | undefined>(undefined);

// Adjust during render — React's own pattern for deriving from props.
// It re-renders before committing, so nothing flashes and no cascade queues.
if (wish !== undefined && wish === urlValue) setWish(undefined);

const open = wish === undefined ? urlValue : wish;
```

`undefined` means *follow the URL* — which is what Back, Forward and a pasted
link all need. A string or `null` means *the person just asked for this*, and it
applies only until the URL agrees.

⚠️ **Plain `useState` here is a back-button bug**, and it is not theoretical —
it was written, caught and fixed in this repo the same day. State does not
rewind, so Back drops `?lead=` while the component still believes a drawer is
open, leaving a loading shell that nothing ever replaces.

### 3.2 · Draw the panel from the row

`components/crm/lead-drawer-shell.tsx` is the reference.

A list row is nearly always a superset of its own detail header. The lead row
already carried: name, project, city, stage, phone, email, source and detail,
campaign/form, submitted-at, next action, unit, last message, note **count**.

That is the drawer's entire Overview tab except the notes themselves and the raw
form answers. So the panel opens complete, and only those two arrive later.

Rules for the transient state:

- ⚠️ **Same frame to the pixel.** Width, border, padding, and every strip of
  interface — the tab bar included. A bar that appears on arrival shoves the
  content down and draws the eye to the moment you were hiding.
- ⚠️ **No invented counts.** The real tab bar shows `Conversations (4)` once it
  knows. A `(0)` written before the data lands reads as "no messages".
- ⚠️ **Never an empty state for data in flight.** `Loading…`, not `No notes yet`.
  The second is a lie somebody will act on.
- ⚠️ **Compare ids, do not track a boolean.** `record.lead.id === openLead` is
  what stops the previous lead's record being rendered under this one's name.
- ⚠️ **The transient state and the real one must SHARE their controls' state,
  not each keep a copy.** A loading shell and the component that replaces it both
  holding `useState(tab)` is two owners of one fact — and `useState(prop)` reads
  its prop **once, on mount**, so the copies drift and the panel appears to switch
  tabs by itself at the moment of the swap. Lift it to the parent that renders
  both.
- ⚠️ **AND THE SHELL'S CONTROLS MUST WORK.** Inert tabs on a loading panel look
  like a frozen interface: somebody who wants the conversation is made to wait
  for notes they never asked to see. **Which tab is open is the reader's choice,
  not the data's** — record it instantly and show whatever is in hand for that
  tab, which from a list row is more than nothing for every one of them.

### 3.3 · One wave

```tsx
// The id is in the URL. It is known before any query runs, so the detail
// reads leave at the same moment as the list's.
const [projects, rows, counts, record, thread] = await Promise.all([...]);
```

⚠️ **A detail read may be issued before you know the row is visible.** Under
`withUser` the RLS answers exactly as it would have afterwards: a record that is
not theirs comes back empty and is discarded. It costs an empty query on a
mistyped URL and saves a whole wave on every real click.

⚠️ **Pool size is the ceiling on a wave.** `max: 3` in production (`lib/db/client.ts`,
and the reason is in its comment). Nine parallel reads is three waves, not one.
Count them before adding more.

### 3.4 · When the trip is real

The rows genuinely come from the database. The trip stays; the silence goes.

```tsx
const [pending, startTransition] = React.useTransition();
startTransition(() => router.push(next));
```

```tsx
<table className={cn('transition-opacity', pending && 'pointer-events-none opacity-50')}
       aria-busy={pending}>
```

⚠️ **Dim, do not blank.** The rows on screen are still the truthful answer to
the previous question. Swapping them for grey bars trades something readable for
something that is not.

⚠️ **AND `pending` MUST MEAN EXACTLY ONE THING: "the rows on screen are about to
be replaced."** One `useTransition` driving every navigation on a page is the
trap. `/my-leads` had one flag behind seven `startTransition` calls, and the
table dimmed whenever it was true — so **closing a drawer faded the table for a
full round trip**, even though not one row was changing. The owner reported it
as *"the drawer is closed and finished, the table in the background remains in a
fade… after some time it starts showing in a real position."*

Split them by meaning, not by convenience:

- a **data** transition for anything that changes which rows are shown — it
  drives the dim
- a **sync** transition for URL housekeeping after a panel opens or closes —
  nothing hangs off it
- and where a fetch and a navigation happen together, **dim for the fetch, not
  for the navigation** — otherwise the new rows sit on screen greyed out while
  the URL catches up.

---

## 3.5 · ⚠️ THE ACCESS RULE ITSELF, WHICH IS WHERE THE TIME ACTUALLY WENT

Every law above is about round trips. This one is about the database, and it is
the only thing here that gets **worse as the business grows**.

Measured 2026-09-15, execution time only, over **659 leads**:

| | before | after |
|---|---|---|
| salesperson · list of 8 with its laterals | 143.6 ms | **9.5 ms** |
| salesperson · count for the tab chips | 93.9 ms | **1.8 ms** |
| manager · count over everything visible | **1214.7 ms** | **2.2 ms** |

1.2 seconds to count 659 rows is not a data problem. It was the RLS policy being
re-answered for **every row**, and at 200,000 leads the same shape is roughly six
minutes.

**Two causes, and neither is obvious:**

⚠️ **A `STABLE` function that takes a row's column as an argument is called per
row.** `app.crm_manages_project(project_id)` cannot be hoisted out of the scan,
and each call ran its own `exists (select 1 from projects …)`. Rewrite the rule
so the helper is **argument-free** — compute the set of project ids once and test
membership per row (migration 164).

⚠️ **`STABLE` does not mean "evaluated once".** It is a promise about consistency
within a statement, not an instruction to cache — Postgres constant-folds
IMMUTABLE, not STABLE, and a `SECURITY DEFINER` function can never be inlined. So
even argument-free helpers were still called 659 times.

**The fix is a scalar subquery.** `(select app.fn())` is planned as an
**InitPlan** — computed once before the scan and referenced as a constant:

```sql
using (
  (select app.crm_sees_every_lead())
  or (
    project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
    and ((select app.crm_manages_own_department()) or owner_id = (select app.current_user_id()))
  )
)
```

⚠️ **`coalesce(...)` there is load-bearing.** Written as `= any ((select fn()))`
Postgres reads the parentheses as the *subquery* form of ANY and refuses with
`operator does not exist: uuid = uuid[]`.

⚠️ **And never "fix" this by marking a helper IMMUTABLE.** They read `app.user_id`
from the session; Postgres would then be free to cache one person's answer and
hand it to another. That is the single change in this file that could leak a
lead.

**How to check a policy:** `explain (analyze, costs off)` and read the `Filter:`
line. A function name in it means per row. `(InitPlan N).col1` means once.

⚠️ **And verify visibility EXHAUSTIVELY after any such change** — every active
user, old predicate against new policy, before it commits. Migrations 164 and 165
both do; the risk is identical and "it was fine last time" is not evidence.

---

## 4 · Layout traps that are read as slowness

⚠️ **A fixed overlay must not live inside a `space-y-*` or `divide-*` container.**
Those utilities are `> * + *` **sibling** selectors and do not care that the
element is `position: fixed` and out of the flow. The opening panel becomes child
one, the real first child inherits a `1rem` margin it never had, the page shifts
16 px and grows a scrollbar. The owner spotted this within minutes of the fix
that introduced it. Overlays render **outside** the column they cover.

⚠️ **One URL parameter must never mean two things.** `/my-leads` used `?stage=`
as the list's filter *and* as the stage carried into the Record Outcome form. So
choosing "Qualified" for one contacted lead filtered the whole table to
Qualified, the lead being edited vanished from behind the form, and cancelling
left the filter stuck on a stage nobody had asked to filter by. The owner found
it in a minute.

The fix is not a better parameter name. **A transient choice — what a form is
pre-filled with, what a dialog is about — is component state, not a URL
parameter.** It has no business surviving a refresh, and every parameter you add
is one more thing that can collide with a filter.

⚠️ **And cancelling must leave nothing behind.** Not a filter, not a drawer, not
a parameter. Test it: open the thing, press cancel, and compare the screen and
the address bar to before you opened it. They should be identical.

⚠️ **A hover state is a promise.** If the whole row highlights, the whole row is
the target. Guard the controls inside it rather than shrinking the target:

```tsx
onClick={(e) => {
  const el = e.target as HTMLElement;
  if (el.closest('a, button, input, select, textarea, label, [role="button"]')) return;
  open(row.id);
}}
```

Without that guard a self-handling row swallows its own controls: ticking a
checkbox opens the drawer, choosing from a dropdown opens the drawer, and the
name both navigates and opens one.

---

## 5 · The checklist, before any screen is called done

1. Click every control. Did the screen change **in that frame**?
2. Open a panel, then press its cross. Instant?
3. Count the round trips one click costs. Does the screen need them all?
4. Open a panel — did the page shift, or gain a scrollbar?
5. Press **Back**. Does the interface match the URL?
6. Is anything showing an **empty state** for data still in flight?
7. Tab to every control the mouse can reach. Does the keyboard get there too?

---

## 6 · Known remaining work

Recorded honestly rather than left to be rediscovered as a complaint.

**Done 2026-09-15 — law 4 swept across every page.** Waterfalls collapsed on
`/my-leads`, `/leads`, `/leads/[id]`, `/projects/[id]`, `/projects/[id]/report`,
`/lead-reports`, `/lead-overview`, `/workflow`, `/finance`, `/finance/clients/[id]`,
`/tasks`, `/attendance`, `/documents`, `/notifications` and `/profile`. The two
largest: `/projects/[id]` went from four waves to two (nothing in eleven reads
touched the project row), and `/leads/[id]` from seven to three.

**Done — `/finance` payroll.** `Promise.all(months.map(m => payrollMonth(...)))`
was twelve transactions competing over a three-connection pool. `payrollMonths`
is one query using `unnest` cross-joined against the roster. ⚠️ Verified equal to
the twelve-call result **row for row and field for field** before shipping, because
it is payroll: 12 months, identical, and 2.7x faster (1557 ms → 570 ms).

**Done 2026-09-15 — laws 1-3 on the next screens.**

- `/leads` — ⚠️ **table/board was a full server render for identical rows.**
  `view` never reaches SQL; both arrangements are drawn from the same rows,
  already on the page. Now instant, with the URL still recording it so a shared
  link lands on the same view. Filters also gained pending feedback.
- `/tasks` — **already compliant.** View, grouping, every filter and the task
  panel are local state seeded from the URL. Nothing to change.
- `/attendance`, `/workflow` — the reads are genuine (a different date range, a
  chain's nodes), so the trip stays; both now acknowledge the click.

**Still outstanding:**

- **Nobody has clicked through any of these against §5 signed in.** Laws 1-4 have
  been applied by reading the code and measuring the queries; the click-level
  check is still owed on every screen but `/my-leads`.
- `/studio`, `/lead-overview`, `/calendar`, `/documents`, `/projects` — their
  navigations look genuine (each fetches different data) but none has been
  checked for pending feedback.
- **The `/my-leads` drawer still waits on notes and form answers.** Everything
  else draws from the row. Notes are small and could ride the list query.
- **No route in the CRM has a `loading.tsx`**, so dynamic routes get no partial
  prefetch at all (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`).
  ⚠️ A route-level one would blank the list when a drawer opens, so the answer is
  a Suspense boundary around the streamed part, not a whole-page fallback.

Related: `docs/18-DESIGN-SYSTEM-AND-BRANDING.md`, `docs/09-TECH-STACK-AND-ARCHITECTURE.md`.
