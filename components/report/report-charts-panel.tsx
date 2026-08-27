'use client';

import * as React from 'react';

import { BarChart, DonutChart, TrendChart } from '@/components/ui/chart';
import { Card, CardBody } from '@/components/ui/card';
import type { ChartSpec } from '@/lib/domain/report-charts';

/* ============================================================================
 * THE ANALYTICAL VIEW
 * ----------------------------------------------------------------------------
 * Owner: *"there should be an option for a graphical representation… an
 * analytical presentation showing the project's tasks in graph form… This is the
 * page where I can do the analysis of everything over there."*
 *
 * ── ⚠️ ONE COMPONENT, DRIVEN BY DATA, NOT ONE PER CHART ─────────────────────
 * Every chart on this page is a `ChartSpec` from `lib/domain/report-charts.ts`,
 * so this file is a switch and a layout and nothing else. That is what makes the
 * PDF possible: the same specs are drawn there by pdf-lib, and if the charts were
 * assembled here out of report rows the export could only ever be a screenshot.
 *
 * ── EVERY CHART CARRIES THE QUESTION IT ANSWERS ─────────────────────────────
 * Not decoration. The owner described the meeting these go into — *"we see which
 * project has how much posting, which person is doing which task, which project
 * is progressively improving"* — and a chart titled "Platform mix" beside one
 * titled "Content mix" is two charts nobody can tell apart at a glance. The
 * question underneath says which one to look at, and it is the same sentence the
 * pure module wrote, so screen and PDF cannot disagree about what a chart means.
 *
 * ── THE LAYOUT FOLLOWS THE SHAPE, NOT A GRID ────────────────────────────────
 * A trend needs width to be readable — 31 points squeezed into a third of the
 * page is a smear — so trends span the full row and the composition charts pair
 * up beside each other. Two columns rather than three: a donut with eight labelled
 * slices at a third of a 1280px page has legend text under 11px.
 * ========================================================================= */

export function ReportChartsPanel({ charts }: { charts: readonly ChartSpec[] }) {
  if (charts.length === 0) return null;

  /* Trends first and full width, everything else paired. Deliberately derived
     from the spec's own kind rather than from its position in the array, so the
     pure module can reorder its charts without the layout following it into
     something wrong. */
  const wide = charts.filter((c) => c.kind === 'trend');
  const narrow = charts.filter((c) => c.kind !== 'trend');

  return (
    <section aria-label="Charts" className="space-y-4">
      {wide.map((chart, index) => (
        <ChartCard key={`${chart.title}-${index}`} chart={chart} />
      ))}

      {narrow.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {narrow.map((chart, index) => (
            <ChartCard key={`${chart.title}-${index}`} chart={chart} />
          ))}
        </div>
      )}
    </section>
  );
}

function ChartCard({ chart }: { chart: ChartSpec }) {
  return (
    /* `break-inside-avoid` so a chart is never split across two printed pages —
       half a donut on the bottom of page two is worse than a page break above it. */
    <Card className="break-inside-avoid">
      <CardBody className="space-y-3">
        <header className="space-y-0.5">
          <h3 className="text-body font-semibold text-text-primary">{chart.title}</h3>
          <p className="text-caption text-text-secondary">{chart.question}</p>
        </header>
        <ChartBody chart={chart} />
      </CardBody>
    </Card>
  );
}

function ChartBody({ chart }: { chart: ChartSpec }) {
  switch (chart.kind) {
    case 'trend':
      /* An empty series list means the period held nothing to trend. The kit draws
         its own empty state for no POINTS, but a chart with no series at all would
         render an axis and nothing else, which reads as broken. */
      if (chart.series.length === 0) return <Empty />;
      return (
        <TrendChart
          series={chart.series}
          labels={chart.labels}
          format={chart.format}
          caption={`${chart.title} — ${chart.question}`}
          /* The wash muddies the moment there are two lines, and a completion-rate
             chart of three projects is the common case here. */
          fill={chart.series.length === 1}
          height={240}
        />
      );

    case 'donut':
      if (chart.slices.length === 0) return <Empty />;
      return (
        <div className="flex flex-wrap items-center gap-6">
          <DonutChart
            slices={chart.slices}
            centreLabel={chart.centreLabel}
            centreValue={chart.centreValue}
            caption={`${chart.title} — ${chart.question}`}
          />
          {/* The legend is beside the ring rather than under it: a donut's labels
              are its content, and putting them below pushes the next card down by
              the height of the list. */}
          <ul className="min-w-[9rem] flex-1 space-y-1.5">
            {chart.slices.map((slice) => (
              <li key={slice.label} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-px size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--${slice.token})` }}
                  />
                  <span className="truncate text-caption text-text-secondary">{slice.label}</span>
                </span>
                <span className="shrink-0 text-caption font-medium tabular-nums text-text-primary">
                  {slice.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'bars':
      if (chart.bars.length === 0) return <Empty />;
      return (
        <BarChart
          bars={chart.bars}
          format={chart.format}
          caption={`${chart.title} — ${chart.question}`}
          /* ⚠️ A percentage chart is scaled to 100, not to its own tallest bar.
             Ranked to the tallest, a team where everybody sits at 40% utilisation
             would draw one full-width bar and look fully loaded. */
          max={chart.format === 'percent' ? 100 : undefined}
        />
      );
  }
}

function Empty() {
  return (
    <p className="py-8 text-center text-caption text-text-tertiary">
      Nothing to chart for this period and filter.
    </p>
  );
}
