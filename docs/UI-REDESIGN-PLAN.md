# 🎨 UI REDESIGN — from the reference folder

> Agreed with the owner on **2026-08-13**, after studying every file in
> `crm model options ui/` — seven images and two videos, frame by frame.
>
> **The owner's constraint, verbatim:** *"Do not apply those colors and those
> color schemes in those pictures. I want our color scheme and our things to be
> applied here but I want the texture look to be like that."*
>
> So: **teal and gold stay.** Every reference is purple; none of that purple
> arrives. What is adopted is structure, texture, motion and interaction.

---

## 1. WHAT IS ACTUALLY IN THE REFERENCES

| File | What it is | Adopted |
|---|---|---|
| `41a9dac…` | Dark component-library sheet | Card radii, gradient primary, badge / alert / stepper shapes |
| `9d5a6f36…` | Learning dashboard | **Three-column layout with a right rail**, KPI cards with icon tiles, chart tooltip pinned to a point, rail holding calendar + ring + agenda |
| `a3c007ad…` | Meetings calendar | **Day cells tinted to match their event's colour**, filled primary pill + outline pills for the rest, floating icon rail |
| `a63e5a45…` | Workflow editor | Grouped sidebar with coloured section icons, breadcrumb header, dot-grid canvas |
| `c70ffbdd…` | Security dashboard | **The cursor interaction** (below), gauge arc with a knob, donut with a legend, per-panel period pills |
| `e1708895…` | Calendar + agenda | Today as a filled circle, right-rail agenda cards |
| `e9039663…` | Task calendar | **KPI card with an inline sparkline**, weekday+number day labels, chip stacking with a `+n` overflow |

### The two videos

**`video_2c062efdf8af`** — the theme switch, and it is **not a fade**. A circular
mask expands from the toggle button itself, sweeping diagonally with a soft curved
edge; the light theme is already fully rendered behind it. That is
`document.startViewTransition()` with an animated `clip-path: circle()`.

Comparing its frames also shows a **staggered load-in**: elements arrive in
sequence, numbers count up from zero, rings and bars fill. Percentages keep
changing after load — genuinely live.

**`video_3bf300fd145b`** — the login card's border. Two arcs, cyan and magenta,
orbiting the perimeter 180° apart, continuously: a rotating conic gradient masked
to the border. Inputs are underline-only with a leading icon. The video ends on its
own CSS (`text-shadow: 0 0 10px …`), so it is a tutorial — the technique is
confirmed rather than inferred.

---

## 2. THE OWNER'S DECISIONS

| | |
|---|---|
| **Charts** | Hand-built SVG. **No new dependency** — 400-odd lines, exact control, our tokens natively. Recharts was declined at ~500 KB after we were careful about one 3.6 MB library |
| **Skeletons** | **Every page**, mirroring its own layout — a `loading.tsx` per route whose shape matches what arrives, so nothing shifts |
| **Live data** | All of it: numbers animating up, auto-refresh, interaction polish — and **Realtime push last, as its own step** |
| **Glass** | **Sparingly.** Chrome only: top bar, dialogs, dropdowns, timer bar. Data panels stay solid so text keeps contrast |
| **Sequence** | **Foundation first**, then pages. Nothing looks different until step 5, then everything changes together |
| **Themes** | **Both equally**, dark tuned first because the textures only read properly there |
| **Texture** | **Rich but disciplined.** Grain on large surfaces, glows behind headers, dot-grid on empty states — never behind a table or dense text |

---

## 3. THE STEPS

Each one is committed and verified in a browser before the next begins. That is
the owner's instruction: *"I don't want errors and broken stuff built."*

| # | Step | State |
|:--:|---|:--:|
| 1 | **Texture and motion tokens** — glass, grain, glow, dot-grid, elevation, the motion scale, and the view-transition keyframes | ⬜ |
| 2 | **Skeletons** — a `Skeleton` primitive plus a `loading.tsx` for every route, each mirroring its real layout | ⬜ |
| 3 | **The chart kit** — line/area with cursor tracking, donut with legend, gauge arc with knob, sparkline. Hand-built SVG | ⬜ |
| 4 | **Motion** — the circular theme wipe, staggered reveals, counting numbers, and the login border | ⬜ |
| 5 | **Dashboard** — three columns, KPI cards with sparklines, live charts, right rail | ⬜ |
| 6 | **Calendar** — tinted day cells, filled/outline event pills, agenda rail | ⬜ |
| 7 | **Tasks, Projects, Team** — the same card, chip and table language | ⬜ |
| 8 | **Settings, Security, Documents, Vault, Reports** | ⬜ |
| 9 | **Login** — orbiting border, underline inputs, glass card | ⬜ |
| 10 | **Realtime push** — Supabase subscriptions, last and on its own | ⬜ |

---

## 4. RULES THIS REDESIGN MUST NOT BREAK

Every one of these is already load-bearing somewhere in the codebase.

- **BR-025 — no raw hex.** ESLint enforces it. Every new colour is a token in
  `styles/tokens.css`, including the ones invented for texture.
- **The rail is theme-invariant** (owner decision, Session 08). Its `--sidebar-*`
  tokens sit outside both theme blocks and stay that way.
- **`prefers-reduced-motion`** must disable the wipe, the counting and the
  staggered reveals. An animation somebody cannot turn off is an accessibility
  fault, not a feature.
- **FR-213 — never transition layout properties** on theme swap. Colour only, or
  the page visibly shifts.
- **Contrast is not negotiable.** Gold fails on white (2.1:1) — `--text-gold` is
  `gold-800` for that reason. Glass must not drop text below AA.
- **`components/ui/control.ts`** owns control heights. Nothing sets its own.
- **No layout thrash on hover.** Transform and opacity, not width and margin.

---

## 5. WHAT IS DELIBERATELY NOT COPIED

- **The purple.** Owner instruction. Teal and gold throughout.
- **The saturated per-event rainbow** in the calendar references. Our status
  tokens already carry meaning — recolouring events by hue for decoration would
  destroy the one thing the colour currently tells you.
- **The node-graph canvas** from the workflow editor. Nothing in this CRM is a
  node graph, and R4 rules out workflow automation.
- **Illustrated mascots and 3D planets.** They belong to those products' brands,
  not to a division's internal CRM.
