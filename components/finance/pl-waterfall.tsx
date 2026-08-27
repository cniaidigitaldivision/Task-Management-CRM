import * as React from 'react';

import type { WaterfallStep } from '@/lib/domain/finance';
import { pkrCompact } from '@/lib/domain/money';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PROFIT AND LOSS WATERFALL
 * ----------------------------------------------------------------------------
 * Income at the top, each category stepping down from it, and what is left at
 * the bottom. It answers "where did it all go" in one glance, which neither a
 * donut (no sense of what remains) nor a bar chart (no sense of sequence) can.
 *
 * ── ⚠️ EVERY BAR IS MEASURED AGAINST THE SAME SCALE ────────────────────────
 * The scale is the largest absolute running total, so a step's LENGTH is
 * proportional to its amount across the whole chart. Scaling each bar to its own
 * category — which is what makes the code simpler — would draw a 9,000 rupee
 * internet bill the same width as a 805,000 payroll, and the picture would say
 * the opposite of the truth.
 *
 * ── ⚠️ A LOSS IS DRAWN BELOW THE AXIS, NOT AS A SHORT GREEN BAR ────────────
 * When spending exceeds income the final step is negative. It is drawn in the
 * error token and labelled "Loss", because a small positive-looking bar at the
 * bottom of a waterfall reads as a thin profit — the single most expensive
 * misreading this chart could invite.
 *
 * ── A SERVER COMPONENT ──────────────────────────────────────────────────────
 * Every position is arithmetic on props and the reveal is CSS, so this ships no
 * client bundle. Colours are token names mixed with `color-mix`, never hexes, so
 * both themes work.
 * ========================================================================= */

export function PlWaterfall({
  steps,
  className,
}: {
  steps: readonly WaterfallStep[];
  className?: string;
}) {
  if (steps.length === 0) {
    return (
      <p className={cn('py-10 text-center text-caption text-text-tertiary', className)}>
        Nothing recorded in this period.
      </p>
    );
  }

  /* ── ⚠️ THE AXIS IS TWO-SIDED, AND IT HAS TO BE ────────────────────────────
     The first version measured every bar from zero rightwards and clamped the
     low end with `Math.max(0, low)`. That works only while the running total
     stays positive. It does not here: this division spends far more than it
     earns, so the total crosses zero at the salaries step and every bar after it
     collapsed to the 0.6% minimum — measured in the browser as `458, 458, 3, 3,
     3, 3, 3, 446`. Five categories, each a 3px sliver, on a chart whose whole
     job is comparing them.

     So the domain spans the real minimum to the real maximum, ALWAYS including
     zero, and every value is mapped into it. A bar then runs between its two
     ends wherever those fall, and the zero rule lands wherever it belongs
     rather than always at the left edge. */
  const bounds = steps.flatMap((step) => [step.from, step.to]).concat(0);
  const min = Math.min(...bounds);
  const max = Math.max(...bounds);
  /* Guarded so an all-empty period divides by 1 rather than producing NaN
     widths, which render as no bar at all — indistinguishable from no data. */
  const span = Math.max(1, max - min);

  /** A rupee figure to a percentage across the track. */
  const x = (value: number) => ((value - min) / span) * 100;
  const zeroAt = x(0);

  return (
    <div className={cn('space-y-2', className)} data-reveal="out">
      {steps.map((step, index) => {
        /* A step's bar spans from its lower end to its higher end — which for a
           spend step means it hangs from where the running total WAS down to
           where it now IS. That hanging is what makes a waterfall readable.

           The net step is measured from zero instead, because "what is left" is
           a quantity against nothing, not a change from the previous step. */
        const from = step.kind === 'net' ? 0 : step.from;
        const low = Math.min(from, step.to);
        const high = Math.max(from, step.to);

        const left = x(low);
        /* A floor of 0.6%, so a category too small to see is still a mark on the
           page rather than a silently missing row. */
        const width = Math.max(0.6, x(high) - x(low));

        return (
          <div
            key={`${step.label}-${index}`}
            className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)_minmax(5rem,7rem)] items-center gap-3"
          >
            <span
              className={cn(
                'truncate text-caption',
                step.kind === 'net'
                  ? 'font-semibold text-text-primary'
                  : 'text-text-secondary',
              )}
              title={step.label}
            >
              {step.label}
            </span>

            <div className="relative h-6 overflow-hidden rounded-[var(--radius-sm)] bg-bg-surface-sunken">
              {/* ⚠️ The rule sits at ZERO, wherever that falls — not at the left
                  edge. When spending outruns income the axis crosses, and a rule
                  pinned left would tell the reader the bars start from nothing
                  when several of them start from a deficit. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 w-px bg-border-strong"
                style={{ left: `${zeroAt}%` }}
              />
              <span
                className="waterfall-step absolute inset-y-[3px] rounded-[var(--radius-xs)]"
                style={{
                  left: `${left}%`,
                  '--step-width': `${width}%`,
                  backgroundColor: `var(--${step.token})`,
                  /* Later steps arrive later, so the eye follows the fall.
                     ⚠️ 260ms of head start before the first one: a transition
                     only interpolates once the browser has painted the start
                     state, and without the hold an already-visible chart snaps
                     straight to its finished width. Same reason `.reveal-bar`
                     carries one. */
                  transitionDelay: `${260 + index * 110}ms`,
                } as React.CSSProperties}
              />
            </div>

            <span
              className={cn(
                'tabular text-right text-caption',
                step.kind === 'net' ? 'font-bold' : 'font-medium',
              )}
              /* ⚠️ `--money-*`, not the step's own chart token. The BAR is
                 filled with `step.token`, which is correct — a filled shape has
                 no contrast requirement. The FIGURE is text, and the chart hues
                 measured 2.80–3.77:1 on white. See the note beside
                 `--emerald-text-l` in tokens.css. */
              style={{
                color:
                  step.kind === 'net'
                    ? step.to >= 0
                      ? 'var(--money-in)'
                      : 'var(--money-out)'
                    : step.delta < 0
                      ? 'var(--text-secondary)'
                      : 'var(--money-in)',
              }}
            >
              {step.kind === 'net'
                ? pkrCompact(step.to)
                : step.delta < 0
                  ? `−${pkrCompact(Math.abs(step.delta)).replace('PKR ', '')}`
                  : `+${pkrCompact(step.delta).replace('PKR ', '')}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
