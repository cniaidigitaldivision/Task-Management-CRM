/* ============================================================================
 * "LAST UPDATED 1d AGO"
 * ----------------------------------------------------------------------------
 * The credential list on a project's Access tab needs the age of each row on one
 * line, next to its service name. An absolute timestamp there is unreadable at a
 * glance — "May 19, 2025 at 10:24 AM" is five words to answer "is this stale".
 * The exact stamp is on the detail panel, where somebody has asked for it.
 *
 * ── ⚠️ `now` IS AN ARGUMENT. IT IS NOT ALLOWED TO BE ANYTHING ELSE ───────────
 * Two separate rules, one fix (see lib/now.ts):
 *
 *   · `lib/domain/` and `lib/view/` may not read a clock — a pure function that
 *     knows the time cannot be tested, and every test below depends on that.
 *   · React's compiler lint refuses `Date.now()` in a component body, correctly:
 *     a render that reads the clock is not a pure function of its props, so the
 *     server and the browser can disagree and React reports it as a hydration
 *     mismatch rather than as the timezone bug it is.
 *
 * So the server passes `nowMs` in as a prop and the component computes labels
 * from it. The value goes stale as the page ages, which is fine for a unit of
 * "1d" and is exactly the trade the rest of the application makes.
 *
 * ── WHY NOT `Intl.RelativeTimeFormat` ────────────────────────────────────────
 * It produces "1 day ago", "in 3 hours", "last week". The mock says `1d ago`,
 * `3d ago`, `1w ago`, and that compactness is the point on a line that also
 * carries a service name — the column is narrow and the words do not fit. It also
 * only formats a number you have already chosen, so the awkward half — deciding
 * whether 25 hours is "1d" or "yesterday" — is still this function's job.
 * ========================================================================= */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Calendar-average, deliberately. Nothing here is doing date arithmetic — it is
 *  choosing a word for a duration, and "2mo ago" does not promise 61 days. */
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

/**
 * A compact age: `just now`, `5m ago`, `3h ago`, `1d ago`, `2w ago`, `5mo ago`,
 * `1y ago`.
 *
 * @param iso   An ISO timestamp. Anything unparseable returns null, so a caller
 *              renders nothing rather than "NaN ago".
 * @param nowMs Epoch milliseconds, from the server. See the header.
 */
export function relativeAge(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;

  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const elapsed = nowMs - then;

  /* ── ⚠️ A FUTURE TIMESTAMP READS AS "just now", NOT "-3h ago" ──────────────
     `updated_at` comes from `now()` on the database server, and this `nowMs` from
     the web server. A second or two of clock skew between them is normal and would
     otherwise render as a negative age on a row somebody had only just saved —
     which looks like corruption in the one screen where trust matters most. */
  if (elapsed < MINUTE) return 'just now';

  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w ago`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo ago`;
  return `${Math.floor(elapsed / YEAR)}y ago`;
}
