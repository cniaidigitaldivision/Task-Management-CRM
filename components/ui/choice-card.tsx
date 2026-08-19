'use client';

import * as React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * PICK ONE, FROM CARDS RATHER THAN A DROPDOWN — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"The form just looks like plain blank paper… I don't want them to see a legit
 * looking piece of digitalized paper."*
 *
 * ── WHAT A DROPDOWN COSTS ────────────────────────────────────────────────────
 * A `<select>` hides every option but one, which is right for a long list nobody
 * needs to compare — a timezone — and wrong for a short list where the choice IS
 * the decision. The project type and the package were both dropdowns. Choosing
 * "GROWTH" meant committing to a fee, an asset target and a platform count that
 * the control never showed, so the form asked for a commercial decision while
 * hiding the commercial terms.
 *
 * Cards put the options side by side. That is the reason to use them here; the fact
 * that a page of cards looks less like a tax return is the bonus, not the argument.
 *
 * ── ⚠️ RADIOS UNDERNEATH, NOT BUTTONS ────────────────────────────────────────
 * Each card is a `<label>` wrapping a real `sr-only` `<input type="radio">` sharing
 * one `name`. So: arrow keys move within the group, Tab moves past it, the value
 * posts with the form without a hidden mirror, and a screen reader hears "radio
 * group, 2 of 5". A `<div role="radio">` would need every one of those rebuilt by
 * hand, and one of them would be missed.
 *
 * Round marker, because this is one-of. The platform picker draws a SQUARE for the
 * same reason inverted — see `components/project/platform-picker.tsx`.
 * ========================================================================= */

export interface Choice {
  readonly value: string;
  readonly label: string;
  /** One short line. What the reader needs in order to choose. */
  readonly hint?: string;
  /** Top-right, for a code or a price — the fact that decides it. */
  readonly meta?: string;
  readonly icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** A design token name (no `--`), so the selected card carries its own colour. */
  readonly token?: string;
}

export function ChoiceCards({
  name,
  value,
  onChange,
  choices,
  columns = 2,
  className,
  ariaLabel,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  choices: readonly Choice[];
  columns?: 2 | 3;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'grid gap-2',
        columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2',
        className,
      )}
    >
      {choices.map((choice) => {
        const on = choice.value === value;
        const accent = choice.token ? `var(--${choice.token})` : 'var(--accent-primary)';
        const Icon = choice.icon;

        return (
          <label
            key={choice.value}
            className={cn(
              'group relative flex cursor-pointer items-start gap-2.5 rounded-xl border p-3',
              'transition-[background-color,border-color,box-shadow,transform] duration-[160ms]',
              'hover:-translate-y-px',
              /* focus-within, because the radio itself is sr-only — without it a
                 keyboard user moves through the group with nothing visibly moving. */
              'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
              on ? 'border-transparent' : 'border-border-subtle hover:bg-bg-hover',
            )}
            style={{
              outlineColor: 'var(--focus-ring)',
              ...(on
                ? {
                    backgroundColor: `color-mix(in oklab, ${accent} var(--tint-soft), var(--bg-surface))`,
                    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${accent} 60%, transparent)`,
                  }
                : {}),
            }}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={on}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />

            {Icon ? (
              <span
                aria-hidden="true"
                className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: on
                    ? accent
                    : `color-mix(in oklab, ${accent} var(--tint-soft), var(--bg-surface-sunken))`,
                  color: on ? 'var(--text-on-brand)' : accent,
                }}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
            ) : (
              /* No icon supplied — the round marker takes the leading slot, so a
                 card without one does not sit text-first and out of line with its
                 neighbours. */
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border',
                  on ? 'border-transparent' : 'border-border-strong group-hover:border-text-tertiary',
                )}
                style={on ? { backgroundColor: accent } : undefined}
              >
                {on && (
                  <Check
                    className="h-[10px] w-[10px]"
                    strokeWidth={3.5}
                    style={{ color: 'var(--text-on-brand)' }}
                  />
                )}
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-body-sm',
                    on ? 'font-semibold text-text-primary' : 'font-medium text-text-primary',
                  )}
                >
                  {choice.label}
                </span>
                {choice.meta && (
                  <span
                    className="shrink-0 text-micro font-semibold tabular-nums"
                    style={{ color: on ? accent : 'var(--text-tertiary)' }}
                  >
                    {choice.meta}
                  </span>
                )}
              </span>
              {choice.hint && (
                <span className="mt-0.5 block text-micro leading-snug text-text-secondary">
                  {choice.hint}
                </span>
              )}
            </span>

            {/* When an icon occupies the leading slot the tick still has to be
                somewhere, or "selected" is carried by colour alone. */}
            {Icon && on && (
              <span
                aria-hidden="true"
                className="absolute top-2 right-2 grid h-4 w-4 place-items-center rounded-full"
                style={{ backgroundColor: accent }}
              >
                <Check
                  className="h-[10px] w-[10px]"
                  strokeWidth={3.5}
                  style={{ color: 'var(--text-on-brand)' }}
                />
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
