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
  value: number | string;
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
      {/* A very faint wash of the metric's own colour, so a row of cards is
          readable as distinct categories before any text is parsed. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(22rem 12rem at 100% 0%, color-mix(in oklab, var(--${token}) 9%, transparent), transparent 70%)`,
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

      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {trend && <TrendPill {...trend} />}
          {hint && <span className="truncate text-micro text-text-tertiary">{hint}</span>}
        </div>
        {spark && <Sparkline points={spark} token={token} />}
      </div>
    </div>
  );
}
