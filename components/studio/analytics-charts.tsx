'use client';

import * as React from 'react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { compact } from '@/lib/domain/meta-studio';
import {
  MEASURE_LABEL,
  type FunnelStage,
  type RadarAxis,
  type ScatterData,
  type ScatterMeasure,
  type ScatterPoint,
  type StackedSeries,
  type WeekdayBar,
} from '@/lib/domain/meta-analytics';
import { cn } from '@/lib/utils';

import { useInView } from './use-in-view';

/* ============================================================================
 * THE ANALYTICS CHART TYPES — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Proper graphs, donuts, vertical bars, and all these things but very
 * beautifully. Also add any other type of graph."*
 *
 * Five shapes the Studio did not have: a stacked area, a radar, a scatter, a
 * funnel and a grouped weekday bar. The line, donut, gauge and heatmap already
 * exist and are reused rather than reimplemented.
 *
 * ── ⚠️ EVERY CHART DRAWS AT FULL VALUE AND ANIMATES ON TOP ─────────────────
 * Three times in this feature an entrance animation has been the only thing
 * standing between real data and being visible: chart lines frozen at frame 0
 * under `prefers-reduced-motion`, a reveal gate hiding a panel's contents, and a
 * sync ring that rendered grey because its dash array started at zero. So the
 * rule, applied here without exception: geometry is computed from the data and
 * an animation may only change HOW it arrives, never WHETHER it is there. A
 * missing IntersectionObserver costs a flourish, never a figure.
 *
 * ── ⚠️ `preserveAspectRatio="none"` DISTORTS EVERY ROUND THING ─────────────
 * It stretches x and y by different factors, so a circle becomes an ellipse and
 * an `rx` becomes a lozenge — which is exactly how a coverage strip once shipped
 * as one pink oval. Anything with a radius here therefore lives in a viewBox
 * whose aspect ratio is preserved, or is drawn with `vectorEffect` and explicit
 * pixel sizing.
 * ========================================================================= */

/* ---- Stacked area -------------------------------------------------------- */

/**
 * The interaction mix, day by day.
 *
 * ⚠️ THE BANDS ACCUMULATE UPWARD AND THE TOP EDGE OF EACH IS ITS OWN PATH, so a
 * band is the ribbon between two lines rather than a shape drawn over its
 * neighbours. Drawing four overlapping area charts back-to-front looks identical
 * until one band is zero, at which point the one beneath shows through and the
 * reader sees a colour that means nothing.
 */
export function StackedArea({
  data,
  labels,
  height = 200,
}: {
  data: StackedSeries;
  /* ⚠️ THE FORMATTED LABELS COME FROM THE CALLER, so this chart's x-axis reads
     identically to the trend chart's above it — "Sep 4", month named, no year.
     Formatting the raw ISO date here would put a second date format on the same
     page and the two would drift the first time one was changed. */
  labels?: readonly string[];
  height?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);

  const W = 600;
  const PAD_L = 34;
  const PAD_B = 18;
  const PAD_T = 8;
  const plotW = W - PAD_L - 6;
  const plotH = height - PAD_B - PAD_T;

  const n = data.dates.length;
  if (n === 0 || data.max === 0) {
    return (
      <p className="grid h-[--h] place-items-center text-micro text-text-tertiary"
         style={{ '--h': `${height}px` } as React.CSSProperties}>
        No interactions recorded in this period.
      </p>
    );
  }

  const x = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / data.max) * plotH;

  /* Running totals, so each band sits on the one below it. */
  const floors: number[][] = [];
  let running = new Array(n).fill(0) as number[];
  for (const band of data.bands) {
    floors.push([...running]);
    running = running.map((v, i) => v + band.values[i]);
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Interactions by kind, per day"
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid */}
        {gridLines.map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              x2={W - 6}
              y1={PAD_T + plotH - g * plotH}
              y2={PAD_T + plotH - g * plotH}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={PAD_T + plotH - g * plotH + 3}
              textAnchor="end"
              fill="var(--text-tertiary)"
              style={{ fontSize: 8 }}
            >
              {compact(Math.round(g * data.max))}
            </text>
          </g>
        ))}

        {/* Bands, bottom to top */}
        {data.bands.map((band, bi) => {
          const floor = floors[bi];
          const top = floor.map((f, i) => f + band.values[i]);

          const path =
            top.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v)}`).join(' ') +
            ' ' +
            floor
              .map((v, i) => `L${x(n - 1 - i)} ${y(floor[n - 1 - i])}`)
              .slice(0, n)
              .join(' ') +
            ' Z';

          return (
            <path
              key={band.key}
              d={path}
              fill={`var(--${band.token})`}
              fillOpacity={hover === null || hover === bi ? 0.82 : 0.28}
              stroke={`var(--${band.token})`}
              strokeWidth="1"
              strokeOpacity={hover === null || hover === bi ? 1 : 0.4}
              style={{
                transition: 'fill-opacity 200ms, stroke-opacity 200ms, transform 700ms cubic-bezier(0.16,1,0.3,1)',
                /* ⚠️ SCALED FROM THE BASELINE, not built from zero height. The
                   path is always complete; the animation only rises it. */
                transform: inView ? 'scaleY(1)' : 'scaleY(0.001)',
                transformOrigin: `0 ${PAD_T + plotH}px`,
                transitionDelay: `${bi * 90}ms`,
              }}
            />
          );
        })}

        {/* Dates */}
        {data.dates.map((d, i) =>
          i % Math.max(1, Math.ceil(n / 6)) === 0 ? (
            <text
              key={d}
              x={x(i)}
              y={height - 5}
              textAnchor="middle"
              fill="var(--text-tertiary)"
              style={{ fontSize: 8 }}
            >
              {labels?.[i] ?? `${d.slice(8)}/${d.slice(5, 7)}`}
            </text>
          ) : null,
        )}
      </svg>

      {/* Legend, and the interaction: hovering a key isolates its band. */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {data.bands.map((band, bi) => {
          const total = band.values.reduce((a, b) => a + b, 0);
          return (
            <button
              key={band.key}
              type="button"
              onMouseEnter={() => setHover(bi)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(bi)}
              onBlur={() => setHover(null)}
              className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-bg-subtle"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--${band.token})` }}
              />
              <span className="text-[0.62rem] text-text-secondary">{band.label}</span>
              <span className="text-[0.62rem] font-bold tabular-nums text-text-primary">
                {compact(total)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Radar --------------------------------------------------------------- */

/**
 * Facebook against Instagram, on five axes.
 *
 * ⚠️ A PLATFORM THAT DOES NOT REPORT AN AXIS LEAVES A BREAK IN ITS SHAPE, never
 * a vertex at the centre. Facebook publishes no reach figure at all, and a
 * point at zero there would say "nobody saw it" when the truth is "we cannot
 * know". So Facebook's outline is an open path that skips that axis, and the
 * axis label is marked so the gap reads as deliberate rather than as a bug.
 *
 * ⚠️ SCALED PER AXIS, NOT GLOBALLY. Followers are in the tens and views in the
 * thousands; one global scale would flatten every small axis into the centre and
 * the shape would carry no information. Each axis is normalised against its own
 * larger side — which means the shape shows PROPORTION and never magnitude, and
 * is why the figures are printed beneath it.
 */
export function PlatformRadar({ axes, size = 168 }: { axes: readonly RadarAxis[]; size?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [hover, setHover] = React.useState<string | null>(null);

  if (axes.length < 3) {
    return <p className="text-micro text-text-tertiary">Not enough comparable metrics.</p>;
  }

  const c = size / 2;
  const r = c - 34;
  const n = axes.length;

  /* Twelve o'clock, clockwise — the way a radar is always read. */
  const point = (i: number, scale: number) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(angle) * r * scale, c + Math.sin(angle) * r * scale] as const;
  };

  /**
   * ⚠️ A PATH, NOT A `<polygon>`, so it can be left open where an axis is
   * missing. A polygon element always closes itself, which would draw a chord
   * straight across the gap and imply a value that was never measured.
   */
  const shape = (pick: (a: RadarAxis) => number | null) => {
    const present = axes.map((a, i) => ({ i, v: pick(a) }));
    const complete = present.every((p) => p.v !== null);

    let d = '';
    let pen = false;
    for (const { i, v } of present) {
      if (v === null) {
        pen = false;
        continue;
      }
      const [x, y] = point(i, inView ? v : 0.001);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
    }
    return complete ? `${d}Z` : d;
  };

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Facebook against Instagram"
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
            fill={ring === 1 ? 'var(--chart-grid)' : 'none'}
            fillOpacity={ring === 1 ? 0.28 : 0}
            stroke="var(--chart-grid)"
            strokeWidth="1"
          />
        ))}
        {axes.map((_, i) => {
          const [px, py] = point(i, 1);
          return <line key={i} x1={c} y1={c} x2={px} y2={py} stroke="var(--chart-grid)" strokeWidth="1" />;
        })}

        {(
          [
            { key: 'facebook', token: 'chart-1', pick: (a: RadarAxis) => a.facebookScaled },
            { key: 'instagram', token: 'chart-2', pick: (a: RadarAxis) => a.instagramScaled },
          ] as const
        ).map((side, si) => (
          <path
            key={side.key}
            d={shape(side.pick)}
            fill={`var(--${side.token})`}
            fillOpacity={hover === null || hover === side.key ? 0.16 : 0.04}
            stroke={`var(--${side.token})`}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{
              transition: 'all 700ms cubic-bezier(0.16,1,0.3,1)',
              transitionDelay: `${si * 100}ms`,
            }}
          />
        ))}

        {axes.map((a, i) =>
          (['facebook', 'instagram'] as const).map((k) => {
            const v = k === 'facebook' ? a.facebookScaled : a.instagramScaled;
            if (v === null) return null;
            const [px, py] = point(i, inView ? v : 0.001);
            return (
              <circle
                key={`${a.key}-${k}`}
                cx={px}
                cy={py}
                r="2.6"
                fill={`var(--${k === 'facebook' ? 'chart-1' : 'chart-2'})`}
                style={{ transition: 'all 700ms cubic-bezier(0.16,1,0.3,1)' }}
              />
            );
          }),
        )}

        {axes.map((a, i) => {
          const [lx, ly] = point(i, 1.26);
          /* An axis one platform cannot report is marked, so the break in the
             shape beside it reads as deliberate. */
          const partial = a.facebook === null || a.instagram === null;
          return (
            <text
              key={a.key}
              x={lx}
              y={ly}
              textAnchor={lx > c + 4 ? 'start' : lx < c - 4 ? 'end' : 'middle'}
              dominantBaseline="middle"
              fill={partial ? 'var(--text-tertiary)' : 'var(--text-secondary)'}
              style={{ fontSize: 8, fontWeight: 600 }}
            >
              {a.label}
              {partial ? ' *' : ''}
            </text>
          );
        })}
      </svg>

      {/* Legend — hovering a side brings its shape forward. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {(
          [
            { key: 'facebook', label: 'Facebook', token: 'chart-1' },
            { key: 'instagram', label: 'Instagram', token: 'chart-2' },
          ] as const
        ).map((side) => (
          <button
            key={side.key}
            type="button"
            onMouseEnter={() => setHover(side.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(side.key)}
            onBlur={() => setHover(null)}
            className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-bg-subtle"
          >
            <span
              aria-hidden="true"
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: `var(--${side.token})` }}
            />
            <span className="text-[0.6rem] text-text-secondary">{side.label}</span>
          </button>
        ))}
      </div>

      {axes.some((a) => a.facebook === null || a.instagram === null) && (
        <p className="text-center text-[0.54rem] leading-tight text-text-tertiary">
          * one platform only — hover an axis label for why
        </p>
      )}
    </div>
  );
}

/* ---- Scatter ------------------------------------------------------------- */

/**
 * Every post as a bubble: reach across, interactions up, area by the chosen
 * measure.
 *
 * ⚠️ AREA, NOT RADIUS, ENCODES THE MEASURE. Doubling a radius quadruples the
 * area, so a bubble sized by radius overstates every large value fourfold — the
 * single most common way a bubble chart lies. `r = sqrt(share)` keeps the ink
 * proportional to the number.
 *
 * ⚠️ AND A POST WITH NO REACH IS EXCLUDED AND COUNTED, never plotted at x = 0.
 * Only half the collected posts carry a reach figure — Facebook posts largely do
 * not — and a column of them stacked on the y-axis would look like a real
 * finding about posts that reached nobody.
 */
export function ScatterChart({
  data,
  measure,
  height = 168,
}: {
  data: ScatterData;
  measure: ScatterMeasure;
  height?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [hover, setHover] = React.useState<string | null>(null);

  const W = 480;
  const PAD_L = 44;
  const PAD_B = 30;
  const PAD_T = 10;
  const PAD_R = 16;
  const plotW = W - PAD_L - PAD_R;
  const plotH = height - PAD_B - PAD_T;

  const sized = React.useMemo(() => {
    const of = (p: ScatterPoint) =>
      measure === 'reach' ? p.reach : measure === 'rate' ? p.rate : p.interactions;
    const max = Math.max(1, ...data.points.map(of));
    return data.points.map((p) => ({ point: p, share: of(p) / max }));
  }, [data.points, measure]);

  if (data.points.length === 0) {
    return (
      <p className="grid place-items-center text-micro text-text-tertiary" style={{ height }}>
        No post carries both a reach and an interaction figure yet.
      </p>
    );
  }

  const maxX = Math.max(1, data.maxReach);
  const maxY = Math.max(1, data.maxInteractions);

  const x = (v: number) => PAD_L + (v / maxX) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / maxY) * plotH;

  const active = data.points.find((p) => p.id === hover) ?? null;

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Reach against interactions, one bubble per post"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={PAD_T + plotH - g * plotH}
              y2={PAD_T + plotH - g * plotH}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={PAD_T + plotH - g * plotH + 3}
              textAnchor="end"
              fill="var(--text-tertiary)"
              style={{ fontSize: 8 }}
            >
              {compact(Math.round(g * maxY))}
            </text>
            <text
              x={PAD_L + g * plotW}
              y={height - 14}
              textAnchor="middle"
              fill="var(--text-tertiary)"
              style={{ fontSize: 8 }}
            >
              {compact(Math.round(g * maxX))}
            </text>
          </g>
        ))}

        {/* Axis titles, as the reference labels them. */}
        <text
          x={PAD_L + plotW / 2}
          y={height - 3}
          textAnchor="middle"
          fill="var(--text-secondary)"
          style={{ fontSize: 8, fontWeight: 600 }}
        >
          Reach
        </text>
        <text
          x={9}
          y={PAD_T + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 9 ${PAD_T + plotH / 2})`}
          fill="var(--text-secondary)"
          style={{ fontSize: 8, fontWeight: 600 }}
        >
          Engagements
        </text>

        {/* ⚠️ LARGEST FIRST, so a small bubble is never buried under a big one. */}
        {[...sized]
          .sort((a, b) => b.share - a.share)
          .map(({ point: p, share }, i) => {
            const on = hover === p.id;
            /* Multicoloured, as the reference draws them — the palette cycles by
               a hash of the id, so a post keeps its colour between renders. */
            const token = `chart-${(hashOf(p.id) % 8) + 1}`;
            const radius = 4 + Math.sqrt(share) * 9;
            return (
              <circle
                key={p.id}
                cx={x(p.reach)}
                cy={y(p.interactions)}
                r={on ? radius + 2 : radius}
                fill={`var(--${token})`}
                fillOpacity={hover === null ? 0.72 : on ? 0.95 : 0.18}
                stroke={`var(--${token})`}
                strokeWidth={on ? 2 : 0}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                style={{
                  cursor: 'pointer',
                  transition: 'r 160ms, fill-opacity 160ms, opacity 500ms',
                  opacity: inView ? 1 : 0,
                  transitionDelay: inView ? `${Math.min(i * 14, 400)}ms` : '0ms',
                }}
              />
            );
          })}
      </svg>

      <div className="mt-0.5 flex min-h-[1.6rem] flex-wrap items-start justify-between gap-2">
        {active ? (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <PlatformIcon slug={active.platform} size={11} />
              <span className="truncate text-[0.6rem] font-semibold text-text-primary">
                {active.label}
              </span>
            </span>
            <span className="block text-[0.56rem] text-text-tertiary">
              {compact(active.reach)} reached · {active.interactions} interactions ·{' '}
              {active.rate.toFixed(2)}%
            </span>
          </span>
        ) : (
          <span className="text-[0.56rem] text-text-tertiary">
            Bubble size = {MEASURE_LABEL[measure].replace('By ', '')}. Hover for the post.
          </span>
        )}

        {/* ⚠️ THE EXCLUSIONS ARE NAMED. Half the collected posts carry no reach
            figure, and a chart that silently dropped them would overstate how
            much is known. */}
        {data.excluded > 0 && (
          <span className="shrink-0 text-[0.54rem] text-text-tertiary">
            {data.excluded} without a reach figure
          </span>
        )}
      </div>
    </div>
  );
}

/** Stable per-id colour, so a bubble keeps its hue across renders. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/* ---- Funnel -------------------------------------------------------------- */

/**
 * The engagement stages, largest first, each cut to a chevron on the right.
 *
 * ── ⚠️ THE WIDTH ENCODES RANK, NOT MAGNITUDE, AND THAT IS A REAL TRADE ─────
 * The first version scaled each bar by its value. On live figures that spans
 * 213,000 down to 42, so four of the six bars collapsed onto the minimum-width
 * floor and the panel looked broken rather than informative — which is what the
 * owner was looking at.
 *
 * The reference tapers by position instead: its own Impressions bar (2.74M) is
 * drawn NARROWER than its Reach bar (1.56M). So width here is a reading order,
 * and the figures — right-aligned, with their share of the bar above — carry
 * every quantity. That is an honest division of labour as long as nothing
 * pretends otherwise: the bars are sorted largest-first, so a wider bar is
 * always a larger number even though the widths are not proportional to it.
 *
 * ⚠️ THE CHEVRON IS A `clip-path`, not a border trick, so the notch shows the
 * panel behind rather than a wedge of some other colour.
 */
export function Funnel({ stages }: { stages: readonly FunnelStage[] }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  const ordered = React.useMemo(() => {
    const sorted = [...stages].sort((a, b) => b.value - a.value);
    return sorted.map((s, i) => ({
      ...s,
      /* ⚠️ RECOMPUTED AGAINST THE BAR ABOVE. Once the order is by value, a
         percentage comparing against a stage drawn elsewhere in the list is
         unreadable — a reader takes "9.5%" to mean "of the bar above", and it
         now does. A stage that carries no conversion of its own (the Facebook
         one) keeps none: a ratio across two platforms would be arithmetic
         dressed up as a finding. */
      conversion:
        i === 0 || s.conversion === null || sorted[i - 1].value === 0
          ? null
          : (s.value / sorted[i - 1].value) * 100,
    }));
  }, [stages]);

  if (ordered.every((s) => s.value === 0)) {
    return <p className="text-micro text-text-tertiary">Nothing collected for this period.</p>;
  }

  /* Full width down to 80%, in even steps — the reference's taper is gentle,
     and a gentle taper is also what keeps every bar long enough that a 7px
     notch reads as a bevel rather than as an arrowhead. */
  const widthAt = (i: number) =>
    ordered.length <= 1 ? 100 : 100 - (i / (ordered.length - 1)) * 20;

  return (
    <div ref={ref} className="flex h-full flex-col justify-between gap-1">
      {ordered.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div className="relative h-7 min-w-0 flex-1" title={s.note}>
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: inView ? `${widthAt(i)}%` : '0%',
                background: `color-mix(in oklab, var(--${s.token}) 30%, transparent)`,
                /* ⚠️ 6px OF NOTCH ON A 28px BAR. At fourteen the point was
                   half the bar's height and the whole shape read as an ARROW
                   rather than a funnel stage — which is what the owner saw. The
                   depth has to track the bar's height: shortening the row without
                   shortening the point brings the arrow straight back. */
                clipPath:
                  'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)',
                borderRadius: '6px',
                transition: 'width 760ms cubic-bezier(0.16,1,0.3,1)',
                transitionDelay: `${i * 70}ms`,
              }}
            />
            <span className="absolute inset-y-0 left-2.5 flex items-center truncate pr-4 text-[0.64rem] font-semibold text-text-primary">
              {s.label}
            </span>
          </div>

          <span className="w-[3.4rem] shrink-0 text-right text-micro font-bold tabular-nums text-text-primary">
            {compact(s.value)}
          </span>

          <span className="w-[2.6rem] shrink-0 text-right text-[0.58rem] font-semibold tabular-nums text-text-tertiary">
            {s.conversion === null
              ? ''
              : `${s.conversion >= 10 ? Math.round(s.conversion) : s.conversion.toFixed(1)}%`}
          </span>
        </div>
      ))}

      <p className="text-[0.54rem] leading-tight text-text-tertiary">
        Largest first; each percentage is a share of the bar above. Hover for its platform.
      </p>
    </div>
  );
}

/* ---- Weekday bars -------------------------------------------------------- */

/**
 * Posts and engagement rate by day of week.
 *
 * ⚠️ TWO SCALES, LABELLED — a count on the left and a percentage on the right.
 * Putting a post count and an engagement rate on one axis would make three posts
 * tower over a 4% rate and say nothing at all. Dual axes are usually a smell;
 * here the two quantities genuinely belong on the same day and cannot share a
 * scale.
 */
export function WeekdayBars({
  bars,
  height = 190,
}: {
  bars: readonly WeekdayBar[];
  height?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const maxPosts = Math.max(1, ...bars.map((b) => b.posts));
  const maxRate = Math.max(0.01, ...bars.map((b) => b.rate ?? 0));

  return (
    <div ref={ref}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {bars.map((b, i) => {
          const barH = (b.posts / maxPosts) * (height - 34);
          const dotY = b.rate === null ? null : (b.rate / maxRate) * (height - 34);

          return (
            <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[0.58rem] font-bold tabular-nums text-text-primary">
                {b.posts || ''}
              </span>

              <div className="relative flex w-full justify-center" style={{ height: height - 34 }}>
                {/* The rate marker, on its own scale. */}
                {dotY !== null && (
                  <span
                    className="absolute z-10 size-2 rounded-full ring-2 ring-bg-surface"
                    style={{
                      bottom: inView ? dotY - 4 : -4,
                      backgroundColor: 'var(--chart-3)',
                      transition: 'bottom 700ms cubic-bezier(0.16,1,0.3,1)',
                      transitionDelay: `${i * 60 + 200}ms`,
                    }}
                    title={`${b.rate?.toFixed(2)}% engagement`}
                  />
                )}

                <span
                  className="absolute bottom-0 w-full max-w-[2.2rem] rounded-t-md"
                  style={{
                    height: inView ? Math.max(b.posts > 0 ? 4 : 0, barH) : 0,
                    background: `linear-gradient(180deg, var(--chart-4), color-mix(in oklab, var(--chart-4) 55%, transparent))`,
                    transition: 'height 700ms cubic-bezier(0.16,1,0.3,1)',
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              </div>

              <span
                className={cn(
                  'mt-1.5 text-[0.6rem]',
                  b.posts > 0 ? 'font-semibold text-text-secondary' : 'text-text-tertiary',
                )}
              >
                {b.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle pt-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-3 rounded-sm"
            style={{ backgroundColor: 'var(--chart-4)' }}
          />
          <span className="text-[0.6rem] text-text-secondary">Posts published</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: 'var(--chart-3)' }}
          />
          <span className="text-[0.6rem] text-text-secondary">
            Engagement rate (own scale, peak {maxRate.toFixed(2)}%)
          </span>
        </span>
      </div>
    </div>
  );
}
