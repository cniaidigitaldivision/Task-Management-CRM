# 🎨 REDESIGN & PERFORMANCE PLAN

> Agreed with the owner on **2026-08-07**, after the eight build steps were complete.
> Nothing here changes a feature, a role, a permission or a business rule. It is
> speed, appearance and two small pieces of function that were promised on screen
> and never built.

---

## 📍 STATUS

| | |
|---|---|
| **Phases** | ✅⬜✅⬜⬜⬜✅ 3 of 7 |
| **Current** | Phases 1, 3 and 7 done. Next: 2 (email), 4 (forms), 5 (theme), 6 (sidebar tab) |
| **Rule** | One phase at a time. Plan → implement → verify → commit → **ask before the next one.** |

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

The current treatment is a four-layer gold bloom with a cream core, added in
session 08 to solve a real problem — the logo sat on a white plate with no edge.
It over-corrected. The owner's words: *"it's shouting too much."*

The brand colour stays; it stops announcing itself. Applied identically in the
sidebar, on the login page and anywhere else the mark appears.

---

## 4. 📐 FORMS

**Chosen: two equal columns, full width for long fields.**

- Short fields pair into two columns of **identical** width
- Title, description and anything long spans the full width
- Nothing is ever sized to its content
- Every control on a row shares one height from `components/ui/control.ts`

Applies to: new task, edit task, new project, invite person, profile, settings,
and every dialog.

---

## 5. 🌓 THE THEME TOGGLE

- **Removed** from the topbar and from anywhere else it appears
- **Lives only** in Profile → Appearance
- **`system` is removed.** Light and dark only — a sun and a moon
- Anybody currently set to `system` is resolved to whichever they are actually
  seeing, once, so nobody's screen changes underneath them

---

## 6. ◀ THE SIDEBAR TOGGLE

**Chosen: a half-circle tab on the outer edge**, vertically centred, half
outside the rail, with an arrow that flips direction.

The rail already expands on hover (owner decision D7 — it *pushes* the content,
it does not cover it). This adds a deliberate pin: click to keep it open, click
to keep it shut, and the choice is remembered.

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
| **2** | Super Admin email change | ⬜ |
| **3** | Logo | ✅ |
| **4** | Forms | ⬜ |
| **5** | Theme toggle | ⬜ |
| **6** | Sidebar toggle | ⬜ |
| **7** | Login page | ✅ |

Each phase: implement → typecheck, lint, build, tests, smoke → commit → **stop
and ask**.

---

## 🚫 NOT IN THIS PLAN

- Sales management and workflow automation — standing rule R4, still not wanted
- The Resend sending domain — deliberately deferred by the owner
- Any change to roles, permissions, business rules or the data model
