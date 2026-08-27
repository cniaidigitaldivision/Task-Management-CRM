'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * ATTENDANCE OVERVIEW — A COLUMN PER DAY
 * ----------------------------------------------------------------------------
 * The owner's reference draws present against absent as vertical columns, one per
 * day, with the count above each and the weekday beneath.
 *
 * ── ⚠️ WHY THIS IS NOT `BarChart` FROM THE CHART KIT ────────────────────────
 * That one draws HORIZONTAL bars with the label on the left — it is a ranking
 * chart, which is the right shape for "which project shipped most" and the wrong
 * one for a week. Bending it into columns would mean a second layout mode inside a
 * component the Reports page depends on, and the owner asked for this feature to
 * be isolated: *"Do not disturb any other working thing."*
 *
 * ── ⚠️ HTML, NOT SVG ────────────────────────────────────────────────────────
 * The chart kit's plot is a `viewBox="0 0 100 100"` with `preserveAspectRatio:
 * none`, which stretches text and turns circles into ellipses — so its labels are
 * HTML anyway. Columns need no curves and no hit-testing beyond the column
 * itself, so the whole thing is flexbox with percentage heights: nothing measures
 * itself, nothing renders at the wrong size first, and it reflows on a phone.
 *
 * ── ACCESSIBILITY IS NOT THE HOVER ──────────────────────────────────────────
 * The same contract as the chart kit: the visual is `aria-hidden` and a real
 * `<table>` in `sr-only` carries the numbers, because a screen reader can navigate
 * a table by row and column and read one value.
 * ========================================================================= */

export interface AttendanceColumn {
  readonly onDate: string;
  readonly weekday: string;
  readonly dayLabel: string;
  readonly present: number;
  readonly absent: number;
}

/* One definition each, used by the columns, the legend and nothing else. */
const PRESENT = 'var(--accent-primary)';
const ABSENT = 'color-mix(in oklab, var(--feedback-error) 55%, transparent)';

/** Round a ceiling up to something a person would draw an axis to. */
function niceCeiling(peak: number): number {
  /* ⚠️ Exact for a small team. Rounding a six-person division up to 10 drew every
     full-attendance day at 60% height, which looks like a shortfall that is not
     there. Below eight, the peak IS the ceiling. */
  if (peak <= 8) return peak <= 4 ? 4 : 8;
  if (peak <= 10) return 10;
  const step = peak <= 50 ? 10 : peak <= 200 ? 50 : 100;
  return Math.ceil(peak / step) * step;
}

export function AttendanceColumns({
  columns,
  caption,
  plotHeight = 208,
  className,
}: {
  columns: readonly AttendanceColumn[];
  caption: string;
  /**
   * The plot's height in pixels, axis included.
   *
   * ⚠️ A prop rather than a fixed `h-[13rem]`, because the card this sits in is
   * one of three that must end level with each other — owner, 2026-08-25: *"its
   * height is not equal to the other cards, that's why it's not looking good"*.
   * The plot is the tallest thing in the row, so it is the only number that can
   * settle where the row ends.
   */
  plotHeight?: number;
  className?: string;
}) {
  const [active, setActive] = React.useState<string | null>(null);

  if (columns.length === 0) {
    return (
      <p className={cn('py-10 text-center text-caption text-text-tertiary', className)}>
        No days in this range.
      </p>
    );
  }

  const peak = columns.reduce((top, c) => Math.max(top, c.present + c.absent), 0);
  /* ⚠️ Never zero. A zero ceiling makes every height 0/0 — NaN% — and the chart
     collapses, which reads as broken rather than as a quiet week. */
  const ceiling = niceCeiling(Math.max(peak, 1));
  /* ⚠️ Deduplicated. A ceiling of 5 gave 0, 1.25, 2.5, 3.75, 5 → rounded to
     0, 1, 3, 4, 5, and a ceiling of 2 gave 0, 1, 1, 2, 2 — an axis with the same
     number twice, which is what the first build showed (0, 3, 5, 8, 10 against a
     six-person team). Quarters only when they land on whole numbers. */
  const steps = ceiling % 4 === 0 ? [0, 0.25, 0.5, 0.75, 1] : ceiling % 2 === 0 ? [0, 0.5, 1] : [0, 1];
  const ticks = steps.map((f) => Math.round(ceiling * f)).reverse();

  return (
    <figure className={cn('space-y-3', className)}>
      {/* ---- Legend ---- */}
      {/* ── ⚠️ ABSENT IS NOT GREY ANY MORE ───────────────────────────────
          Owner, 2026-08-25: *"Right now Absent is in a gray color. In my UI this
          gray color is not even shown so please use such a color… so it will be
          easily visible."* They were right: `--chart-grid` is the GRIDLINE colour,
          which by definition disappears into the plot background — it reads on the
          reference's flat white and vanishes on ours, in both themes.

          It is now the same red the donut and the status pill already use for
          Absent, softened so a stack of it does not shout. One colour for one
          meaning across three components. */}
      <div className="flex items-center gap-4">
        <Key colour={PRESENT} label="Present" />
        <Key colour={ABSENT} label="Absent" />
      </div>

      <div aria-hidden="true" className="flex gap-2">
        {/* ---- The axis ---- */}
        <div
          className="flex w-8 shrink-0 flex-col justify-between text-right"
          style={{ height: plotHeight }}
        >
          {ticks.map((tick) => (
            <span key={tick} className="text-micro leading-none tabular-nums text-text-tertiary">
              {tick}
            </span>
          ))}
        </div>

        {/* ---- The plot ---- */}
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: plotHeight }}>
            {/* Gridlines behind the columns, one per axis tick. */}
            {ticks.map((tick, i) => (
              <span
                key={`line-${tick}-${i}`}
                className="absolute inset-x-0 h-px"
                style={{
                  top: `${(i / (ticks.length - 1)) * 100}%`,
                  backgroundColor: 'var(--chart-grid)',
                  opacity: i === ticks.length - 1 ? 1 : 0.5,
                }}
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
              {columns.map((column) => {
                const total = column.present + column.absent;
                const on = active === column.onDate;
                return (
                  <div
                    key={column.onDate}
                    className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                    onMouseEnter={() => setActive(column.onDate)}
                    onMouseLeave={() => setActive(null)}
                  >
                    {/* The count, above the column as the reference draws it. */}
                    <span
                      className={cn(
                        'mb-1 text-center text-micro tabular-nums',
                        on ? 'font-semibold text-text-primary' : 'text-text-secondary',
                      )}
                    >
                      {total === 0 ? '' : column.present}
                    </span>

                    {/* ⚠️ Absent sits ON TOP of present, so the teal always starts
                        at the baseline. Stacking it the other way makes the
                        present bar float and stop being comparable across days. */}
                    {column.absent > 0 && (
                      <span
                        className="w-full rounded-t-[3px]"
                        style={{
                          height: `${(column.absent / ceiling) * 100}%`,
                          backgroundColor: ABSENT,
                        }}
                      />
                    )}
                    <span
                      className={cn(
                        'w-full transition-opacity',
                        column.absent > 0 ? '' : 'rounded-t-[3px]',
                        active !== null && !on ? 'opacity-60' : 'opacity-100',
                      )}
                      style={{
                        height: `${(column.present / ceiling) * 100}%`,
                        backgroundColor: PRESENT,
                        /* A hairline so a zero-present day still shows a baseline
                           mark rather than nothing at all. */
                        minHeight: column.present > 0 ? 2 : 0,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- Day labels, two lines as in the reference ---- */}
          <div className="mt-2 flex gap-1 sm:gap-2">
            {columns.map((column) => (
              <div key={column.onDate} className="min-w-0 flex-1 text-center">
                <span
                  className={cn(
                    'block truncate text-micro',
                    active === column.onDate ? 'font-semibold text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {column.dayLabel}
                </span>
                <span className="block truncate text-micro text-text-tertiary">
                  {column.weekday}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Present</th>
            <th scope="col">Absent</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.onDate}>
              <th scope="row">
                {column.dayLabel} {column.weekday}
              </th>
              <td>{column.present}</td>
              <td>{column.absent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-micro text-text-secondary">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-[2px]"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
