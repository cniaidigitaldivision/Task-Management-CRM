'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as F from '@/lib/db/queries/drive-folders';
import { ACCESS_MEANS, accessAtLeast, isFolderAccess } from '@/lib/domain/folder-access';
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
