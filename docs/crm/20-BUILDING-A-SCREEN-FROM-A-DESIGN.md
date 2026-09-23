# ⭐ Building a screen from one of the owner's designs

> **Owner, 2026-09-22, after a page came back wrong twice:**
> *"If I gave you something as a reference why can't you copy it? … If I'm saying
> that I need the exact same UI, it means you have to put each color, each icon,
> each styling, and everything the same. Why do I have to tell you again and
> again, observing one thing at a time, each and every word? … You have to follow
> it once I gave you some reference."*
>
> This file exists so that does not have to be said a third time. It is the
> method, and the reasoning behind each step is a mistake that was actually made.

---

## 0 · What "the same" means, and what it does not

| The owner means | The owner does not mean |
|---|---|
| The same colours — sampled, not approximated | The same **data**. The mock-up's names, figures and projects are illustrations; the screen shows what the database holds |
| The same type sizes, weights and rhythm | The same **column widths when real content does not fit** — see §5 |
| The same shapes: radii, borders, icon boxes, chips | Inventing a number to fill a card the design has |
| The same layout: what shares a line, what is one row, what has a border | |

So: **layout and styling from the image, content from the schema.** And where
the image and the real data disagree, the data wins and the rhythm is preserved
— that is a judgement to make and mention, not a question to ask.

---

## 1 · Before anything: check what you are looking at

⚠️ **The dev server here silently draws a fallback font.** `next dev` cannot
reach `fonts.googleapis.com` from this machine; `next/font/google` logs a warning
into `.next/dev/logs/next-development.log` and carries on with a size-adjusted
**Arial**, while production fetches at build time and ships Inter. For months,
every judgement about weight and spacing — every screenshot the owner reviewed —
was made on the wrong typeface. That is what *"bold text looks blurred … like it
is blasting"* was.

The three faces are self-hosted now (`app/fonts/*.woff2` + `next/font/local`).

**Check before measuring anything:**

```js
[...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`)
// wants: "inter 100 900 loaded"
```

And remember the second half of the arithmetic: **the app renders at
`zoom: 0.9`**. A 32px control in a 1584px-wide design is `2.2rem` here, not
`2rem`. Divide every reference pixel by 0.9.

---

## 2 · Sample the colours. Do not match them by eye

Read them out of the PNG with Pillow:

- **A fill** is the *most common* pixel of a flat region (`Counter.most_common`).
- **Ink** is the *most saturated* pixel of a glyph, not the darkest average —
  anti-aliasing lightens every edge, so an average reads too pale.

⚠️ **Do not reach for the shared `ink()` / `tint()` helpers for a page that is
meant to look like a specific image.** `ink(tone)` is
`color-mix(in oklab, <hue> 72%, var(--text-primary))` — it mixes 28% of the
page's dark teal into *every* colour. Five different hues come out as five shades
of one, which is exactly why the first Clients page was *"using mostly green
colors"* when the design used five.

**The pattern that works:** a scoped token block in `styles/tokens.css`.

```css
.clients-ui { --cl-ink: #0d1c48; --cl-green: #17794f; /* … ~60 of them */ }
[data-theme='dark'] .clients-ui { --cl-ink: #e8f0fb; /* the same roles, dark */ }
```

The page's root carries the class; nothing outside it can read the tokens, so
**no other screen moves**. Every dark value keeps the same *role* — a tint
behind, a strong hue in front — rather than being a darkened light value.

---

## 3 · Solve the type sizes. Do not guess them

For a string you can see in the reference, measure its ink extent in pixels, then
solve the size against the real font:

```js
ctx.font = `${weight} 100px ${fontFamily}`;
const perPx = ctx.measureText(text).width / 100;
const sizePx = measuredInkWidth / perPx;      // then / 0.9 / 16 for rem
```

Do this for a dozen strings across the page — title, card label, card figure,
tab, table header, row name, secondary line, button. You get the design's whole
type scale in one pass, and it is not a matter of opinion afterwards.

### ⚠️ WIDTH, NOT HEIGHT. Measuring the glyph's height is wrong every time

The Performance page (2026-09-23) was built by measuring **cap heights** — the
number of ink rows a capital letter occupies — and solving the size from those.
Every string came out **20–35% too large**, and the page shipped its first
build with six labels cut off:

| String | Cap-height guess | Solved from ink width | Error |
|---|---|---|---|
| "Performance overview" | 2.29rem | **1.95rem** | +17% |
| "On-time delivery" | 1.18rem | **0.86rem** | +37% |
| "Completed" (table head) | 1.04rem | **0.77rem** | +35% |
| "Taskly AI · Performance insights" | 1.49rem | **1.27rem** | +17% |

Three reasons it cannot work, and they compound:

1. **Anti-aliasing adds rows.** A soft edge above and below every glyph is one to
   two pixels of ink that belong to no letter, on a cap that is only 12 tall.
2. **Ascenders and descenders are invisible in a box.** A crop chosen to hold
   "Designer" also holds the tail of the *g*, so the "cap height" is really the
   full em.
3. **The cap-height ratio is a property of the typeface.** Solving a size from it
   assumes the image was drawn in *this* font at *this* weight. A width
   measured through a canvas in the app's own resolved font assumes nothing.

A width is 60–450 pixels of signal; a height is 10–24. Use the width. The script
that does it is `psolve2.mjs` in the session scratchpad: it loads `/login`
(unauthenticated, but the real compiled stylesheet and the real self-hosted
fonts), waits for `document.fonts.ready`, and solves every string in one pass.

---

## 4 · Find the real geometry

The faint rules in a mock-up are the truth about its grid. Scan for columns of
pixels darker than their neighbours:

> Clients table: the rules landed at x = 262 · 412 · 534 · 616 · 696 · 772 · 840
> · 920 · 1030 → columns of 150 · 122 · 82 · 80 · 76 · 68 · 80 px and 110 px of
> actions. Rows 83px, header 34px.

Do the same for panel strips, card halves and metric boxes. Then write those
numbers into the component as the numbers they are:

```ts
const COLS = 'minmax(0,150fr) minmax(0,122fr) … 7.64rem';
```

⚠️ **`minmax(0, …fr)`, never bare `fr`.** An `fr` track keeps `min-width: auto`,
so one long email widens its own column and cuts the phone number beside it —
which is exactly how one client's number came to be clipped while everybody
else's fitted.

---

## 5 · Then check the design against the real data — because the design lies

A mock-up is drawn around invented content. The Clients reference shows
`faisal@chitralroyal…` — **cut off in the design itself**. Real addresses are
longer: `arsalan@siddiqui-estates.example` needed 169px in a 98px cell.

Owner, on seeing the faithful version: *"make them small enough that a full
quotation value, a full phone number, and a full email should be kept visible …
each value should be displayed properly."*

So the design's widths are a **starting rhythm, not a budget**. Measure what the
longest real string needs, and re-share the width:

```js
// for every clipped element: the size that WOULD fit, and the width it lacks
{ text, px: fontSize, need: el.scrollWidth, have: el.clientWidth,
  fits_at: fontSize * (el.clientWidth / el.scrollWidth) }
```

Then step the type down and move width from the columns that have slack to the
ones that do not. Keep the proportions; change the numbers.

**And the same trap catches FIGURES, not just names.** The Performance reference
writes "18 verified · 6 unverified" under its Completed card. Real totals here
are `5 verified · 131 unverified` — three digits where the design has one, in a
card 199px wide. Restating it as `5 of 136 verified` is the same fact, shorter,
and keeps the design's line. Look at what the longest REAL value is before
copying a caption's wording.

**A column that repeats the same value on every row is not a column.** On a
salesperson's screen every client is theirs, so the Owner column, its filter and
the panel's "Assigned to" are dropped and their width goes to the email. Decide
that from *what is on screen*, not from a role name — then it corrects itself
when a second person's client appears.

---

## 6 · Prove it, on every row

One row fitting is not the page fitting: `PKR 2.1M` fitted in the first row while
`PKR 850K` was cut in the third, because the *panel* was being measured against
whichever client happened to be selected.

The audit that catches it walks the whole list:

```js
for (const el of root.querySelectorAll('*')) {
  if (el.children.length || !el.textContent.trim()) continue;
  const cs = getComputedStyle(el);
  const cut = (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden')
           && el.scrollWidth > el.clientWidth + 1;
  const clamped = cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
}
```

Run it after clicking **every** row, in **both** views, as **both** an admin and
a salesperson (their column counts differ). `nothing-cut.mjs` in the session
scratchpad is the working copy of this.

And look at the result. A screenshot at the same width as the reference, cropped
to the same region, side by side. Numbers say a thing fits; only the picture
says it looks right.

---

## 7 · The things the owner has already had to say once

Do not make them say these again.

| Owner's words | What it means in code |
|---|---|
| *"These are not tabs. I don't want them colorful because they are not clickable"* | A statistic card is white and still; colour lives in its icon. Only tabs look pressable |
| *"They are highlighted and they are underlined"* | A selected tab needs **both** weight/colour and a bar. Set the bar with an inline `borderBottomColor` — a class loses to the global border colour, measured |
| *"The background overlay is not on the whole screen"* | A transformed ancestor traps `position: fixed`. Portal overlays to `document.body` |
| *"It should be instant for everything"* | Rule Zero. Open, close, tab and page-turn touch no network |
| *"It shouldn't bring me to that lead page… it should show the details in a pop-up modal"* | Details open in place. Only a conversation may navigate |
| *"Their designs are just rectangular with curved corners… yours have too many curves"* | Controls ~6px, cards ~8px, chips round. Not the app's usual 12–16px |
| *"Open Related Items has a border color but you have added no border color"* | A secondary button on this page is outlined in the brand teal, not borderless |
| *"There is a WhatsApp button. You are showing just one button"* | Draw every action a row can have; disable with a reason instead of hiding |
| *"Don't show the export option in the import client"* | A menu offers one idea. Import imports; export is its own control |
| *"In the PDF use a proper format, a proper table"* | Reuse the invoice letterhead: the same band, rule, logo and company details |
| *"Add some dummy data so I can view the exact same layout, all the colors, status"* | Ship a seed that covers **every** state the design shows, on the demo project, and prove it cannot message anybody |
| *"I want this performance page UI to be exactly the same as you see in the screenshot"* | The same instruction, on a second page. It is the whole of §§2–6 again — and the fastest way to obey it is to run those steps before showing anything, not after being told |

---

## 8 · The order to work in

1. Read `CLAUDE.md` (Rule Zero) and this file.
2. Check the fonts are real; note the 0.9 zoom.
3. Sample the palette into a scoped token block, light and dark.
4. Solve the type scale from ink widths.
5. Find the grid from the rules in the image.
6. Build it — content from the schema, one query wave, everything client-side
   that can be.
7. Run the clipping audit on every row, in both views, as both roles.
8. Screenshot at the reference's width and compare crops side by side.
9. Update `docs/crm/00-STATE-AND-TRACKER.md` with what was measured, not just
   what was done.
