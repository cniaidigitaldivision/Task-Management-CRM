import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* ============================================================================
 * cn — merge class names, last conflicting one wins
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS IS `extendTailwindMerge` AND NOT PLAIN `twMerge` ─────────────
 * Because plain `twMerge` SILENTLY DELETED OUR FONT SIZES, on every page, for
 * months. This was the cause of the owner's repeated report (2026-08-16 and
 * again 2026-08-18) that *"some things are getting very out of the style or
 * rhythm of the page… it is happening in all of the pages in all of the
 * tables"*.
 *
 * The type scale in `app/globals.css` is named, not numbered: `text-caption`,
 * `text-body-sm`, `text-micro`, `text-h1`. tailwind-merge has never heard of
 * those names. Its `text-*` rules cover font size (`text-xs`) and text colour
 * (`text-red-500`), and it disambiguates by recognising the value — so an
 * unrecognised `text-caption` was filed as a COLOUR. Then any real colour class
 * beside it looked like a conflict, and the later one won:
 *
 *     twMerge('text-caption text-text-primary')  →  'text-text-primary'
 *                                                    ↑ the size is GONE
 *
 * The element then inherited whatever font size its parent had. Which is why the
 * bug looked random: a class list with only a size was fine, and one that also
 * set a colour lost it. `<Button size="sm">` composes exactly that pair, so
 * every button rendered at the inherited size instead of 12px — visibly larger
 * than the `text-micro` line directly beneath it in the same row.
 *
 * Registering the scale below fixes it everywhere at once, because every
 * component funnels through this function.
 *
 * ⚠️ ADD A NEW `@utility text-*` TO `app/globals.css` AND YOU MUST ADD IT HERE
 * TOO. There is a test that fails if the two lists disagree —
 * `lib/domain/__tests__/design-tokens.test.ts`.
 * ========================================================================= */

/** The named type scale from `app/globals.css`. Order is irrelevant; membership
 *  is what tells tailwind-merge these are sizes rather than colours. */
export const TYPE_SCALE = [
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'body-sm',
  'caption',
  'micro',
] as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      /* Naming the group 'font-size' joins Tailwind's own, so `text-caption`
         conflicts with `text-xs` (both sizes) and NOT with `text-text-primary`
         (a colour) — which is the whole point. */
      'font-size': [{ text: [...TYPE_SCALE] }],
    },
  },
});

/**
 * Merge Tailwind class names, resolving conflicts so the last one wins.
 * Used by every component that accepts a `className` override.
 */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
