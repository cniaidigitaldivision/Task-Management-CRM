import type { ChartSpec } from '@/lib/domain/report-charts';
import type { Cell, Report } from '@/lib/domain/reports';
import {
  ATTENDANCE_STATUS_META,
  LATE_AFTER_MINUTES,
  clockLabel,
  officeTeam,
} from '@/lib/domain/attendance';
import type { AttendanceBoard, DayColumn } from '@/lib/view/attendance-board';

/* ============================================================================
 * ATTENDANCE AS A REPORT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"When exporting the PDF you should use the same template
 * that you have already been using. On the report page the PDF template should be
 * the same. Just put this data over there."*
 *
 * So attendance does not get a print layout of its own. It gets turned into the
 * `Report` shape that lib/pdf/report-sheet.ts already draws — the same header
 * band, the same figure cards, the same table, the same notes block — and the
 * same `ChartSpec` list the Reports page hands it, so the graphs in the PDF are
 * the ones drawn on screen.
 *
 * ── ⚠️ WHY THIS IS A PURE FUNCTION AND NOT PART OF THE ACTION ───────────────
 * The CSV, the spreadsheet and the PDF all come from this one object. Building it
 * inside the export action would mean three formats agreeing by luck; building it
 * here means the numbers in the PDF are the numbers in the CSV by construction,
 * and the whole thing is testable without a database.
 *
 * ── ⚠️ IT TAKES A BOARD, NOT A DATE RANGE ───────────────────────────────────
 * The board is what the SCREEN was showing, filters and all. Owner: *"The same
 * filter that is applied should be applied the same way during export."* Taking a
 * range instead would re-query and quietly export something else.
 * ========================================================================= */

const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number): Cell => ({ kind: 'number', value });
const mins = (value: number | null): Cell => ({ kind: 'duration', value: value ?? 0 });
const date = (value: string): Cell => ({ kind: 'date', value });
const pct = (value: number): Cell => ({ kind: 'percent', value });

/** `10:30 AM`, from the constant rather than typed out again. */
function lateAfterLabel(): string {
  const h = Math.floor(LATE_AFTER_MINUTES / 60);
  const m = LATE_AFTER_MINUTES % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export interface AttendanceReportInput {
  readonly board: AttendanceBoard;
  /** ⚠️ The FILTERED rows, exactly as the table is showing them. */
  readonly rows: AttendanceBoard['rows'];
  readonly from: string;
  readonly to: string;
  readonly rangeLabel: string;
  /** What the reader narrowed to, in words. Printed under the title. */
  readonly filters: readonly string[];
  /** Whether the reader may see everybody, which decides the columns. */
  readonly canViewAll: boolean;
  /** Grouped columns, so the PDF's chart matches the one on screen. */
  readonly columns: readonly DayColumn[];
}

/**
 * One row per person-day, plus the figures and the notes.
 *
 * ⚠️ Days off are absent from the rows for the same reason they are absent from
 * the table: thirty "Day off" lines a month bury the six somebody printed this to
 * read. The notes block says so, because a total that excludes something has to
 * say what.
 */
export function buildAttendanceReport(input: AttendanceReportInput): Report {
  const s = input.board.summary;

  return {
    /* Not one of the four analytical reports — see the note on `Report['type']`. */
    type: 'attendance',
    title: 'Attendance',
    subtitle: input.canViewAll
      ? `Every recorded day · ${input.rangeLabel}`
      : `Your attendance · ${input.rangeLabel}`,
    period: { start: input.from, end: input.to },

    columns: [
      { key: 'employee', label: 'Employee', kind: 'text', width: 26 },
      { key: 'role', label: 'Role', kind: 'text', width: 22 },
      ...(input.canViewAll
        ? [{ key: 'team', label: 'Team', kind: 'text' as const, width: 12 }]
        : []),
      { key: 'date', label: 'Date', kind: 'date' as const, width: 12 },
      { key: 'in', label: 'Check-in', kind: 'text' as const, width: 12 },
      { key: 'out', label: 'Check-out', kind: 'text' as const, width: 12 },
      { key: 'hours', label: 'Total hours', kind: 'duration' as const, width: 12 },
      { key: 'overtime', label: 'Overtime', kind: 'duration' as const, width: 11 },
      { key: 'status', label: 'Status', kind: 'text' as const, width: 12 },
    ],

    rows: input.rows.map((row) => [
      text(row.name),
      text(row.roleTitle ?? '—'),
      ...(input.canViewAll ? [text(row.teamLabel)] : []),
      date(row.onDate),
      /* ⚠️ Text, not a time cell: the report `Cell` union has no time kind, and a
         `date` cell would print the day again in the check-in column. */
      text(clockLabel(row.checkedInAt)),
      text(row.checkedInAt && !row.checkedOutAt ? 'No check-out' : clockLabel(row.checkedOutAt)),
      mins(row.minutes),
      mins(row.overtime),
      text(ATTENDANCE_STATUS_META[row.status].label),
    ]),

    figures: [
      {
        label: input.canViewAll ? 'People' : 'Days counted',
        value: num(input.canViewAll ? input.board.headcount : s.settled),
      },
      { label: 'Present', value: num(s.present), hint: 'On time' },
      { label: 'Late', value: num(s.late), hint: `After ${lateAfterLabel()}` },
      { label: 'Absent', value: num(s.absent) },
      { label: 'On leave', value: num(s.onLeave), hint: 'Approved' },
      {
        label: 'Attendance rate',
        /* ⚠️ Zero when nothing has settled, because a figure cell cannot be null.
           The note below says what an empty period means, which is the only place
           that distinction can be made in this shape. */
        value: pct(s.rate ?? 0),
        hint: `${s.settled} day${s.settled === 1 ? '' : 's'} settled`,
      },
      { label: 'Average day', value: mins(s.averageMinutes), hint: 'Where hours are recorded' },
    ],

    notes: [
      `Arriving after ${lateAfterLabel()} counts as late. Times are recorded by the server in Pakistan time (Asia/Karachi), not by anybody's device.`,
      'Blue Area works Monday to Saturday and rests on Sunday. Wah works Monday to Thursday plus the weekend and rests on Friday. A rest day is not an absence and is not listed.',
      'The attendance rate counts present and late days against days that have settled — a day settles at 6 PM. Rest days and approved leave are excluded from both sides of it, so leave never counts against anybody.',
      'A day showing "No check-out" was opened and never closed. It contributes no hours, and only an Admin can set the time somebody actually left.',
      ...(s.settled === 0
        ? ['Nothing in this period has settled yet, so the attendance rate is shown as zero rather than calculated.']
        : []),
      ...(input.filters.length > 0 ? [`Filtered: ${input.filters.join('; ')}.`] : []),
    ],
  };
}

/**
 * The same two charts the page draws.
 *
 * ⚠️ Built from the board rather than re-derived, and from the ALREADY GROUPED
 * columns, so a PDF exported while looking at the weekly view contains the weekly
 * chart. Tokens are names, never colours — the print sheet maps them to inks.
 */
export function attendanceCharts(input: AttendanceReportInput): ChartSpec[] {
  const s = input.board.summary;
  const charts: ChartSpec[] = [];

  if (input.columns.length > 0) {
    charts.push({
      kind: 'bars',
      title: 'Attendance overview',
      question: 'Who was in, and when?',
      format: 'integer',
      bars: input.columns.map((column) => ({
        label: `${column.dayLabel} ${column.weekday}`.trim(),
        value: column.present,
        token: 'accent-primary',
        note: column.absent > 0 ? `${column.absent} absent` : undefined,
      })),
    });
  }

  const slices = [
    { label: 'Present', value: s.present, token: 'feedback-success' },
    { label: 'Late', value: s.late, token: 'feedback-warning' },
    { label: 'Absent', value: s.absent, token: 'feedback-error' },
    { label: 'On leave', value: s.onLeave, token: 'accent-gold' },
  ].filter((slice) => slice.value > 0);

  if (slices.length > 0) {
    charts.push({
      kind: 'donut',
      title: 'Attendance distribution',
      question: 'How were the days spent?',
      slices,
      centreLabel: 'Attendance rate',
      centreValue: s.rate === null ? '—' : `${s.rate}%`,
    });
  }

  return charts;
}

/**
 * Which office each person is in, as a filter sentence for the sheet.
 *
 * Small, but it is the difference between a printout somebody can hand over and
 * one they have to explain.
 */
export function describeAttendanceFilters(input: {
  team: string;
  status: string;
  query: string;
  onDate: string;
}): string[] {
  const out: string[] = [];
  if (input.team !== 'all') out.push(`Team: ${officeTeam(input.team).label}`);
  if (input.status !== 'all') {
    const meta = ATTENDANCE_STATUS_META[input.status as keyof typeof ATTENDANCE_STATUS_META];
    out.push(`Status: ${meta?.label ?? input.status}`);
  }
  if (input.query.trim() !== '') out.push(`Name contains "${input.query.trim()}"`);
  if (input.onDate !== '') out.push(`Day: ${input.onDate}`);
  return out;
}
