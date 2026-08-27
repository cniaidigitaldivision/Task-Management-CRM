'use client';

import * as React from 'react';

import { pendingFileUrlAction } from '@/app/actions/documents';
import type { DocumentRow } from '@/lib/db/queries/documents';
import { fileKind } from '@/lib/domain/file-kind';
import { Dialog } from '@/components/ui/dialog';

import { ProjectFilesTable } from './project-files-table';

/* ============================================================================
 * PROJECT FILES — the division's own storage, by project
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24:
 *
 *   *"In the team member, in the documentation, they should show only: Folder,
 *    File, Company library, Projects documentation. They can filter them on a
 *    project basis… They can also apply filters on the basis of their file types."*
 *
 * ── WHAT THIS TAB IS FOR, AND WHY THE OTHERS DID NOT COVER IT ────────────────
 * Three tabs already listed files and none of them answered "what do we hold for
 * this client":
 *
 *   Folders & files       what is in GOOGLE DRIVE, by Drive folder. A different
 *                         store, organised by Google's tree rather than by project.
 *   Register & approvals  the QUEUE, sorted by whether somebody has decided —
 *                         a manager's question, and Coordinator+ only.
 *   Company library       the agency's OWN material. Nothing to do with a client.
 *
 * ── ⚠️ NO NEW QUERY, AND THAT IS THE SECURITY ARGUMENT ───────────────────────
 * It filters the same `documents` array the register uses, which arrived through
 * `app.can_read_document` (migration 025): Admin+ sees everything, anybody else
 * sees their own uploads plus anything on a project visible to them. A Member
 * opening this tab cannot be shown a file they were not already entitled to — the
 * policy decided that before this component existed, and a second query here would
 * be a second chance to get it wrong.
 *
 * ── ⚠️ A MEMBER'S OWN PENDING AND REFUSED UPLOADS APPEAR HERE ────────────────
 * Deliberate, and it is what makes hiding the register from Members safe. Their
 * own upload waiting for a decision — and, more importantly, a REFUSAL with its
 * reason — would otherwise be visible on no screen they can open.
 *
 * ── ⚠️ THIS FILE IS NOW ONLY THE SERVER ROUND TRIP ──────────────────────────
 * The layout moved to `ProjectFilesTable` when the owner supplied a design for it.
 * What stayed is the half that cannot live in a presentational component: minting
 * a signed URL for a private bucket object, deciding whether the result opens in a
 * modal or a tab, and the refusal messages. Three hundred lines of filter state
 * and toolbar went; none of this did.
 * ========================================================================= */

/** Images open in a modal, everything else in a tab. Same rule and the same
 *  reasoning as the project Files tab — a PDF gets the browser's own viewer, and
 *  a .pptx cannot be rendered in a page at all. */
function isImage(mimeType: string | null, name: string): boolean {
  return fileKind(mimeType, name) === 'image';
}

export function ProjectFilesPanel({
  documents,
  nowMs,
  onUpload,
}: {
  documents: readonly DocumentRow[];
  /** The server's clock, for the date labels. See lib/now.ts. */
  nowMs: number;
  /* ── ⚠️ THE UPLOAD BUTTON HAD TO MOVE HERE, NOT MERELY BE COPIED ──────────
     It lived in the Register & approvals toolbar and nowhere else on this screen.
     Hiding that tab from Members therefore took away the one thing every role is
     explicitly allowed to do — `document.request` is `allow` for all four roles
     (permissions.ts). A Member would have opened Documents with no way to add one. */
  onUpload: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<{ name: string; url: string } | null>(null);

  /**
   * Open or save one document.
   *
   * ⚠️ ONE FUNCTION FOR BOTH INTENTIONS. The permission check, the signed-URL
   * round trip and the refusal messages are identical; only the destination
   * differs. Two copies would be two places for the "rejected file was deleted"
   * message to drift out of step with the state that produces it.
   */
  const handle = async (doc: DocumentRow, mode: 'view' | 'download') => {
    /* A Drive-hosted file has no bucket object to sign — Google serves it, and its
       own viewer is better than anything here. Same link for both intentions,
       because Drive's page is where the download button lives. */
    if (doc.driveWebLink) {
      window.open(doc.driveWebLink, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!doc.storagePath) {
      setNote(
        doc.state === 'rejected'
          ? `${doc.name} was refused, so the file was deleted. Only the record and its reason are kept.`
          : `${doc.name} has no file attached to it.`,
      );
      return;
    }

    setBusy(doc.id);
    setNote(null);
    try {
      const result = await pendingFileUrlAction(doc.id);
      if (!result.ok) {
        setNote(result.error);
        return;
      }

      if (mode === 'download') {
        /* ⚠️ A real anchor with `download`, not `window.open`. Opening a signed URL
           in a tab DISPLAYS the file; the point of this action is to put it on
           disk, and only the attribute does that. */
        const anchor = document.createElement('a');
        anchor.href = result.url;
        anchor.download = doc.name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        return;
      }

      if (isImage(doc.mimeType, doc.name)) setViewing({ name: doc.name, url: result.url });
      else window.open(result.url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {note && (
        <p
          className="rounded-lg px-3 py-2 text-caption"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
        >
          {note}
        </p>
      )}

      <ProjectFilesTable
        documents={documents}
        nowMs={nowMs}
        onUpload={onUpload}
        onView={(doc, mode) => void handle(doc, mode)}
        busyId={busy}
      />

      {viewing && (
        <Dialog open onClose={() => setViewing(null)} title={viewing.name} size="lg">
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
        </Dialog>
      )}
    </div>
  );
}
