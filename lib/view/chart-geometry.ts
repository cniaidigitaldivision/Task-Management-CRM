/* ============================================================================
 * CHART GEOMETRY — the arithmetic behind the hand-built charts
 * ----------------------------------------------------------------------------
 * Owner decision: charts are hand-built SVG, no charting dependency. Recharts
 * was declined at roughly 500 KB after we had been careful enough about one
 * 3.6 MB spreadsheet writer to measure it first.
 *
 * ── WHY THE MATHS LIVES HERE AND NOT IN THE COMPONENT ────────────────────────
 * Everything in this file is a pure function of numbers, and every one of them
 * has an answer that is either right or wrong — a tick scale that produces
 * `0, 3.3333, 6.6667` is wrong, and a component test would never notice because
 * the chart would still draw. Pulled out, they are unit-testable, which is the
 * only way to know that `niceScale` handles a flat series, a single point, a
 * negative range and a range of zero. All four of those appear in real data: a
 * new member has no completed tasks, a project a day old has one data point.
 *
 * Nothing here touches the DOM, React, or a colour. It takes numbers and returns
 * numbers and path strings.
 * ========================================================================= */

export interface Scale {
  /** Domain floor — a round number at or below the data's minimum. */
  readonly min: number;
  /** Domain ceiling — a round number at or above the data's maximum. */
  readonly max: number;
  /** The gap between gridlines. */
  readonly step: number;
  /** Every gridline value from `min` to `max` inclusive. */
  readonly ticks: readonly number[];
}

/**
 * A tick scale a person can read.
 *
 * The naive version — `step = (max - min) / ticks` — labels the axis
 * `0, 4.67, 9.33, 14`, and nobody reads a chart against 4.67. This rounds the
 * step up to the nearest 1, 2, 2.5 or 5 times a power of ten, then widens the
 * domain to land on multiples of it. The result is always 1/2/2.5/5-based, which
 * is what every axis anybody has ever read comfortably is made of.
 *
 * `targetTicks` is a target, not a promise: widening the domain to round numbers
 * can add one. Asking for four and getting five is correct behaviour.
 *
 * ── THE CASES THAT ACTUALLY OCCUR ────────────────────────────────────────────
 * - **A flat series** (five days, four tasks each). Span zero would make `step`
 *   zero and the tick loop would never terminate. Handled by giving a flat
 *   series an arbitrary span around its value, so the line sits mid-chart
 *   instead of welded to an edge.
 * - **All zeroes** — a member with nothing completed. Same path, and the axis
 *   reads 0…1 rather than 0…0.
 * - **Non-finite input.** A `NaN` from a division by an empty count would
 *   otherwise propagate into `d=` attributes and silently blank the chart. They
 *   are dropped before the domain is computed.
 */
export function niceScale(rawMin: number, rawMax: number, targetTicks = 4): Scale {
  const lo = Number.isFinite(rawMin) ? rawMin : 0;
  const hi = Number.isFinite(rawMax) ? rawMax : 0;

  let min = Math.min(lo, hi);
  let max = Math.max(lo, hi);

  if (max - min < 1e-9) {
    /* Flat. Half a unit either side of the value, or 0…1 when the value is zero
       — a chart whose axis says "0 to 0" is not a chart. */
    const pad = Math.max(Math.abs(max) * 0.5, 0.5);
    min -= pad;
    max += pad;
  }

  const rough = (max - min) / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const nice = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  const step = nice * magnitude;

  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;

  /* Rounded because 0.1 + 0.2 is not 0.3 and an axis label of `0.30000000000000004`
     is a real thing that ships. Ten places is far beyond any step we produce and
     well inside the precision of a double. */
  const round = (n: number) => Number(n.toFixed(10));

  const ticks: number[] = [];
  /* Counted rather than accumulated: `for (let v = from; v <= to; v += step)`
     drifts, and on a step like 0.1 the final tick can fall just outside the
     comparison and vanish. */
  const count = Math.round((to - from) / step);
  for (let i = 0; i <= count; i += 1) ticks.push(round(from + i * step));

  return { min: round(from), max: round(to), step: round(step), ticks };
}

/**
 * The domain across several series, so two lines on one chart share an axis.
 *
 * `includeZero` defaults to true because almost every figure in this application
 * is a count — tasks, hours, points — and a count chart that starts at 37 makes
 * a rise from 40 to 44 look like a tripling. Overridable for the rare series
 * where zero is meaningless, such as a percentage that never approaches it.
 */
export function domainOf(
  serieses: readonly (readonly number[])[],
  { includeZero = true }: { includeZero?: boolean } = {},
): { min: number; max: number } {
  const values = serieses.flat().filter((n) => Number.isFinite(n));
  if (values.length === 0) return { min: 0, max: 1 };

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

/**
 * Which data point the cursor is nearest, from its position across the plot.
 *
 * Takes a fraction rather than pixels so the caller can hand over
 * `(clientX - rect.left) / rect.width` and the chart never needs to know or
 * measure its own width. Rounds rather than truncates: the reading should snap
 * to the nearest point, so the last point is reachable at the right-hand edge
 * instead of only at exactly 100%.
 */
export function nearestIndex(fraction: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(count - 1, Math.max(0, Math.round(clamped * (count - 1))));
}

/** A value's height in the plot, as a 0–1 fraction from the bottom. */
export function valueFraction(value: number, scale: Pick<Scale, 'min' | 'max'>): number {
  const span = scale.max - scale.min;
  if (span <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - scale.min) / span));
}

/** A point's position across the plot, as a 0–1 fraction from the left. */
export function indexFraction(index: number, count: number): number {
  if (count <= 1) return 0.5; // a single point belongs in the middle, not on the axis
  return Math.min(1, Math.max(0, index / (count - 1)));
}

/* --------------------------------------------------------------------------
 * SVG path builders
 * ------------------------------------------------------------------------ */

/**
 * A point on a circle, in degrees clockwise from twelve o'clock.
 *
 * Not the mathematical convention (anticlockwise from three o'clock) because
 * every gauge in the references reads clockwise from the top, and converting at
 * every call site is how a gauge ends up mirrored.
 */
export function polarPoint(cx: number, cy: number, r: number, degrees: number): { x: number; y: number } {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * An arc as an SVG path, swept clockwise from `startDeg` to `endDeg`.
 *
 * The large-arc flag is computed rather than hard-coded: at exactly 180° an arc
 * with the wrong flag renders as the other half of the circle, which on a gauge
 * means a reading of 50% draws as 50% of the wrong direction. It is the sort of
 * fault that only appears at one value.
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = Math.abs(endDeg - startDeg);
  /* A full circle cannot be drawn as one arc — start and end coincide and the
     browser draws nothing at all. Callers wanting a ring use two halves. */
  if (sweep >= 360) {
    const half = arcPath(cx, cy, r, startDeg, startDeg + 180);
    const rest = arcPath(cx, cy, r, startDeg + 180, startDeg + 359.999);
    return `${half} ${rest.replace(/^M[^A]*/, '')}`;
  }

  const from = polarPoint(cx, cy, r, startDeg);
  const to = polarPoint(cx, cy, r, endDeg);
  const largeArc = sweep > 180 ? 1 : 0;
  const clockwise = endDeg >= startDeg ? 1 : 0;

  const n = (v: number) => Number(v.toFixed(3));
  return `M ${n(from.x)} ${n(from.y)} A ${n(r)} ${n(r)} 0 ${largeArc} ${clockwise} ${n(to.x)} ${n(to.y)}`;
}

/**
 * A smoothed line through the points, as an SVG path.
 *
 * Catmull-Rom converted to cubic Béziers, at a deliberately low tension. The
 * references' charts are curved rather than angular, and a straight polyline
 * next to their screenshots reads as a different product.
 *
 * ── WHY THE CURVE IS TAMED, AND WHY LOW TENSION WAS NOT ENOUGH ───────────────
 * A spline overshoots at a turning point. Dropping the tension to 0.2 reduces it
 * but does not remove it: a series of 1, 0, 4 puts a control point 1.5 units past
 * the zero point, and on the design-system page the "Blocked" line visibly dipped
 * below the zero gridline — a chart showing negative tasks. Seen in a screenshot,
 * not in a test: the first version of the overshoot test used a symmetric
 * 100, 0, 100 case, where the two control points cancel and nothing escapes.
 *
 * So each control point is also clamped to the band between the two data points
 * of its own segment. A cubic stays inside the convex hull of its four control
 * points, so that clamp is a guarantee rather than a mitigation — the curve
 * cannot leave the range of the data it joins.
 *
 * The clamp only engages at a reversal, which is precisely where overshoot comes
 * from; on a rising or falling run the control points are already inside the band
 * and the curve is untouched. At a peak it flattens the crest instead of sailing
 * past it, which is the correct reading of a maximum.
 */
export function smoothPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const n = (v: number) => Number(v.toFixed(3));
  if (points.length === 1) return `M ${n(points[0].x)} ${n(points[0].y)}`;

  const tension = 0.2;
  let d = `M ${n(points[0].x)} ${n(points[0].y)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const floor = Math.min(p1.y, p2.y);
    const ceiling = Math.max(p1.y, p2.y);
    const hold = (y: number) => Math.min(ceiling, Math.max(floor, y));

    const c1 = { x: p1.x + (p2.x - p0.x) * tension, y: hold(p1.y + (p2.y - p0.y) * tension) };
    const c2 = { x: p2.x - (p3.x - p1.x) * tension, y: hold(p2.y - (p3.y - p1.y) * tension) };

    d += ` C ${n(c1.x)} ${n(c1.y)}, ${n(c2.x)} ${n(c2.y)}, ${n(p2.x)} ${n(p2.y)}`;
  }

  return d;
}

/* --------------------------------------------------------------------------
 * Donut
 * ------------------------------------------------------------------------ */

export interface DonutSlice {
  /** Where the slice starts, as a 0–1 fraction of the ring. */
  readonly offset: number;
  /** How much of the ring it covers, as a 0–1 fraction. */
  readonly length: number;
  /** Its share of the total, 0–1 — the same as `length`, named for reading. */
  readonly share: number;
}

/**
 * Slice offsets for a stroke-dash donut.
 *
 * Returned as fractions rather than stroke-dash lengths so the component owns
 * its own radius. Zero-valued slices come back with zero length and are still
 * present in the array, because the caller is indexing this against its labels
 * and colours and dropping entries here would silently recolour the legend.
 *
 * A total of zero — nothing to show yet — returns all-zero slices rather than
 * dividing by it, so an empty donut draws its track and no segments.
 */
export function donutSlices(values: readonly number[]): DonutSlice[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);

  let offset = 0;
  return clean.map((v) => {
    const share = total > 0 ? v / total : 0;
    const slice = { offset, length: share, share };
    offset += share;
    return slice;
  });
}
