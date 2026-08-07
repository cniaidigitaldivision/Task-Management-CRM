import { describe, expect, it } from 'vitest';

import {
  describeRecurrence,
  formatRecurrence,
  nextInstanceDates,
  nextOccurrence,
  parseRecurrence,
  type RecurrenceRule,
} from '../recurrence';

/* ============================================================================
 * RECURRENCE
 * ----------------------------------------------------------------------------
 * The timezone cases are the reason this file is long. `new Date('2026-03-29')`
 * is midnight UTC and `getDay()` answers locally, so "every Monday" silently
 * becomes every Sunday for anybody west of Greenwich. Every assertion here is
 * on a date string, and the implementation never leaves UTC.
 * ========================================================================= */

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'WEEKLY',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  ...over,
});

describe('parseRecurrence', () => {
  it('reads the simplest rule', () => {
    const result = parseRecurrence('FREQ=WEEKLY');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule).toEqual(rule());
  });

  it('reads interval and weekdays', () => {
    const result = parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule).toEqual(rule({ interval: 2, byDay: ['MO', 'TH'] }));
  });

  it('is case-insensitive and tolerates surrounding space', () => {
    const result = parseRecurrence('  freq=weekly;byday=mo  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.byDay).toEqual(['MO']);
  });

  it('sorts weekdays and drops duplicates', () => {
    const result = parseRecurrence('FREQ=WEEKLY;BYDAY=TH,MO,MO');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.byDay).toEqual(['MO', 'TH']);
  });

  it('rejects an unsupported frequency rather than ignoring it', () => {
    /* Silently downgrading FREQ=YEARLY to weekly would create 52 tasks a year
       where somebody asked for one. */
    expect(parseRecurrence('FREQ=YEARLY').ok).toBe(false);
    expect(parseRecurrence('FREQ=HOURLY').ok).toBe(false);
  });

  it('rejects an empty or absent rule', () => {
    for (const raw of ['', '   ', null, undefined]) {
      expect(parseRecurrence(raw).ok, String(raw)).toBe(false);
    }
  });

  it('rejects a malformed chunk', () => {
    expect(parseRecurrence('FREQ=WEEKLY;NONSENSE').ok).toBe(false);
  });

  it('rejects intervals that are not sensible whole numbers', () => {
    for (const raw of ['0', '-1', '1.5', 'many', '999']) {
      expect(parseRecurrence(`FREQ=DAILY;INTERVAL=${raw}`).ok, raw).toBe(false);
    }
  });

  it('rejects weekdays on a non-weekly rule instead of quietly dropping them', () => {
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=MO').ok).toBe(false);
  });

  it('rejects a day of the month on a non-monthly rule', () => {
    expect(parseRecurrence('FREQ=WEEKLY;BYMONTHDAY=15').ok).toBe(false);
  });

  it('rejects a day of the month outside 1–31', () => {
    expect(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=0').ok).toBe(false);
    expect(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=32').ok).toBe(false);
  });

  it('rejects a weekday code that is not one', () => {
    expect(parseRecurrence('FREQ=WEEKLY;BYDAY=XX').ok).toBe(false);
  });
});

describe('formatRecurrence round-trips', () => {
  const cases = [
    'FREQ=DAILY;INTERVAL=1',
    'FREQ=DAILY;INTERVAL=3',
    'FREQ=WEEKLY;INTERVAL=1',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
    'FREQ=MONTHLY;INTERVAL=1',
    'FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=15',
  ];

  for (const text of cases) {
    it(`survives ${text}`, () => {
      const parsed = parseRecurrence(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatRecurrence(parsed.rule)).toBe(text);
    });
  }
});

describe('describeRecurrence', () => {
  it('reads as English for the common cases', () => {
    expect(describeRecurrence(rule({ freq: 'DAILY' }))).toBe('Every day');
    expect(describeRecurrence(rule({ freq: 'DAILY', interval: 3 }))).toBe('Every 3 days');
    expect(describeRecurrence(rule({ byDay: ['MO'] }))).toBe('Every week on Monday');
    expect(describeRecurrence(rule({ interval: 2, byDay: ['MO', 'TH'] }))).toBe(
      'Every 2 weeks on Monday and Thursday',
    );
    expect(describeRecurrence(rule({ freq: 'MONTHLY', byMonthDay: 15 }))).toBe(
      'Every month on day 15',
    );
  });

  it('uses commas and a final "and" for three or more days', () => {
    expect(describeRecurrence(rule({ byDay: ['MO', 'WE', 'FR' ] }))).toBe(
      'Every week on Monday, Wednesday and Friday',
    );
  });
});

describe('nextOccurrence — daily', () => {
  it('adds one day', () => {
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2026-08-07')).toBe('2026-08-08');
  });

  it('adds the interval', () => {
    expect(nextOccurrence(rule({ freq: 'DAILY', interval: 10 }), '2026-08-07')).toBe('2026-08-17');
  });

  it('crosses a month boundary', () => {
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2026-08-31')).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2026-12-31')).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2028-02-28')).toBe('2028-02-29');
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2028-02-29')).toBe('2028-03-01');
  });

  it('is unaffected by a daylight-saving boundary', () => {
    /* 29 March 2026 is the European clock change. Anything doing local-time
       arithmetic lands on the same day or skips one; UTC day arithmetic does
       not care. */
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2026-03-28')).toBe('2026-03-29');
    expect(nextOccurrence(rule({ freq: 'DAILY' }), '2026-03-29')).toBe('2026-03-30');
  });
});

describe('nextOccurrence — weekly', () => {
  it('adds a week when no weekday is named', () => {
    expect(nextOccurrence(rule(), '2026-08-07')).toBe('2026-08-14');
  });

  it('adds the interval in weeks', () => {
    expect(nextOccurrence(rule({ interval: 3 }), '2026-08-07')).toBe('2026-08-28');
  });

  it('finds the next named weekday inside the same week', () => {
    // 2026-08-03 is a Monday; Thursday is three days later.
    expect(nextOccurrence(rule({ byDay: ['MO', 'TH'] }), '2026-08-03')).toBe('2026-08-06');
  });

  it('jumps to the next period once the week is exhausted', () => {
    // From Thursday, the next is the following Monday.
    expect(nextOccurrence(rule({ byDay: ['MO', 'TH'] }), '2026-08-06')).toBe('2026-08-10');
  });

  it('respects the interval when jumping weeks, not just when adding days', () => {
    /* "Every other Monday and Thursday" is Mon, Thu, then a fortnight later —
       not Mon, Thu, Mon+14. Getting this wrong makes the series drift. */
    expect(nextOccurrence(rule({ interval: 2, byDay: ['MO', 'TH'] }), '2026-08-06')).toBe(
      '2026-08-17',
    );
  });

  it('lands on the right weekday regardless of the machine timezone', () => {
    const next = nextOccurrence(rule({ byDay: ['MO'] }), '2026-08-04')!;
    expect(new Date(`${next}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});

describe('nextOccurrence — monthly', () => {
  it('keeps the same day of the month', () => {
    expect(nextOccurrence(rule({ freq: 'MONTHLY' }), '2026-08-15')).toBe('2026-09-15');
  });

  it('uses the named day of the month', () => {
    expect(nextOccurrence(rule({ freq: 'MONTHLY', byMonthDay: 1 }), '2026-08-15')).toBe(
      '2026-09-01',
    );
  });

  it('clamps rather than rolling into the next month', () => {
    /* The 31st in a 30-day month becomes the 30th. Rolling forward to 1 October
       drifts the series and looks like a bug to whoever receives it. */
    expect(nextOccurrence(rule({ freq: 'MONTHLY' }), '2026-08-31')).toBe('2026-09-30');
  });

  it('clamps into February, including a non-leap year', () => {
    expect(nextOccurrence(rule({ freq: 'MONTHLY' }), '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(rule({ freq: 'MONTHLY' }), '2028-01-31')).toBe('2028-02-29');
  });

  it('crosses the year boundary with an interval', () => {
    expect(nextOccurrence(rule({ freq: 'MONTHLY', interval: 6 }), '2026-10-10')).toBe('2027-04-10');
  });

  it('handles an interval longer than a year', () => {
    expect(nextOccurrence(rule({ freq: 'MONTHLY', interval: 24 }), '2026-01-10')).toBe(
      '2028-01-10',
    );
  });
});

describe('nextOccurrence — bad input', () => {
  it('returns null rather than a wrong date', () => {
    for (const raw of ['', 'tomorrow', '07-08-2026', '2026-8-7', '2026-13-01T00:00:00Z']) {
      expect(nextOccurrence(rule(), raw), raw).toBeNull();
    }
  });
});

describe('nextInstanceDates', () => {
  it('moves both dates by the same shift, keeping the task its own shape', () => {
    const next = nextInstanceDates(rule(), { startDate: '2026-08-03', dueDate: '2026-08-05' });
    expect(next).toEqual({ startDate: '2026-08-10', dueDate: '2026-08-12' });
  });

  it('anchors on the due date, so closing late does not drift the series', () => {
    /* The instance was due the 5th and finished on the 9th. The next one is
       still due the 12th — a week after it was DUE, not a week after somebody
       got round to it. */
    const next = nextInstanceDates(rule(), { startDate: null, dueDate: '2026-08-05' });
    expect(next?.dueDate).toBe('2026-08-12');
  });

  it('works from a start date alone', () => {
    const next = nextInstanceDates(rule(), { startDate: '2026-08-05', dueDate: null });
    expect(next).toEqual({ startDate: '2026-08-12', dueDate: '2026-08-12' });
  });

  it('returns null when there is no date to anchor on', () => {
    /* A repeating task with no dates has nothing to repeat against. Inventing
       "today" would make the series depend on when somebody happened to close
       the last one. */
    expect(nextInstanceDates(rule(), { startDate: null, dueDate: null })).toBeNull();
  });
});
