import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * ICON TILE
 * ----------------------------------------------------------------------------
 * A rounded square holding an icon, tinted from a semantic token. Small thing,
 * large effect: it gives every card and list a consistent visual anchor at the
 * left, which is what stops a screen of text blocks from looking like a form.
 *
 * The tint is mixed into the surface rather than hard-coded, so one expression
 * works on white cards and on dark surfaces alike (BR-025).
 * ========================================================================= */

const SIZES = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-11 w-11 rounded-xl',
  xl: 'h-14 w-14 rounded-2xl',
} as const;

const ICON_SIZES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[18px] w-[18px]',
  lg: 'h-5 w-5',
  xl: 'h-7 w-7',
} as const;

export function IconTile({
  icon: Icon,
  token = 'accent-primary',
  size = 'md',
  variant = 'soft',
  className,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  token?: string;
  size?: keyof typeof SIZES;
  variant?: 'soft' | 'solid';
  className?: string;
}) {
  const colour = `var(--${token})`;

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center', SIZES[size], className)}
      style={
        variant === 'solid'
          ? {
              backgroundImage: `linear-gradient(145deg, color-mix(in srgb, ${colour} 82%, white), ${colour})`,
              color: 'var(--text-inverse)',
              boxShadow: 'var(--shadow-xs)',
            }
          : {
              backgroundColor: `color-mix(in oklab, ${colour} var(--tint-soft), var(--bg-surface))`,
              color: colour,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} var(--tint-medium), transparent)`,
            }
      }
    >
      <Icon className={ICON_SIZES[size]} strokeWidth={1.9} />
    </span>
  );
}
