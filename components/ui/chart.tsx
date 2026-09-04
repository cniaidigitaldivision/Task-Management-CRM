'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { type NumberFormat, formatNumber } from '@/lib/view/number-format';
import {
  arcPath,
  domainOf,
  donutSlices,
  indexFraction,
  nearestIndex,
  niceScale,
  ringSectorPath,
  smoothPath,
  valueFraction,
} from '@/lib/view/chart-geometry';

/* ============================================================================
 * THE CHART KIT — hand-built SVG, no charting dependency
 * ----------------------------------------------------------------------------
 * `TrendChart` · `DonutChart` · `Donut3D` · `GaugeArc` · `BarChart`
 *
 * Owner instruction, and the reason this file exists at all:
 *   *"If I move my cursor in a chart, the chart should follow my cursor and it
 *   should show details based on where my cursor is positioned."*
 *
 * That is the interaction in the security-dashboard reference: a vertical guide
 * pinned to the nearest data point, a ring on the point itself, the axis label
 * under it lit up, and a floating card reading out the values. All four move
 * together and all four snap to real data — a tooltip that follows the cursor
 * freely tells you about a position between two points, which is a number that
 * does not exist.
 *
 * ── WHY THERE IS NO CHARTING LIBRARY ─────────────────────────────────────────
 * Owner decision. Recharts is roughly 500 KB, and we measured a 3.6 MB
 * spreadsheet writer before installing it, so half a megabyte for four chart
 * shapes did not survive the same question. The arithmetic is in
 * `lib/view/chart-geometry.ts` and unit-tested; what is left here is markup.
 * It also means every colour is one of our own tokens natively, rather than a
 * theme object translated into a library's idea of a palette.
 *
 * ── WHY THE PLOT IS A 0–100 VIEWBOX AND THE TEXT IS HTML ─────────────────────
 * The plot stretches to whatever width it is given: `viewBox="0 0 100 100"` with
 * `preserveAspectRatio="none"` makes every coordinate a percentage, so nothing
 * has to measure itself. No ResizeObserver, no width in state, no first render
 * at the wrong size, and hit-testing is `(clientX - left) / width` — exact at
 * any width, including during a resize.
 *
 * The cost is that the viewBox is anisotropic, so anything that must not be
 * distorted cannot live in it: `text` would be stretched horizontally and a
 * `circle` would become an ellipse. Hence the axis labels, the guide, the point
 * rings and the tooltip are all HTML positioned in percentages, and the SVG
 * holds only gridlines, the area and the line — shapes that stretch correctly.
 * Strokes carry `vectorEffect="non-scaling-stroke"` so a wide chart does not draw
 * a wide line.
 *
 * ── ACCESSIBILITY IS NOT THE TOOLTIP ─────────────────────────────────────────
 * A hover tooltip is unreachable by keyboard and invisible to a screen reader, so
 * each chart carries two things instead: arrow-key scrubbing for a sighted
 * keyboard user, and a visually hidden table of the actual numbers, which is a
 * better representation of a chart than any label could be.
 * ========================================================================= */

export interface ChartSeries {
  readonly label: string;
  /** A token name without the `--`, e.g. `accent-primary` or `status-done`. */
  readonly token: string;
  readonly points: readonly number[];
}

/* --------------------------------------------------------------------------
 * Shared bits
 * ------------------------------------------------------------------------ */

/** `var(--x)`, in one place, so a token name is never concatenated by hand twice. */
const tok = (name: string) => `var(--${name})`;

/** The series colour, faded by the theme's own area strength. */
const areaOf = (name: string) =>
  `color-mix(in oklab, ${tok(name)} var(--chart-area-strength), transparent)`;

/**
 * The hidden table every chart publishes.
 *
 * Deliberately a real `<table>`: a screen reader can then navigate it by row and
 * column and read a single value, which no amount of `aria-label` prose achieves.
 */
function DataTable({
  caption,
  labels,
  series,
  print,
}: {
  caption: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  /** Already bound to a named format by the caller. */
  print: (n: number) => string;
}) {
  /* ⚠️ `sr-only` GOES ON A WRAPPER, NEVER ON THE `<table>` ITSELF

     Owner, 2026-09-04, of the Studio at 1536x730: *"there is a white space…
     why any card may be left behind, or some raw data or the height of
     something."* Raw data, and its height — it was these tables.

     `sr-only` hides a box by shrinking it to `width: 1px; height: 1px` and
     clipping it. FOR A `display: table` BOX BOTH OF THOSE ARE ONLY MINIMUMS —
     CSS never shrinks a table below its content — so the declaration is
     silently ignored and the element keeps its full size. Measured on /studio:
     344x768, not 1x1.

     `clip-path: inset(50%)` still made it invisible, which is why this went
     unnoticed — but an ABSOLUTELY POSITIONED BOX CONTRIBUTES TO SCROLLABLE
     OVERFLOW EVEN WHEN CLIPPED. Four charts on that page, and it scrolled 303px
     past its own footer to reach nothing.

     A wrapper `<div>` is not a table, so 1px applies to it, and its
     `overflow: hidden` stops the table's real size reaching an ancestor's
     scroll area. The `<table>` stays a real table — see above for why that
     matters to a screen reader. Verified in the browser: scrollHeight 1632 →
     1338 on a 730px window, the wrapper measuring 1x1 with all 31 rows intact.

     ⚠️ ONLY VISIBLE ON A PAGE SHORT ENOUGH for the overflow to land past the
     last card. Stacked at tablet and mobile widths the page was already taller
     than the tables reached, which is what made this look desktop-only. */
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label + i}>
              <th scope="row">{label}</th>
              {series.map((s) => (
                <td key={s.label}>{s.points[i] === undefined ? '—' : print(s.points[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
 * TrendChart — line or area, with cursor tracking
 * ========================================================================== */

export function TrendChart({
  series,
  labels,
  height = 220,
  format = 'integer',
  includeZero = true,
  tickCount = 4,
  fill = true,
  caption,
  legend = true,
  animate = false,
  animationKey = '',
  className,
}: {
  series: readonly ChartSeries[];
  /** One label per point. Its length decides how many points are drawn. */
  labels: readonly string[];
  height?: number;
  /** A NAMED format — a function cannot cross the server/client boundary. */
  format?: NumberFormat;
  includeZero?: boolean;
  tickCount?: number;
  /** The wash under the line. Off for two or more series, where they would muddy. */
  fill?: boolean;
  /** Names the chart for a screen reader and captions its hidden table. */
  caption: string;
  legend?: boolean;
  /**
   * Draw each line on, left to right, when it arrives.
   *
   * ⚠️ OPT-IN, default off. This component is on the dashboard, the reports page
   * and inside a project — the owner's standing instruction is *"do not disturb
   * any other working thing"*, and a shared chart that silently gains motion
   * everywhere is exactly that. Only callers that ask for it, and have been
   * looked at, get it.
   */
  animate?: boolean;
  /** Changing this replays the draw — pass the filter signature. */
  animationKey?: string;
  className?: string;
}) {
  /* Bound once. The prop is a name so it can arrive from a Server Component;
     everything below wants a function. */
  const print = (n: number) => formatNumber(n, format);

  const gradientId = React.useId();
  const [active, setActive] = React.useState<number | null>(null);

  const count = labels.length;
  const drawable = series.filter((s) => s.points.length > 0);

  const domain = domainOf(
    drawable.map((s) => s.points),
    { includeZero },
  );
  const scale = niceScale(domain.min, domain.max, tickCount);

  /* Nothing to draw. An explicit empty state rather than an axis with no line —
     a chart of nothing looks like a chart that is broken. */
  if (count === 0 || drawable.length === 0) {
    return (
      <div
        className={cn(
          'dot-grid grid place-items-center rounded-xl border border-border-default bg-bg-surface',
          className,
        )}
        style={{ height }}
      >
        <p className="text-caption text-text-tertiary">No data for this period yet.</p>
      </div>
    );
  }

  /* Plot coordinates in the 0–100 viewBox. y is inverted: SVG's origin is the
     top-left and a chart's is the bottom-left. */
  const pointsOf = (s: ChartSeries) =>
    Array.from({ length: count }, (_, i) => ({
      x: indexFraction(i, count) * 100,
      y: 100 - valueFraction(s.points[i] ?? scale.min, scale) * 100,
    }));

  const move = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    setActive(nearestIndex((clientX - rect.left) / rect.width, count));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step !== 0) {
      event.preventDefault();
      setActive((previous) => {
        const from = previous ?? (step > 0 ? -1 : count);
        return Math.min(count - 1, Math.max(0, from + step));
      });
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  const activeX = active === null ? 0 : indexFraction(active, count) * 100;
  /* The topmost active point decides which side of it the card sits on. */
  const highest =
    active === null
      ? 0
      : Math.max(...drawable.map((s) => valueFraction(s.points[active] ?? scale.min, scale)));
  const cardBelow = highest > 0.68;

  return (
    <figure className={cn('space-y-3', className)}>
      {legend && drawable.length > 1 && (
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {drawable.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tok(s.token) }}
              />
              <span className="text-micro font-medium text-text-secondary">{s.label}</span>
            </span>
          ))}
        </figcaption>
      )}

      <div className="flex gap-2">
        {/* Y axis. Reversed so the highest tick prints at the top. */}
        <div
          aria-hidden="true"
          className="flex shrink-0 flex-col justify-between pb-px text-right"
          style={{ height }}
        >
          {[...scale.ticks].reverse().map((tick) => (
            <span key={tick} className="tabular -translate-y-1/2 text-micro text-text-tertiary">
              {print(tick)}
            </span>
          ))}
        </div>

        {/* The plot. Every handler is here; the layers above it are inert. */}
        <div
          role="img"
          aria-label={caption}
          tabIndex={0}
          className={cn(
            'relative min-w-0 flex-1 cursor-crosshair rounded-lg',
            'focus-visible:ring-2 focus-visible:ring-accent-primary/50 focus-visible:outline-none',
          )}
          style={{ height }}
          onPointerMove={(e) => move(e.clientX, e.currentTarget)}
          onPointerDown={(e) => move(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              {drawable.map((s, i) => (
                <linearGradient
                  key={s.label}
                  id={`${gradientId}-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={areaOf(s.token)} />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              ))}
            </defs>

            {/* Gridlines: horizontal only. Vertical ones on a chart this size
                turn the plot into graph paper, and the x labels already say
                where the columns are. */}
            {scale.ticks.map((tick) => {
              const y = 100 - valueFraction(tick, scale) * 100;
              return (
                <line
                  key={tick}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke={tok('chart-grid')}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {drawable.map((s, i) => {
              const pts = pointsOf(s);
              const line = smoothPath(pts);
              return (
                /* ⚠️ Keyed on the selection as well as the label, so a changed
                   filter REMOUNTS the path and the draw runs again. A CSS
                   animation fires on element creation and never on a prop
                   change, so without the key the line would snap to its new
                   shape in one frame. */
                <g key={animate ? `${s.label}-${animationKey}` : s.label}>
                  {/* ── AREA FILLS NOW DRAW FOR EVERY SERIES ─────────────────
                      This was `drawable.length === 1`, so the dashboard's main
                      chart — Completed AND Created — rendered as two bare lines
                      on an empty field. That is a large part of why the owner
                      reported the interface reading as "blank stale" on
                      2026-08-15: the reference charts are all area-filled.

                      Two stacked areas at full strength would muddy where they
                      overlap, so a multi-series chart halves its opacity. The
                      lines stay at full weight and are still what you read the
                      values off; the fill is there to give the plot a body. */}
                  {fill && (
                    <path
                      d={`${line} L 100 100 L 0 100 Z`}
                      fill={`url(#${gradientId}-${i})`}
                      stroke="none"
                      opacity={drawable.length === 1 ? 1 : 0.35}
                      {...(animate
                        ? {
                            className: 'fade-in',
                            style: { '--fade-index': i } as React.CSSProperties,
                          }
                        : {})}
                    />
                  )}
                  <path
                    d={line}
                    fill="none"
                    stroke={tok(s.token)}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    /* ⚠️ `pathLength={1}` normalises the path to a length of 1,
                       so the dash arithmetic needs no measurement — no ref, no
                       `getTotalLength()`, no effect that runs after first paint
                       and no re-run on resize. The line is 1 unit long by
                       declaration, at any width. */
                    {...(animate
                      ? {
                          pathLength: 1,
                          className: 'line-draw',
                          style: { '--line-length': 1, '--line-index': i } as React.CSSProperties,
                        }
                      : {})}
                  />
                </g>
              );
            })}
          </svg>

          {/* ── The cursor layer ────────────────────────────────────────────
              HTML, not SVG: a circle in an anisotropic viewBox is an ellipse,
              and a dashed vertical line in one has uneven dashes. Deliberately
              untransitioned — the owner asked for the chart to follow the cursor,
              and an eased guide lags behind it. */}
          {active !== null && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span
                className="absolute top-0 bottom-0 w-0 border-l border-dashed"
                style={{ left: `${activeX}%`, borderColor: tok('chart-cursor') }}
              />
              {drawable.map((s) => {
                const value = s.points[active];
                if (value === undefined || !Number.isFinite(value)) return null;
                return (
                  <span
                    key={s.label}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2"
                    style={{
                      left: `${activeX}%`,
                      bottom: `${valueFraction(value, scale) * 100}%`,
                      backgroundColor: tok(s.token),
                      borderColor: tok('bg-surface'),
                      boxShadow: `0 0 0 3px color-mix(in oklab, ${tok(s.token)} 22%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* The reading. Translated by its own horizontal fraction, which makes
              it left-aligned at the first point, centred in the middle and
              right-aligned at the last — so it can never overflow the plot and
              needs no measurement to know that. */}
          {active !== null && (
            <div
              className="glass pointer-events-none absolute z-10 min-w-max rounded-lg border px-2.5 py-2 shadow-lg"
              style={{
                left: `${activeX}%`,
                [cardBelow ? 'top' : 'bottom']: `calc(${
                  cardBelow ? 100 - highest * 100 : highest * 100
                }% + 0.75rem)`,
                transform: `translateX(-${activeX}%)`,
              }}
            >
              <p className="text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                {labels[active]}
              </p>
              <ul className="mt-1 space-y-0.5">
                {drawable.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 text-caption">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tok(s.token) }}
                    />
                    <span className="text-text-secondary">{s.label}</span>
                    <span className="tabular ml-auto font-semibold text-text-primary">
                      {s.points[active] === undefined ? '—' : print(s.points[active])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* X axis. Same left offset as the plot, so a label sits under its point.
          `justify-between` with the first and last labels pulled inward matches
          `indexFraction`, which puts point 0 at 0% and the last at 100%. */}
      <div aria-hidden="true" className="flex gap-2">
        <div className="invisible shrink-0 text-right">
          {/* Occupies exactly the y-axis width so the row below lines up with the
              plot rather than with the figure. */}
          <span className="text-micro">{print(scale.max)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          {labels.map((label, i) => {
            const x = indexFraction(i, count) * 100;
            return (
              <span
                key={label + i}
                className={cn(
                  'absolute top-0 text-micro whitespace-nowrap',
                  active === i ? 'font-semibold text-text-primary' : 'text-text-tertiary',
                )}
                style={{ left: `${x}%`, transform: `translateX(-${x}%)` }}
              >
                {label}
              </span>
            );
          })}
          {/* Holds the row's height, since every label above it is absolute. */}
          <span className="invisible block text-micro">&nbsp;</span>
        </div>
      </div>

      <DataTable caption={caption} labels={labels} series={drawable} print={print} />
    </figure>
  );
}

/* ==========================================================================
 * DonutChart — proportions, with a legend that is part of the control
 * ========================================================================== */

export function DonutChart({
  slices,
  centreLabel,
  centreValue,
  size = 168,
  thickness = 14,
  format = 'integer',
  caption,
  legend = true,
  animate = false,
  className,
}: {
  slices: readonly { label: string; value: number; token: string }[];
  /** The default centre caption, shown when nothing is hovered. */
  centreLabel: string;
  centreValue: string;
  size?: number;
  thickness?: number;
  /** A NAMED format — a function cannot cross the server/client boundary. */
  format?: NumberFormat;
  caption: string;
  /**
   * Draw the built-in legend.
   *
   * ⚠️ DEFAULTS TRUE, so every existing caller is unaffected — this component is
   * on the dashboard, the reports page and inside a project, and the standing
   * instruction is not to disturb working screens. Pass false only where the
   * caller draws its own, which the Studio's Content Type Share does to get the
   * `42% (521)` shape from the owner's reference. Two legends is not a cosmetic
   * problem: the Audience card shipped with both and printed every figure twice.
   */
  legend?: boolean;
  /**
   * Sweep each segment open on mount.
   *
   * ⚠️ OPT-IN, default off — this component is on the dashboard, the reports
   * page and inside a project, and the standing instruction is not to disturb
   * working screens. A shared component that silently gains motion everywhere
   * is exactly that.
   */
  animate?: boolean;
  className?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);

  const print = (n: number) => formatNumber(n, format);

  const geometry = donutSlices(slices.map((s) => s.value));
  const total = slices.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0);

  /* A square viewBox with the default aspect handling, so a circle is a circle.
     r is chosen so the stroke sits inside the box at any thickness. */
  const r = 50 - thickness / 2;
  const circumference = 2 * Math.PI * r;
  /* A hairline of surface between segments, so two adjacent slices of similar
     colour still read as two. Dropped for a single full-ring slice, where a gap
     would show as a nick in an otherwise complete circle. */
  const gap = geometry.filter((g) => g.length > 0).length > 1 ? 1.2 : 0;

  const shown = active === null ? null : slices[active];

  return (
    <figure className={cn('flex flex-wrap items-center gap-x-6 gap-y-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={tok('chart-grid')}
            strokeWidth={thickness}
          />
          {geometry.map((g, i) => {
            if (g.length === 0) return null;
            const length = Math.max(0, g.length * circumference - gap);
            const dimmed = active !== null && active !== i;
            return (
              <circle
                key={slices[i].label}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={tok(slices[i].token)}
                strokeWidth={active === i ? thickness + 3 : thickness}
                strokeLinecap={gap > 0 ? 'butt' : 'round'}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-g.offset * circumference}
                /* ⚠️ The keyframe needs this segment's OWN lengths, since one
                   shared animation serves every differently-sized arc. The
                   `to` values match the attribute above, so the segment holds
                   its correct size once the sweep finishes. */
                style={
                  animate
                    ? ({
                        '--donut-len': `${length}`,
                        '--donut-rest': `${circumference - length}`,
                        '--donut-circ': `${circumference}`,
                        animation: `donut-sweep 1100ms cubic-bezier(0.16,1,0.3,1) ${i * 130}ms both`,
                      } as React.CSSProperties)
                    : undefined
                }
                opacity={dimmed ? 0.32 : 1}
                className="transition-[opacity,stroke-width] duration-150 motion-reduce:transition-none"
              />
            );
          })}
        </svg>

        {/* The centre reads out whatever is hovered, so the ring answers a
            question instead of only illustrating one. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <div>
            <p className="tabular text-h3 leading-none font-semibold text-text-primary">
              {shown ? print(shown.value) : centreValue}
            </p>
            <p className="mt-1 line-clamp-2 text-micro text-text-tertiary">
              {shown ? shown.label : centreLabel}
            </p>
          </div>
        </div>
      </div>

      {/* The legend is the interaction. Hovering a ring segment is a fiddly
          target — 14px of arc — and on a touch screen it is no target at all.
          ⚠️ A caller that suppresses this must draw its own, or the slices become
          unlabelled and unreachable by keyboard. */}
      <figcaption hidden={!legend} className="min-w-[10rem] flex-1 space-y-0.5">
        {slices.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left',
              'transition-colors duration-150 hover:bg-bg-hover motion-reduce:transition-none',
              'focus-visible:ring-2 focus-visible:ring-accent-primary/50 focus-visible:outline-none',
              active === i && 'bg-bg-hover',
            )}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: tok(s.token) }}
            />
            <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
              {s.label}
            </span>
            <span className="tabular shrink-0 text-caption font-semibold text-text-primary">
              {print(s.value)}
            </span>
            <span className="tabular w-10 shrink-0 text-right text-micro text-text-tertiary">
              {total > 0 ? `${Math.round(geometry[i].share * 100)}%` : '—'}
            </span>
          </button>
        ))}
        {/* `sr-only` on the WRAPPER, not on the `<table>`: `width/height: 1px` do not
           shrink a table box, so the absolute element keeps its full size and extends
           the page's scrollable overflow. See `DataTable` in components/ui/chart.tsx. */}
        <div className="sr-only">
          <table>
            <caption>{caption}</caption>
            <tbody>
              {slices.map((s, i) => (
                <tr key={s.label}>
                  <th scope="row">{s.label}</th>
                  <td>{print(s.value)}</td>
                  <td>{total > 0 ? `${Math.round(geometry[i].share * 100)}%` : '0%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figcaption>
    </figure>
  );
}

/* ==========================================================================
 * Donut3D — the same proportions, seen from above at an angle
 * ==========================================================================
 * Owner, 2026-08-25, of the attendance distribution card: *"I want a circular
 * chart or a bar. This circular bar should be in a 3D view."*
 *
 * ── ⚠️ WHY THIS IS A SEPARATE COMPONENT AND NOT A PROP ON DonutChart ────────
 * `DonutChart` is a stroked circle — one `<circle>` per slice with a dash offset,
 * which is why it is twenty lines and never wrong. None of that survives the
 * projection: a stroke cannot follow an ellipse at a constant width, and a solid
 * body needs filled paths. Bolting a `dimensional` flag onto it would mean two
 * unrelated renderers behind one signature, in a component the dashboard and the
 * reports page depend on. The owner's standing instruction is *"do not disturb
 * any other working thing"*, so the flat one is left exactly as it is.
 *
 * ── ⚠️ THE BODY IS THE SAME FACE, STAMPED DOWNWARDS ─────────────────────────
 * The obvious way to draw the side wall is to work out which slices face the
 * viewer and give each one a quadrilateral. That needs the front/back split, the
 * two silhouette edges, and a per-slice z-order — three chances to get a seam
 * wrong at some particular set of values.
 *
 * Instead the top face is drawn once per slice and repeated at increasing depth,
 * deepest first. The union of those copies IS the solid: the outer wall appears
 * at the front, the inner wall appears inside the hole at the back, and both are
 * hidden exactly where the top face covers them. No case analysis, and it is
 * correct for one slice or for six.
 *
 * The stamps darken towards the bottom, which is what makes it read as a lit
 * object rather than as a stack of rings.
 * ========================================================================== */

export function Donut3D({
  slices,
  centreLabel,
  centreValue,
  size = 160,
  /**
   * How far the ring is tilted. 1 is face-on; lower is a shallower angle.
   *
   * ⚠️ This and `innerRatio` together decide whether the centre readout FITS.
   * The hole is an ellipse, so tilting harder shortens it — at 0.66 with a 0.6
   * hole the two lines were taller than the gap they sit in and the figure landed
   * on top of the ring. Lower either of these and check the centre again.
   */
  squash = 0.7,
  /** How thick the ring's body is, in the same units as the 100-wide viewBox. */
  depth = 9,
  /** The hole, as a fraction of the outer radius. See `squash`. */
  innerRatio = 0.7,
  format = 'integer',
  caption,
  className,
}: {
  slices: readonly { label: string; value: number; token: string }[];
  centreLabel: string;
  centreValue: string;
  size?: number;
  squash?: number;
  depth?: number;
  innerRatio?: number;
  /** A NAMED format — a function cannot cross the server/client boundary. */
  format?: NumberFormat;
  caption: string;
  className?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const sheenId = React.useId();

  const print = (n: number) => formatNumber(n, format);

  const geometry = donutSlices(slices.map((s) => s.value));
  const total = slices.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0);
  const drawn = geometry.filter((g) => g.length > 0).length;

  /* ── The projection, in viewBox units ──────────────────────────────────── */
  const CX = 50;
  const RX = 46;
  const ry = RX * squash;
  const irx = RX * innerRatio;
  const iry = ry * innerRatio;
  const cy = 2 + ry;
  /* The box has to hold the tilted ring AND the body hanging below it. */
  const boxHeight = cy + ry + depth + 2;

  /* A sliver of background between neighbours, so two slices of similar colour
     still read as two. Dropped for a single slice, where it would show as a nick
     in an otherwise complete ring. */
  const gapDeg = drawn > 1 ? 1.4 : 0;

  /* ── ⚠️ THE HOLE YOU CAN SEE IS NOT THE HOLE OF THE TOP FACE ──────────────
     The body is the top face stamped from `depth` down to 0, so what stays empty
     is the INTERSECTION of all those holes, not any one of them. The deepest
     stamp's hole is `depth` units lower than the shallowest, so the visible gap
     is shorter by exactly `depth` and its middle sits `depth / 2` BELOW the
     ring's own centre.

     Centring the readout on `cy` therefore pushes it up against the ring's inner
     edge — measured in the browser at the first attempt: the block sat 5px above
     the opening and "99.2%" was drawn across the Late slice. These two numbers
     are the opening as it actually appears. */
  const holeCy = cy + depth / 2;
  const holeHeight = Math.max(0, 2 * iry - depth);

  const faces = slices.map((slice, i) => {
    const g = geometry[i];
    const from = g.offset * 360;
    const to = from + g.length * 360;
    return {
      token: slice.token,
      d:
        g.length === 0
          ? ''
          : ringSectorPath({
              cx: CX,
              cy,
              rx: RX,
              ry,
              irx,
              iry,
              /* ⚠️ The gap is only taken from slices wide enough to give it. A
                 1.4° inset on a 1° slice would invert the sector, and an inverted
                 sector fills as the whole rest of the ring. */
              startDeg: g.length * 360 > gapDeg * 2 ? from + gapDeg / 2 : from,
              endDeg: g.length * 360 > gapDeg * 2 ? to - gapDeg / 2 : to,
            }),
    };
  });

  /* Deepest first: each shallower stamp paints over the one below, which is what
     leaves the wall visible at the front and hidden at the back. */
  const stamps = Array.from({ length: Math.max(0, Math.round(depth)) }, (_, k) => depth - k);

  const wholeRing = ringSectorPath({
    cx: CX,
    cy,
    rx: RX,
    ry,
    irx,
    iry,
    startDeg: 0,
    endDeg: 360,
  });

  return (
    <figure className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', className)}>
      <div
        className="relative shrink-0"
        style={{ width: size, height: (size * boxHeight) / 100 }}
      >
        <svg
          viewBox={`0 0 100 ${boxHeight}`}
          className="h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={sheenId} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor="rgb(255 255 255 / 0.26)" />
              <stop offset="52%" stopColor="rgb(255 255 255 / 0.04)" />
              <stop offset="100%" stopColor="rgb(255 255 255 / 0)" />
            </linearGradient>
          </defs>

          {/* ── The body ──────────────────────────────────────────────────── */}
          {stamps.map((dy) => (
            <g key={dy} transform={`translate(0 ${dy.toFixed(2)})`}>
              {faces.map((face, i) =>
                face.d === '' ? null : (
                  <path
                    key={slices[i].label}
                    d={face.d}
                    fill={`color-mix(in oklab, ${tok(face.token)} ${(
                      62 -
                      (dy / Math.max(depth, 1)) * 20
                    ).toFixed(1)}%, black)`}
                    opacity={active !== null && active !== i ? 0.32 : 1}
                  />
                ),
              )}
            </g>
          ))}

          {/* ── The top face ──────────────────────────────────────────────── */}
          {faces.map((face, i) =>
            face.d === '' ? null : (
              <path
                key={slices[i].label}
                d={face.d}
                fill={tok(face.token)}
                opacity={active !== null && active !== i ? 0.32 : 1}
                className="transition-opacity duration-150 motion-reduce:transition-none"
              />
            ),
          )}

          {/* The light. Painted over the whole ring rather than per slice, so the
              highlight runs across the object instead of restarting at every
              boundary — which is what would make it read as flat colour again. */}
          {total > 0 && <path d={wholeRing} fill={`url(#${sheenId})`} />}

          {/* Nothing recorded yet: the ring still draws, in the gridline colour,
              so the card reads as "no data" rather than as a failed render. */}
          {total === 0 && <path d={wholeRing} fill={tok('chart-grid')} />}
        </svg>

        {/* ── ⚠️ THE CENTRE IS SIZED AND PLACED FROM THE VISIBLE OPENING ──────
            `holeCy` and `holeHeight` above, not `cy` and the inner radius — see
            the note there. `overflow-hidden` is the backstop for a label longer
            than the opening can hold: it clips inside the hole rather than
            spilling onto the ring, which is the failure this whole block exists
            to prevent. The readout stays legible whether the caption fits on one
            line or wraps to two. */}
        <div
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col justify-center overflow-hidden text-center"
          style={{
            left: '50%',
            top: `${(holeCy / boxHeight) * 100}%`,
            /* The viewBox is rendered at a uniform scale — `size` px per 100
               units on BOTH axes — so one conversion serves both. */
            width: `${(irx * 1.78 * size) / 100}px`,
            height: `${(holeHeight * 0.94 * size) / 100}px`,
          }}
        >
          <p className="tabular text-body leading-none font-semibold text-text-primary">
            {active === null ? centreValue : print(slices[active].value)}
          </p>
          <p className="mt-0.5 line-clamp-2 text-micro leading-tight text-text-tertiary">
            {active === null ? centreLabel : slices[active].label}
          </p>
        </div>
      </div>

      {/* The legend is the interaction, for the same reason as the flat donut:
          a tilted slice is an even fiddlier target than a flat one, and on a
          touch screen it is no target at all. */}
      {/* ⚠️ `6rem`, which is what "On leave / 0 (0%)" needs and not a pixel more.
          This minimum is half of the wrap threshold: at 7rem the legend dropped
          below the ring as soon as the sidebar was expanded, because that takes
          about 43px out of a card on 3 of 12 columns. */}
      <figcaption className="min-w-[6rem] flex-1 space-y-0.5">
        {slices.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left',
              'transition-colors duration-150 hover:bg-bg-hover motion-reduce:transition-none',
              'focus-visible:ring-2 focus-visible:ring-accent-primary/50 focus-visible:outline-none',
              active === i && 'bg-bg-hover',
            )}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tok(s.token) }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-caption leading-tight text-text-secondary">
                {s.label}
              </span>
              <span className="tabular block text-micro leading-tight font-semibold text-text-primary">
                {print(s.value)}
                <span className="font-normal text-text-tertiary">
                  {' '}
                  ({total > 0 ? Math.round(geometry[i].share * 100) : 0}%)
                </span>
              </span>
            </span>
          </button>
        ))}

        {/* `sr-only` on the WRAPPER, not on the `<table>`: `width/height: 1px` do not
           shrink a table box, so the absolute element keeps its full size and extends
           the page's scrollable overflow. See `DataTable` in components/ui/chart.tsx. */}
        <div className="sr-only">
          <table>
            <caption>{caption}</caption>
            <tbody>
              {slices.map((s, i) => (
                <tr key={s.label}>
                  <th scope="row">{s.label}</th>
                  <td>{print(s.value)}</td>
                  <td>{total > 0 ? `${Math.round(geometry[i].share * 100)}%` : '0%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figcaption>
    </figure>
  );
}

/* ==========================================================================
 * GaugeArc — one figure against its ceiling
 * ========================================================================== */

export function GaugeArc({
  value,
  max,
  label,
  hint,
  token = 'accent-primary',
  size = 148,
  thickness = 11,
  format = 'integer',
  className,
}: {
  value: number;
  max: number;
  label: string;
  hint?: string;
  token?: string;
  size?: number;
  thickness?: number;
  /** A NAMED format — a function cannot cross the server/client boundary. */
  format?: NumberFormat;
  className?: string;
}) {
  /* 240° from the eight o'clock position, as in the reference: a full ring has
     no beginning, so a reading of nearly-full and a reading of nearly-empty look
     alike. An open arc has a start and an end and cannot be misread. */
  const SWEEP = 240;
  const START = -120;

  const print = (n: number) => formatNumber(n, format);

  const safe = Number.isFinite(value) ? value : 0;
  const ceiling = Number.isFinite(max) && max > 0 ? max : 1;
  const fraction = Math.min(1, Math.max(0, safe / ceiling));
  const end = START + SWEEP * fraction;

  const r = 50 - thickness / 2;
  const knob = arcPath(50, 50, r, end, end); // its own end point, for the marker

  return (
    <figure className={cn('inline-flex flex-col items-center', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
          <path
            d={arcPath(50, 50, r, START, START + SWEEP)}
            fill="none"
            stroke={tok('chart-grid')}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
          {fraction > 0 && (
            <path
              d={arcPath(50, 50, r, START, end)}
              fill="none"
              stroke={tok(token)}
              strokeWidth={thickness}
              strokeLinecap="round"
            />
          )}
          {/* The knob from the reference. Drawn from the arc's own end point, so
              it cannot drift out of step with the value it marks. */}
          {fraction > 0 && (
            <path
              d={knob}
              stroke={tok('bg-surface')}
              strokeWidth={thickness - 4}
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>

        <div className="absolute inset-0 grid place-items-center px-5 text-center">
          <div>
            <p className="tabular text-h2 leading-none font-semibold text-text-primary">
              {print(safe)}
            </p>
            <p className="mt-1 text-micro text-text-tertiary">of {print(ceiling)}</p>
          </div>
        </div>
      </div>

      <figcaption className="mt-1 text-center">
        <span className="block text-caption font-medium text-text-primary">{label}</span>
        {hint && <span className="block text-micro text-text-tertiary">{hint}</span>}
        <span className="sr-only">
          {print(safe)} of {print(ceiling)}, {Math.round(fraction * 100)} per cent
        </span>
      </figcaption>
    </figure>
  );
}

/* ==========================================================================
 * BarChart — a ranked comparison, horizontal
 * ==========================================================================
 * Added for the reports page: *"which project has how much posting, which person
 * is doing which task"*. Both are comparisons across a handful of NAMED things,
 * which is the one shape the other three charts in this file cannot draw — a
 * trend needs an ordered axis, and a donut answers "what share" rather than
 * "how many".
 *
 * ── ⚠️ HORIZONTAL, AND NOT NEGOTIABLE ───────────────────────────────────────
 * The labels are people's names and project names. Vertical bars would have to
 * rotate them 45°, truncate them, or drop every other one — and this chart exists
 * to be read across a meeting table. Horizontal bars give each label a full line
 * of ordinary left-to-right text at any width.
 *
 * ── ⚠️ HTML, NOT SVG, UNLIKE THE REST OF THIS FILE ──────────────────────────
 * The other three charts are SVG because they draw curves and arcs. A horizontal
 * bar is a rectangle with a label, i.e. a list — and as HTML it wraps, it scales
 * with the reader's font size, the labels are selectable text, and it prints
 * without the anisotropic-viewBox problem documented at the top of this file.
 * Reaching for SVG here would be consistency for its own sake at the cost of all
 * four of those.
 *
 * The bars are `<div>`s rather than a `<progress>` each: a progress element is a
 * task's completion, semantically, and eleven of them stacked is not what this is.
 * The hidden table carries the meaning instead, as it does for every chart here.
 * ========================================================================== */

export function BarChart({
  bars,
  format = 'integer',
  caption,
  /** Shown against each bar, to the right of the value. */
  showNotes = true,
  max,
  className,
}: {
  bars: readonly { label: string; value: number; token: string; note?: string }[];
  /** A NAMED format — a function cannot cross the server/client boundary. */
  format?: NumberFormat;
  caption: string;
  showNotes?: boolean;
  /**
   * The value a full-width bar represents. Defaults to the largest bar, which
   * makes this a RANKING; pass 100 for a percentage chart, where a full bar has
   * to mean 100% rather than "the highest of these".
   */
  max?: number;
  className?: string;
}) {
  const print = (n: number) => formatNumber(n, format);

  const drawable = bars.filter((b) => Number.isFinite(b.value));
  const largest = drawable.reduce((peak, b) => Math.max(peak, b.value), 0);
  /* ⚠️ Never zero. A zero ceiling makes every width `0/0` — NaN% — and the row
     collapses to nothing, so an all-zero chart would look like a broken one
     rather than like a quiet month. */
  const ceiling = Math.max(max ?? largest, 1);

  if (drawable.length === 0) {
    return (
      <p className={cn('py-6 text-center text-caption text-text-tertiary', className)}>
        Nothing to compare in this period.
      </p>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Same accessibility contract as the other three: the visual is decorative
          and the hidden table is the real content. */}
      <div aria-hidden="true" className="space-y-2">
        {drawable.map((bar, index) => {
          const fraction = Math.min(1, Math.max(0, bar.value / ceiling));
          return (
            <div key={bar.label + index} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-caption text-text-primary">{bar.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {showNotes && bar.note && (
                    <span className="text-micro text-text-tertiary">{bar.note}</span>
                  )}
                  <span className="text-caption font-medium tabular-nums text-text-primary">
                    {print(bar.value)}
                  </span>
                </span>
              </div>
              {/* The track, so a short bar still reads as a share of something
                  rather than as a stray mark. */}
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--bg-subtle)' }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    /* A hairline minimum, so a non-zero value is never invisible.
                       A bar of exactly zero width and a bar of one worth the same
                       thing on screen is a chart that hides the difference between
                       "none" and "barely any". */
                    width: bar.value > 0 ? `max(2px, ${fraction * 100}%)` : 0,
                    backgroundColor: tok(bar.token),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <DataTable
        caption={caption}
        labels={drawable.map((b) => b.label)}
        /* One row per bar, so the table reads label → value. The trend charts use
           the transpose of this, which is why `series` takes an array. */
        series={[{ label: 'Value', token: 'accent-primary', points: drawable.map((b) => b.value) }]}
        print={print}
      />
    </div>
  );
}
