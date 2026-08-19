/* ============================================================================
 * WHICH NAVIGATION ITEM IS THE CURRENT ONE
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE MOST SPECIFIC MATCH WINS, NOT EVERY MATCH ──────────────────────────
 * A prefix test is what keeps "Projects" lit while the reader is on
 * `/projects/[id]`, so it has to stay. It cannot be the whole rule, though: the
 * moment a CHILD route is itself a nav item, a path under it satisfies BOTH
 * entries. Two items light up, and both carry `aria-current="page"` — which tells a
 * screen reader the reader is in two places at once.
 *
 * So the deepest matching href wins, and exactly one item can equal it. This has to
 * be decided across the whole list rather than per item, because an item cannot
 * know whether a more specific sibling exists.
 *
 * The nav has no such pair today — the monthly report was briefly `/reports/ceo`,
 * which is what surfaced this, and it moved to `/monthly-report` for an unrelated
 * and more serious reason (see that route's layout). The rule stays because the
 * next nested nav item would reintroduce the bug silently, and because it is the
 * behaviour the sidebar should have had all along.
 *
 * ── WHY IN `lib/view/` AND NOT BESIDE THE NAV CONFIG ──────────────────────────
 * `components/layout/nav-config.ts` carries icon components, so it is a React
 * module. This is pure string logic over hrefs, and the test runner only collects
 * `lib/**` precisely so the tested layer stays free of React (see
 * vitest.config.mts). Taking a plain array of hrefs rather than the nav sections
 * keeps it that way.
 * ========================================================================= */

/**
 * The single href that should be marked current, or null if none matches.
 *
 * ⚠️ Depth is counted in SEGMENTS, not characters. `href.length` happens to work
 * for the current tree but ranks `/reportsx` above `/reports`, and a prefix match
 * on a partial segment is not a match at all — `/reports-archive` must never light
 * `/reports`. The `${href}/` test is what prevents that.
 */
export function activeHref(hrefs: readonly string[], pathname: string): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || segments(href) > segments(best)) best = href;
  }

  return best;
}

function segments(href: string): number {
  return href.split('/').filter(Boolean).length;
}
