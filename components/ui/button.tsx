import * as React from 'react';

import { cn } from '@/lib/utils';

import {
  CONTROL_GAP,
  CONTROL_HEIGHT,
  CONTROL_ICON,
  CONTROL_PADDING,
  CONTROL_RADIUS,
  CONTROL_SQUARE,
  CONTROL_TEXT,
  type ControlSize,
} from './control';

/* ============================================================================
 * BUTTON
 * ----------------------------------------------------------------------------
 * Dimensions come from components/ui/control.ts, which every other control
 * imports too. A button, a select and a toggle placed side by side now line up
 * exactly, because none of them decides its own height any more.
 *
 * The primary action uses a brand gradient and a tinted shadow rather than a
 * flat fill — on a screen with a dozen affordances, a lit primary button is
 * what makes the next step obvious at a glance.
 *
 * Gold stays reserved for one hero action per screen and never expresses state
 * or urgency (BR-024).
 * ========================================================================= */

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'subtle';

const VARIANTS: Readonly<Record<Variant, string>> = {
  primary:
    'text-text-on-brand bg-[image:var(--gradient-brand)] shadow-[var(--shadow-brand-glow)] hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
  secondary:
    'border border-border-default bg-bg-surface text-text-primary shadow-xs hover:border-border-strong hover:bg-bg-hover active:translate-y-px',
  subtle: 'bg-bg-active text-text-primary hover:bg-bg-hover active:translate-y-px',
  ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  gold: 'text-text-on-gold bg-[image:var(--gradient-gold)] shadow-sm hover:brightness-105 active:translate-y-px',
  danger: 'bg-feedback-error text-neutral-0 shadow-sm hover:brightness-110 active:translate-y-px',
};

const SHARED =
  'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap ' +
  'transition-[background-color,background-image,border-color,box-shadow,transform,filter] duration-[140ms] ' +
  'focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
  variant?: Variant;
  size?: ControlSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        SHARED,
        CONTROL_RADIUS,
        CONTROL_HEIGHT[size],
        CONTROL_PADDING[size],
        CONTROL_TEXT[size],
        CONTROL_GAP[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------------
 * IconButton — square, and exactly as tall as a Button of the same size
 * ------------------------------------------------------------------------ */

export function IconButton({
  label,
  icon: Icon,
  className,
  size = 'md',
  variant = 'ghost',
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'size'> & {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: ControlSize;
  variant?: Variant;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(SHARED, CONTROL_RADIUS, CONTROL_SQUARE[size], VARIANTS[variant], className)}
      {...props}
    >
      <Icon className={CONTROL_ICON[size]} strokeWidth={1.9} />
    </button>
  );
}

/* --------------------------------------------------------------------------
 * ButtonGroup — buttons joined into one unit, with the seams tidied
 * ------------------------------------------------------------------------ */

export function ButtonGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center',
        // Square off the inner corners and collapse the doubled borders, so a
        // group reads as one control rather than buttons that happen to touch.
        '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
        '[&>*:not(:first-child)]:-ml-px',
        className,
      )}
    >
      {children}
    </div>
  );
}
