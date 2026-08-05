/* ============================================================================
 * CNI — AI & DIGITAL DIVISION · LOGO
 * ----------------------------------------------------------------------------
 * FR-200 · FR-209
 *
 * A vector reconstruction of the supplied mark: a low-poly brain whose left
 * hemisphere is deep teal and right hemisphere gold, its trailing edge
 * dissolving into scattered pixels.
 *
 * Rendered inline rather than as an <img> for three reasons:
 *   1. Facet seams read as `var(--logo-seam)`, which tracks the surface behind
 *      the mark — so it sits correctly on light and dark without two files.
 *   2. Facet fills read the brand ramp directly, so the mark can never drift
 *      out of step with the palette.
 *   3. It scales to any size with no asset pipeline.
 *
 * Static .svg files for favicon, email and OG use are generated separately —
 * those contexts cannot read our CSS variables.
 *
 * ⚠️ The supplied source was a JPEG on a white background. This is a faithful
 *    interpretation, not a trace of the original vector. See Q-049.
 * ========================================================================= */

import * as React from 'react';

import { DIVISION_NAME } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* --------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */

type Point = readonly [number, number];

/** Brain mesh vertices on a 420 × 290 grid. */
const V = {
  // Outer silhouette, clockwise from the left edge
  a: [18, 148], b: [28, 98], c: [66, 58], d: [118, 32],
  e: [176, 26], f: [224, 42], g: [256, 78], h: [266, 130],
  i: [254, 182], j: [226, 220], k: [186, 246], l: [150, 256],
  m: [132, 286], n: [112, 250], o: [72, 232], p: [36, 196],
  // Inner ring
  q: [86, 120], r: [140, 92], s: [196, 88], t: [216, 140],
  u: [188, 190], v: [120, 196], w: [78, 168],
  // Centre
  x: [150, 145],
} as const satisfies Record<string, Point>;

type VertexKey = keyof typeof V;

/** Each facet is three vertices plus a fill from the brand ramp.
 *  Teal occupies the upper-left; gold sweeps through the right and lower-right,
 *  matching the split in the source mark. */
const FACETS: ReadonlyArray<readonly [VertexKey, VertexKey, VertexKey, string]> = [
  // ---- Teal hemisphere ----
  ['a', 'b', 'w', 'var(--teal-800)'],
  ['b', 'q', 'w', 'var(--teal-700)'],
  ['b', 'c', 'q', 'var(--teal-600)'],
  ['c', 'd', 'q', 'var(--teal-500)'],
  ['d', 'r', 'q', 'var(--teal-700)'],
  ['d', 'e', 'r', 'var(--teal-600)'],
  ['q', 'r', 'x', 'var(--teal-600)'],
  ['q', 'x', 'w', 'var(--teal-500)'],
  ['v', 'w', 'x', 'var(--teal-700)'],
  ['u', 'v', 'x', 'var(--teal-600)'],
  ['l', 'n', 'v', 'var(--teal-600)'],
  ['l', 'm', 'n', 'var(--teal-700)'],
  ['n', 'o', 'v', 'var(--teal-500)'],
  ['o', 'w', 'v', 'var(--teal-600)'],
  ['o', 'p', 'w', 'var(--teal-700)'],
  ['p', 'a', 'w', 'var(--teal-800)'],
  // ---- Gold hemisphere ----
  ['e', 's', 'r', 'var(--gold-600)'],
  ['e', 'f', 's', 'var(--gold-500)'],
  ['f', 'g', 's', 'var(--gold-400)'],
  ['g', 't', 's', 'var(--gold-600)'],
  ['g', 'h', 't', 'var(--gold-500)'],
  ['h', 'i', 't', 'var(--gold-700)'],
  ['i', 'u', 't', 'var(--gold-500)'],
  ['i', 'j', 'u', 'var(--gold-600)'],
  ['j', 'k', 'u', 'var(--gold-400)'],
  ['k', 'l', 'u', 'var(--gold-700)'],
  ['l', 'v', 'u', 'var(--gold-500)'],
  ['r', 's', 'x', 'var(--gold-700)'],
  ['s', 't', 'x', 'var(--gold-600)'],
  ['t', 'u', 'x', 'var(--gold-500)'],
];

/** The dissolve — thought becoming digital. Squares thin out and fade as they
 *  travel right, which is what makes it read as dissolution rather than noise. */
const PIXELS: ReadonlyArray<readonly [number, number, number, string, number]> = [
  [282, 140, 20, 'var(--gold-500)', 1],
  [292, 62, 15, 'var(--gold-600)', 0.95],
  [300, 196, 17, 'var(--teal-600)', 0.95],
  [316, 104, 21, 'var(--teal-700)', 0.9],
  [322, 238, 13, 'var(--gold-500)', 0.85],
  [334, 156, 15, 'var(--teal-500)', 0.85],
  [342, 38, 13, 'var(--gold-400)', 0.8],
  [350, 206, 11, 'var(--teal-600)', 0.75],
  [360, 116, 17, 'var(--teal-700)', 0.72],
  [370, 68, 11, 'var(--gold-500)', 0.66],
  [378, 172, 13, 'var(--teal-500)', 0.6],
  [386, 230, 9, 'var(--gold-400)', 0.54],
  [392, 100, 11, 'var(--teal-600)', 0.48],
  [402, 148, 9, 'var(--teal-500)', 0.4],
];

const toPoints = (keys: readonly VertexKey[]) =>
  keys.map((key) => `${V[key][0]},${V[key][1]}`).join(' ');

/* --------------------------------------------------------------------------
 * The mark
 * ------------------------------------------------------------------------ */

export function LogoMark({
  className,
  title = 'CNI AI & Digital Division',
  decorative = false,
}: {
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  const titleId = React.useId();

  return (
    <svg
      viewBox="0 0 420 290"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-8 w-auto shrink-0', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : titleId}
    >
      {!decorative && <title id={titleId}>{title}</title>}

      {/* Facet seams take the colour of the surface behind the mark, which is
          how the original reads as cut glass rather than flat shapes. */}
      <g stroke="var(--logo-seam)" strokeWidth={3.5} strokeLinejoin="round">
        {FACETS.map(([p1, p2, p3, fill], index) => (
          <polygon key={index} points={toPoints([p1, p2, p3])} fill={fill} />
        ))}
      </g>

      <g>
        {PIXELS.map(([x, y, size, fill, opacity], index) => (
          <rect
            key={index}
            x={x}
            y={y}
            width={size}
            height={size}
            rx={1}
            fill={fill}
            opacity={opacity}
          />
        ))}
      </g>
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * Wordmark
 * ------------------------------------------------------------------------ */

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex flex-col items-center leading-none', className)}>
      <span className="font-serif text-[1.05em] font-semibold tracking-[0.06em] text-text-brand">
        AI &amp; DIGITAL
      </span>
      <span className="mt-[0.35em] flex w-full items-center gap-[0.5em]">
        <span aria-hidden="true" className="h-px flex-1 bg-border-gold opacity-70" />
        <span className="font-serif text-[0.5em] font-medium tracking-[0.34em] text-text-gold">
          DIVISION
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border-gold opacity-70" />
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Lockups
 * ------------------------------------------------------------------------ */

/** Stacked lockup — auth screens, empty states. The one place it is shown large. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center gap-5', className)}>
      <LogoMark className="h-20" decorative />
      <LogoWordmark className="text-[1.75rem]" />
      <span className="sr-only">{DIVISION_NAME}</span>
    </span>
  );
}

/** Horizontal lockup — sidebar. Collapses to the mark alone. */
export function LogoHorizontal({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return <LogoMark className={cn('h-8', className)} />;
  }

  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <LogoMark className="h-9" decorative />
      <span className="flex flex-col leading-none">
        <span className="font-serif text-[0.9375rem] font-semibold tracking-[0.05em] text-text-primary">
          AI &amp; DIGITAL
        </span>
        <span className="mt-1 font-serif text-[0.5rem] font-medium tracking-[0.32em] text-text-gold">
          DIVISION
        </span>
      </span>
      <span className="sr-only">{DIVISION_NAME}</span>
    </span>
  );
}
