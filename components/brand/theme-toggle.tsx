'use client';

/* ============================================================================
 * THEME TOGGLE
 * ----------------------------------------------------------------------------
 * FR-201 — available to EVERY role, from Profile → Appearance.
 *
 * Two presentations of the same control:
 *   <ThemeToggle />        compact icon button for the top bar (cycles)
 *   <ThemeSegmented />     explicit three-way control for settings
 * ========================================================================= */

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

import { CONTROL_HEIGHT, CONTROL_RADIUS, CONTROL_SQUARE } from '@/components/ui/control';
import type { Theme } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

import { useTheme } from './theme-provider';

const OPTIONS: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun;
  description: string;
}> = [
  { value: 'light', label: 'Light', icon: Sun, description: 'Bright surfaces, dark text' },
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Dark surfaces, light text' },
];

/* ── 'SYSTEM' WAS REMOVED, session 15 ──────────────────────────────────────
   Owner: "the system preference I don't want — just the light toggle and the
   moon toggle."

   The device is still what decides for somebody who has never chosen; that is
   the sensible default and it costs nothing. What has gone is *following the
   device forever* as a standing choice. A person on this screen is choosing,
   so the screen offers the two things they can choose between. */

/* --------------------------------------------------------------------------
 * Compact — top bar
 * ------------------------------------------------------------------------ */

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, cycleTheme, isHydrated } = useTheme();
  /* Reflects what is RENDERED. With nothing stored, `preference` is null and
     an icon chosen from it would show a sun to somebody looking at dark. */
  const active = OPTIONS.find((option) => option.value === resolved) ?? OPTIONS[0];
  const Icon = active.icon;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      // Until hydration the stored preference is unknown, so the label would
      // be a guess. The button stays inert rather than announcing the wrong
      // state to a screen reader.
      aria-label={isHydrated ? `Theme: ${active.label}. Click to change.` : 'Change theme'}
      title={isHydrated ? `Theme: ${active.label}` : undefined}
      className={cn(
        // Square and radius from the shared scale. This sits between the
        // notification bell and the New-task button in the topbar, so a
        // `rounded-md` here against their `rounded-lg` was a visible 3px
        // corner mismatch in the busiest strip of the interface.
        'inline-flex items-center justify-center',
        CONTROL_SQUARE.md,
        CONTROL_RADIUS,
        'text-text-secondary transition-colors duration-[120ms]',
        'hover:bg-bg-hover hover:text-text-primary',
        'focus-visible:outline-none',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/* --------------------------------------------------------------------------
 * Segmented — Profile → Appearance
 * ------------------------------------------------------------------------ */

export function ThemeSegmented({ className }: { className?: string }) {
  const { preference, setTheme, isHydrated } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex items-center gap-0.5 border border-border-default p-0.5',
        CONTROL_HEIGHT.md,
        CONTROL_RADIUS,
        'bg-bg-subtle',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = isHydrated && preference === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(option.value)}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-md px-2.5',
              'text-caption font-semibold',
              'transition-colors duration-[120ms]',
              'focus-visible:outline-none',
              isActive
                ? 'bg-bg-surface text-text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Full setting row — the Appearance section of profile settings
 * ------------------------------------------------------------------------ */

export function ThemeSetting({ className }: { className?: string }) {
  const { preference, setTheme, resolved, isHydrated } = useTheme();

  return (
    <section className={cn('space-y-4', className)}>
      <div className="space-y-1">
        <h3 className="text-h3 text-text-primary">Appearance</h3>
        <p className="text-body-sm text-text-secondary">
          Choose how CNI CRM looks to you. This applies to your account on every device.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          /* Against the RESOLVED theme, so the card that is lit is the one
             they are actually looking at — including before they have ever
             chosen, when the preference itself is null. */
          const isActive = isHydrated && resolved === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setTheme(option.value)}
              className={cn(
                'group flex flex-col items-start gap-3 rounded-xl border p-4 text-left',
                'transition-colors duration-[120ms]',
                'focus-visible:outline-none',
                isActive
                  ? 'border-border-brand bg-bg-brand-subtle'
                  : 'border-border-default bg-bg-surface hover:border-border-strong',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-lg',
                  'transition-colors duration-[120ms]',
                  isActive
                    ? 'bg-accent-primary text-text-on-brand'
                    : 'bg-bg-subtle text-text-secondary group-hover:text-text-primary',
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </span>

              <span className="space-y-0.5">
                <span className="block text-body font-medium text-text-primary">
                  {option.label}
                </span>
                <span className="block text-caption text-text-secondary">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {isHydrated && preference === null && (
        <p className="text-caption text-text-tertiary">
          Following your device for now — it is set to {resolved}. Picking one above fixes it for
          your account on every device.
        </p>
      )}
    </section>
  );
}
