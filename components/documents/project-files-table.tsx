'use client';

import * as React from 'react';
import {
  Download,
  ExternalLink,
  Eye,
  MoreVertical,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import type { DocumentRow } from '@/lib/db/queries/documents';
import { PROJECT_ROLE_LABEL, PROJECT_TYPE_META, type ProjectType } from '@/lib/domain/constants';
import { FILE_KIND_LABEL, FILE_KINDS, fileKind, type FileKind } from '@/lib/domain/file-kind';
import { Avatar } from '@/components/ui/avatar';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { formatFileSize } from './file-viewer';
import { iconForFile, tintForFile, type KindTint } from './file-icon';
import { FileTypeIcon, fileIconName } from './file-type-icon';
import { StorageBadge } from './storage-badge';

/* ============================================================================
 * PROJECT FILES — the owner's layout
 * ----------------------------------------------------------------------------
 * A search box, four filters, an Upload split button, and a table: File name with
 * its type icon and version, File type, Project, Uploaded by, Last modified,
 * Storage status, File size, and a row menu. Then a result count, a per-page
 * selector and a pager.
 *
 * ── ⚠️ THE VERSION IS COUNTED, NOT INVENTED ─────────────────────────────────
 * The drawing shows "v1.2", "v2.0" under each name. There is no version column
 * anywhere in this schema, and printing a decimal version on a row that has no
 * such number would be a made-up fact rendered as data.
 *
 * What IS real is the upload history: filing "Project Plan" into GC Royal three
 * times is three rows, and the third is version 3. So `listDocuments` counts them
 * with a window function and this shows whole numbers — v1, v2, v3 — plus "current"
 * where a name has more than one. A major.minor scheme would need somebody to
 * declare which uploads are minor, which is a feature and not a label.
 *
 * ── WHY EVERY FILTER IS BUILT FROM THE ROWS IN HAND ─────────────────────────
 * A dropdown of every project offers forty options, thirty-eight of which return
 * nothing. Projects, file types and owners are all derived from the documents the
 * reader can actually see, so no option leads to an empty table — the same rule
 * the library panel's category chips follow.
 * ========================================================================= */

const ALL = '__all__';
const UNFILED = '__unfiled__';
const PAGE_SIZES = [10, 25, 50] as const;

export function ProjectFilesTable({
  documents,
  nowMs,
  onUpload,
  onView,
  busyId,
}: {
  documents: readonly DocumentRow[];
  /** The server's clock, for the date labels. See lib/now.ts. */
  nowMs: number;
  onUpload: () => void;
  /** Opens the file — the panel owns the signed-URL round trip. */
  onView: (doc: DocumentRow, mode: 'view' | 'download') => void;
  busyId: string | null;
}) {
  const [query, setQuery] = React.useState('');
  const [projectId, setProjectId] = React.useState(ALL);
  const [kind, setKind] = React.useState<FileKind | typeof ALL>(ALL);
  const [ownerId, setOwnerId] = React.useState(ALL);
  const [latestOnly, setLatestOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(PAGE_SIZES[0]);

  /* ---- The filter options, from the rows themselves --------------------- */
  const projects = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    let unfiled = 0;
    for (const doc of documents) {
      if (!doc.projectId) {
        unfiled += 1;
        continue;
      }
      const held = byId.get(doc.projectId);
      if (held) held.count += 1;
      else byId.set(doc.projectId, { id: doc.projectId, name: doc.projectName ?? '—', count: 1 });
    }
    const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { list, unfiled };
  }, [documents]);

  const owners = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const doc of documents) {
      /* ⚠️ Only people this reader can actually name. An option reading "Someone"
         is unpickable in any meaningful sense, and two hidden uploaders would both
         render as the same label while filtering to different people. */
      if (doc.uploadedByName && !byId.has(doc.uploadedById)) {
        byId.set(doc.uploadedById, { id: doc.uploadedById, name: doc.uploadedByName });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [documents]);

  const kinds = React.useMemo(() => {
    const seen = new Set<FileKind>();
    for (const doc of documents) seen.add(fileKind(doc.mimeType, doc.name));
    return FILE_KINDS.filter((k) => seen.has(k));
  }, [documents]);

  /* ---- The rows --------------------------------------------------------- */
  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((doc) => {
      if (needle && !doc.name.toLowerCase().includes(needle)) return false;
      if (projectId === UNFILED && doc.projectId !== null) return false;
      if (projectId !== ALL && projectId !== UNFILED && doc.projectId !== projectId) return false;
      if (kind !== ALL && fileKind(doc.mimeType, doc.name) !== kind) return false;
      if (ownerId !== ALL && doc.uploadedById !== ownerId) return false;
      /* ⚠️ "Current only" means the newest upload of a name, which is exactly
         `version === versionCount`. A file uploaded once satisfies it too — it is
         its own current version, and excluding it would make the filter mean
         "files that have been superseded", which is the opposite. */
      if (latestOnly && doc.version !== doc.versionCount) return false;
      return true;
    });
  }, [documents, query, projectId, kind, ownerId, latestOnly]);

  /* Page clamped during render rather than in an effect — the same approach
     `usePagination` takes, and `react-hooks/set-state-in-effect` refuses the
     alternative. A filter that shrinks the list must not leave the reader on a
     page that no longer exists. */
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const from = shown.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, shown.length);
  const visible = shown.slice((safePage - 1) * pageSize, safePage * pageSize);

  const activeFilters =
    (projectId !== ALL ? 1 : 0) +
    (kind !== ALL ? 1 : 0) +
    (ownerId !== ALL ? 1 : 0) +
    (latestOnly ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* ---- Toolbar -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[13rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search project files…"
            aria-label="Search project files"
            className={cn(
              'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        <Select
          label="Project"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setPage(1);
          }}
          options={[
            { value: ALL, label: 'All projects' },
            ...projects.list.map((p) => ({ value: p.id, label: `${p.name} (${p.count})` })),
            /* Only offered when there is something unfiled — an option that always
               returns nothing is a control that teaches people not to trust the
               others. */
            ...(projects.unfiled > 0
              ? [{ value: UNFILED, label: `No project (${projects.unfiled})` }]
              : []),
          ]}
          className="h-10 w-[11rem] rounded-xl"
        />

        <Select
          label="File type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as FileKind | typeof ALL);
            setPage(1);
          }}
          options={[
            { value: ALL, label: 'All file types' },
            ...kinds.map((k) => ({ value: k, label: FILE_KIND_LABEL[k] })),
          ]}
          className="h-10 w-[10.5rem] rounded-xl"
        />

        <Select
          label="Owner"
          value={ownerId}
          onChange={(event) => {
            setOwnerId(event.target.value);
            setPage(1);
          }}
          options={[
            { value: ALL, label: 'All owners' },
            ...owners.map((o) => ({ value: o.id, label: o.name })),
          ]}
          className="h-10 w-[10.5rem] rounded-xl"
        />

        <MoreFilters
          latestOnly={latestOnly}
          count={activeFilters}
          onLatestOnly={(next) => {
            setLatestOnly(next);
            setPage(1);
          }}
          onClear={() => {
            setProjectId(ALL);
            setKind(ALL);
            setOwnerId(ALL);
            setLatestOnly(false);
            setPage(1);
          }}
        />

        <button
          type="button"
          onClick={onUpload}
          className={cn(
            'ml-auto flex h-10 items-center gap-2 rounded-xl bg-accent-primary px-4',
            'text-body-sm font-semibold text-text-on-brand hover:bg-accent-primary-hover',
          )}
        >
          <Upload className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Upload file
        </button>
      </div>

      {/* ---- Table ---------------------------------------------------------- */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {[24, 9, 16, 17, 15, 10, 9].map((share, i) => (
              <col key={i} style={{ width: `${share}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border-default bg-bg-subtle">
              <Th>File name</Th>
              <Th>File type</Th>
              <Th>Project</Th>
              <Th>Uploaded by</Th>
              <Th>Last modified</Th>
              <Th>Storage</Th>
              <Th numeric>Size</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => {
              /* ⚠️ RESOLVED HERE, NOT INSIDE `Row`. `react-hooks/static-components`
                 refuses a component assigned to a variable during another
                 component's render, and `Row` is a component — so doing the lookup
                 in there is an error, while doing it in this list callback is the
                 pattern the rule accepts. `file-icon.tsx` documents exactly this,
                 and `project-files-tab.tsx` already does it the same way. */
              const Icon = iconForFile(doc.mimeType, doc.name);
              const tint = tintForFile(doc.mimeType, doc.name);
              return (
                <Row
                  key={doc.id}
                  doc={doc}
                  icon={Icon}
                  tint={tint}
                  nowMs={nowMs}
                  busy={busyId === doc.id}
                  onView={onView}
                />
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-body-sm text-text-secondary">
                  {documents.length === 0
                    ? 'No project files yet. Upload one and it appears here.'
                    : `Nothing matches ${query ? `“${query}”` : 'these filters'}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Footer --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-text-secondary">
          {shown.length === 0
            ? 'No results'
            : `Showing ${from} to ${to} of ${shown.length} result${shown.length === 1 ? '' : 's'}`}
        </p>

        <div className="flex items-center gap-2">
          <Select
            label="Rows per page"
            value={String(pageSize)}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} per page` }))}
            className="h-9 w-[8.5rem] rounded-lg"
          />

          {pageCount > 1 && (
            <span className="flex items-center gap-1">
              <PageStep label="First page" disabled={safePage === 1} onClick={() => setPage(1)}>
                «
              </PageStep>
              {pageNumbers(safePage, pageCount).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-current={n === safePage ? 'page' : undefined}
                  onClick={() => setPage(n)}
                  className={cn(
                    'size-8 rounded-lg text-caption font-semibold',
                    n === safePage
                      ? 'bg-accent-primary text-text-on-brand'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  {n}
                </button>
              ))}
              <PageStep
                label="Last page"
                disabled={safePage === pageCount}
                onClick={() => setPage(pageCount)}
              >
                »
              </PageStep>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A window of page numbers. Twenty buttons is a wall, not navigation. */
function pageNumbers(page: number, count: number): number[] {
  const first = Math.max(1, Math.min(page - 2, count - 4));
  const last = Math.min(count, Math.max(page + 2, 5));
  const out: number[] = [];
  for (let n = first; n <= last; n += 1) out.push(n);
  return out;
}

function PageStep({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'size-8 rounded-lg text-caption text-text-secondary',
        'hover:bg-bg-hover hover:text-text-primary',
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2.5 text-caption font-medium text-text-secondary',
        numeric && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

const TD = 'px-3 py-3 align-middle';

function Row({
  doc,
  icon: Icon,
  tint,
  nowMs,
  busy,
  onView,
}: {
  doc: DocumentRow;
  /** Resolved by the caller — see the note at the map. */
  icon: LucideIcon;
  tint: KindTint;
  nowMs: number;
  busy: boolean;
  onView: (doc: DocumentRow, mode: 'view' | 'download') => void;
}) {
  const kind = fileKind(doc.mimeType, doc.name);
  /* Asked once and reused, so the cell does not resolve the same extension twice
     to decide whether to draw and then what to draw. */
  const artwork = fileIconName(doc.mimeType, doc.name) !== null;
  const superseded = doc.version !== doc.versionCount;

  return (
    <tr className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
      <td className={TD}>
        <span className="flex items-center gap-2.5">
          {/* ── ⚠️ THE OWNER'S ARTWORK WHERE THERE IS ONE, THE GLYPH WHERE THERE
                 IS NOT ────────────────────────────────────────────────────────
              Owner, supplying ten PNGs: *"I want it to use these icon images
              according to the extension."*

              Ten artworks cover far more than ten extensions (see
              file-type-icon.tsx), but not all of them. An .ai or a .psd has no
              artwork, and relabelling the PDF one would put the wrong badge on the
              row — so those keep the tinted lucide glyph this table already drew.
              Both are 36px and sit on the same baseline, so a mixed table does not
              look like two designs stitched together. */}
          {artwork ? (
            <FileTypeIcon mimeType={doc.mimeType} name={doc.name} size={34} />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: `var(--${tint.wash})` }}
            >
              <Icon className="size-4" strokeWidth={2.25} style={{ color: `var(--${tint.ink})` }} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-body-sm text-text-primary" title={doc.name}>
              {doc.name}
            </span>
            {/* ⚠️ Whole numbers, and "current" only where there is more than one
                upload of this name. A lone v1 with a "current" tag beside it is
                noise on every row of a table where nothing has been superseded. */}
            <span className="block text-micro text-text-tertiary">
              v{doc.version}
              {doc.versionCount > 1 && (
                <>
                  {' of '}
                  {doc.versionCount}
                  {superseded ? ' · superseded' : ' · current'}
                </>
              )}
            </span>
          </span>
        </span>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-secondary')}>{FILE_KIND_LABEL[kind]}</td>

      <td className={TD}>
        {doc.projectName ? (
          <span className="block min-w-0">
            <span className="block truncate text-body-sm text-text-primary" title={doc.projectName}>
              {doc.projectName}
            </span>
            {doc.projectType && (
              <span className="block truncate text-micro text-text-tertiary">
                {PROJECT_TYPE_META[doc.projectType as ProjectType]?.label ?? doc.projectType}
              </span>
            )}
          </span>
        ) : (
          <span className="text-body-sm text-text-tertiary">No project</span>
        )}
      </td>

      {/* ── ⚠️ THE NAME CAN BE LEGITIMATELY UNKNOWN ─────────────────────────────
          Row-level security on `public.users` restricts a Member to their own row —
          measured: a Member sees 1 of the users table. So `uploadedByName` is NULL
          for anybody else's upload, and that is deliberate, not missing data: a
          Member is not able to enumerate the team.

          It first rendered as "Someone" with an "SO" initials disc, which invents a
          colleague. A dash and no avatar says the true thing — this row has an
          uploader and you are not shown who. The Admin viewing the same table sees
          the real name, because RLS lets them. */}
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-2">
          {doc.uploadedByName ? (
            <Avatar name={doc.uploadedByName} src={doc.uploadedByAvatarUrl} size="xs" />
          ) : (
            <span
              aria-hidden="true"
              className="size-6 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--bg-active)' }}
            />
          )}
          <span className="min-w-0">
            <span
              className={cn(
                'block truncate text-body-sm',
                doc.uploadedByName ? 'text-text-primary' : 'text-text-tertiary',
              )}
              title={doc.uploadedByName ?? 'You do not have access to see who uploaded this'}
            >
              {doc.uploadedByName ?? '—'}
            </span>
            {/* Their role ON THIS PROJECT — not their system rank. Null when they
                are not a member of it, which is a real case and reads as nothing
                rather than as "Member". */}
            {doc.uploadedByProjectRole && (
              <span className="block truncate text-micro text-text-tertiary">
                {PROJECT_ROLE_LABEL[doc.uploadedByProjectRole] ?? doc.uploadedByProjectRole}
              </span>
            )}
          </span>
        </span>
      </td>

      <td className={TD}>
        <span className="block min-w-0">
          <span className="block truncate text-body-sm text-text-primary">
            {dayLabel(doc.decidedAt ?? doc.createdAt, nowMs)}
          </span>
          {/* Whoever last acted on it: the decider if there was a decision, else
              the uploader. Two different facts, and saying "by" the wrong one is how
              somebody gets asked about a file they never touched.

              ⚠️ Omitted entirely when neither name is visible, rather than printed
              as "by someone" — see the uploader cell. A line that names nobody is
              worse than no line. */}
          {(doc.decidedByName ?? doc.uploadedByName) && (
            <span className="block truncate text-micro text-text-tertiary">
              by {doc.decidedByName ?? doc.uploadedByName}
            </span>
          )}
        </span>
      </td>

      <td className={TD}>
        <StorageBadge document={doc} size="sm" />
      </td>

      <td className={cn(TD, 'text-right')}>
        <span className="flex items-center justify-end gap-1">
          <span className="text-body-sm tabular-nums text-text-secondary">
            {formatFileSize(doc.sizeBytes)}
          </span>
          <RowMenu doc={doc} busy={busy} onView={onView} />
        </span>
      </td>
    </tr>
  );
}

/** `12 May 2026`, or the two recent days that read better as words. Formatted from
 *  the SERVER's clock — see lib/now.ts. */
function dayLabel(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((nowMs - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return new Date(then).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  });
}

/* ---- Menus --------------------------------------------------------------- */

const PANEL =
  'absolute right-0 z-30 mt-1 w-[14rem] overflow-hidden rounded-xl border ' +
  'border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]';

const ITEM =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-caption ' +
  'text-text-secondary hover:bg-bg-hover hover:text-text-primary';

/** `<details>` for the free keyboard behaviour, plus the outside-click and Escape
 *  handling it does not provide. See the note in folder-table.tsx. */
function useDismiss(ref: React.RefObject<HTMLDetailsElement | null>, closeOnPick: boolean) {
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [ref]);

  return closeOnPick ? { onClick: () => ref.current?.removeAttribute('open') } : {};
}

function MoreFilters({
  latestOnly,
  count,
  onLatestOnly,
  onClear,
}: {
  latestOnly: boolean;
  count: number;
  onLatestOnly: (next: boolean) => void;
  onClear: () => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, false);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="More filters"
        className={cn(
          'flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border px-3.5',
          'text-body-sm font-semibold marker:content-none [&::-webkit-details-marker]:hidden',
          count > 0
            ? 'border-border-brand text-text-primary'
            : 'border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
        )}
      >
        <SlidersHorizontal className="size-4" strokeWidth={2.25} aria-hidden="true" />
        More filters
        {count > 0 && (
          <span className="rounded-full bg-accent-primary px-1.5 text-micro font-bold text-text-on-brand">
            {count}
          </span>
        )}
      </summary>

      <div {...dismiss} className={cn(PANEL, 'left-0 right-auto')}>
        <button type="button" onClick={() => onLatestOnly(!latestOnly)} className={ITEM}>
          <span className="flex-1">Current versions only</span>
          {latestOnly && <span className="text-micro font-bold">✓</span>}
        </button>
        {count > 0 && (
          <>
            <div className="my-1 h-px bg-border-subtle" />
            <button type="button" onClick={onClear} className={ITEM}>
              Clear all filters
            </button>
          </>
        )}
      </div>
    </details>
  );
}

function RowMenu({
  doc,
  busy,
  onView,
}: {
  doc: DocumentRow;
  busy: boolean;
  onView: (doc: DocumentRow, mode: 'view' | 'download') => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, true);

  return (
    <details ref={ref} className="relative inline-block">
      <summary
        aria-label={`Actions for ${doc.name}`}
        className={cn(
          'flex size-8 cursor-pointer list-none items-center justify-center rounded-lg',
          'text-text-tertiary marker:content-none hover:bg-bg-active hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div {...dismiss} className={PANEL}>
        {/* ⚠️ Only offered when the bytes are somewhere this system can reach. A
            document whose storage_path was cleared has nothing to open, and a menu
            item that always fails is worse than an absent one. */}
        {doc.storagePath && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onView(doc, 'view')}
              className={ITEM}
            >
              <Eye className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              {busy ? 'Opening…' : 'View'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onView(doc, 'download')}
              className={ITEM}
            >
              <Download className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Download
            </button>
          </>
        )}

        {doc.driveWebLink && (
          <a
            href={doc.driveWebLink}
            target="_blank"
            rel="noopener noreferrer"
            className={ITEM}
          >
            <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Open in Drive
          </a>
        )}

        {!doc.storagePath && !doc.driveWebLink && (
          <p className="px-3 py-2 text-micro text-text-tertiary">
            Nothing to open — this row has no file behind it.
          </p>
        )}
      </div>
    </details>
  );
}
