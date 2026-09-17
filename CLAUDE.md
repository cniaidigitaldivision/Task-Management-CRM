# RULE ZERO — THE INTERFACE ANSWERS IMMEDIATELY

Owner, 2026-09-15, after finding that closing a dialog took a second and a half:

> *"I want a fast or very instant UI. I will not compromise on any delay or
> rendering or whatever stuff is there. Make sure that the UI should be instant
> and very fast everywhere, on every page, on everything. This should be the
> first, major, and most important rule that I don't want to repeat again."*

**This rule outranks everything else in this repository.** It applies to every
page, every module, every feature, every fix — existing code you touch and new
code you write. It is not a performance goal to get to later; a screen that does
not obey it is not finished.

## The one sentence

**Every click must change the screen in its own frame. If the answer needs the
network, show the part you already have and let the rest arrive underneath it.**

## The four laws

**1 · Opening and closing anything is free. It never touches the network.**
A drawer, a modal, a menu, a tab, an accordion, a preview. These are client
state. If closing a panel waits on a server, that is a bug, not a slow query.

⚠️ On a dynamic route — any page reading `searchParams` — `router.push()` re-runs
the **entire** server render: every query on the page, not just the one you care
about. Using it to toggle a panel costs the whole page to hide a box that is
already drawn. This shipped here and the owner caught it.

**2 · The URL records what is open. It does not decide when it opens.**
Deep links, refresh and the back button are all worth keeping, and they cost
nothing if the URL is updated *behind* an interface that has already moved:

```tsx
const urlValue = search.get('lead');
const [wish, setWish] = React.useState<string | null | undefined>(undefined);
if (wish !== undefined && wish === urlValue) setWish(undefined); // during render
const open = wish === undefined ? urlValue : wish;

const show = (id: string) => {
  setWish(id);                                    // this frame
  startTransition(() => router.replace(next));    // catches up after
};
```

⚠️ **Plain state here is a back-button bug.** State does not rewind: Back drops
the parameter while the component still believes the panel is open. The URL stays
authoritative; the optimistic value applies only until the URL agrees.

**3 · Never re-fetch what is already on the page.**
Before adding a query, ask what the screen already holds. A list row usually
carries most of what its own detail panel shows — name, status, dates, contact,
the last message. Draw the panel from the row, then fill in only what the row
genuinely could not know.

⚠️ **And be honest about the part that is still coming.** "Loading…" is fine.
"No notes yet" while notes are in flight is a lie somebody will act on.

**4 · Fetch in one wave. Never in a chain.**
`await` A, then B, then C is three round trips for data that had no dependency
between them. If B does not need A's answer, they leave together:

```tsx
const [a, b, c] = await Promise.all([...]);   // one wave
```

⚠️ The id is almost always already in the URL, so a detail fetch does **not**
need to wait for the list. This page cost 2606 ms as three waves and 1412 ms as
one — a 46% saving for deleting two `await`s.

## Law 5 · The query must still be fast when the data is not small

The four laws above are about round trips. This one is about the database, and it
is the only rule here that gets **worse as the business grows** — so it is the one
that fails quietly, months after it was written.

Measured over **659 leads**: a manager counting them took **1,214 ms**. Not a data
problem — the access rule was re-answered for every row. At 200,000 leads that is
roughly **six minutes**. It is now **2.2 ms**.

⚠️ **A `STABLE` function that takes a row's column as an argument is called PER
ROW.** `app.crm_manages_project(project_id)` cannot be hoisted out of the scan.
Write the rule argument-free — compute the set once, test membership per row.

⚠️ **`STABLE` does not mean "evaluated once".** It promises consistency within a
statement; it is not an instruction to cache. Postgres constant-folds `IMMUTABLE`,
not `STABLE`, and a `SECURITY DEFINER` function can never be inlined.

⚠️ **A scalar subquery is what makes it once.** `(select app.fn())` is planned as
an **InitPlan**, computed before the scan and reused as a constant.

⚠️ **NEVER "fix" this by marking a policy helper `IMMUTABLE`.** They read
`app.user_id` from the session, and Postgres would then be free to cache one
person's answer and hand it to another. It is the one change in this area that
can leak another salesperson's leads.

**How to check, in one command:** `explain (analyze, costs off)` and read the
`Filter:` line. A function name in it means per row. `(InitPlan N).col1` means
once.

⚠️ **And any change to a policy is verified EXHAUSTIVELY before it commits** —
every active user, old predicate against new, refusing to commit if one row
moves. Migrations 164 and 165 are the pattern. `docs/20-UI-RESPONSIVENESS.md` §3.5
has the full reasoning.

## When the round trip is unavoidable

Sometimes rows really do have to come from the database. The trip is real; the
**silence** is not.

- `useTransition`, and use its `pending` — dim the table, mark it `aria-busy`.
- Keep the old content visible while the new arrives. Do not blank a screen
  somebody is reading, and do not swap real rows for grey bars.
- A skeleton must match the real thing's frame **to the pixel** — same width,
  padding, and every strip of interface (tab bars included). One that resizes on
  arrival draws the eye to exactly the moment you wanted to hide.

## Layout traps that read as slowness

⚠️ **Never put a fixed overlay inside a `space-y-*` / `divide-*` container.**
Those are `> * + *` sibling selectors and they do not care that the element is
out of the flow. An opening panel becomes child one, the real first child
inherits a margin it never had, and the page shifts and grows a scrollbar the
moment the panel opens. Overlays are not part of the column they cover — render
them outside it.

⚠️ **A hover state is a promise.** If the whole row highlights, the whole row
opens. Guard the controls inside it, do not shrink the target:

```tsx
onClick={(e) => {
  if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="button"]')) return;
  open(row.id);
}}
```

## Before calling any screen done

1. Click every control. Did the screen change in that frame?
2. Open a panel, then press its cross. Was it instant?
3. Count the round trips one click costs. Does the screen need all of them?
4. Open a panel — did the page shift or gain a scrollbar?
5. Press Back. Does the interface match the URL?
6. Is anything showing an empty state for data still in flight?

**Measure, do not assume.** Round-trip latency from Karachi to the pooler is
~101 ms, so a dev laptop exaggerates every chain — but a waterfall and a
navigation-to-close-a-dialog are bugs in production too, where `regions: ["sin1"]`
puts the app beside the database.

The reference implementation is `/my-leads`: `components/crm/use-panel.ts`,
`leadFromRow` in `components/crm/lead-drawer.tsx`, and the single query wave in
`app/(app)/my-leads/page.tsx`. `docs/20-UI-RESPONSIVENESS.md` carries the full
reasoning and the measurements.

---

@AGENTS.md
