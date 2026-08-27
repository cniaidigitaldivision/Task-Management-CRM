'use client';

import * as React from 'react';
import {
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  Filter as FilterIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';

import {
  deleteDocumentAction,
  pendingFileUrlAction,
  renameDocumentAction,
  type DocumentResult,
} from '@/app/actions/documents';
import type { DocumentRow } from '@/lib/db/queries/documents';
import { STORAGE_META, storageHome } from '@/lib/domain/document-storage';
import { extensionForMime } from '@/lib/domain/content-disposition';
import { FILE_KIND_LABEL, extensionOf, fileKind, type FileKind } from '@/lib/domain/file-kind';
import { relativeAge } from '@/lib/view/relative-age';
import { iconForFile, tintForFile } from '@/components/documents/file-icon';
import { FileTypeIcon, fileIconName } from '@/components/documents/file-type-icon';
import { StorageBadge } from '@/components/documents/storage-badge';
import { Avatar } from '@/components/ui/avatar';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THIS PROJECT'S FILES — A TABLE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24, with a mockup: *"I want this layout in the File tab exactly
 * as in the image but I want each and every thing properly implemented logically
 * and according to the project data… each and every button should be properly
 * working logically."*
 *
 * ── WHERE EACH COLUMN GETS ITS DATA ──────────────────────────────────────────
 *   Name + subtitle    `name`, and `FILE_KIND_LABEL` for the line under it
 *   Accepted / Waiting `state` — the approval decision (migration 025)
 *   In storage         `storageHome` — which store holds the bytes (048/051)
 *   Type pill          the extension, upper-cased, tinted by kind
 *   Size               `size_bytes`
 *   Added by           `uploaded_by_name` and their avatar
 *   Added on           `created_at`, the date over the time
 *   Actions            view · download · rename/delete
 *
 * ── ⚠️ TWO THINGS I DID NOT COPY FROM THE MOCKUP ────────────────────────────
 * Its footer reads *"Showing 1 to 5 of 2 files"* above five rows — a placeholder
 * that contradicts itself twice. The real numbers come from `usePagination`.
 *
 * Its filter chips are a fixed set (All files, Images, Documents, Presentations,
 * Spreadsheets, Text, Others). Here they are DERIVED from the files present, with
 * a count on each. That is the rule this codebase already follows for the library
 * categories and the register's Where control: a chip that can only ever yield
 * nothing is a control that can only disappoint.
 *
 * ── ⚠️ EVERY CONTROL DOES SOMETHING, WHICH IS THE PART THAT WAS ASKED FOR ────
 * The mockup draws a checkbox column, a Filter button, a sort control and a
 * grid/list pair. Rendering those as decoration would be worse than leaving them
 * out, so: the checkboxes drive a bulk bar, Filter narrows by approval and by
 * store, the headers sort, and the toggle switches to a real card grid.
 *
 * ── UPLOAD IS FOR EVERYBODY; RENAME AND DELETE ARE NOT ──────────────────────
 * `document.request` is `allow` for all four roles, so Add file is always there.
 * `canManage` is `document.manage` — Super Admin, Admin, Team Coordinator — and
 * gates the two verbs that change or destroy. Viewing is never gated: row-level
 * security already decided who may see the row, and a file list nobody can open is
 * not a file list.
 *
 * ── AND WHERE THE BYTES ARE ─────────────────────────────────────────────────
 * A file added HERE goes to the private bucket, never Drive — the dialog is opened
 * with `lockedDestination="bucket"`. That is a promise about uploads from this tab
 * and not about every row on it, so each row carries its own storage badge.
 * ========================================================================= */

/** ⚠️ Pinned locale AND zone. `toLocaleString` with neither renders "5/19/2025" on
 *  the server and "19/05/2025" in the browser, and React reports that as a
 *  hydration mismatch rather than as the ambiguity it is. Same rule as lib/now.ts.
 *  Built once at module scope — `Intl` formatters are expensive to construct and
 *  this one would otherwise be rebuilt for every cell in the table. */
const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Karachi',
});
const TIME = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Karachi',
});

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Images open in a modal, everything else in a tab — see `open`. */
const isImage = (mime: string | null, name: string) => fileKind(mime, name) === 'image';

/**
 * The pill beside the name — "PDF", "PPTX", "PNG".
 *
 * ── ⚠️ THREE SOURCES, IN ORDER, AND THE MIDDLE ONE IS NOT OPTIONAL ───────────
 * The filename first, because that is what the person sees. Then the MIME type,
 * because this division's own files are named "logo", "business Purposal" and
 * "Social Media Strategy" — no extensions at all — and a pill built from the
 * filename alone would read "Documents" where the mockup reads "PDF". Then the
 * kind label, for a file neither source can place.
 */
function typeLabel(doc: DocumentRow): string {
  const ext = extensionOf(doc.name) ?? extensionForMime(doc.mimeType);
  return ext ? ext.toUpperCase() : FILE_KIND_LABEL[fileKind(doc.mimeType, doc.name)];
}

type SortKey = 'name' | 'type' | 'size' | 'added';
type StateFilter = 'any' | 'approved' | 'pending' | 'rejected';
type WhereFilter = 'anywhere' | 'bucket' | 'drive';

const STATE_META: Record<
  DocumentRow['state'],
  { label: string; token: string; icon: typeof CheckCircle2 }
> = {
  approved: { label: 'Accepted', token: 'feedback-success', icon: CheckCircle2 },
  pending: { label: 'Waiting', token: 'feedback-warning', icon: Clock },
  rejected: { label: 'Refused', token: 'feedback-error', icon: XCircle },
};

const TH =
  'py-2.5 text-left text-micro font-semibold uppercase tracking-wide text-text-tertiary';

export function ProjectFilesTab({
  documents,
  projectName,
  canManage,
  nowMs,
  onUpload,
  onChanged,
}: {
  documents: readonly DocumentRow[];
  projectName: string;
  /** `document.manage` — Super Admin, Admin, Team Coordinator. Rename and delete. */
  canManage: boolean;
  /** Epoch milliseconds from the server, for the relative ages. See lib/now.ts. */
  nowMs: number;
  onUpload: () => void;
  onChanged: () => void;
}) {
  const [kind, setKind] = React.useState<FileKind | 'all'>('all');
  const [query, setQuery] = React.useState('');
  const [stateFilter, setStateFilter] = React.useState<StateFilter>('any');
  const [whereFilter, setWhereFilter] = React.useState<WhereFilter>('anywhere');
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({
    key: 'added',
    desc: true,
  });
  const [view, setView] = React.useState<'list' | 'grid'>('list');
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set());

  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<DocumentResult | null>(null);
  const [viewing, setViewing] = React.useState<{ name: string; url: string } | null>(null);
  const [renaming, setRenaming] = React.useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = React.useState<DocumentRow | null>(null);

  /* Only the kinds actually present, commonest first — see the header. */
  const kindsPresent = React.useMemo(() => {
    const seen = new Map<FileKind, number>();
    for (const doc of documents) {
      const k = fileKind(doc.mimeType, doc.name);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [documents]);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = documents.filter((doc) => {
      if (kind !== 'all' && fileKind(doc.mimeType, doc.name) !== kind) return false;
      if (stateFilter !== 'any' && doc.state !== stateFilter) return false;

      if (whereFilter !== 'anywhere') {
        const home = storageHome(doc);
        /* A file in BOTH stores matches either filter, on purpose — the same rule
           the Documents register uses. Hiding it from one would make the two
           filters add up to less than the whole list. */
        const inBucket = home === 'bucket' || home === 'both';
        const inDrive = home === 'drive' || home === 'both';
        if (whereFilter === 'bucket' && !inBucket) return false;
        if (whereFilter === 'drive' && !inDrive) return false;
      }

      if (!needle) return true;
      /* The description and the uploader too. "Which of these is the signed one"
         lives in the description, and searching names alone finds the wrong
         contract. */
      return (
        doc.name.toLowerCase().includes(needle) ||
        (doc.description ?? '').toLowerCase().includes(needle) ||
        (doc.uploadedByName ?? '').toLowerCase().includes(needle)
      );
    });

    const direction = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * direction;
        case 'type':
          return typeLabel(a).localeCompare(typeLabel(b)) * direction;
        case 'size':
          /* ⚠️ Nulls last whichever way it is sorted. "Unknown size" is not
             "smallest", and sorting it to the top of an ascending list would make
             a row with no size look like an empty file. */
          if (a.sizeBytes === null) return 1;
          if (b.sizeBytes === null) return -1;
          return (a.sizeBytes - b.sizeBytes) * direction;
        default:
          return a.createdAt.localeCompare(b.createdAt) * direction;
      }
    });
  }, [documents, kind, query, stateFilter, whereFilter, sort]);

  const pager = usePagination(visible, 10);

  /* ⚠️ DERIVED, NOT STORED. Keeping a "select all" boolean beside the set is two
     facts that can disagree: tick every row by hand and the header would stay
     empty. */
  const pageIds = pager.visible.map((d) => d.id);
  const allOnPagePicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const pickedDocs = visible.filter((d) => picked.has(d.id));

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const togglePage = () => {
    const next = new Set(picked);
    if (allOnPagePicked) for (const id of pageIds) next.delete(id);
    else for (const id of pageIds) next.add(id);
    setPicked(next);
  };

  /* Clicking a header sorts by it; clicking the same one again reverses. A NEW
     column starts descending only for the date, because "newest first" is the
     useful default there and "A first" is the useful default everywhere else. */
  const sortBy = (key: SortKey) =>
    setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : key === 'added' }));

  /* ── OPENING AND SAVING ───────────────────────────────────────────────────
     A signed URL is minted per click rather than rendered into the page: a URL in
     the markup is a URL in "view source" and in the browser history, and it
     outlives the session that was allowed to see it. */
  const open = async (doc: DocumentRow, download: boolean) => {
    if (doc.driveWebLink && !download) {
      window.open(doc.driveWebLink, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!doc.storagePath) {
      setNote({
        ok: false,
        error:
          doc.state === 'rejected'
            ? `${doc.name} was refused, so the file was deleted. Only the record and its reason are kept.`
            : `${doc.name} is in Google Drive — open it there.`,
      });
      return;
    }

    setBusy(doc.id);
    setNote(null);
    try {
      const result = await pendingFileUrlAction(doc.id, download);
      if (!result.ok) {
        setNote({ ok: false, error: result.error });
        return;
      }
      /* ⚠️ A download URL is signed with `?download=`, so navigating to it SAVES
         the file instead of showing it. No `download` attribute on an anchor —
         browsers ignore that cross-origin, which is exactly what this is. */
      if (!download && isImage(doc.mimeType, doc.name)) {
        setViewing({ name: doc.name, url: result.url });
      } else {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string, fn: () => Promise<DocumentResult>) => {
    setBusy(id);
    try {
      const result = await fn();
      setNote(result);
      if (result.ok) {
        setRenaming(null);
        setDeleting(null);
        /* ⚠️ Drop the selection. A deleted file left ticked would keep counting
           towards "3 selected" and towards a bulk download that would then fail. */
        setPicked(new Set());
        onChanged();
      }
    } catch {
      setNote({ ok: false, error: 'That could not be completed — the server did not answer.' });
    } finally {
      setBusy(null);
    }
  };

  /** ⚠️ CAPPED AT FIVE, AND IT SAYS SO. Each download opens a tab, and every
   *  browser blocks a burst of them — so twenty ticked files would silently
   *  produce five downloads and fifteen blocked popups. Better to do five and
   *  explain than to look broken. */
  const downloadPicked = async () => {
    const batch = pickedDocs.filter((d) => d.storagePath !== null).slice(0, 5);
    for (const doc of batch) await open(doc, true);
    if (pickedDocs.length > batch.length) {
      setNote({
        ok: true,
        message: `Started ${batch.length} of ${pickedDocs.length}. Browsers block a burst of downloads, so do the rest in batches.`,
      });
    }
    setPicked(new Set());
  };

  const filtersOn = stateFilter !== 'any' || whereFilter !== 'anywhere';

  return (
    <Card>
      <CardBody className="space-y-3 p-0">
        {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <p className="flex items-baseline gap-2">
            <span className="text-h3 text-text-primary">Files</span>
            <span className="text-caption text-text-tertiary">
              {documents.length} {documents.length === 1 ? 'file' : 'files'}
              {/* Only when a filter is actually hiding something — otherwise this
                  would say "2 files · 2 shown" forever. */}
              {visible.length !== documents.length && ` · ${visible.length} shown`}
            </span>
          </p>

          <Button variant="secondary" size="sm" onClick={onUpload}>
            <FileUp className="size-4" strokeWidth={2.25} aria-hidden="true" />
            Add file
          </Button>
        </div>

        {/* ══ THE FILTER ROW ══════════════════════════════════════════════════ */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 pb-3">
          <div className="flex flex-wrap items-center gap-1">
            <Chip active={kind === 'all'} onClick={() => setKind('all')}>
              All files
            </Chip>
            {kindsPresent.map(([k, count]) => (
              <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
                {FILE_KIND_LABEL[k]}
                <span className="tabular ml-1 text-micro opacity-70">{count}</span>
              </Chip>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative w-[12rem]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
                strokeWidth={2.25}
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files…"
                aria-label="Search this project's files"
                className="pl-9"
              />
            </div>

            <FilterMenu
              on={filtersOn}
              state={stateFilter}
              where={whereFilter}
              onState={setStateFilter}
              onWhere={setWhereFilter}
              onClear={() => {
                setStateFilter('any');
                setWhereFilter('anywhere');
              }}
            />

            <SortMenu current={sort} onSort={sortBy} />

            <div className="flex items-center rounded-lg border border-border-default p-0.5">
              <ViewButton
                active={view === 'grid'}
                label="Grid"
                icon={LayoutGrid}
                onClick={() => setView('grid')}
              />
              <ViewButton
                active={view === 'list'}
                label="List"
                icon={ListIcon}
                onClick={() => setView('list')}
              />
            </div>
          </div>
        </div>

        {note && (
          <p
            className="mx-4 rounded-lg px-3 py-2 text-caption"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
            }}
          >
            {note.error ?? note.message}
          </p>
        )}

        {/* ══ THE BULK BAR ════════════════════════════════════════════════════
            Only when something is ticked. A permanently visible bar of disabled
            buttons is what the checkbox column was added to avoid. */}
        {picked.size > 0 && (
          <div className="mx-4 flex flex-wrap items-center gap-2 rounded-lg bg-bg-selected px-3 py-2">
            <span className="text-caption font-semibold text-text-primary">
              {picked.size} selected
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void downloadPicked()}
            >
              <Download className="size-4" strokeWidth={2.25} aria-hidden="true" />
              Download
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {/* ══ THE ROWS ════════════════════════════════════════════════════════ */}
        {documents.length === 0 ? (
          <Empty projectName={projectName} onUpload={onUpload} />
        ) : visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-body-sm font-semibold text-text-primary">Nothing matches</p>
            <p className="mx-auto mt-1 max-w-[32rem] text-caption text-text-secondary">
              {documents.length} {documents.length === 1 ? 'file is' : 'files are'} filed against
              this project. Widen the type, clear the search, or reset the filter.
            </p>
          </div>
        ) : view === 'list' ? (
          /* ⚠️ `overflow-x-auto` on the wrapper and a `min-w` on the table. Seven
             columns do not fit a laptop at this page's width, and the alternative
             to scrolling the table is the whole PAGE scrolling sideways, which
             takes the sidebar with it. */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse">
              <thead>
                <tr className="border-y border-border-subtle bg-bg-surface-sunken">
                  <th scope="col" className="w-10 px-4 py-2.5">
                    <Tick
                      checked={allOnPagePicked}
                      onChange={togglePage}
                      label="Select every file on this page"
                    />
                  </th>
                  <SortHeader label="Name" sortKey="name" sort={sort} onSort={sortBy} />
                  <SortHeader label="Type" sortKey="type" sort={sort} onSort={sortBy} />
                  <SortHeader label="Size" sortKey="size" sort={sort} onSort={sortBy} />
                  <th scope="col" className={TH}>
                    Added by
                  </th>
                  <SortHeader label="Added on" sortKey="added" sort={sort} onSort={sortBy} />
                  <th scope="col" className={cn(TH, 'pr-4 text-right')}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {pager.visible.map((doc) => {
                  const Icon = iconForFile(doc.mimeType, doc.name);
                  const tint = tintForFile(doc.mimeType, doc.name);
                  const artwork = fileIconName(doc.mimeType, doc.name) !== null;
                  const state = STATE_META[doc.state];
                  const StateIcon = state.icon;
                  const openable = doc.storagePath !== null || doc.driveWebLink !== null;
                  const spinning = busy === doc.id;

                  return (
                    <tr
                      key={doc.id}
                      className={cn(
                        'border-b border-border-subtle last:border-0',
                        picked.has(doc.id) ? 'bg-bg-selected' : 'hover:bg-bg-hover',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Tick
                          checked={picked.has(doc.id)}
                          onChange={() => toggle(doc.id)}
                          label={`Select ${doc.name}`}
                        />
                      </td>

                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          {/* ── ⚠️ THE OWNER'S ARTWORK, WITH THE GLYPH AS THE FALLBACK ──────────
                              Owner: *"same these files icons in project individual page file tab"* —
                              the ten PNGs supplied for the Documents table, here too.
                          
                              Ten artworks do not cover every extension (see file-type-icon.tsx). An
                              .ai or a .psd has none, and relabelling the PDF artwork would put the
                              wrong badge on the row — so those keep the tinted lucide glyph this tab
                              already drew. Both occupy the same 40px box, so a mixed list does not
                              read as two designs stitched together. */}
                          {artwork ? (
                            <FileTypeIcon mimeType={doc.mimeType} name={doc.name} size={38} />
                          ) : (
                            <span
                              className="grid size-10 shrink-0 place-items-center rounded-lg"
                              style={{ backgroundColor: tint.wash }}
                            >
                              <Icon
                                className="size-5"
                                style={{ color: tint.ink }}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            </span>
                          )}
                          <div className="min-w-0">
                            {/* A button, not a div with a click handler: the name is
                                the primary way into the file, so it has to be
                                keyboard reachable and announced as something that
                                acts. */}
                            <button
                              type="button"
                              onClick={() => void open(doc, false)}
                              disabled={busy !== null || !openable}
                              className="block max-w-[20rem] truncate text-left text-body-sm font-semibold text-text-primary hover:text-text-brand hover:underline disabled:opacity-60 disabled:hover:no-underline"
                            >
                              {doc.name}
                            </button>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-micro text-text-tertiary">
                                {FILE_KIND_LABEL[fileKind(doc.mimeType, doc.name)]}
                              </span>
                              <span
                                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold"
                                /* The reason a refusal happened, on hover. It is the
                                   question people ask about a refused file and it has
                                   nowhere else to go in a table. */
                                title={
                                  doc.state === 'rejected' && doc.decisionReason
                                    ? `Refused: ${doc.decisionReason}`
                                    : undefined
                                }
                                style={{
                                  borderColor: `color-mix(in oklab, var(--${state.token}) 40%, transparent)`,
                                  backgroundColor: `color-mix(in oklab, var(--${state.token}) 10%, transparent)`,
                                  color: `var(--${state.token})`,
                                }}
                              >
                                <StateIcon
                                  className="size-3"
                                  strokeWidth={2.5}
                                  aria-hidden="true"
                                />
                                {state.label}
                              </span>
                              <StorageBadge document={doc} size="sm" />
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 pr-3">
                        <span
                          className="inline-block rounded-md px-2 py-1 text-micro font-bold tracking-wide"
                          style={{ backgroundColor: tint.wash, color: tint.ink }}
                        >
                          {typeLabel(doc)}
                        </span>
                      </td>

                      <td className="tabular py-3 pr-3 text-caption text-text-secondary">
                        {formatBytes(doc.sizeBytes)}
                      </td>

                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-2">
                          <Avatar
                            name={doc.uploadedByName ?? 'Unknown'}
                            src={doc.uploadedByAvatarUrl}
                            size="sm"
                          />
                          <span className="truncate text-caption text-text-secondary">
                            {doc.uploadedByName ?? 'Unknown'}
                          </span>
                        </span>
                      </td>

                      <td className="py-3 pr-3">
                        {doc.createdAt ? (
                          <span
                            className="block text-caption text-text-secondary"
                            title={relativeAge(doc.createdAt, nowMs) ?? undefined}
                          >
                            {DAY.format(new Date(doc.createdAt))}
                            <span className="block text-micro text-text-tertiary">
                              {TIME.format(new Date(doc.createdAt))}
                            </span>
                          </span>
                        ) : (
                          <span className="text-caption text-text-tertiary">—</span>
                        )}
                      </td>

                      <td className="py-3 pl-3 pr-4">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton
                            variant="ghost"
                            size="sm"
                            label={
                              openable ? `Open ${doc.name}` : `${doc.name} has no file to open`
                            }
                            icon={spinning ? Loader2 : doc.driveWebLink ? ExternalLink : Eye}
                            className={spinning ? '[&_svg]:animate-spin' : undefined}
                            disabled={busy !== null || !openable}
                            onClick={() => void open(doc, false)}
                          />
                          <IconButton
                            variant="ghost"
                            size="sm"
                            label={
                              doc.storagePath
                                ? `Download ${doc.name}`
                                : `${doc.name} is in Drive — download it there`
                            }
                            icon={Download}
                            disabled={busy !== null || doc.storagePath === null}
                            onClick={() => void open(doc, true)}
                          />
                          {canManage && (
                            <RowMenu
                              doc={doc}
                              onRename={() => setRenaming(doc)}
                              onDelete={() => setDeleting(doc)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* ══ GRID ══════════════════════════════════════════════════════════
             The same data laid out for scanning by shape rather than by column —
             worth having when a project is mostly images, which is why the toggle
             exists rather than being two icons that do nothing. */
          <div className="grid gap-3 px-4 sm:grid-cols-2 xl:grid-cols-3">
            {pager.visible.map((doc) => {
              const Icon = iconForFile(doc.mimeType, doc.name);
              const tint = tintForFile(doc.mimeType, doc.name);
              const artwork = fileIconName(doc.mimeType, doc.name) !== null;
              const state = STATE_META[doc.state];
              const openable = doc.storagePath !== null || doc.driveWebLink !== null;

              return (
                <div
                  key={doc.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border-2 p-3',
                    picked.has(doc.id)
                      ? 'border-[var(--border-brand-strong)] bg-bg-selected'
                      : 'border-border-subtle hover:border-[var(--border-brand-strong)]',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Tick
                      checked={picked.has(doc.id)}
                      onChange={() => toggle(doc.id)}
                      label={`Select ${doc.name}`}
                    />
                    {/* ── ⚠️ THE OWNER'S ARTWORK, WITH THE GLYPH AS THE FALLBACK ──────────
                        Owner: *"same these files icons in project individual page file tab"* —
                        the ten PNGs supplied for the Documents table, here too.
                    
                        Ten artworks do not cover every extension (see file-type-icon.tsx). An
                        .ai or a .psd has none, and relabelling the PDF artwork would put the
                        wrong badge on the row — so those keep the tinted lucide glyph this tab
                        already drew. Both occupy the same 40px box, so a mixed list does not
                        read as two designs stitched together. */}
                    {artwork ? (
                      <FileTypeIcon mimeType={doc.mimeType} name={doc.name} size={38} />
                    ) : (
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-lg"
                        style={{ backgroundColor: tint.wash }}
                      >
                        <Icon
                          className="size-5"
                          style={{ color: tint.ink }}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => void open(doc, false)}
                        disabled={busy !== null || !openable}
                        className="block w-full truncate text-left text-body-sm font-semibold text-text-primary hover:text-text-brand hover:underline disabled:opacity-60"
                      >
                        {doc.name}
                      </button>
                      <span className="text-micro text-text-tertiary">
                        {typeLabel(doc)} · {formatBytes(doc.sizeBytes)}
                      </span>
                    </div>
                    {canManage && (
                      <RowMenu
                        doc={doc}
                        onRename={() => setRenaming(doc)}
                        onDelete={() => setDeleting(doc)}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold"
                      style={{
                        borderColor: `color-mix(in oklab, var(--${state.token}) 40%, transparent)`,
                        backgroundColor: `color-mix(in oklab, var(--${state.token}) 10%, transparent)`,
                        color: `var(--${state.token})`,
                      }}
                    >
                      {state.label}
                    </span>
                    <StorageBadge document={doc} size="sm" />
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Avatar
                        name={doc.uploadedByName ?? 'Unknown'}
                        src={doc.uploadedByAvatarUrl}
                        size="xs"
                      />
                      <span className="truncate text-micro text-text-tertiary">
                        {doc.createdAt ? DAY.format(new Date(doc.createdAt)) : '—'}
                      </span>
                    </span>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`Download ${doc.name}`}
                      icon={Download}
                      disabled={busy !== null || doc.storagePath === null}
                      onClick={() => void open(doc, true)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ══ FOOTER ══════════════════════════════════════════════════════════
            The real numbers, from the pager. See the header for what the mockup
            said here. */}
        {visible.length > 0 && (
          <div className="border-t border-border-subtle px-4 py-3">
            <Pagination
              page={pager.page}
              pageCount={pager.pageCount}
              onPage={pager.setPage}
              from={pager.from}
              to={pager.to}
              total={pager.total}
              label="files"
            />
          </div>
        )}

        <p className="flex items-start gap-2 border-t border-border-subtle px-4 py-3 text-micro text-text-tertiary">
          <ShieldCheck className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            Anything added from this tab is held in this system&rsquo;s own private storage, not in
            Google Drive, and is served by a link that expires. Each badge above says which store
            that file is actually in.
          </span>
        </p>
      </CardBody>

      {/* ── THE IMAGE VIEWER ─────────────────────────────────────────────────
          Images only. A PDF gets the browser's native viewer in a tab, with search
          and page controls; a .pptx cannot be rendered in a page at all, so forcing
          either into an iframe produces a grey box. */}
      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="lg"
        title={viewing?.name ?? 'Image'}
      >
        {viewing && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element --
                A signed, expiring URL on a private bucket. `next/image` would proxy
                it through the optimiser, which both breaks when the signature
                expires and caches a private file. */}
            <img
              src={viewing.url}
              alt={viewing.name}
              className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
            />
          </div>
        )}
      </Dialog>

      <RenameDialog
        document={renaming}
        busy={busy !== null}
        onClose={() => setRenaming(null)}
        onRename={(name) => {
          if (renaming) void run(renaming.id, () => renameDocumentAction(renaming.id, name));
        }}
      />

      <DeleteDialog
        document={deleting}
        busy={busy !== null}
        onClose={() => setDeleting(null)}
        onDelete={() => {
          if (deleting) void run(deleting.id, () => deleteDocumentAction(deleting.id));
        }}
      />
    </Card>
  );
}

/* ---- Small pieces -------------------------------------------------------- */

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg px-2.5 py-1.5 text-caption font-semibold transition-colors duration-[120ms]',
        active
          ? 'bg-bg-selected text-text-brand'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/** A native checkbox, styled with `accent-color`. The browser already gets the
 *  keyboard behaviour, the focus ring and the screen-reader semantics right, and a
 *  hand-rolled one would have to re-earn all three. */
function Tick({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-4 cursor-pointer rounded accent-[var(--accent-primary)]"
    />
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const on = sort.key === sortKey;
  return (
    /* ⚠️ `aria-sort` goes on the `th`, not on the button — that is where a screen
       reader looks for it. The arrow is only the visual half of the same fact. */
    <th
      scope="col"
      className={TH}
      aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase',
          on ? 'text-text-brand' : 'hover:text-text-primary',
        )}
      >
        {label}
        <ArrowDownUp
          className={cn('size-3', !on && 'opacity-40')}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

function ViewButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} view`}
      className={cn(
        'grid size-7 place-items-center rounded-md',
        active ? 'bg-bg-selected text-text-brand' : 'text-text-tertiary hover:text-text-primary',
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
      <span className="sr-only">{label} view</span>
    </button>
  );
}

/* ⚠️ `<details>` rather than a hand-rolled popover — the same choice the rest of
   this codebase makes, for the same reasons: Escape closes it, the summary toggles
   it, and it is keyboard reachable, all from the browser with no state, no
   outside-click listener and no focus trap to get wrong. The one thing it does not
   do natively is close when an item is chosen, which is why `children` is given a
   `close` to call. */
function Popover({
  label,
  summary,
  children,
}: {
  label: string;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        title={label}
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5',
          'text-caption font-semibold text-text-secondary marker:content-none',
          'hover:bg-bg-hover hover:text-text-primary [&::-webkit-details-marker]:hidden',
        )}
      >
        {summary}
      </summary>
      {/* ⚠️ ONE CLICK HANDLER ON THE PANEL, NOT A `close` PASSED TO EVERY ITEM.
          It started as a render-prop — `children(close)` — and React's lint
          refused it: `close` dereferences `ref.current`, and handing that to a
          function DURING render is reading a ref during render as far as the rule
          can tell. It was also five callers each remembering to call it.

          Closing on any click inside the panel is both allowed (it is an event
          handler) and more correct: every control in here is a one-shot choice, so
          there is none that should leave the menu open. `onClick` bubbles from the
          buttons, so nothing needs to opt in.

          Not a keyboard trap either: Escape and re-pressing the summary are both
          handled by `<details>` itself, and a keyboard Enter on a button fires a
          click. */}
      <div
        onClick={() => ref.current?.removeAttribute('open')}
        className="absolute right-0 z-20 mt-1 w-[14rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]"
      >
        {children}
      </div>
    </details>
  );
}

const MENU_ITEM =
  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary';

const MENU_HEAD =
  'px-3 pb-1 pt-1.5 text-micro font-bold uppercase tracking-wide text-text-tertiary';

function FilterMenu({
  on,
  state,
  where,
  onState,
  onWhere,
  onClear,
}: {
  on: boolean;
  state: StateFilter;
  where: WhereFilter;
  onState: (next: StateFilter) => void;
  onWhere: (next: WhereFilter) => void;
  onClear: () => void;
}) {
  const STATES: ReadonlyArray<readonly [StateFilter, string]> = [
    ['any', 'Any'],
    ['approved', 'Accepted'],
    ['pending', 'Waiting'],
    ['rejected', 'Refused'],
  ];
  const WHERES: ReadonlyArray<readonly [WhereFilter, string]> = [
    ['anywhere', 'Anywhere'],
    ['bucket', STORAGE_META.bucket.filterLabel],
    ['drive', STORAGE_META.drive.filterLabel],
  ];

  return (
    <Popover
      label="Filter these files"
      summary={
        <>
          <FilterIcon className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Filter
          {/* A dot, not a count: it says "something is narrowing this" without
              implying a number that would then need explaining. */}
          {on && (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            />
          )}
        </>
      }
    >
      {(
        <>
          <p className={MENU_HEAD}>Approval</p>
          {STATES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                onState(value);
              }}
            >
              {label}
              {state === value && <span className="text-text-brand">✓</span>}
            </button>
          ))}

          <p className={cn(MENU_HEAD, 'mt-1 border-t border-border-subtle pt-2')}>Where it is</p>
          {WHERES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                onWhere(value);
              }}
            >
              {label}
              {where === value && <span className="text-text-brand">✓</span>}
            </button>
          ))}

          {on && (
            <button
              type="button"
              className={cn(MENU_ITEM, 'mt-1 border-t border-border-subtle font-semibold')}
              onClick={() => {
                onClear();
              }}
            >
              Clear the filter
            </button>
          )}
        </>
      )}
    </Popover>
  );
}

function SortMenu({
  current,
  onSort,
}: {
  current: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const LABEL: Record<SortKey, string> = {
    name: 'Name',
    type: 'Type',
    size: 'Size',
    added: 'Added on',
  };

  return (
    <Popover
      label="Sort these files"
      summary={
        <>
          <ArrowDownUp className="size-4" strokeWidth={2.25} aria-hidden="true" />
          <span className="hidden sm:inline">{LABEL[current.key]}</span>
          <ChevronDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        </>
      }
    >
      {(
        <>
          {(Object.keys(LABEL) as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                onSort(key);
              }}
            >
              {LABEL[key]}
              {current.key === key && (
                <span className="text-text-brand">{current.desc ? '↓' : '↑'}</span>
              )}
            </button>
          ))}
        </>
      )}
    </Popover>
  );
}

function RowMenu({
  doc,
  onRename,
  onDelete,
}: {
  doc: DocumentRow;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Popover
      label={`More for ${doc.name}`}
      summary={<MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />}
    >
      {(
        <>
          <button
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              onRename();
            }}
          >
            <span className="flex items-center gap-2">
              <Pencil className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Rename
            </span>
          </button>
          <button
            type="button"
            className={MENU_ITEM}
            style={{ color: 'var(--feedback-error)' }}
            onClick={() => {
              onDelete();
            }}
          >
            <span className="flex items-center gap-2">
              <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Delete
            </span>
          </button>
        </>
      )}
    </Popover>
  );
}

function Empty({ projectName, onUpload }: { projectName: string; onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span
        className="flex size-11 items-center justify-center rounded-full"
        style={{
          backgroundColor:
            'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
        }}
      >
        <FileUp className="size-5 text-text-brand" strokeWidth={1.9} aria-hidden="true" />
      </span>
      <p className="text-body-sm font-semibold text-text-primary">Nothing filed yet</p>
      <p className="max-w-[34rem] text-caption text-text-secondary">
        Contracts, briefs, raw footage and finished assets for{' '}
        <span className="font-semibold text-text-primary">{projectName}</span> belong here. Anything
        added is filed against this project, so everybody on it can find it.
      </p>
      <Button variant="secondary" size="sm" className="mt-1" onClick={onUpload}>
        <FileUp className="size-4" strokeWidth={2.25} aria-hidden="true" />
        Add the first file
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * RENAME
 * ⚠️ `key` on the form, not a `useEffect` syncing state to the prop. The dialog
 * stays mounted between openings, so without it the box would keep what was typed
 * for the LAST file — and somebody renaming two in a row would apply the first
 * name to the second.
 * ------------------------------------------------------------------------- */
function RenameDialog({
  document: doc,
  busy,
  onClose,
  onRename,
}: {
  document: DocumentRow | null;
  busy: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <Dialog open={doc !== null} onClose={onClose} size="sm" title={doc ? `Rename ${doc.name}` : ''}>
      {doc && (
        <RenameForm key={doc.id} document={doc} busy={busy} onClose={onClose} onRename={onRename} />
      )}
    </Dialog>
  );
}

function RenameForm({
  document: doc,
  busy,
  onClose,
  onRename,
}: {
  document: DocumentRow;
  busy: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = React.useState(doc.name);
  const trimmed = name.trim();
  const unchanged = trimmed === doc.name;

  return (
    /* A real form, so Enter submits. Renaming is a one-field job and reaching for
       the mouse to finish it is the friction that stops people tidying names. */
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && trimmed !== '' && !unchanged) onRename(trimmed);
      }}
      className="space-y-3"
    >
      <Field
        label="Name"
        htmlFor="rename-file"
        hint={
          doc.driveFileId
            ? 'This is the name in this register. The file in Google Drive keeps its own.'
            : 'What this file is called everywhere in the CRM.'
        }
      >
        <Input
          id="rename-file"
          value={name}
          autoFocus
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="md" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          type="submit"
          disabled={busy || trimmed === '' || unchanged}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save the name
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------------------
 * DELETE
 * ⚠️ A dialog, not `window.confirm`. The native one blocks the page, cannot name
 * the file, and cannot make the two cases distinguishable — which is the point:
 *   held here  the row goes AND the file is destroyed, unrecoverably
 *   in Drive   the row goes and the Drive file is untouched, deliberately
 * ------------------------------------------------------------------------- */
function DeleteDialog({
  document: doc,
  busy,
  onClose,
  onDelete,
}: {
  document: DocumentRow | null;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const inDriveOnly = doc !== null && doc.driveFileId !== null && doc.storagePath === null;

  return (
    <Dialog
      open={doc !== null}
      onClose={onClose}
      size="sm"
      title={doc ? `Delete ${doc.name}?` : ''}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" size="md" disabled={busy} onClick={onDelete}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {inDriveOnly ? 'Remove from the list' : 'Delete it'}
          </Button>
        </>
      }
    >
      {doc && (
        <div className="space-y-2">
          <p className="text-caption leading-relaxed text-text-secondary">
            {inDriveOnly ? (
              <>
                This takes <span className="font-semibold text-text-primary">{doc.name}</span> off
                this project&rsquo;s file list and out of the register. The file itself stays in
                Google Drive — nothing there is touched.
              </>
            ) : (
              <>
                This deletes <span className="font-semibold text-text-primary">{doc.name}</span> and
                the file with it. It cannot be undone, and nobody on this project will be able to
                open it again.
              </>
            )}
          </p>
          <p className="text-micro text-text-tertiary">
            The deletion is recorded in the audit log against your name.
          </p>
        </div>
      )}
    </Dialog>
  );
}
