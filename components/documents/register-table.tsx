'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Globe,
  Loader2,
  Monitor,
  MoreVertical,
  Search,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

import type { DocumentRow } from '@/lib/db/queries/documents';
import {
  STORAGE_META,
  matchesStorage,
  storageHome,
  type StorageFilter,
} from '@/lib/domain/document-storage';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { FileTypeIcon, fileIconName } from './file-type-icon';
import { formatFileSize } from './file-viewer';
import { iconForFile, tintForFile } from './file-icon';
import { StorageBadge } from './storage-badge';

/* ============================================================================
 * REGISTER & APPROVALS — the owner's layout
 * ----------------------------------------------------------------------------
 * *"I want this same UI that I have shared with you in the screenshot, exactly the
 * same. Make sure that each and every thing is properly implemented logically
 * according to the database and according to… my real data."*
 *
 * Four state chips with live counts, three storage filters, a search box, an
 * upload button, and a table: Status, Document, Project, Uploaded by, Size,
 * Storage / Source, Actions. Then a result count and a pager.
 *
 * ── ⚠️ THIS TAB IS A DECISION QUEUE, WHICH IS WHY IT OPENS ON WAITING ───────
 * The four chips are not equal. Three of them are a record of what happened;
 * "Waiting" is a list of things asked of the person reading it. So it is first, it
 * carries the warning colour, and it is where the tab lands when anything is in it.
 *
 * ── ⚠️ ACCEPTING DOES NOT MOVE THE FILE ─────────────────────────────────────
 * Easy to assume the other way round, and the whole approval step exists because
 * it is not true. Since migration 048 a document lives in this system's private
 * storage (or in Drive, if the uploader chose that on the form) and a decision is a
 * state change that moves no bytes. The Storage / Source column says where it
 * actually is, and it does not change when a row is accepted — which is exactly
 * why that column and the Status column are both here.
 *
 * ── ⚠️ REFUSING DELETES THE FILE; ACCEPTING IS REVERSIBLE ───────────────────
 * Hence Refuse asks for a reason in a dialogue (the caller owns it) while Accept is
 * a single press. The asymmetry is deliberate and matches what the two actions
 * actually cost.
 * ========================================================================= */

export type StateFilter = 'pending' | 'approved' | 'rejected' | 'all';

const STATE_META = {
  pending: { label: 'Waiting', token: 'feedback-warning', icon: Clock },
  approved: { label: 'Accepted', token: 'feedback-success', icon: CheckCircle2 },
  rejected: { label: 'Refused', token: 'feedback-error', icon: XCircle },
} as const;

const CHIPS: ReadonlyArray<{ key: StateFilter; label: string; token: string | null; icon: typeof Clock | null }> = [
  { key: 'pending', label: 'Waiting', token: 'feedback-warning', icon: Clock },
  { key: 'approved', label: 'Accepted', token: 'feedback-success', icon: CheckCircle2 },
  { key: 'rejected', label: 'Refused', token: 'feedback-error', icon: XCircle },
  /* No icon and no colour: "Everything" is not a state, it is the absence of the
     filter. Giving it a tick or a colour would make it look like a fourth outcome. */
  { key: 'all', label: 'Everything', token: null, icon: null },
];

const WHERE: ReadonlyArray<{ key: StorageFilter; label: string }> = [
  { key: 'anywhere', label: 'Anywhere' },
  { key: 'bucket', label: STORAGE_META.bucket.filterLabel },
  { key: 'drive', label: STORAGE_META.drive.filterLabel },
];

const PAGE_SIZE = 10;

export function RegisterTable({
  documents,
  canApprove,
  canManage,
  nowMs,
  busyId,
  onUpload,
  onPreview,
  onDownload,
  onApprove,
  onRefuse,
  onDelete,
}: {
  documents: readonly DocumentRow[];
  canApprove: boolean;
  canManage: boolean;
  /** The server's clock. See lib/now.ts. */
  nowMs: number;
  busyId: string | null;
  onUpload: () => void;
  onPreview: (doc: DocumentRow) => void;
  onDownload: (doc: DocumentRow) => void;
  onApprove: (doc: DocumentRow) => void;
  onRefuse: (doc: DocumentRow) => void;
  onDelete: (doc: DocumentRow) => void;
}) {
  const [state, setState] = React.useState<StateFilter>('pending');
  const [where, setWhere] = React.useState<StorageFilter>('anywhere');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);

  /* ⚠️ Counted over EVERY document, not over the filtered list. A chip that
     reported the size of its own result would read "Waiting 0" the moment you
     looked at Accepted, which is the one number on this tab somebody needs to see
     without clicking. Storage and search are excluded for the same reason. */
  const counts = React.useMemo(
    () => ({
      pending: documents.filter((d) => d.state === 'pending').length,
      approved: documents.filter((d) => d.state === 'approved').length,
      rejected: documents.filter((d) => d.state === 'rejected').length,
      all: documents.length,
    }),
    [documents],
  );

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((doc) => {
      if (state !== 'all' && doc.state !== state) return false;
      /* `matchesStorage` takes the resolved HOME, not the row — `storageHome`
         is the one place that decides whether a document with both a bucket path
         and a Drive id counts as either. */
      if (!matchesStorage(storageHome(doc), where)) return false;
      if (needle) {
        const haystack = `${doc.name} ${doc.projectName ?? ''} ${doc.uploadedByName ?? ''}`;
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [documents, state, where, query]);

  /* Clamped during render, not in an effect — a filter that shrinks the list must
     not leave the reader on a page that no longer exists. */
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = shown.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, shown.length);

  const reset = () => setPage(1);

  return (
    <div className="space-y-3">
      {/* ---- Toolbar -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((chip) => {
            const on = state === chip.key;
            const Icon = chip.icon;
            const count = counts[chip.key];

            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setState(chip.key);
                  reset();
                }}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-xl border-2 px-3',
                  'text-caption font-semibold',
                  'transition-[border-color,background-color] duration-[140ms]',
                  on
                    ? 'border-border-brand bg-bg-selected text-text-primary'
                    : 'border-border-subtle text-text-secondary hover:border-border-strong hover:bg-bg-hover',
                )}
              >
                {Icon && (
                  <Icon
                    className="size-3.5"
                    strokeWidth={2.5}
                    aria-hidden="true"
                    style={{ color: chip.token ? `var(--${chip.token})` : undefined }}
                  />
                )}
                {chip.label}
                <span
                  className="tabular rounded-full px-1.5 text-micro font-bold"
                  style={{
                    backgroundColor: chip.token
                      ? `color-mix(in oklab, var(--${chip.token}) 16%, transparent)`
                      : 'var(--bg-active)',
                    color: chip.token ? `var(--${chip.token})` : 'var(--text-secondary)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Where the bytes are — a different question from whether anybody has
            decided, which is why it is a separate control rather than four more
            states. */}
        <div className="flex items-center gap-0.5 rounded-xl border border-border-default bg-bg-subtle p-0.5">
          {WHERE.map((option) => {
            const on = where === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setWhere(option.key);
                  reset();
                }}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-caption font-semibold',
                  on
                    ? 'bg-bg-surface text-text-primary shadow-xs'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {option.key === 'anywhere' && (
                  <Globe className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                )}
                {option.key === 'bucket' && (
                  <Monitor className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                )}
                {/* The real Drive mark, not a generic cloud — same logo as the
                    header pill and the row badges. */}
                {option.key === 'drive' && <PlatformIcon slug="googledrive" size={14} />}
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[11rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              reset();
            }}
            placeholder="Search documents…"
            aria-label="Search the register"
            className={cn(
              'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        <button
          type="button"
          onClick={onUpload}
          className={cn(
            'flex h-10 shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4',
            'text-body-sm font-semibold text-text-on-brand hover:bg-accent-primary-hover',
          )}
        >
          <Upload className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Upload a document
        </button>
      </div>

      {/* ---- Table ---------------------------------------------------------- */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {[10, 24, 15, 17, 8, 14, 12].map((share, i) => (
              <col key={i} style={{ width: `${share}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border-default bg-bg-subtle">
              <Th>Status</Th>
              <Th>Document</Th>
              <Th>Project</Th>
              <Th>Uploaded by</Th>
              <Th numeric>Size</Th>
              <Th>Storage / Source</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => {
              /* Resolved in the map callback, which is the placement
                 `react-hooks/static-components` accepts — see file-icon.tsx. */
              const Icon = iconForFile(doc.mimeType, doc.name);
              const tint = tintForFile(doc.mimeType, doc.name);
              const artwork = fileIconName(doc.mimeType, doc.name) !== null;

              return (
                <Row
                  key={doc.id}
                  doc={doc}
                  icon={Icon}
                  tintWash={tint.wash}
                  tintInk={tint.ink}
                  artwork={artwork}
                  canApprove={canApprove}
                  canManage={canManage}
                  nowMs={nowMs}
                  busy={busyId === doc.id}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onApprove={onApprove}
                  onRefuse={onRefuse}
                  onDelete={onDelete}
                />
              );
            })}

            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  {/* ⚠️ The STORAGE filter is named first when it is the one hiding
                      things. An empty list under two filters, one of which somebody
                      set a moment ago, otherwise reads as "there are no documents at
                      all" — and this is a queue, so that is the worst possible
                      misreading. */}
                  <p className="text-body-sm font-semibold text-text-primary">
                    {where !== 'anywhere'
                      ? `Nothing here is in ${STORAGE_META[where].filterLabel}`
                      : query
                        ? `Nothing matches “${query}”`
                        : state === 'pending'
                          ? 'Nothing is waiting'
                          : 'Nothing here yet'}
                  </p>
                  <p className="mx-auto mt-1 max-w-[34rem] text-caption text-text-secondary">
                    {where !== 'anywhere'
                      ? 'Set the store back to Anywhere to see the rest of the register.'
                      : state === 'pending'
                        ? 'Every upload has been decided on.'
                        : 'Upload a document and it is held in this system’s own storage — or written straight into a Drive folder, if the uploader chooses that on the form.'}
                  </p>
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

        {pageCount > 1 && (
          <span className="flex items-center gap-1">
            <Step label="Previous page" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
              ‹
            </Step>
            {pageWindow(safePage, pageCount).map((n) => (
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
            <Step
              label="Next page"
              disabled={safePage === pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              ›
            </Step>
          </span>
        )}
      </div>
    </div>
  );
}

/* ---- Pieces -------------------------------------------------------------- */

function pageWindow(page: number, count: number): number[] {
  const first = Math.max(1, Math.min(page - 2, count - 4));
  const last = Math.min(count, Math.max(page + 2, 5));
  const out: number[] = [];
  for (let n = first; n <= last; n += 1) out.push(n);
  return out;
}

function Step({
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
  tintWash,
  tintInk,
  artwork,
  canApprove,
  canManage,
  nowMs,
  busy,
  onPreview,
  onDownload,
  onApprove,
  onRefuse,
  onDelete,
}: {
  doc: DocumentRow;
  icon: ReturnType<typeof iconForFile>;
  tintWash: string;
  tintInk: string;
  artwork: boolean;
  canApprove: boolean;
  canManage: boolean;
  nowMs: number;
  busy: boolean;
  onPreview: (doc: DocumentRow) => void;
  onDownload: (doc: DocumentRow) => void;
  onApprove: (doc: DocumentRow) => void;
  onRefuse: (doc: DocumentRow) => void;
  onDelete: (doc: DocumentRow) => void;
}) {
  const meta = STATE_META[doc.state];
  const StateIcon = meta.icon;
  /* Nothing to open once a refusal has deleted the bytes — see the row menu. */
  const openable = doc.storagePath !== null || doc.driveWebLink !== null;

  return (
    <tr className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
      <td className={TD}>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
            color: `var(--${meta.token})`,
          }}
        >
          <StateIcon className="size-3" strokeWidth={2.5} aria-hidden="true" />
          {meta.label}
        </span>
      </td>

      <td className={TD}>
        <span className="flex min-w-0 items-center gap-2.5">
          {artwork ? (
            <FileTypeIcon mimeType={doc.mimeType} name={doc.name} size={28} />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: tintWash }}
            >
              <Icon className="size-4" strokeWidth={2.25} style={{ color: tintInk }} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-text-primary" title={doc.name}>
              {doc.name}
            </span>
            {/* ⚠️ A refusal's REASON belongs on the row, not behind a hover. It is
                the one thing the person who uploaded it needs, and this register is
                where they were told. */}
            {doc.state === 'rejected' && doc.decisionReason && (
              <span
                className="block truncate text-micro"
                style={{ color: 'var(--feedback-error)' }}
                title={doc.decisionReason}
              >
                {doc.decisionReason}
              </span>
            )}
          </span>
        </span>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-secondary')}>
        <span className="block truncate" title={doc.projectName ?? undefined}>
          {doc.projectName ?? '—'}
        </span>
      </td>

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
            {/* Null is a real answer: RLS restricts a Member to their own row in
                `users`, so somebody else's name is legitimately not shown. A dash
                says that; inventing "Someone" would name a colleague who does not
                exist. */}
            <span
              className={cn(
                'block truncate text-body-sm',
                doc.uploadedByName ? 'text-text-primary' : 'text-text-tertiary',
              )}
            >
              {doc.uploadedByName ?? '—'}
            </span>
            <span className="block truncate text-micro text-text-tertiary">
              {dayLabel(doc.createdAt, nowMs)}
            </span>
          </span>
        </span>
      </td>

      <td className={cn(TD, 'text-right text-body-sm tabular-nums text-text-secondary')}>
        {formatFileSize(doc.sizeBytes)}
      </td>

      <td className={TD}>
        <StorageBadge document={doc} size="sm" />
      </td>

      <td className={TD}>
        <span className="flex items-center gap-0.5">
          <Action
            label={`Open ${doc.name}`}
            icon={Eye}
            disabled={!openable || busy}
            onClick={() => onPreview(doc)}
          />
          <Action
            label={`Download ${doc.name}`}
            icon={Download}
            disabled={!openable || busy}
            onClick={() => onDownload(doc)}
          />
          <RowMenu
            doc={doc}
            canApprove={canApprove}
            canManage={canManage}
            busy={busy}
            openable={openable}
            onApprove={onApprove}
            onRefuse={onRefuse}
            onDelete={onDelete}
          />
        </span>
      </td>
    </tr>
  );
}

function Action({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Eye;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-lg text-text-tertiary',
        'hover:bg-bg-active hover:text-text-primary',
        'disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent',
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

function RowMenu({
  doc,
  canApprove,
  canManage,
  busy,
  openable,
  onApprove,
  onRefuse,
  onDelete,
}: {
  doc: DocumentRow;
  canApprove: boolean;
  canManage: boolean;
  busy: boolean;
  openable: boolean;
  onApprove: (doc: DocumentRow) => void;
  onRefuse: (doc: DocumentRow) => void;
  onDelete: (doc: DocumentRow) => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);

  /* `<details>` for the free keyboard behaviour, plus the outside-click and Escape
     handling it does not provide. See folder-table.tsx. */
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
  }, []);

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary ' +
    'hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <details ref={ref} className="relative inline-block">
      <summary
        aria-label={`More actions for ${doc.name}`}
        className={cn(
          'grid size-8 cursor-pointer list-none place-items-center rounded-lg text-text-tertiary',
          'marker:content-none hover:bg-bg-active hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
        )}
      </summary>

      <div
        onClick={() => ref.current?.removeAttribute('open')}
        className="absolute right-0 z-30 mt-1 w-[15rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]"
      >
        {/* ⚠️ A decision is offered ONLY on a pending row. Re-accepting something
            already accepted does nothing, and a menu item that does nothing is one
            somebody presses twice and then reports as broken. */}
        {canApprove && doc.state === 'pending' && (
          <>
            <button type="button" disabled={busy} onClick={() => onApprove(doc)} className={item}>
              <CheckCircle2
                className="size-3.5"
                strokeWidth={2.25}
                aria-hidden="true"
                style={{ color: 'var(--feedback-success)' }}
              />
              Accept
            </button>
            {/* Refuse opens a dialogue for the reason — the caller owns it. It is
                the destructive half of this pair: a refusal deletes the file and
                keeps only the record and the reason. */}
            <button type="button" disabled={busy} onClick={() => onRefuse(doc)} className={item}>
              <XCircle
                className="size-3.5"
                strokeWidth={2.25}
                aria-hidden="true"
                style={{ color: 'var(--feedback-error)' }}
              />
              Refuse…
            </button>
            <div className="my-1 h-px bg-border-subtle" />
          </>
        )}

        {doc.driveWebLink && (
          <a
            href={doc.driveWebLink}
            target="_blank"
            rel="noopener noreferrer"
            className={item}
          >
            Open in Drive
          </a>
        )}

        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(doc)}
            className={cn(item, 'text-[var(--feedback-error)] hover:text-[var(--feedback-error)]')}
          >
            <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Delete the record
          </button>
        )}

        {!openable && !canApprove && !canManage && (
          <p className="px-3 py-2 text-micro text-text-tertiary">Nothing to do on this row.</p>
        )}
      </div>
    </details>
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
