'use client';

import * as React from 'react';

import { niceScale } from '@/lib/domain/meta-studio';

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
  tooltipLabels,
  height = 200,
  animationKey = '',
  /** Off for the growth chart, where both series are the same quantity. */
  dualAxis = true,
}: {
  series: readonly Series[];
  /** Short labels for the x axis, where space is scarce. */
  labels: readonly string[];
  /**
   * ⚠️ THE FULL DATE FOR THE READOUT, one per point, and NOT the same strings as
   * the axis. Owner: *"in the tooltip… it is showing just 826. I don't know what
   * 826 is."* The axis label is abbreviated because thirty of them share one
   * line; the tooltip shows one at a time and has no such excuse, so an
   * abbreviation there is just a puzzle. Falls back to the axis label when a
   * caller has nothing fuller to give.
   */
  tooltipLabels?: readonly string[];
  height?: number;
  animationKey?: string;
  dualAxis?: boolean;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  /* ── ⚠️ THE VIEWBOX IS MEASURED, NOT FIXED ────────────────────────────────
     Owner: *"it should display the whole width."* The chart was drawing across
     roughly three quarters of its panel with dead space either side, and the
     cause was not padding.

     An `<svg>` with a fixed pixel HEIGHT and a viewBox of a different aspect
     ratio is letterboxed by `preserveAspectRatio`, whose default is
     `xMidYMid meet` — scale to FIT, then centre. A 780×215 viewBox forced into a
     975×196 box scales by 196/215 and renders 711px wide, centred, leaving
     ~130px of nothing on each side. Nothing in the drawing code was wrong; the
     whole picture was being shrunk after the fact.

     `preserveAspectRatio="none"` would stretch instead, which turns every dot
     into an ellipse and every 2px stroke into a different width horizontally
     than vertically. So the viewBox is matched to the real pixel width instead:
     one user unit is one pixel, nothing is scaled, and the font sizes below are
     finally the sizes they claim to be. */
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState(780);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setMeasured(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /* Legend toggling. ⚠️ Not a nicety — see the axis note below. With four series
     spanning three orders of magnitude, switching one off is what makes the
     small ones readable at all. */
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set());

  const W = measured;
  /* ⚠️ THE VIEWBOX HEIGHT *IS* THE RENDERED HEIGHT, and it has to be, for the
     same reason the width is measured: a viewBox of 215 rendered into a 196px
     box is letterboxed exactly as a 780-wide one was. Taking H from the prop
     keeps one user unit at one pixel in BOTH directions. */
  const H = height;
  const PAD = { top: 14, right: dualAxis ? 46 : 14, bottom: 24, left: 46 };

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

  /* ⚠️ THE AXIS TOPS OUT AT A ROUND NUMBER, NOT AT THE DATA'S MAXIMUM.
     Owner: *"you start from 0 and then directly jump to 14k… should it start
     from 0, 5k, 10k, 15k as small figures."* Dividing the peak into four gave
     ticks of 0 · 14K · 29K · 43K · 57K — arithmetically correct and unreadable,
     because nobody holds "29K" as a landmark. `niceScale` picks a step from
     1/1.5/2/2.5/3/4/5/7.5 × a power of ten, so the same data now reads
     0 · 15K · 30K · 45K · 60K. */
  const left = niceScale(Math.max(1, ...drawn.filter((s) => !onRight(s)).map(magnitude)));
  const right = niceScale(Math.max(1, ...drawn.filter(onRight).map(magnitude)));
  const leftMax = left.ceiling;
  const rightMax = right.ceiling;
  const hasRight = drawn.some(onRight);

  /* ⚠️ 0.42 of a slot. This has now been tuned twice in both directions: 0.5 was
     "very thin lines", 0.68 was too heavy and swamped the lines in front of it.
     The reference's bars are a background the lines are read against, so they
     sit under half a slot and well under the gap between them. */
  const barWidth = Math.max(
    3,
    Math.min(18, ((W - PAD.left - PAD.right) / Math.max(1, labels.length)) * 0.42),
  );
  const n = Math.max(1, labels.length - 1);

  /* ⚠️ THE PLOT IS INSET BY HALF A BAR AT EACH END, and this is the fix for a
     real overlap rather than a cosmetic tweak. Owner: *"why are these figures on
     the left, like 15k, 30k, 45k, overlapping with the bars?"*

     A bar is CENTRED on its point, so the first bar reached `barWidth / 2` to the
     LEFT of `PAD.left` — straight through the space the axis numerals occupy.
     Widening the padding would only have moved the collision. The plot area
     itself now starts half a bar in, so no mark can cross into the gutter. */
  const inset = barWidth / 2 + 1;
  const x = (i: number) =>
    PAD.left + inset + (i / n) * (W - PAD.left - PAD.right - inset * 2);
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

  /* One entry per nice step, so the labels land on the round numbers rather than
     on quarters of an arbitrary peak. */
  const axisFractions = Array.from(
    { length: left.steps + 1 },
    (_, i) => i / left.steps,
  );
  const labelEvery = Math.max(1, Math.ceil(labels.length / 6));

  const bars = drawn.filter((s) => s.kind === 'bar');
  const lines = drawn.filter((s) => s.kind !== 'bar');
  /* Points only when they will not merge into a rope. */
  const showDots = labels.length <= 40;
  /* ⚠️ 0.68 of the slot, not 0.5. Owner: *"these vertical lines below are not
     very thick. They are very thin lines."* At half a slot the bars read as
     hairlines beside a 2px stroke; the reference sits at roughly two-thirds,
     which is also the width at which a bar stops competing with the lines and
     starts reading as the ground they stand on. */


  /* The wrapper must exist even with nothing drawn, so the observer has
     something to measure before the first data arrives. */
  if (series.length === 0) {
    return (
      <div ref={wrapRef}>
        <ChartEmpty />
      </div>
    );
  }

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
              {/* ⚠️ NO "right" SUFFIX. It marked which axis a series used, and
                  the owner read it as a stray word: *"I don't know what the
                  purpose of 'Right' is over here."* Fair — a reader should not
                  have to learn a legend convention in order to read the legend.
                  The hover readout names every value regardless, which is where
                  the question is actually answered. */}
              <span className="text-text-secondary">{s.label}</span>
            </button>
          );
        })}
      </figcaption>

      {drawn.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div ref={wrapRef} className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            style={{ width: '100%', height: H }}
            className="touch-none"
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
                {/* ⚠️ DARKER AND LARGER THAN THE KIT DEFAULT. Owner: *"the
                    figures on the left and right are very dim and very small.
                    Make them black, a dark black, and increase their size."*
                    `--chart-axis` resolves to `--text-tertiary`, which is right
                    for a gridline's own label and too quiet when the number IS
                    the thing being read. */}
                <text
                  x={PAD.left - 9}
                  y={yFor(leftMax * f, leftMax) + 3.5}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="600"
                  fill={tok('text-primary')}
                >
                  {shortNumber(leftMax * f)}
                </text>
                {hasRight && (
                  <text
                    x={W - PAD.right + 9}
                    y={yFor(rightMax * f, rightMax) + 3.5}
                    textAnchor="start"
                    fontSize="11"
                    fontWeight="600"
                    fill={tok('text-primary')}
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
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="500"
                  fill={tok('text-secondary')}
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
                      /* ⚠️ A NON-ZERO VALUE IS NEVER INVISIBLE. Owner: *"even
                         though I have 437 views on 08/28, the views bar is not
                         visible."* Against a 57,000 peak that bar is 0.7% of the
                         height — under a pixel, so it drew as nothing, and
                         nothing reads as ZERO. That is a chart stating something
                         false.

                         A floor of 2.5 units guarantees a sliver. It does
                         overstate a tiny value's proportion, which is the honest
                         trade: "something happened here" is true and "nothing
                         happened here" was not, and the exact figure is one hover
                         away in the readout. A zero still draws nothing, because
                         zero genuinely is nothing. */
                      y={p > 0 ? Math.min(y(p, s), H - PAD.bottom - 2.5) : y(p, s)}
                      width={barWidth}
                      height={
                        p > 0
                          ? Math.max(2.5, H - PAD.bottom - y(p, s))
                          : Math.max(0, H - PAD.bottom - y(p, s))
                      }
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
              <p className="mb-1.5 text-micro font-semibold text-text-primary">
                {tooltipLabels?.[hover] ?? labels[hover]}
              </p>
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
  size = 176,
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

  /* A wider radius on a shorter canvas: the arc fills the card rather than
     floating in the middle of it, which is where the owner saw "a lot of white
     space". */
  const r = 40;
  const cx = 50;
  const cy = 50;

  const pt = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };

  const arc = (from: number, to: number, radius: number) => {
    const [x0, y0] = pt(START + SWEEP * from, radius);
    const [x1, y1] = pt(START + SWEEP * to, radius);
    return `M${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1}`;
  };

  return (
    <figure className="flex flex-col items-center">
      <svg
        viewBox="0 0 100 58"
        style={{ width: size }}
        role="img"
        aria-label={`${value.toFixed(2)} of ${max}`}
      >
        {/* ⚠️ A REAL GAP BETWEEN THE BANDS, and a thinner stroke. Owner: *"this
            colorful multi-bar should be thinner. There should be spaces between
            each color, as you can see in the reference."* The previous 0.006
            inset was smaller than the round cap that overdrew it, so four bands
            rendered as one continuous ribbon. */}
        {bands.map((b) => (
          <path
            key={b.token}
            d={arc(b.from + 0.022, b.to - 0.022, r)}
            fill="none"
            stroke={tok(b.token)}
            strokeWidth="5.5"
            strokeLinecap="round"
          />
        ))}

        {/* The scale around the arc, as the reference draws it. */}
        {/* ⚠️ THREE LABELS, NOT SIX, AND OUTSIDE THE ARC. Six sat on top of the
            band at this size and the end ones were clipped by the viewBox — the
            screenshot showed "6" and "1" where "0%" and "10%" should have been.
            The ends and the midpoint are what a dial actually needs; the exact
            reading is printed underneath in full. */}
        {[0, 0.5, 1].map((f) => {
          const [lx, ly] = pt(START + SWEEP * f, r + 7);
          return (
            <text
              key={f}
              x={Math.min(96, Math.max(4, lx))}
              y={f === 0.5 ? ly + 1 : ly + 3}
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
              fontSize="5.6"
              fontWeight="600"
              fill={tok('text-tertiary')}
            >
              {formatTick(max * f)}
            </text>
          );
        })}

        {/* ── ⚠️ A TAPERED NEEDLE, NOT A BAR ─────────────────────
            Owner: *"you can see how beautiful the needle is! Right now our
            needle, from bottom to top, is the same width so please adjust."*
            A uniform stroke reads as a pointer drawn by a machine; a dial's
            needle is wide at the pivot and comes to a point, which is what makes
            the eye follow it outward to the reading. A polygon rather than a
            stroked line, because a stroke cannot taper. */}
        <g
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'studio-needle 1100ms cubic-bezier(0.34,1.28,0.64,1) backwards',
          }}
        >
          <polygon
            points={needlePoints(cx, cy, angle, r - 7)}
            fill={tok('text-primary')}
            stroke={tok('text-primary')}
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
          <circle cx={cx} cy={cy} r="3.6" fill={tok('text-primary')} />
          <circle cx={cx} cy={cy} r="1.5" fill={tok('bg-surface')} />
        </g>

      </svg>

      <p className="-mt-2 text-h2 font-bold leading-none tabular-nums text-text-primary">
        {value.toFixed(2)}%
      </p>
      <p
        className="mt-1 text-caption font-semibold"
        style={{ color: tok(verdictToken(fraction)) }}
      >
        {verdict}
      </p>
      {hint && <p className="text-micro text-text-tertiary">{hint}</p>}
    </figure>
  );
}

/** The needle as a wedge: wide at the pivot, a point at the tip. */
function needlePoints(cx: number, cy: number, angleDeg: number, length: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  const perp = rad + Math.PI / 2;
  const halfBase = 2.1;

  const tipX = cx + length * Math.cos(rad);
  const tipY = cy + length * Math.sin(rad);
  const baseAX = cx + halfBase * Math.cos(perp);
  const baseAY = cy + halfBase * Math.sin(perp);
  const baseBX = cx - halfBase * Math.cos(perp);
  const baseBY = cy - halfBase * Math.sin(perp);
  /* A short tail behind the pivot, so the needle looks balanced on its bearing
     rather than glued on at one end. */
  const tailX = cx - length * 0.16 * Math.cos(rad);
  const tailY = cy - length * 0.16 * Math.sin(rad);

  return [
    `${tipX.toFixed(2)},${tipY.toFixed(2)}`,
    `${baseAX.toFixed(2)},${baseAY.toFixed(2)}`,
    `${tailX.toFixed(2)},${tailY.toFixed(2)}`,
    `${baseBX.toFixed(2)},${baseBY.toFixed(2)}`,
  ].join(' ');
}

/** Whole numbers where the scale allows, one decimal where it does not. */
function formatTick(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
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
