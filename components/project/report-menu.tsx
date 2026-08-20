'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, ChevronDown, FileText, Loader2 } from 'lucide-react';

import { generateProjectReportAction } from '@/app/actions/project-report';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  REPORT_KINDS,
  REPORT_KIND_LABEL,
  monthStartOf,
  monthTitle,
  shiftMonths,
  type ReportKind,
} from '@/lib/domain/report-periods';
import { cn } from '@/lib/utils';

/* ============================================================================
 * PICKING A REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"In Generate Report when I click or go to Generate Report, it should show a
 * dropdown where I can click a daily report when I want to see a daily report… Today's
 * report, Yesterday's report, A week's report, A month's report, A yearly report."*
 * *"When I select I want a year report, show the next pop-up in which you will ask from
 * which month to which month."*
 *
 * And, clarified the same day: *"Generate Report is for reports related to this
 * project."* So every route here is `/projects/<id>/report`, never the division-wide
 * `/monthly-report` this button used to point at.
 *
 * ── ⚠️ `<details>` FOR THE MENU, A REAL DIALOG FOR THE RANGE ──────────────────
 * The menu is a `<details>`: Escape, toggling and keyboard reach come from the browser
 * rather than from a hand-rolled popover with an outside-click listener and a focus
 * trap to get wrong. The year picker is a `Dialog`, because it is a decision with two
 * inputs and a confirm — a menu that grew form fields inside it would be neither.
 *
 * ── THE MONTH LIST IS BUILT HERE, NOT FETCHED ────────────────────────────────
 * A month range needs no data — only a calendar. `today` is passed in so the component
 * reads no clock: a client component that did would not be a pure render, and could
 * disagree with the server about the date across midnight.
 * ========================================================================= */

export function ReportMenu({
  projectId,
  projectName,
  today,
  className,
}: {
  projectId: string;
  projectName: string;
  /** 'YYYY-MM-DD', from the server. */
  today: string;
  className?: string;
}) {
  const router = useRouter();
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [rangeOpen, setRangeOpen] = React.useState(false);

  /* Twenty-four months back, so a year report can span the previous calendar year as
     well as this one. Built from the passed date — see the header. */
  const months = React.useMemo(() => {
    const thisMonth = monthStartOf(today);
    return Array.from({ length: 24 }, (_, i) => shiftMonths(thisMonth, -i));
  }, [today]);

  const [from, setFrom] = React.useState(() => shiftMonths(monthStartOf(today), -11));
  const [to, setTo] = React.useState(() => monthStartOf(today));

  const close = () => ref.current?.removeAttribute('open');

  const [busy, setBusy] = React.useState<ReportKind | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  /* ⚠️ GENERATES, then opens the PDF. Owner, 2026-08-20: *"I want that to generate a
     report always in PDF format."*

     It still shows a spinner, but the wait is now a database read rather than a call to
     an image model: the page is drawn by `lib/pdf/report-poster.ts`, so a press that
     took 64 seconds and cost money takes under a second and costs nothing. The spinner
     stays because the figures are still computed server-side, and because
     `REPORT_POSTER_MODEL=1` puts the slow path back. */
  const generate = async (kind: ReportKind, from?: string, to?: string) => {
    setBusy(kind);
    setNote(null);
    try {
      const result = await generateProjectReportAction(projectId, kind, from, to);
      if (!result.ok || !result.reportId) {
        setNote(result.error ?? 'That report could not be generated.');
        return;
      }
      /* Straight to the PDF, in a new tab. `router.refresh()` as well, so the list of
         past reports on the project page picks it up. */
      window.open(`/api/project-report/${result.reportId}`, '_blank', 'noopener,noreferrer');
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const go = (kind: ReportKind) => {
    close();
    if (kind === 'year') {
      /* The owner's second prompt. Everything else has an unambiguous range. */
      setRangeOpen(true);
      return;
    }
    void generate(kind);
  };

  return (
    <div className="relative">
      <details ref={ref} className={cn('relative', className)}>
        <summary
          title={`Generate a report for ${projectName}`}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg',
            'border border-border-default px-2 py-1.5 text-caption font-semibold text-text-secondary',
            'marker:content-none hover:bg-bg-hover hover:text-text-primary',
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          {/* Matches the other action buttons: the label goes below `xl` so a zoomed
              viewport gets icons rather than a crowded row. */}
          <span className="hidden xl:inline">{busy ? 'Generating…' : 'Generate Report'}</span>
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        </summary>

        <div className="absolute right-0 z-20 mt-1 w-[15rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]">
          <p className="px-3 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-text-tertiary">
            {projectName}
          </p>

          {REPORT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={busy !== null}
              onClick={() => go(kind)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              {kind === 'year' ? (
                <CalendarRange className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              )}
              {REPORT_KIND_LABEL[kind]}
              {kind === 'year' && (
                <span className="ml-auto text-micro text-text-tertiary">choose…</span>
              )}
            </button>
          ))}
          <p className="border-t border-border-subtle px-3 pt-1.5 pb-1 text-micro text-text-tertiary">
            Each one is drawn in your report layout and opens as a PDF you can download.
          </p>
        </div>
      </details>

      {note && (
        <p
          className="absolute right-0 z-30 mt-1 max-w-[20rem] rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-micro shadow-[var(--shadow-lg)]"
          style={{ color: 'var(--feedback-error)' }}
          role="alert"
        >
          {note}
        </p>
      )}

      {/* ---- The year range, as the owner's second prompt ---- */}
      <Dialog
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        title="Which months?"
        description={`A month-by-month report for ${projectName}.`}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setRangeOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy !== null}
              onClick={() => {
                setRangeOpen(false);
                void generate('year', from, to);
              }}
            >
              {busy === 'year' ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor="report-from">
            <Select
              size="md"
              id="report-from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              options={months.map((month) => ({ value: month, label: monthTitle(month) }))}
            />
          </Field>
          <Field label="To" htmlFor="report-to">
            <Select
              size="md"
              id="report-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              options={months.map((month) => ({ value: month, label: monthTitle(month) }))}
            />
          </Field>
        </div>

        {/* ⚠️ Says what will happen rather than refusing a backwards range. The period
            builder swaps the bounds, because a two-dropdown picker makes
            March-to-January easy to choose by accident and a report covering nothing
            would read as "we did nothing". */}
        <p className="mt-3 text-micro text-text-tertiary">
          {from === to
            ? `One month: ${monthTitle(from)}.`
            : from < to
              ? `${monthTitle(from)} through ${monthTitle(to)}.`
              : `${monthTitle(to)} through ${monthTitle(from)} — the order is corrected for you.`}
        </p>
      </Dialog>
    </div>
  );
}
