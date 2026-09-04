'use client';

import * as React from 'react';

/* ============================================================================
 * THE CHARTS THE REFERENCE NEEDS AND THE KIT DID NOT HAVE
 * ----------------------------------------------------------------------------
 * `components/ui/chart.tsx` covers a single-series trend, a donut and a bar
 * ranking, and those are reused as-is. Three shapes in the owner's reference
 * have no equivalent and are built here rather than bent out of the shared kit,
 * which is on the dashboard, the reports page and inside a project — the
 * standing instruction is *"do not disturb any other working thing"*, and
 * widening a shared component for one page is exactly that.
 *
 *   MultiSeriesChart  four lines on one axis, with a hover readout
 *   SegmentedGauge    the red→green arc with a needle
 *   RankedBars        a labelled row list with a value and a share
 *
 * ── ⚠️ HAND-BUILT SVG, NO CHART LIBRARY ────────────────────────────────────
 * The CSP on this project admits no runtime chart dependency, and the existing
 * kit is hand-built for the same reason. These follow its conventions: a
 * viewBox in user units, tokens through `var(--…)`, and a hidden table so a
 * screen reader gets the numbers rather than a shrug.
 * ========================================================================= */

const tok = (name: string) => `var(--${name})`;

export interface Series {
  readonly label: string;
  /** `chart-1` … `chart-8`. */
  readonly token: string;
  readonly points: readonly (number | null)[];
  /** Drawn as a dashed line — the reference's "Last Month" comparison. */
  readonly dashed?: boolean;
}

/* ---- Multi-series line chart --------------------------------------------- */

export function MultiSeriesChart({
  series,
  labels,
  height = 230,
  animationKey = '',
}: {
  series: readonly Series[];
  labels: readonly string[];
  height?: number;
  /** Changing this replays the draw — pass the filter signature. */
  animationKey?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const W = 760;
  const H = 240;
  const PAD = { top: 14, right: 12, bottom: 26, left: 40 };

  const drawn = series.filter((s) => s.points.some((p) => p !== null));

  /* One scale for every series. ⚠️ The reference shows a second axis on the
     right; that is avoided deliberately — two axes let a reader compare two
     lines that are not comparable, which is how a chart lies without a single
     wrong number on it. */
  const values = drawn.flatMap((s) => s.points.filter((p): p is number => p !== null));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);

  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom);

  const path = (pts: readonly (number | null)[]) => {
    let d = '';
    let pen = false;
    pts.forEach((p, i) => {
      if (p === null) {
        /* ⚠️ A gap LIFTS THE PEN rather than joining across. A straight segment
           over a missing week silently reshapes the trend. */
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p).toFixed(2)} `;
      pen = true;
    });
    return d.trim();
  };

  const ticks = 4;
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);

  /* Show roughly six x labels however many points there are. */
  const labelEvery = Math.max(1, Math.ceil(labels.length / 6));

  if (drawn.length === 0) {
    return (
      <div className="grid h-[14rem] place-items-center rounded-lg border border-dashed border-border-subtle">
        <p className="text-micro text-text-tertiary">Nothing collected in this period yet.</p>
      </div>
    );
  }

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {drawn.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-micro text-text-secondary">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3.5 rounded-full"
              style={{
                backgroundColor: tok(s.token),
                ...(s.dashed
                  ? { backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 6px)' }
                  : null),
              }}
            />
            {s.label}
          </span>
        ))}
      </figcaption>

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
        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={tok('chart-grid')}
              strokeDasharray="3 4"
            />
            <text
              x={PAD.left - 7}
              y={y(v) + 3}
              textAnchor="end"
              fontSize="9"
              fill={tok('chart-axis')}
            >
              {shortNumber(v)}
            </text>
          </g>
        ))}

        {labels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="9"
              fill={tok('chart-axis')}
            >
              {l}
            </text>
          ) : null,
        )}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke={tok('chart-cursor')}
            strokeWidth="1"
          />
        )}

        {drawn.map((s, si) => (
          <g key={s.label}>
            <path
              /* ⚠️ `pathLength="1"` lets one dash pattern draw ANY path left to
                 right without measuring it in JavaScript first. The alternative
                 is a ref, a getTotalLength() and a layout effect per series. */
              pathLength={1}
              d={path(s.points)}
              fill="none"
              stroke={tok(s.token)}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '4 4' : 1}
              style={
                s.dashed
                  ? undefined
                  : ({
                      /* ⚠️ `--line-length: 1` IS REQUIRED, not decoration. The
                         shared `line-draw` keyframe animates from
                         `var(--line-length, 1000)` to 0, and with `pathLength=1`
                         the offset must start at 1 — left at the 1000 default
                         the line sits invisible for most of the animation and
                         then snaps in. */
                      '--line-length': 1,
                      strokeDashoffset: 1,
                      animation: `line-draw 900ms cubic-bezier(0.4,0,0.2,1) ${si * 130}ms forwards`,
                    } as React.CSSProperties)
              }
              key={`${animationKey}-${s.label}`}
            />
            {hover !== null && s.points[hover] !== null && s.points[hover] !== undefined && (
              <circle
                cx={x(hover)}
                cy={y(s.points[hover] as number)}
                r="3.5"
                fill={tok('bg-surface')}
                stroke={tok(s.token)}
                strokeWidth="2"
              />
            )}
          </g>
        ))}
      </svg>

      {hover !== null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-bg-subtle px-2.5 py-1.5">
          <span className="text-micro font-semibold text-text-primary">{labels[hover]}</span>
          {drawn.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 text-micro text-text-secondary">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: tok(s.token) }}
              />
              {s.label}{' '}
              <strong className="font-semibold tabular-nums text-text-primary">
                {s.points[hover] === null || s.points[hover] === undefined
                  ? '—'
                  : shortNumber(s.points[hover] as number)}
              </strong>
            </span>
          ))}
        </div>
      )}

      {/* The numbers, for a screen reader. */}
      <table className="sr-only">
        <caption>Series by date</caption>
        <thead>
          <tr>
            <th>Date</th>
            {drawn.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <th>{l}</th>
              {drawn.map((s) => (
                <td key={s.label}>{s.points[i] ?? 'no data'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
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
     quarters: the arc reports where a reading sits on a scale, and unequal
     bands would make the same number look different for no stated reason. */
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
    const a0 = START + SWEEP * from;
    const a1 = START + SWEEP * to;
    const [x0, y0] = pt(a0, radius);
    const [x1, y1] = pt(a1, radius);
    return `M${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1}`;
  };

  const [nx, ny] = pt(angle, r - 9);

  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 0 100 62" style={{ width: size }} role="img" aria-label={`${value.toFixed(2)} of ${max}`}>
        {bands.map((b) => (
          <path
            key={b.token}
            d={arc(b.from + 0.005, b.to - 0.005, r)}
            fill="none"
            stroke={tok(b.token)}
            strokeWidth="8"
            strokeLinecap="round"
          />
        ))}

        {/* The needle, swinging from the left to its reading. */}
        <g
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'studio-needle 900ms cubic-bezier(0.34,1.3,0.64,1) backwards',
          }}
        >
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={tok('text-primary')} strokeWidth="2" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="3.5" fill={tok('bg-surface')} stroke={tok('text-primary')} strokeWidth="2" />
        </g>

        <text x="8" y="60" fontSize="6" fill={tok('chart-axis')}>0%</text>
        <text x="86" y="60" fontSize="6" fill={tok('chart-axis')}>100%</text>
      </svg>

      <p className="-mt-1 text-h2 font-semibold tabular-nums text-text-primary">
        {value.toFixed(2)}%
      </p>
      <p className="text-caption font-medium" style={{ color: tok(verdictToken(fraction)) }}>
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
    /** An icon, flag or brand mark drawn before the label. */
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
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center gap-2">
          {r.lead && <span className="shrink-0">{r.lead}</span>}
          <span className="w-[5.5rem] shrink-0 truncate text-micro text-text-primary" title={r.label}>
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
