import { describe, expect, it } from 'vitest';

import {
  REPORT_KINDS,
  isReportKind,
  mondayOf,
  monthStartOf,
  reportPeriod,
  shiftMonths,
} from '../report-periods';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * Every report the owner asked for is a range plus a breakdown, and both are decided
 * here. A wrong boundary means a client's monthly report counts a post from the
 * previous month — which is the one error a report must never make, because nobody
 * re-checks a PDF.
 * ========================================================================= */

const THU = '2026-08-20'; // a Thursday
const MON = '2026-08-17';
const SUN = '2026-08-23';

describe('reportPeriod — today and yesterday', () => {
  it('covers exactly one day', () => {
    const p = reportPeriod('today', THU);
    expect(p.start).toBe(THU);
    expect(p.end).toBe(THU);
    expect(p.label).toBe('20 August 2026');
  });

  it('names the weekday, and gets it right', () => {
    expect(reportPeriod('today', THU).buckets[0]!.label).toBe('Thursday 20 Aug');
    expect(reportPeriod('today', SUN).buckets[0]!.label).toBe('Sunday 23 Aug');
  });

  it('still has one bucket, not zero', () => {
    /* A day report has a breakdown table with one row. Giving it none would make the
       renderer need a special case for the commonest report. */
    expect(reportPeriod('today', THU).buckets).toHaveLength(1);
  });

  it('steps back a day for yesterday, across a month boundary', () => {
    expect(reportPeriod('yesterday', THU).start).toBe('2026-08-19');
    expect(reportPeriod('yesterday', '2026-09-01').start).toBe('2026-08-31');
    /* And across a year. */
    expect(reportPeriod('yesterday', '2027-01-01').start).toBe('2026-12-31');
  });
});

describe('reportPeriod — week', () => {
  it('runs Monday to Sunday around the given day', () => {
    const p = reportPeriod('week', THU);
    expect(p.start).toBe('2026-08-17');
    expect(p.end).toBe('2026-08-23');
  });

  it('treats Sunday as the END of its week', () => {
    /* ⚠️ `getUTCDay()` calls Sunday 0, so the naive version jumps a week forward on
       Sundays and a Sunday report would cover the week that has not happened. */
    const p = reportPeriod('week', SUN);
    expect(p.start).toBe('2026-08-17');
    expect(p.end).toBe('2026-08-23');
  });

  it('is the week containing today, not the last seven days', () => {
    /* A rolling window would make "Monday" a different date every day the report is
       run, and the owner asked for day names. */
    expect(reportPeriod('week', MON).start).toBe(MON);
    expect(reportPeriod('week', THU).start).toBe(MON);
  });

  it('breaks down day by day, in the owner’s requested shape', () => {
    const p = reportPeriod('week', THU);
    expect(p.granularity).toBe('day');
    expect(p.buckets).toHaveLength(7);
    expect(p.buckets.map((b) => b.label)).toEqual([
      'Monday 17 Aug',
      'Tuesday 18 Aug',
      'Wednesday 19 Aug',
      'Thursday 20 Aug',
      'Friday 21 Aug',
      'Saturday 22 Aug',
      'Sunday 23 Aug',
    ]);
    /* Every bucket is a single day. */
    expect(p.buckets.every((b) => b.start === b.end)).toBe(true);
  });

  it('crosses a month boundary within one week', () => {
    const p = reportPeriod('week', '2026-09-02');
    expect(p.start).toBe('2026-08-31');
    expect(p.end).toBe('2026-09-06');
  });
});

describe('reportPeriod — month', () => {
  it('covers the whole calendar month', () => {
    const p = reportPeriod('month', THU);
    expect(p.start).toBe('2026-08-01');
    expect(p.end).toBe('2026-08-31');
    expect(p.label).toBe('August 2026');
  });

  it('gets February right, including a leap year', () => {
    expect(reportPeriod('month', '2026-02-14').end).toBe('2026-02-28');
    expect(reportPeriod('month', '2028-02-14').end).toBe('2028-02-29');
  });

  it('breaks down week by week with real date ranges', () => {
    /* Owner: *"This week: 4 static posts, 2 reels. Second week: this. Third week: from
       this date to this date."* August 2026 starts on a Saturday. */
    const p = reportPeriod('month', THU);
    expect(p.granularity).toBe('week');
    expect(p.buckets[0]!.label).toBe('Week 1 · 1 Aug–2 Aug');
    expect(p.buckets[1]!.label).toBe('Week 2 · 3 Aug–9 Aug');
    expect(p.buckets[p.buckets.length - 1]!.end).toBe('2026-08-31');
  });

  it('⚠️ never lets a bucket leave the month', () => {
    /* The one error a monthly report must not make. A forced seven-day first bucket
       would pull late-July dates into an August report. */
    for (const month of ['2026-01-15', '2026-02-15', '2026-08-15', '2026-11-15', '2027-05-15']) {
      const p = reportPeriod('month', month);
      for (const bucket of p.buckets) {
        expect(bucket.start >= p.start, `${month}: ${bucket.start}`).toBe(true);
        expect(bucket.end <= p.end, `${month}: ${bucket.end}`).toBe(true);
      }
    }
  });

  it('covers every day of the month exactly once', () => {
    /* Contiguous and non-overlapping — otherwise a post is counted twice or dropped. */
    const p = reportPeriod('month', THU);
    expect(p.buckets[0]!.start).toBe(p.start);
    for (let i = 1; i < p.buckets.length; i += 1) {
      const prevEnd = new Date(`${p.buckets[i - 1]!.end}T00:00:00Z`).getTime();
      const thisStart = new Date(`${p.buckets[i]!.start}T00:00:00Z`).getTime();
      expect(thisStart - prevEnd).toBe(86_400_000);
    }
    expect(p.buckets[p.buckets.length - 1]!.end).toBe(p.end);
  });
});

describe('reportPeriod — year', () => {
  it('defaults to the twelve months ending this one', () => {
    const p = reportPeriod('year', THU);
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[0]!.key).toBe('2025-09-01');
    expect(p.buckets[11]!.key).toBe('2026-08-01');
    expect(p.granularity).toBe('month');
  });

  it('honours a chosen span', () => {
    /* Owner: *"show the next pop-up in which you will ask from which month to which
       month. Then generate the report according to that."* */
    const p = reportPeriod('year', THU, '2026-03-01', '2026-08-01');
    expect(p.buckets).toHaveLength(6);
    expect(p.label).toBe('Mar 2026 – Aug 2026');
    expect(p.start).toBe('2026-03-01');
    expect(p.end).toBe('2026-08-31');
  });

  it('corrects a span chosen backwards rather than covering nothing', () => {
    /* ⚠️ A month picker makes March-to-January easy to choose by accident, and a
       report that silently covered nothing would read as "we did nothing". */
    const p = reportPeriod('year', THU, '2026-08-01', '2026-03-01');
    expect(p.buckets).toHaveLength(6);
    expect(p.start).toBe('2026-03-01');
  });

  it('handles a single month, and a span crossing a year', () => {
    const one = reportPeriod('year', THU, '2026-05-01', '2026-05-01');
    expect(one.buckets).toHaveLength(1);
    expect(one.label).toBe('May 2026');

    const across = reportPeriod('year', THU, '2025-11-01', '2026-02-01');
    expect(across.buckets.map((b) => b.key)).toEqual([
      '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01',
    ]);
  });

  it('ignores a malformed span instead of producing nonsense', () => {
    const p = reportPeriod('year', THU, 'not-a-month', '2026-13-01');
    expect(p.buckets).toHaveLength(12);
  });

  it('refuses to build an unbounded number of buckets', () => {
    /* A pathological span must not hang the request. */
    const p = reportPeriod('year', THU, '1990-01-01', '2026-08-01');
    expect(p.buckets.length).toBeLessThanOrEqual(60);
  });

  it('ends each bucket on the real last day of that month', () => {
    const p = reportPeriod('year', THU, '2026-01-01', '2026-03-01');
    expect(p.buckets.map((b) => b.end)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});

describe('helpers', () => {
  it('mondayOf handles every weekday', () => {
    expect(mondayOf('2026-08-17')).toBe('2026-08-17'); // Mon
    expect(mondayOf('2026-08-20')).toBe('2026-08-17'); // Thu
    expect(mondayOf('2026-08-23')).toBe('2026-08-17'); // Sun
    expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // across a year
  });

  it('shiftMonths rolls the year in both directions', () => {
    expect(shiftMonths('2026-08-01', 1)).toBe('2026-09-01');
    expect(shiftMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonths('2026-08-01', -11)).toBe('2025-09-01');
    expect(shiftMonths('2026-08-01', 24)).toBe('2028-08-01');
  });

  it('monthStartOf keeps the month it was given', () => {
    /* ⚠️ Never via `new Date(s)` — that is UTC midnight and local parts would return
       the previous month anywhere behind UTC. */
    expect(monthStartOf('2026-08-31')).toBe('2026-08-01');
    expect(monthStartOf('2026-01-01')).toBe('2026-01-01');
  });

  it('isReportKind guards a URL value', () => {
    for (const kind of REPORT_KINDS) expect(isReportKind(kind)).toBe(true);
    expect(isReportKind('weekly')).toBe(false);
    expect(isReportKind('')).toBe(false);
    expect(isReportKind("today'; drop table users; --")).toBe(false);
  });

  it('every kind produces a coherent period', () => {
    /* A property over all five: start on or before end, at least one bucket, and every
       bucket inside the range. */
    for (const kind of REPORT_KINDS) {
      const p = reportPeriod(kind, THU);
      expect(p.start <= p.end, kind).toBe(true);
      expect(p.buckets.length, kind).toBeGreaterThan(0);
      for (const b of p.buckets) {
        expect(b.start >= p.start, `${kind} ${b.key}`).toBe(true);
        expect(b.end <= p.end, `${kind} ${b.key}`).toBe(true);
        expect(b.start <= b.end, `${kind} ${b.key}`).toBe(true);
      }
    }
  });
});
