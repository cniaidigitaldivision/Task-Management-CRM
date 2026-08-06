import * as React from 'react';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  CONTROL_SURFACE,
  CONTROL_TEXT,
  type ControlSize,
} from './control';

/* ============================================================================
 * INPUT
 * ----------------------------------------------------------------------------
 * Same scale as every other control (components/ui/control.ts), so a field
 * beside a button beside a select forms a straight line rather than a ragged
 * one. A text field that is 2px shorter than the button next to it is the kind
 * of thing nobody can name but everybody sees.
 * ========================================================================= */

export function Input({
  size = 'md',
  className,
  invalid = false,
  ref,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: ControlSize;
  invalid?: boolean;
  /* React 19 passes `ref` as an ordinary prop, so forwardRef is no longer
     needed — but it still has to be declared and applied, or a caller's ref is
     silently dropped. The sign-in form needs one to focus the MFA code field the
     moment it appears. */
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full min-w-0 px-3 text-text-primary placeholder:text-text-tertiary',
        'focus-visible:outline-none',
        CONTROL_HEIGHT[size],
        CONTROL_TEXT[size],
        CONTROL_RADIUS,
        CONTROL_SURFACE,
        invalid
          ? 'border-[var(--feedback-error)] focus:border-[var(--feedback-error)]'
          : 'hover:border-border-strong focus:border-border-brand focus:bg-bg-surface',
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------------
 * SearchInput — icon, optional shortcut hint, and it never outgrows its parent
 * ------------------------------------------------------------------------ */

export function SearchInput({
  size = 'md',
  className,
  shortcut,
  label,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: ControlSize;
  /** e.g. "⌘K". Hidden below `md` where there is no room and no keyboard. */
  shortcut?: string;
  label: string;
}) {
  return (
    // min-w-0 is load-bearing: without it a flex child refuses to shrink below
    // its content width, which is how a search box ends up wider than the bar
    // it lives in and pushes everything else off-screen.
    <span className={cn('relative block min-w-0', className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-tertiary"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <input
        type="search"
        aria-label={label}
        className={cn(
          'w-full min-w-0 pl-9 text-text-primary placeholder:text-text-tertiary',
          'focus-visible:outline-none',
          shortcut ? 'pr-14' : 'pr-3',
          CONTROL_HEIGHT[size],
          CONTROL_TEXT[size],
          CONTROL_RADIUS,
          CONTROL_SURFACE,
          'bg-bg-surface-sunken hover:border-border-strong focus:border-border-brand focus:bg-bg-surface',
        )}
        {...props}
      />
      {shortcut && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-md border border-border-default bg-bg-surface px-1.5 py-0.5 font-sans text-micro font-semibold text-text-tertiary lg:block"
        >
          {shortcut}
        </kbd>
      )}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Field — label, control, hint and error in the one arrangement
 * ------------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-caption font-semibold text-text-primary">
        {label}
      </label>
      {children}
      {/* The error replaces the hint rather than stacking under it — two lines
          of guidance under one field is noise at the moment it matters least. */}
      {error ? (
        <p className="text-micro font-medium" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-micro text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}
