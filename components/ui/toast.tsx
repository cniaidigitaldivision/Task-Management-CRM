'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * A BRIEF NOTICE, BOTTOM RIGHT
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"when a new project is created there is no notification
 * coming. I want a light notification to come in from the right bottom for some
 * time to indicate that a new project has been created."*
 *
 * ── ⚠️ THIS IS NOT THE NOTIFICATION SYSTEM, AND MUST NOT BECOME IT ──────────
 * `public.notifications` is a durable record with its own preferences, digest
 * and bell — a thing somebody reads tomorrow. This is the opposite: proof that
 * the button you just pressed worked, gone in five seconds, never stored. Using
 * the durable system for this would put "you created a project" in the owner's
 * inbox every time they created a project.
 *
 * ── WHY A CONTEXT AND NOT A PROP ────────────────────────────────────────────
 * The three create dialogs live in the app shell, so what they need to announce
 * is raised several levels below where the notice has to be drawn — and the
 * dialog unmounts the moment it succeeds, which is precisely when the message
 * appears. A notice owned by the dialog would be destroyed with it.
 *
 * ── ⚠️ FIXED, AND OUTSIDE THE SHELL'S TRANSFORMED COLUMN ────────────────────
 * Mounted next to `launcher` in app-shell.tsx for the reason documented there:
 * anything `fixed` inside a transformed ancestor is positioned against that
 * ancestor rather than the viewport, so a notice placed inside the layout column
 * would sit in the middle of the page instead of the corner.
 * ========================================================================= */

/** How long a notice stays. Long enough to read a sentence and glance at a link,
 *  short enough that it is gone before it becomes furniture. */
const DWELL_MS = 5000;

/* ── ⚠️ THREE TONES, AND THE COLOUR IS THE FEEDBACK TOKEN ─────────────────
   Owner, 2026-09-03: *"make a colored notification, like a new project created
   successfully in a green color, not successful in a red color, a warning in an
   orange color."*

   Each maps to the theme's own semantic token rather than a literal green, red
   or orange — so the notice keeps its meaning in both light and dark, and moves
   with the palette instead of drifting out of step with every other success and
   error in the product. `--feedback-warning` IS the orange. */
const TONES = {
  ok: { token: 'feedback-success', Icon: Check },
  error: { token: 'feedback-error', Icon: XCircle },
  warn: { token: 'feedback-warning', Icon: AlertTriangle },
} as const;

export type ToastTone = keyof typeof TONES;

export interface ToastInput {
  readonly text: string;
  readonly tone?: ToastTone;
  /** An optional place to go — "View project". */
  readonly href?: string;
  readonly linkLabel?: string;
}

interface Toast extends ToastInput {
  readonly id: number;
}

const ToastContext = React.createContext<((input: ToastInput) => void) | null>(null);

/**
 * Announce something briefly.
 *
 * ⚠️ Returns a no-op when no provider is mounted rather than throwing. A missing
 * provider must never be able to break a create that has already succeeded —
 * losing the confirmation is a far smaller failure than losing the work.
 */
export function useToast(): (input: ToastInput) => void {
  const push = React.useContext(ToastContext);
  return React.useMemo(() => push ?? (() => {}), [push]);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<readonly Toast[]>([]);
  /* A counter, not `Date.now()`: two notices raised in the same millisecond
     would collide on a timestamp key, and `Date.now()` during render is what
     the purity lint refuses. */
  const nextId = React.useRef(0);

  const push = React.useCallback((input: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current, { ...input, id }]);
    /* Self-dismissing. The timer is not cleaned up on unmount because the only
       thing it does is drop an entry from state that is going away anyway. */
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, DWELL_MS);
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}

      {/* ⚠️ `aria-live="polite"`, so a screen reader is told without being
          interrupted — the notice confirms something the person just did, and
          they are not waiting on it. `pointer-events-none` on the stack with it
          restored per notice, so an invisible column does not swallow clicks on
          the page beneath. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => {
          const { token, Icon } = TONES[item.tone ?? 'ok'];

          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg',
                /* ⚠️ `slide-in`, the class that already exists in
                   styles/tokens.css — not a new keyframe. The first version of
                   this invented `animate-[toast-in_...]`, which names a keyframe
                   nothing defines: no error, no animation, and nobody would
                   have noticed the notice simply appearing.
                   `.slide-in` is also already listed in the file's
                   prefers-reduced-motion block, so it holds still for anybody
                   who asked for that without a second rule to remember. */
                'slide-in',
              )}
              style={{
                borderColor: `color-mix(in oklab, var(--${token}) 42%, transparent)`,
                /* ⚠️ A TINT OF THE SURFACE, not the raw token. A saturated
                   green panel with dark text fails contrast in the light theme
                   and glares in the dark one; mixing a little of the token into
                   the surface reads as coloured at a glance while the text
                   above it stays the body colour it is designed against —
                   exactly what every other tinted card in this product does. */
                backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-soft), var(--bg-surface))`,
              }}
            >
              <Icon
                className="mt-px size-4 shrink-0"
                style={{ color: `var(--${token})` }}
                strokeWidth={2.5}
                aria-hidden="true"
              />

              <p className="min-w-0 flex-1 text-caption text-text-primary">
                {item.text}
                {item.href && (
                  <>
                    {' '}
                    <Link
                      href={item.href as never}
                      onClick={() => dismiss(item.id)}
                      className="font-semibold text-text-brand underline hover:no-underline"
                    >
                      {item.linkLabel ?? 'View'}
                    </Link>
                  </>
                )}
              </p>

              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="-m-1 shrink-0 rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
