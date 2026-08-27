import * as React from 'react';

import { BarChart, DonutChart, TrendChart } from '@/components/ui/chart';
import type { ChartSpec } from '@/lib/domain/report-charts';

/* ============================================================================
 * A CHART THE ASSISTANT ASKED FOR
 * ----------------------------------------------------------------------------
 * The model returns a `ChartSpec` — a description of what to draw — and this
 * hands it to the components the rest of the product already uses.
 *
 * ── ⚠️ WHY THE MODEL DOES NOT DRAW THE PICTURE ITSELF ──────────────────────
 * `lib/ai/report-image.ts` records what was measured when it did: an image
 * model renders *a handful of large figures* correctly and garbles anything
 * denser — *"a fifty-row table is not, and the failure is silent."* A drawn
 * chart also costs seconds and money per image, arrives as a flat bitmap that
 * ignores the theme, and cannot be read aloud.
 *
 * A spec costs nothing, renders instantly, follows the palette in both themes,
 * and publishes a hidden table for a screen reader — because `TrendChart` and
 * friends already do all of that. The model chooses WHAT to show; the app knows
 * HOW to show it.
 *
 * ── ⚠️ THE SPEC WAS ALREADY VALIDATED ──────────────────────────────────────
 * `validChart` in lib/ai/assistant/run.ts drops anything malformed before it
 * reaches the database, so this component can trust the shape. It still guards
 * the empty cases, because a spec that survived validation can still describe
 * nothing worth drawing once the data is in.
 * ========================================================================= */

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  if (spec.kind === 'bars') {
    if (spec.bars.length === 0) return null;
    return (
      <div className="mt-3 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface p-4">
        <p className="mb-3 text-caption font-semibold text-text-primary">{spec.title}</p>
        <BarChart bars={spec.bars} format={spec.format} caption={spec.question || spec.title} />
      </div>
    );
  }

  if (spec.kind === 'donut') {
    if (spec.slices.length === 0) return null;
    return (
      <div className="mt-3 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface p-4">
        <p className="mb-3 text-caption font-semibold text-text-primary">{spec.title}</p>
        <DonutChart
          slices={spec.slices}
          centreLabel={spec.centreLabel}
          centreValue={spec.centreValue}
          caption={spec.question || spec.title}
        />
      </div>
    );
  }

  /* A trend needs at least two points to be a trend rather than a dot. */
  if (spec.labels.length < 2 || spec.series.length === 0) return null;

  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface p-4">
      <p className="mb-3 text-caption font-semibold text-text-primary">{spec.title}</p>
      <TrendChart
        series={spec.series}
        labels={spec.labels}
        format={spec.format}
        height={200}
        /* ⚠️ `animate` deliberately off. It sets a stroke-dasharray that
           survives the draw, and in an anisotropic viewBox that renders as a
           row of disconnected segments — measured on the finance page, where
           the spending line came out broken and stayed broken. */
        caption={spec.question || spec.title}
      />
    </div>
  );
}
