'use client';

import * as React from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  FolderPlus,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

import type { DriveFolderRow } from '@/lib/db/queries/drive-folders';
import { ACCESS_META, type FolderAccess } from '@/lib/domain/folder-access';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { formatFileSize } from './file-viewer';

/* ============================================================================
 * FOLDERS & FILES — the owner's layout
 * ----------------------------------------------------------------------------
 * *"I want the layout and UI to be exactly the same as seen in this screenshot,
 * but everything should be properly implemented logically… don't use extra
 * paragraphs, text, and content like right now."*
 *
 * A search box, a Filters menu, a sort menu, New folder, an Upload split button,
 * and a table: checkbox, Folder name, Files, Owner / Team, Last modified, Size,
 * Access, and a row menu. Nothing else — the three paragraphs of explanation that
 * used to sit around this list are gone.
 *
 * ── ⚠️ EVERY COLUMN IS REAL, AND TWO OF THEM DID NOT EXIST A MOMENT AGO ─────
 * Size, Last modified and Owner / Team were empty on all 33 folders, because this
 * system only ever counted what was in Drive. Owner: *"the things should be real.
 * Even the real drive size, folder size, anything should be real. If you need
 * something, Google Drive is integrated with it so go and get everything."*
 *
 * So they come from Drive now — migration 056 and `listChildren` — and the numbers
 * on screen are what Google reports: 5.83 GB in Jashan Suba Noor Promo, 48 files
 * in 14 August Raw Data, owned by the accounts that actually own them.
 *
 * ⚠️ THE OWNERS ARE GOOGLE ACCOUNTS, NOT THIS SYSTEM'S USERS. Most will never have
 * a login here. That is why the avatar takes a remote `photo` and falls back to
 * initials, rather than being looked up in `public.users` and coming back empty.
 * ========================================================================= */

export type SortKey = 'name' | 'files' | 'modified' | 'size';

export interface FolderTableProps {
  readonly folders: readonly DriveFolderRow[];
  readonly canShare: boolean;
  readonly canConfigure: boolean;
  readonly watchedDriveId: string | null;
  /** The server's clock, for the date labels. See lib/now.ts. */
  readonly nowMs: number;
  readonly busy: string | null;
  readonly onOpen: (folder: DriveFolderRow) => void;
  readonly onAccess: (folder: DriveFolderRow) => void;
  readonly onTrash: (folder: DriveFolderRow) => void;
  readonly onUploadHere: (folder: DriveFolderRow) => void;
  readonly onNewFolder: () => void;
  readonly onUpload: () => void;
  readonly onSync: () => void;
}

/** Access, as the pill the mockup draws. */
const ACCESS_PILL: Record<FolderAccess, { readonly label: string; readonly token: string }> = {
  /* ⚠️ "Private", not ACCESS_META's "Coordinators and above". The full sentence is
     right in the access dialogue, where somebody is choosing; in a table column
     eight characters wide it wrapped to three lines on all 33 rows. The pill says
     what the state IS and the row menu says what it means. */
  none: { label: 'Private', token: 'status-backlog' },
  view: { label: 'Shared', token: 'status-done' },
  upload: { label: 'Open', token: 'feedback-info' },
  manage: { label: 'Full', token: 'feedback-warning' },
};

export function FolderTable(props: FolderTableProps) {
  const { folders, canShare, canConfigure, watchedDriveId, nowMs, busy } = props;

  const [query, setQuery] = React.useState('');
  const [access, setAccess] = React.useState<FolderAccess | 'any'>('any');
  const [onlyWithFiles, setOnlyWithFiles] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({
    key: 'name',
    desc: false,
  });
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  /* Derived, never stored: a filter change must not leave a stale list behind,
     and `react-hooks/set-state-in-effect` would refuse the alternative anyway. */
  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = folders.filter((f) => {
      if (needle && !f.name.toLowerCase().includes(needle)) return false;
      if (access !== 'any' && f.memberAccess !== access) return false;
      /* ⚠️ `> 0`, and null is excluded too — a folder never looked inside has an
         unknown count, and "has files" cannot be true of something unknown. */
      if (onlyWithFiles && !(f.driveFileCount !== null && f.driveFileCount > 0)) return false;
      return true;
    });

    const sign = sort.desc ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'files':
          return sign * ((a.driveFileCount ?? -1) - (b.driveFileCount ?? -1));
        case 'size':
          return sign * ((a.driveSizeBytes ?? -1) - (b.driveSizeBytes ?? -1));
        case 'modified':
          /* Undated sorts as the empty string, which puts it first ascending and
             last descending — the honest place for "nothing has happened". */
          return sign * (a.driveModifiedAt ?? '').localeCompare(b.driveModifiedAt ?? '');
        default:
          return sign * a.name.localeCompare(b.name);
      }
    });
    return rows;
  }, [folders, query, access, onlyWithFiles, sort]);

  /* ⚠️ Intersected with what is SHOWN. A selection made before a filter was typed
     must not act on rows the reader can no longer see — the bulk bar would say
     "3 selected" over a table of one. */
  const visibleSelected = React.useMemo(
    () => shown.filter((f) => selected.has(f.id)),
    [shown, selected],
  );

  const allShownSelected = shown.length > 0 && visibleSelected.length === shown.length;
  const activeFilters = (access !== 'any' ? 1 : 0) + (onlyWithFiles ? 1 : 0);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-3">
      {/* ---- Toolbar -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search folders & files…"
            aria-label="Search folders and files"
            className={cn(
              'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        <FiltersMenu
          access={access}
          onlyWithFiles={onlyWithFiles}
          count={activeFilters}
          onAccess={setAccess}
          onOnlyWithFiles={setOnlyWithFiles}
          onClear={() => {
            setAccess('any');
            setOnlyWithFiles(false);
          }}
        />

        <div className="ml-auto flex items-center gap-2">
          <SortMenu sort={sort} onSort={setSort} />

          {canShare && (
            <button
              type="button"
              onClick={props.onNewFolder}
              className={cn(
                'flex h-10 items-center gap-2 rounded-xl border border-border-default px-3.5',
                'text-body-sm font-semibold text-text-primary',
                'hover:border-border-strong hover:bg-bg-hover',
              )}
            >
              <FolderPlus className="size-4" strokeWidth={2.25} aria-hidden="true" />
              New folder
            </button>
          )}

          <UploadButton
            busy={busy === 'sync'}
            canShare={canShare}
            onUpload={props.onUpload}
            onSync={props.onSync}
          />
        </div>
      </div>

      {/* ---- Bulk bar ------------------------------------------------------- */}
      {visibleSelected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-brand bg-bg-selected px-3 py-2">
          <span className="text-caption font-semibold text-text-primary">
            {visibleSelected.length} selected
          </span>
          {canShare && (
            <>
              {/* ⚠️ ONE folder at a time for access, deliberately. The dialogue
                  shows and edits one folder's grants; applying one screen's worth
                  of changes to eight folders at once is a bulk permission change
                  nobody could review afterwards. Enabled only on a single row. */}
              <button
                type="button"
                disabled={visibleSelected.length !== 1}
                onClick={() => props.onAccess(visibleSelected[0])}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-1 text-caption font-semibold',
                  'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  'disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent',
                )}
                title={
                  visibleSelected.length === 1
                    ? undefined
                    : 'Access is changed one folder at a time'
                }
              >
                <Users className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Who can see
              </button>
              <button
                type="button"
                disabled={visibleSelected.length !== 1}
                onClick={() => props.onUploadHere(visibleSelected[0])}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-1 text-caption font-semibold',
                  'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  'disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent',
                )}
              >
                <Upload className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Upload here
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
            Clear
          </button>
        </div>
      )}

      {/* ---- Table ---------------------------------------------------------- */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {[4, 26, 8, 14, 18, 10, 12, 8].map((share, i) => (
              <col key={i} style={{ width: `${share}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border-default bg-bg-subtle">
              <th scope="col" className="px-3 py-2.5">
                <Tick
                  checked={allShownSelected}
                  label={allShownSelected ? 'Clear selection' : 'Select every folder shown'}
                  onChange={() =>
                    setSelected(allShownSelected ? new Set() : new Set(shown.map((f) => f.id)))
                  }
                />
              </th>
              <SortableTh label="Folder name" active={sort} which="name" onSort={setSort} />
              <SortableTh label="Files" active={sort} which="files" onSort={setSort} numeric />
              <Th>Owner / Team</Th>
              <SortableTh label="Last modified" active={sort} which="modified" onSort={setSort} />
              <SortableTh label="Size" active={sort} which="size" onSort={setSort} numeric />
              <Th>Access</Th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((folder) => (
              <Row
                key={folder.id}
                folder={folder}
                checked={selected.has(folder.id)}
                onToggle={() => toggle(folder.id)}
                canShare={canShare}
                isWatched={canConfigure && folder.driveFolderId === watchedDriveId}
                nowMs={nowMs}
                onOpen={() => props.onOpen(folder)}
                onAccess={() => props.onAccess(folder)}
                onTrash={() => props.onTrash(folder)}
                onUploadHere={() => props.onUploadHere(folder)}
              />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <p className="text-body-sm text-text-secondary">
                    {folders.length === 0
                      ? 'No folders yet.'
                      : `Nothing matches ${query ? `“${query}”` : 'these filters'}.`}
                  </p>
                  {folders.length === 0 && canShare && (
                    <button
                      type="button"
                      onClick={props.onSync}
                      className="mt-2 text-caption font-semibold text-text-brand hover:underline"
                    >
                      Read folders from Drive
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The count, always — it is what tells a reader a filter has taken hold. */}
      <p className="text-caption text-text-secondary">
        {shown.length === folders.length
          ? `${folders.length} folder${folders.length === 1 ? '' : 's'}`
          : `${shown.length} of ${folders.length} folders`}
      </p>
    </div>
  );
}

/* ---- Header cells -------------------------------------------------------- */

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

/**
 * A sortable heading.
 *
 * ⚠️ The whole heading is the button, and clicking the CURRENT column flips the
 * direction rather than re-selecting it — which is what the two-arrow glyph in the
 * mockup promises. A separate direction control beside it would be a second thing
 * to hit for something one click already says.
 */
function SortableTh({
  label,
  active,
  which,
  numeric,
  onSort,
}: {
  label: string;
  active: { key: SortKey; desc: boolean };
  which: SortKey;
  numeric?: boolean;
  onSort: (next: { key: SortKey; desc: boolean }) => void;
}) {
  const on = active.key === which;
  return (
    <th scope="col" className={cn('px-3 py-2.5', numeric && 'text-right')}>
      <button
        type="button"
        onClick={() =>
          /* Text opens A–Z; a number opens largest-first, because "which is the
             biggest" is what a size or a count column is asked. */
          onSort({ key: which, desc: on ? !active.desc : Boolean(numeric) })
        }
        className={cn(
          'inline-flex items-center gap-1 text-caption font-medium',
          on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        {label}
        {on ? (
          <ArrowUpDown
            className={cn('size-3', active.desc && 'scale-y-[-1]')}
            strokeWidth={2.5}
            aria-hidden="true"
          />
        ) : (
          <ChevronsUpDown className="size-3 opacity-50" strokeWidth={2.25} aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

/* ---- Row ----------------------------------------------------------------- */

function Row({
  folder,
  checked,
  onToggle,
  canShare,
  isWatched,
  nowMs,
  onOpen,
  onAccess,
  onTrash,
  onUploadHere,
}: {
  folder: DriveFolderRow;
  checked: boolean;
  onToggle: () => void;
  canShare: boolean;
  isWatched: boolean;
  nowMs: number;
  onOpen: () => void;
  onAccess: () => void;
  onTrash: () => void;
  onUploadHere: () => void;
}) {
  const pill = ACCESS_PILL[folder.memberAccess];

  return (
    <tr
      className={cn(
        'border-b border-border-subtle last:border-0',
        checked ? 'bg-bg-selected' : 'hover:bg-bg-hover',
      )}
    >
      <td className="px-3 py-2.5">
        <Tick checked={checked} label={`Select ${folder.name}`} onChange={onToggle} />
      </td>

      <td className="px-3 py-2.5">
        {/* The name is the control — a folder that looks like a folder opens when
            clicked. That was the owner's original complaint about this list. */}
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 items-center gap-2.5 text-left"
        >
          <FolderGlyph shared={folder.memberAccess !== 'none'} />
          <span className="min-w-0">
            <span className="block truncate text-body-sm text-text-primary" title={folder.name}>
              {folder.name}
            </span>
            {(folder.projectName || isWatched) && (
              <span className="block truncate text-micro text-text-tertiary">
                {folder.projectName}
                {folder.projectName && isWatched && ' · '}
                {isWatched && 'auto-projects'}
              </span>
            )}
          </span>
        </button>
      </td>

      <td className="px-3 py-2.5 text-right text-body-sm tabular-nums text-text-secondary">
        {folder.driveFileCount === null ? (
          <span className="text-text-tertiary" title="Not counted yet — run a Drive sync">
            —
          </span>
        ) : (
          /* `+` when the folder holds more children than one Drive page reports,
             so the number is honestly a floor rather than quietly wrong. */
          `${folder.driveFileCount}${folder.fileCountPartial ? '+' : ''}`
        )}
      </td>

      <td className="px-3 py-2.5">
        <OwnerStack owners={folder.owners} />
      </td>

      <td className="px-3 py-2.5">
        <ModifiedCell folder={folder} nowMs={nowMs} />
      </td>

      <td className="px-3 py-2.5 text-right text-body-sm tabular-nums text-text-secondary">
        <SizeCell folder={folder} />
      </td>

      <td className="px-3 py-2.5">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${pill.token}) 14%, transparent)`,
            color: `var(--${pill.token})`,
          }}
          title={ACCESS_META[folder.memberAccess].label}
        >
          {pill.label}
        </span>
      </td>

      <td className="px-3 py-2.5 text-right">
        <RowMenu
          folder={folder}
          canShare={canShare}
          onOpen={onOpen}
          onAccess={onAccess}
          onTrash={onTrash}
          onUploadHere={onUploadHere}
        />
      </td>
    </tr>
  );
}

/** The mockup's amber folder, tinted green once it is open to members. */
function FolderGlyph({ shared }: { shared: boolean }) {
  const token = shared ? 'status-done' : 'accent-gold';
  return (
    <span aria-hidden="true" className="shrink-0">
      <svg width="20" height="20" viewBox="0 0 24 24" role="presentation" focusable="false">
        <path
          d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.2a2 2 0 0 1 1.5.7l1 1.2a1 1 0 0 0 .8.4h5.5A2.5 2.5 0 0 1 20 8.8v8.7A2.5 2.5 0 0 1 17.5 20h-12A2.5 2.5 0 0 1 3 17.5z"
          fill={`var(--${token})`}
        />
        {/* A lighter lip along the top, so the shape reads as a folder rather than
            a rounded rectangle at 20px. */}
        <path
          d="M3 8.6h17v1.1H3z"
          fill="#ffffff"
          opacity="0.28"
        />
      </svg>
    </span>
  );
}

/**
 * The Owner / Team stack.
 *
 * ⚠️ These are GOOGLE accounts from Drive, not this system's users — most will
 * never have a login here. `Avatar` takes the remote `photo` and falls back to
 * initials on its own, which is why nothing here checks whether the URL loads.
 *
 * Three faces then a count, as the mockup draws it. The sync caps the list at
 * five, so "+2" is a real number rather than an elision of an unknown.
 */
function OwnerStack({ owners }: { owners: DriveFolderRow['owners'] }) {
  if (owners.length === 0) {
    return (
      <span className="text-caption text-text-tertiary" title="Nobody has filed anything here yet">
        —
      </span>
    );
  }

  const shown = owners.slice(0, 3);
  const rest = owners.length - shown.length;

  return (
    <span className="flex items-center">
      <span className="flex -space-x-1.5">
        {shown.map((owner) => (
          <Avatar
            key={owner.email ?? owner.name}
            name={owner.name}
            src={owner.photo}
            size="xs"
            ring
            className="ring-2 ring-bg-surface"
          />
        ))}
      </span>
      {rest > 0 && (
        <span
          className="ml-1 inline-flex size-6 items-center justify-center rounded-full bg-bg-active text-micro font-semibold text-text-secondary ring-2 ring-bg-surface"
          title={owners
            .slice(3)
            .map((o) => o.name)
            .join(', ')}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/**
 * When the files inside last changed, and who owns them.
 *
 * ⚠️ Two different dates, and the distinction is the point. `driveModifiedAt` is
 * when a file in the folder was last edited — the useful answer. `filesCountedAt`
 * is when this system last ASKED Drive, which is all there is to say about a
 * folder Drive reported no modified time for. Showing the second as if it were the
 * first would claim activity that never happened.
 */
function ModifiedCell({ folder, nowMs }: { folder: DriveFolderRow; nowMs: number }) {
  const owner = folder.owners[0]?.name ?? null;

  if (folder.driveModifiedAt) {
    return (
      <span className="block min-w-0">
        <span className="block truncate text-body-sm text-text-primary">
          {dayLabel(folder.driveModifiedAt, nowMs)}
        </span>
        {owner && <span className="block truncate text-micro text-text-tertiary">by {owner}</span>}
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <span className="block text-body-sm text-text-tertiary">—</span>
      <span className="block truncate text-micro text-text-tertiary">
        {folder.filesCountedAt ? `synced ${dayLabel(folder.filesCountedAt, nowMs)}` : 'never synced'}
      </span>
    </span>
  );
}

/**
 * Size, and the one case where a real 0 is not an empty folder.
 *
 * ⚠️ Google Docs, Sheets and Slides report NO byte size — they live in Google's
 * own format and the API omits the field. So a folder of twelve Google Docs is
 * honestly "12 files, 0 B", and printing a bare "0 B" there looks like a bug in
 * this table rather than a fact about Drive. When nothing in the folder reported a
 * size, the cell says so instead.
 */
function SizeCell({ folder }: { folder: DriveFolderRow }) {
  if (folder.driveSizeBytes === null) {
    return (
      <span className="text-text-tertiary" title="Not counted yet — run a Drive sync">
        —
      </span>
    );
  }

  const files = folder.driveFileCount ?? 0;
  const sized = folder.driveSizedFileCount ?? 0;

  if (folder.driveSizeBytes === 0 && files > 0 && sized === 0) {
    return (
      <span
        className="text-text-tertiary"
        title="Google Docs, Sheets and Slides have no byte size, so Drive reports none for this folder"
      >
        n/a
      </span>
    );
  }

  return (
    <span title={sized < files ? `${files - sized} file(s) report no size (Google formats)` : undefined}>
      {formatFileSize(folder.driveSizeBytes)}
    </span>
  );
}

/**
 * `12 May 2026` — or `today` / `yesterday` for the two that read better as words.
 *
 * ⚠️ Formatted from the SERVER's clock, passed in. A component that reads its own
 * clock renders one string on the server and another in the browser, which is a
 * hydration mismatch — the rule in lib/now.ts. The locale is pinned for the same
 * reason: whatever ICU data the host carries must not change the output.
 */
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

/* ---- Checkbox ------------------------------------------------------------ */

/** A native checkbox, styled with `accent-color`. The browser already gets the
 *  keyboard, the focus ring and the indeterminate semantics right. */
function Tick({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-4 cursor-pointer rounded border-border-strong"
      style={{ accentColor: 'var(--accent-primary)' }}
    />
  );
}

/* ---- Menus --------------------------------------------------------------- */

/** ⚠️ `<details>` for the free keyboard behaviour, plus an outside-click and
 *  Escape handler, which the element does NOT provide — the owner hit exactly that
 *  gap on the reports page. `mousedown`, not `click`, so choosing an item cannot
 *  race the close. */
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

  /* Menus of one-shot actions close on a pick; a panel of toggles must not, or
     ticking two filters would take two openings. */
  return closeOnPick
    ? { onClick: () => ref.current?.removeAttribute('open') }
    : {};
}

const TRIGGER =
  'flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border px-3.5 ' +
  'text-body-sm font-semibold marker:content-none [&::-webkit-details-marker]:hidden';

const PANEL =
  'absolute right-0 z-30 mt-1 w-[15rem] overflow-hidden rounded-xl border ' +
  'border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]';

const ITEM =
  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-caption ' +
  'text-text-secondary hover:bg-bg-hover hover:text-text-primary';

function FiltersMenu({
  access,
  onlyWithFiles,
  count,
  onAccess,
  onOnlyWithFiles,
  onClear,
}: {
  access: FolderAccess | 'any';
  onlyWithFiles: boolean;
  count: number;
  onAccess: (next: FolderAccess | 'any') => void;
  onOnlyWithFiles: (next: boolean) => void;
  onClear: () => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, false);

  const OPTIONS: ReadonlyArray<readonly [FolderAccess | 'any', string]> = [
    ['any', 'Any access'],
    ['none', 'Private'],
    ['view', 'Shared'],
    ['upload', 'Open'],
    ['manage', 'Full'],
  ];

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Filter folders"
        className={cn(
          TRIGGER,
          count > 0
            ? 'border-border-brand text-text-primary'
            : 'border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
        )}
      >
        <SlidersHorizontal className="size-4" strokeWidth={2.25} aria-hidden="true" />
        Filters
        {count > 0 && (
          <span className="rounded-full bg-accent-primary px-1.5 text-micro font-bold text-text-on-brand">
            {count}
          </span>
        )}
        <ChevronDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </summary>

      <div {...dismiss} className={cn(PANEL, 'left-0 right-auto')}>
        <p className="px-3 pb-1 pt-1.5 text-micro font-bold uppercase tracking-wide text-text-tertiary">
          Access
        </p>
        {OPTIONS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => onAccess(value)} className={ITEM}>
            {label}
            {access === value && <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />}
          </button>
        ))}

        <div className="my-1 h-px bg-border-subtle" />

        <button type="button" onClick={() => onOnlyWithFiles(!onlyWithFiles)} className={ITEM}>
          Only folders with files
          {onlyWithFiles && <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />}
        </button>

        {count > 0 && (
          <>
            <div className="my-1 h-px bg-border-subtle" />
            <button type="button" onClick={onClear} className={ITEM}>
              Clear filters
            </button>
          </>
        )}
      </div>
    </details>
  );
}

function SortMenu({
  sort,
  onSort,
}: {
  sort: { key: SortKey; desc: boolean };
  onSort: (next: { key: SortKey; desc: boolean }) => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, true);

  const OPTIONS: ReadonlyArray<readonly [SortKey, string]> = [
    ['name', 'Folder name'],
    ['files', 'Files'],
    ['modified', 'Last modified'],
    ['size', 'Size'],
  ];

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Sort folders"
        title="Sort"
        className={cn(
          TRIGGER,
          'border-border-default px-3 text-text-secondary',
          'hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
        )}
      >
        <ArrowUpDown
          className={cn('size-4', sort.desc && 'scale-y-[-1]')}
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <ChevronDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </summary>

      <div {...dismiss} className={PANEL}>
        {OPTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onSort({ key, desc: sort.key === key ? !sort.desc : key !== 'name' })}
            className={ITEM}
          >
            {label}
            {sort.key === key && (
              <span className="text-micro font-bold">{sort.desc ? '↓' : '↑'}</span>
            )}
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * Upload, with the Drive re-read behind its chevron.
 *
 * The mockup draws a split button. The second action is the folder sync, because
 * that is the only other thing on this screen that brings files in — and it was
 * previously a full-width button labelled "Read folders from Drive" competing with
 * Upload for attention when it is pressed once a week.
 */
function UploadButton({
  busy,
  canShare,
  onUpload,
  onSync,
}: {
  busy: boolean;
  canShare: boolean;
  onUpload: () => void;
  onSync: () => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, true);

  return (
    <span className="flex items-stretch">
      <button
        type="button"
        onClick={onUpload}
        className={cn(
          'flex h-10 items-center gap-2 rounded-l-xl bg-accent-primary px-4',
          'text-body-sm font-semibold text-text-on-brand hover:bg-accent-primary-hover',
        )}
      >
        <Upload className="size-4" strokeWidth={2.25} aria-hidden="true" />
        Upload
      </button>

      {canShare && (
        <details ref={ref} className="relative">
          <summary
            aria-label="More ways to add files"
            className={cn(
              'flex h-10 cursor-pointer list-none items-center rounded-r-xl border-l px-2',
              'bg-accent-primary text-text-on-brand marker:content-none',
              'hover:bg-accent-primary-hover [&::-webkit-details-marker]:hidden',
            )}
            style={{ borderColor: 'color-mix(in oklab, #000 18%, transparent)' }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" strokeWidth={2.5} aria-hidden="true" />
            )}
          </summary>

          <div {...dismiss} className={PANEL}>
            <button type="button" onClick={onSync} disabled={busy} className={ITEM}>
              <span className="flex items-center gap-2">
                <RefreshCw className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Read folders from Drive
              </span>
            </button>
          </div>
        </details>
      )}
    </span>
  );
}

function RowMenu({
  folder,
  canShare,
  onOpen,
  onAccess,
  onTrash,
  onUploadHere,
}: {
  folder: DriveFolderRow;
  canShare: boolean;
  onOpen: () => void;
  onAccess: () => void;
  onTrash: () => void;
  onUploadHere: () => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const dismiss = useDismiss(ref, true);

  return (
    <details ref={ref} className="relative inline-block">
      <summary
        aria-label={`Actions for ${folder.name}`}
        className={cn(
          'flex size-8 cursor-pointer list-none items-center justify-center rounded-lg',
          'text-text-tertiary marker:content-none hover:bg-bg-active hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div {...dismiss} className={PANEL}>
        <button type="button" onClick={onOpen} className={ITEM}>
          Open folder
        </button>

        {/* ⚠️ `noopener` is not optional on a `_blank` link: without it the opened
            tab gets a handle on this one through `window.opener`. */}
        <a
          href={`https://drive.google.com/drive/folders/${folder.driveFolderId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={ITEM}
        >
          <span>Open in Drive</span>
          <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </a>

        {canShare && (
          <>
            <button type="button" onClick={onUploadHere} className={ITEM}>
              Upload here
            </button>
            <button type="button" onClick={onAccess} className={ITEM}>
              Who can see this
            </button>

            <div className="my-1 h-px bg-border-subtle" />

            <button
              type="button"
              onClick={onTrash}
              className={cn(ITEM, 'text-[var(--feedback-error)] hover:text-[var(--feedback-error)]')}
            >
              <span className="flex items-center gap-2">
                <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Move to Drive bin
              </span>
            </button>
          </>
        )}
      </div>
    </details>
  );
}
