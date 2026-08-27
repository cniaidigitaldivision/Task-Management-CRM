'use client';

import * as React from 'react';
import { Download, ExternalLink, Search } from 'lucide-react';

import type { LibraryDocumentRow } from '@/lib/db/queries/library';
import { LIBRARY_CATEGORY_LABEL, type LibraryCategory } from '@/lib/domain/library';
import { cn } from '@/lib/utils';

import { FileTypeIcon, fileIconName } from './file-type-icon';
import { formatFileSize } from './file-viewer';

/* ============================================================================
 * THE COMPANY LIBRARY — the owner's layout
 * ----------------------------------------------------------------------------
 * *"I want this same UI that I have here in your screenshot. You properly implement
 * everything logically, each and every button, and each and every icon."*
 *
 * A search box, a row of category chips, and a row per document: a preview panel,
 * the title and its summary, a category badge, the file type, the page count, and
 * two controls — open and download.
 *
 * ── ⚠️ VIEW AND DOWNLOAD ARE TWO SEPARATE CONTROLS ──────────────────────────
 * This was the owner's original complaint about this tab: *"It gives me a proper
 * PDF view… instead of downloading each time."* So the title and the open button
 * show the document inline in a new tab, and a distinct button downloads it. One
 * control that did either depending on file type is the guessing game they were
 * complaining about.
 *
 * For a design source (.ai, .eps) there is no viewer to open, so only download is
 * offered. `isViewable` carries that from the database rather than being
 * re-derived from the mime type here.
 *
 * ── ⚠️ THE PREVIEW PANEL IS THE FILE-TYPE ARTWORK, NOT A PAGE THUMBNAIL ─────
 * The drawing shows two rendered page previews per row. There is no thumbnail
 * anywhere in `library_documents` — the columns are id, title, category,
 * storage_path, mime_type, size_bytes, summary, page_count, is_viewable,
 * uploaded_by_id, created_at, updated_at — and producing one means rasterising a
 * PDF page, which needs a renderer this project does not carry.
 *
 * So the slot holds the file-type artwork on a tinted ground: honest, and it reads
 * as a deliberate panel rather than a broken image. Two empty frames would look
 * like thumbnails that failed to load, which is worse than not claiming to have
 * them. Real thumbnails are a separate piece of work — a PDF renderer, a place to
 * store the output, and a job to generate it on upload.
 *
 * ── ⚠️ THE CHIPS ARE BUILT FROM THE DOCUMENTS, NOT FROM THE ENUM ────────────
 * `LIBRARY_CATEGORIES` has seven entries; the library holds four of them today.
 * Offering all seven would give three chips that always return nothing, which
 * teaches people the filters are unreliable. Same rule as every other filter on
 * this screen.
 * ========================================================================= */

const ALL = '__all__';

export function LibraryPanel({ documents }: { documents: readonly LibraryDocumentRow[] }) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<LibraryCategory | typeof ALL>(ALL);

  /* Only the categories actually present, in the order the enum declares them so
     the chips do not reshuffle as the library grows. */
  const present = React.useMemo(() => {
    const seen = new Set<LibraryCategory>();
    for (const doc of documents) seen.add(doc.category);
    return [...seen].sort((a, b) =>
      LIBRARY_CATEGORY_LABEL[a].localeCompare(LIBRARY_CATEGORY_LABEL[b]),
    );
  }, [documents]);

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((doc) => {
      if (category !== ALL && doc.category !== category) return false;
      if (!needle) return true;
      /* The summary is searched as well as the title — somebody looking for "rate
         card" should find the booklet whose summary mentions rates. */
      return `${doc.title} ${doc.summary ?? ''}`.toLowerCase().includes(needle);
    });
  }, [documents, query, category]);

  return (
    <div className="space-y-3">
      {/* ---- Search ---------------------------------------------------------- */}
      <div className="relative max-w-[26rem]">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search company library…"
          aria-label="Search the company library"
          className={cn(
            'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
            'text-body-sm text-text-primary placeholder:text-text-tertiary',
            'focus-visible:border-border-brand focus-visible:outline-none',
          )}
        />
      </div>

      {/* ---- Category chips -------------------------------------------------- */}
      <div role="radiogroup" aria-label="Category" className="flex flex-wrap items-center gap-1.5">
        <Chip on={category === ALL} onClick={() => setCategory(ALL)}>
          Everything
        </Chip>
        {present.map((key) => (
          <Chip key={key} on={category === key} onClick={() => setCategory(key)}>
            {LIBRARY_CATEGORY_LABEL[key]}
          </Chip>
        ))}
      </div>

      {/* ---- Rows ------------------------------------------------------------ */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        {shown.map((doc, index) => (
          <Row key={doc.id} doc={doc} first={index === 0} />
        ))}

        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-body-sm text-text-secondary">
            {documents.length === 0
              ? 'The library is empty.'
              : `Nothing matches ${query ? `“${query}”` : 'that category'}.`}
          </p>
        )}
      </div>

      {shown.length > 0 && (
        <p className="text-caption text-text-secondary">
          {shown.length === documents.length
            ? `${documents.length} document${documents.length === 1 ? '' : 's'}`
            : `${shown.length} of ${documents.length} documents`}
        </p>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full px-3.5 text-caption font-semibold',
        'transition-[background-color,color,border-color] duration-[120ms]',
        /* ⚠️ The active chip is FILLED, not outlined. The drawing fills it, and it
           is the same lesson the platform filters taught: an outlined chip among
           outlined chips has to be hunted for. */
        on
          ? 'bg-accent-primary text-text-on-brand'
          : 'border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function Row({ doc, first }: { doc: LibraryDocumentRow; first: boolean }) {
  const artwork = fileIconName(doc.mimeType, doc.title) !== null;
  const viewHref = `/api/library/${doc.id}`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4 px-4 py-3.5 hover:bg-bg-hover',
        !first && 'border-t border-border-subtle',
      )}
    >
      {/* The preview panel. See the header on why this is the file-type artwork
          rather than a page thumbnail. */}
      <div
        aria-hidden="true"
        className="grid h-[4.5rem] w-[7rem] shrink-0 place-items-center rounded-lg border border-border-subtle"
        style={{ backgroundColor: 'var(--bg-subtle)' }}
      >
        {artwork ? (
          <FileTypeIcon mimeType={doc.mimeType} name={doc.title} size={40} />
        ) : (
          <span className="text-micro font-bold uppercase tracking-wide text-text-tertiary">
            {doc.mimeType.split('/').pop()?.slice(0, 8) ?? 'file'}
          </span>
        )}
      </div>

      {/* Title and summary. The title is a link when there is something to open —
          the owner's whole point about this tab. */}
      <div className="min-w-0 flex-1 basis-[16rem]">
        {doc.isViewable ? (
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-body font-semibold text-text-primary hover:underline"
            title={doc.title}
          >
            {doc.title}
          </a>
        ) : (
          <p className="truncate text-body font-semibold text-text-primary" title={doc.title}>
            {doc.title}
          </p>
        )}
        {doc.summary && (
          <p className="mt-0.5 line-clamp-2 text-caption text-text-secondary">{doc.summary}</p>
        )}
      </div>

      {/* Category */}
      <span
        className="shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold"
        style={{
          backgroundColor: `color-mix(in oklab, var(--${CATEGORY_TOKEN[doc.category]}) 14%, transparent)`,
          color: `var(--${CATEGORY_TOKEN[doc.category]})`,
        }}
      >
        {LIBRARY_CATEGORY_LABEL[doc.category]}
      </span>

      {/* File type — the artwork again, small, beside its name. */}
      <span className="flex w-[5.5rem] shrink-0 items-center gap-1.5">
        {artwork && <FileTypeIcon mimeType={doc.mimeType} name={doc.title} size={18} />}
        <span className="text-caption font-medium text-text-secondary">
          {(fileIconName(doc.mimeType, doc.title) ?? 'file').toUpperCase()}
        </span>
      </span>

      {/* ⚠️ Pages where the database knows, SIZE where it does not. `page_count` is
          null for anything that is not paginated, and "— pages" is a worse answer
          than the one fact that is always available. */}
      <span className="w-[5rem] shrink-0 text-caption text-text-secondary">
        {doc.pageCount !== null
          ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`
          : formatFileSize(doc.sizeBytes)}
      </span>

      {/* Open and download */}
      <span className="flex shrink-0 items-center gap-1.5">
        {doc.isViewable ? (
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${doc.title}`}
            title="Open in a new tab"
            className="grid size-9 place-items-center rounded-lg border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
          >
            <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
          </a>
        ) : (
          /* ⚠️ Disabled rather than absent, so the row keeps its shape and the
             reason is on the tooltip. A design source has no browser viewer — that
             is a fact about the file, not a missing feature. */
          <span
            aria-hidden="true"
            title="No browser can display this file — download it instead"
            className="grid size-9 place-items-center rounded-lg border border-border-subtle text-text-disabled"
          >
            <ExternalLink className="size-4" strokeWidth={2.25} />
          </span>
        )}

        <a
          href={`${viewHref}?download=1`}
          aria-label={`Download ${doc.title}`}
          title={`Download — ${formatFileSize(doc.sizeBytes)}`}
          className="grid size-9 place-items-center rounded-lg border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
        >
          <Download className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </a>
      </span>
    </div>
  );
}

/**
 * A colour per category.
 *
 * ⚠️ Semantic tokens rather than a hand-picked palette, and one hue per category
 * so the badge is learnable — after a week nobody reads "Package detail", they
 * recognise the blue. Design source takes the grey deliberately: it is the one
 * category that cannot be opened, and a muted badge is a second signal for that
 * alongside the disabled open button.
 */
const CATEGORY_TOKEN: Readonly<Record<LibraryCategory, string>> = {
  package_card: 'accent-gold',
  package_detail: 'status-todo',
  rate_card: 'status-done',
  booklet: 'status-progress',
  deck: 'status-review',
  design_source: 'status-backlog',
  other: 'status-cancelled',
};
