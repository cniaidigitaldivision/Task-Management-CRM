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

/* ============================================================================
 * WHAT DAY IS IT — IN KARACHI, NOT IN GREENWICH
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23, at ten past midnight local time: *"you are saying UTC, but
 * I want the Asia/Karachi time… the time limit does not end at 5 am."*
 *
 * ── ⚠️ THE BUG THIS FIXES ────────────────────────────────────────────────────
 * Every "today" in this application was computed from UTC parts. Pakistan is
 * UTC+5, so between midnight and 5am local the system still believed it was
 * YESTERDAY. Three consequences, all of them wrong for a team that posts in the
 * evening:
 *
 *   · A post published at 1am counted against the previous day.
 *   · A day did not become "blank" at midnight, it became blank at 5am — so for
 *     five hours somebody could still fill in a day that had already ended.
 *   · The nightly schedule job, running at 02:00 UTC, generated from the wrong
 *     date near a month boundary.
 *
 * The owner's rule is "he has a whole day", and a whole day has to start and end
 * where the person lives.
 *
 * ── WHY A FIXED ZONE AND NOT THE SIGNED-IN USER'S ───────────────────────────
 * `users.timezone` exists and every account is currently Asia/Karachi. It is
 * deliberately NOT read here: a task's due date is a single stored value, and if
 * two people in different zones disagreed about which day it belongs to, the
 * same post would be "missed" for one of them and "pending" for the other. The
 * division has one working day, so one zone decides it. When that stops being
 * true this is the one line to change — and it will need a real decision about
 * whose day a shared deadline belongs to, not just a lookup.
 * ========================================================================= */

/** The division's working day. Every date-only value is resolved against this. */
export const DIVISION_TIME_ZONE = 'Asia/Karachi';

/**
 * The calendar date at an instant, as 'YYYY-MM-DD'.
 *
 * ⚠️ Built from `formatToParts` rather than a locale that happens to print ISO.
 * `en-CA` does produce YYYY-MM-DD today, and relying on that is relying on a
 * locale database staying the shape somebody noticed it was — reading the parts
 * by name cannot drift.
 *
 * `atMs` is a parameter so this stays testable against a fixed instant; the
 * default is the only clock read in the application.
 */
export function isoDateIn(atMs: number = nowMs(), timeZone: string = DIVISION_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(atMs));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The first of the month an instant falls in, as 'YYYY-MM-01'. */
export function isoMonthIn(atMs: number = nowMs(), timeZone: string = DIVISION_TIME_ZONE): string {
  return `${isoDateIn(atMs, timeZone).slice(0, 7)}-01`;
}
