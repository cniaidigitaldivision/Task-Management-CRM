/* ============================================================================
 * WHICH DAYS A REPORT COVERS, AND HOW IT IS BROKEN DOWN
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-20, naming the five kinds and the breakdown each one needs:
 *
 *   *"Today's report · Yesterday's report · A week's report · A month's report · A
 *   yearly report"*
 *   *"If I want a week-wise report, show day-wise: Monday: this post, Tuesday: this
 *   report, Wednesday: this report"*
 *   *"when I say I want a month-wise report, give me a report like this: This week: 4
 *   static posts, 2 reels. Second week: this. Third week: from this date to this
 *   date"*
 *   *"when I select I want a year report, show the next pop-up in which you will ask
 *   from which month to which month"*
 *
 * Pure by contract: no clock, no database. `today` is passed in, which is what makes
 * every boundary testable at a fixed date rather than only being right on the day
 * somebody runs it (doc 20 §5).
 *
 * ── ⚠️ A PERIOD AND ITS BUCKETS ARE ONE DECISION, NOT TWO ─────────────────────
 * A week report covers seven days and is broken into seven day-buckets. A month
 * covers a month and is broken into its weeks. A year covers a range of months and is
 * broken into months. Splitting "what range" from "what granularity" would let a
 * caller ask for a month of day-buckets — thirty-one rows nobody wants — so one
 * function returns both and the pairing cannot come apart.
 *
 * ── ⚠️ EVERY BOUNDARY IS UTC, AND THE ARITHMETIC IS ON INTEGERS ───────────────
 * `new Date('2026-08-01')` is UTC midnight, so local `getMonth()` returns July
 * anywhere behind UTC. And `setDate(d + 1)` across a DST boundary can repeat or skip
 * a day. Both traps are avoided by building from `Date.UTC` parts and stepping whole
 * days in milliseconds. `lib/now.ts` and `lib/domain/cadence.ts` document the same
 * rule; this is the third module to need it.
 * ========================================================================= */

export const REPORT_KINDS = ['today', 'yesterday', 'week', 'month', 'year'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABEL: Readonly<Record<ReportKind, string>> = {
  today: "Today's report",
  yesterday: "Yesterday's report",
  week: 'This week',
  month: 'This month',
  year: 'A range of months',
};

/** One line of the breakdown table. */
export interface ReportBucket {
  /** Stable key for React, and for a test to assert against. */
  readonly key: string;
  /** "Monday 18 Aug", "Week 1 · 1–7 Aug", "August 2026". */
  readonly label: string;
  /** Inclusive 'YYYY-MM-DD'. */
  readonly start: string;
  /** Inclusive 'YYYY-MM-DD'. */
  readonly end: string;
}

export interface ReportPeriod {
  readonly kind: ReportKind;
  /** Inclusive. */
  readonly start: string;
  /** Inclusive. */
  readonly end: string;
  /** "20 August 2026", "18–24 August 2026", "August 2026", "Mar – Aug 2026". */
  readonly label: string;
  /** What the breakdown rows are: days, weeks or months. */
  readonly granularity: 'day' | 'week' | 'month';
  readonly buckets: readonly ReportBucket[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAYS_FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------------------
 * Date helpers — all UTC, all integer arithmetic
 * ------------------------------------------------------------------------- */

function ms(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

function iso(value: number): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return iso(ms(date) + days * DAY_MS);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
function isoWeekday(date: string): number {
  const jsDay = new Date(ms(date)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/** Days in the month `monthStart` begins. Day 0 of the next month is the last of this. */
function daysInMonth(monthStart: string): number {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM-01' → 'August 2026'. Never via `new Date(s).getMonth()` — see the header. */
export function monthTitle(monthStart: string): string {
  const index = Number(monthStart.slice(5, 7)) - 1;
  return index >= 0 && index < 12
    ? `${MONTHS[index]} ${monthStart.slice(0, 4)}`
    : monthStart;
}

/** '2026-08-20' → '20 August 2026'. */
export function dayTitle(date: string): string {
  const index = Number(date.slice(5, 7)) - 1;
  return `${Number(date.slice(8, 10))} ${MONTHS[index] ?? '?'} ${date.slice(0, 4)}`;
}

/** '2026-08-18' → '18 Aug'. For a compact bucket label. */
function shortDay(date: string): string {
  const index = Number(date.slice(5, 7)) - 1;
  return `${Number(date.slice(8, 10))} ${MONTHS_SHORT[index] ?? '?'}`;
}

/** The first of the month `date` falls in. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The month `count` months before `monthStart`, walking the integer so December rolls. */
export function shiftMonths(monthStart: string, count: number): string {
  let year = Number(monthStart.slice(0, 4));
  let month = Number(monthStart.slice(5, 7)) + count;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/* ---------------------------------------------------------------------------
 * THE PERIODS
 * ------------------------------------------------------------------------- */

/**
 * Resolve a report kind into its range and its breakdown.
 *
 * `from` and `to` are month starts and are used ONLY by `kind === 'year'`, where the
 * owner asked for a second prompt choosing the span. Both are optional; a year report
 * with neither defaults to the twelve months ending this month, which is the reading
 * of "a yearly report" that needs no extra input.
 */
export function reportPeriod(
  kind: ReportKind,
  today: string,
  from?: string,
  to?: string,
): ReportPeriod {
  switch (kind) {
    case 'today':
      return singleDay(kind, today);

    case 'yesterday':
      return singleDay(kind, addDays(today, -1));

    case 'week': {
      /* ⚠️ The week CONTAINING today, Monday to Sunday — not the last seven days. A
         rolling window would make "Monday" mean a different date every day the report
         is run, and the owner asked for day names. */
      const start = mondayOf(today);
      const end = addDays(start, 6);
      return {
        kind,
        start,
        end,
        label: `${shortDay(start)} – ${shortDay(end)} ${start.slice(0, 4)}`,
        granularity: 'day',
        buckets: Array.from({ length: 7 }, (_, offset) => {
          const date = addDays(start, offset);
          return {
            key: date,
            label: `${WEEKDAYS_FULL[offset]} ${shortDay(date)}`,
            start: date,
            end: date,
          };
        }),
      };
    }

    case 'month': {
      const start = monthStartOf(today);
      const length = daysInMonth(start);
      const end = addDays(start, length - 1);
      return {
        kind,
        start,
        end,
        label: monthTitle(start),
        granularity: 'week',
        buckets: monthWeeks(start, length),
      };
    }

    case 'year': {
      /* Twelve months ending this one, unless a span was chosen. */
      const last = to && MONTH_START.test(to) ? to : monthStartOf(today);
      const first = from && MONTH_START.test(from) ? from : shiftMonths(last, -11);

      /* ⚠️ Swapped bounds are corrected rather than refused. A month picker makes it
         easy to choose March-to-January by accident, and a report that silently
         covered nothing would be read as "we did nothing". */
      const [lo, hi] = first <= last ? [first, last] : [last, first];

      const buckets: ReportBucket[] = [];
      for (let month = lo; month <= hi; month = shiftMonths(month, 1)) {
        const length = daysInMonth(month);
        buckets.push({
          key: month,
          label: monthTitle(month),
          start: month,
          end: addDays(month, length - 1),
        });
        /* Guard against a pathological span — twelve years of buckets is not a report
           anybody asked for, and an unbounded loop here would hang the request. */
        if (buckets.length >= 60) break;
      }

      const lastBucket = buckets[buckets.length - 1]!;
      return {
        kind,
        start: lo,
        end: lastBucket.end,
        label:
          buckets.length === 1
            ? monthTitle(lo)
            : `${MONTHS_SHORT[Number(lo.slice(5, 7)) - 1]} ${lo.slice(0, 4)} – ${
                MONTHS_SHORT[Number(hi.slice(5, 7)) - 1]
              } ${hi.slice(0, 4)}`,
        granularity: 'month',
        buckets,
      };
    }
  }
}

function singleDay(kind: ReportKind, date: string): ReportPeriod {
  return {
    kind,
    start: date,
    end: date,
    label: dayTitle(date),
    granularity: 'day',
    /* One bucket, not zero. A day report still has a breakdown table — it just has one
       row — and giving it none would make the renderer need a special case. */
    buckets: [
      {
        key: date,
        label: `${WEEKDAYS_FULL[isoWeekday(date) - 1]} ${shortDay(date)}`,
        start: date,
        end: date,
      },
    ],
  };
}

/**
 * A month split into calendar weeks.
 *
 * ⚠️ The first and last buckets are PARTIAL where the month does not start on a
 * Monday, and their labels say the real dates. Owner: *"Third week: from this date to
 * this date."* Forcing seven-day buckets would put late-July dates in an August
 * report, which is the one thing a monthly report must not do.
 */
function monthWeeks(monthStart: string, length: number): ReportBucket[] {
  const monthEnd = addDays(monthStart, length - 1);
  const buckets: ReportBucket[] = [];

  let cursor = monthStart;
  let index = 1;

  while (cursor <= monthEnd) {
    /* The Sunday ending this cursor's week, clamped to the month. */
    const weekEnd = addDays(mondayOf(cursor), 6);
    const end = weekEnd < monthEnd ? weekEnd : monthEnd;

    buckets.push({
      key: `w${index}-${cursor}`,
      label: `Week ${index} · ${shortDay(cursor)}–${shortDay(end)}`,
      start: cursor,
      end,
    });

    cursor = addDays(end, 1);
    index += 1;
  }

  return buckets;
}

/** Guards a month value arriving from a URL or a picker. */
export const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** Guards a report kind arriving from a URL. */
export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}
