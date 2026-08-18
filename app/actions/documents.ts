'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as D from '@/lib/db/queries/documents';
import * as F from '@/lib/db/queries/drive-folders';
import { notify, notifySelf } from '@/lib/db/queries/feed';
import { accessAtLeast } from '@/lib/domain/folder-access';
import { can } from '@/lib/domain/permissions';
import * as Drive from '@/lib/drive/client';
import { clearConnection, connectionStatus } from '@/lib/db/queries/drive';
import { forgetAccessToken } from '@/lib/drive/oauth';
import { runDriveSync } from '@/lib/drive/sync';
import { removeObject, signedUrl, uploadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * DOCUMENTS AND GOOGLE DRIVE — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * *"Every time a user or anybody comes… they should have a place where they can
 * upload something. Other than the team coordinator or admin, every approval will
 * go to the admin. Once the admin approves it, it will actually be added to
 * Google Drive."*
 *
 * ── THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ──────────────────────────────
 * Uploading:   bytes → the CRM's own storage → a `pending` row. Drive untouched.
 * Approving:   read the bytes → upload to DRIVE → only then mark approved and
 *              delete from the CRM's storage.
 *
 * That order matters in both directions:
 *
 *   • A rejected file never reaches the company Drive. That is the point of
 *     approving it, and it is why pending files do not sit in a Drive "Pending"
 *     folder — a refused file would already have been written there.
 *
 *   • The row is marked approved only AFTER Drive confirms the file. If Drive is
 *     unreachable the document stays pending and can be approved again; the
 *     opposite order would leave a row claiming a file that does not exist.
 *
 * The local copy is removed last, and a failure to remove it is deliberately not
 * fatal — an orphaned object in a bucket costs storage, whereas failing the
 * approval after the file reached Drive would cost the truth.
 * ========================================================================= */

export interface DocumentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly warning?: string;
}

const fail = (error: string): DocumentResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** 25 MB. Well inside the table's 100 MB ceiling and Drive's own limits. */
const MAX_BYTES = 25 * 1024 * 1024;

/* ==========================================================================
 * READ
 * ========================================================================== */

export async function listDocumentsAction(): Promise<
  { ok: true; documents: D.DocumentRow[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'document.view')) {
    return { ok: false, error: 'You cannot see documents.' };
  }
  return { ok: true, documents: await D.listDocuments(user.id) };
}

/**
 * A link to a PENDING file, so an approver can look before deciding.
 *
 * Signed and short-lived. Approving a document without being able to open it is
 * rubber-stamping, and the alternative — a public URL — would make every pending
 * upload readable by anybody who guessed the path.
 */
export async function pendingFileUrlAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();

  const document = await D.getDocument(user.id, id);
  /* Invisible and non-existent give the same answer — the policy already made
     them indistinguishable and this must not undo that. */
  if (!document) return { ok: false, error: 'That document is not available.' };
  if (!document.storagePath) {
    return { ok: false, error: 'That file is no longer held here — it is in Drive.' };
  }

  const signed = await signedUrl(document.storagePath);
  if (!signed.ok) return { ok: false, error: signed.message };
  return { ok: true, url: signed.value };
}

/* ==========================================================================
 * REQUEST — anybody
 * ========================================================================== */

export async function requestDocumentAction(
  _prev: DocumentResult,
  form: FormData,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.request')) return fail('You cannot upload documents.');

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Choose a file to upload.');
  if (file.size > MAX_BYTES) {
    return fail(`That file is ${Math.round(file.size / 1_048_576)} MB. The limit is 25 MB.`);
  }

  /* The typed name wins, falling back to the file's own. Somebody who has taken
     the trouble to name it meant that name. */
  const name = str(form, 'name') || file.name;
  if (!name) return fail('Give the document a name.');

  /* ── WHICH FOLDER, AND WHETHER THIS NEEDS APPROVING AT ALL ────────────────
     Owner, 2026-08-16: *"it shouldn't be required approval because an admin is
     assigning access to some folder… the access level is defined at the time of
     giving."* So the folder's level decides the whole shape of what follows:

       none / view   cannot file here at all
       upload +      goes STRAIGHT to Drive — the grant was the approval
       no folder     the old path: our storage, then the approval queue

     Checked BEFORE the bytes go anywhere. Refusing afterwards would leave an
     orphaned object to clean up for a mistake we could have caught first. */
  const folderId = str(form, 'folderId') || null;
  const canManageFolders = can(actor, 'document.share');

  let folder: F.DriveFolderRow | null = null;
  if (folderId) {
    folder = await F.getFolder(user.id, folderId);
    if (!folder) return fail('That folder is not in the registry.');
    if (!canManageFolders && folder.memberAccess === 'none') {
      return fail(`You do not have access to ${folder.name}, so you cannot file into it.`);
    }
    if (!canManageFolders && !accessAtLeast(folder.memberAccess, 'upload')) {
      return fail(
        `You can view ${folder.name} but not add to it. Ask a Team Coordinator for upload access.`,
      );
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /* Coordinator+ still uses the approval queue when they file into a folder —
     their own upload is exactly the one that most needs a second pair of eyes,
     and `upload` access describes what MEMBERS were granted, not a bypass for
     whoever granted it. A Member with `upload` skips the queue; that is the
     asymmetry the owner asked for. */
  const straightToDrive =
    folder !== null && !canManageFolders && accessAtLeast(folder.memberAccess, 'upload');

  if (straightToDrive && folder) {
    return uploadStraightToDrive({
      user,
      folder,
      name,
      description: str(form, 'description') || null,
      projectId: str(form, 'projectId') || null,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      bytes,
    });
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
  const path = `documents/${user.id}/${Date.now()}-${safeName}`;

  const stored = await uploadObject({
    path,
    body: bytes,
    contentType: file.type || 'application/octet-stream',
  });
  if (!stored.ok) return fail(`That file could not be stored: ${stored.message}`);

  let documentId: string;
  try {
    documentId = await D.createDocumentRequest(user.id, {
      name,
      description: str(form, 'description') || null,
      projectId: str(form, 'projectId') || null,
      folderId,
      storagePath: path,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
  } catch {
    /* The row failed, so the object is orphaned. Removed here rather than left,
       because nothing else will ever refer to it. */
    await removeObject(path).catch(() => undefined);
    return fail('That upload could not be recorded. Try again.');
  }

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'document',
      entityId: documentId,
      action: 'document.requested',
      after: { name, sizeBytes: file.size, projectId: str(form, 'projectId') || null },
    });

    /* ── EVERY APPROVER IS TOLD, AND KEEPS BEING TOLD ────────────────────────
       Owner: *"otherwise the notification will keep showing to the coordinator or
       all the team."* Read as: the request must not sit unseen. The notification
       stays unread until somebody acts, and the queue on the Documents screen
       shows a count — so it persists rather than being a moment that can be
       missed. Sent to whoever can approve — Coordinator and above since
       2026-08-16, so this list moved with the permission rather than being left
       behind to notify a set of people who are no longer the whole set.

       ⚠️ The uploader is excluded. A Coordinator can now approve their own
       upload, and telling somebody their own file is waiting for them is noise
       that trains people to ignore the notification. */
    const approvers = await tx`
      select id from public.users
       where is_active
         and role in ('super_admin', 'admin', 'team_coordinator')
         and id <> ${user.id}
    `;
    for (const approver of approvers) {
      await notify(tx, user.id, {
        userId: approver.id as string,
        kind: 'security_alert',
        title: `${user.fullName} uploaded ${name}`,
        body: 'It is waiting for approval before it goes to Google Drive.',
        linkTo: '/documents',
        entityId: documentId,
      });
    }
  }).catch(() => {
    console.error('[documents] audit or notification write failed for a request');
  });

  revalidatePath('/documents');
  return {
    ok: true,
    message: `${name} is uploaded and waiting for approval. It is not in Drive yet.`,
  };
}

/**
 * The no-queue path: bytes go to Drive, then a row is written already approved.
 *
 * ── THE ORDER IS THE OPPOSITE WAY ROUND FROM THE QUEUE, FOR THE SAME REASON ──
 * The queued path stores locally first because the file must NOT reach Drive
 * until somebody says yes. Here somebody already has, so the file goes to Drive
 * first and the row is written only once Google confirms it. Both orders exist
 * to make the same guarantee: a row never claims a file that is not there.
 *
 * Nothing is written to our own storage at all. A local copy would have to be
 * deleted immediately, and a delete that fails leaves rubbish behind for no gain.
 */
async function uploadStraightToDrive(input: {
  /* The whole current user, because `audit` wants the actor's role and email as
     they were at the time — not a lookup that would report today's values. */
  user: Awaited<ReturnType<typeof requireUser>>;
  folder: F.DriveFolderRow;
  name: string;
  description: string | null;
  projectId: string | null;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): Promise<DocumentResult> {
  const { user, folder } = input;

  const connection = await connectionStatus();
  if (!connection.connected) {
    return fail(
      `${folder.name} is set to accept uploads directly, but Google Drive is not connected — so there is nowhere to put it. Ask an Admin to connect Drive.`,
    );
  }

  const uploaded = await Drive.uploadFile({
    name: input.name,
    mimeType: input.mimeType,
    bytes: input.bytes,
    parentFolderId: folder.driveFolderId,
  });
  if (!uploaded.ok) return fail(uploaded.reason);

  let documentId: string;
  try {
    documentId = await D.createApprovedDocument(user.id, {
      name: input.name,
      description: input.description,
      projectId: input.projectId,
      folderId: folder.id,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      driveFileId: uploaded.value.id,
      driveWebLink: uploaded.value.webViewLink ?? null,
    });
  } catch {
    /* ⚠️ The file IS in Drive and the register does not know about it. Not
       silently swallowed and not retried: deleting it again could destroy
       somebody's only copy, and claiming success would hide a real
       inconsistency. The person is told exactly what to do about it. */
    console.error('[documents] a direct Drive upload succeeded but its row failed');
    return fail(
      `${input.name} reached Drive but could not be recorded here. It is in ${folder.name} — tell an Admin so the register can be corrected.`,
    );
  }

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'document',
      entityId: documentId,
      action: 'document.uploaded_directly',
      /* The folder and its level are recorded, because "why did this skip the
         queue" has to be answerable a year later, when whoever granted the
         access has forgotten. */
      after: {
        name: input.name,
        folder: folder.name,
        folderAccess: folder.memberAccess,
        driveFileId: uploaded.value.id,
      },
    });
  }).catch(() => console.error('[documents] audit write failed for a direct upload'));

  revalidatePath('/documents');
  return {
    ok: true,
    message: `${input.name} is in ${folder.name} in Google Drive. No approval was needed — you have upload access to that folder.`,
  };
}

/* ==========================================================================
 * APPROVE — Coordinator and above
 * ========================================================================== */

export async function approveDocumentAction(id: string): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  /* A Coordinator may edit and delete documents but not approve one — including
     their own. That is what keeps the queue meaningful. */
  if (!can(actor, 'document.approve')) {
    return fail('Only a Team Coordinator or above can approve a document into Drive.');
  }

  const document = await D.getDocument(user.id, id);
  if (!document) return fail('That document is not available.');
  if (document.state !== 'pending') return fail(`That document is already ${document.state}.`);
  if (!document.storagePath) return fail('That file is missing from storage.');

  const drive = Drive.describeDrive();
  if (!drive.configured) {
    return fail(
      'No Google OAuth client is configured, so nothing can be approved into Drive. See docs/GOOGLE-DRIVE-SETUP.md.',
    );
  }

  /* Configured but nobody has consented is a different problem with a different
     fix, and saying "not configured" for both is how an approver ends up editing
     environment variables that were already correct. */
  const connection = await connectionStatus();
  if (!connection.connected) {
    return fail('Google Drive is not connected yet. Connect it on this screen, then approve again.');
  }

  /* Read it back out of our own storage. A signed URL rather than a direct read
     because that is the only interface `lib/storage/bucket.ts` exposes, and it is
     the same path an approver's browser uses to preview the file. */
  const signed = await signedUrl(document.storagePath);
  if (!signed.ok) return fail(`The stored file could not be read: ${signed.message}`);

  let bytes: Uint8Array;
  try {
    const response = await fetch(signed.value, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return fail('The stored file could not be read back.');
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return fail('The stored file could not be read back.');
  }

  /* ── WHERE IT LANDS, MOST SPECIFIC FIRST ──────────────────────────────────
       the folder the uploader chose  — they said where it belongs
       the project's own Drive folder — the project says where it belongs
       the watched parent             — the division says where things go
       the Drive root                 — nowhere left to fall

     Falling back rather than refusing: a document with no folder and no project
     still has to go somewhere, and an approval that fails because nobody picked a
     folder would strand a file that is already accepted. */
  const sync = await D.getDriveSync(user.id);
  const chosenFolder = document.folderId
    ? await F.getFolder(user.id, document.folderId)
    : null;
  const projectFolder = document.projectId
    ? await projectDriveFolder(user.id, document.projectId)
    : null;

  const uploaded = await Drive.uploadFile({
    name: document.name,
    mimeType: document.mimeType ?? 'application/octet-stream',
    bytes,
    parentFolderId:
      chosenFolder?.driveFolderId ?? projectFolder ?? sync?.watchedFolderId ?? null,
  });

  if (!uploaded.ok) return fail(uploaded.reason);

  /* Only now is it approved. See the note at the top about the order. */
  await D.markApproved(user.id, id, {
    fileId: uploaded.value.id,
    webLink: uploaded.value.webViewLink ?? null,
  });

  /* Last, and non-fatal: the file is in Drive either way, and an orphaned object
     costs storage whereas failing here would cost the truth. */
  const removed = await removeObject(document.storagePath).catch(() => ({ ok: false }) as const);

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.approved',
      after: { name: document.name, driveFileId: uploaded.value.id },
    });
    await notify(tx, user.id, {
      userId: document.uploadedById,
      kind: 'security_alert',
      title: `${document.name} is in Drive`,
      body: `${user.fullName} approved it.`,
      linkTo: '/documents',
      entityId: id,
    });
  }).catch(() => console.error('[documents] audit write failed for an approval'));

  revalidatePath('/documents');
  return {
    ok: true,
    message: `${document.name} is in Google Drive.`,
    ...(removed.ok
      ? {}
      : {
          warning:
            'The file is in Drive, but the temporary copy could not be removed from storage. Harmless — it is just using space.',
        }),
  };
}

export async function rejectDocumentAction(
  id: string,
  reason: string,
): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.approve')) {
    return fail('Only an Admin or the Super Admin can decide on a document.');
  }

  const trimmed = reason.trim();
  /* Required by the table too. A refusal with no reason is the thing that makes
     people stop using a queue — they cannot tell what to fix. */
  if (!trimmed) return fail('Say why it is being refused — the uploader will see it.');

  const document = await D.getDocument(user.id, id);
  if (!document) return fail('That document is not available.');
  if (document.state !== 'pending') return fail(`That document is already ${document.state}.`);

  await D.markRejected(user.id, id, trimmed);

  /* The file goes. It was never in Drive and it is not going to be, so keeping the
     bytes serves nobody — the ROW stays, with the reason, which is the part
     anybody needs. */
  if (document.storagePath) await removeObject(document.storagePath).catch(() => undefined);

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.rejected',
      after: { name: document.name, reason: trimmed },
    });
    await notify(tx, user.id, {
      userId: document.uploadedById,
      kind: 'security_alert',
      title: `${document.name} was not approved`,
      body: trimmed,
      linkTo: '/documents',
      entityId: id,
    });
  }).catch(() => console.error('[documents] audit write failed for a rejection'));

  revalidatePath('/documents');
  return { ok: true, message: `${document.name} was refused, and the uploader has been told.` };
}

/* ==========================================================================
 * EDIT AND DELETE — Admin, Super Admin and Coordinator
 * ========================================================================== */

export async function updateDocumentAction(
  _prev: DocumentResult,
  form: FormData,
): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'document.manage')) {
    return fail('You cannot change documents.');
  }

  const id = str(form, 'id');
  const name = str(form, 'name');
  if (!id || !name) return fail('Give the document a name.');

  await D.updateDocument(user.id, id, {
    name,
    description: str(form, 'description') || null,
    projectId: str(form, 'projectId') || null,
  });

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.updated',
      after: { name },
    }),
  ).catch(() => console.error('[documents] audit write failed for an update'));

  revalidatePath('/documents');
  return { ok: true, message: 'Saved.' };
}

/**
 * Remove a document from the register.
 *
 * ⚠️ This does NOT delete the file from Google Drive. Deliberate: Drive is the
 * company's own store and somebody removing a row from a CRM list has not
 * necessarily decided the file should cease to exist. The message says so, because
 * the reverse assumption is unrecoverable.
 */
export async function deleteDocumentAction(id: string): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'document.manage')) {
    return fail('You cannot delete documents.');
  }

  const document = await D.getDocument(user.id, id);
  if (!document) return fail('That document is no longer there.');

  const removed = await D.deleteDocument(user.id, id);
  if (!removed) return fail('That document could not be removed.');

  if (document.storagePath) await removeObject(document.storagePath).catch(() => undefined);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.deleted',
      before: { name: document.name, driveFileId: document.driveFileId },
    }),
  ).catch(() => console.error('[documents] audit write failed for a delete'));

  revalidatePath('/documents');
  return {
    ok: true,
    message: document.driveFileId
      ? `${document.name} is off the list. The file itself is still in Google Drive.`
      : `${document.name} is deleted.`,
  };
}

/* ==========================================================================
 * THE FOLDER WATCH
 * ========================================================================== */

export async function driveStatusAction(): Promise<{
  /** The OAuth CLIENT exists (env vars set). */
  configured: boolean;
  /** Somebody has completed consent and a refresh token is stored. */
  connected: boolean;
  account: string | null;
  lastError: string | null;
  sync: D.DriveSyncRow | null;
  drafts: Array<{ id: string; name: string; driveFolderId: string | null }>;
}> {
  const user = await requireUser();
  const drive = Drive.describeDrive();

  /* ── CONFIGURED AND CONNECTED ARE DIFFERENT PROBLEMS ───────────────────────
     `configured` means the OAuth client id and secret exist, which only the
     owner can create in Google Cloud. `connected` means somebody has since
     clicked Connect and granted access. Collapsing the two into one boolean is
     how "Drive is not working" becomes a message nobody can act on — the fixes
     are completely different. */
  const connection = await connectionStatus();

  if (!can({ role: user.role, id: user.id }, 'drive.configure')) {
    /* A non-Admin still learns WHETHER Drive works, because that explains why an
       upload queues rather than lands. They do not learn whose account it is. */
    return {
      configured: drive.configured,
      connected: connection.connected,
      account: null,
      lastError: null,
      sync: null,
      drafts: [],
    };
  }

  return {
    configured: drive.configured,
    connected: connection.connected,
    account: connection.accountEmail,
    lastError: connection.lastError,
    sync: await D.getDriveSync(user.id),
    drafts: await D.listDraftProjects(user.id),
  };
}

/**
 * Forget the Google connection.
 *
 * The stored refresh token is dropped. It is NOT revoked at Google — that is
 * done from myaccount.google.com, and pretending otherwise would leave somebody
 * believing access had been withdrawn when the token still works. The screen
 * says so.
 */
export async function disconnectDriveAction(): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'drive.configure')) {
    return fail('Only an Admin can disconnect Google Drive.');
  }

  await clearConnection();
  forgetAccessToken();
  revalidatePath('/documents');
  return {
    ok: true,
    message: 'Google Drive disconnected. Files already filed there are untouched.',
  };
}

export async function setWatchedFolderAction(folderId: string): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'drive.configure')) {
    return fail('Only an Admin can choose the watched folder.');
  }

  const trimmed = folderId.trim();
  if (!trimmed) {
    await D.setWatchedFolder(user.id, null);
    revalidatePath('/documents');
    return { ok: true, message: 'Folder watching is off. No projects will be created.' };
  }

  /* Confirmed before it is saved. Saving an unreachable id would mean the poll
     failing silently every few minutes, and the reason ("Drive was never shared
     with the service account") would only appear in a log. */
  const folder = await Drive.getFolder(trimmed);
  if (!folder.ok) return fail(folder.reason);

  await D.setWatchedFolder(user.id, folder.value.id);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: null,
      action: 'drive.watched_folder_set',
      after: { folderId: folder.value.id, folderName: folder.value.name },
    }),
  ).catch(() => undefined);

  revalidatePath('/documents');
  return {
    ok: true,
    message: `Watching "${folder.value.name}". New subfolders will become draft projects.`,
  };
}

/**
 * Read the watched folder and turn any new subfolder into a draft project.
 *
 * ── WHY THIS IS SAFE TO RUN REPEATEDLY ───────────────────────────────────────
 * `drive_folder_id` is unique and the insert is `on conflict do nothing`, so a
 * folder that already has a project is skipped rather than duplicated. That is
 * what makes the poll idempotent — and it is why this can be triggered by a cron,
 * by a button, or by both at once without coordination.
 */
export async function syncDriveFoldersAction(): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'drive.configure')) {
    return fail('Only an Admin can run the Drive check.');
  }

  /* The work itself lives in `lib/drive/sync.ts`, shared with the cron route —
     which cannot call this action at all, because an action starts with
     `requireUser()` and a scheduled request has no session. */
  const result = await runDriveSync(user.id);
  if (!result.ok) {
    return fail(
      result.error === 'No folder is being watched.'
        ? 'No folder is being watched yet. Set one first.'
        : (result.error ?? 'The Drive check failed.'),
    );
  }

  const { created, names } = result;

  if (created > 0) {
    await withUser(user.id, async (tx) => {
      await audit(tx, user, {
        entityType: 'project',
        entityId: null,
        action: 'drive.projects_drafted',
        after: { created, names },
      });
      await notifySelf(tx, {
        userId: user.id,
        kind: 'security_alert',
        title: `${created} draft ${created === 1 ? 'project' : 'projects'} from Drive`,
        body: `${names.join(', ')} — set a type and owner to confirm.`,
        linkTo: '/projects',
      });
    }).catch(() => undefined);
  }

  revalidatePath('/documents');
  revalidatePath('/projects');

  return {
    ok: true,
    message:
      created === 0
        ? `Checked ${result.examined} ${result.examined === 1 ? 'folder' : 'folders'}. Nothing new.`
        : `Created ${created} draft ${created === 1 ? 'project' : 'projects'}: ${names.join(', ')}. Set a type and owner to confirm each one.`,
  };
}

/** The Drive folder a project is linked to, if any. */
async function projectDriveFolder(actorId: string, projectId: string): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select drive_folder_id from public.projects where id = ${projectId}
  `);
  return (rows[0]?.drive_folder_id as string | null) ?? null;
}
