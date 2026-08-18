'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as F from '@/lib/db/queries/drive-folders';
import { can } from '@/lib/domain/permissions';
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
 *   1. Coordinator+ sees every document.        → `app.can_read_document`, 027
 *   2. Coordinator+ shares a folder to Members. → `setFolderVisibilityAction`
 *   3. A Member may upload into a shared folder.→ `app/actions/documents.ts`
 *
 * Only (2) lives here. (1) is in the database because a rule about who can read
 * rows belongs where the rows are, and (3) is part of uploading.
 *
 * ── SHARING IS ATTRIBUTED AND AUDITED ────────────────────────────────────────
 * Exposing a folder to everybody in the company is the one action on this screen
 * nobody can undo the consequences of — a Member who has read a document has read
 * it. So the row records who shared it and when, and the audit log records the
 * change either way, including turning it back off.
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

export async function setFolderVisibilityAction(
  id: string,
  visible: boolean,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  /* The real defence is the `drive_folders_write` policy, which is Coordinator+.
     This check exists so a Member gets a sentence instead of a database error —
     and if the two ever disagree, the database wins, which is the correct way
     round. */
  if (!can(actor, 'document.share')) {
    return fail('Only a Team Coordinator or above can share a folder with members.');
  }

  const before = await F.getFolder(user.id, id);
  if (!before) return fail('That folder is not in the registry.');
  if (before.visibleToMembers === visible) {
    return { ok: true, message: `${before.name} is already ${visible ? 'shared' : 'private'}.` };
  }

  const after = await F.setVisibility(user.id, id, visible);
  if (!after) return fail('That folder could not be updated.');

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'drive_folder',
      entityId: id,
      action: visible ? 'folder.shared' : 'folder.unshared',
      before: { name: before.name, visibleToMembers: before.visibleToMembers },
      after: { name: after.name, visibleToMembers: after.visibleToMembers },
    }),
  ).catch(() => console.error('[folders] audit write failed for a visibility change'));

  revalidatePath('/documents');
  return {
    ok: true,
    message: visible
      ? `Members can now see the documents in ${after.name}, and upload into it.`
      : `${after.name} is private again. Members keep no access to what is in it.`,
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
