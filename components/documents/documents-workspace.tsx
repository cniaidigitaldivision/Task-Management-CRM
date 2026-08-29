'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Folder as FolderIcon,
  FolderOpen,
  Settings,
} from 'lucide-react';

import {
  approveDocumentAction,
  deleteDocumentAction,
  pendingFileUrlAction,
  rejectDocumentAction,
  type DocumentResult,
} from '@/app/actions/documents';
import type { DocumentRow } from '@/lib/db/queries/documents';
import type { DriveSyncRow } from '@/lib/db/queries/documents';
import type { DriveFolderRow } from '@/lib/db/queries/drive-folders';
import type { LibraryDocumentRow } from '@/lib/db/queries/library';
import { accessAtLeast } from '@/lib/domain/folder-access';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { UploadDialog } from './upload-dialog';
import { ProjectFilesPanel } from './project-files-panel';
import { DriveSettings } from './drive-settings';
import { RegisterTable } from './register-table';

import { FolderBrowser } from './folder-browser';
import { LibraryPanel } from './library-panel';

/* ============================================================================
 * DOCUMENTS — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * The register, and the queue of uploads waiting to go into Google Drive.
 *
 * ── THE QUEUE IS THE POINT OF THIS SCREEN ────────────────────────────────────
 * So it opens on Waiting, not on everything. An approver arriving needs to see
 * what is asked of them; the full list is a reference they go looking for.
 *
 * ── WHAT "PENDING" MEANS IS SAID EVERYWHERE IT MATTERS ───────────────────────
 * A pending document is **not in Drive**. That is easy to assume the other way
 * round — the file uploaded, so surely it arrived — and the whole approval step
 * exists because it has not. Every pending row says so.
 * ========================================================================= */


/* ⚠️ `FILTER_LABEL` and `WHERE` moved into ./register-table.tsx along with the
   controls that read them. The reasoning they carried is worth keeping and lives
   there: this tab filters by STATE — has somebody decided — while WHERE the bytes
   are is a separate question, because since migration 048 an accepted document
   normally sits in this system's own storage rather than in Drive. One control
   answering both is how a screen comes to claim that accepting moves a file. */

type Tab = 'folders' | 'projects' | 'approvals' | 'library' | 'settings';

/* ============================================================================
 * THE TABS, AND WHO SEES WHICH — revised 2026-08-24
 * ----------------------------------------------------------------------------
 * Owner: *"In the team member, in the documentation, they should show only:
 * Folder, File, Company library, Projects documentation… Register and approval
 * should only be for the admin, super admin, or team coordinator. Below the team
 * level this should not be visible."*
 *
 * ── ⚠️ ORDER IS THE ORDER OF USE, not of importance ──────────────────────────
 * Browsing Drive folders and looking up a project's files are the daily jobs, so
 * they are first and one of them is the default. Approvals are frequent but
 * occasional. The connection is set up once and then never touched, so it is last.
 *
 * ── ⚠️ TWO DIFFERENT GATES, AND THEY ARE NOT THE SAME PEOPLE ─────────────────
 *   `approverOnly`  `document.approve` — Super Admin, Admin, Team Coordinator.
 *                   The register is a DECISION QUEUE; to somebody who cannot
 *                   decide it is a list of other people's business sorted by a
 *                   question they cannot answer.
 *   `adminOnly`     `drive.configure` — connecting Google Drive. A narrower set.
 *
 * ⚠️ HIDING THE REGISTER FROM A MEMBER IS ONLY SAFE BECAUSE OF THE NEW TAB. Their
 * own pending upload, and — the part that matters — a REFUSAL with its reason, was
 * visible on the register and nowhere else. `ProjectFilesPanel` carries both on the
 * row. Removing a tab without checking what was only reachable through it is how a
 * person stops being told their work was rejected.
 * ========================================================================= */
const TABS: ReadonlyArray<{
  key: Tab;
  label: string;
  icon: typeof FolderIcon;
  /**
   * The icon's colour token.
   *
   * ⚠️ ONE HUE PER TAB, and it is not decoration. The owner's layout draws five
   * cards whose icons differ in colour, and the reason it works is that the colour
   * is the thing you learn: after a week nobody reads "Register & approvals", they
   * go to the purple one. Five identical grey icons would make the five cards a
   * wall of text with pictures on it.
   *
   * These are semantic tokens rather than a rainbow picked here — the same green
   * that means "done" elsewhere, the same amber that means "waiting".
   */
  tint: string;
  adminOnly?: boolean;
  approverOnly?: boolean;
}> = [
  { key: 'folders', label: 'Folders & files', icon: FolderIcon, tint: 'status-done' },
  { key: 'projects', label: 'Project files', icon: FolderOpen, tint: 'status-todo' },
  {
    key: 'approvals',
    label: 'Register & approvals',
    icon: CheckCircle2,
    tint: 'status-progress',
    approverOnly: true,
  },
  { key: 'library', label: 'Company library', icon: BookOpen, tint: 'status-revisions' },
  { key: 'settings', label: 'Drive settings', icon: Settings, tint: 'status-backlog', adminOnly: true },
];

export function DocumentsWorkspace({
  documents,
  projects,
  canApprove,
  canManage,
  canManageLibrary,
  canConfigure,
  canShare,
  nowMs,
  folders,
  library,
  drive,
}: {
  documents: readonly DocumentRow[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  canApprove: boolean;
  canManage: boolean;
  /** `library.manage` — Admin+, and deliberately NOT `canManage`. See the note
   *  where it is used, and the entry in lib/domain/permissions.ts. */
  canManageLibrary: boolean;
  canConfigure: boolean;
  /** Coordinator and above: may share a folder with members, and may file into
   *  any folder rather than only the shared ones. */
  canShare: boolean;
  /** The server clock, for every date label below. See lib/now.ts — a component
   *  that reads its own clock renders one string on the server and another in the
   *  browser, which is a hydration mismatch. */
  nowMs: number;
  folders: readonly DriveFolderRow[];
  /** The agency's own reference material — migration 035. */
  library: readonly LibraryDocumentRow[];
  drive: {
    configured: boolean;
    connected: boolean;
    account: string | null;
    lastError: string | null;
    /** Formatted on the SERVER — see lib/now.ts. Null when never checked. */
    lastCheckedLabel: string | null;
    sync: DriveSyncRow | null;
    drafts: Array<{ id: string; name: string; driveFolderId: string | null }>;
    /** ISO. From `drive_connection.connected_at` — see the status strip. */
    connectedAt: string | null;
    /** What the last sync actually left behind. Counted on the server. */
    registry: { folders: number; files: number };
    /** The watched folder's own name, resolved from the registry. Null when unset. */
    watchedFolderName: string | null;
  };
}) {
  const router = useRouter();
  const pendingCount = documents.filter((d) => d.state === 'pending').length;

  /* ── WHERE THE SCREEN OPENS ────────────────────────────────────────────────
     On the approvals tab when something is actually waiting, and on folders
     otherwise. The old layout's failure was that a waiting approval was below
     thirty-two folders; landing on it when it exists is the fix, not just moving
     it into a tab somebody has to remember to check.

     ⚠️ `canApprove` GUARDS IT NOW. Without that a Member would land on a tab that
     is not in their tab bar — the panel would render with no way to navigate away
     from it and no highlighted tab, which reads as a broken page. Found by asking
     what the initial state does once the tab it names can be absent. */
  const [activeTab, setActiveTab] = React.useState<Tab>(
    canApprove && pendingCount > 0 ? 'approvals' : 'folders',
  );
  /* ⚠️ The state, storage and search filters now live INSIDE `RegisterTable`.
     They were here so that a `visible` array could be derived beside them, and
     nothing else on this screen ever read them — the folders, project files and
     library tabs each own their own filtering. Keeping them at this level meant
     switching tabs silently carried the register's filter along. */
  const [uploading, setUploading] = React.useState(false);
  /** Pre-chosen folder when upload was started from inside one. */
  const [uploadInto, setUploadInto] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<DocumentRow | null>(null);
  const [note, setNote] = React.useState<DocumentResult | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);


  /* Coordinator+ files anywhere; everybody else only where they have `upload` or
     better. `view` is deliberately excluded — a folder a Member can read but not
     add to must not appear in the picker at all, or they choose it and are told no
     after selecting the file. Mirrors the check in `requestDocumentAction`, which
     is the one that actually decides.

     ⚠️ The `direct` flag this used to carry is gone. It meant "choosing this
     folder sends the file to Drive with no approval" — a property the FOLDER
     stopped having when the destination became its own field on the form. It is
     now a property of the destination, for everybody, and the dialog says it
     there. */
  const uploadableFolders = React.useMemo(
    () =>
      folders
        .filter((f) => canShare || accessAtLeast(f.memberAccess, 'upload'))
        .map((f) => ({ id: f.id, name: f.name })),
    [folders, canShare],
  );

  const run = async (id: string, fn: () => Promise<DocumentResult>) => {
    setBusy(id);
    try {
      setNote(await fn());
      router.refresh();
    } catch {
      setNote({ ok: false, error: 'That could not be completed — the server did not answer.' });
    } finally {
      setBusy(null);
      setRejecting(null);
    }
  };

  /**
   * Save a document rather than open it.
   *
   * ⚠️ Shares `preview`'s permission check and error handling by design, and
   * differs only in what happens to the signed URL: a real anchor with
   * `download` puts the file on disk, where `window.open` would merely display
   * it. A Drive-hosted row goes to Drive's own page, which is where its download
   * button lives.
   */
  const download = async (doc: DocumentRow) => {
    if (doc.driveWebLink) {
      window.open(doc.driveWebLink, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!doc.storagePath) {
      setNote({ ok: false, error: `${doc.name} has no file attached to it.` });
      return;
    }

    setBusy(doc.id);
    try {
      const result = await pendingFileUrlAction(doc.id);
      if (!result.ok) {
        setNote({ ok: false, error: result.error });
        return;
      }
      const anchorEl = window.document.createElement('a');
      anchorEl.href = result.url;
      anchorEl.download = doc.name;
      window.document.body.append(anchorEl);
      anchorEl.click();
      anchorEl.remove();
    } finally {
      setBusy(null);
    }
  };

  const preview = async (id: string) => {
    setBusy(id);
    try {
      const result = await pendingFileUrlAction(id);
      if (!result.ok) {
        setNote({ ok: false, error: result.error });
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(null);
    }
  };

  /**
   * What each tab has to report.
   *
   * ⚠️ Null means "nothing to count", NOT zero. Drive settings with no draft
   * projects has nothing to say; showing "0" there would read as a measurement of
   * something rather than the absence of anything to measure.
   */
  const TAB_COUNTS: Record<Tab, number | null> = {
    folders: folders.length || null,
    /* Documents attached to a project — what the Project files tab lists. */
    projects: documents.filter((d) => d.projectId !== null).length || null,
    approvals: pendingCount || null,
    library: library.length || null,
    /* The only number this tab owns: draft projects a Drive sync created that
       still need naming. Empty for anybody who cannot configure Drive anyway. */
    settings: drive.drafts.length || null,
  };

  return (
    <div className="space-y-4">
      {/* ══ THE TAB BAR ═══════════════════════════════════════════════════════
          Owner, 2026-08-18: *"connector, the list of folders in the same flow,
          upload in the same flow, approval — it's not looking good and proper,
          professional, easily organized."*

          Quite right: four unrelated jobs were stacked down one page, so the
          approval queue — the thing with a number on it — was below thirty-two
          folders and off the bottom of the screen. Tabs put each job in one place
          and give the page a fixed height regardless of how much Drive holds.

          A real `tablist` with `aria-selected`, matching Settings, so arrow keys
          and screen readers behave. Which tab is open is NOT persisted: it is a
          place in a screen, not a preference. */}
      {/* ── ⚠️ CARDS, NOT A TAB RAIL ────────────────────────────────────────────
          The owner's layout draws five raised cards, each with a coloured icon, a
          label and a count. It replaces a row of text tabs, and the count is the
          reason it is worth the space: "how many folders / how many waiting / how
          big is the library" was previously unanswerable without opening each one.

          ⚠️ EVERY COUNT IS REAL. None is a placeholder — folders is the registry,
          approvals is the pending queue, library is the row count, and Drive
          settings shows the draft projects waiting to be named, which is the only
          number that tab has anything to say about. A tab with nothing to count
          shows no badge rather than a zero, because "0" and "nothing to report"
          read differently and only one of them is true.

          Still a real `tablist` with `aria-selected`, so arrow keys and screen
          readers behave exactly as they did. Which tab is open is NOT persisted: it
          is a place in a screen, not a preference. */}
      <nav
        role="tablist"
        aria-label="Documents sections"
        className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {TABS.filter(
          (tab) => (!tab.adminOnly || canConfigure) && (!tab.approverOnly || canApprove),
        ).map((tab) => {
          const isActive = tab.key === activeTab;
          const count = TAB_COUNTS[tab.key];

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`documents-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`documents-panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left',
                'transition-[border-color,background-color] duration-[140ms]',
                /* The same treatment the owner signed off for the Access tab and
                   the platform filters: constant 2px, brand border when selected,
                   neutral on hover. Never 1px→2px, or the row of cards shifts a
                   pixel as you click along it. */
                isActive
                  ? 'border-border-brand bg-bg-selected'
                  : 'border-border-subtle bg-bg-surface hover:border-border-strong hover:bg-bg-hover',
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: `color-mix(in oklab, var(--${tab.tint}) 15%, transparent)`,
                }}
              >
                <tab.icon
                  className="size-[1.15rem]"
                  strokeWidth={2.25}
                  style={{ color: `var(--${tab.tint})` }}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-caption font-semibold',
                    isActive ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {tab.label}
                </span>
              </span>

              {count !== null && (
                <span
                  className="tabular shrink-0 rounded-full px-1.5 py-0.5 text-micro font-bold"
                  style={{
                    /* ⚠️ The approvals badge is the ONE that changes colour: a
                       waiting decision is the only count on this strip that is a
                       call to action rather than a measurement. */
                    backgroundColor:
                      tab.key === 'approvals'
                        ? 'var(--feedback-warning)'
                        : `color-mix(in oklab, var(--${tab.tint}) 15%, transparent)`,
                    color:
                      tab.key === 'approvals' ? 'var(--text-on-brand)' : `var(--${tab.tint})`,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {note && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok
              ? note.warning
                ? 'var(--feedback-warning)'
                : 'var(--feedback-success)'
              : 'var(--feedback-error)',
          }}
        >
          {!note.ok && (
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          <span>{note.error ?? note.message} {note.warning}</span>
        </p>
      )}

      {/* ---- FOLDERS ------------------------------------------------------ */}
      {activeTab === 'folders' && (
        <div role="tabpanel" id="documents-panel-folders" aria-labelledby="documents-tab-folders">
          <FolderBrowser
            folders={folders}
            canShare={canShare}
            canConfigure={canConfigure}
            watchedDriveId={drive.sync?.watchedFolderId ?? null}
            nowMs={nowMs}
            /* Uploading from inside a folder pre-selects it, so the dialog does
               not ask where to put something you were already looking at.
               ⚠️ NULL means "ask me" — the toolbar's Upload button has no folder in
               mind, and pre-selecting an arbitrary one would file somebody's work
               into whatever happened to be first in the list. */
            onUploadHere={(folder) => {
              setUploadInto(folder?.id ?? null);
              setUploading(true);
            }}
            onDone={(r) => {
              setNote(r);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* ---- PROJECT FILES ------------------------------------------------
          The tab a Member actually wants: what this system holds for each client,
          grouped by project and filterable by type. See the component's header for
          why the three existing tabs did not cover it, and for why a Member's own
          refused upload has to appear here now that the register is hidden from
          them. */}
      {activeTab === 'projects' && (
        <div role="tabpanel" id="documents-panel-projects" aria-labelledby="documents-tab-projects">
          <ProjectFilesPanel
            documents={documents}
            nowMs={nowMs}
            onUpload={() => setUploading(true)}
          />
        </div>
      )}

      {/* ---- COMPANY LIBRARY -----------------------------------------------
          ⚠️ `canManageLibrary`, NOT `canManage`. The two are one rung apart on
          purpose — `document.manage` reaches the Coordinator and `library.manage`
          stops at Admin, because the library is company collateral published to
          everybody with no approval in front of it. Passing the wrong one here
          would put a button in front of a Coordinator whose only possible outcome
          is a refusal from `library_documents_write`. */}
      {activeTab === 'library' && (
        <div role="tabpanel" id="documents-panel-library" aria-labelledby="documents-tab-library">
          <LibraryPanel
            documents={library}
            canManage={canManageLibrary}
            /* The same handler every other panel uses: the note strip above is
               already where this screen reports what happened, and `refresh` is
               what puts the new row in the list. */
            onDone={(r) => {
              setNote(r);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* ---- SETTINGS ------------------------------------------------------ */}
      {activeTab === 'settings' && canConfigure && (
        <div role="tabpanel" id="documents-panel-settings" aria-labelledby="documents-tab-settings">
          <DriveSettings
            drive={{
              configured: drive.configured,
              connected: drive.connected,
              account: drive.account,
              connectedAt: drive.connectedAt,
              lastError: drive.lastError,
              sync: drive.sync,
              drafts: drive.drafts,
            }}
            /* ⚠️ REAL COUNTS from the registry the last sync wrote — 33 folders and
               310 files today — not the drawing's invented "52 subfolders • 1,248
               files". They are computed on the server from `drive_folders`. */
            registry={drive.registry}
            watchedFolderName={drive.watchedFolderName}
            nowMs={nowMs}
            onDone={(r) => {
              setNote(r);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* ---- APPROVALS / THE REGISTER -------------------------------------- */}
      {/* ⚠️ `&& canApprove`, not just the tab check. The tab is gone from the bar
          for a Member, but `activeTab` is a string in component state and a panel
          guarded only by its own name would still render if that string ever
          arrived from anywhere else. The tab bar decides what is REACHABLE; this
          decides what is RENDERED. Same belt-and-braces as the server actions,
          which check the permission again regardless of which button called them.
          The real boundary is `app.can_read_document` plus the action checks — this
          is the third layer, and it costs one clause. */}
      {activeTab === 'approvals' && canApprove && (
        <div
          role="tabpanel"
          id="documents-panel-approvals"
          aria-labelledby="documents-tab-approvals"
        >
          {/* ── ⚠️ A TABLE, NOT A LIST OF CARDS ────────────────────────────────
              What was here was a stack of `Card`s, one per document, each carrying
              a badge, a name, five grey clauses of metadata and a row of icon
              buttons. It worked at three documents and does not scan at thirty:
              the eye has no column to run down, so comparing two rows means
              reading both.

              The owner supplied a design for exactly this and it is a table.
              Every control on it maps to a handler that already existed —
              nothing here is new behaviour, only the same actions in the drawn
              layout. */}
          <RegisterTable
            documents={documents}
            canApprove={canApprove}
            canManage={canManage}
            nowMs={nowMs}
            busyId={busy}
            onUpload={() => setUploading(true)}
            onPreview={(doc) => void preview(doc.id)}
            onDownload={(doc) => void download(doc)}
            onApprove={(doc) => void run(doc.id, () => approveDocumentAction(doc.id))}
            /* Refuse opens the reason dialogue rather than acting — a refusal
               deletes the file, and the reason is the only thing the uploader
               gets told. */
            onRefuse={setRejecting}
            onDelete={(doc) => void run(doc.id, () => deleteDocumentAction(doc.id))}
          />
        </div>
      )}

      {uploading && (
        <UploadDialog
          projects={projects}
          folders={uploadableFolders}
          initialFolderId={uploadInto}
          /* "Upload here", pressed inside a Drive folder, means there. See the
             prop's note for why this is a default and not a lock. */
          initialDestination={uploadInto ? 'drive' : undefined}
          /* So the button can say "Upload and file it" to a Coordinator instead
             of "Send for approval" — which was the label everybody got, including
             the people whose uploads are approved on arrival. */
          canApprove={canApprove}
          /* Both halves are needed for a Drive write to succeed, so the option is
             offered only when both hold. `configured` alone would show a radio
             that fails at the last step with an OAuth message. */
          driveConnected={drive.configured && drive.connected}
          onClose={() => { setUploading(false); setUploadInto(null); }}
          onDone={(result) => {
            setUploading(false);
            setNote(result);
            router.refresh();
          }}
        />
      )}

      {/* ---- Refuse, with a reason ---------------------------------------- */}
      <RejectDialog
        document={rejecting}
        busy={busy !== null}
        onClose={() => setRejecting(null)}
        onRefuse={(reason) => {
          if (rejecting) void run(rejecting.id, () => rejectDocumentAction(rejecting.id, reason));
        }}
      />
    </div>
  );
}

/* ---- Drive connection -----------------------------------------------------
   Moved to ./drive-settings.tsx when the owner supplied a design for this tab.
   Only the layout went with it; the two facts worth keeping are recorded there —
   that `configured` and `connected` are different failures needing different
   fixes, and that NOTHING schedules a Drive sync, so the panel must not claim
   one runs. */

/* ---- Upload ----------------------------------------------------------------
   Moved to ./upload-dialog.tsx — the project detail page opens the same form with
   its own project locked, and two copies of an upload form is two places for the
   size limits and the approval wording to drift. */

/* ---- Refuse -------------------------------------------------------------- */

function RejectDialog({
  document: doc,
  busy,
  onClose,
  onRefuse,
}: {
  document: DocumentRow | null;
  busy: boolean;
  onClose: () => void;
  onRefuse: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState('');

  return (
    <Dialog
      open={doc !== null}
      onClose={onClose}
      size="sm"
      title={doc ? `Refuse ${doc.name}?` : ''}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            disabled={busy || reason.trim() === ''}
            onClick={() => onRefuse(reason)}
          >
            Refuse it
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-caption text-text-secondary">
          The file is deleted and never reaches Drive. The record stays, with your reason, so
          whoever uploaded it knows what to fix.
        </p>
        <Field label="Why" htmlFor="reason" hint="The uploader sees this.">
          <Input
            id="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Wrong client — this is ABC, not XYZ"
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ---- Bits ---------------------------------------------------------------- */


