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

export function SegmentLegend({
  segments,
  className,
}: {
  segments: readonly Segment[];
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {segments.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-[3px]"
            style={{ backgroundColor: `var(--${s.token})` }}
          />
          <span className="text-caption text-text-secondary">{s.label}</span>
          <span className="tabular text-caption font-semibold text-text-primary">{s.value}</span>
          {total > 0 && (
            <span className="tabular text-micro text-text-tertiary">
              {Math.round((s.value / total) * 100)}%
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
