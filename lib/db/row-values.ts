import 'server-only';

/* ============================================================================
 * READING VALUES OUT OF A DATABASE ROW
 * ----------------------------------------------------------------------------
 * Three one-line helpers that exist because getting any of them wrong is silent.
 *
 * ── ⚠️ THE BUG THAT PUT THIS FILE HERE ───────────────────────────────────────
 * Found 2026-08-12: **the calendar had never displayed a single task.** The grid
 * drew, the count said "26 with a due date", and every cell was empty.
 *
 * The cause was `String(row.due_date).slice(0, 10)`. The `postgres` driver parses
 * a `date` column into a JavaScript `Date`, and `String()` on a Date gives
 *
 *     "Fri Aug 07 2026 05:00:00 GMT+0500 (Pakistan Standard Time)"
 *
 * so the first ten characters are `"Fri Aug 07"`. The calendar keys its cells by
 * `2026-08-07`, nothing ever matched, and there was no error to notice — a
 * lookup that misses just returns an empty day.
 *
 * A correct version already existed as a private function inside
 * `queries/tasks.ts`, which is exactly why the Tasks screen showed dates
 * correctly while eight other call sites quietly did not. That is the real
 * lesson: the helper was right and unreachable, so everybody who needed it wrote
 * the plausible one-liner instead.
 *
 * ── WHY `toISOString()` IS SAFE HERE AND NOT ELSEWHERE ───────────────────────
 * Normally `toISOString().slice(0, 10)` is a trap: it converts to UTC, so a local
 * midnight can come back as the previous day. It is right here because a Postgres
 * `date` has no time and the driver represents it as **midnight UTC** — the
 * instant above is `2026-08-07T00:00:00Z`. Reading it back in UTC returns the
 * same calendar day it was stored as, whatever zone the server sits in.
 *
 * Do NOT use these on a value that came from a `Date` constructed in local time.
 * ========================================================================= */

/**
 * A `date` column as `yyyy-mm-dd`.
 *
 * Accepts a `Date` (what the driver gives) or a string (what a raw query or a
 * `::text` cast gives), because both occur and a helper that handled only one
 * would send somebody back to writing the broken one-liner.
 */
export function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * A `time` column as `HH:MM`.
 *
 * Postgres sends `HH:MM:SS`; every form in this application wants `HH:MM` and
 * nothing reads the seconds. Trimmed once here rather than in each component
 * that renders a time.
 */
export function timeOnly(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 5);
}

/** A `timestamptz` as a full ISO string, or null. */
export function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
