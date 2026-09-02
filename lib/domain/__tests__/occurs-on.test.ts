import { describe, expect, it } from 'vitest';

import { occursOn, parseRecurrence, type RecurrenceRule } from '../recurrence';

/* ============================================================================
 * IS TODAY ONE OF THIS SERIES' DAYS? — owner rule, 2026-09-03
 * ----------------------------------------------------------------------------
 * *"exactly 12 AM on every day that task will be generated."*
 *
 * The nightly runner holds a series' most recent instance and asks exactly this
 * question. It is not the same question `nextOccurrence` answers — that one is
 * "what comes after this date", which only coincides when the last instance is
 * precisely one step behind. It usually is not: a Monday/Thursday series looked
 * at on a Wednesday is two steps from its last instance, and one nobody has
 * touched for a week is seven.
 * ========================================================================= */

const rule = (raw: string): RecurrenceRule => {
  const parsed = parseRecurrence(raw);
  if (!parsed.ok) throw new Error(`test rule did not parse: ${raw}`);
  return parsed.rule;
};

const DAILY = rule('FREQ=DAILY;INTERVAL=1');
const EVERY_OTHER_DAY = rule('FREQ=DAILY;INTERVAL=2');
/* 2026-09-03 is a Thursday. */
const MON_THU = rule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH');
const MONTHLY_15 = rule('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15');

describe('occursOn — daily', () => {
  it('says yes to the day after the last instance', () => {
    expect(occursOn(DAILY, '2026-09-02', '2026-09-03')).toBe(true);
  });

  /* The case that matters most: the person is behind. The owner chose to
     generate anyway, so today must still be recognised as one of its days
     however stale the anchor is. */
  it('says yes even when the last instance is a week old', () => {
    expect(occursOn(DAILY, '2026-08-27', '2026-09-03')).toBe(true);
  });

  it('refuses the anchor itself — that instance already exists', () => {
    expect(occursOn(DAILY, '2026-09-03', '2026-09-03')).toBe(false);
  });

  it('refuses a day before the anchor — it never backfills', () => {
    expect(occursOn(DAILY, '2026-09-03', '2026-09-01')).toBe(false);
  });
});

describe('occursOn — an interval that skips days', () => {
  it('lands on every second day and not the ones between', () => {
    expect(occursOn(EVERY_OTHER_DAY, '2026-09-01', '2026-09-03')).toBe(true);
    expect(occursOn(EVERY_OTHER_DAY, '2026-09-01', '2026-09-02')).toBe(false);
    expect(occursOn(EVERY_OTHER_DAY, '2026-09-01', '2026-09-05')).toBe(true);
  });
});

describe('occursOn — weekly on named days', () => {
  /* Anchored Monday 31 Aug; Thursday 3 Sep is the next selected day. */
  it('says yes on a selected weekday two steps out', () => {
    expect(occursOn(MON_THU, '2026-08-31', '2026-09-03')).toBe(true);
  });

  it('says no on a weekday the rule does not name', () => {
    expect(occursOn(MON_THU, '2026-08-31', '2026-09-02')).toBe(false);
    expect(occursOn(MON_THU, '2026-08-31', '2026-09-04')).toBe(false);
  });

  it('carries across weeks', () => {
    expect(occursOn(MON_THU, '2026-08-31', '2026-09-07')).toBe(true);
    expect(occursOn(MON_THU, '2026-08-31', '2026-09-10')).toBe(true);
  });
});

describe('occursOn — monthly', () => {
  it('lands on the named day of the month', () => {
    expect(occursOn(MONTHLY_15, '2026-08-15', '2026-09-15')).toBe(true);
    expect(occursOn(MONTHLY_15, '2026-08-15', '2026-09-14')).toBe(false);
  });
});

describe('occursOn — refuses rather than misbehaving', () => {
  it('says no to an unparseable date instead of throwing', () => {
    expect(occursOn(DAILY, 'not-a-date', '2026-09-03')).toBe(false);
    expect(occursOn(DAILY, '2026-09-02', 'tomorrow')).toBe(false);
  });

  /* ⚠️ The walk is capped. A daily series anchored far enough back that the cap
     is reached must return false, not spin — the runner then creates nothing
     that night, which is recoverable, where a hang is not. */
  it('gives up rather than walking for ever on an ancient anchor', () => {
    expect(occursOn(DAILY, '2000-01-01', '2026-09-03')).toBe(false);
  });
});
