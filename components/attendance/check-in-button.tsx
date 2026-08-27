'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, LogOut, Loader2, Check } from 'lucide-react';

import { checkInAction, checkOutAction } from '@/app/actions/attendance';
import { clockLabel } from '@/lib/domain/attendance';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CHECK IN / CHECK OUT, IN THE TOP BAR
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"I want there to be a check-in button appearing throughout
 * this whole dashboard, on the side where the notifications and clock are
 * appearing and the theme switch radio button is appearing… when somebody comes in
 * the morning and clicks the check-in button, it will turn green. When they check
 * out it will turn red."*
 *
 * ── THREE STATES, AND THE THIRD ONE IS NOT A BUTTON ─────────────────────────
 *   open       nothing recorded today. Neutral, says "Check in".
 *   in         checked in, still here. GREEN, says the arrival time, and pressing
 *              it checks out.
 *   done       checked out. RED, and inert — the owner chose one check-in and one
 *              check-out per day, so there is nothing left to press. It stays
 *              visible rather than disappearing, because "did I remember to check
 *              out?" is the question this control exists to answer.
 *
 * ── ⚠️ THE COLOUR IS THE STATE, SO IT MUST NOT LIE ──────────────────────────
 * The server decides everything. This holds no timer, computes no status and
 * never reads the clock to decide what it is: it renders what the layout passed
 * and calls `router.refresh()` after a write so the next paint comes from the
 * database. A component that flipped itself green optimistically would show green
 * to somebody whose check-in the trigger had just refused.
 *
 * ── ⚠️ NO CONFIRMATION DIALOGUE ─────────────────────────────────────────────
 * Deliberately. This is pressed twice a day by everybody, and a confirm step on a
 * twice-daily action is the thing people learn to click through without reading.
 * Both writes are recoverable by an Admin, which is what makes that safe.
 * ========================================================================= */

export interface CheckInButtonProps {
  /** Today's row, or null when nothing has been recorded yet. */
  readonly today: {
    readonly checkedInAt: string | null;
    readonly checkedOutAt: string | null;
  } | null;
}

type State = 'open' | 'in' | 'done';

export function CheckInButton({ today }: CheckInButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const state: State = today?.checkedOutAt ? 'done' : today?.checkedInAt ? 'in' : 'open';

  /* A refusal is worth showing — "you already checked out today" is the answer to
     a real question — but only for a moment. It is not an error to dwell on. */
  React.useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [note]);

  const press = async () => {
    if (state === 'done' || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = state === 'in' ? await checkOutAction() : await checkInAction();
      if (!result.ok) setNote(result.error);
      /* ⚠️ Refreshed either way. A failure usually means the server already knows
         something this render does not — "you are already checked in" happens when
         two taps race — and re-reading is what makes the button agree with it. */
      router.refresh();
    } catch {
      setNote('That could not be recorded. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const label =
    state === 'done'
      ? `Out ${clockLabel(today?.checkedOutAt ?? null)}`
      : state === 'in'
        ? `In ${clockLabel(today?.checkedInAt ?? null)}`
        : 'Check in';

  const title =
    state === 'done'
      ? `Checked in at ${clockLabel(today?.checkedInAt ?? null)} and out at ${clockLabel(
          today?.checkedOutAt ?? null,
        )}. Your day is recorded — an Admin can correct it if it is wrong.`
      : state === 'in'
        ? `Checked in at ${clockLabel(today?.checkedInAt ?? null)}. Press to check out.`
        : 'Record your arrival. The time comes from the server, not from this device.';

  const Icon = state === 'in' ? LogOut : state === 'done' ? Check : LogIn;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void press()}
        disabled={busy || state === 'done'}
        aria-label={title}
        title={title}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-caption font-semibold',
          'transition-colors disabled:cursor-default',
          state === 'open' &&
            'border-border-default text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        style={
          /* ⚠️ Inline for the two coloured states, and not a Tailwind class. The
             feedback tokens are CSS custom properties, so `bg-[var(--x)]` at 12%
             would need a `color-mix` arbitrary value repeated three times — this
             says the same thing once and keeps both themes automatic. */
          state === 'in'
            ? {
                borderColor: 'color-mix(in oklab, var(--feedback-success) 45%, transparent)',
                backgroundColor: 'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
                color: 'var(--feedback-success)',
              }
            : state === 'done'
              ? {
                  borderColor: 'color-mix(in oklab, var(--feedback-error) 40%, transparent)',
                  backgroundColor: 'color-mix(in oklab, var(--feedback-error) 12%, transparent)',
                  color: 'var(--feedback-error)',
                  /* ⚠️ NOT faded. It is inert, not unavailable — a 45% opacity pill
                     reads as "broken" when it is in fact the successful end state. */
                  opacity: 1,
                }
              : undefined
        }
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        )}
        {/* The time is the useful half, so it survives; the word "Check" is what
            gets dropped on a narrow window. */}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {note && (
        <p
          role="status"
          className="absolute top-[calc(100%+6px)] right-0 z-50 w-max max-w-[16rem] rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-micro text-text-secondary shadow-[var(--shadow-lg)]"
        >
          {note}
        </p>
      )}
    </div>
  );
}
