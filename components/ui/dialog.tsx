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
 *     receive a listener. The click lands on the <dialog> itself, and the test
 *     below distinguishes "clicked the backdrop" from "clicked inside the panel"
 *     by hit-testing the click against the panel's own rectangle. A naive
 *     `event.target === dialog` check breaks the moment a `<select>` is used,
 *     because the native option list reports the dialog as its target.
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

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const;

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        // Escape fires `cancel`; let React own the open state rather than the DOM.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const panel = panelRef.current;
        if (!panel) return;
        const r = panel.getBoundingClientRect();
        const inside =
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom;
        if (!inside) onClose();
      }}
      aria-label={title}
      className={cn(
        'm-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--bg-scrim)] backdrop:backdrop-blur-sm',
        'open:flex open:items-end open:justify-center sm:open:items-center',
      )}
    >
      {open && (
        <div
          ref={panelRef}
          className={cn(
            'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border-default',
            'bg-bg-surface shadow-[var(--shadow-xl)] sm:rounded-2xl',
            widths[size],
          )}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-h3 text-text-primary">{title}</h2>
              {description && (
                <p className="mt-0.5 text-caption text-text-secondary">{description}</p>
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
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const panel = panelRef.current;
        if (!panel) return;
        const r = panel.getBoundingClientRect();
        const inside =
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom;
        if (!inside) onClose();
      }}
      aria-label={title}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--bg-scrim)] backdrop:backdrop-blur-sm open:flex open:justify-end"
    >
      {open && (
        <div
          ref={panelRef}
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
