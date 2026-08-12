# 🎨 REDESIGN & PERFORMANCE PLAN

> Agreed with the owner on **2026-08-07**, after the eight build steps were complete.
> Nothing here changes a feature, a role, a permission or a business rule. It is
> speed, appearance and two small pieces of function that were promised on screen
> and never built.

---

## 📍 STATUS

| | |
|---|---|
| **Phases 1–7** | ✅✅✅✅✅✅✅ complete |
| **Phase 8** | ✅ Interaction fixes — rail, search, drag-and-drop (Session 17) |
| **Phase 9** | ✅ **CLOSED by the owner 2026-08-12 — leave the supplied task-board HTML exactly as it is.** Nothing to build. See §9. |
| **Rule** | One phase at a time. Plan → implement → verify → commit → **ask before the next one.** |

> ### ⚠️ A gap in this document, recorded rather than quietly fixed
> The owner's words, Session 17: *"The file I have told you to redesign is totally
> not there."* Correct. `CNI-AI-Digital-Task-Board.html` has been in the repository
> root since commit `141669f` and **is referenced nowhere** — not in this plan, not
> in the progress tracker, not in `OWNER-REQUESTS.md`, not in doc 10. Phases 1–7
> were written and executed without it. That is why work the owner was expecting
> did not appear: it was never on the list. §9 puts it on the list.

---

## 1. ⚡ SPEED — *the owner's first priority*

### What is actually wrong

Measured on 2026-08-07, not guessed:

| Measurement | Result |
|---|---|
| One database round trip, dev machine → Supabase | **~100 ms** |
| One `withUser()` query — BEGIN, set role, set user, query, COMMIT | **~470 ms** (5 round trips) |
| Five such queries in sequence | **2 330 ms** |

**The root cause is geography.** `vercel.json` had no `regions` key, so Vercel put
the functions in **`iad1` — Washington DC**. The database is in
**`ap-southeast-1` — Singapore**. Every round trip crosses the Pacific at roughly
250 ms, and a dashboard render makes about sixteen of them. That is the two to
three seconds the owner is seeing, almost to the millisecond.

### The fixes, in order of impact

| # | Fix | Expected |
|:--:|---|---|
| 1 | **Run the functions in Singapore** — `"regions": ["sin1"]`. One line. | Round trips 250 ms → ~5 ms. The dominant win. |
| 2 | **One identity statement, not two.** `withUser` issues two separate `set_config` calls; they can be a single statement. Measured 20% saving. | −1 round trip on *every* query in the system |
| 3 | **One wave of queries per page, not three.** The dashboard awaits a `Promise.all`, then `getSettings()`, then `listPendingExtensions()` — three sequential waits where one would do. | −2 waits per page |
| 4 | **The calendar keeps what it has already loaded** and prefetches the neighbouring months, so paging is instant rather than a server round trip each time. | Month switch → 0 ms after first visit |
| 5 | **Verify prefetching is on** for sidebar navigation, so a page is already warm when clicked. | Perceived instant nav |

### How it will be proved

A `npm run perf` script that times the real signed-in pages before and after and
prints both. No claim of "it feels faster".

---

## 2. 📧 THE SUPER ADMIN EMAIL

**It can be changed.** The immutability trigger in migration 005 blocks exactly
four things on that row: modification by anyone else, self-demotion,
self-deactivation and self-locking. Email is not among them — the Super Admin
editing their own email is already permitted by the database.

What is missing is the screen. The Profile page currently says *"Your email is
your sign-in identity and changing it needs a confirmation to both addresses"*,
which is a promise with nothing behind it.

**Agreed approach — password + authenticator, applied immediately.**

1. Type the new address
2. Confirm with password **and** a 6-digit code (the step-up challenge from Step 5)
3. The change applies at once
4. A security alert goes to the **old** address, so a hijack is visible

Chosen over the link-to-new-address flow because that needs a verified sending
domain, which the owner has deliberately deferred. The alert to the old address
is what keeps this honest in the meantime: somebody who moves the account cannot
do it silently.

Available to **every** role for their own account, not only the Super Admin —
the same rule, the same proof.

**Done.** It lives under Profile → Security, above the three cards that only
report a state, because it is the one thing on that section you can act on.

**The premise was proven, not assumed.** An integration test changes the real
Super Admin's address inside a transaction and rolls it back, then re-reads it on
a fresh connection to prove the rollback took. The trigger permits it; the same
test confirms the trigger still refuses self-deactivation, so "it allowed my
change" cannot quietly mean "the trigger is gone".

### ⚠️ The risk this design leaves, stated plainly

The attacker case is handled. **The typo case is not, and cannot be without the
verification link.** A mistyped address saves cleanly, looks right, and there is
no way back — "forgot password" would send the recovery code to a mailbox that
does not exist. For the Super Admin there is nobody above them, so recovery
means direct database access.

Three things reduce it, and none of them eliminate it:

1. The address is typed **twice**, and pasting into the second field is blocked —
   pasting the first field into the second defeats the entire check.
2. `validateEmailAddress` is **stricter than the database**: the SQL constraint
   accepts `name@example.com,` off a pasted list, which is syntactically valid
   and can never receive mail. The last label of the domain must now be letters.
3. The form says outright what happens if it is wrong, and names who can fix it.

The real fix is the verification link, and it needs the Resend sending domain.
When that arrives this should become: send to the new address, apply on click.

---

## 3. ✨ THE LOGO

**Chosen: a tight halo, barely there.** One layer, low alpha, fading within
about a tenth of the artwork's width. Done.

**And it forced a second change, which is worth recording.** The old glow's
cream core was not decoration — it was the light field that made the supplied
wordmark "AI & DIGITAL" (dark teal) legible against the #071e22 rail. Measured
without it: about 2.3:1. Unreadable.

So the rail now shows the **mark alone** — the polygonal brain, which is teal
*and* gold and reads perfectly on dark — with the division name set as real
HTML beside it, taking its colour from the rail's own tokens.

The crop is measured off the artwork's alpha channel, not estimated. The opaque
pixels fall into three bands: the brain at 0.102–0.657, "AI & DIGITAL" at
0.701–0.816, "DIVISION" at 0.859–0.922. The full artwork is untouched and still
used, as supplied, on the sign-in screen — which is now white.

The brand colour stays; it stops announcing itself.

---

## 4. 📐 FORMS

**Chosen: two equal columns, full width for long fields.**

- Short fields pair into two columns of **identical** width
- Title, description and anything long spans the full width
- Nothing is ever sized to its content
- Every control on a row shares one height from `components/ui/control.ts`

Done. The new-task form was the offender: a `grid-cols-3` row for Priority,
Effort and Status sat directly beneath a `grid-cols-2` row for Project and
Assignee, so the fields below were visibly narrower than the fields above. The
repeat control added a fourth and fifth width with an inline `w-40` select
beside a `w-20` number box.

Everything short now pairs into the same two-column grid and nothing is sized to
its content. The project, invitation and profile forms were already consistent
and were left alone.

---

## 5. 🌓 THE THEME TOGGLE

- **Removed** from the topbar and from anywhere else it appears
- **Lives only** in Profile → Appearance
- **`system` is removed.** Light and dark only — a sun and a moon
- Anybody currently set to `system` is resolved to whichever they are actually
  seeing, once, so nobody's screen changes underneath them

Done. `system` could not simply be deleted: the string still arrives from
`localStorage` on any browser that used the app before today, and from
`users.theme`, whose Postgres enum still carries it and still defaults to it.
The read path now answers `null` for "no explicit choice" — covering a legacy
`system`, a missing key and a corrupted one with the same honest answer — and
`null` follows the device until the person picks one.

The device still decides for somebody who has never chosen. What has gone is
*following the device forever* as a standing choice.

---

## 6. ◀ THE SIDEBAR TOGGLE

**Chosen: a half-circle tab on the outer edge**, vertically centred, half
outside the rail, with an arrow that flips direction.

The rail already expands on hover (owner decision D7 — it *pushes* the content,
it does not cover it). This adds a deliberate pin: click to keep it open, click
to keep it shut, and the choice is remembered across tabs.

Done. The tab lives in the shell rather than inside the rail, because the rail
is `overflow-hidden` and would clip anything sitting half outside it.
`left: var(--rail)` puts its flat edge exactly on the rail's edge and carries it
along at the same 240 ms, whether the rail moved because of a hover or a pin.

---

## 7. 🔑 THE LOGIN PAGE

The owner's words: *"too much green all over."*

| Element | Now | After |
|---|---|---|
| Page background | Teal wash | **White** (and the dark-theme equivalent) |
| Card and form fields | — | Stay neutral — white, grey shading |
| **Sign in / Verify buttons** | — | **Teal green** — the only strong colour on the page |
| Logo | Top | Stays, with the new tight halo |
| "Crescent Nova International" | Plain, small | **Gold gradient, slightly larger** |

---

## ✅ ORDER OF WORK

| Phase | What | State |
|:--:|---|---|
| **1** | Speed | ✅ 7276 ms → 544 ms average in production |
| **2** | Super Admin email change | ✅ Every role, own account. 11 integration tests |
| **3** | Logo | ✅ |
| **4** | Forms | ✅ |
| **5** | Theme toggle | ✅ |
| **6** | Sidebar toggle | ✅ |
| **7** | Login page | ✅ |
| **8** | Interaction fixes — rail, search, drag-and-drop | ✅ except board order (§8.5) |
| **9** | The supplied task-board design | ✅ Closed — owner chose to leave the file untouched, §9 |

Each phase: implement → typecheck, lint, build, tests, smoke → commit → **stop
and ask**.

---

## 8. 🖱️ INTERACTION FIXES — Session 17

Five things the owner asked for in one message. Recorded here because §1–§7 were
about *appearance* and these are about *behaviour* — the plan had no section for
that, which is part of why they were not picked up sooner.

### 8.1 The rail must not open on hover

> *"When I hover on the sidebar it opens by itself. I don't want that
> functionality — I want it to open when I click the small button beside it."*

**This reverses owner decision D6** (Session 09: *"if my cursor is not on it it
should just close, and when I put my cursor on it it should come back"*). D6 is
marked superseded in `OWNER-REQUESTS.md` rather than deleted — the collapsed
resting state it asked for is kept; only the hover trigger is gone.

The tab built for Phase 6 is now the only control. `lg:hover:w-…` is gone from
the rail and `lg:has-[aside:hover]:` from the shell, so width depends on one
thing. **D7 is NOT reversed** — it still pushes the content rather than covering
it. The state is still remembered across tabs.

### 8.2 Two settings icons, and icons off the same axis

> *"Two settings icons — I don't want that. Below the user I can go to the
> profile, I can do the settings… I don't want that there."*
> *"It's a little bit left sided than the original icons — centre it like the
> other icons in the sidebar."*

Both were real. `/settings` appeared **twice**: once in the navigation's System
section and again as "Workspace settings" under the user. Same destination, same
icon, one rail. The duplicate is gone.

The alignment was three different axes in one rail, which only becomes visible
once collapsed — and since 8.1 collapsed is now the resting state:

| | geometry | icon centre |
|---|---|---|
| nav icon | `px-3` container + `pl-3` link + 17px icon | **32.5px** |
| avatar | `p-3` container + `p-2` link + 36px avatar | 38px |
| settings icon | `p-3` container + `px-2` link + 16px icon | 28px |

The footer now uses a nav link's exact geometry with the avatar centred in a 17px
slot. Measured in the browser afterwards: every icon and the avatar report a
centre of **32.5px**.

### 8.3 Dashboard above My Work

> *"The dashboard should be above the My Work option in the sidebar."*

Done, in `nav-config.ts`. Worth knowing: a Team Member has no Dashboard at all
(ADR-003), so their rail still opens on My Work — the order only shows for a
Coordinator and above.

### 8.4 Search happens in the bar, not in a pop-up

> *"If I click the search it should just search there… the cursor should start
> blinking over there… I don't want it to pop up and give another screen, it's
> looking very bad. There should be a small magnifier I can click."*

It was a button dressed as an input that opened a full-screen command palette
over a dimmed backdrop. It is now a real `<input>` in the bar with its results
anchored underneath it. No overlay, no backdrop, nothing moves. The magnifier is
a real button. ⌘K focuses the box instead of opening anything.

The old reasoning — *"it cannot be a real text field: the palette needs to own
the keystrokes, and two boxes is a race for focus"* — was sound and still reached
the wrong answer, because it missed the third option: **one** box, in the bar,
owning its own keystrokes. No overlay, no second input, no race.

Cost, accepted: the dropdown is narrower than a centred palette, so long titles
truncate sooner.

### 8.5 Drag-and-drop that feels physical

> *"It just blurs — I don't want it to blur, I want the task to remain as it is."*
> *"It should fit into the next column, push the other ones down… like a magnet
> is pulling it towards it. I don't want it flickering around, I don't know where
> it is going."*

**Every one of those is impossible with the native HTML5 drag API**, and not
because it was used badly:

- the browser renders its own translucent drag image from a snapshot of the
  element and it cannot be styled — **that is the "blur"**
- `dragover` fires on a coarse timer rather than per frame, so feedback lags the
  pointer — **that is the "flickering"**
- there is no drop *position*, only a drop *target*, so a card can be told which
  column it is going to and never where in it
- none of it is animatable, so cards cannot make room

So the board is now pointer-events based, with three pieces:

1. **The card in your hand** is a fixed-position copy following the pointer at
   full opacity — the real card, lifted, not a ghost of it. `opacity-45` and the
   tilt are gone.
2. **The gap** is a real element in the column at the exact index it will land,
   so the cards below genuinely move out of the way.
3. **FLIP** makes that movement smooth: measure every card before the gap moves,
   measure after, apply the inverse transform, release to zero. Without this the
   cards jump.

On release the floating card animates *to the gap* rather than vanishing here and
reappearing there. That is the magnet.

Also added: horizontal auto-scroll while dragging (eight columns do not fit on a
laptop, and without it a card cannot reach an off-screen column), and a 220ms
hold before a touch drag begins, or the board could never be scrolled by finger.

**A refused column opens no gap at all** — the card will not follow the pointer
into it. Doc 10 §3's "simply won't drop there", made visible rather than merely
enforced. The refusal reason still shows on the column.

#### 8.5a The shivering — three bugs in the first version (Session 18)

> *"Whenever I drag one task to another column the other tasks just start
> flickering… they move up and down up and down… they start shivering."*

The first attempt did exactly that. Three separate causes, all in the same file,
all now recorded in its header so a future refactor does not walk back into them.

| # | Cause | Fix |
|:--:|---|---|
| 1 | **The FLIP effect was keyed on the pointer.** Its dependency array held the whole drag state, which was updated on every `pointermove` — so sixty times a second it re-measured cards that were still mid-transition, slammed `transition: none` on them and re-applied an inverse transform. Every frame restarted the animation from a different place. | Runs only when the gap's column or index actually changes. |
| 2 | **The pointer position was React state.** Every move re-rendered eight columns and thirty cards in order to reposition one absolutely-positioned element. | The floating card is positioned imperatively through a ref. React renders only when the gap moves. |
| 3 | **The insertion index was measured off animating elements.** `getBoundingClientRect()` includes transforms, so while cards slid, the midpoints deciding the index were themselves moving. Two adjacent indices could each be "correct" a frame apart, so the gap flipped between them — which restarted the animation, which moved the midpoints again. A feedback loop. | The index comes from a **settled layout model** built from container geometry and card heights, which no transform can touch. |

**The shared lesson, worth keeping:** never measure something you are animating in
order to decide how to animate it.

**A fourth bug surfaced while proving the fix**, and it is the reason this is
worth writing down rather than summarising. The `ref` prop on each card is an
inline arrow, so it is a new function every render, so React detaches the old one
— calling it with `null` — on every render. The detach handler deleted that
card's FLIP snapshot. React runs ref callbacks during commit, *before*
`useLayoutEffect`, so the snapshot was being wiped in the very commit meant to
consume it: `priorRects` was always empty, and the cards **jumped** instead of
sliding. Detach is now ignored; stale entries are pruned by `isConnected` at
capture time.

##### How it was proven, since "it looks smoother" is not evidence

A `MutationObserver` on every card's `style` attribute, counting writes:

| | Before | After |
|---|---|---|
| 25 pointer moves with the gap **stationary** | a write per card per move | **0 writes** |
| one move that **does** shift the gap (0 → 2) | 0 writes (bug 4 — no animation at all) | **69 writes, 65 with a transform** |
| gap index while sweeping down then back up | oscillated between adjacent values | `0→1→2→3→4` then `4→3→2→1→0`, monotonic over 64 steps |

#### 8.6 The horizontal scrollbar was at the bottom of the board, not the screen

> *"For scrolling towards the left or right the scrollbar is literally at the
> bottom — I don't want to scroll down to the bottom just for moving to the
> right."*

The board is **2,420px wide** (eight 286px columns plus gaps) against about
1,454px of room — roughly **966px of overflow** to travel. And it is as TALL as
its fullest column, so a scroll container's bar, which sits at the bottom of the
CONTAINER, was ~2,100px down the page.

**Chosen: a floating bar pinned to the bottom of the viewport** (option 2 of the
six offered). A second, scrollbar-height scroll container is given a spacer
exactly as wide as the real content, so it gets a bar with identical proportions,
and the two scroll positions are mirrored.

`position: sticky; bottom: 0` does the rest **without measuring anything**: the
bar rides the bottom of the screen while the board's end is below the fold, and
settles into its natural place underneath the board the moment that end scrolls
into view. No scroll listener, no viewport arithmetic, nothing to keep in step
on resize or when the navigation rail animates.

The board's own bar is hidden (`.scrollbar-hidden`, which suppresses the BAR and
nothing else — wheel, shift-wheel, trackpad, keyboard and the drag auto-scroll
all still drive the real element). **There is exactly one bar at any moment**,
which was the owner's stated worry about this approach.

Two things fixed alongside it, both consequences of the same restructure:

- **The legend no longer drifts sideways.** It was inside the scroller, so it
  slid away whenever the board was scrolled. It is a key to the whole board, not
  part of its content.
- The airborne drag card moved out of the scroller too.

##### Two bugs found by testing, both invisible to a build

1. **The first version measured with ResizeObserver's initial callback** — on the
   reasonable belief that observing an element always delivers one. It does,
   *except while the page is not being rendered*: in a background tab the
   resize-observation step never runs, so the bar never appeared at all. Now read
   through `useSyncExternalStore`, matching the theme provider and the rail pin.
   React re-reads the snapshot immediately after subscribing, so the first
   measurement lands whether or not the observer ever fires.
2. **The snapshot has to be a string.** `useSyncExternalStore` compares by
   identity, so returning a fresh `{ scrollWidth, clientWidth }` each call would
   re-render forever.

##### Measured

| | |
|---|---|
| board scroll range vs proxy scroll range | **966 = 966** — the thumb maps one-to-one |
| proxy drives board / board drives proxy | 500 → 500 · 136.8 → 136.8 |
| echo loop from mirroring | **none** — each handler compares before it assigns |
| bar position at page top, mid, and end | 730 / 730 / parked under the board (viewport is 730) |
| drag-and-drop after the restructure | unchanged — 69 style writes when the gap moves, 0 while stationary |

#### ⚠️ Board order is a session preference, not a saved one

There is **no ordering column on `tasks`** — only `checklist_items.sort_order`
exists. So a card dropped at the top of a column stays there until the next
revalidation replaces the list. The *status* change is fully persisted, as
before; the position within the column is not.

Making that survive a reload needs a migration, and migrations do not start
without permission (rule R1). **This is the one thing in §8 that is not
finished.**

---

## 9. ✅ THE SUPPLIED TASK-BOARD DESIGN — CLOSED, leave the file alone

> **Owner decision, 2026-08-12: *"leave the task board html file as it is, don't
> do anything to it."*** Settled and closed. `CNI-AI-Digital-Task-Board.html`
> stays in the repository exactly as supplied — not restyled, not adopted, not
> rebuilt, and nothing in the CRM changes to match it. None of the four options
> below is being taken.
>
> **Consequence, so it is not rediscovered as a bug later:** the palette in that
> file (`--teal-deep:#0F3D3E`, `--gold:#B8912A`, `--paper:#EFF3F2`) does NOT
> match doc 18's tokens and is not meant to. The CRM's palette stays as derived
> from the logo and locked in ADR-011. The file is a reference artefact the owner
> supplied, nothing more.
>
> The rest of this section is kept as the record of what was considered.

### What it was, and the four readings that were open

`CNI-AI-Digital-Task-Board.html` (repo root, commit `141669f`, 26 KB) is a
standalone styled board the owner supplied: *"AI & Digital Division — Task
Board"*. It uses Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono, and its
own palette — `--teal-deep:#0F3D3E`, `--gold:#B8912A`, `--paper:#EFF3F2` — which
is **close to but not the same as** the tokens in doc 18.

**It has never been referenced by any planning document, and no work has been
done against it.** That is the gap named at the top of this file.

It could reasonably have meant any of the following, which is why it was not
guessed at:

1. Restyle the CRM's `/tasks` board to match that HTML's look
2. Adopt its type system and palette across the whole application, revising doc 18
3. Rebuild that page as a real, data-backed screen (it is a static mock-up)
4. Something narrower — a specific element of it the owner liked

**Whichever it is, doc 18 and the token system are the thing it collides with**,
and that is a decision the owner has to make rather than one to be inferred:
the current palette was derived from the logo and locked in ADR-011.

---

## 🚫 NOT IN THIS PLAN

- Sales management and workflow automation — standing rule R4, still not wanted
- The Resend sending domain — deliberately deferred by the owner
- Any change to roles, permissions, business rules or the data model

Phase 2 held to the last of those: no migration, no new permission, no new row
in the doc 03 matrix. The email change is allowed by the trigger that was already
there, scoped by the RLS policy that was already there, and gated by the step-up
challenge built in Step 5. `security_events.event_type` is free text by design
(migration 003), so `email_changed` needed no schema change either.
