'use client';

import * as React from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';

import { crmDocumentLinkAction } from '@/app/actions/crm-documents';

/* ============================================================================
 * ONE WAY TO LOOK AT A DOCUMENT — the knowledge page and the drawer's Files
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"The View part in Quotation is perfect. Make them visible
 * in Files also. The view of the file will also be the same."*
 *
 * A PDF is shown in place, an image is shown as an image, and anything else
 * says what it is and opens in a new tab — the browser cannot draw a Word file.
 *
 * ⚠️ A SHORT-LIVED LINK, FETCHED WHEN IT IS NEEDED. The bucket is private; the
 * link is signed for this one file, read back under the viewer's own access
 * (crmDocumentLinkAction), so a preview can never show a file they could not
 * open anyway.
 * ========================================================================= */

export function DocumentPreview({
  documentId,
  mime,
  title,
  className,
}: {
  documentId: string;
  mime: string;
  title: string;
  className?: string;
}) {
  const [link, setLink] = React.useState<{ id: string; url: string | null; error: string | null } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void crmDocumentLinkAction(documentId).then((r) => {
      if (alive) setLink({ id: documentId, url: r.url ?? null, error: r.url ? null : (r.error ?? 'That file could not be opened.') });
    });
    return () => {
      alive = false;
    };
  }, [documentId]);

  /* ⚠️ "Loading…" UNTIL THIS FILE'S LINK ARRIVES — never the previous file's
     preview under the new file's name. */
  const ready = link && link.id === documentId ? link : null;
  const box = className ?? 'h-[26rem]';

  if (!ready) {
    return (
      <div className={`${box} grid place-items-center rounded-xl border border-border-subtle bg-bg-subtle/40`}>
        <span className="inline-flex items-center gap-2 text-caption text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening {title}…
        </span>
      </div>
    );
  }
  if (!ready.url) {
    return (
      <div className={`${box} grid place-items-center rounded-xl border border-border-subtle p-4 text-center text-caption text-text-secondary`}>
        {ready.error}
      </div>
    );
  }

  const kind = mime.split(';')[0].trim().toLowerCase();
  return (
    <div className="space-y-2">
      {kind === 'application/pdf' ? (
        <iframe
          src={`${ready.url}#toolbar=0&navpanes=0`}
          title={title}
          className={`${box} w-full rounded-xl border border-border-subtle bg-white`}
        />
      ) : kind.startsWith('image/') ? (
        /* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL; next/image would try to optimise it */
        <img src={ready.url} alt={title} className={`${box} w-full rounded-xl border border-border-subtle object-contain`} />
      ) : (
        <div className={`${box} grid place-items-center rounded-xl border border-border-subtle bg-bg-subtle/40 p-4 text-center`}>
          <span>
            <FileText className="mx-auto size-8 text-text-secondary" aria-hidden="true" />
            <span className="mt-2 block text-caption text-text-secondary">This kind of file cannot be shown here.</span>
          </span>
        </div>
      )}
      <a
        href={ready.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand underline-offset-2 hover:underline"
      >
        <ExternalLink className="size-3.5" aria-hidden="true" /> Open in a new tab
      </a>
    </div>
  );
}
