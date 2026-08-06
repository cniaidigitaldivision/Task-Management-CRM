/* ============================================================================
 * THE CLOCK
 * ----------------------------------------------------------------------------
 * One function, and it exists for two unrelated reasons that happen to have the
 * same fix.
 *
 * 1. `lib/domain/` is forbidden from reading a clock (doc 20 §5, lint-enforced):
 *    a pure function that knows what time it is cannot be tested. So every
 *    domain function takes `now` as an argument, and *somebody* has to supply
 *    it. This is that somebody.
 *
 * 2. React's compiler lint refuses `Date.now()` in a component body, correctly —
 *    a render that reads the clock is not a pure function of its props, so two
 *    renders can disagree. Naming the impurity and confining it to one module
 *    keeps every call site honest about what it is doing.
 *
 * ── WHY SERVER-SIDE, ONCE PER REQUEST ────────────────────────────────────────
 * Date labels ("2 days late") are computed on the server from this value and
 * shipped as strings. If a card computed its own label in the browser, the
 * server and the client could disagree about what day it is — across a midnight
 * boundary, or with a browser in another timezone — and React reports that as a
 * hydration mismatch rather than as the timezone bug it actually is.
 * ========================================================================= */

/** The current epoch milliseconds. The only place the application reads a clock. */
export function nowMs(): number {
  return Date.now();
}
