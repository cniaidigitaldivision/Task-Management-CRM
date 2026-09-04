'use client';

import * as React from 'react';

/* ============================================================================
 * THE CHARTS THE REFERENCE NEEDS AND THE KIT DID NOT HAVE
 * ----------------------------------------------------------------------------
 * `components/ui/chart.tsx` covers a single-series trend, a donut and a bar
 * ranking, and those are reused as-is. These three have no equivalent and are
 * built here rather than bent out of the shared kit, which is on the dashboard,
 * the reports page and inside a project — the standing instruction is *"do not
 * disturb any other working thing"*, and widening a shared component for one
 * page is exactly that.
 *
 *   MultiSeriesChart  lines with points, plus a bar series, on two axes
 *   SegmentedGauge    the red→green arc with a needle
 *   RankedBars        a labelled row list with a value and a share
 *
 * ── ⚠️ HAND-BUILT SVG, NO CHART LIBRARY ────────────────────────────────────
 * The CSP admits no runtime chart dependency and the existing kit is hand-built
 * for the same reason. These follow its conventions: a viewBox in user units,
 * tokens through `var(--…)`, and a hidden table so a screen reader gets the
 * numbers rather than a shrug.
 * ========================================================================= */

const tok = (name: string) => `var(--${name})`;

export interface Series {
  readonly label: string;
  /** `chart-1` … `chart-8`. */
  readonly token: string;
  readonly points: readonly (number | null)[];
  /** Bars rise from the axis behind the lines — the reference's Impressions. */
  readonly kind?: 'line' | 'bar';
  /** Drawn dashed — the reference's "Last Month" comparison. */
  readonly dashed?: boolean;
}

/* ---- Multi-series chart -------------------------------------------------- */

export function MultiSeriesChart({
  series,
  labels,
  height = 250,
  animationKey = '',
  /** Off for the growth chart, where both series are the same quantity. */
  dualAxis = true,
}: {
  series: readonly Series[];
  labels: readonly string[];
  height?: number;
  animationKey?: string;
  dualAxis?: boolean;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  /* Legend toggling. ⚠️ Not a nicety — see the axis note below. With four series
     spanning three orders of magnitude, switching one off is what makes the
     small ones readable at all. */
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set());

  const W = 780;
  const H = 250;
  const PAD = { top: 16, right: dualAxis ? 44 : 14, bottom: 28, left: 44 };

  const visible = series.filter((s) => !hidden.has(s.label));
  const drawn = visible.filter((s) => s.points.some((p) => p !== null));

  /* ── ⚠️ TWO AXES, AND WHY I CHANGED MY MIND ──────────────────────────────
     The first build put every series on one scale, arguing that two axes let a
     reader compare lines that are not comparable. Sound in principle, and it
     produced a broken chart on the real data: reach ~213,000 and views ~229,000
     against engagement ~1,500 and followers 36. Two of the four series were flat
     lines pinned to the axis — present, drawn, and unreadable. The owner sent a
     screenshot of exactly that.

     The reference gets away with one shape because all four of ITS numbers are
     around 20K. Ours span 6,000×.

     So each series is assigned to the left or right axis by magnitude, and BOTH
     AXES ARE LABELLED WITH WHICH SERIES THEY CARRY. The dishonesty in a dual
     axis comes from hiding which line belongs to which scale; saying so removes
     it. The legend toggles are the second half: switch Views off and the rest
     rescale to fill the space. */
  const magnitude = (s: Series) => {
    const vals = s.points.filter((p): p is number => p !== null);
    return vals.length === 0 ? 0 : Math.max(...vals);
  };

  const biggest = Math.max(1, ...drawn.map(magnitude));
  const onRight = (s: Series) => dualAxis && drawn.length > 1 && magnitude(s) < biggest / 25;

  const leftMax = Math.max(1, ...drawn.filter((s) => !onRight(s)).map(magnitude));
  const rightMax = Math.max(1, ...drawn.filter(onRight).map(magnitude));
  const hasRight = drawn.some(onRight);

  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right);
  const yFor = (v: number, max: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const y = (v: number, s: Series) => yFor(v, onRight(s) ? rightMax : leftMax);

  const path = (s: Series) => {
    let d = '';
    let pen = false;
    s.points.forEach((p, i) => {
      if (p === null) {
        /* ⚠️ A gap LIFTS THE PEN. A straight segment over a missing week
           silently reshapes the trend. */
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p, s).toFixed(2)} `;
      pen = true;
    });
    return d.trim();
  };

  const ticks = 4;
  const axisFractions = Array.from({ length: ticks + 1 }, (_, i) => i / ticks);
  const labelEvery = Math.max(1, Math.ceil(labels.length / 6));

  const bars = drawn.filter((s) => s.kind === 'bar');
  const lines = drawn.filter((s) => s.kind !== 'bar');
  /* Points only when they will not merge into a rope. */
  const showDots = labels.length <= 40;
  const barWidth = Math.max(
    2,
    Math.min(16, ((W - PAD.left - PAD.right) / Math.max(1, labels.length)) * 0.5),
  );

  if (series.length === 0) return <ChartEmpty />;

  return (
    <figure className="min-w-0">
      {/* ── Legend, clickable ─────────────────────────────────────────── */}
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {series.map((s) => {
          const off = hidden.has(s.label);
          return (
            <button
              key={s.label}
              type="button"
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.label)) next.delete(s.label);
                  else if (next.size < series.length - 1) next.add(s.label);
                  return next;
                })
              }
              className={`inline-flex items-center gap-1.5 text-micro transition-opacity hover:opacity-70 ${
                off ? 'opacity-40' : 'opacity-100'
              }`}
            >
              {s.kind === 'bar' ? (
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2 rounded-[2px]"
                  style={{ backgroundColor: tok(s.token), opacity: 0.55 }}
                />
              ) : (
                <span aria-hidden="true" className="inline-flex items-center">
                  <span
                    className="inline-block h-[2px] w-3.5 rounded-full"
                    style={{ backgroundColor: tok(s.token) }}
                  />
                  <span
                    className="-ml-2 inline-block size-[7px] rounded-full border-2"
                    style={{ borderColor: tok(s.token), backgroundColor: tok('bg-surface') }}
                  />
                </span>
              )}
              <span className="text-text-secondary">{s.label}</span>
              {hasRight && onRight(s) && !off && (
                <span className="text-[0.6rem] text-text-tertiary">right</span>
              )}
            </button>
          );
        })}
      </figcaption>

      {drawn.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ height }}
            className="w-full touch-none"
            role="img"
            aria-label={`${drawn.map((s) => s.label).join(', ')} over time`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - box.left) / box.width) * W;
              const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * n);
              setHover(i >= 0 && i < labels.length ? i : null);
            }}
          >
            {axisFractions.map((f, i) => (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={yFor(leftMax * f, leftMax)}
                  y2={yFor(leftMax * f, leftMax)}
                  stroke={tok('chart-grid')}
                  strokeDasharray="3 5"
                />
                <text
                  x={PAD.left - 8}
                  y={yFor(leftMax * f, leftMax) + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill={tok('chart-axis')}
                >
                  {shortNumber(leftMax * f)}
                </text>
                {hasRight && (
                  <text
                    x={W - PAD.right + 8}
                    y={yFor(rightMax * f, rightMax) + 3}
                    textAnchor="start"
                    fontSize="9"
                    fill={tok('chart-axis')}
                  >
                    {shortNumber(rightMax * f)}
                  </text>
                )}
              </g>
            ))}

            {labels.map((l, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={i}
                  x={x(i)}
                  y={H - 9}
                  textAnchor="middle"
                  fontSize="9"
                  fill={tok('chart-axis')}
                >
                  {l}
                </text>
              ) : null,
            )}

            {/* ── Bars first, so the lines sit in front of them ─────────── */}
            {bars.map((s) => (
              <g key={s.label}>
                {s.points.map((p, i) =>
                  p === null ? null : (
                    <rect
                      key={i}
                      x={x(i) - barWidth / 2}
                      y={y(p, s)}
                      width={barWidth}
                      height={Math.max(0, H - PAD.bottom - y(p, s))}
                      rx={Math.min(3, barWidth / 3)}
                      fill={tok(s.token)}
                      opacity={hover === i ? 0.55 : 0.26}
                      style={{
                        transformOrigin: `center ${H - PAD.bottom}px`,
                        animation: `bar-rise 620ms cubic-bezier(0.16,1,0.3,1) ${i * 12}ms backwards`,
                      }}
                    />
                  ),
                )}
              </g>
            ))}

            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={tok('chart-cursor')}
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )}

            {/* ── Lines, then their points ─────────────────────────────── */}
            {lines.map((s, si) => (
              <g key={s.label}>
                <path
                  key={`${animationKey}-${s.label}`}
                  /* ⚠️ `pathLength={1}` lets one dash pattern draw ANY path left
                     to right without measuring it in JavaScript first. */
                  pathLength={1}
                  d={path(s)}
                  fill="none"
                  stroke={tok(s.token)}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? '5 4' : 1}
                  style={
                    s.dashed
                      ? undefined
                      : ({
                          /* ⚠️ REQUIRED. The shared `line-draw` keyframe animates
                             from `var(--line-length, 1000)`; with pathLength=1
                             the offset must start at 1, or the line sits
                             invisible and then snaps in. */
                          '--line-length': 1,
                          strokeDashoffset: 1,
                          animation: `line-draw 900ms cubic-bezier(0.4,0,0.2,1) ${si * 120}ms forwards`,
                        } as React.CSSProperties)
                  }
                />

                {/* The dots the owner asked for, on every real point. */}
                {showDots &&
                  s.points.map((p, i) =>
                    p === null ? null : (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(p, s)}
                        r={hover === i ? 4 : 2.6}
                        fill={hover === i ? tok('bg-surface') : tok(s.token)}
                        stroke={tok(s.token)}
                        strokeWidth={hover === i ? 2.4 : 1}
                        style={{
                          animation: `studio-rise 420ms ease-out ${300 + si * 120}ms backwards`,
                          transition: 'r 120ms ease-out',
                        }}
                      />
                    ),
                  )}
              </g>
            ))}
          </svg>

          {/* ── The floating readout ───────────────────────────────────── */}
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[9.5rem] rounded-lg border border-border-default bg-bg-surface p-2.5 shadow-[0_6px_20px_rgb(6_35_42_/_0.14)]"
              style={
                hover / n > 0.6
                  ? { right: `${100 - (x(hover) / W) * 100}%`, marginRight: 10 }
                  : { left: `${(x(hover) / W) * 100}%`, marginLeft: 10 }
              }
            >
              <p className="mb-1.5 text-micro font-semibold text-text-primary">{labels[hover]}</p>
              <ul className="space-y-1">
                {drawn.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 text-micro">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tok(s.token) }}
                    />
                    <span className="min-w-0 flex-1 text-text-secondary">{s.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-text-primary">
                      {s.points[hover] === null || s.points[hover] === undefined
                        ? '—'
                        : shortNumber(s.points[hover] as number)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <table className="sr-only">
        <caption>Series by date</caption>
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <th>{l}</th>
              {series.map((s) => (
                <td key={s.label}>{s.points[i] ?? 'no data'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function ChartEmpty() {
  return (
    <div className="grid h-[13rem] place-items-center rounded-lg border border-dashed border-border-subtle">
      <p className="text-micro text-text-tertiary">Nothing collected in this period yet.</p>
    </div>
  );
}

/* ---- The segmented gauge ------------------------------------------------- */

export function SegmentedGauge({
  value,
  max = 100,
  verdict,
  hint,
  size = 190,
}: {
  value: number;
  max?: number;
  verdict: string;
  hint?: string;
  size?: number;
}) {
  const SWEEP = 180;
  const START = 180;
  const fraction = Math.min(1, Math.max(0, value / (max || 1)));
  const angle = START + SWEEP * fraction;

  /* Red → orange → yellow → green, as the reference draws it. Four equal
     quarters: the arc reports where a reading sits on a scale, and unequal bands
     would make the same number look different for no stated reason. */
  const bands = [
    { token: 'chart-8', from: 0, to: 0.25 },
    { token: 'chart-5', from: 0.25, to: 0.5 },
    { token: 'chart-6', from: 0.5, to: 0.75 },
    { token: 'chart-3', from: 0.75, to: 1 },
  ];

  const r = 38;
  const cx = 50;
  const cy = 52;

  const pt = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };

  const arc = (from: number, to: number, radius: number) => {
    const [x0, y0] = pt(START + SWEEP * from, radius);
    const [x1, y1] = pt(START + SWEEP * to, radius);
    return `M${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1}`;
  };

  const [nx, ny] = pt(angle, r - 9);

  return (
    <figure className="flex flex-col items-center">
      <svg
        viewBox="0 0 100 62"
        style={{ width: size }}
        role="img"
        aria-label={`${value.toFixed(2)} of ${max}`}
      >
        {bands.map((b) => (
          <path
            key={b.token}
            d={arc(b.from + 0.006, b.to - 0.006, r)}
            fill="none"
            stroke={tok(b.token)}
            strokeWidth="8"
            strokeLinecap="round"
          />
        ))}

        <g
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'studio-needle 900ms cubic-bezier(0.34,1.3,0.64,1) backwards',
          }}
        >
          <line
            x1={cx}
            y1={cy}
            x2={nx}
            y2={ny}
            stroke={tok('text-primary')}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="3.5" fill={tok('bg-surface')} stroke={tok('text-primary')} strokeWidth="2" />
        </g>

        <text x="7" y="60" fontSize="6" fill={tok('chart-axis')}>
          0%
        </text>
        <text x="84" y="60" fontSize="6" fill={tok('chart-axis')}>
          {max}%
        </text>
      </svg>

      <p className="-mt-1 text-h2 font-bold tabular-nums text-text-primary">{value.toFixed(2)}%</p>
      <p className="text-caption font-semibold" style={{ color: tok(verdictToken(fraction)) }}>
        {verdict}
      </p>
      {hint && <p className="mt-0.5 text-micro text-text-tertiary">{hint}</p>}
    </figure>
  );
}

function verdictToken(fraction: number): string {
  if (fraction >= 0.75) return 'chart-3';
  if (fraction >= 0.5) return 'chart-6';
  if (fraction >= 0.25) return 'chart-5';
  return 'chart-8';
}

/* ---- Ranked rows --------------------------------------------------------- */

export function RankedBars({
  rows,
  emptyText = 'Nothing to show yet.',
}: {
  rows: readonly {
    key: string;
    label: string;
    lead?: React.ReactNode;
    share: number;
    value: string;
    token: string;
  }[];
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="grid h-full min-h-[7rem] place-items-center rounded-lg border border-dashed border-border-subtle">
        <p className="text-micro text-text-tertiary">{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center gap-2">
          {r.lead && <span className="shrink-0">{r.lead}</span>}
          <span className="w-[4.75rem] shrink-0 truncate text-micro text-text-primary" title={r.label}>
            {r.label}
          </span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-subtle">
            <span
              className="block h-full origin-left rounded-full motion-safe:animate-[studio-grow_650ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
              style={{
                width: `${Math.min(100, Math.max(2, r.share * 100))}%`,
                backgroundColor: tok(r.token),
                animationDelay: `${i * 70}ms`,
              }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-micro tabular-nums text-text-secondary">
            {Math.round(r.share * 100)}%
          </span>
          <span className="w-11 shrink-0 text-right text-micro font-semibold tabular-nums text-text-primary">
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---- Formatting ---------------------------------------------------------- */

function shortNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export { shortNumber };
