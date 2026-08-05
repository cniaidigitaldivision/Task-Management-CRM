import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Status / priority / type indicator.
 *
 * NFR-008 — the dot is decorative and the label carries the meaning. Colour is
 * never the only signal, so the component cannot be used in a way that relies
 * on it alone.
 *
 * `token` names a CSS custom property from styles/tokens.css (e.g.
 * `status-progress`). Passing a raw colour is impossible by design.
 */
export function Badge({
  token,
  children,
  className,
  size = 'md',
  variant = 'soft',
}: {
  token: string;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  variant?: 'soft' | 'outline' | 'solid';
}) {
  const dot = (
    <span
      aria-hidden="true"
      className={cn('shrink-0 rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')}
      style={{ backgroundColor: `var(--${token})` }}
    />
  );

  if (variant === 'solid') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full font-medium text-text-inverse',
          size === 'sm' ? 'px-2 py-0.5 text-micro' : 'px-2.5 py-1 text-caption',
          className,
        )}
        style={{ backgroundColor: `var(--${token})` }}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium text-text-primary',
        variant === 'outline'
          ? 'border border-border-default'
          : 'border border-border-subtle bg-bg-subtle',
        size === 'sm' ? 'py-0.5 pl-1.5 pr-2 text-micro' : 'py-1 pl-2 pr-2.5 text-caption',
        className,
      )}
    >
      {dot}
      {children}
    </span>
  );
}

/** Numeric counter for nav items and tab labels. */
export function CountBadge({
  count,
  tone = 'neutral',
  className,
}: {
  count: number;
  tone?: 'neutral' | 'alert';
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'tabular inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-micro font-semibold',
        tone === 'alert'
          ? 'bg-feedback-error text-text-inverse'
          : 'bg-bg-hover text-text-secondary',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
