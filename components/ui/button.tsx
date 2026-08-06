import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * BUTTON
 * ----------------------------------------------------------------------------
 * The primary action uses a brand gradient and a tinted shadow rather than a
 * flat fill. That is not decoration — on a screen with a dozen affordances, a
 * lit primary button is what makes the next step obvious at a glance.
 *
 * Gold stays reserved for one hero action per screen and never expresses state
 * or urgency (BR-024).
 * ========================================================================= */

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-text-on-brand bg-[image:var(--gradient-brand)] shadow-[var(--shadow-brand-glow)] hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
  secondary:
    'border border-border-default bg-bg-surface text-text-primary shadow-xs hover:border-border-strong hover:bg-bg-hover active:translate-y-px',
  subtle: 'bg-bg-active text-text-primary hover:bg-bg-hover active:translate-y-px',
  ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  gold: 'text-text-on-gold bg-[image:var(--gradient-gold)] shadow-sm hover:brightness-105 active:translate-y-px',
  danger: 'bg-feedback-error text-neutral-0 shadow-sm hover:brightness-110 active:translate-y-px',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 gap-1.5 px-2.5 text-micro',
  sm: 'h-8 gap-1.5 px-3 text-caption',
  md: 'h-9 gap-2 px-3.5 text-body-sm',
  lg: 'h-11 gap-2 px-6 text-body',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
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
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold',
        'transition-[background-color,background-image,border-color,box-shadow,transform,filter] duration-[140ms]',
        'focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------------
 * Icon-only action, for dense table rows and card headers
 * ------------------------------------------------------------------------ */

export function IconButton({
  label,
  icon: Icon,
  className,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: Extract<Size, 'icon' | 'icon-sm'>;
  variant?: Variant;
}) {
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} className={className} {...props}>
      <Icon className="h-4 w-4" strokeWidth={1.9} />
    </Button>
  );
}
