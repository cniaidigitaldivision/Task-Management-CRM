import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * PROGRESS PRIMITIVES
 * ----------------------------------------------------------------------------
 * ProgressBar   · load against capacity, time against limit
 * ProgressRing  · a single headline percentage
 * SegmentedBar  · a distribution across categories, in one bar
 *
 * Every one takes a token name, never a colour (BR-025), and every one pairs
 * the colour with a number or a label so colour is never the only signal
 * (NFR-008, FR-208).
 * ========================================================================= */

/* --------------------------------------------------------------------------
 * ProgressBar
 * ------------------------------------------------------------------------ */

export function ProgressBar({
  value,
  token,
  /** Draws a hairline at this percentage — the soft threshold, or 100%. */
  markerAt,
  size = 'md',
  className,
  label,
}: {
  /** Percentage. Values above 100 are clamped visually but reported honestly. */
  value: number;
  token: string;
  markerAt?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(value, 100));
  const colour = `var(--${token})`;
  const height = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-2.5' : 'h-2';

  return (
    <span
      className={cn('relative block w-full overflow-hidden rounded-full bg-bg-active', height, className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-[600ms] ease-out"
        style={{
          width: `${clamped}%`,
          backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${colour} 78%, white), ${colour})`,
        }}
      />
      {markerAt !== undefined && markerAt < 100 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px"
          style={{
            left: `${markerAt}%`,
            backgroundColor: 'color-mix(in oklab, var(--text-primary) 30%, transparent)',
          }}
        />
      )}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * ProgressRing
 * ------------------------------------------------------------------------ */

export function ProgressRing({
  value,
  token,
  size = 72,
  thickness = 7,
  children,
  className,
  label,
}: {
  value: number;
  token: string;
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(value, 100));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${Math.round(value)}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          stroke="var(--bg-active)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          stroke={`var(--${token})`}
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {children}
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * SegmentedBar — a whole distribution in one bar
 * ------------------------------------------------------------------------
 * Replaces the row of six identical stat tiles the dashboard used to open with.
 * Six equal boxes force you to read every number to learn the shape of the
 * work; one proportional bar shows it before you read anything, and the legend
 * still carries the exact counts.
 */

export interface Segment {
  key: string;
  label: string;
  value: number;
  token: string;
}

export function SegmentedBar({
  segments,
  className,
  height = 'h-2.5',
}: {
  segments: readonly Segment[];
  className?: string;
  height?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  return (
    <span
      className={cn('flex w-full overflow-hidden rounded-full bg-bg-active', height, className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const colour = `var(--${s.token})`;
          return (
            <span
              key={s.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(s.value / total) * 100}%`,
                backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${colour} 84%, white), ${colour})`,
                boxShadow: 'inset -1px 0 0 var(--bg-surface)',
              }}
              title={`${s.label}: ${s.value}`}
            />
          );
        })}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * SegmentLegend
 * ------------------------------------------------------------------------
 * ── WHY THIS WAS REBUILT (owner feedback, Session 09) ────────────────────────
 *   "The legend on the CRM dashboard is absolutely not readable. It's not very
 *    visible and it's not very clear what it is."
 *
 * Correct, and it was a real defect rather than a matter of taste. The first
 * version put three separate pieces of information — label, count, percentage —
 * on ONE line, 6px apart, in 12px and 11px grey:
 *
 *     ● To Do 6 35%  ● In Progress 5 29%  ● In Review 3 18%
 *
 * At a glance that is not five facts, it is one grey smear. Three compounding
 * mistakes:
 *
 *   1. no visual separation between ENTRIES, only 16px of gap — so entries ran
 *      into each other and the eye could not find the boundaries
 *   2. no separation WITHIN an entry either, so "To Do 6 35%" read as a phrase
 *      rather than a label and two numbers
 *   3. the numbers were the smallest, faintest text on the row, when they are
 *      the reason the legend exists
 *
 * Now each status is a discrete tile in a grid: swatch and label on top, the
 * count large and in primary text below it, the share quiet beside it. The
 * numbers are the loudest thing, the entries have edges, and it reads in one
 * pass instead of being decoded.
 * ------------------------------------------------------------------------ */

export function SegmentLegend({
  segments,
  className,
}: {
  segments: readonly Segment[];
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
        className,
      )}
    >
      {segments.map((s) => {
        const colour = `var(--${s.token})`;
        const share = total > 0 ? Math.round((s.value / total) * 100) : 0;

        return (
          <li
            key={s.key}
            className="rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5"
          >
            {/* Label row. A 10px bar rather than an 8px dot — a bar carries far
                more colour at small size, which is what makes it findable. */}
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: colour }}
              />
              <span className="truncate text-micro font-semibold tracking-[0.04em] text-text-secondary uppercase">
                {s.label}
              </span>
            </div>

            {/* The numbers, given the weight they earn. */}
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="tabular text-h3 leading-none font-semibold text-text-primary">
                {s.value}
              </span>
              {total > 0 && (
                <span className="tabular text-micro font-medium text-text-tertiary">{share}%</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
