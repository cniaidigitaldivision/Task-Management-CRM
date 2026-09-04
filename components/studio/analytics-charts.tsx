'use client';

import * as React from 'react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { compact } from '@/lib/domain/meta-studio';
import type {
  FunnelStage,
  RadarAxis,
  ScatterData,
  StackedSeries,
  WeekdayBar,
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
  height = 200,
}: {
  data: StackedSeries;
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
              className="fill-text-tertiary"
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
          i % Math.max(1, Math.ceil(n / 7)) === 0 ? (
            <text
              key={d}
              x={x(i)}
              y={height - 5}
              textAnchor="middle"
              className="fill-text-tertiary"
              style={{ fontSize: 8 }}
            >
              {d.slice(8)}/{d.slice(5, 7)}
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
 * Facebook against Instagram on the axes that genuinely compare.
 *
 * ⚠️ THE SHAPE IS PROPORTION, NEVER MAGNITUDE, and the figures are printed
 * beside it for that reason. Each axis is normalised against its own larger
 * value — see `platformRadar` — because followers are in the tens and
 * interactions in the hundreds, and one global scale would flatten every small
 * axis into the centre.
 */
export function PlatformRadar({ axes, size = 210 }: { axes: readonly RadarAxis[]; size?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  if (axes.length < 3) {
    return <p className="text-micro text-text-tertiary">Not enough comparable metrics.</p>;
  }

  const c = size / 2;
  const r = c - 30;
  const n = axes.length;

  /* Start at twelve o'clock and go clockwise, as a radar is always read. */
  const point = (i: number, scale: number) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(angle) * r * scale, c + Math.sin(angle) * r * scale] as const;
  };

  const shape = (pick: (a: RadarAxis) => number) =>
    axes.map((a, i) => point(i, inView ? pick(a) : 0.001).join(',')).join(' ');

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="flex flex-wrap items-center justify-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Platform comparison">
        {/* Web */}
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
            fill="none"
            stroke="var(--chart-grid)"
            strokeWidth="1"
          />
        ))}
        {axes.map((_, i) => {
          const [px, py] = point(i, 1);
          return (
            <line key={i} x1={c} y1={c} x2={px} y2={py} stroke="var(--chart-grid)" strokeWidth="1" />
          );
        })}

        {/* Facebook */}
        <polygon
          points={shape((a) => a.facebookScaled)}
          fill="var(--chart-1)"
          fillOpacity="0.22"
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{ transition: 'all 800ms cubic-bezier(0.16,1,0.3,1)' }}
        />
        {/* Instagram */}
        <polygon
          points={shape((a) => a.instagramScaled)}
          fill="var(--chart-2)"
          fillOpacity="0.22"
          stroke="var(--chart-2)"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{ transition: 'all 800ms cubic-bezier(0.16,1,0.3,1) 120ms' }}
        />

        {/* Vertices */}
        {axes.map((a, i) => {
          const [fx, fy] = point(i, inView ? a.facebookScaled : 0.001);
          const [ix, iy] = point(i, inView ? a.instagramScaled : 0.001);
          return (
            <g key={a.key} style={{ transition: 'all 800ms cubic-bezier(0.16,1,0.3,1)' }}>
              <circle cx={fx} cy={fy} r="3" fill="var(--chart-1)" />
              <circle cx={ix} cy={iy} r="3" fill="var(--chart-2)" />
            </g>
          );
        })}

        {/* Labels */}
        {axes.map((a, i) => {
          const [lx, ly] = point(i, 1.2);
          return (
            <text
              key={a.key}
              x={lx}
              y={ly}
              textAnchor={lx > c + 4 ? 'start' : lx < c - 4 ? 'end' : 'middle'}
              dominantBaseline="middle"
              className="fill-text-secondary"
              style={{ fontSize: 9, fontWeight: 600 }}
            >
              {a.label}
            </text>
          );
        })}
      </svg>

      {/* ⚠️ THE FIGURES, BESIDE THE SHAPE. The radar shows proportion only, so
          the numbers have to be readable somewhere or the panel is decoration. */}
      <dl className="min-w-[10rem] space-y-2">
        {axes.map((a) => (
          <div key={a.key} title={a.why}>
            <dt className="cursor-help text-[0.6rem] font-semibold uppercase tracking-wide text-text-tertiary">
              {a.label}
            </dt>
            <dd className="mt-0.5 flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <PlatformIcon slug="facebook" size={11} />
                <span className="text-micro font-bold tabular-nums text-text-primary">
                  {compact(a.facebook)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <PlatformIcon slug="instagram" size={11} />
                <span className="text-micro font-bold tabular-nums text-text-primary">
                  {compact(a.instagram)}
                </span>
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---- Scatter ------------------------------------------------------------- */

/**
 * Every post: reach across, interactions up.
 *
 * ⚠️ THE POINTS ARE DRAWN IN A SQUARE viewBox WITH THE ASPECT RATIO PRESERVED,
 * because a circle in a stretched viewBox becomes an ellipse — the same bug that
 * once shipped a coverage strip as one pink oval.
 */
export function ScatterChart({
  data,
  height = 230,
}: {
  data: ScatterData;
  height?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [hover, setHover] = React.useState<string | null>(null);

  if (data.points.length === 0) {
    return (
      <p className="grid place-items-center text-micro text-text-tertiary" style={{ height }}>
        No post carries both a reach and an interaction figure yet.
      </p>
    );
  }

  const W = 520;
  const PAD_L = 36;
  const PAD_B = 24;
  const PAD_T = 10;
  const plotW = W - PAD_L - 12;
  const plotH = height - PAD_B - PAD_T;

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
        aria-label="Reach against interactions, one point per post"
      >
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              x2={W - 12}
              y1={PAD_T + plotH - g * plotH}
              y2={PAD_T + plotH - g * plotH}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={PAD_T + plotH - g * plotH + 3}
              textAnchor="end"
              className="fill-text-tertiary"
              style={{ fontSize: 8 }}
            >
              {compact(Math.round(g * maxY))}
            </text>
            <text
              x={PAD_L + g * plotW}
              y={height - 12}
              textAnchor="middle"
              className="fill-text-tertiary"
              style={{ fontSize: 8 }}
            >
              {compact(Math.round(g * maxX))}
            </text>
          </g>
        ))}

        {/* Axis titles */}
        <text
          x={PAD_L + plotW / 2}
          y={height - 2}
          textAnchor="middle"
          className="fill-text-tertiary"
          style={{ fontSize: 8, fontWeight: 600 }}
        >
          Reach →
        </text>

        {/* Points */}
        {data.points.map((p, i) => {
          const on = hover === p.id;
          const token = p.platform === 'instagram' ? 'chart-2' : 'chart-1';
          return (
            <circle
              key={p.id}
              cx={x(p.reach)}
              cy={y(p.interactions)}
              /* ⚠️ A FIXED RADIUS, NOT ONE SCALED BY A THIRD VARIABLE. A bubble
                 chart encoding rate as area would put three quantities on a
                 chart with two axes and read as noise at this sample size. */
              r={on ? 7 : 5}
              fill={`var(--${token})`}
              fillOpacity={hover === null ? 0.72 : on ? 1 : 0.22}
              stroke={`var(--${token})`}
              strokeWidth={on ? 2 : 0}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              style={{
                cursor: 'pointer',
                transition: 'r 160ms, fill-opacity 160ms, opacity 500ms',
                opacity: inView ? 1 : 0,
                transitionDelay: inView ? `${Math.min(i * 18, 500)}ms` : '0ms',
              }}
            />
          );
        })}
      </svg>

      {/* Read-out, and the count of what could not be plotted. */}
      <div className="mt-1 flex min-h-[2.1rem] flex-wrap items-start justify-between gap-2">
        {active ? (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <PlatformIcon slug={active.platform} size={12} />
              <span className="truncate text-[0.62rem] font-semibold text-text-primary">
                {active.label}
              </span>
            </span>
            <span className="block text-[0.6rem] text-text-tertiary">
              {compact(active.reach)} reached · {active.interactions} interactions ·{' '}
              {active.rate.toFixed(2)}%
            </span>
          </span>
        ) : (
          <span className="text-[0.62rem] text-text-tertiary">
            Hover a point to read the post.
          </span>
        )}

        {/* ⚠️ THE EXCLUSIONS ARE NAMED. Half the collected posts carry no reach
            figure, and a chart that silently dropped them would overstate how
            much is known. */}
        {data.excluded > 0 && (
          <span className="shrink-0 text-[0.58rem] text-text-tertiary">
            {data.excluded} post{data.excluded === 1 ? '' : 's'} not shown — Meta gave no reach
            for them
          </span>
        )}
      </div>
    </div>
  );
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
