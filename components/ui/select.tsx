import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  CONTROL_GAP,
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  CONTROL_SURFACE,
  CONTROL_TEXT,
  type ControlSize,
} from './control';

/* ============================================================================
 * SELECT
 * ----------------------------------------------------------------------------
 * ── WHY THIS EXISTS (owner feedback, Session 08) ─────────────────────────────
 *   "Some dropdowns are bigger than the normal screen."
 *
 * Those were bare `<select>` elements. A browser renders an unstyled select
 * with the OPERATING SYSTEM's widget: Windows picks its own font, its own
 * height — ignoring the one you set — and draws a chunky native arrow. Beside
 * hand-styled buttons it looks like a control from a different application,
 * and on a long option list it can be genuinely wider than its container.
 *
 * The fix is `appearance-none`, which strips the OS widget and leaves a plain
 * box we style like every other control, plus our own chevron.
 *
 * ── WHY IT IS STILL A REAL <select> ──────────────────────────────────────────
 * A div-and-listbox reimplementation is the usual next step and it is a trap:
 * you inherit keyboard navigation, type-ahead, screen-reader semantics, form
 * submission and mobile behaviour, and you get several of them subtly wrong.
 * A native select styled with appearance-none keeps all of that for free and
 * opens the proper picker on a phone (NFR-007).
 *
 * The one thing this cannot style is the open option list itself — that is
 * drawn by the OS and no CSS reaches it. Accepted deliberately: a correct
 * dropdown that looks native when open beats a beautiful one that traps
 * keyboard users.
 * ========================================================================= */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export function Select({
  options,
  size = 'sm',
  className,
  label,
  icon: Icon,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  options: readonly SelectOption[];
  size?: ControlSize;
  /** Visually-hidden label. Every control needs an accessible name. */
  label: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center',
        CONTROL_HEIGHT[size],
        CONTROL_RADIUS,
        CONTROL_SURFACE,
        'hover:border-border-strong focus-within:border-border-brand',
        className,
      )}
    >
      {Icon && (
        <Icon
          className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-text-tertiary"
          strokeWidth={2}
          aria-hidden="true"
        />
      )}

      <select
        aria-label={label}
        className={cn(
          // appearance-none is the whole point — it removes the OS widget.
          'h-full w-full cursor-pointer appearance-none bg-transparent font-semibold text-text-primary',
          'focus-visible:outline-none',
          CONTROL_TEXT[size],
          CONTROL_RADIUS,
          Icon ? 'pl-8' : 'pl-2.5',
          'pr-7',
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <ChevronDown
        className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-text-tertiary"
        strokeWidth={2.25}
        aria-hidden="true"
      />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Labelled select — the label sits outside, in the toolbar's own type style
 * ------------------------------------------------------------------------ */

export function LabelledSelect({
  caption,
  className,
  ...props
}: React.ComponentProps<typeof Select> & { caption: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', CONTROL_GAP.sm, className)}>
      <span className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
        {caption}
      </span>
      <Select {...props} />
    </span>
  );
}
