'use client';

import * as React from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

import { paymentProofUrlAction, proofUrlAction } from '@/app/actions/finance';
import { receiptUrlAction } from '@/app/actions/finance';
import { Dialog } from '@/components/ui/dialog';

/* ============================================================================
 * LOOKING AT THE EVIDENCE, WITHOUT LEAVING THE LEDGER
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"The proof you are seeing should display the image in a
 * pop-up, right? Don't bring me to another page."*
 *
 * ── ⚠️ WHY `window.open` WAS THE WRONG ANSWER, BEYOND THE OWNER DISLIKING IT ─
 * The three tables previously opened a signed URL in a new tab. That loses the
 * reader's place in a paginated ledger, it is silently swallowed by popup
 * blockers on the second click of a session, and — the part that actually
 * matters — it hands a raw signed URL to a browser tab, where it sits in
 * history and can be pasted anywhere until it expires. A dialog shows the image
 * and the link never leaves the page.
 *
 * ── ⚠️ THE MIME TYPE COMES FROM THE DATABASE, NOT FROM THE URL ─────────────
 * A signed Supabase URL ends in a query string, so `url.endsWith('.png')` is
 * false for every image this will ever show. Worse, screenshots are frequently
 * uploaded with no extension at all. `paymentProofUrlAction` returns the stored
 * `proof_mime` for exactly this decision.
 *
 * ── ⚠️ ONE COMPONENT FOR ALL THREE KINDS OF EVIDENCE ───────────────────────
 * Expense receipts, an old invoice-level proof, and a payment's own proof are
 * fetched by three different actions and are the same thing to a reader. One
 * component means the pop-up cannot behave differently depending on which
 * table somebody happened to click in.
 * ========================================================================= */

export type ProofKind = 'expense' | 'payment' | 'invoice';

export interface ProofTarget {
  readonly kind: ProofKind;
  readonly id: string;
  /** Shown while the link is being signed, so the dialog is never nameless. */
  readonly title: string;
  readonly caption?: string;
}

interface Loaded {
  readonly url: string;
  readonly name: string | null;
  readonly mime: string | null;
}

export function ProofViewer({
  target,
  onClose,
}: {
  target: ProofTarget | null;
  onClose: () => void;
}) {
  /* ⚠️ One state object stamped with WHICH proof it belongs to, so a slow reply
     for the row somebody clicked first can never paint over the row they
     clicked second. The same shape `person-activity.tsx` uses, and for the same
     reason — a `cancelled` flag alone does not survive a fast switch between
     two open targets. */
  const [loaded, setLoaded] = React.useState<
    { forId: string; result: Loaded | null; error: string | null } | null
  >(null);

  const id = target?.id ?? null;
  const kind = target?.kind ?? null;

  React.useEffect(() => {
    if (id === null || kind === null) return;

    let cancelled = false;

    const fetchUrl = async () => {
      if (kind === 'payment') return paymentProofUrlAction(id);
      if (kind === 'expense') {
        const r = await receiptUrlAction(id);
        return r.ok ? { ok: true as const, url: r.url, name: null, mime: null } : r;
      }
      const r = await proofUrlAction(id);
      return r.ok ? { ok: true as const, url: r.url, name: null, mime: null } : r;
    };

    void fetchUrl().then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok
          ? { forId: id, result: { url: result.url, name: result.name, mime: result.mime }, error: null }
          : { forId: id, result: null, error: result.error },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [id, kind]);

  if (target === null) return null;

  const ready = loaded !== null && loaded.forId === target.id ? loaded : null;

  /* ⚠️ Falls back to treating it as an image when the type is unknown. The old
     invoice-level proofs predate the mime column entirely, and an `<img>` that
     fails to load still shows its alt text and the download link below —
     whereas defaulting to "not previewable" would hide a perfectly good
     screenshot behind a button. */
  const isImage =
    ready?.result !== null && ready?.result !== undefined
      ? ready.result.mime === null || ready.result.mime.startsWith('image/')
      : false;
  const isPdf = ready?.result?.mime === 'application/pdf';

  return (
    <Dialog
      open
      onClose={onClose}
      title={target.title}
      description={target.caption}
      size="md"
    >
      <div className="space-y-3">
        {ready === null && (
          <p className="flex items-center justify-center gap-2 py-16 text-caption text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Fetching the file…
          </p>
        )}

        {ready?.error && (
          <p className="py-12 text-center text-caption" style={{ color: 'var(--feedback-error)' }}>
            {ready.error}
          </p>
        )}

        {ready?.result && (
          <>
            {isImage && (
              /* ⚠️ A plain <img>, not next/image. The source is a short-lived
                 signed URL on a host the optimiser is not configured for, and
                 routing a private receipt through an image CDN would cache it
                 outside the bucket's own access control. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ready.result.url}
                alt={target.caption ?? target.title}
                className="max-h-[62vh] w-full rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken object-contain"
              />
            )}

            {isPdf && (
              <iframe
                src={ready.result.url}
                title={target.title}
                className="h-[62vh] w-full rounded-[var(--radius-md)] border border-border-subtle"
              />
            )}

            {!isImage && !isPdf && (
              <p className="flex flex-col items-center gap-2 py-12 text-caption text-text-secondary">
                <FileText className="h-8 w-8 text-text-tertiary" aria-hidden="true" />
                {ready.result.name ?? 'This file'} cannot be shown here.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
              <p className="min-w-0 truncate text-micro text-text-tertiary">
                {ready.result.name ?? 'Attached file'}
              </p>
              {/* ⚠️ `rel="noopener noreferrer"` on a signed URL: without
                  `noopener` the opened page gets a handle on this window, and
                  without `noreferrer` the storage host is told which screen the
                  reader came from. */}
              <a
                href={ready.result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Open the original
              </a>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
