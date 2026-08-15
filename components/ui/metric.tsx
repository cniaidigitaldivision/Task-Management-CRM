import * as React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { IconTile } from '@/components/ui/icon-tile';
import { cn } from '@/lib/utils';

/* ============================================================================
 * METRIC PRIMITIVES
 * ----------------------------------------------------------------------------
 * Sparkline · TrendPill · StatCard
 *
 * A KPI card earns its space only if it answers three questions at a glance:
 * what is the number, is it moving the right way, and what is the shape of the
 * recent history. The old tiles answered the first, sometimes the second, and
 * never the third — which is why six of them in a row read as a spreadsheet.
 * ========================================================================= */

/* --------------------------------------------------------------------------
 * Sparkline
 * ------------------------------------------------------------------------
 * Deliberately has no <defs>/gradient IDs. These render as Server Components,
 * where useId is unavailable, and hand-rolled ids collide the moment two cards
 * appear on one page. A flat mixed fill under a stroked line reads just as well
 * and cannot collide with anything.
 */

export function Sparkline({
  points,
  token,
  className,
  width = 96,
  height = 30,
}: {
  points: readonly number[];
  token: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  // 1.5px of padding top and bottom so the stroke is never clipped.
  const y = (v: number) => height - 1.5 - ((v - min) / span) * (height - 3);

  const line = points.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line} ${width},${height} 0,${height}`;
  const colour = `var(--${token})`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polygon points={area} fill={`color-mix(in oklab, ${colour} 16%, transparent)`} />
      <polyline
        points={line}
        fill="none"
        stroke={colour}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={width}
        cy={y(points[points.length - 1])}
        r={2.25}
        fill={colour}
        stroke="var(--bg-surface)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * TrendPill
 * ------------------------------------------------------------------------
 * `good` is separate from `direction` on purpose. More completed work is up and
 * good; more blocked work is up and bad. Colouring by direction alone would
 * turn every rise green, which is how dashboards end up lying.
 */

export function TrendPill({
  direction,
  text,
  good,
  className,
}: {
  direction: 'up' | 'down';
  text: string;
  good: boolean;
  className?: string;
}) {
  const Icon = direction === 'up' ? TrendingUp : TrendingDown;
  const token = good ? 'feedback-success' : 'feedback-warning';
  const colour = `var(--${token})`;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${colour} var(--tint-soft), var(--bg-surface))`,
        color: `color-mix(in oklab, ${colour} 76%, var(--text-primary))`,
      }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
      {text}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * StatCard
 * ------------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  unit,
  token = 'accent-primary',
  icon,
  trend,
  hint,
  spark,
  className,
}: {
  label: string;
  /**
   * A node rather than only a number or a string, so a caller can hand over
   * `<CountUp value={n} />` and have the figure arrive instead of appear
   * (UI redesign step 4). Passing a client element from a Server Component is
   * fine — it is an element, not a function, so nothing has to cross the
   * serialisation boundary that a `format` callback could not.
   */
  value: React.ReactNode;
  unit?: string;
  token?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  trend?: { direction: 'up' | 'down'; text: string; good: boolean };
  hint?: string;
  spark?: readonly number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4',
        'shadow-sm transition-[border-color,box-shadow,transform] duration-[180ms]',
        'hover:-translate-y-px hover:border-border-strong hover:shadow-md',
        className,
      )}
    >
      {/* A wash of the metric's own colour, so a row of cards is readable as
          distinct categories before any text is parsed.

          ⚠️ 24%, not the 9% this started at. Owner, 2026-08-15: the interface
          read as "blank stale". The reference dashboards give each KPI card a
          clearly coloured field, and at 9% ours was a rumour. It is a radial
          falling off from the top-right corner, so the number and the hint sit
          on the quietest part of the gradient and keep their contrast. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(24rem 13rem at 100% 0%, color-mix(in oklab, var(--${token}) 24%, transparent), transparent 72%)`,
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase">
            {label}
          </p>
          <p className="mt-2 flex items-baseline gap-1">
            <span className="tabular text-[1.875rem] leading-none font-semibold tracking-tight text-text-primary">
              {value}
            </span>
            {unit && (
              <span className="text-caption font-medium text-text-tertiary">{unit}</span>
            )}
          </p>
        </div>
        {icon && <IconTile icon={icon} token={token} size="md" />}
      </div>

      {/* ── THE HINT WRAPS, IT DOES NOT TRUNCATE ─────────────────────────────
          It used to be `truncate`, which was invisible until a card gained a
          sparkline: 96px of chart left about 180px for the hint, and "Approved and
          closed in the last week" became "Approved and closed in t…". A hint
          exists to explain the number, so a hint that has been cut off in the
          middle of a word is worse than no hint at all — and quietly clipping
          copy is not something a reader can even tell has happened.

          Wraps to a second line instead, and the sparkline shrinks a little to
          give it the room. All four cards are grid items, so one growing by a line
          takes the whole row with it and none of them ends up a different height. */}
      <div className="relative mt-3 flex items-end justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {trend && <TrendPill {...trend} />}
          {hint && <span className="text-micro text-balance text-text-tertiary">{hint}</span>}
        </div>
        {spark && <Sparkline points={spark} token={token} width={72} />}
      </div>
    </div>
  );
}
