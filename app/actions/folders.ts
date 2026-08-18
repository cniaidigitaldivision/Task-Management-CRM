'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { connectionStatus } from '@/lib/db/queries/drive';
import * as F from '@/lib/db/queries/drive-folders';
import { listPeople } from '@/lib/db/queries/people';
import {
  ACCESS_MEANS,
  ACCESS_META,
  accessAtLeast,
  isFolderAccess,
} from '@/lib/domain/folder-access';
import { can } from '@/lib/domain/permissions';
import * as Drive from '@/lib/drive/client';
import { scanDriveFolders } from '@/lib/drive/folders';

import type { DocumentResult } from './documents';

/* ============================================================================
 * FOLDERS AND WHO MAY SEE THEM — owner request 2026-08-16
 * ----------------------------------------------------------------------------
 * *"super admin, admin and team coordinator can see the whole documents and they
 * can make the documents viewable for members to see for any project they want,
 * and members can upload documents to the folders they are viewing."*
 *
 * Read as three rules, and implemented as three:
 *
 *   1. Coordinator+ sees every document.        → `app.can_read_document`, 028
 *   2. Coordinator+ sets a folder's level.      → `setFolderAccessAction`
 *   3. A Member may upload where the level says.→ `app/actions/documents.ts`
 *
 * Only (2) lives here. (1) is in the database because a rule about who can read
 * rows belongs where the rows are, and (3) is part of uploading.
 *
 * ── THE LEVEL IS CHOSEN WHEN ACCESS IS GIVEN ─────────────────────────────────
 * Owner, 2026-08-16, correcting an earlier boolean design: *"These options of
 * access should be provided at the time of giving access… the access level is
 * defined at the time of giving, right?"* Right. `none` / `view` / `upload` /
 * `manage`, per folder — migration 028.
 *
 * ── GRANTING IS ATTRIBUTED AND AUDITED ───────────────────────────────────────
 * Opening a folder to everybody in the company is the one action on this screen
 * nobody can undo the consequences of — a Member who has read a document has read
 * it, and at `manage` they can delete one. So the row records who granted it and
 * when, and the audit log records every change, including closing it again.
 * ========================================================================= */

const fail = (error: string): DocumentResult => ({ ok: false, error });

/* ==========================================================================
 * READ
 * ========================================================================== */

export async function listFoldersAction(): Promise<
  { ok: true; folders: F.DriveFolderRow[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  return { ok: true, folders: await F.listFolders(user.id) };
}

/* ==========================================================================
 * SHARE — Coordinator and above
 * ========================================================================== */

export async function setFolderAccessAction(
  id: string,
  level: string,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  /* The real defence is the `drive_folders_write` policy, which is Coordinator+.
     This check exists so a Member gets a sentence instead of a database error —
     and if the two ever disagree, the database wins, which is the correct way
     round. */
  if (!can(actor, 'document.share')) {
    return fail('Only a Team Coordinator or above can change who may see a folder.');
  }

  /* Validated against the list rather than cast. The value arrives from a form
     and Postgres would refuse an unknown enum member anyway — but as `22P02`,
     which is not a sentence anybody can act on. */
  if (!isFolderAccess(level)) return fail('That is not an access level.');
  const next = level;

  const before = await F.getFolder(user.id, id);
  if (!before) return fail('That folder is not in the registry.');
  if (before.memberAccess === next) {
    return { ok: true, message: `${before.name} ${ACCESS_MEANS[next]}` };
  }

  const after = await F.setAccess(user.id, id, next);
  if (!after) return fail('That folder could not be updated.');

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'drive_folder',
      entityId: id,
      /* Two actions rather than one `folder.access_changed`, because "somebody
         opened a folder up" and "somebody closed one" are the two things an audit
         reader searches for, and a single action name would make them grep the
         payload to tell which happened. */
      action:
        accessAtLeast(next, 'view') && !accessAtLeast(before.memberAccess, 'view')
          ? 'folder.shared'
          : next === 'none'
            ? 'folder.unshared'
            : 'folder.access_changed',
      before: { name: before.name, memberAccess: before.memberAccess },
      after: { name: after.name, memberAccess: after.memberAccess },
    }),
  ).catch(() => console.error('[folders] audit write failed for an access change'));

  revalidatePath('/documents');
  return { ok: true, message: `${after.name} ${ACCESS_MEANS[next]}` };
}

/* ==========================================================================
 * WHAT IS IN A FOLDER — owner request 2026-08-18
 * ========================================================================== */

export interface FolderFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number | null;
  readonly modifiedTime: string | null;
  /** How the viewer should open it. Decided here, on the server, so the client
   *  does not have to carry a mime-type table that can drift from this one. */
  readonly kind: 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'google' | 'other';
}

function kindOf(mimeType: string): FolderFile['kind'] {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  /* Docs, Sheets, Slides. No bytes to stream — they can only be opened in
     Google's own editor, which the team cannot reach. Flagged so the list can
     say so rather than offering a view that fails. */
  if (mimeType.startsWith('application/vnd.google-apps.')) return 'google';
  return 'other';
}

/**
 * The files in one folder.
 *
 * ⚠️ Authorised against the FOLDER, using the same predicate as the streaming
 * route and the `documents` policies: `app.folder_grants(folder, 'view')`. A
 * Member who cannot see the folder is told it does not exist rather than that
 * they may not read it — the registry is readable by everyone signed in, but what
 * is INSIDE a folder is not.
 */
export async function listFolderFilesAction(
  folderId: string,
): Promise<
  | { ok: true; folder: { id: string; name: string }; files: FolderFile[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();

  const folder = await F.getFolder(user.id, folderId);
  if (!folder) return { ok: false, error: 'That folder is not in the registry.' };

  const mayRead = await F.mayReadFolder(user.id, folderId);
  if (!mayRead) {
    return { ok: false, error: `You do not have access to ${folder.name}.` };
  }

  const listed = await Drive.listFilesIn(folder.driveFolderId);
  if (!listed.ok) return { ok: false, error: listed.reason };

  return {
    ok: true,
    folder: { id: folder.id, name: folder.name },
    files: listed.value.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedTime: f.modifiedTime,
      kind: kindOf(f.mimeType),
    })),
  };
}

/* ==========================================================================
 * CREATE A FOLDER — owner request 2026-08-18
 * --------------------------------------------------------------------------
 * *"Can I create a folder so this order is, or definitely I will link that folder
 * with the create project also later on."*
 *
 * `Drive.createFolder` has existed since the first Drive commit and was never
 * wired to anything — the third time in this project a utility was built and left
 * unapplied. It is wired now.
 * ========================================================================== */

export async function createFolderAction(
  name: string,
  parentFolderId: string | null,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.share')) {
    return fail('Only a Team Coordinator or above can create a folder.');
  }

  const trimmed = name.trim();
  if (!trimmed) return fail('Give the folder a name.');
  if (trimmed.length > 120) return fail('That name is too long. 120 characters is the limit.');

  const connection = await connectionStatus();
  if (!connection.connected) {
    return fail('Google Drive is not connected, so a folder cannot be created in it.');
  }

  /* A parent inside the registry, or My Drive. Not an arbitrary Drive id from the
     client: that would let somebody create folders anywhere in the account. */
  let parentDriveId = 'root';
  if (parentFolderId) {
    const parent = await F.getFolder(user.id, parentFolderId);
    if (!parent) return fail('That parent folder is not in the registry.');
    parentDriveId = parent.driveFolderId;
  }

  const created = await Drive.createFolder(trimmed, parentDriveId);
  if (!created.ok) return fail(created.reason);

  /* Recorded immediately, so it appears in the list without waiting for a sync.
     Counted as empty rather than unknown — it was created a moment ago. */
  await F.recordFolders(user.id, [
    {
      driveFolderId: created.value.id,
      name: created.value.name,
      parentDriveId: parentDriveId === 'root' ? null : parentDriveId,
      fileCount: 0,
      filePartial: false,
    },
  ]).catch(() => undefined);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'drive_folder',
      entityId: null,
      action: 'folder.created',
      after: { name: created.value.name, driveFolderId: created.value.id },
    }),
  ).catch(() => console.error('[folders] audit write failed for a folder creation'));

  revalidatePath('/documents');
  return {
    ok: true,
    message: `"${created.value.name}" created in Drive. Nobody but Coordinators and above can see it until you give access.`,
  };
}

/* ==========================================================================
 * NAMED-PERSON ACCESS — owner request 2026-08-18
 * ========================================================================== */

export async function listFolderGrantsAction(
  folderId: string,
): Promise<
  | { ok: true; grants: F.FolderGrantRow[]; people: Array<{ id: string; fullName: string; role: string }> }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.share')) {
    return { ok: false, error: 'Only a Team Coordinator or above can see who has access.' };
  }

  const [grants, people] = await Promise.all([
    F.listGrants(user.id, folderId),
    listPeople(user.id, {}),
  ]);

  return {
    ok: true,
    grants,
    /* Only people who could benefit from a grant. Coordinator+ already sees
       everything, so offering to "give" them access would be a control that does
       nothing — and a list of options that change nothing is how a screen teaches
       somebody it is lying to them. */
    people: people
      .filter((p) => p.isActive && (p.role === 'member' || p.role === 'team_coordinator'))
      .map((p) => ({ id: p.id, fullName: p.fullName, role: p.role })),
  };
}

export async function setPersonAccessAction(
  folderId: string,
  personId: string,
  level: string,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.share')) {
    return fail('Only a Team Coordinator or above can give somebody access.');
  }

  const folder = await F.getFolder(user.id, folderId);
  if (!folder) return fail('That folder is not in the registry.');

  /* `none` is how the UI says "remove", because a dropdown that goes down to
     nothing is more natural than a separate delete button — but migration 031
     refuses to STORE a `none` grant, since it would look like a restriction and
     be none. So it is translated to a revoke here. */
  if (level === 'none') {
    const removed = await F.revokeAccess(user.id, folderId, personId);
    if (!removed) return { ok: true, message: 'That person had no grant on this folder.' };

    await withUser(user.id, (tx) =>
      audit(tx, user, {
        entityType: 'drive_folder',
        entityId: folderId,
        action: 'folder.access_revoked',
        before: { folder: folder.name, personId },
      }),
    ).catch(() => undefined);

    revalidatePath('/documents');
    return {
      ok: true,
      message: `Removed. They now get whatever ${folder.name} gives everyone — currently ${ACCESS_META[folder.memberAccess].label.toLowerCase()}.`,
    };
  }

  if (!isFolderAccess(level)) return fail('That is not an access level.');

  await F.grantAccess(user.id, { folderId, personId, access: level });

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'drive_folder',
      entityId: folderId,
      action: 'folder.access_granted',
      after: { folder: folder.name, personId, access: level },
    }),
  ).catch(() => console.error('[folders] audit write failed for a person grant'));

  revalidatePath('/documents');

  /* Said plainly when the grant changes nothing, because a control that reports
     success while having no effect is worse than one that refuses. */
  const redundant = accessAtLeast(folder.memberAccess, level);
  return {
    ok: true,
    message: redundant
      ? `Saved — though ${folder.name} already gives everyone ${ACCESS_META[folder.memberAccess].label.toLowerCase()}, so this changes nothing for them yet.`
      : `Saved. ${ACCESS_MEANS[level].replace(/^is |^accepts |^has /, '')}`.replace(/\s+/g, ' '),
  };
}

/* ==========================================================================
 * SYNC — read the tree from Drive
 * ========================================================================== */

export async function syncFoldersAction(): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.share')) {
    return fail('Only a Team Coordinator or above can read the folder tree.');
  }

  /* Drive has to be connected before there is a tree to read. Said plainly here,
     because the alternative is Google's own 401 arriving as an unexplained
     "Drive refused the request". */
  const connection = await connectionStatus();
  if (!connection.connected) {
    return fail('Google Drive is not connected yet, so there are no folders to read.');
  }

  const outcome = await scanDriveFolders(user.id);
  if (!outcome.ok) return fail(outcome.error ?? 'The folder tree could not be read.');

  revalidatePath('/documents');

  const counted =
    outcome.created === 0
      ? `Nothing new — ${outcome.examined} ${outcome.examined === 1 ? 'folder' : 'folders'} already known.`
      : `${outcome.created} new ${outcome.created === 1 ? 'folder' : 'folders'} recorded, out of ${outcome.examined} seen.`;

  return {
    ok: true,
    message: counted,
    /* Said out loud rather than left for somebody to notice a missing folder in
       the picker later. */
    ...(outcome.truncated
      ? {
          warning:
            'The Drive tree is larger than this reads in one pass, so the deepest folders were not recorded. Everything above them was.',
        }
      : {}),
  };
}
