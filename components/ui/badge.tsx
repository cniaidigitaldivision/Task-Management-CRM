import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * BADGE — status / priority / project-type indicator
 * ----------------------------------------------------------------------------
 * NFR-008 — the dot is decorative and the label carries the meaning. Colour is
 * never the only signal, so the component cannot be used in a way that relies
 * on it alone.
 *
 * `token` names a CSS custom property from styles/tokens.css (e.g.
 * `status-progress`). Passing a raw colour is impossible by design (BR-025).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW THE COLOUR IS DERIVED, AND WHY IT IS SAFE IN BOTH THEMES
 *
 * The previous version put a 6px dot beside plain text on a grey chip, so every
 * status looked the same from more than a foot away — which is most of why the
 * dashboard read as lifeless.
 *
 * These are properly tinted pills, and the contrast holds automatically:
 *
 *   background  the status colour mixed into the surface at --tint-soft
 *   text        the status colour mixed 70% toward --text-primary
 *
 * That second mix is the trick. In light theme --text-primary is near-black, so
 * a mid-tone blue darkens into a readable navy on its own pale tint. In dark
 * theme --text-primary is near-white, so the same expression lightens it
 * instead. One rule, correct in both directions, no per-theme overrides and no
 * hand-picked pairs to keep in sync (FR-207).
 * ========================================================================= */

type Variant = 'soft' | 'outline' | 'solid';
type Size = 'sm' | 'md';

export function Badge({
  token,
  children,
  className,
  size = 'md',
  variant = 'soft',
  dot = true,
  icon: Icon,
}: {
  token: string;
  children: React.ReactNode;
  className?: string;
  size?: Size;
  variant?: Variant;
  /** Suppress the dot when an icon already carries the non-colour signal. */
  dot?: boolean;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  const colour = `var(--${token})`;

  const base = cn(
    'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md font-semibold whitespace-nowrap',
    size === 'sm' ? 'px-1.5 py-0.5 text-micro' : 'px-2 py-[3px] text-caption',
    className,
  );

  const style: React.CSSProperties =
    variant === 'solid'
      ? { backgroundColor: colour, color: 'var(--text-inverse)' }
      : {
          backgroundColor:
            variant === 'outline'
              ? 'transparent'
              : `color-mix(in oklab, ${colour} var(--tint-soft), var(--bg-surface))`,
          color: `color-mix(in oklab, ${colour} 70%, var(--text-primary))`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} var(--tint-strong), transparent)`,
        };

  return (
    <span className={base} style={style}>
      {Icon ? (
        <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.25} />
      ) : (
        dot &&
        variant !== 'solid' && (
          <span
            aria-hidden="true"
            className={cn('shrink-0 rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')}
            style={{ backgroundColor: colour }}
          />
        )
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Numeric counter for tab labels and list headers
 * ------------------------------------------------------------------------ */

export function CountBadge({
  count,
  tone = 'neutral',
  className,
}: {
  count: number;
  tone?: 'neutral' | 'alert' | 'brand';
  className?: string;
}) {
  if (count <= 0) return null;

  const style: React.CSSProperties =
    tone === 'alert'
      ? { backgroundColor: 'var(--feedback-error)', color: 'var(--neutral-0)' }
      : tone === 'brand'
        ? {
            backgroundColor:
              'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
            color: 'var(--text-brand)',
          }
        : { backgroundColor: 'var(--bg-active)', color: 'var(--text-secondary)' };

  return (
    <span
      className={cn(
        'tabular inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-micro font-semibold',
        className,
      )}
      style={style}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Priority flag — colour plus a shape, so it survives colour-blindness
 * ------------------------------------------------------------------------ */

export function PriorityFlag({
  token,
  label,
  className,
}: {
  token: string;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={label}>
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3 shrink-0"
        aria-hidden="true"
        style={{ color: `var(--${token})` }}
      >
        <path d="M2.5 1v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M3.5 1.5h6.2l-1.6 2.6 1.6 2.6H3.5z" fill="currentColor" />
      </svg>
      <span className="text-micro font-semibold" style={{ color: `var(--${token})` }}>
        {label}
      </span>
    </span>
  );
}
