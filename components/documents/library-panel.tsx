'use client';

import * as React from 'react';
import { Download, ExternalLink, FileText, Search } from 'lucide-react';

import type { LibraryDocumentRow } from '@/lib/db/queries/library';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABEL,
  type LibraryCategory,
} from '@/lib/domain/library';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE COMPANY LIBRARY — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Whenever I want to see a document or all the packages or documentation related
 * to my own internal or our agency system, I will know that. For example if I want
 * to see packages with the name convention, I know that these are the packages'
 * PDFs and I click it. It gives me a proper PDF view… instead of downloading each
 * time."*
 *
 * ── ⚠️ VIEW AND DOWNLOAD ARE TWO DIFFERENT CONTROLS ──────────────────────────
 * The owner's complaint was that everything downloaded. So the title opens the
 * document INLINE in a new tab — the browser's own PDF viewer — and a separate
 * icon downloads it. A single control that did one or the other depending on file
 * type would be the same guessing game they are complaining about.
 *
 * For a design source (.ai, .eps) there is no viewer to open, so only the
 * download is offered. `isViewable` carries that from the database rather than
 * being re-derived from the mime type here.
 *
 * ── GROUPED BY CATEGORY, NOT BY UPLOAD DATE ──────────────────────────────────
 * "Show me the packages" is the question. Sorting by date answers "what arrived
 * most recently", which nobody asked.
 * ========================================================================= */

function size(bytes: number | null): string {
  if (bytes === null) return '';
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function LibraryPanel({
  documents,
}: {
  documents: readonly LibraryDocumentRow[];
}) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<LibraryCategory | 'all'>('all');

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (category !== 'all' && d.category !== category) return false;
      if (!needle) return true;
      /* The summary is searched as well as the title, because it is where "which
         document has which thing" actually lives — searching SPARK should find
         the booklet that describes it, not only a file with SPARK in its name. */
      return (
        d.title.toLowerCase().includes(needle) ||
        (d.summary ?? '').toLowerCase().includes(needle)
      );
    });
  }, [documents, query, category]);

  /* Only categories that have something in them. A filter chip that yields an
     empty list is a chip nobody should have been offered. */
  const present = LIBRARY_CATEGORIES.filter((c) => documents.some((d) => d.category === c));

  if (documents.length === 0) {
    return (
      <Card>
        <CardBody className="px-6 py-12 text-center">
          <p className="text-body-sm font-semibold text-text-primary">
            The library is empty
          </p>
          <p className="mx-auto mt-1 max-w-[36rem] text-caption text-text-secondary">
            This is where the division&rsquo;s own material lives — rate cards, package
            booklets, the corporate profile. Nothing to do with client uploads, which is what
            the other tabs are for.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a document, or search what is inside one…"
            aria-label="Search the library"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', ...present] as const).map((key) => {
            const on = key === category;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-micro font-semibold',
                  on
                    ? 'border-transparent bg-[image:var(--gradient-brand)] text-text-on-brand'
                    : 'border-border-subtle text-text-secondary hover:bg-bg-hover',
                )}
              >
                {key === 'all' ? 'Everything' : LIBRARY_CATEGORY_LABEL[key]}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-caption text-text-secondary">
          Nothing matches. Try a different word, or choose Everything.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((doc) => (
            <li key={doc.id}>
              <Card>
                <CardBody className="flex flex-wrap items-start gap-3 p-4">
                  <FileText
                    className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1 space-y-1">
                    {doc.isViewable ? (
                      /* ⚠️ A plain link with target=_blank, not a fetch: the whole
                         request is "open this in a tab", and the route answers with
                         Content-Disposition: inline so the browser's own viewer
                         takes over. */
                      <a
                        href={`/api/library/${doc.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-text-primary hover:text-text-brand hover:underline"
                      >
                        {doc.title}
                        <ExternalLink
                          className="h-3.5 w-3.5 shrink-0"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      </a>
                    ) : (
                      <p className="text-body-sm font-semibold text-text-primary">{doc.title}</p>
                    )}

                    <p className="text-micro text-text-tertiary">
                      {LIBRARY_CATEGORY_LABEL[doc.category]}
                      {doc.pageCount !== null && ` · ${doc.pageCount} pages`}
                      {doc.sizeBytes !== null && ` · ${size(doc.sizeBytes)}`}
                      {!doc.isViewable && ' · no preview — download to open'}
                    </p>

                    {doc.summary && (
                      <p className="text-caption text-text-secondary">{doc.summary}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Badge token="accent-primary" size="sm" variant="outline">
                      {LIBRARY_CATEGORY_LABEL[doc.category]}
                    </Badge>
                    <a
                      href={`/api/library/${doc.id}?download=1`}
                      title={`Download ${doc.title}`}
                      aria-label={`Download ${doc.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    >
                      <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                    </a>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
