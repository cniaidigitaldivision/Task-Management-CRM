'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import {
  CONTROL_HEIGHT,
  CONTROL_ICON,
  CONTROL_RADIUS,
  CONTROL_SURFACE,
  type ControlSize,
} from './control';

/* ============================================================================
 * TOOLBAR + TOGGLE GROUP
 * ----------------------------------------------------------------------------
 * ── WHY (owner feedback, Session 08) ─────────────────────────────────────────
 *   "Some buttons and some dropdowns are bigger than the normal screen."
 *
 * Two separate causes, and the toolbar has to defend against both:
 *
 *   1. A control that ignores the size system — fixed by control.ts and by
 *      every control in the row now importing from it.
 *   2. A row that cannot get narrower than its contents. A flex row whose
 *      children are `shrink-0` (which controls must be, or they squash
 *      unevenly) is exactly as wide as the sum of its children. If that
 *      exceeds the viewport, the PAGE scrolls sideways — every screen, not
 *      just the toolbar.
 *
 * `flex-wrap` fixes (2) properly: the row folds onto a second line and the page
 * never scrolls horizontally. `overflow-x-auto` would also stop the page
 * scrolling, but it hides controls behind an edge nobody notices — wrapping
 * keeps every filter visible, which is the point of a filter bar.
 * ========================================================================= */

export function Toolbar({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      // `max-w-full` and `min-w-0` are the belt and braces: even if a child
      // misbehaves, the row cannot push the page wider than the viewport.
      className={cn('flex w-full max-w-full min-w-0 flex-wrap items-center gap-2', className)}
    >
      {children}
    </div>
  );
}

/** Related controls, kept together when the toolbar wraps. */
export function ToolbarGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex shrink-0 items-center gap-2', className)}>{children}</div>;
}

/** Pushes what follows to the right — collapses harmlessly when wrapped. */
export function ToolbarSpacer() {
  return <span aria-hidden="true" className="hidden flex-1 lg:block" />;
}

/** A vertical rule between groups. */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border-default sm:block" />;
}

/** The small uppercase caption that names a control. */
export function ToolbarLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
      {children}
    </span>
  );
}

/* ============================================================================
 * TOGGLE GROUP — the segmented control
 * ----------------------------------------------------------------------------
 * Sized from the same scale as everything else. The outer shell takes the
 * control height and the segments fill it exactly, so the group lines up with
 * the selects and buttons beside it instead of sitting 2–4px short — which was
 * the actual, unnameable reason the old toolbar looked untidy.
 * ========================================================================= */

export interface ToggleOption<T extends string> {
  readonly key: T;
  readonly label: string;
  /** A dot in this token's colour, for status and priority filters. */
  readonly token?: string;
  readonly icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  className,
}: {
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  size?: ControlSize;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 p-0.5',
        CONTROL_HEIGHT[size],
        CONTROL_RADIUS,
        CONTROL_SURFACE,
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.key === value;
        const Icon = option.icon;

        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.key)}
            className={cn(
              'inline-flex h-full shrink-0 items-center gap-1.5 rounded-md px-2 text-micro font-semibold',
              'transition-colors duration-[140ms] focus-visible:outline-none',
              isActive
                ? 'bg-bg-active text-text-primary shadow-xs'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {option.token && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--${option.token})` }}
              />
            )}
            {Icon && <Icon className={CONTROL_ICON.sm} strokeWidth={2} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * ToggleButton — a single on/off control, same height as everything else
 * ------------------------------------------------------------------------ */

export function ToggleButton({
  pressed,
  onChange,
  children,
  icon: Icon,
  size = 'sm',
  className,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: ControlSize;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 px-2.5 text-micro font-semibold',
        'focus-visible:outline-none',
        CONTROL_HEIGHT[size],
        CONTROL_RADIUS,
        CONTROL_SURFACE,
        pressed
          ? 'border-border-brand bg-bg-selected text-text-brand'
          : 'text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
        className,
      )}
    >
      {Icon && <Icon className={CONTROL_ICON.sm} strokeWidth={2} aria-hidden="true" />}
      {children}
    </button>
  );
}
