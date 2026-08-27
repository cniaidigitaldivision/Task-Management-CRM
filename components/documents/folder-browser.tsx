'use client';

import * as React from 'react';
import {
  ArrowLeft,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Trash2,
  Upload as FileUp,
  Users,
} from 'lucide-react';

import {
  createFolderAction,
  listFolderFilesAction,
  syncFoldersAction,
  trashFilesAction,
  trashFolderAction,
  type FolderFile,
} from '@/app/actions/folders';
import type { DocumentResult } from '@/app/actions/documents';
import type { DriveFolderRow } from '@/lib/db/queries/drive-folders';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { FileViewer, formatFileSize, openPdf } from './file-viewer';
import { FolderAccessDialog } from './folder-access-dialog';
import { FolderTable } from './folder-table';

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
  nowMs,
  onUploadHere,
  onDone,
}: {
  folders: readonly DriveFolderRow[];
  canShare: boolean;
  canConfigure: boolean;
  watchedDriveId: string | null;
  /** The server's clock, for the date labels. See lib/now.ts. */
  nowMs: number;
  /** Opens the upload dialog with this folder already chosen. Null for "ask me". */
  onUploadHere: (folder: DriveFolderRow | null) => void;
  onDone: (result: DocumentResult) => void;
}) {
  const [openFolder, setOpenFolder] = React.useState<DriveFolderRow | null>(null);
  const [accessFor, setAccessFor] = React.useState<DriveFolderRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [trashingFolder, setTrashingFolder] = React.useState<DriveFolderRow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);


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
        onUploadHere={onUploadHere}
        onDone={onDone}
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

  /* ── ⚠️ NO CARD, NO PARAGRAPHS ──────────────────────────────────────────────
     Owner: *"The UI should be very sleek and beautiful, and don't use extra
     paragraphs, text, and content like right now."*

     What was here: a Card wrapper, a "Folders — 0 of 33 open to members" heading,
     two ghost buttons, a conditional search box, and a closing paragraph
     explaining what "can upload" means. Five pieces of furniture around a list.

     The explanation was not wrong, it was in the wrong place — it belongs in the
     access dialogue, where somebody is actually choosing a level and can act on
     it. On this screen it was read once and then re-read past forever.

     `FolderTable` is the whole view now: a search box, Filters, sort, New folder,
     Upload, and the table. Every control maps to an action that already existed —
     nothing here is new behaviour, it is the same actions in the owner's layout. */
  return (
    <>
      <FolderTable
        folders={folders}
        canShare={canShare}
        canConfigure={canConfigure}
        watchedDriveId={watchedDriveId}
        nowMs={nowMs}
        busy={busy}
        onOpen={setOpenFolder}
        onAccess={setAccessFor}
        onTrash={setTrashingFolder}
        onUploadHere={onUploadHere}
        onNewFolder={() => setCreating(true)}
        /* Upload with no folder chosen: the dialogue asks for one. Uploading from
           a ROW pre-selects it, which is why they are separate handlers. */
        onUpload={() => onUploadHere(null)}
        onSync={async () => {
          setBusy('sync');
          try {
            onDone(await syncFoldersAction());
          } finally {
            setBusy(null);
          }
        }}
      />

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

      {/* ── DELETING A FOLDER TAKES ITS CONTENTS, AND SAYS THE NUMBER ─────────
          Drive trashes children with the parent. A confirmation that said only
          "are you sure" would be hiding the part that matters, so the count is in
          the sentence — and it is the Drive count, not the CRM one, because that
          is what actually goes. */}
      {trashingFolder && (
        <Dialog
          open
          onClose={() => setTrashingFolder(null)}
          size="sm"
          title={`Move "${trashingFolder.name}" to the bin?`}
          footer={
            <>
              <Button
                variant="ghost"
                size="md"
                disabled={busy !== null}
                onClick={() => setTrashingFolder(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={busy !== null}
                onClick={async () => {
                  const target = trashingFolder;
                  setBusy(target.id);
                  try {
                    onDone(await trashFolderAction(target.id));
                  } finally {
                    setBusy(null);
                    setTrashingFolder(null);
                  }
                }}
              >
                {busy === trashingFolder.id && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Move to bin
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-text-primary">
            {trashingFolder.driveFileCount === null
              ? 'Everything inside it goes too.'
              : trashingFolder.driveFileCount === 0
                ? 'It looks empty, so nothing else goes with it.'
                : `The ${trashingFolder.driveFileCount}${
                    trashingFolder.fileCountPartial ? '+' : ''
                  } ${
                    trashingFolder.driveFileCount === 1 ? 'file' : 'files'
                  } inside it go too, along with any subfolders.`}
          </p>
          <p className="mt-2 text-caption text-text-secondary">
            It goes to the Google Drive bin and can be restored there for{' '}
            <strong>30 days</strong>. Anyone named on this folder loses that access.
          </p>
        </Dialog>
      )}
    </>
  );
}

/* ---- Inside one folder ---------------------------------------------------- */

function FolderContents({
  folder,
  canShare,
  onBack,
  onManageAccess,
  onUploadHere,
  onDone,
  accessDialog,
}: {
  folder: DriveFolderRow;
  canShare: boolean;
  onBack: () => void;
  onManageAccess: () => void;
  onUploadHere: (folder: DriveFolderRow) => void;
  onDone: (result: DocumentResult) => void;
  accessDialog: React.ReactNode;
}) {
  const [files, setFiles] = React.useState<FolderFile[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<FolderFile | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [confirmTrash, setConfirmTrash] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const anySelected = selected.size > 0;
  const allSelected = files !== null && files.length > 0 && selected.size === files.length;
  const someSelected = anySelected && !allSelected;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

          <div className="flex flex-wrap items-center gap-2">
            {/* Uploading INTO the folder you are looking at. The button was only
                on the register tab, so filing something into a specific folder
                meant leaving, uploading, and choosing the folder from a dropdown
                — having just been looking at it. */}
            <Button variant="secondary" size="sm" onClick={() => onUploadHere(folder)}>
              <FileUp className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              Upload here
            </Button>

            {canShare && (
              <Button variant="ghost" size="sm" onClick={onManageAccess}>
                <Users className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                Access
              </Button>
            )}
          </div>
        </div>

        {/* ── THE BULK BAR APPEARS ONLY WHEN SOMETHING IS SELECTED ────────────
            A permanently visible "Delete selected" that is disabled most of the
            time is noise; one that appears when it can act tells you the
            selection registered. */}
        {anySelected && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--accent-primary) 10%, transparent)',
            }}
          >
            <label className="flex cursor-pointer items-center gap-2 text-caption text-text-primary">
              {/* Select-all, as asked. `indeterminate` is set through a ref
                  because it is a DOM property with no HTML attribute — React
                  cannot express it as a prop. Without it, "3 of 12 selected"
                  would show an unchecked box, which reads as "nothing selected". */}
              <input
                type="checkbox"
                ref={(node) => {
                  if (node) node.indeterminate = someSelected && !allSelected;
                }}
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set((files ?? []).map((f) => f.id)))
                }
                aria-label={allSelected ? 'Clear selection' : 'Select every file'}
                className="h-4 w-4 cursor-pointer accent-[var(--accent-primary)]"
              />
              {selected.size} of {files?.length ?? 0} selected
            </label>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmTrash(true)}
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                Move to bin
              </Button>
            </div>
          </div>
        )}

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
                <li key={file.id} className="group/row flex items-center gap-2">
                  {/* ── THE CHECKBOX IS INVISIBLE UNTIL IT IS WANTED ───────────
                      Owner, 2026-08-18: *"Don't show checkboxes without
                      selection. When I hold some row, the checkboxes start
                      appearing."*

                      A column of empty boxes down a file list is noise for the
                      99% of visits that are "let me look at that video". So it
                      fades in on hover, on keyboard focus, and stays put once
                      anything is selected.

                      ⚠️ `opacity`, NOT `hidden` or conditional rendering. The
                      input must stay in the DOM and in the tab order, or a
                      keyboard user could never reach it — you cannot focus what
                      does not exist, and hover is not available to them. */}
                  <input
                    type="checkbox"
                    checked={selected.has(file.id)}
                    onChange={() => toggle(file.id)}
                    aria-label={`Select ${file.name}`}
                    className={cn(
                      'h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent-primary)]',
                      'transition-opacity duration-[120ms]',
                      'group-hover/row:opacity-100 focus-visible:opacity-100',
                      anySelected ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-bg-hover"
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

      {confirmTrash && (
        <Dialog
          open
          onClose={() => setConfirmTrash(false)}
          size="sm"
          title={`Move ${selected.size} ${selected.size === 1 ? 'file' : 'files'} to the bin?`}
          footer={
            <>
              <Button
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setConfirmTrash(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await trashFilesAction(folder.id, [...selected]);
                    onDone(result);
                    if (result.ok) {
                      /* Removed from the list here rather than refetching: the
                         files are gone from Drive and a second round trip would
                         only confirm it more slowly. */
                      setFiles((current) =>
                        (current ?? []).filter((f) => !selected.has(f.id)),
                      );
                      setSelected(new Set());
                    }
                  } finally {
                    setBusy(false);
                    setConfirmTrash(false);
                  }
                }}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Move to bin
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-text-primary">
            They go to the Google Drive bin, not straight out of existence.
          </p>
          <p className="mt-2 text-caption text-text-secondary">
            Anybody with the Drive can restore them for <strong>30 days</strong>. Nothing here can
            delete a file permanently — that is deliberate.
          </p>
        </Dialog>
      )}
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
