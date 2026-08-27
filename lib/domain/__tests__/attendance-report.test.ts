import { describe, expect, it } from 'vitest';

import {
  attendanceCharts,
  buildAttendanceReport,
  describeAttendanceFilters,
  type AttendanceReportInput,
} from '../attendance-report';
import { buildAttendanceBoard, groupColumns, type BoardPerson } from '@/lib/view/attendance-board';

/* ============================================================================
 * ATTENDANCE AS A REPORT
 * ----------------------------------------------------------------------------
 * The owner asked for the PDF to use the Reports page's template, so what matters
 * here is that the `Report` handed to that template is well formed — right number
 * of cells per row, figures that match the board, and notes that state what the
 * numbers exclude. A malformed row would throw inside pdf-lib, several layers away
 * from the cause.
 * ========================================================================= */

const MON = '2026-08-24';
const TUE = '2026-08-25';
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

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${date}T${String(h - 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
};

const board = buildAttendanceBoard({
  people: [blue, wah],
  records: [
    {
      userId: blue.id,
      onDate: MON,
      checkedInAt: at(MON, '09:58'),
      checkedOutAt: at(MON, '18:20'),
      editedByName: null,
      editNote: null,
    },
    {
      userId: blue.id,
      onDate: TUE,
      checkedInAt: at(TUE, '11:30'),
      checkedOutAt: null,
      editedByName: null,
      editNote: null,
    },
  ],
  leave: [],
  from: MON,
  to: SUN,
  today: '2026-09-07',
  nowMinutes: 720,
});

const input = (over: Partial<AttendanceReportInput> = {}): AttendanceReportInput => ({
  board,
  rows: board.rows,
  from: MON,
  to: SUN,
  rangeLabel: '24 Aug – 30 Aug 2026',
  filters: [],
  canViewAll: true,
  columns: groupColumns(board.days, 'daily'),
  ...over,
});

describe('the report', () => {
  it('is not one of the four analytical types', () => {
    /* ⚠️ If this ever became one of them it would appear in the Reports page's own
       type dropdown, whose builder cannot produce it. */
    expect(buildAttendanceReport(input()).type).toBe('attendance');
  });

  it('gives every row exactly as many cells as there are columns', () => {
    /* ⚠️ The failure this prevents is ugly and remote: a short row makes the print
       sheet draw a column's text into the next column's box, or throw inside
       pdf-lib with nothing pointing back here. */
    const report = buildAttendanceReport(input());
    expect(report.rows.length).toBeGreaterThan(0);
    for (const row of report.rows) {
      expect(row).toHaveLength(report.columns.length);
    }
  });

  it('drops the team column for somebody who can only see themselves', () => {
    const mine = buildAttendanceReport(input({ canViewAll: false }));
    expect(mine.columns.some((c) => c.key === 'team')).toBe(false);
    for (const row of mine.rows) {
      expect(row).toHaveLength(mine.columns.length);
    }
  });

  it('carries the period through unchanged, for the file name and the header', () => {
    expect(buildAttendanceReport(input()).period).toEqual({ start: MON, end: SUN });
  });

  it('states the late rule and both teams’ days in the notes', () => {
    const notes = buildAttendanceReport(input()).notes.join(' ');
    expect(notes).toContain('10:30 AM');
    expect(notes).toContain('Sunday');
    expect(notes).toContain('Friday');
  });

  it('says what the rate excludes, because a total that excludes things must', () => {
    const notes = buildAttendanceReport(input()).notes.join(' ');
    expect(notes).toContain('leave');
    expect(notes).toContain('settle');
  });

  it('repeats the filters in the notes when there are any', () => {
    const report = buildAttendanceReport(input({ filters: ['Team: Wah', 'Status: Late'] }));
    expect(report.notes.some((n) => n.includes('Team: Wah'))).toBe(true);
  });

  it('explains a zero rate rather than printing it bare', () => {
    /* A figure cell cannot be null, so an unsettled period would print "0%" — the
       note is the only place that can say it means "nothing counted yet". */
    const empty = buildAttendanceBoard({
      people: [blue],
      records: [],
      leave: [],
      from: '2026-09-10',
      to: '2026-09-12',
      today: '2026-09-07',
      nowMinutes: 720,
    });
    const report = buildAttendanceReport(input({ board: empty, rows: empty.rows }));
    expect(report.notes.some((n) => n.includes('has settled'))).toBe(true);
  });

  it('reports figures that match the board', () => {
    const report = buildAttendanceReport(input());
    const figure = (label: string) => report.figures.find((f) => f.label === label)?.value;
    expect(figure('Present')).toEqual({ kind: 'number', value: board.summary.present });
    expect(figure('Late')).toEqual({ kind: 'number', value: board.summary.late });
    expect(figure('Absent')).toEqual({ kind: 'number', value: board.summary.absent });
  });

  it('writes an open day as "No check-out" rather than a blank', () => {
    const report = buildAttendanceReport(input());
    const cells = report.rows.flat().filter((c) => c.kind === 'text');
    expect(cells.some((c) => c.kind === 'text' && c.value === 'No check-out')).toBe(true);
  });
});

describe('the charts', () => {
  it('draws the same two the page draws', () => {
    const charts = attendanceCharts(input());
    expect(charts.map((c) => c.kind)).toEqual(['bars', 'donut']);
  });

  it('follows the granularity, so the PDF matches what was on screen', () => {
    const weekly = attendanceCharts(input({ columns: groupColumns(board.days, 'weekly') }));
    const bars = weekly.find((c) => c.kind === 'bars');
    expect(bars?.kind === 'bars' && bars.bars).toHaveLength(1);
  });

  it('leaves out slices with nothing in them', () => {
    /* A legend entry reading "On leave 0" is noise on a printed page. */
    const donut = attendanceCharts(input()).find((c) => c.kind === 'donut');
    expect(donut?.kind === 'donut' && donut.slices.every((s) => s.value > 0)).toBe(true);
  });

  it('uses token names, never colours', () => {
    /* The print sheet maps tokens to inks; a literal colour would arrive as one. */
    for (const chart of attendanceCharts(input())) {
      const data = chart.kind === 'bars' ? chart.bars : chart.kind === 'donut' ? chart.slices : [];
      for (const datum of data) {
        expect(datum.token).not.toContain('#');
        expect(datum.token).not.toContain('var(');
      }
    }
  });

  it('produces no charts at all for an empty period', () => {
    const empty = buildAttendanceBoard({
      people: [],
      records: [],
      leave: [],
      from: MON,
      to: MON,
      today: '2026-09-07',
      nowMinutes: 720,
    });
    expect(attendanceCharts(input({ board: empty, rows: [], columns: [] }))).toEqual([]);
  });
});

describe('describeAttendanceFilters', () => {
  it('says nothing when nothing is narrowed', () => {
    expect(describeAttendanceFilters({ team: 'all', status: 'all', query: '', onDate: '' })).toEqual(
      [],
    );
  });

  it('names the office rather than its key', () => {
    expect(
      describeAttendanceFilters({ team: 'wah', status: 'all', query: '', onDate: '' }),
    ).toEqual(['Team: Wah']);
  });

  it('names the status in the words the page uses', () => {
    expect(
      describeAttendanceFilters({ team: 'all', status: 'on_leave', query: '', onDate: '' }),
    ).toEqual(['Status: On leave']);
  });

  it('quotes the search and reports the day', () => {
    expect(
      describeAttendanceFilters({ team: 'all', status: 'all', query: ' kash ', onDate: TUE }),
    ).toEqual(['Name contains "kash"', `Day: ${TUE}`]);
  });
});
