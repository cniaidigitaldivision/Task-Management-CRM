'use client';

import * as React from 'react';
import { Check } from 'lucide-react';

import { PlatformIcon, platformMark } from '@/components/brand/platform-icon';
import type { PlatformRow } from '@/lib/db/queries/catalogue';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHICH PLATFORMS THE WORK GOES TO — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"I want you to add small radio checkboxes or square checkboxes. Suggest to me
 * whichever look will look better. For those checkboxes I need the icons or logos
 * of the platforms instead of just the names."*
 *
 * ── ⚠️ SQUARE CHECKBOXES, NOT RADIOS — AND THAT IS NOT A STYLE CHOICE ─────────
 * A radio group means "exactly one of these". Every package here sells SEVERAL
 * platforms — SPARK is 2, GROWTH is 4, MOMENTUM is 5 — so radios would make the
 * form unable to record what was actually sold, and a shape that contradicts the
 * data is worse than an ugly one.
 *
 * Square is also the established convention for "any number of these", so a reader
 * knows they may tick more than one before they try. Round means one, square means
 * many, and borrowing the wrong one to look tidier teaches the wrong thing.
 *
 * ── THE REAL CHECKBOX IS STILL THERE ─────────────────────────────────────────
 * `sr-only` on a real `<input type="checkbox">` inside a `<label>`, not a `<div>`
 * with an onClick. Space toggles it, Tab reaches it, the focus ring is the
 * browser's, and it posts itself with the form — so no state has to be mirrored
 * into a hidden field. The square that is drawn is decoration over a working
 * control, which is the opposite of the usual trade.
 *
 * ── WHY THE TILE CARRIES THE BRAND COLOUR WHEN TICKED ────────────────────────
 * Eleven identical grey rows with one tick in them is the thing the owner is
 * complaining about elsewhere in this form. A ticked row lights up in the
 * platform's OWN colour, so the selected set is readable as a shape — you can see
 * "the two blue ones and Instagram" without reading a word.
 * ========================================================================= */

export function PlatformPicker({
  platforms,
  chosen,
  onChange,
  /** The package's allowance, where it states one. Null means unconstrained. */
  limit,
  packageName,
}: {
  platforms: readonly PlatformRow[];
  chosen: readonly string[];
  onChange: (next: readonly string[]) => void;
  limit: number | null;
  packageName: string | null;
}) {
  const overLimit = limit !== null && chosen.length > limit;

  function toggle(id: string, on: boolean) {
    onChange(on ? [...chosen, id] : chosen.filter((existing) => existing !== id));
  }

  return (
    <div className="space-y-2.5">
      {/* Marks that the ticks WERE submitted. Without it the action cannot tell
          "no platforms chosen" from "this form never asked", and a status-only edit
          elsewhere would wipe the set. */}
      <input type="hidden" name="platformsSubmitted" value="1" />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-caption font-semibold text-text-primary">
          Where the work gets published
        </p>
        <p className="text-micro text-text-tertiary">
          {chosen.length === 0
            ? 'none picked yet'
            : limit !== null
              ? `${chosen.length} of ${limit} in ${packageName ?? 'the package'}`
              : `${chosen.length} picked`}
        </p>
      </div>

      {platforms.length === 0 ? (
        /* The catalogue is fetched when the dialog opens, so this is what the first
           moment looks like. Saying so beats an empty area that reads as "none
           available". */
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[38px] animate-pulse rounded-lg bg-bg-active" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {platforms.map((platform) => {
            const on = chosen.includes(platform.id);
            const mark = platformMark(platform.slug);
            const brand = mark?.hex ?? 'var(--accent-primary)';

            return (
              <label
                key={platform.id}
                className={cn(
                  'group relative flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2',
                  'transition-[background-color,border-color,transform] duration-[140ms]',
                  'hover:-translate-y-px',
                  /* ⚠️ focus-within, not focus: the input it belongs to is sr-only,
                     so without this a keyboard user tabs through eleven controls
                     with nothing visibly moving. */
                  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                  on ? 'border-transparent' : 'border-border-subtle hover:bg-bg-hover',
                )}
                style={{
                  outlineColor: 'var(--focus-ring)',
                  ...(on
                    ? {
                        /* The platform's own colour, softened into the surface so
                           eleven of them lit at once is still a readable page. */
                        backgroundColor: `color-mix(in oklab, ${brand} var(--tint-soft), var(--bg-surface))`,
                        boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${brand} 55%, transparent)`,
                      }
                    : {}),
                }}
              >
                <input
                  type="checkbox"
                  name="platformIds"
                  value={platform.id}
                  checked={on}
                  onChange={(event) => toggle(platform.id, event.target.checked)}
                  className="sr-only"
                />

                {/* The square. Drawn rather than native so it can carry the brand
                    colour, but it is only ever a picture of the input above. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border',
                    'transition-colors duration-[140ms]',
                    on ? 'border-transparent' : 'border-border-strong group-hover:border-text-tertiary',
                  )}
                  style={on ? { backgroundColor: brand } : undefined}
                >
                  {on && (
                    <Check
                      className="h-[11px] w-[11px]"
                      strokeWidth={3.5}
                      style={{ color: mark?.glyph === 'dark' ? '#111111' : '#FFFFFF' }}
                    />
                  )}
                </span>

                <PlatformIcon slug={platform.slug} size={20} />

                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-caption',
                    on ? 'font-semibold text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {platform.name}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* ⚠️ A WARNING, NOT A BLOCK. Over-ticking usually means an add-on was sold,
          and refusing it would make the form unable to record something that
          genuinely happened. The number is stated so the mismatch is a decision
          rather than an accident. */}
      {overLimit && (
        <p className="text-micro" style={{ color: 'var(--feedback-warning)' }}>
          {chosen.length} ticked but {packageName} covers {limit}. Fine if an add-on was sold —
          worth checking the fee.
        </p>
      )}
    </div>
  );
}
