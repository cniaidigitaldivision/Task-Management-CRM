import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { composeReportSheet } from '../report-sheet';
import { attendanceCharts, buildAttendanceReport } from '@/lib/domain/attendance-report';
import {
  buildAttendanceBoard,
  groupColumns,
  type BoardPerson,
  type BoardRecord,
} from '@/lib/view/attendance-board';

/* ============================================================================
 * ATTENDANCE THROUGH THE REPORT SHEET
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"When exporting the PDF you should use the same template
 * that you have already been using."* So attendance feeds `composeReportSheet`
 * rather than having a layout of its own — which means the failure mode is a
 * `Report` this composer cannot draw, and in pdf-lib that is a 500 where a
 * document should have been, several layers from the cause.
 *
 * These compose the real thing from a real board. They cannot see whether a column
 * is in the right place; they prove the document renders at all on the inputs that
 * would otherwise throw:
 *
 *   · a whole month of rows, so the table paginates and the header is redrawn
 *   · a period where nothing happened — no rows, no charts, an unsettled rate
 *   · one person's own view, which has one fewer column
 *   · weekly grouping, where the bar labels are the widest strings in the file
 * ========================================================================= */

const PEOPLE: BoardPerson[] = [
  {
    id: 'u1',
    name: 'Umm-e-Habiba',
    roleTitle: 'Admin — AI & Digital Division',
    role: 'admin',
    avatarUrl: null,
    officeTeam: 'blue_area',
  },
  {
    id: 'u2',
    name: 'Kashif Ahmed',
    roleTitle: 'Team Coordinator',
    role: 'team_coordinator',
    avatarUrl: null,
    officeTeam: 'blue_area',
  },
  {
    id: 'u3',
    name: 'Lareeb Khan',
    roleTitle: 'Developer',
    role: 'member',
    avatarUrl: null,
    officeTeam: 'wah',
  },
];

/** Karachi is UTC+5. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${date}T${String(h - 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
};

/** A whole month of plausible days, including some open ones. */
function monthOfRecords(): BoardRecord[] {
  const out: BoardRecord[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    for (const [index, person] of PEOPLE.entries()) {
      if ((day + index) % 7 === 0) continue; // an absence here and there
      const late = (day + index) % 5 === 0;
      out.push({
        userId: person.id,
        onDate: date,
        checkedInAt: at(date, late ? '11:12' : '09:58'),
        /* Every ninth day is left open, which is the row that prints
           "No check-out" — a string the generic table has never been given. */
        checkedOutAt: (day + index) % 9 === 0 ? null : at(date, '18:20'),
        editedByName: null,
        editNote: null,
      });
    }
  }
  return out;
}

function boardFor(records: BoardRecord[], from: string, to: string) {
  return buildAttendanceBoard({
    people: PEOPLE,
    records,
    leave: [{ userId: 'u3', from: '2026-08-11', to: '2026-08-12' }],
    from,
    to,
    /* Well past the period, so every day has settled and the figures are real. */
    today: '2026-10-01',
    nowMinutes: 12 * 60,
  });
}

async function compose(options: {
  from: string;
  to: string;
  records: BoardRecord[];
  canViewAll?: boolean;
  granularity?: 'daily' | 'weekly' | 'monthly';
}): Promise<Uint8Array> {
  const board = boardFor(options.records, options.from, options.to);
  const input = {
    board,
    rows: board.rows,
    from: options.from,
    to: options.to,
    rangeLabel: `${options.from} – ${options.to}`,
    filters: ['Team: Blue Area', 'Status: Late'],
    canViewAll: options.canViewAll ?? true,
    columns: groupColumns(board.days, options.granularity ?? 'daily'),
  };

  return composeReportSheet({
    report: buildAttendanceReport(input),
    work: null,
    charts: attendanceCharts(input),
    filterSummary: input.filters,
    generatedOn: '2026-08-31',
    generatedBy: 'Umm-e-Habiba',
  });
}

describe('the attendance PDF', () => {
  it('composes a whole month and paginates it', async () => {
    const bytes = await compose({ from: '2026-08-01', to: '2026-08-31', records: monthOfRecords() });

    /* A real PDF, not an empty buffer. */
    expect(bytes.byteLength).toBeGreaterThan(3000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    /* ⚠️ Counted by re-opening the document, not by searching the bytes for
       "/Type /Page": `save()` writes object streams, so that search finds nothing
       — which is how a previous version of this check silently passed. */
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it('composes a period where nothing happened', async () => {
    /* No rows, no charts, and a rate that cannot be calculated. Every one of those
       is a division by zero somewhere in a chart composer. */
    const bytes = await compose({ from: '2026-09-10', to: '2026-09-12', records: [] });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('composes a single day', async () => {
    const bytes = await compose({
      from: '2026-08-25',
      to: '2026-08-25',
      records: monthOfRecords(),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('composes one person’s own view, which has a column fewer', async () => {
    const bytes = await compose({
      from: '2026-08-01',
      to: '2026-08-31',
      records: monthOfRecords(),
      canViewAll: false,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('composes the weekly and monthly groupings', async () => {
    for (const granularity of ['weekly', 'monthly'] as const) {
      const bytes = await compose({
        from: '2026-08-01',
        to: '2026-08-31',
        records: monthOfRecords(),
        granularity,
      });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    }
  });

  it('survives an em dash in a role title', async () => {
    /* ⚠️ Helvetica is WinAnsi and `drawText` THROWS outside it. "Admin — AI &
       Digital Division" is a real role title in this division, and it goes into
       every row of the Role column. */
    expect(PEOPLE[0].roleTitle).toContain('—');
    const bytes = await compose({ from: '2026-08-03', to: '2026-08-08', records: monthOfRecords() });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
