'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { type NumberFormat, formatNumber } from '@/lib/view/number-format';

/* ============================================================================
 * COUNT UP — a figure that arrives
 * ----------------------------------------------------------------------------
 * Reference video 1: every number on the dashboard counts up from zero as the
 * panel lands, and the rings and bars fill with them.
 *
 * ── THE RULE THIS COMPONENT OBEYS ────────────────────────────────────────────
 * **The animation must never be what decides which number appears.** It renders
 * the true value, then animates over it. So:
 *   · the server renders the real figure — correct with JavaScript disabled;
 *   · `prefers-reduced-motion` shows the real figure and never moves it;
 *   · if the loop is interrupted at any point, the last thing written is the real
 *     figure, because the final frame is assigned rather than interpolated;
 *   · a changed `value` re-runs the count from where the display already was, so
 *     a live figure ticking from 12 to 13 does not fall to zero and climb back.
 *
 * One frame of the true value can show before the count begins, which is the
 * correct number appearing very slightly early. That is the right way round for
 * this trade: a decorative animation must fail towards the truth.
 *
 * ── WHY IT RE-RENDERS RATHER THAN WRITING textContent ────────────────────────
 * Writing to the node directly would be fewer renders, and it would also mean two
 * owners of one text node — React's next render would silently revert whatever
 * the loop had written, at whatever point the loop happened to be. One `<span>`
 * re-rendering for the length of a 900ms ease is cheap; a number that
 * occasionally reverts mid-count is a bug nobody can reproduce.
 * ========================================================================= */

export function CountUp({
  value,
  format = 'integer',
  duration = 900,
  className,
}: {
  value: number;
  /**
   * Applied to every frame, so a percentage or an hour count counts in its own
   * form. A NAME rather than a function: almost every caller is a page, and React
   * refuses to pass a function from a Server Component to a Client one. A
   * `format` prop typed as a callback compiles, lints, and then returns HTTP 500
   * — see `lib/view/number-format.ts`.
   */
  format?: NumberFormat;
  duration?: number;
  className?: string;
}) {
  const print = (n: number) => formatNumber(n, format);

  /* `null` means "not animating" — render the real value. It is also the SSR
     state and the reduced-motion state, which is why those need no branch. */
  const [shown, setShown] = React.useState<number | null>(null);

  /* Where the next count starts: always the last number actually displayed. The
     loop keeps it current every frame, which is what lets a `value` that changes
     mid-count continue from the screen instead of dropping to zero — and means
     an interrupted count needs no cleanup to tidy up after it.

     A ref and not state because writing it must not cause a render, and the loop
     is its only reader. */
  const from = React.useRef(0);

  React.useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;

    const start = from.current;
    if (start === value) return;

    let frame = 0;
    let began: number | null = null;

    const tick = (now: number) => {
      /* The first callback's timestamp is the origin, not `performance.now()` at
         schedule time: a backgrounded tab can hold the first frame for seconds,
         and measuring from before it would make the count begin part-finished. */
      began ??= now;
      const t = Math.min(1, (now - began) / duration);
      /* Ease-out cubic. A linear count reads as a stopwatch; the reference's
         numbers slow as they land. */
      const eased = 1 - (1 - t) ** 3;

      if (t >= 1) {
        from.current = value;
        setShown(null); // hand the value back to the true render
        return;
      }

      const next = start + (value - start) * eased;
      from.current = next;
      setShown(next);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={cn('tabular', className)}>{print(shown ?? value)}</span>
  );
}
