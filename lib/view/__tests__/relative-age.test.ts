import { describe, expect, it } from 'vitest';

import { relativeAge } from '../relative-age';

/* ============================================================================
 * "LAST UPDATED 3d AGO"
 * ----------------------------------------------------------------------------
 * These tests are only possible because `now` is an argument. That is the point
 * of the rule in lib/now.ts, and this file is what it buys: every boundary below
 * is pinned to an exact millisecond, with no fake timers and no flakiness at
 * midnight.
 * ========================================================================= */

/** A fixed instant, so every case reads as an offset from one place. */
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

/** `n` units before NOW, as an ISO string. */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('the units', () => {
  it('says "just now" under a minute', () => {
    expect(relativeAge(ago(0), NOW)).toBe('just now');
    expect(relativeAge(ago(30 * SECOND), NOW)).toBe('just now');
    expect(relativeAge(ago(59 * SECOND), NOW)).toBe('just now');
  });

  it('switches to minutes exactly at one minute', () => {
    expect(relativeAge(ago(MINUTE), NOW)).toBe('1m ago');
    expect(relativeAge(ago(59 * MINUTE), NOW)).toBe('59m ago');
  });

  it('switches to hours exactly at one hour', () => {
    expect(relativeAge(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeAge(ago(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('switches to days exactly at one day', () => {
    /* The mockup's own example: "Last updated 1d ago". */
    expect(relativeAge(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeAge(ago(3 * DAY), NOW)).toBe('3d ago');
    expect(relativeAge(ago(5 * DAY), NOW)).toBe('5d ago');
    expect(relativeAge(ago(6 * DAY), NOW)).toBe('6d ago');
  });

  it('switches to weeks exactly at seven days', () => {
    /* ⚠️ 7 days is "1w", not "7d". The mockup shows both `5d ago` and `1w ago`,
       so this boundary is a design decision rather than an arbitrary cut. */
    expect(relativeAge(ago(7 * DAY), NOW)).toBe('1w ago');
    expect(relativeAge(ago(13 * DAY), NOW)).toBe('1w ago');
    expect(relativeAge(ago(14 * DAY), NOW)).toBe('2w ago');
  });

  it('switches to months at about thirty days, and years at about 365', () => {
    expect(relativeAge(ago(31 * DAY), NOW)).toBe('1mo ago');
    expect(relativeAge(ago(200 * DAY), NOW)).toBe('6mo ago');
    expect(relativeAge(ago(400 * DAY), NOW)).toBe('1y ago');
    expect(relativeAge(ago(1000 * DAY), NOW)).toBe('2y ago');
  });

  it('never emits a zero, which would read as broken', () => {
    /* Every boundary hands over to the next unit at exactly 1 of it, so "0m ago"
       and "0d ago" are unreachable. Checked across a full day of offsets. */
    for (let minutes = 0; minutes <= 60 * 24; minutes += 7) {
      const label = relativeAge(ago(minutes * MINUTE), NOW);
      expect(label).not.toMatch(/^0/);
    }
  });
});

describe('the awkward inputs', () => {
  it('reads a future timestamp as "just now" rather than a negative age', () => {
    /* ⚠️ THE REAL CASE, NOT A HYPOTHETICAL. `updated_at` comes from `now()` on the
       database server and this `now` from the web server; a second or two of skew
       between them is normal. Without the floor, a credential somebody had just
       saved would render "-1m ago", which looks like corruption on the one screen
       where trust matters most. */
    expect(relativeAge(new Date(NOW + 2 * SECOND).toISOString(), NOW)).toBe('just now');
    expect(relativeAge(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe('just now');
  });

  it('returns null for nothing, so a caller renders nothing', () => {
    /* Several of the columns this formats are nullable — `last_rotated_at` is null
       until a password is first changed. A dash or "Invalid Date" there would be
       worse than an absent line. */
    expect(relativeAge(null, NOW)).toBeNull();
  });

  it('returns null for an unparseable string instead of "NaN ago"', () => {
    expect(relativeAge('not a date', NOW)).toBeNull();
    expect(relativeAge('', NOW)).toBeNull();
  });

  it('is pure: the same inputs give the same answer', () => {
    /* The whole reason `now` is a parameter — see lib/now.ts. If this ever fails,
       something has started reading the clock. */
    const iso = ago(3 * DAY);
    expect(relativeAge(iso, NOW)).toBe(relativeAge(iso, NOW));
  });
});
