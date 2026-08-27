import 'server-only';

import type { CellObject as XlsxCellObject } from 'write-excel-file/node';

import { toCsv } from '@/lib/domain/csv';
import {
  EFFORT_POINTS,
  cellText,
  formatMinutes,
  type Cell,
  type Report,
} from '@/lib/domain/reports';

/* ============================================================================
 * REPORT WRITERS — CHANGE-PLAN 5.2
 * ----------------------------------------------------------------------------
 * One `Report` in, a file out. Two formats, and the difference between them is
 * the whole reason `Report` holds typed cells rather than strings.
 *
 * ── CSV IS TEXT AND MUST STAY GUARDED ────────────────────────────────────────
 * Every cell goes through `lib/domain/csv.ts`, which neutralises a leading `=`,
 * `+`, `-` or `@`. A task titled `=HYPERLINK(...)` is a live formula the moment
 * the file opens, and task titles are typed by people. That guard is not
 * reimplemented here — it is imported, because two copies of a security control
 * is one copy that gets forgotten.
 *
 * ── .XLSX CARRIES REAL TYPES, WHICH IS WHY IT EXISTS ─────────────────────────
 * A percentage arrives as the number 83 with a percent format, not the string
 * "83%". A duration arrives as minutes. A date arrives as a date. So the
 * spreadsheet can sum a column, average it, sort it numerically and chart it —
 * none of which works on text. If this wrote strings it would be a CSV with
 * extra steps and 3.6 MB of dependency for nothing.
 *
 * ⚠️ **The formula risk does not apply here, and that was verified rather than
 * assumed.** `write-excel-file` puts a string into the shared-string table, not
 * into a `<f>` formula element, so a title beginning `=` is inert. Checked by
 * generating a file and reading its XML before the library was installed.
 * ========================================================================= */

/* ==========================================================================
 * CSV
 * ========================================================================== */

/**
 * The report as CSV, with its own definitions underneath.
 *
 * The notes are appended as trailing rows rather than dropped. A CSV that says
 * "on-time 67%" with no statement of what was counted is the version somebody
 * pastes into a board pack, and then nobody can reconstruct what it meant.
 */
export function reportToCsv(report: Report): string {
  const headers = report.columns.map((c) => c.label);
  const rows: unknown[][] = report.rows.map((row) => row.map(csvValue));

  rows.push([]);
  rows.push([`${report.title} — ${report.subtitle}`]);
  rows.push([`Period`, report.period.start, `to`, report.period.end]);
  rows.push([]);

  for (const figure of report.figures) {
    rows.push([figure.label, cellText(figure.value), figure.hint ?? '']);
  }

  rows.push([]);
  rows.push(['How to read this']);
  for (const note of report.notes) rows.push([stripEmphasis(note)]);

  /* The point scale, so a spreadsheet can rebuild the effort maths rather than
     trusting the totals it was handed. */
  rows.push([]);
  rows.push(['Effort point scale']);
  for (const [size, points] of Object.entries(EFFORT_POINTS)) rows.push([size, points]);

  return toCsv(headers, rows);
}

/**
 * A cell as CSV text.
 *
 * Numbers stay numbers here — `csvCell` will stringify them, and a raw `83` is
 * what a spreadsheet wants from a CSV. Only durations are formatted, because
 * `135` in a column headed "Spent" reads as minutes to nobody.
 */
function csvValue(cell: Cell): unknown {
  switch (cell.kind) {
    case 'number':
    case 'percent':
      return cell.value;
    case 'duration':
      return formatMinutes(cell.value);
    case 'date':
      return cell.value ?? '';
    case 'bool':
      return cell.value ? 'Yes' : 'No';
    case 'text':
      return cell.value;
  }
}

/** Markdown emphasis is for the screen; a text file should not show asterisks. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[“”]/g, '"').replace(/’/g, "'");
}

/* ==========================================================================
 * XLSX
 * ========================================================================== */

/* The library's own cell type, imported rather than re-declared. A hand-rolled
   equivalent looked right and was not assignable, so TypeScript silently matched
   the single-sheet overload and reported a confusing error about `data`. Using
   their type means the multi-sheet call is checked against what it really takes. */
type SheetCell = XlsxCellObject;

/**
 * The report as a real spreadsheet.
 *
 * Two sheets, deliberately:
 *
 *   **Report**  the table, typed, with a frozen bold header
 *   **About**   the period, the figures, the notes and the point scale
 *
 * Separated because a header block above the table is the single most annoying
 * thing to receive in a spreadsheet — it breaks sorting, filtering and every
 * formula that assumes row 1 is the header. The context still travels with the
 * file; it just does not sit on top of the data.
 */
export async function reportToXlsx(report: Report): Promise<Buffer> {
  /* Imported here rather than at the top of the module so the library is pulled
     in only when somebody actually asks for a spreadsheet. Nothing else on the
     Reports page pays for it. */
  const writeXlsxFile = (await import('write-excel-file/node')).default;

  const header: SheetCell[] = report.columns.map((column) => ({
    value: column.label,
    fontWeight: 'bold',
    /* The token's own hex is not reachable from here — a runtime CSS variable is
       not a value a file format can take — so the brand teal is written
       literally. BR-025 governs stylesheets, not the inside of a .xlsx. */
    backgroundColor: '#0F3D3E',
    color: '#FFFFFF',
    align: column.kind === 'text' ? 'left' : 'right',
  }));

  const body: SheetCell[][] = report.rows.map((row) => row.map(xlsxCell));

  const columns = report.columns.map((column) => ({
    width: column.width ?? widthFor(column.kind),
  }));

  const about: SheetCell[][] = [
    [{ value: report.title, fontWeight: 'bold' }],
    [{ value: report.subtitle }],
    [],
    [{ value: 'Period', fontWeight: 'bold' }, { value: report.period.start }, { value: report.period.end }],
    [],
    [{ value: 'Figures', fontWeight: 'bold' }],
    ...report.figures.map((figure): SheetCell[] => [
      { value: figure.label },
      xlsxCell(figure.value),
      { value: figure.hint ?? '' },
    ]),
    [],
    [{ value: 'How to read this', fontWeight: 'bold' }],
    ...report.notes.map((note): SheetCell[] => [{ value: stripEmphasis(note), wrap: true }]),
    [],
    [{ value: 'Effort point scale', fontWeight: 'bold' }],
    ...Object.entries(EFFORT_POINTS).map(([size, points]): SheetCell[] => [
      { value: size },
      { value: points, type: Number },
    ]),
  ];

  /* Each sheet carries its own name, widths and sticky rows — the multi-sheet
     form takes `{ data, ... }` per sheet rather than parallel arrays of options.
     `orientation: 'landscape'` is for whoever prints the spreadsheet itself;
     the print stylesheet on the page is a separate thing. */
  const { toBuffer } = await writeXlsxFile([
    {
      data: [header, ...body],
      sheet: 'Report',
      columns,
      /* The header row stays visible while scrolling a long report. */
      stickyRowsCount: 1,
      orientation: 'landscape',
    },
    {
      data: about,
      sheet: 'About',
      columns: [{ width: 34 }, { width: 18 }, { width: 60 }],
      showGridLines: false,
    },
  ]);

  return toBuffer();
}

/**
 * One typed cell.
 *
 * `write-excel-file` needs `type` stated explicitly — it does not infer from the
 * JavaScript value, and an unstated number lands as text, which is precisely the
 * failure this whole format exists to avoid.
 */
function xlsxCell(cell: Cell): SheetCell {
  switch (cell.kind) {
    case 'text':
      /* Empty string rather than a value with no type: the library rejects an
         empty `value` on a typed cell. */
      return cell.value === '' ? {} : { value: cell.value, type: String };

    case 'number':
      return { value: cell.value, type: Number, format: numberFormat(cell.value) };

    case 'percent':
      /* Excel's percent format multiplies by 100, so 83% is stored as 0.83.
         Writing 83 with a percent format would display 8300%. */
      return { value: cell.value / 100, type: Number, format: '0%' };

    case 'date':
      return cell.value
        ? { value: new Date(`${cell.value}T00:00:00Z`), type: Date, format: 'dd mmm yyyy' }
        : {};

    case 'duration':
      /* Minutes as a number, not "2h 15m" — so a column of durations can be
         summed. The header says what the unit is; a formatted string cannot be
         added up, which is the entire point of exporting a spreadsheet.
         Not Excel's time format either: that wraps at 24 hours, so a project
         with 30 hours logged would display as 6. */
      return { value: cell.value, type: Number, format: '#,##0' };

    case 'bool':
      return { value: cell.value, type: Boolean };
  }
}

/** Whole numbers get no decimals; a computed average keeps one. */
function numberFormat(value: number): string {
  return Number.isInteger(value) ? '#,##0' : '#,##0.0';
}

function widthFor(kind: Cell['kind']): number {
  switch (kind) {
    case 'text':
      return 20;
    case 'date':
      return 14;
    case 'duration':
      return 13;
    default:
      return 11;
  }
}

/** `cni-completion-2026-08-01-to-2026-08-31.xlsx` */
export function reportFileName(stem: string, extension: 'csv' | 'xlsx' | 'pdf'): string {
  return `${stem}.${extension}`;
}
