import { describe, expect, it } from 'vitest';

import {
  arcPath,
  domainOf,
  donutSlices,
  indexFraction,
  nearestIndex,
  niceScale,
  polarPoint,
  smoothPath,
  valueFraction,
} from '@/lib/view/chart-geometry';

/* ============================================================================
 * Chart geometry
 * ----------------------------------------------------------------------------
 * These exist because a wrong chart still draws. A tick scale that produces
 * 4.6667 renders perfectly happily; an axis reading `0.30000000000000004` renders
 * happily too. Nothing about the picture says it is wrong, so the arithmetic has
 * to be checked here or not at all.
 *
 * The degenerate inputs are not hypothetical: a member who has completed nothing
 * gives a series of zeroes, a project created today gives one data point, and a
 * quiet week gives five identical numbers.
 * ========================================================================= */

describe('niceScale', () => {
  it('rounds the step to a number a person reads an axis against', () => {
    const scale = niceScale(0, 14, 4);
    expect(scale.step).toBe(5);
    expect(scale.ticks).toEqual([0, 5, 10, 15]);
  });

  it('never leaves the data outside the domain it widened to', () => {
    for (const [min, max] of [
      [0, 14],
      [3, 97],
      [-12, 40],
      [0.2, 0.9],
      [1, 3],
      [0, 1000],
    ] as const) {
      const scale = niceScale(min, max);
      expect(scale.min).toBeLessThanOrEqual(min);
      expect(scale.max).toBeGreaterThanOrEqual(max);
    }
  });

  it('only ever uses a 1, 2, 2.5 or 5 based step', () => {
    for (let max = 1; max <= 500; max += 7) {
      const { step } = niceScale(0, max);
      const magnitude = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 2.5, 5, 10]).toContain(Number((step / magnitude).toFixed(10)));
    }
  });

  it('gives a flat series a readable axis instead of a zero-height one', () => {
    const scale = niceScale(4, 4);
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.min).toBeLessThanOrEqual(4);
    expect(scale.max).toBeGreaterThanOrEqual(4);
  });

  it('handles all zeroes — a member with nothing completed', () => {
    const scale = niceScale(0, 0);
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.ticks.length).toBeGreaterThan(1);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
  });

  it('terminates and stays finite on non-finite input', () => {
    for (const scale of [niceScale(NaN, NaN), niceScale(0, Infinity), niceScale(NaN, 10)]) {
      expect(scale.ticks.length).toBeGreaterThan(0);
      expect(scale.ticks.length).toBeLessThan(200);
      expect(scale.ticks.every(Number.isFinite)).toBe(true);
    }
  });

  it('produces no floating-point debris in its labels', () => {
    /* 0.1 + 0.2 !== 0.3. Without rounding, an axis of tenths labels a tick
       `0.30000000000000004`, which is a real thing that ships. */
    const scale = niceScale(0, 0.5, 5);
    for (const tick of scale.ticks) {
      expect(String(tick).length).toBeLessThanOrEqual(6);
    }
  });

  it('accepts its arguments in either order', () => {
    expect(niceScale(40, 10)).toEqual(niceScale(10, 40));
  });

  it('spans the domain end to end', () => {
    const scale = niceScale(0, 20, 4);
    expect(scale.ticks[0]).toBe(scale.min);
    expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.max);
  });
});

describe('domainOf', () => {
  it('spans every series so two lines share one axis', () => {
    expect(domainOf([[4, 9], [2, 22]])).toEqual({ min: 0, max: 22 });
  });

  it('includes zero by default, because these are counts', () => {
    /* A count chart starting at 37 makes 40 → 44 look like a tripling. */
    expect(domainOf([[37, 44]])).toEqual({ min: 0, max: 44 });
  });

  it('leaves zero out when asked, for a series where it means nothing', () => {
    expect(domainOf([[37, 44]], { includeZero: false })).toEqual({ min: 37, max: 44 });
  });

  it('returns a usable domain for no data at all', () => {
    expect(domainOf([])).toEqual({ min: 0, max: 1 });
    expect(domainOf([[]])).toEqual({ min: 0, max: 1 });
  });

  it('ignores non-finite values rather than poisoning the domain', () => {
    expect(domainOf([[4, NaN, 9, Infinity]])).toEqual({ min: 0, max: 9 });
  });
});

describe('nearestIndex', () => {
  it('snaps to the nearest point, so the last one is reachable at the edge', () => {
    expect(nearestIndex(0, 5)).toBe(0);
    expect(nearestIndex(1, 5)).toBe(4);
    expect(nearestIndex(0.9, 5)).toBe(4);
    expect(nearestIndex(0.5, 5)).toBe(2);
  });

  it('clamps a cursor dragged outside the plot', () => {
    expect(nearestIndex(-0.4, 5)).toBe(0);
    expect(nearestIndex(1.8, 5)).toBe(4);
  });

  it('never returns an index that is not in the array', () => {
    expect(nearestIndex(0.5, 1)).toBe(0);
    expect(nearestIndex(0.5, 0)).toBe(0);
    expect(nearestIndex(NaN, 5)).toBe(0);
  });
});

describe('valueFraction and indexFraction', () => {
  it('places a value by its height in the domain', () => {
    expect(valueFraction(5, { min: 0, max: 10 })).toBe(0.5);
    expect(valueFraction(0, { min: 0, max: 10 })).toBe(0);
    expect(valueFraction(10, { min: 0, max: 10 })).toBe(1);
  });

  it('clamps a value outside the domain instead of drawing off-chart', () => {
    expect(valueFraction(-5, { min: 0, max: 10 })).toBe(0);
    expect(valueFraction(50, { min: 0, max: 10 })).toBe(1);
  });

  it('survives a collapsed domain', () => {
    expect(valueFraction(4, { min: 4, max: 4 })).toBe(0);
    expect(valueFraction(NaN, { min: 0, max: 10 })).toBe(0);
  });

  it('puts a single data point in the middle rather than on the axis', () => {
    expect(indexFraction(0, 1)).toBe(0.5);
    expect(indexFraction(0, 5)).toBe(0);
    expect(indexFraction(4, 5)).toBe(1);
    expect(indexFraction(2, 5)).toBe(0.5);
  });
});

describe('polarPoint', () => {
  it('measures clockwise from twelve o\'clock, like every gauge in the references', () => {
    const top = polarPoint(0, 0, 10, 0);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(-10); // up is negative y in SVG

    const right = polarPoint(0, 0, 10, 90);
    expect(right.x).toBeCloseTo(10);
    expect(right.y).toBeCloseTo(0);

    const bottom = polarPoint(0, 0, 10, 180);
    expect(bottom.y).toBeCloseTo(10);
  });
});

describe('arcPath', () => {
  it('draws a move and a single arc', () => {
    const d = arcPath(50, 50, 40, -120, 120);
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+ A 40 40 0 [01] 1 [\d.-]+ [\d.-]+$/);
  });

  it('sets the large-arc flag from the sweep, not from a guess', () => {
    /* Wrong at exactly 180° an arc renders as the other half of the circle — a
       gauge reading of 50% drawn in the wrong direction. It only shows at one
       value, which is why it is asserted at the boundary. */
    expect(arcPath(0, 0, 10, 0, 90)).toContain(' 0 1 ');
    expect(arcPath(0, 0, 10, 0, 180)).toContain(' 0 1 ');
    expect(arcPath(0, 0, 10, 0, 181)).toContain(' 1 1 ');
    expect(arcPath(0, 0, 10, 0, 359)).toContain(' 1 1 ');
  });

  it('draws a full circle as two arcs, because one draws nothing', () => {
    const d = arcPath(0, 0, 10, 0, 360);
    expect(d.match(/A /g)).toHaveLength(2);
    expect(d.match(/M /g)).toHaveLength(1);
  });

  it('flags an anticlockwise sweep', () => {
    expect(arcPath(0, 0, 10, 90, 0)).toMatch(/ [01] 0 /);
  });
});

describe('smoothPath', () => {
  it('emits one cubic per gap between points', () => {
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 4 },
      { x: 20, y: 8 },
      { x: 30, y: 2 },
    ]);
    expect(d.match(/C /g)).toHaveLength(3);
  });

  it('keeps every control point inside its own segment, so the curve cannot overshoot', () => {
    /* The fault this replaces: the earlier version of this test used a symmetric
       100, 0, 100, where the two control points cancel and nothing escapes — so it
       passed while the real chart drew the "Blocked" line below the zero gridline.
       An asymmetric reversal is what actually overshoots. A cubic stays inside the
       convex hull of its four control points, so checking the controls against
       each segment's own band proves the curve stays there too. */
    const series = [
      [97.5, 100, 90, 95, 97.5, 87.5, 92.5, 97.5], // 1, 0, 4, 2, 1, 5, 3, 1 inverted
      [100, 0, 100],
      [0, 100, 0],
      [40, 10, 90, 12, 88, 50],
      [50, 50, 50],
      [0, 100],
    ];

    for (const ys of series) {
      const pts = ys.map((y, i) => ({ x: i * 10, y }));
      const d = smoothPath(pts);
      const controls = [...d.matchAll(/C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ [\d.-]+/g)];
      expect(controls).toHaveLength(pts.length - 1);

      controls.forEach((m, i) => {
        const floor = Math.min(ys[i], ys[i + 1]);
        const ceiling = Math.max(ys[i], ys[i + 1]);
        for (const y of [Number(m[1]), Number(m[2])]) {
          expect(y).toBeGreaterThanOrEqual(floor - 1e-6);
          expect(y).toBeLessThanOrEqual(ceiling + 1e-6);
        }
      });
    }
  });

  it('still curves on a rising run — the clamp must only bite at a reversal', () => {
    /* If the clamp engaged everywhere the chart would be a polyline with extra
       steps, so this asserts the control points are genuinely off the straight
       line between their endpoints. */
    const d = smoothPath([
      { x: 0, y: 100 },
      { x: 10, y: 70 },
      { x: 20, y: 30 },
      { x: 30, y: 10 },
    ]);
    const middle = [...d.matchAll(/C [\d.-]+ ([\d.-]+), [\d.-]+ ([\d.-]+), [\d.-]+ [\d.-]+/g)][1];
    /* Segment 70 → 30. A straight line's controls would sit at 56.67 and 43.33. */
    expect(Number(middle[1])).not.toBeCloseTo(56.667, 1);
    expect(Number(middle[2])).not.toBeCloseTo(43.333, 1);
  });

  it('handles one point and none', () => {
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5');
    expect(smoothPath([])).toBe('');
  });
});

describe('donutSlices', () => {
  it('lays the slices end to end around the ring', () => {
    const slices = donutSlices([1, 1, 2]);
    expect(slices.map((s) => s.share)).toEqual([0.25, 0.25, 0.5]);
    expect(slices.map((s) => s.offset)).toEqual([0, 0.25, 0.5]);
  });

  it('keeps zero-valued slices in place so the legend stays aligned', () => {
    /* The caller indexes this against its labels and colours. Dropping an entry
       here would silently recolour every slice after it. */
    const slices = donutSlices([3, 0, 1]);
    expect(slices).toHaveLength(3);
    expect(slices[1].length).toBe(0);
    expect(slices[2].offset).toBe(0.75);
  });

  it('draws nothing rather than dividing by zero when there is no data yet', () => {
    const slices = donutSlices([0, 0, 0]);
    expect(slices.every((s) => s.length === 0)).toBe(true);
    expect(slices.every((s) => Number.isFinite(s.offset))).toBe(true);
  });

  it('treats negative and non-finite values as absent', () => {
    const slices = donutSlices([2, -5, NaN, 2]);
    expect(slices.map((s) => s.share)).toEqual([0.5, 0, 0, 0.5]);
  });

  it('sums to the whole ring', () => {
    const total = donutSlices([5, 3, 9, 1]).reduce((a, s) => a + s.length, 0);
    expect(total).toBeCloseTo(1);
  });
});
