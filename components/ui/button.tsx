import * as React from 'react';

import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-primary text-text-on-brand hover:bg-accent-primary-hover active:bg-accent-primary-active shadow-sm',
  secondary:
    'border border-border-default bg-bg-surface text-text-primary hover:bg-bg-hover hover:border-border-strong shadow-sm',
  ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  // Gold is brand chrome (BR-024). Reserved for a single hero action per
  // screen — never for anything that expresses state or urgency.
  gold: 'bg-accent-gold text-text-on-gold hover:bg-accent-gold-hover shadow-sm',
  danger: 'bg-feedback-error text-text-inverse hover:opacity-90 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-caption gap-1.5',
  md: 'h-9 px-4 text-body-sm gap-2',
  lg: 'h-11 px-6 text-body gap-2',
  icon: 'h-9 w-9',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium',
        'transition-colors duration-[120ms]',
        'focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
