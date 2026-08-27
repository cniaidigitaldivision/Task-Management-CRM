'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import {
  buildReportAction,
  exportReportAction,
  type FilterOptions,
  type ReportRequest,
} from '@/app/actions/reports';
import { Card, CardBody } from '@/components/ui/card';
import { ReportChartsPanel } from '@/components/report/report-charts-panel';
import { ReportControls, type ControlState, type ExportFormat } from '@/components/report/report-controls';
import { WorkReportTables } from '@/components/report/work-report-tables';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { cellText, type Cell, type Report } from '@/lib/domain/reports';
import type { ChartSpec } from '@/lib/domain/report-charts';
import type { WorkReport } from '@/lib/domain/work-report';
import { downloadCsv, openPdfInTab, downloadXlsxFromBase64 } from '@/lib/download';
import { cn } from '@/lib/utils';

/* ============================================================================
 * REPORTS
 * ----------------------------------------------------------------------------
 * The owner's mockup: a heading and one line, a card of filters, a table, a
 * second table of posting performance, and a record count. Nothing else.
 *
 * ── ⚠️ THE REPORT-TYPE CONTROL SWITCHES TWO DIFFERENT THINGS ────────────────
 * "Work reports" — the mockup, and the default — is a row per project-and-person
 * from `lib/domain/work-report.ts`. The four analytical types beside it in the
 * same dropdown (Completion, Workload, Project status, Time) are the typed-cell
 * reports from `lib/domain/reports.ts`, and those bring their charts.
 *
 * They render differently because they ARE different: the work report has avatars,
 * brand marks and status pills that a generic typed-cell table cannot express, and
 * the analytical ones have a different column set per type that no fixed layout
 * could. Both go through the same filters and the same export menu.
 *
 * ── WHY THE FIRST REPORT COMES DOWN WITH THE PAGE ───────────────────────────
 * The server renders it and hands it over as a prop. Fetching on mount would need
 * an effect that sets state — which `react-hooks/set-state-in-effect` rightly
 * refuses — and would put a spinner on a screen whose whole job is to already have
 * the answer. Changing a control re-asks the server, because the arithmetic lives
 * behind a `withUser` query and cannot be redone in the browser.
 * ========================================================================= */

export function ReportWorkspace({
  initialReport,
  initialRequest,
  initialCharts,
  initialWork,
  options,
  people,
  nowMs,
}: {
  initialReport: Report;
  initialRequest: ReportRequest;
  initialCharts: readonly ChartSpec[];
  initialWork: WorkReport | null;
  options: FilterOptions;
  people: ReadonlyArray<{ id: string; name: string }>;
  /** The server's clock, for every relative age on the page. See lib/now.ts. */
  nowMs: number;
}) {
  const [state, setState] = React.useState<ControlState>({
    work: initialRequest.work ?? true,
    type: initialRequest.type,
    preset: initialRequest.preset,
    start: initialRequest.start,
    end: initialRequest.end,
    subjectId: initialRequest.subjectId ?? null,
    filters: initialRequest.filters ?? {
      projectIds: [],
      statuses: [],
      platforms: [],
      contentKinds: [],
    },
    workSort: initialRequest.workSort ?? 'posts',
    workDirection: initialRequest.workDirection ?? 'desc',
  });

  const [report, setReport] = React.useState<Report>(initialReport);
  const [charts, setCharts] = React.useState<readonly ChartSpec[]>(initialCharts);
  const [work, setWork] = React.useState<WorkReport | null>(initialWork);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<ExportFormat | null>(null);

  const asRequest = (next: ControlState): ReportRequest => ({
    type: next.type,
    preset: next.preset,
    start: next.start,
    end: next.end,
    subjectId: next.subjectId,
    filters: next.filters,
    work: next.work,
    workSort: next.workSort,
    workDirection: next.workDirection,
  });

  /* One place that asks the server, so every control behaves identically and a
     failed change cannot leave the controls describing a report that is not on
     screen — on failure the previous one stays, with the error beside it. */
  const apply = async (next: ControlState) => {
    setState(next);
    setBusy(true);
    setError(null);
    try {
      const result = await buildReportAction(asRequest(next));
      if (result.ok) {
        /* Set together, from one response. Fetching them separately would let the
           tables and the charts come from two different requests and disagree. */
        setReport(result.report);
        setCharts(result.charts);
        setWork(result.work);
      } else setError(result.error);
    } catch {
      setError('That report could not be built — the server did not answer.');
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async (format: ExportFormat) => {
    if (format === 'print') {
      window.print();
      return;
    }

    setDownloading(format);
    setError(null);
    try {
      const result = await exportReportAction(asRequest(state), format);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      /* `lib/download.ts`, shared with the task and workload exports — it is also
         where the UTF-8 BOM is applied, because a leading U+FEFF does not survive
         being returned from a server action. */
      /* ⚠️ A PDF OPENS; it does not land in Downloads. Owner: *"Don't generate a
         PDF report instantly. It should first open in a new tab. If I want to
         download it, then I can download it with the button."* The browser's own
         PDF viewer already has that button, so opening it gives them the look
         first and the save second — and stops a folder filling with drafts of a
         report somebody was only checking. */
      if (format === 'pdf') openPdfInTab(result.fileName, result.content);
      else if (result.encoding === 'base64') downloadXlsxFromBase64(result.fileName, result.content);
      else downloadCsv(result.fileName, result.content);
    } catch {
      setError('That file could not be produced.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-5">
      <ReportControls
        state={state}
        options={options}
        people={people}
        busy={busy}
        downloading={downloading}
        onChange={(next) => void apply(next)}
        onExport={(format) => void exportAs(format)}
      />

      {error && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption print:hidden"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
        >
          <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Everything below prints. The heading is hidden on screen because the page
          already has one, and shown on paper because a printed sheet with no title
          is unidentifiable once it leaves the printer. */}
      <div className={cn('space-y-5', busy && 'opacity-60 transition-opacity')}>
        <div className="hidden print:block">
          <h2 className="text-h3 text-text-primary">{report.title}</h2>
          <p className="text-caption text-text-secondary">{report.subtitle}</p>
        </div>

        {work ? (
          <WorkReportTables work={work} nowMs={nowMs} />
        ) : (
          <>
            <Figures report={report} />
            <ReportChartsPanel charts={charts} />
            <ReportTable report={report} />
            <Notes report={report} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Figures (analytical types only) ------------------------------------- */

function Figures({ report }: { report: Report }) {
  if (report.figures.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
      {/* ── WHY ALL FOUR ARE THE SAME COLOUR ────────────────────────────────
          The dashboard's KPI cards each wash in their own metric's token. A report
          figure has no such token — it is a label, a number and a hint, and which
          four appear changes with the report type. Cycling hues across them would
          be colour that looks like it means something and does not. */}
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

/* ---- The generic table (analytical types only) --------------------------- */

function ReportTable({ report }: { report: Report }) {
  const pager = usePagination(report.rows);

  const numeric = (kind: Cell['kind']) =>
    kind === 'number' || kind === 'percent' || kind === 'duration';

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-default bg-bg-subtle">
                {report.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5 text-caption font-medium text-text-secondary',
                      numeric(column.kind) && 'text-right',
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.visible.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        'px-4 py-3 align-middle text-caption',
                        numeric(cell.kind) ? 'text-right tabular-nums' : '',
                        cellIndex === 0
                          ? 'font-medium text-text-primary'
                          : 'text-text-secondary',
                      )}
                    >
                      {cellText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={report.columns.length}
                    className="px-4 py-10 text-center text-caption text-text-tertiary"
                  >
                    No rows matched this period and filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-text-secondary">
          {pager.total === 0
            ? 'No records'
            : `Showing ${pager.from} to ${pager.to} of ${pager.total} record${pager.total === 1 ? '' : 's'}`}
        </p>
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          onPage={pager.setPage}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          label="records"
        />
      </div>
    </div>
  );
}

/* ---- Notes --------------------------------------------------------------- */

/**
 * ⚠️ Part of the report, not decoration. "On-time 67%" with no definition is how
 * two people read one number and disagree about what it says — so the same words
 * appear on screen, in the export and on the printed sheet.
 */
function Notes({ report }: { report: Report }) {
  if (report.notes.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h3 className="text-micro font-bold uppercase tracking-wide text-text-tertiary">
        What this report counts
      </h3>
      <ul className="space-y-1">
        {report.notes.map((note) => (
          <li key={note} className="pl-3 text-micro text-text-secondary">
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}
