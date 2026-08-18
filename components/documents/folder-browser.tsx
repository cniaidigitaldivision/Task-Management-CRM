'use client';

import * as React from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Film,
  FolderPlus,
  Folder as FolderIcon,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';

import {
  createFolderAction,
  listFolderFilesAction,
  syncFoldersAction,
  type FolderFile,
} from '@/app/actions/folders';
import { setWatchedFolderAction, type DocumentResult } from '@/app/actions/documents';
import type { DriveFolderRow } from '@/lib/db/queries/drive-folders';
import { ACCESS_META } from '@/lib/domain/folder-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

import { FileViewer, formatFileSize, openPdf } from './file-viewer';
import { FolderAccessDialog } from './folder-access-dialog';

/* ============================================================================
 * FOLDERS, AND WHAT IS IN THEM — owner request 2026-08-18
 * ----------------------------------------------------------------------------
 * *"when I click on some folder it should open and show all the files which are
 * present in that folder… the list of folders is fine but it is very long."*
 *
 * Both complaints have one answer: the list becomes a place you go INTO. A folder
 * is a row until you click it, and then the panel is that folder's files with a
 * way back. Nothing is stacked below anything else, so the page stops growing
 * with the number of folders.
 *
 * ── SEARCH RATHER THAN PAGINATION ────────────────────────────────────────────
 * Thirty-two folders is too many to scan and far too few to page through. A
 * filter box answers "where is Chitral Royal Homes" in one keystroke, which is
 * the actual question; a pager answers "what is on page 2", which is nobody's.
 * ========================================================================= */

const FILE_ICON: Record<FolderFile['kind'], typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  video: Film,
  audio: Music,
  text: FileText,
  google: FileText,
  other: FileText,
};

export function FolderBrowser({
  folders,
  canShare,
  canConfigure,
  watchedDriveId,
  onDone,
}: {
  folders: readonly DriveFolderRow[];
  canShare: boolean;
  canConfigure: boolean;
  watchedDriveId: string | null;
  onDone: (result: DocumentResult) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [openFolder, setOpenFolder] = React.useState<DriveFolderRow | null>(null);
  const [accessFor, setAccessFor] = React.useState<DriveFolderRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(needle));
  }, [folders, query]);

  if (openFolder) {
    return (
      <FolderContents
        /* Remounts on a folder change, so state starts clean — see the effect
           inside. */
        key={openFolder.id}
        folder={openFolder}
        canShare={canShare}
        onBack={() => setOpenFolder(null)}
        onManageAccess={() => setAccessFor(openFolder)}
        accessDialog={
          accessFor && (
            <FolderAccessDialog
              folder={accessFor}
              onClose={() => setAccessFor(null)}
              onDone={onDone}
            />
          )
        }
      />
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body-sm font-semibold text-text-primary">
            Folders
            {folders.length > 0 && (
              <span className="ml-2 font-normal text-text-tertiary">
                {folders.filter((f) => f.memberAccess !== 'none').length} of {folders.length} open
                to members
              </span>
            )}
          </p>

          {canShare && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                <FolderPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                New folder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('sync');
                  try {
                    onDone(await syncFoldersAction());
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === 'sync' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                )}
                Read folders from Drive
              </Button>
            </div>
          )}
        </div>

        {folders.length > 6 && (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Find among ${folders.length} folders…`}
              aria-label="Filter folders"
              className="pl-9"
            />
          </div>
        )}

        {folders.length === 0 ? (
          <p className="text-caption text-text-secondary">
            {canShare
              ? 'No folders recorded yet. Press "Read folders from Drive" — with no watched folder set it reads My Drive, so you do not need an id to get started.'
              : 'No folders have been opened to members yet.'}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-caption text-text-secondary">
            No folder matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {shown.map((folder) => {
              const meta = ACCESS_META[folder.memberAccess];
              return (
                <li key={folder.id} className="flex flex-wrap items-center gap-2 py-2">
                  {/* The whole name is the control. A folder that looks like a
                      folder should open when clicked — the owner's first
                      complaint was that it did not. */}
                  <button
                    type="button"
                    onClick={() => setOpenFolder(folder)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-bg-hover"
                  >
                    <FolderIcon
                      className="h-4 w-4 shrink-0"
                      strokeWidth={2.25}
                      aria-hidden="true"
                      style={{ color: `var(--${meta.token})` }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm text-text-primary">
                        {folder.name}
                      </span>
                      <span className="block text-micro text-text-tertiary">
                        {folder.projectName ? `${folder.projectName} · ` : ''}
                        {folder.driveFileCount === null
                          ? 'not counted yet'
                          : `${folder.driveFileCount}${folder.fileCountPartial ? '+' : ''} ${
                              folder.driveFileCount === 1 && !folder.fileCountPartial
                                ? 'file'
                                : 'files'
                            }`}
                        {folder.documentCount > 0 && ` · ${folder.documentCount} via the CRM`}
                      </span>
                    </span>
                    <ChevronRight
                      className="ml-auto h-4 w-4 shrink-0 text-text-tertiary"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </button>

                  <Badge token={meta.token} size="sm" variant="outline">
                    {meta.label}
                  </Badge>

                  {canShare && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAccessFor(folder)}
                      title={`Choose who can see ${folder.name}`}
                    >
                      <Users className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                      Access
                    </Button>
                  )}

                  {canConfigure &&
                    (folder.driveFolderId === watchedDriveId ? (
                      <Badge token="accent-primary" size="sm" variant="outline">
                        New subfolders → projects
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        title="Make new subfolders of this folder become draft projects"
                        onClick={async () => {
                          setBusy(folder.id);
                          try {
                            onDone(await setWatchedFolderAction(folder.driveFolderId));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === folder.id && (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        )}
                        Auto-project
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
        )}

        {canShare && folders.length > 0 && (
          <p className="text-micro text-text-tertiary">
            <span className="font-semibold text-text-secondary">Can upload</span> and above mean a
            member&rsquo;s file goes straight to Drive without waiting for approval — granting the
            access is the approval. Access applies to that folder only, never the folders inside
            it.
          </p>
        )}
      </CardBody>

      {accessFor && (
        <FolderAccessDialog
          folder={accessFor}
          onClose={() => setAccessFor(null)}
          onDone={onDone}
        />
      )}

      {creating && (
        <NewFolderDialog
          folders={folders}
          onClose={() => setCreating(false)}
          onDone={(r) => {
            setCreating(false);
            onDone(r);
          }}
        />
      )}
    </Card>
  );
}

/* ---- Inside one folder ---------------------------------------------------- */

function FolderContents({
  folder,
  canShare,
  onBack,
  onManageAccess,
  accessDialog,
}: {
  folder: DriveFolderRow;
  canShare: boolean;
  onBack: () => void;
  onManageAccess: () => void;
  accessDialog: React.ReactNode;
}) {
  const [files, setFiles] = React.useState<FolderFile[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<FolderFile | null>(null);

  /* ── NO SYNCHRONOUS RESET, BECAUSE THE PARENT KEYS THIS BY FOLDER ──────────
     Clearing `files` at the top of the effect is the obvious way to avoid showing
     the previous folder's contents for a frame, and the React Compiler lint
     correctly refuses it: setState in an effect body causes a cascading render.
     The parent passes `key={folder.id}` instead, so switching folders REMOUNTS
     this component with fresh state and there is nothing to reset. */
  React.useEffect(() => {
    let cancelled = false;

    void listFolderFilesAction(folder.id).then((result) => {
      /* A folder the person has already navigated away from must not overwrite
         the one they are now looking at. */
      if (cancelled) return;
      if (result.ok) setFiles(result.files);
      else setError(result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [folder.id]);

  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              All folders
            </Button>
            <span className="truncate text-body-sm font-semibold text-text-primary">
              {folder.name}
            </span>
          </div>

          {canShare && (
            <Button variant="ghost" size="sm" onClick={onManageAccess}>
              <Users className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              Access
            </Button>
          )}
        </div>

        {files === null && !error && (
          <p className="flex items-center gap-2 py-4 text-caption text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading {folder.name} from Drive…
          </p>
        )}

        {error && (
          <p className="py-4 text-caption" style={{ color: 'var(--feedback-error)' }}>
            {error}
          </p>
        )}

        {files !== null && files.length === 0 && (
          <p className="py-4 text-caption text-text-secondary">
            This folder has no files in it. Subfolders are listed on the folders screen, not here.
          </p>
        )}

        {files !== null && files.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {files.map((file) => {
              const Icon = FILE_ICON[file.kind];
              const viewable = file.kind !== 'google' && file.kind !== 'other';

              return (
                <li key={file.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-bg-hover"
                    onClick={() => {
                      /* The owner's own split: a PDF gets the whole window and
                         the browser's native viewer; everything else stays in
                         context. */
                      if (file.kind === 'pdf') openPdf(file);
                      else setViewing(file);
                    }}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-text-tertiary"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm text-text-primary">
                        {file.name}
                      </span>
                      <span className="block text-micro text-text-tertiary">
                        {formatFileSize(file.size)}
                        {file.kind === 'google' && ' · Google format, opens in Drive only'}
                        {!viewable && file.kind !== 'google' && ' · no preview'}
                      </span>
                    </span>
                    {file.kind === 'pdf' && (
                      <span className="text-micro text-text-tertiary">opens in a new tab</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
      {accessDialog}
    </Card>
  );
}

/* ---- New folder ----------------------------------------------------------- */

function NewFolderDialog({
  folders,
  onClose,
  onDone,
}: {
  folders: readonly DriveFolderRow[];
  onClose: () => void;
  onDone: (result: DocumentResult) => void;
}) {
  const [name, setName] = React.useState('');
  const [parent, setParent] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="New folder in Drive"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await createFolderAction(name, parent || null));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="newFolderName">
          <Input
            id="newFolderName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ABC Traders — 2026"
          />
        </Field>

        <Field
          label="Inside"
          htmlFor="newFolderParent"
          hint="Only folders the CRM already knows about can be a parent."
        >
          <select
            id="newFolderParent"
            value={parent}
            onChange={(event) => setParent(event.target.value)}
            className="h-9 w-full rounded-lg border border-border-default bg-bg-surface px-3 text-body-sm text-text-primary"
          >
            <option value="">My Drive (top level)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>

        <p className="text-micro text-text-tertiary">
          It is created in Google Drive straight away and starts private — Coordinators and above
          only, until you give access.
        </p>
      </div>
    </Dialog>
  );
}
