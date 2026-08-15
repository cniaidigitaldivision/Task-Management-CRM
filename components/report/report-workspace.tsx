'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';

import {
  buildReportAction,
  exportReportAction,
  type ReportRequest,
} from '@/app/actions/reports';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '@/components/ui/toolbar';
import { Pagination, usePagination } from '@/components/ui/pagination';
import {
  PERIOD_LABEL,
  PERIOD_PRESETS,
  REPORT_META,
  REPORT_TYPES,
  cellText,
  type Cell,
  type PeriodPreset,
  type Report,
  type ReportType,
} from '@/lib/domain/reports';
import { downloadCsv, downloadXlsxFromBase64 } from '@/lib/download';
import { cn } from '@/lib/utils';

/* ============================================================================
 * REPORTS — CHANGE-PLAN 5.1
 * ----------------------------------------------------------------------------
 * Owner: *"Reports should have types — I can select which kind of report I
 * want."* Four types, one person or everybody, over a period.
 *
 * ── WHY THE FIRST REPORT COMES DOWN WITH THE PAGE ────────────────────────────
 * The server renders "this month, completion, everybody" and hands it over as a
 * prop. Fetching on mount instead would need an effect that sets state, which
 * `react-hooks/set-state-in-effect` rightly refuses — and it would show a
 * spinner on a screen whose whole job is to already have the answer.
 *
 * Changing a control then re-asks the server, because the arithmetic lives in
 * `lib/domain/reports.ts` behind a `withUser` query and cannot be redone here.
 * That is the correct trade: the alternative is shipping every task in the
 * division to the browser so it can recompute what the server just computed.
 *
 * ── THE NOTES ARE PART OF THE REPORT, NOT DECORATION ─────────────────────────
 * Every report states what it counts. "On-time 67%" with no definition is how
 * two people read one number and disagree about what it says, and the export and
 * the printed sheet carry the same words for the same reason.
 * ========================================================================= */

export function ReportWorkspace({
  initialReport,
  initialRequest,
  people,
}: {
  initialReport: Report;
  initialRequest: ReportRequest;
  people: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [request, setRequest] = React.useState<ReportRequest>(initialRequest);
  const [report, setReport] = React.useState<Report>(initialReport);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<null | 'csv' | 'xlsx'>(null);

  /* One place that asks the server, so every control behaves identically and a
     failed change cannot leave the controls describing a report that is not on
     screen — on failure the previous report stays, with the error beside it. */
  const apply = async (next: ReportRequest) => {
    setRequest(next);
    setBusy(true);
    setError(null);
    try {
      const result = await buildReportAction(next);
      if (result.ok) setReport(result.report);
      else setError(result.error);
    } catch {
      setError('That report could not be built — the server did not answer.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * One entry point for every way out, chosen from the dropdown.
   *
   * Print is handled here rather than being a separate control, because from the
   * reader's point of view it is the same decision — *"how do I want this?"* —
   * and it is the one format that is not a download, so it has to be visibly a
   * peer rather than an afterthought beside two download buttons.
   */
  const exportAs = async (format: ExportFormat) => {
    if (format === 'print') {
      /* The print stylesheet does the work (globals.css). The browser's own
         dialogue is also the PDF path, which is why there is no separate PDF
         option pretending to be something different. */
      window.print();
      return;
    }

    setDownloading(format);
    setError(null);
    try {
      const result = await exportReportAction(request, format);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      /* `lib/download.ts`, shared with the task and workload exports. It is also
         where the UTF-8 BOM is applied — a leading U+FEFF does not survive being
         returned from a server action, so writing it as bytes in the browser is
         the only place it can be relied on. See that file. */
      if (result.encoding === 'base64') downloadXlsxFromBase64(result.fileName, result.content);
      else downloadCsv(result.fileName, result.content);
    } catch {
      setError('That file could not be produced.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <Toolbar aria-label="Report options" className="print:hidden">
        <ToolbarGroup>
          <ToolbarLabel>Report</ToolbarLabel>
          <Select
            label="Report type"
            value={request.type}
            onChange={(event) => void apply({ ...request, type: event.target.value as ReportType })}
            options={REPORT_TYPES.map((t) => ({ value: t, label: REPORT_META[t].label }))}
            className="w-[13rem]"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarLabel>Period</ToolbarLabel>
          <Select
            label="Period"
            value={request.preset}
            onChange={(event) =>
              void apply({
                ...request,
                preset: event.target.value as PeriodPreset | 'custom',
                /* Seeded from the report on screen, so switching to Custom opens
                   on the range already being shown rather than on empty fields. */
                start: request.start ?? report.period.start,
                end: request.end ?? report.period.end,
              })
            }
            options={[
              ...PERIOD_PRESETS.map((p) => ({ value: p, label: PERIOD_LABEL[p] })),
              { value: 'custom', label: 'Custom range…' },
            ]}
            className="w-[11rem]"
          />
        </ToolbarGroup>

        {request.preset === 'custom' && (
          <ToolbarGroup>
            <ToolbarLabel>From</ToolbarLabel>
            <input
              type="date"
              aria-label="Period start"
              value={request.start ?? report.period.start}
              onChange={(event) => void apply({ ...request, start: event.target.value })}
              className={dateField}
            />
            <ToolbarLabel>To</ToolbarLabel>
            <input
              type="date"
              aria-label="Period end"
              value={request.end ?? report.period.end}
              onChange={(event) => void apply({ ...request, end: event.target.value })}
              className={dateField}
            />
          </ToolbarGroup>
        )}

        <ToolbarGroup>
          <ToolbarLabel>Who</ToolbarLabel>
          <Select
            label="Who this report covers"
            value={request.subjectId ?? ''}
            onChange={(event) =>
              void apply({ ...request, subjectId: event.target.value || null })
            }
            options={[
              { value: '', label: 'Everybody' },
              ...people.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="w-[13rem]"
          />
        </ToolbarGroup>

        <ToolbarSpacer />

        {busy && (
          <span className="flex items-center gap-1.5 text-caption text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Recalculating
          </span>
        )}

        <ExportMenu busy={downloading} onChoose={(format) => void exportAs(format)} />
      </Toolbar>

      {error && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption print:hidden"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Everything below prints. The heading is hidden on screen because the
          page already has one, and shown on paper because a printed sheet with no
          title is unidentifiable once it leaves the printer. */}
      <div className={cn('space-y-4', busy && 'opacity-60 transition-opacity')}>
        <div className="hidden print:block">
          <h2 className="text-h3 text-text-primary">{report.title}</h2>
          <p className="text-caption text-text-secondary">{report.subtitle}</p>
          <p className="text-micro text-text-tertiary">Crescent Nova International · AI &amp; Digital Division</p>
        </div>

        <Figures report={report} />
        <ReportTable report={report} />
        <Notes report={report} />
      </div>
    </div>
  );
}

const dateField =
  'h-9 rounded-lg border border-border-default bg-bg-surface px-2.5 text-caption ' +
  'text-text-primary focus-visible:outline-none focus-visible:border-border-strong';

/* ---- Export menu --------------------------------------------------------- */

export type ExportFormat = 'print' | 'csv' | 'xlsx';

const EXPORT_OPTIONS: ReadonlyArray<{
  readonly format: ExportFormat;
  readonly icon: typeof Printer;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    format: 'print',
    icon: Printer,
    label: 'Print or save as PDF',
    /* Named as one thing because it IS one thing. Offering "Print" and "PDF"
       separately would be two menu items that open the same dialogue, and the
       reader would reasonably expect them to differ. */
    hint: 'Opens your browser’s print dialogue',
  },
  {
    format: 'xlsx',
    icon: FileSpreadsheet,
    label: 'Excel spreadsheet',
    hint: '.xlsx — numbers you can sum and sort',
  },
  {
    format: 'csv',
    icon: FileText,
    label: 'CSV',
    hint: 'Plain text, opens anywhere',
  },
];

/**
 * How would you like this report?
 *
 * Owner instruction: *"the print options should be dropdown box selection of how
 * I want to export the report."* Three buttons became one control.
 *
 * ── WHY A MENU RATHER THAN A `<select>` ──────────────────────────────────────
 * A `<select>` holds a *value* — it says "this report is currently CSV", which is
 * untrue: the format is not a property of the report, it is a one-off action.
 * A menu of actions says what actually happens, and it has room for the one line
 * of explanation each format needs (which format sums, which opens anywhere,
 * which is really the print dialogue).
 *
 * Ordered by what people reach for most, not alphabetically: print first because
 * it is the one that does not leave a file behind, then Excel, then CSV.
 */
function ExportMenu({
  busy,
  onChoose,
}: {
  busy: 'csv' | 'xlsx' | null;
  onChoose: (format: ExportFormat) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <Button
        variant="primary"
        size="md"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {busy !== null ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
        )}
        {busy === 'xlsx' ? 'Building…' : busy === 'csv' ? 'Building…' : 'Export'}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 z-50 w-[17rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-xl)]"
        >
          {EXPORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.format}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onChoose(option.format);
                }}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none"
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-caption font-medium text-text-primary">
                    {option.label}
                  </span>
                  <span className="block text-micro text-text-tertiary">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Figures -------------------------------------------------------------- */

function Figures({ report }: { report: Report }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
      {/* ── STEP 8: WHY ALL FOUR ARE THE SAME COLOUR ──────────────────────────
          The dashboard's KPI cards each wash in their own metric's token, and
          the project counters in their type's. A report figure has neither — it
          is a label, a number and a hint, and which four appear changes with the
          report type. Cycling hues across them would be exactly the decoration
          §5 rules out for the calendar: colour that looks like it means
          something and does not.

          So one brand wash on all four. They read as a set, they match the
          panel language, and nothing is claimed that isn't true. */}
      {report.figures.map((figure) => (
        <Card key={figure.label} lit toneToken="accent-primary">
          <CardBody className="p-4">
            <p className="text-micro text-text-tertiary">{figure.label}</p>
            <p className="tabular mt-0.5 text-h3 font-semibold text-text-primary">
              {cellText(figure.value)}
            </p>
            {figure.hint && <p className="mt-0.5 text-micro text-text-tertiary">{figure.hint}</p>}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

/* ---- The table ------------------------------------------------------------ */

function ReportTable({ report }: { report: Report }) {
  const pager = usePagination(report.rows);

  if (report.rows.length === 0) {
    return (
      <div className="dot-grid rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
        <p className="text-body-sm font-semibold text-text-primary">
          Nothing falls in this period
        </p>
        <p className="mt-1 text-caption text-text-secondary">
          Widen the period, or choose Everybody.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm print:border-0 print:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default bg-bg-surface-sunken">
                {report.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'px-3 py-2 text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase',
                      column.kind === 'text' ? 'text-left' : 'text-right',
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Paged on screen; the print stylesheet reveals every row, because
                  a printed report that stops at row 12 is not a report. */}
              {pager.visible.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover print:hover:bg-transparent"
                >
                  {row.map((cell, i) => (
                    <td
                      key={report.columns[i].key}
                      className={cn(
                        'px-3 py-2 text-caption',
                        cell.kind === 'text'
                          ? 'text-text-primary'
                          : 'tabular text-right text-text-secondary',
                      )}
                    >
                      <CellValue cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="print:hidden">
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          onPage={pager.setPage}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          label="rows"
        />
      </div>

      {pager.pageCount > 1 && (
        <p className="hidden text-micro text-text-tertiary print:block">
          {report.rows.length} rows.
        </p>
      )}
    </div>
  );
}

/**
 * One cell.
 *
 * A zero is drawn quieter than a number, so a column of them reads as "none"
 * rather than competing for attention with the figures that matter.
 */
function CellValue({ cell }: { cell: Cell }) {
  const text = cellText(cell);
  const isZero =
    (cell.kind === 'number' || cell.kind === 'percent' || cell.kind === 'duration') &&
    cell.value === 0;

  if (isZero) {
    return <span className="text-text-disabled">{cell.kind === 'duration' ? text : '—'}</span>;
  }
  return <>{text}</>;
}

/* ---- Notes --------------------------------------------------------------- */

function Notes({ report }: { report: Report }) {
  return (
    <Card>
      <CardBody className="space-y-1.5 p-4">
        <p className="text-caption font-semibold text-text-primary">How to read this</p>
        <ul className="space-y-1">
          {report.notes.map((note) => (
            <li key={note} className="flex gap-2 text-micro text-text-secondary">
              <span aria-hidden="true" className="text-text-disabled">
                ·
              </span>
              <span>{renderEmphasis(note)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * `**bold**` → `<strong>`.
 *
 * The notes are written once, in the domain layer, and read by the screen, the
 * CSV and the spreadsheet. Markdown is the lowest common denominator: the screen
 * renders it, the text formats strip it. A full parser would be absurd for one
 * kind of emphasis — and `dangerouslySetInnerHTML` on strings that will later
 * carry data would be worse than absurd.
 */
function renderEmphasis(note: string): React.ReactNode {
  return note.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-text-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

