'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

import { IconButton } from './button';

/* ============================================================================
 * DIALOG
 * ----------------------------------------------------------------------------
 * Built on the native `<dialog>` element rather than a div-and-portal, because
 * the platform already solves the four things a hand-rolled modal gets wrong:
 * the top layer (so it is never trapped under a `z-index` or an
 * `overflow: hidden` ancestor), the focus trap, `Escape` to close, and inert
 * background content for screen readers.
 *
 * What is NOT native and had to be added:
 *
 *   · CLOSING ON A BACKDROP CLICK. `::backdrop` is not an element, so it cannot
 *     receive a listener; the click lands on the <dialog> itself and something
 *     has to decide what that means. `useBackdropDismiss` below does, and its
 *     note records the two tests that look right and are not — one of which
 *     this file used until Session 23.
 *
 *   · SCROLL LOCK. An open dialog over a scrolling page lets the wheel scroll
 *     the page behind it, which reads as the modal being broken.
 *
 * ── WHY IT UNMOUNTS ITS CHILDREN WHEN CLOSED ─────────────────────────────────
 * `open ? children : null` rather than CSS. A create form that stays mounted
 * keeps whatever half-finished text was in it and shows that text the next time
 * the dialog opens — which looks like the application remembering something it
 * should have discarded.
 * ========================================================================= */

/* ============================================================================
 * ⚠️ THE PAGE THAT WENT BLACK AND WOULD NOT SCROLL — Session 20
 * ----------------------------------------------------------------------------
 * Owner report: *"I am resetting a password of some team member… the page gets
 * stuck, I can't scroll up or down and I don't see what happens… it's going
 * black… I have to switch tabs and come back and it's still there."*
 *
 * Reproduced on the Team screen. The reset itself worked perfectly — every
 * database step succeeded. Two separate defects in THIS file made it look like a
 * crash, and both were in the machinery every dialog in the application shares.
 *
 * ── 1. A RE-RENDER SILENTLY CLOSED THE DIALOG ────────────────────────────────
 * The open/close effect was keyed on `[open]`, so it only ran when that prop
 * changed. But `router.refresh()` re-renders the server tree, React reconciles,
 * and the <dialog> DOM node can be recreated — **a recreated node is not open**,
 * because `showModal()` state lives on the element, not in React.
 *
 * The result: `open` was still `true`, the panel's children were still in the
 * DOM, and `dialog.open` was `false`. Measured exactly that in the browser. So
 * the confirmation of what had just happened was rendered and invisible, which
 * is precisely "I don't see what happens".
 *
 * The effect now runs on EVERY render with no dependency array. It is two
 * boolean checks; making it cheap enough to run always is far better than
 * trying to enumerate everything that can invalidate a DOM node.
 *
 * ── 2. THE SCROLL LOCK WAS PER-DIALOG, SO TWO DIALOGS FOUGHT ─────────────────
 * Each dialog saved `document.body.style.overflow` on open and restored it on
 * close. With one dialog that is fine. `PersonActions` closes its confirmation
 * and opens its result dialog IN THE SAME COMMIT, and then the restore order
 * decides the outcome: if the second captured `previous` while the first still
 * held `hidden`, the page stayed locked after both had gone. Intermittent, which
 * is why it did not happen every time.
 *
 * It is now ONE reference-counted lock for the whole application. The body is
 * unlocked when the last dialog closes and not before, in any order.
 *
 * ── 3. AND IT CLOSES ITSELF ON UNMOUNT ───────────────────────────────────────
 * A dialog destroyed while open — which is what `router.refresh()` did here —
 * left the top layer to the browser to tidy. Now it always closes itself.
 * ========================================================================= */

let scrollLocks = 0;
let overflowBeforeFirstLock = '';

function lockBodyScroll(): () => void {
  if (scrollLocks === 0) {
    overflowBeforeFirstLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;

  let released = false;
  return () => {
    /* Guarded: React may run a cleanup twice in development's double-invoke, and
       a double decrement would unlock the page while a dialog is still open. */
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = overflowBeforeFirstLock;
  };
}

/* ============================================================================
 * ⚠️ CLOSING ON A BACKDROP CLICK — THREE WAYS TO GET IT WRONG
 * ----------------------------------------------------------------------------
 * `::backdrop` is not an element and cannot take a listener, so the click lands
 * on the `<dialog>` itself and the component has to decide what it means. Both
 * of the obvious tests are wrong, each in its own direction:
 *
 * ── HIT-TESTING THE COORDINATES (what this used to do) ───────────────────────
 * Compare clientX/clientY against the panel's bounding box, close if outside.
 * Reads correctly, and breaks for every click that has no position:
 *
 *   · A button activated with the KEYBOARD — Space or Enter — fires a click
 *     with clientX = clientY = 0. That is outside every panel, so **every
 *     keyboard user closed the dialog the moment they activated any control
 *     inside it.** Found in Session 23 by a programmatic `.click()`, which has
 *     the same signature.
 *
 * ── `event.target === dialog` alone ──────────────────────────────────────────
 * Fixes the keyboard case and reintroduces the one the original author had
 * already hit: a native `<select>` renders its option list outside the DOM, and
 * the click that dismisses it can report the dialog as its target. The project
 * form has six selects; choosing a type would close the form.
 *
 * ── WHAT ACTUALLY WORKS: REQUIRE BOTH HALVES OF THE GESTURE ─────────────────
 * A real backdrop click presses AND releases on the dialog element. Nothing
 * else does:
 *
 *   keyboard activation   no pointerdown at all            → does not close
 *   select option list    pointerdown was on the <select>  → does not close
 *   drag out of the panel pointerdown was inside it        → does not close
 *   genuine backdrop      both on the dialog               → closes
 *
 * No geometry, and no way for a click without a position to be mistaken for one
 * outside the panel.
 * ========================================================================= */
function useBackdropDismiss(onClose: () => void) {
  /* A ref, not a closure variable. These handlers are spread into JSX, so a
     plain variable would be re-created on every render — and any re-render
     landing between the pointerdown and the click would lose the first half of
     the gesture and stop the dialog closing at all. */
  const pressedOnBackdrop = React.useRef(false);

  return {
    onPointerDown: (event: React.PointerEvent<HTMLDialogElement>) => {
      pressedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent<HTMLDialogElement>) => {
      if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
      pressedOnBackdrop.current = false;
    },
  };
}

/** Keeps the native `<dialog>` in step with React, and the body lock honest. */
function useModal(open: boolean, ref: React.RefObject<HTMLDialogElement | null>) {
  /* NO dependency array, deliberately — see note 1 above. */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });

  /* Separate effect, because this one genuinely only fires on an open/close. */
  React.useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  React.useEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.open) el.close();
    };
  }, [ref]);
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  header,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  /** Always required: it is the dialog's accessible name even when `header`
   *  replaces the visible title. */
  title: string;
  description?: string;
  /**
   * Replaces the default title block, keeping the row and its close button.
   *
   * ⚠️ For a header that has to carry more than words — a brand mark, a status
   * chip — NOT for a different layout. The close button, the padding and the
   * border stay where they are, so every dialog in the app still shuts in the
   * same place. `title` is still required and still names it for a screen
   * reader.
   */
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  useModal(open, ref);
  const dismiss = useBackdropDismiss(onClose);

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const;

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        // Escape fires `cancel`; let React own the open state rather than the DOM.
        event.preventDefault();
        onClose();
      }}
      {...dismiss}
      aria-label={title}
      className={cn(
        'm-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--bg-scrim)] backdrop:backdrop-blur-sm',
        'open:flex open:items-end open:justify-center sm:open:items-center',
      )}
    >
      {open && (
        <div
          className={cn(
            /* Divided by the density scale for the same reason as the auth
               layout: `dvh` ignores the `zoom` on body, so a plain 92dvh would
               cap this at 83% of the window instead of 92%. */
            'flex max-h-[calc(92dvh/var(--ui-scale))] w-full flex-col overflow-hidden rounded-t-2xl border border-border-default',
            'bg-bg-surface shadow-[var(--shadow-xl)] sm:rounded-2xl',
            widths[size],
          )}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-4">
            <div className="min-w-0 flex-1">
              {header ?? (
                <>
                  <h2 className="text-h3 text-text-primary">{title}</h2>
                  {description && (
                    <p className="mt-0.5 text-caption text-text-secondary">{description}</p>
                  )}
                </>
              )}
            </div>
            <IconButton label="Close" icon={X} size="sm" onClick={onClose} className="-mr-1" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-bg-surface-sunken px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Drawer — the same machinery, anchored right. Used for task detail, where a
 * full-page navigation would lose the board's scroll position and its filters.
 * ------------------------------------------------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  useModal(open, ref);
  const dismiss = useBackdropDismiss(onClose);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      {...dismiss}
      aria-label={title}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--bg-scrim)] backdrop:backdrop-blur-sm open:flex open:justify-end"
    >
      {open && (
        <div
          className="flex h-full w-full flex-col overflow-hidden border-l border-border-default bg-bg-surface shadow-[var(--shadow-xl)] sm:max-w-xl lg:max-w-2xl"
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-h3 text-text-primary">{title}</h2>
              {subtitle && <div className="mt-1">{subtitle}</div>}
            </div>
            <IconButton label="Close" icon={X} size="sm" onClick={onClose} className="-mr-1" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-border-subtle bg-bg-surface-sunken px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
