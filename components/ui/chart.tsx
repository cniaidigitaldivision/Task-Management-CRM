'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  arcPath,
  domainOf,
  donutSlices,
  indexFraction,
  nearestIndex,
  niceScale,
  smoothPath,
  valueFraction,
} from '@/lib/view/chart-geometry';

/* ============================================================================
 * THE CHART KIT — hand-built SVG, no charting dependency
 * ----------------------------------------------------------------------------
 * `TrendChart` · `DonutChart` · `GaugeArc`
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

const DEFAULT_FORMAT = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

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
  format,
}: {
  caption: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  format: (n: number) => string;
}) {
  return (
    <table className="sr-only">
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
              <td key={s.label}>{s.points[i] === undefined ? '—' : format(s.points[i])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ==========================================================================
 * TrendChart — line or area, with cursor tracking
 * ========================================================================== */

export function TrendChart({
  series,
  labels,
  height = 220,
  format = DEFAULT_FORMAT,
  includeZero = true,
  tickCount = 4,
  fill = true,
  caption,
  legend = true,
  className,
}: {
  series: readonly ChartSeries[];
  /** One label per point. Its length decides how many points are drawn. */
  labels: readonly string[];
  height?: number;
  format?: (n: number) => string;
  includeZero?: boolean;
  tickCount?: number;
  /** The wash under the line. Off for two or more series, where they would muddy. */
  fill?: boolean;
  /** Names the chart for a screen reader and captions its hidden table. */
  caption: string;
  legend?: boolean;
  className?: string;
}) {
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
              {format(tick)}
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
                <g key={s.label}>
                  {fill && drawable.length === 1 && (
                    <path
                      d={`${line} L 100 100 L 0 100 Z`}
                      fill={`url(#${gradientId}-${i})`}
                      stroke="none"
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
                      {s.points[active] === undefined ? '—' : format(s.points[active])}
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
          <span className="text-micro">{format(scale.max)}</span>
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

      <DataTable caption={caption} labels={labels} series={drawable} format={format} />
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
  format = DEFAULT_FORMAT,
  caption,
  className,
}: {
  slices: readonly { label: string; value: number; token: string }[];
  /** The default centre caption, shown when nothing is hovered. */
  centreLabel: string;
  centreValue: string;
  size?: number;
  thickness?: number;
  format?: (n: number) => string;
  caption: string;
  className?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);

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
              {shown ? format(shown.value) : centreValue}
            </p>
            <p className="mt-1 line-clamp-2 text-micro text-text-tertiary">
              {shown ? shown.label : centreLabel}
            </p>
          </div>
        </div>
      </div>

      {/* The legend is the interaction. Hovering a ring segment is a fiddly
          target — 14px of arc — and on a touch screen it is no target at all. */}
      <figcaption className="min-w-[10rem] flex-1 space-y-0.5">
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
              {format(s.value)}
            </span>
            <span className="tabular w-10 shrink-0 text-right text-micro text-text-tertiary">
              {total > 0 ? `${Math.round(geometry[i].share * 100)}%` : '—'}
            </span>
          </button>
        ))}
        <table className="sr-only">
          <caption>{caption}</caption>
          <tbody>
            {slices.map((s, i) => (
              <tr key={s.label}>
                <th scope="row">{s.label}</th>
                <td>{format(s.value)}</td>
                <td>{total > 0 ? `${Math.round(geometry[i].share * 100)}%` : '0%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  format = DEFAULT_FORMAT,
  className,
}: {
  value: number;
  max: number;
  label: string;
  hint?: string;
  token?: string;
  size?: number;
  thickness?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  /* 240° from the eight o'clock position, as in the reference: a full ring has
     no beginning, so a reading of nearly-full and a reading of nearly-empty look
     alike. An open arc has a start and an end and cannot be misread. */
  const SWEEP = 240;
  const START = -120;

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
              {format(safe)}
            </p>
            <p className="mt-1 text-micro text-text-tertiary">of {format(ceiling)}</p>
          </div>
        </div>
      </div>

      <figcaption className="mt-1 text-center">
        <span className="block text-caption font-medium text-text-primary">{label}</span>
        {hint && <span className="block text-micro text-text-tertiary">{hint}</span>}
        <span className="sr-only">
          {format(safe)} of {format(ceiling)}, {Math.round(fraction * 100)} per cent
        </span>
      </figcaption>
    </figure>
  );
}
