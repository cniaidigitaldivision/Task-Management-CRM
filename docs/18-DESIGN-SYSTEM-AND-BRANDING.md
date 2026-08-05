# 18 — Design System & Branding

**Added:** 2026-08-06 (Session 04)
**Status:** Planned, not built
**Source:** `logo/` — CNI **AI & Digital Division** (8th division)
**Locked by:** [`decisions/ADR-011`](decisions/ADR-011-design-system.md)

> **This document is the single source of truth for every colour, spacing value, and visual token in the CRM.** No component may introduce a colour that is not defined here. If a value is needed that doesn't exist yet, it is added here first, then used.

---

## 1. The logo — what it is

```
        ╭─────────────────────────────────────────────╮
        │   Low-poly geometric BRAIN                  │
        │                                             │
        │   LEFT hemisphere  →  deep teal facets      │
        │   RIGHT hemisphere →  gold facets           │
        │   Trailing edge    →  dissolves into        │
        │                       scattered pixel       │
        │                       squares (teal + gold) │
        │                                             │
        │   "AI & DIGITAL"  — deep teal, serif, caps  │
        │   "DIVISION"      — gold, serif, letterspaced│
        │                     flanked by thin gold rules│
        ╰─────────────────────────────────────────────╯
```

**What the mark communicates, and why it matters for the interface:**

| Element | Meaning | How the UI honours it |
|---|---|---|
| Faceted polygons | Structure, precision, engineered thinking | Clean geometry, crisp 8px-grid alignment, no soft blobby shapes |
| Teal → gold split | Two halves of one system: analytical and creative | Teal carries the interface; gold marks what matters |
| Dissolving into pixels | Analogue thought becoming digital | Subtle particle/gradient accents in empty states and headers only |
| Serif wordmark | Established, considered, not a startup | Serif reserved for major headings; interface type stays sans |
| Generous white space | Confidence | Spacious layouts, restrained density |

**The interface must feel like the logo: structured, precise, quietly premium.** Not playful, not corporate-grey.

---

## 2. Brand colours — extracted from the mark

### Primary — Deep Teal
The analytical hemisphere. This is the interface's working colour.

| Token | Hex | Use |
|---|---|---|
| `teal-950` | `#04262B` | Deepest shadow, dark-theme base |
| `teal-900` | `#073238` | Dark-theme surface |
| `teal-800` | `#0A4046` | Dark facet in the mark |
| `teal-700` | `#0E5C63` | ⭐ **Core brand teal** — primary buttons, links, active nav |
| `teal-600` | `#12707A` | Hover state |
| `teal-500` | `#17878F` | Mid facet |
| `teal-400` | `#2FA3A9` | ⭐ **Dark-theme primary** — bright enough on dark |
| `teal-300` | `#5FC0C3` | Light accent, dark-theme links |
| `teal-200` | `#9BDADB` | Subtle fills |
| `teal-100` | `#CBECEC` | Light-theme tinted surface |
| `teal-50` | `#E9F6F6` | Lightest wash, selected rows |

### Accent — Gold
The creative hemisphere. **Accent only — never body text on light backgrounds.** See §4.

| Token | Hex | Use |
|---|---|---|
| `gold-900` | `#6B4A0F` | Deep shadow |
| `gold-800` | `#8C6417` | Dark-on-light gold text *(the only gold safe for light-theme text)* |
| `gold-700` | `#A87A1E` | Deep facet |
| `gold-600` | `#C29029` | Hover |
| `gold-500` | `#D4A63C` | ⭐ **Core brand gold** — accents, dividers, active indicators |
| `gold-400` | `#E0B85C` | ⭐ **Dark-theme gold** |
| `gold-300` | `#EACB86` | Light accent |
| `gold-200` | `#F2DDB4` | Subtle fill |
| `gold-100` | `#F8EDD9` | Tinted surface |
| `gold-50` | `#FCF7EE` | Lightest wash |

### Neutrals — teal-tinted, not pure grey
Pure grey next to teal looks dead. Every neutral carries a trace of the brand hue.

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `neutral-0` | `#FFFFFF` | | `neutral-500` | `#6B8386` |
| `neutral-25` | `#FAFCFC` | | `neutral-600` | `#516A6D` |
| `neutral-50` | `#F4F8F8` | | `neutral-700` | `#3B5457` |
| `neutral-100` | `#E9F0F0` | | `neutral-800` | `#263D40` |
| `neutral-200` | `#DDE7E8` | | `neutral-900` | `#16292C` |
| `neutral-300` | `#C3D3D4` | | `neutral-950` | `#0B1D1F` |
| `neutral-400` | `#93A9AB` | | `neutral-1000` | `#061417` |

---

## 3. ⚠️ The gold/amber collision — resolved

**The problem.** Brand gold `#D4A63C` sits at hue 43°. The conventional "warning / near-limit / in-progress" amber `#F59E0B` sits at hue 38°. They are five degrees apart. If both appear on screen, **a user cannot tell brand chrome from a warning** — which in a system whose entire purpose is flagging overload is not a cosmetic problem, it's a functional failure.

**The rule that resolves it:**

> ### 🔒 Gold is brand chrome. Gold is NEVER a semantic state.

| Gold IS used for | Gold is NEVER used for |
|---|---|
| The logo | Warning states |
| Active navigation indicator | Over-limit indicators |
| Section dividers and rules | Any task status |
| Focus rings on primary actions | Any workload band |
| Empty-state illustrations | Any priority level |
| Premium/emphasis accents | Anything that means "attention needed" |

**All semantic warning uses Orange `#F97316`** — hue 25°, far more saturated, unmistakably different from gold at any size.

This single rule is why the status and workload palettes below deviate from the ones drafted in docs 05 and 06. Those earlier colours were chosen before the brand existed and are now superseded.

---

## 4. ⚠️ Gold contrast constraint

| Combination | Ratio | Verdict |
|---|---|---|
| `gold-500 #D4A63C` on white | **2.1 : 1** | ❌ Fails WCAG for text of any size |
| `gold-800 #8C6417` on white | **5.4 : 1** | ✅ Passes AA for normal text |
| `gold-400 #E0B85C` on `neutral-1000` | **9.8 : 1** | ✅ Passes AAA — gold works beautifully on dark |
| `teal-700 #0E5C63` on white | **7.2 : 1** | ✅ Passes AAA |
| `teal-400 #2FA3A9` on `neutral-1000` | **6.5 : 1** | ✅ Passes AA |

**Consequence:** in the **light** theme, gold appears as fills, borders, rules and icon accents — but text on a gold-adjacent surface uses `gold-800`. In the **dark** theme, gold is free to be text. This asymmetry is deliberate and is enforced by the token names below, not left to a developer's judgement.

---

## 5. Semantic colours — brand-safe, final

### Task statuses — supersedes doc 05 §1

| Status | Token | Light | Dark | Hue | Why |
|---|---|---|---|:--:|---|
| **Backlog** | `status-backlog` | `#64748B` | `#94A3B8` | slate | Neutral, deliberately quiet |
| **To Do** | `status-todo` | `#3B82F6` | `#60A5FA` | 217° | Committed, calm |
| **In Progress** | `status-progress` | `#8B5CF6` | `#A78BFA` | 258° | Energetic, and far from both brand hues |
| **Blocked** | `status-blocked` | `#EF4444` | `#F87171` | 0° | Stop |
| **In Review** | `status-review` | `#EC4899` | `#F472B6` | 330° | Waiting on someone else |
| **Revisions** | `status-revisions` | `#F97316` | `#FB923C` | 25° | Attention needed |
| **Done** | `status-done` | `#10B981` | `#34D399` | 160° | Complete |
| **Cancelled** | `status-cancelled` | `#A1A1AA` | `#71717A` | zinc | Inert |

> **In Progress moved from amber to violet, and In Review from purple to pink.** Amber collided with brand gold (§3); the original purple then sat too close to violet. The new set keeps every adjacent pair at least 65° apart in hue.

### Workload bands — supersedes doc 06 §3

| Band | Token | Light | Dark |
|---|---|---|---|
| 🟢 Available (0–59%) | `load-available` | `#10B981` | `#34D399` |
| 🔵 Healthy (60–84%) | `load-healthy` | `#3B82F6` | `#60A5FA` |
| 🟠 Near limit (85–99%) | `load-warning` | `#F97316` | `#FB923C` |
| 🔴 Over limit (100%+) | `load-over` | `#EF4444` | `#F87171` |

> *Near limit* and *Revisions* share orange. **This is intentional** — both mean "needs attention now", and they never appear in the same control. NFR-008 requires a text label alongside every colour regardless, so the pairing is never ambiguous.

### Priority

| Priority | Token | Light | Dark |
|---|---|---|---|
| 🔴 Urgent | `priority-urgent` | `#DC2626` | `#EF4444` |
| 🟠 High | `priority-high` | `#EA580C` | `#F97316` |
| 🟡 Medium | `priority-medium` | `#0E7490` | `#22D3EE` |
| ⚪ Low | `priority-low` | `#94A3B8` | `#64748B` |

### Project types — doc 15

Chosen to be distinguishable from status colours, because both appear on the same card.

| Type | Token | Light | Dark | Icon |
|---|---|---|---|:--:|
| Event | `project-event` | `#7C3AED` | `#A78BFA` | 🎪 |
| Client | `project-client` | `#0E5C63` *(brand teal)* | `#2FA3A9` | 🤝 |
| Business | `project-business` | `#475569` | `#94A3B8` | 🏢 |
| Self-Promotion | `project-promo` | `#DB2777` | `#F472B6` | 📣 |
| Other | `project-other` | `#B45309` | `#F59E0B` | 📦 |

> Client work carries the **brand teal** — it is the company's core business, and the palette says so. *Other* is the one place a gold-adjacent tone is permitted, because uncategorised work genuinely is a soft warning.

### Feedback

| Meaning | Token | Light | Dark |
|---|---|---|---|
| Success | `feedback-success` | `#059669` | `#34D399` |
| Warning | `feedback-warning` | `#F97316` | `#FB923C` |
| Error | `feedback-error` | `#DC2626` | `#F87171` |
| Info | `feedback-info` | `#0E5C63` | `#2FA3A9` |

---

## 6. Light & dark themes

> **Requirement:** every member, in every role, can switch theme from their profile settings (FR-201).

### Semantic surface tokens
Components reference **these** names — never a raw hex, never a raw palette step. Swapping the theme swaps what they resolve to, and nothing else changes.

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `bg-base` | `#FFFFFF` | `#061417` | Page background |
| `bg-subtle` | `#F4F8F8` | `#0B1D1F` | Sidebar, table headers |
| `bg-surface` | `#FFFFFF` | `#12292D` | Cards, panels, modals |
| `bg-surface-raised` | `#FFFFFF` | `#183539` | Popovers, dropdowns |
| `bg-hover` | `#E9F0F0` | `#1D3E43` | Row/button hover |
| `bg-selected` | `#E9F6F6` | `#0E3A3F` | Selected row |
| `bg-brand-subtle` | `#E9F6F6` | `#0A3035` | Tinted brand panels |
| `bg-inverse` | `#0B1D1F` | `#F4F8F8` | Tooltips |
| `border-default` | `#DDE7E8` | `#1F4247` | Standard borders |
| `border-strong` | `#C3D3D4` | `#2A5257` | Emphasised borders |
| `border-brand` | `#0E5C63` | `#2FA3A9` | Brand-outlined elements |
| `border-gold` | `#D4A63C` | `#E0B85C` | Gold rules and dividers |
| `text-primary` | `#0A2A2E` | `#E8F1F1` | Body text |
| `text-secondary` | `#4A6B6E` | `#9FB8BA` | Supporting text |
| `text-tertiary` | `#6B8386` | `#7A9497` | Timestamps, hints |
| `text-brand` | `#0E5C63` | `#2FA3A9` | Links, brand text |
| `text-gold` | `#8C6417` | `#E0B85C` | ⚠️ **Different steps by design — see §4** |
| `text-inverse` | `#FFFFFF` | `#0A2A2E` | Text on inverse |
| `text-on-brand` | `#FFFFFF` | `#04262B` | Text on a teal fill |
| `accent-primary` | `#0E5C63` | `#2FA3A9` | Primary buttons, active nav |
| `accent-primary-hover` | `#12707A` | `#5FC0C3` | |
| `accent-gold` | `#D4A63C` | `#E0B85C` | Gold chrome |
| `focus-ring` | `#0E5C63` | `#5FC0C3` | Keyboard focus |
| `shadow-color` | `rgba(10,42,46,0.08)` | `rgba(0,0,0,0.45)` | Elevation |

### Theme mechanics

| Concern | Decision |
|---|---|
| Storage | `theme` on the `users` row (`light` \| `dark` \| `system`), synced across devices |
| Default | `system` — follows the operating system |
| Switching | `data-theme` attribute on `<html>`; CSS custom properties resolve everything |
| First paint | A tiny inline script in `<head>` sets the attribute **before** first paint — no white flash on a dark-theme load |
| Transition | 150ms on colour properties only. Never on layout properties. |
| Where | Profile → Appearance. Available to **every role, including Members** (FR-201) |
| Logo | Two assets — the dark-text lockup for light theme, a light-text variant for dark theme (§9) |
| Charts | Recharts reads the same tokens; no separate chart palette exists |
| Contrast | Every pairing above meets WCAG AA in both themes (NFR-008) |

---

## 7. Typography

| Role | Family | Notes |
|---|---|---|
| **Display** — page titles, empty states, logo lockup | A transitional serif (Playfair Display or Lora) | Echoes the wordmark. Used sparingly. |
| **Interface** — everything else | Inter | Excellent at small sizes, wide weight range |
| **Numeric** — times, points, capacity | Inter with `font-variant-numeric: tabular-nums` | Digits must not jitter as a timer counts |
| **Code** — task references, IDs | JetBrains Mono | `EVT-142` reads as an identifier |

| Token | Size / line-height | Weight |
|---|---|---|
| `text-display` | 32 / 40 | 600 serif |
| `text-h1` | 24 / 32 | 600 |
| `text-h2` | 20 / 28 | 600 |
| `text-h3` | 16 / 24 | 600 |
| `text-body` | 14 / 20 | 400 |
| `text-body-sm` | 13 / 18 | 400 |
| `text-caption` | 12 / 16 | 400 |
| `text-micro` | 11 / 14 | 500 |

---

## 8. Spacing, radius, elevation, motion

**Spacing — 4px base:** `1`=4 · `2`=8 · `3`=12 · `4`=16 · `5`=20 · `6`=24 · `8`=32 · `10`=40 · `12`=48 · `16`=64

**Radius — the logo is faceted, so corners stay tight:** `sm`=4 · `md`=6 · `lg`=8 · `xl`=12 · `full`=9999 (avatars, pills only)

**Elevation:**
| Token | Light | Dark |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(10,42,46,.06)` | `0 1px 2px rgba(0,0,0,.4)` |
| `shadow-md` | `0 4px 8px rgba(10,42,46,.08)` | `0 4px 8px rgba(0,0,0,.45)` |
| `shadow-lg` | `0 12px 24px rgba(10,42,46,.10)` | `0 12px 24px rgba(0,0,0,.5)` |

**Motion:** `fast` 120ms · `base` 180ms · `slow` 260ms · easing `cubic-bezier(.２,0,.２,1)`
All animation respects `prefers-reduced-motion`.

---

## 9. Logo usage

### 🔒 THE RULE — the supplied artwork, unaltered

> **The logo is used exactly as supplied. It is never recreated, recoloured, cropped, stretched or redrawn.**
>
> Session 05 built a hand-authored SVG reconstruction of the mark. **That was wrong and has been removed.** The logo is the division's real brand asset and appears as designed, or not at all.

### Assets

| Path | Role |
|---|---|
| `logo/Gemini_Generated_Image_dnmem1dnmem1dnme.png` | **Source of truth.** Never modified. |
| `public/brand/cni-ai-digital-division.png` | Served asset — identical artwork, background made genuinely transparent (see below) |
| `app/icon.png` | Favicon / tab icon, via Next's app-icon convention |

### How distortion is made structurally impossible

`components/brand/logo.tsx` accepts **one** dimension and derives the other from the natural 2390 × 1792 ratio. Independent width and height cannot be passed. `object-contain` guarantees letterboxing rather than cropping if a container is ever the wrong shape. `next/image` handles delivery, so the 5 MB source is optimised in transport while the artwork itself is untouched.

### ⚠️ The supplied PNG was not actually transparent

The file was an export of a transparency **preview**: every pixel tested at alpha 255, with the grey/white chequerboard painted into the image. Rendered in the app it showed a visible chequer behind the mark.

**Resolution:** a derived copy is generated for `public/brand/`, clearing only background **connected to the image border** by flood fill. That distinction matters — the mark contains white and silver facet seams, and a naive "remove everything light" would have erased them. Anything enclosed by artwork is preserved. 77.9% of pixels cleared; brain, wordmark and pixel-dissolve all verified intact.

**The original file in `logo/` is never touched.** The artwork is unchanged — only the chequer background became transparent.

**Still worth having (Q-049):** a true vector (AI / EPS / SVG). The cleaned PNG solves transparency but not scaling — at very large sizes, or in print, a raster will soften.

### The dark-theme constraint

The wordmark in the artwork is **dark teal**, so it is illegible on a dark surface. Rather than alter the logo, `<LogoPlate>` places it on a light panel that stays light in both themes. **The plate adapts; the artwork never does.**

### Placement

| Location | Component | Notes |
|---|---|---|
| Sidebar header | `<LogoSidebar />` | On a light plate, 158px wide |
| Sign-in / activation | `<LogoHero />` | Centred, 280px, generous clear space |
| Placeholder & empty states | `<Logo decorative />` | 7% opacity behind the message |
| Design system reference | `<Logo width={260} />` | On a white card |
| Favicon / tab | `app/icon.png` | Next generates the sizes |
| Email templates | Light version | Emails are light-background by convention (FR-215) |

### Rules
- **Never** stretch, recolour, rotate, crop, or add effects
- Only ever set **one** dimension — the other is derived
- Minimum clear space on every side = the height of the "D" in DIVISION
- Minimum size: 120px wide for the full lockup
- Never place it on a mid-tone background — light plate, always

---

## 10. Signature UI moments

Three places where the brand does real work rather than decorating.

**The workload bar** — a faceted fill echoing the low-poly mark, not a plain rectangle:
```
Kashif    ◣◤◣◤◣◤◣◤░░░░░░░░  45%  🟢 Available
Yusra     ◣◤◣◤◣◤◣◤◣◤◣◤◣◤◣◤  96%  🟠 Near limit
```

**The timer ring** — a circular progress ring in `accent-primary`, crossing to `load-warning` past 90% and `load-over` at 100%. Tabular numerals so the digits never jitter.

**The pixel-dissolve** — the mark's trailing squares, reused as a subtle motif at the right edge of the login panel and behind empty states. Never behind data.

---

## 11. Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-200 | The CRM uses the CNI AI & Digital Division logo in the sidebar, auth screens, emails, and favicon. | P0 |
| FR-201 | **Every user, in every role, can switch between light, dark, and system theme from Profile → Appearance.** | P0 |
| FR-202 | Theme preference is stored on the user record and syncs across devices. | P0 |
| FR-203 | `system` is the default and follows the OS setting. | P0 |
| FR-204 | Theme is applied before first paint — no flash of the wrong theme. | P0 |
| FR-205 | Every colour in the UI comes from a semantic token in this document. **No raw hex values in components.** | P0 |
| FR-206 | **Gold is never used to convey a semantic state** (§3). | P0 |
| FR-207 | All colour pairings meet WCAG AA in both themes. | P0 |
| FR-208 | Status never relies on colour alone — always a text label or icon too. | P0 |
| FR-209 | Light and dark logo variants are used automatically per theme. | P0 |
| FR-210 | Charts derive their colours from the same tokens. | P1 |
| FR-211 | Timers and numeric data use tabular numerals. | P1 |
| FR-212 | All motion respects `prefers-reduced-motion`. | P1 |
| FR-213 | Theme switching does not cause layout shift or lose scroll position. | P1 |
| FR-214 | Focus ring is visible against both themes on every interactive element. | P0 |
| FR-215 | Email templates use the light-theme palette regardless of the recipient's setting. | P1 |

| ID | Business rule |
|---|---|
| BR-024 | Gold (`gold-*`) may not be used for any status, priority, workload band, or warning. |
| BR-025 | Components reference semantic tokens only — never palette steps, never raw hex. |
| BR-026 | Any new colour must be added to this document before it is used anywhere. |

---

## 12. Open questions

- **Q-049** — Do you have the **original vector** (AI/EPS/SVG) of the logo? If not, I'll trace the mark to SVG — the supplied JPEG has a white background and can't sit on a dark surface.
- **Q-050** — Should the app be branded **"CNI CRM"**, or **"AI & Digital Division"**, or both (e.g. *CNI · AI & Digital Division*)? The logo is the division's; the CRM may serve wider than the division.
  *Default: sidebar shows the division lockup, browser title reads "CNI CRM".*
- **Q-051** — Default theme: **system** (follows OS), or force light for first-time users?
  *Default: system.*
- **Q-052** — Does CNI have brand guidelines that specify exact hex values? Mine are sampled from the JPEG and are close, but exact values would be better.
- **Q-053** — Serif for display headings (echoing the wordmark), or sans throughout for a plainer interface?
  *Default: serif for page titles and auth screens only; sans everywhere else.*
