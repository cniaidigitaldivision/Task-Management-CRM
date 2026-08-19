/* ============================================================================
 * THE LIBRARY'S VOCABULARY — migration 035
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS IS IN `lib/domain/` AND NOT WITH THE QUERY ────────────────────
 * `lib/db/queries/library.ts` starts with `import 'server-only'`, whose entry
 * point throws if it is ever pulled into a client bundle. The library panel is a
 * client component and needs these categories to render its filter chips, so
 * importing them from the query module made the production build fail with:
 *
 *     You're importing a module that depends on "server-only"
 *
 * A `import type` would have been erased and been fine; these are VALUES, so they
 * are not. Exactly the same trap as `lib/domain/folder-access.ts`, which exists
 * for the same reason — and the second time it has been hit, which is why the
 * rule is written down here: **anything a client component needs to render lives
 * in `lib/domain/`, never in a query module.**
 *
 * ── ⚠️ MIRRORS `public.library_category` ──────────────────────────────────────
 * Add a value here and it must be added to the enum in the same commit, or the
 * filter offers something the database refuses.
 * ========================================================================= */

export const LIBRARY_CATEGORIES = [
  'package_card',
  'package_detail',
  'rate_card',
  'booklet',
  'deck',
  'design_source',
  'other',
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_CATEGORY_LABEL: Readonly<Record<LibraryCategory, string>> = {
  package_card: 'Package card',
  package_detail: 'Package detail',
  rate_card: 'Rate card',
  booklet: 'Booklet',
  deck: 'Deck',
  design_source: 'Design source',
  other: 'Other',
};
