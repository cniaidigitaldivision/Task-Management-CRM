import { describe, expect, it } from 'vitest';

import { DIVISION_TIME_ZONE, isoDateIn, isoMonthIn } from '../now';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * The five hours between midnight in Karachi and midnight in Greenwich.
 *
 * Every "today" in this application used to come from UTC parts, so for a team
 * in Pakistan the working day silently ran 05:00 → 05:00 rather than midnight to
 * midnight. A post published at 1am counted against the previous day, and a day
 * did not go blank until five hours after it had ended.
 *
 * The instants below are chosen to sit inside that window: if `isoDateIn` ever
 * falls back to UTC these fail, and they fail with the exact date the owner
 * complained about.
 * ========================================================================= */

/** 2026-08-22 19:12 UTC — which is 2026-08-23 00:12 in Karachi. The moment the
 *  bug was actually noticed. */
const JUST_AFTER_MIDNIGHT = Date.parse('2026-08-22T19:12:00Z');

describe('isoDateIn', () => {
  it('is already tomorrow in Karachi when UTC still says yesterday', () => {
    expect(isoDateIn(JUST_AFTER_MIDNIGHT)).toBe('2026-08-23');
  });

  it('and UTC would have said the 22nd — the five hours this fixes', () => {
    expect(new Date(JUST_AFTER_MIDNIGHT).toISOString().slice(0, 10)).toBe('2026-08-22');
  });

  it('rolls at local midnight, not at 05:00', () => {
    /* One minute either side of midnight in Karachi. */
    expect(isoDateIn(Date.parse('2026-08-22T18:59:00Z'))).toBe('2026-08-22');
    expect(isoDateIn(Date.parse('2026-08-22T19:01:00Z'))).toBe('2026-08-23');
  });

  it('agrees with UTC during the working day, when there is nothing to disagree about', () => {
    expect(isoDateIn(Date.parse('2026-08-22T09:00:00Z'))).toBe('2026-08-22');
  });

  it('handles a month boundary', () => {
    /* 31 Aug 20:00 UTC is 1 Sep in Karachi — the case that would have made the
       nightly job generate against the wrong month. */
    expect(isoDateIn(Date.parse('2026-08-31T20:00:00Z'))).toBe('2026-09-01');
  });

  it('handles a year boundary', () => {
    expect(isoDateIn(Date.parse('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });

  it('always returns a zero-padded ISO date', () => {
    expect(isoDateIn(Date.parse('2026-01-05T06:00:00Z'))).toBe('2026-01-05');
  });

  it('can be pointed at another zone, which is how the fixed default is tested', () => {
    expect(isoDateIn(JUST_AFTER_MIDNIGHT, 'UTC')).toBe('2026-08-22');
    expect(isoDateIn(JUST_AFTER_MIDNIGHT, 'Asia/Karachi')).toBe('2026-08-23');
  });
});

describe('isoMonthIn', () => {
  it('gives the first of the local month', () => {
    expect(isoMonthIn(JUST_AFTER_MIDNIGHT)).toBe('2026-08-01');
  });

  it('follows the local date across a month boundary', () => {
    expect(isoMonthIn(Date.parse('2026-08-31T20:00:00Z'))).toBe('2026-09-01');
  });
});

describe('the division zone', () => {
  it('is Karachi', () => {
    /* Stated as a test so changing it is a deliberate act with a visible diff,
       rather than something that drifts in a config file. */
    expect(DIVISION_TIME_ZONE).toBe('Asia/Karachi');
  });
});
