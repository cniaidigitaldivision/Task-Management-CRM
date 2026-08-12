import { describe, expect, it } from 'vitest';

import { dateOnly, isoOrNull, timeOnly } from '../row-values';

/* ============================================================================
 * READING DATES OUT OF A ROW
 * ----------------------------------------------------------------------------
 * A regression test for a bug that shipped and was invisible: **the calendar
 * never displayed a single task.** The grid drew, the counter said "26 with a due
 * date", and every cell was empty.
 *
 * `String(row.due_date).slice(0, 10)` was the cause. The driver hands back a
 * `Date` for a `date` column, and `String()` on a Date gives
 * "Fri Aug 07 2026 05:00:00 GMT+0500 (…)" — so the first ten characters are
 * "Fri Aug 07". The calendar keys its cells by "2026-08-07". Nothing matched, and
 * a lookup that misses returns an empty day rather than an error.
 *
 * Nothing about that is catchable by types: both sides are `string`. Only a test
 * that feeds in a real `Date` finds it, which is what these do.
 * ========================================================================= */

describe('dateOnly', () => {
  it('formats a Date as an ISO calendar day, not as words', () => {
    /* THE test. The old implementation returned "Fri Aug 07" here. */
    const fromDriver = new Date('2026-08-07T00:00:00.000Z');
    expect(dateOnly(fromDriver)).toBe('2026-08-07');
    expect(dateOnly(fromDriver)).not.toMatch(/[A-Za-z]/);
  });

  it('is stable regardless of the server timezone', () => {
    /* A Postgres `date` has no time and arrives as midnight UTC, so reading it
       back in UTC gives the same calendar day wherever the server is. This is why
       `toISOString()` is right here and a trap almost everywhere else. */
    const midnightUtc = new Date(Date.UTC(2026, 0, 1));
    expect(dateOnly(midnightUtc)).toBe('2026-01-01');

    /* And the awkward end of the year, where an off-by-one shows loudest. */
    expect(dateOnly(new Date(Date.UTC(2025, 11, 31)))).toBe('2025-12-31');
  });

  it('passes an ISO string through unchanged', () => {
    /* A `::text` cast or a raw query gives a string. Both shapes occur, so both
       are handled — a helper that took only one would send the next person back
       to writing the broken one-liner. */
    expect(dateOnly('2026-08-07')).toBe('2026-08-07');
    expect(dateOnly('2026-08-07T13:45:00.000Z')).toBe('2026-08-07');
  });

  it('returns null for nothing, rather than a string that looks like a date', () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
    expect(dateOnly('')).toBeNull();
  });
});

describe('timeOnly', () => {
  it('trims the seconds Postgres always sends', () => {
    expect(timeOnly('09:15:00')).toBe('09:15');
    expect(timeOnly('17:30:00')).toBe('17:30');
  });

  it('leaves an already-short time alone', () => {
    expect(timeOnly('09:15')).toBe('09:15');
  });

  it('returns null for nothing — a task may have a date and no hour', () => {
    expect(timeOnly(null)).toBeNull();
    expect(timeOnly('')).toBeNull();
  });
});

describe('isoOrNull', () => {
  it('keeps the whole instant for a timestamp', () => {
    /* Unlike a date, a `timestamptz` IS a moment, so nothing is trimmed. */
    const at = new Date('2026-08-07T13:45:12.000Z');
    expect(isoOrNull(at)).toBe('2026-08-07T13:45:12.000Z');
  });

  it('passes a string through and handles nothing', () => {
    expect(isoOrNull('2026-08-07T13:45:12.000Z')).toBe('2026-08-07T13:45:12.000Z');
    expect(isoOrNull(null)).toBeNull();
  });
});
