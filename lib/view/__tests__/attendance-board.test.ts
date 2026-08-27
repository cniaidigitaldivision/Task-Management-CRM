import { describe, expect, it } from 'vitest';

import {
  NO_FILTERS,
  RANGE_KEYS,
  buildAttendanceBoard,
  countRangeDays,
  customRange,
  defaultGranularity,
  filterAttendanceRows,
  groupColumns,
  rangeLabel,
  resolveRange,
  shortDate,
  type BoardPerson,
  type BoardRecord,
} from '../attendance-board';

/* ============================================================================
 * THE ATTENDANCE BOARD
 * ----------------------------------------------------------------------------
 * The point of these: the five counters, the column per day and the table are
 * three projections of ONE classification, and the bug worth guarding against is
 * them disagreeing. Several tests below assert exactly that rather than any
 * individual number.
 * ========================================================================= */

/* The week of Monday 2026-08-24 → Sunday 2026-08-30. */
const MON = '2026-08-24';
const TUE = '2026-08-25';
const FRI = '2026-08-28';
const SUN = '2026-08-30';

const blue: BoardPerson = {
  id: 'u1',
  name: 'Kashif Ahmed',
  roleTitle: 'Team Coordinator',
  role: 'team_coordinator',
  avatarUrl: null,
  officeTeam: 'blue_area',
};
const wah: BoardPerson = {
  id: 'u2',
  name: 'Lareeb Khan',
  roleTitle: 'Developer',
  role: 'member',
  avatarUrl: null,
  officeTeam: 'wah',
};

/** Karachi is UTC+5. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${date}T${String(h - 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
};

const record = (userId: string, onDate: string, inAt: string | null, outAt: string | null): BoardRecord => ({
  userId,
  onDate,
  checkedInAt: inAt ? at(onDate, inAt) : null,
  checkedOutAt: outAt ? at(onDate, outAt) : null,
  editedByName: null,
  editNote: null,
});

/** Everything settled: a week entirely in the past. */
const past = { today: '2026-09-07', nowMinutes: 12 * 60 };

const build = (
  people: BoardPerson[],
  records: BoardRecord[],
  extra: Partial<Parameters<typeof buildAttendanceBoard>[0]> = {},
) =>
  buildAttendanceBoard({
    people,
    records,
    leave: [],
    from: MON,
    to: SUN,
    ...past,
    ...extra,
  });

describe('the grid', () => {
  it('has a cell for every person on every day, recorded or not', () => {
    /* ⚠️ THE BUG THIS EXISTS FOR. Iterating the records would give a perfect month
       to anybody who never checked in — they simply would not appear. */
    const board = build([blue, wah], []);
    expect(board.cells).toHaveLength(2 * 7);
  });

  it('marks a person with no record at all as absent on their working days', () => {
    const board = build([blue], []);
    const absences = board.cells.filter((c) => c.status === 'absent');
    /* Blue Area works Mon–Sat: six absences, and Sunday off. */
    expect(absences).toHaveLength(6);
    expect(board.cells.filter((c) => c.status === 'off').map((c) => c.onDate)).toEqual([SUN]);
  });

  it('gives the two offices different days off in the same week', () => {
    const board = build([blue, wah], []);
    const off = board.cells.filter((c) => c.status === 'off');
    expect(off).toHaveLength(2);
    expect(off.find((c) => c.userId === blue.id)?.onDate).toBe(SUN);
    expect(off.find((c) => c.userId === wah.id)?.onDate).toBe(FRI);
  });

  it('computes hours and overtime per cell', () => {
    const board = build([blue], [record(blue.id, MON, '10:00', '18:30')]);
    const monday = board.cells.find((c) => c.onDate === MON);
    expect(monday?.minutes).toBe(510);
    expect(monday?.overtime).toBe(30);
  });
});

describe('leave', () => {
  it('turns an absence into leave for the days it covers', () => {
    const board = build([blue], [], {
      leave: [{ userId: blue.id, from: TUE, to: '2026-08-26' }],
    });
    const statuses = board.cells.filter((c) => c.status === 'on_leave').map((c) => c.onDate);
    expect(statuses).toEqual([TUE, '2026-08-26']);
    expect(board.summary.absent).toBe(4);
  });

  it('keeps leave out of the attendance rate', () => {
    /* Somebody on leave all week has no rate to answer for. */
    const board = build([blue], [], { leave: [{ userId: blue.id, from: MON, to: SUN }] });
    expect(board.summary.settled).toBe(0);
    expect(board.summary.rate).toBeNull();
  });

  it('does not apply one person’s leave to another', () => {
    const board = build([blue, wah], [], { leave: [{ userId: wah.id, from: MON, to: SUN }] });
    expect(board.cells.filter((c) => c.userId === blue.id && c.status === 'on_leave')).toHaveLength(0);
  });
});

describe('the table', () => {
  it('leaves days off out of the rows but keeps them in the cells', () => {
    /* ⚠️ Thirty "Day off" rows a month would bury the rows somebody came for, but
       the counters still need those days to know they are not absences. */
    const board = build([blue], []);
    expect(board.rows.some((r) => r.status === 'off')).toBe(false);
    expect(board.cells.some((c) => c.status === 'off')).toBe(true);
  });

  it('puts the newest day first, then orders by name', () => {
    const board = build([wah, blue], [record(blue.id, MON, '10:00', '18:00')]);
    expect(board.rows[0].onDate).toBe(SUN);
    const monday = board.rows.filter((r) => r.onDate === MON);
    expect(monday.map((r) => r.name)).toEqual(['Kashif Ahmed', 'Lareeb Khan']);
  });

  it('carries the person’s office label onto every row', () => {
    const board = build([blue, wah], []);
    expect(board.rows.find((r) => r.userId === blue.id)?.teamLabel).toBe('Blue Area');
    expect(board.rows.find((r) => r.userId === wah.id)?.teamLabel).toBe('Wah');
  });

  it('carries the month’s late count onto every one of that person’s rows', () => {
    const board = build([blue], [
      record(blue.id, MON, '11:00', '19:00'),
      record(blue.id, TUE, '10:45', '18:00'),
    ]);
    const mine = board.rows.filter((r) => r.userId === blue.id);
    expect(mine.every((r) => r.lateThisMonth === 2)).toBe(true);
  });
});

describe('the counters and the table agree', () => {
  const board = build([blue, wah], [
    record(blue.id, MON, '09:58', '18:05'),
    record(blue.id, TUE, '11:20', '19:00'),
    record(wah.id, MON, '10:30', '18:00'),
  ]);

  it('counts the same lates as the table shows', () => {
    /* ⚠️ The actual assertion of the file's premise: one classification, many
       views. If these two ever differ, a card is lying about the rows below it. */
    expect(board.summary.late).toBe(board.rows.filter((r) => r.status === 'late').length);
  });

  it('counts the same presents as the table shows', () => {
    expect(board.summary.present).toBe(board.rows.filter((r) => r.status === 'present').length);
  });

  it('counts the same absences as the table shows', () => {
    expect(board.summary.absent).toBe(board.rows.filter((r) => r.status === 'absent').length);
  });

  it('treats 10:30 as on time and 11:20 as late', () => {
    expect(board.summary.present).toBe(2);
    expect(board.summary.late).toBe(1);
  });

  it('sums the per-person totals to the whole', () => {
    const sum = (pick: (p: (typeof board.perPerson)[number]) => number) =>
      board.perPerson.reduce((a, p) => a + pick(p), 0);
    expect(sum((p) => p.present)).toBe(board.summary.present);
    expect(sum((p) => p.absent)).toBe(board.summary.absent);
    expect(sum((p) => p.late)).toBe(board.summary.late);
  });
});

describe('the column per day', () => {
  const board = build([blue, wah], [
    record(blue.id, MON, '09:58', '18:00'),
    record(wah.id, MON, '11:30', '19:00'),
  ]);

  it('has one column per day in the range', () => {
    expect(board.days).toHaveLength(7);
    expect(board.days[0].onDate).toBe(MON);
    expect(board.days[0].weekday).toBe('Mon');
    expect(board.days.at(-1)?.weekday).toBe('Sun');
  });

  it('counts a late arrival as present in the column', () => {
    /* ⚠️ The chart draws Present against Absent. Somebody who arrived at 11:30 was
       there, so putting them in the Absent column would be wrong twice: it
       overstates absence and hides the attendance. */
    const monday = board.days[0];
    expect(monday.present).toBe(2);
    expect(monday.late).toBe(1);
    expect(monday.absent).toBe(0);
  });

  it('does not count a day off as somebody expected in', () => {
    const sunday = board.days.find((d) => d.onDate === SUN);
    /* Blue Area is off; Wah works Sunday and did not check in. */
    expect(sunday?.expectedIn).toBe(1);
  });
});

describe('today', () => {
  it('summarises only today, and does not call the morning an absence', () => {
    const board = build([blue, wah], [record(blue.id, TUE, '10:04', null)], {
      today: TUE,
      nowMinutes: 11 * 60,
    });
    expect(board.todaySummary.present).toBe(1);
    expect(board.todaySummary.absent).toBe(0);
    /* Wah works Tuesday and has not arrived — not in yet, not absent. */
    expect(board.todaySummary.expected).toBe(1);
  });

  it('settles today into an absence after 6pm', () => {
    const board = build([blue, wah], [record(blue.id, TUE, '10:04', '18:10')], {
      today: TUE,
      nowMinutes: 19 * 60,
    });
    expect(board.todaySummary.absent).toBe(1);
  });

  it('has no today summary when today is outside the range', () => {
    const board = build([blue], [], { today: '2026-09-20', nowMinutes: 600 });
    expect(board.todaySummary.present).toBe(0);
    expect(board.todaySummary.absent).toBe(0);
  });
});

describe('resolveRange', () => {
  it('runs this week Monday to Sunday, whatever day it is', () => {
    /* ⚠️ Monday-first. A Sunday-first week would put Blue Area's day off at the
       start of its own week, and the reference's chart runs Mon→Sun. */
    const wed = resolveRange('this_week', '2026-08-26');
    expect(wed.from).toBe(MON);
    expect(wed.to).toBe(SUN);
  });

  it('keeps the whole week even when it is only Tuesday', () => {
    /* A week chart that stops at today makes the rest of the week look absent. */
    expect(resolveRange('this_week', TUE).to).toBe(SUN);
  });

  it('runs this month first to last', () => {
    const month = resolveRange('this_month', TUE);
    expect(month.from).toBe('2026-08-01');
    expect(month.to).toBe('2026-08-31');
  });

  it('runs last month, crossing a year end correctly', () => {
    expect(resolveRange('last_month', '2026-01-14')).toMatchObject({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('handles February in a leap year', () => {
    expect(resolveRange('this_month', '2028-02-10').to).toBe('2028-02-29');
  });

  it('counts the rolling windows inclusively', () => {
    expect(resolveRange('last_7', TUE)).toMatchObject({ from: '2026-08-19', to: TUE });
    expect(resolveRange('last_30', TUE).from).toBe('2026-07-27');
  });
});

describe('labels', () => {
  it('writes a short date without formatting it', () => {
    /* Assembled from the string, so the server and the browser cannot disagree. */
    expect(shortDate('2026-08-01')).toBe('1 Aug');
    expect(shortDate('2026-12-31')).toBe('31 Dec');
  });

  it('writes the range with one year at the end', () => {
    expect(rangeLabel({ from: '2026-08-01', to: '2026-08-31' })).toBe('1 Aug – 31 Aug 2026');
  });
});

/* ============================================================================
 * THE 2026-08-25 REVISION
 * ----------------------------------------------------------------------------
 * Grouping, the wider set of periods, and the filter the export shares with the
 * table. Every one of these is a place where the screen and the exported file
 * could quietly disagree.
 * ========================================================================= */

describe('the periods', () => {
  it('makes a single day out of today and yesterday', () => {
    /* ⚠️ A single day is a range whose ends are equal, not a mode. Everything
       downstream then handles it without a branch. */
    expect(resolveRange('today', TUE)).toMatchObject({ from: TUE, to: TUE });
    expect(resolveRange('yesterday', TUE)).toMatchObject({ from: MON, to: MON });
  });

  it('crosses a month end for yesterday', () => {
    expect(resolveRange('yesterday', '2026-09-01')).toMatchObject({
      from: '2026-08-31',
      to: '2026-08-31',
    });
  });

  it('offers no "custom" preset in the list', () => {
    /* It is what the two date fields produce, not something to pick. */
    expect(RANGE_KEYS).not.toContain('custom');
    expect(RANGE_KEYS).toContain('today');
  });
});

describe('customRange', () => {
  it('takes the two dates as given', () => {
    expect(customRange(MON, SUN, TUE)).toMatchObject({ key: 'custom', from: MON, to: SUN });
  });

  it('orders them, rather than returning nothing', () => {
    /* ⚠️ Somebody who picks the end first means the span between them. Returning
       an empty range would look like a page with no data. */
    expect(customRange(SUN, MON, TUE)).toMatchObject({ from: MON, to: SUN });
  });

  it('labels a single day as that day', () => {
    expect(customRange(TUE, TUE, TUE).label).toBe('25 Aug');
  });

  it('falls back to the month for nonsense rather than erroring', () => {
    expect(customRange('', '', TUE)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
    expect(customRange('yesterday', 'tomorrow', TUE).key).toBe('this_month');
  });
});

describe('groupColumns', () => {
  const board = build([blue, wah], [
    record(blue.id, MON, '09:58', '18:00'),
    record(blue.id, TUE, '11:30', '19:00'),
    record(wah.id, MON, '10:00', '18:00'),
  ]);

  it('leaves daily alone', () => {
    expect(groupColumns(board.days, 'daily')).toHaveLength(7);
  });

  it('folds a week into one column', () => {
    /* ⚠️ The whole point: 31 columns in a month card is a 12px slot per day, which
       is what made the first build's chart unreadable. */
    const weekly = groupColumns(board.days, 'weekly');
    expect(weekly).toHaveLength(1);
    expect(weekly[0].dayLabel).toBe('Week of 24 Aug');
  });

  it('sums rather than averages, so both views share a scale', () => {
    const weekly = groupColumns(board.days, 'weekly');
    const dailyTotal = board.days.reduce((a, d) => a + d.present, 0);
    expect(weekly[0].present).toBe(dailyTotal);
  });

  it('splits a span that crosses a Monday into two weeks', () => {
    const long = buildAttendanceBoard({
      people: [blue],
      records: [],
      leave: [],
      from: '2026-08-27',
      to: '2026-09-02',
      ...past,
    });
    const weekly = groupColumns(long.days, 'weekly');
    expect(weekly).toHaveLength(2);
    expect(weekly.map((w) => w.dayLabel)).toEqual(['Week of 24 Aug', 'Week of 31 Aug']);
  });

  it('folds months, and names them', () => {
    const long = buildAttendanceBoard({
      people: [blue],
      records: [],
      leave: [],
      from: '2026-08-30',
      to: '2026-09-02',
      ...past,
    });
    const monthly = groupColumns(long.days, 'monthly');
    expect(monthly).toHaveLength(2);
    expect(monthly[0].dayLabel).toBe('Aug 26');
    expect(monthly[1].dayLabel).toBe('Sep 26');
  });

  it('survives an empty board', () => {
    expect(groupColumns([], 'weekly')).toEqual([]);
    expect(groupColumns([], 'monthly')).toEqual([]);
  });
});

describe('filterAttendanceRows', () => {
  const board = build([blue, wah], [
    record(blue.id, MON, '09:58', '18:00'),
    record(blue.id, TUE, '11:30', '19:00'),
    record(wah.id, MON, '10:00', '18:00'),
  ]);

  it('returns everything with no filters', () => {
    expect(filterAttendanceRows(board.rows, NO_FILTERS)).toHaveLength(board.rows.length);
  });

  it('narrows by team', () => {
    const wahOnly = filterAttendanceRows(board.rows, { ...NO_FILTERS, team: 'wah' });
    expect(wahOnly.every((r) => r.officeTeam === 'wah')).toBe(true);
    expect(wahOnly.length).toBeGreaterThan(0);
  });

  it('narrows by status', () => {
    const late = filterAttendanceRows(board.rows, { ...NO_FILTERS, status: 'late' });
    expect(late).toHaveLength(1);
    expect(late[0].onDate).toBe(TUE);
  });

  it('narrows to a single day', () => {
    const one = filterAttendanceRows(board.rows, { ...NO_FILTERS, onDate: MON });
    expect(one.every((r) => r.onDate === MON)).toBe(true);
    expect(one).toHaveLength(2);
  });

  it('matches a name case-insensitively and on a fragment', () => {
    expect(filterAttendanceRows(board.rows, { ...NO_FILTERS, query: 'kash' }).length).toBeGreaterThan(0);
    expect(filterAttendanceRows(board.rows, { ...NO_FILTERS, query: 'KASHIF' }).length).toBeGreaterThan(0);
  });

  it('ignores surrounding spaces in the search', () => {
    expect(filterAttendanceRows(board.rows, { ...NO_FILTERS, query: '   ' })).toHaveLength(
      board.rows.length,
    );
  });

  it('combines filters', () => {
    const both = filterAttendanceRows(board.rows, {
      ...NO_FILTERS,
      team: 'blue_area',
      onDate: TUE,
      status: 'late',
    });
    expect(both).toHaveLength(1);
  });

  it('returns nothing when nothing matches, rather than everything', () => {
    /* A filter that silently falls back to "all" is worse than an empty table:
       somebody exports it believing it was narrowed. */
    expect(filterAttendanceRows(board.rows, { ...NO_FILTERS, query: 'nobody' })).toEqual([]);
  });
});

/* ============================================================================
 * The grouping a period opens on
 * ----------------------------------------------------------------------------
 * Owner: the page opens on this month and the overview must open on Weekly. The
 * risk in satisfying that with a constant is the NEXT click — a one-day period
 * grouped weekly draws a column labelled "Week of…" holding a single day, which
 * is a chart that misstates its own contents.
 * ========================================================================= */

describe('defaultGranularity', () => {
  it('opens this month on weekly, which is what the owner asked for', () => {
    expect(defaultGranularity(resolveRange('this_month', '2026-08-25'))).toBe('weekly');
    expect(defaultGranularity(resolveRange('last_month', '2026-08-25'))).toBe('weekly');
    expect(defaultGranularity(resolveRange('last_30', '2026-08-25'))).toBe('weekly');
  });

  it('keeps short periods daily, so a single day is never drawn as a week', () => {
    expect(defaultGranularity(resolveRange('today', '2026-08-25'))).toBe('daily');
    expect(defaultGranularity(resolveRange('yesterday', '2026-08-25'))).toBe('daily');
    /* A week MUST stay daily — grouping it weekly collapses Mon–Sun into one bar. */
    expect(defaultGranularity(resolveRange('this_week', '2026-08-25'))).toBe('daily');
    expect(defaultGranularity(resolveRange('last_7', '2026-08-25'))).toBe('daily');
  });

  it('folds a long custom span into months rather than a hundred columns', () => {
    expect(defaultGranularity({ from: '2026-01-01', to: '2026-12-31' })).toBe('monthly');
  });

  it('never produces a chart with more columns than it can label', () => {
    /* The real guarantee, asserted across every preset rather than one by one. */
    for (const key of RANGE_KEYS) {
      const range = resolveRange(key, '2026-08-25');
      const columns = groupColumns(
        buildAttendanceBoard({
          people: [blue, wah],
          records: [],
          leave: [],
          from: range.from,
          to: range.to,
          today: '2026-08-25',
          nowMinutes: 15 * 60,
        }).days,
        defaultGranularity(range),
      );
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.length).toBeLessThanOrEqual(18);
    }
  });
});

describe('countRangeDays', () => {
  it('counts both ends', () => {
    expect(countRangeDays({ from: '2026-08-01', to: '2026-08-31' })).toBe(31);
    expect(countRangeDays({ from: '2026-08-25', to: '2026-08-25' })).toBe(1);
  });

  it('falls back to one day rather than NaN', () => {
    /* NaN compares false against every threshold, so an unparseable range would
       otherwise fall through to the LAST branch of defaultGranularity and open a
       month-grouped chart of one day. */
    expect(countRangeDays({ from: 'nonsense', to: '2026-08-31' })).toBe(1);
    expect(defaultGranularity({ from: 'nonsense', to: 'rubbish' })).toBe('daily');
  });
});
