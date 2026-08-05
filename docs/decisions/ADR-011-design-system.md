# ADR-011 — Design System, Brand Palette & Theming

**Date:** 2026-08-06
**Status:** ✅ Accepted
**Decided by:** Project owner
**Relates to:** [`../18-DESIGN-SYSTEM-AND-BRANDING.md`](../18-DESIGN-SYSTEM-AND-BRANDING.md)

## Context
The owner supplied the CNI **AI & Digital Division** logo — a low-poly geometric brain, deep teal fracturing into gold, dissolving into pixel squares, with a serif wordmark — and asked that the CRM adopt the logo and derive its colour theme from it. A light/dark theme toggle was also required, accessible to **every** role from profile settings.

## Decision

**1. Brand palette derived from the mark:**
- **Primary — Deep Teal** `#0E5C63` (light theme) / `#2FA3A9` (dark theme)
- **Accent — Gold** `#D4A63C` (light) / `#E0B85C` (dark)
- **Neutrals are teal-tinted**, not pure grey — pure grey reads as dead next to teal

**2. 🔒 Gold is brand chrome and is NEVER a semantic state.**

**3. Status and workload palettes revised** to eliminate collisions with brand gold:
- *In Progress*: amber → **violet** `#8B5CF6`
- *In Review*: purple → **pink** `#EC4899`
- All semantic warning: → **orange** `#F97316`

**4. Light and dark themes**, switchable by every role from Profile → Appearance. Stored on the user record, synced across devices, default `system`, applied before first paint.

**5. All colour flows through semantic tokens.** No raw hex in any component.

## Why

**On the gold/amber collision.** Brand gold sits at hue 43°; the conventional warning amber sits at 38°. Five degrees apart. In a system whose entire purpose is flagging overload and over-limit work, a user being unable to distinguish brand chrome from a warning is not a cosmetic issue — it defeats the product's core function. Separating them by rule rather than by careful case-by-case judgement is the only version that survives contact with a growing codebase.

**On gold's contrast limit.** `#D4A63C` on white is 2.1:1 — it fails WCAG for text at any size. On dark backgrounds it reaches 9.8:1 and is excellent. This asymmetry is encoded in the token names (`text-gold` resolves to `gold-800` in light and `gold-400` in dark) rather than left to a developer to remember, because "remember not to use gold for text" is a rule that will be broken.

**On semantic tokens rather than palette steps.** A component that hard-codes `#0E5C63` breaks in dark mode. A component using `accent-primary` never does. This is the difference between a theme that works and one that mostly works — and "mostly" in dark mode means unreadable text somewhere a user will find.

**On theming being available to Members.** The owner was explicit. It also costs nothing: theme preference is one column and one attribute, entirely independent of the permission model.

**On the design system being layer 0 of the build.** Retrofitting a theme into finished components means touching every file and is the most common source of visual inconsistency in a rebuild. Tokens exist before the first component.

## Consequences
**Easier:** consistent visuals; dark mode correct by construction; new components inherit the system automatically; accessibility met by default rather than audited afterwards.

**Harder:** discipline required — no developer may reach for a hex value. Enforced by a lint rule (BR-025) rather than by review alone.

**Superseded:** the status colours in doc 05 §1 and the workload band colours in doc 06 §3, both chosen before the brand existed. Recorded as contradictions C-01 in [doc 19 §9](../19-MASTER-SPECIFICATION-REGISTRY.md).

**Outstanding:** the supplied logo is a JPEG on a white background and cannot sit on a dark surface. SVG variants with transparency are needed before Phase 1 (Q-049).
