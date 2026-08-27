'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as D from '@/lib/db/queries/documents';
import * as F from '@/lib/db/queries/drive-folders';
import { notify, notifySelf } from '@/lib/db/queries/feed';
import { accessAtLeast } from '@/lib/domain/folder-access';
import { validateUpload } from '@/lib/domain/attachments';
import {
  MAX_BYTES,
  maxLabel,
  toDestination,
  type UploadDestination,
} from '@/lib/domain/document-storage';
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

/* ============================================================================
 * ⚠️ THE SIZE LIMIT IS NOT ONE NUMBER, AND PRETENDING IT WAS CAUSED THE BUG
 * ----------------------------------------------------------------------------
 * On 2026-08-18 the owner reported uploads failing. There were FOUR limits in
 * play, none of them agreeing, and the app's was neither the smallest nor
 * derived from anything:
 *
 *   app `MAX_BYTES`               25 MB   a number I invented
 *   Supabase bucket               25 MB   and no video mime type at all
 *   Supabase project ceiling      50 MB   the real platform cap
 *   `documents_size_sane`        100 MB   what the table permits
 *
 * The actual failure was not size at all — the bucket's mime allow-list had no
 * `video/*` in it, so a video was refused with `415 invalid_mime_type`. Fixed on
 * the bucket. But raising the app limit to 100 MB, as I first did, would only
 * have moved the wall: the platform refuses at 50 MB with a different message.
 *
 * ── SO THE TWO PATHS HAVE DIFFERENT, HONEST CEILINGS ─────────────────────────
 * They pass through different systems, so one number cannot be right for both:
 *
 *   destination 'bucket'  bytes land in Supabase Storage → 50 MB, the project
 *                         ceiling. Raising it needs a paid plan, not a code
 *                         change.
 *   destination 'drive'   never touches Supabase → bounded instead by
 *                         `documents_size_sane` (100 MB) and by what one request
 *                         may carry and hold in memory.
 *
 * ⚠️ NEITHER SUITS RAW VIDEO. Both buffer the whole file server-side, so real
 * footage needs a resumable upload sent from the browser DIRECTLY to Drive, with
 * the server only minting the session. That is not built yet; until it is, the
 * message below says so rather than just refusing.
 *
 * ⚠️ BOTH NUMBERS NOW LIVE IN `lib/domain/document-storage.ts`, with `maxLabel`
 * beside them, because the upload FORM has to state the same ceiling this action
 * enforces. They were a private const here and a hard-coded sentence in the
 * dialog, which is two places to correct and one of them always gets missed.
 * ========================================================================= */

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
  /* ⚠️ When true the URL is signed with `?download=<the file's own name>`, which
     is what makes the browser SAVE it rather than navigate to it. Without it a PDF
     opens in a tab titled `1756...-contract.pdf` — the storage path, which is not a
     name anybody recognises. Two buttons, one action, because the permission check
     and the signing are identical and only the header differs. */
  download = false,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();

  const document = await D.getDocument(user.id, id);
  /* Invisible and non-existent give the same answer — the policy already made
     them indistinguishable and this must not undo that. */
  if (!document) return { ok: false, error: 'That document is not available.' };
  if (!document.storagePath) {
    return { ok: false, error: 'That file is no longer held here — it is in Drive.' };
  }

  const signed = await signedUrl(document.storagePath, download ? document.name : undefined);
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

  /* The typed name wins, falling back to the file's own. Somebody who has taken
     the trouble to name it meant that name. */
  const name = str(form, 'name') || file.name;
  if (!name) return fail('Give the document a name.');

  /* ── ⚠️ WHO UPLOADED IT DECIDES WHETHER IT NEEDS APPROVING ────────────────
     Owner, 2026-08-24: *"anything uploaded by admin, anything uploaded by
     Kashif — or anything uploaded by the team coordinator — will not be sent to
     approval. It will be automatically uploaded. For all the members anything
     they upload will be sent to admin for approval."*

     THE RULE IS NOW RANK, NOT FOLDER ACCESS. It used to be the inverse of this,
     and the inversion is the whole bug: `straightToDrive` was true only for a
     MEMBER who had been granted upload access to a registered Drive folder, and
     false for everybody senior — so a Coordinator's own upload went into the
     approval queue for a Coordinator to approve, and an Admin filing a contract
     waited on somebody else.

     `document.approve` is exactly the right question to ask: the person who
     would be allowed to approve this does not need to ask themselves. Coordinator
     and above, Member denied — the same predicate the queue uses, so the two can
     never disagree about who is exempt.

     ⚠️ AND IT NO LONGER MEANS "GOES TO GOOGLE DRIVE". That is now the separate,
     explicit `destination` below — see the note there for why the two must not be
     the same switch. */
  const folderId = str(form, 'folderId') || null;
  const skipsApproval = can(actor, 'document.approve');

  /* ── ⚠️ WHERE THE BYTES GO IS NOW ASKED, NOT INFERRED ─────────────────────
     Owner, 2026-08-24: *"When I create and want to upload something on the
     document page, how can I manage or select whether I want to save it in Google
     Drive or whether it is going to be saved in the Supabase bucket?"*

     It could not be selected because nothing asked. Between migration 048 and
     this change every upload went to the bucket, and before 048 every APPROVAL
     went to Drive — in both cases the store was a consequence of the flow rather
     than a decision. Now the form posts it.

     `toDestination` treats anything unrecognised as 'bucket' rather than
     erroring, because a missing field is exactly what a cached older client
     posts, and the safe reading of "I did not say" is "keep it here". */
  const destination: UploadDestination = toDestination(str(form, 'destination'));

  let folder: F.DriveFolderRow | null = null;
  if (folderId) {
    folder = await F.getFolder(user.id, folderId);
    if (!folder) return fail('That folder is not in the registry.');
    /* Folder access still governs whether somebody may file INTO a named folder —
       that is a separate question from whether their upload needs approving, and
       conflating the two is what produced the inverted rule above. */
    if (!skipsApproval && folder.memberAccess === 'none') {
      return fail(`You do not have access to ${folder.name}, so you cannot file into it.`);
    }
    if (!skipsApproval && !accessAtLeast(folder.memberAccess, 'upload')) {
      return fail(
        `You can view ${folder.name} but not add to it. Ask a Team Coordinator for upload access.`,
      );
    }
  }

  /* ── ⚠️ GOING TO DRIVE REQUIRES A DRIVE FOLDER, AND HAS TO ────────────────
     `uploadFile` accepts a null parent and would drop the file in the root of the
     connected account's My Drive. That is not a destination anybody chose — it is
     where a file goes to be lost, and it is the one outcome worse than a refusal.
     The registry is also the only place a permission for Drive can be checked, so
     without a folder there is nothing to check against either.

     ⚠️ THE ACCESS CHECK IS THE `if (folderId)` BLOCK ABOVE, deliberately reused
     rather than repeated: whatever governs filing INTO a folder must govern
     writing bytes into it, and a second copy of that rule would be the one that
     drifts. This only ensures the block ran.

     ⚠️ AND IT NARROWS INTO A LOCAL rather than checking `folder` again further
     down. The write needs both of the folder's ids, and re-deriving them at the
     call site would need a non-null assertion — which is where a refactor
     eventually puts a crash. */
  let driveTarget: { readonly folderId: string; readonly parentDriveId: string } | null = null;
  if (destination === 'drive') {
    if (!folder) {
      return fail(
        'Choose the Drive folder it goes into. Nothing is written to the top of Drive, because a file there is a file nobody finds again.',
      );
    }
    driveTarget = { folderId: folder.id, parentDriveId: folder.driveFolderId };
  }

  /* ── SIZE IS CHECKED AFTER THE DESTINATION IS KNOWN, BECAUSE IT DEPENDS ON IT
     See the note at the top: 50 MB through our bucket, 100 MB straight to Drive,
     and they differ because the paths do. Checked before the bytes are read, so an
     oversized file is refused without being pulled into memory first. */
  if (file.size > MAX_BYTES[destination]) {
    const mb = Math.round(file.size / 1_048_576);
    const other: UploadDestination = destination === 'bucket' ? 'drive' : 'bucket';
    return fail(
      `That file is ${mb} MB and the limit for ${
        destination === 'drive' ? 'Google Drive' : "this system's storage"
      } is ${maxLabel(destination)}.${
        file.size <= MAX_BYTES[other]
          ? ` It would fit in ${other === 'drive' ? 'Google Drive' : "this system's storage"} — change where it goes.`
          : ' Put something this large in shared storage and file the link instead.'
      }`,
    );
  }

  /* ── ⚠️ THE SAME CHECK THE TASK ATTACHMENTS USE ───────────────────────────
     This path had NO type validation at all: it handed whatever arrived to the
     bucket and translated the resulting HTTP 415 into a sentence afterwards. That
     is why a PowerPoint reported by the browser as `application/octet-stream`
     produced "Files of this type () are not accepted" — a refusal naming nothing,
     after a pointless round trip.

     `validateUpload` refuses executables by extension, accepts an Office file
     whose MIME type the browser could not determine, and always says which file
     and why. See lib/domain/attachments.ts. */
  const check = validateUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!check.ok) return fail(check.message);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  const description = str(form, 'description') || null;
  const projectId = str(form, 'projectId') || null;

  /* ══ DESTINATION: GOOGLE DRIVE ═══════════════════════════════════════════
     The bytes never touch our bucket, so there is no object to orphan and no
     `storage_path` on the row — which is why this returns early rather than
     joining the path below. */
  if (driveTarget !== null) {
    const sent = await Drive.uploadFile({
      name,
      mimeType,
      bytes,
      parentFolderId: driveTarget.parentDriveId,
    });

    if (!sent.ok) {
      /* ⚠️ `configured` separates two failures with two different fixes — the
         same distinction the Drive settings panel makes. "Drive refused it" is
         something to read; "nobody has connected Drive" is something to do. */
      return fail(
        sent.configured
          ? `Google Drive did not accept the file: ${sent.reason}`
          : 'Google Drive is not connected, so nothing can be written there. An Admin connects it in Documents → Drive settings — or change where it goes and keep the file here instead.',
      );
    }

    let driveDocumentId: string;
    try {
      driveDocumentId = await D.createApprovedDocument(user.id, {
        name,
        description,
        projectId,
        folderId: driveTarget.folderId,
        mimeType,
        sizeBytes: file.size,
        driveFileId: sent.value.id,
        driveWebLink: sent.value.webViewLink,
      });
    } catch {
      /* ⚠️ THE FILE IS IN DRIVE AND THE ROW IS NOT. Deliberately NOT trashed to
         "clean up": the bytes are safely in the company's own store, which is
         where the person asked them to go, and deleting somebody's file because
         our register insert failed is the unrecoverable half of this pair. So it
         says exactly where the file is, by name, and stops. */
      return fail(
        `${name} is in Google Drive, in ${folder?.name ?? 'the chosen folder'}, but it could not be recorded in the register here. The file is safe — file it again from the Drive folder list, or ask an Admin to re-sync.`,
      );
    }

    await withUser(user.id, (tx) =>
      audit(tx, user, {
        entityType: 'document',
        entityId: driveDocumentId,
        /* Not `document.requested`: nothing was requested, and an audit reader
           filtering for the approval queue must not be handed this. */
        action: 'document.uploaded',
        after: {
          name,
          sizeBytes: file.size,
          projectId,
          destination: 'drive',
          driveFolder: folder?.name ?? null,
          driveFileId: sent.value.id,
        },
      }),
    ).catch(() => console.error('[documents] audit write failed for a Drive upload'));

    revalidatePath('/documents');
    revalidatePath('/projects');
    return {
      ok: true,
      message: `${name} is in Google Drive, in ${folder?.name ?? 'the chosen folder'}. No approval was needed — it is already there.`,
    };
  }

  /* ══ DESTINATION: THIS SYSTEM'S PRIVATE STORAGE ══════════════════════════
     ── WHAT HAPPENED, DECIDED ONCE ──────────────────────────────────────────
     The Drive path has returned by here, so there are two outcomes left and
     everything downstream — the audit action, whether approvers are notified, what
     the person is told — reads this one value rather than each re-deriving it from
     `skipsApproval` and getting it subtly wrong.

     ⚠️ THE BUG THAT MOTIVATED NAMING IT: the approver notification fired on every
     upload and told everybody "it is waiting for approval before it goes to Google
     Drive". For a Coordinator's own upload — approved on arrival — that was two
     falsehoods in one sentence. */
  const outcome: 'filed' | 'queued' = skipsApproval ? 'filed' : 'queued';

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
  const path = `documents/${user.id}/${Date.now()}-${safeName}`;

  const stored = await uploadObject({
    path,
    body: bytes,
    contentType: mimeType,
  });
  if (!stored.ok) {
    /* ── ⚠️ THE RAW MESSAGE IS A JSON BLOB, AND THE OWNER SAW IT ──────────────
       This used to interpolate Supabase's response verbatim, which produced:

         That file could not be stored: The upload was rejected.
         ({"statusCode":"415","error":"invalid_mime_type","message":"mime type
         video/mp4 is not supported","code":"InvalidMimeType"})

       Every fact needed to diagnose it was in there and none of it told the
       person what to do. The two failures worth naming are named; anything else
       still shows the original, because an unrecognised error is better read than
       paraphrased into something vague. */
    const raw = stored.message;

    if (/invalid_mime_type|InvalidMimeType/.test(raw)) {
      return fail(
        `Files of this type (${file.type || 'unknown'}) are not accepted by this system's own storage. An Admin can allow the type — or change where it goes to Google Drive, which takes it as it is.`,
      );
    }
    if (/Payload too large|exceeded the maximum allowed size|413/.test(raw)) {
      return fail(
        `That file is larger than this system's storage accepts. Anything over ${maxLabel(
          'bucket',
        )} has to go to Google Drive instead — change where it goes on the form.`,
      );
    }

    return fail(`That file could not be stored: ${raw}`);
  }

  let documentId: string;
  try {
    const row = {
      name,
      description,
      projectId,
      folderId,
      storagePath: path,
      mimeType,
      sizeBytes: file.size,
    };
    /* The only difference between the two bucket paths — see the rank note
       above. Both write the same object to the same bucket; one lands `approved`
       and one lands `pending`. */
    documentId = skipsApproval
      ? await D.createDocumentApproved(user.id, row)
      : await D.createDocumentRequest(user.id, row);
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
      /* ⚠️ The two are distinguishable afterwards on purpose. `document.requested`
         means it entered the queue; `document.uploaded` means rank made a queue
         unnecessary. An audit reader asking "what went through approval" was
         previously handed both. */
      action: outcome === 'queued' ? 'document.requested' : 'document.uploaded',
      after: { name, sizeBytes: file.size, projectId, destination: 'bucket' },
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
       that trains people to ignore the notification.

       ⚠️ AND ONLY WHEN SOMETHING IS ACTUALLY WAITING. This block used to run for
       every upload, so a Coordinator filing a contract — approved on arrival —
       sent every other approver a notification saying it was "waiting for
       approval before it goes to Google Drive". Two falsehoods in one sentence:
       nothing was waiting, and nothing was going to Drive. */
    if (outcome !== 'queued') return;

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
        body: 'It is held in private storage and waiting for you to accept it.',
        linkTo: '/documents',
        entityId: documentId,
      });
    }
  }).catch(() => {
    console.error('[documents] audit or notification write failed for a request');
  });

  revalidatePath('/documents');
  /* The project Files tab reads the same rows. Without this a file uploaded from
     a project page would not appear there until something else invalidated it. */
  revalidatePath('/projects');
  return {
    ok: true,
    message:
      outcome === 'filed'
        ? `${name} is filed in this system's storage. Your rank means it needed no approval.`
        : `${name} is uploaded and waiting for an Admin to accept it. It is not in Google Drive.`,
  };
}


/* ==========================================================================
 * APPROVE — Coordinator and above
 * ========================================================================== */

export async function approveDocumentAction(id: string): Promise<DocumentResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'document.approve')) {
    return fail('Only a Team Coordinator or above can accept a document.');
  }

  const document = await D.getDocument(user.id, id);
  if (!document) return fail('That document is not available.');
  if (document.state !== 'pending') return fail(`That document is already ${document.state}.`);
  if (!document.storagePath) return fail('That file is missing from storage.');

  /* ── ⚠️ ACCEPTANCE MOVES NOTHING. IT IS A STATE CHANGE. ────────────────────
     Owner, 2026-08-24: *"I will accept it and then it will be added to the
     bucket."* It is already in the bucket — a pending document has always been a
     real object in private Supabase storage. So the whole of what follows used to
     be ceremony with a cost:

       · it required a configured Google OAuth client, and refused outright
         without one — "No Google OAuth client is configured, so nothing can be
         approved into Drive";
       · it required somebody to have consented to that client;
       · it downloaded the bytes through a signed URL and re-uploaded them;
       · it then DELETED the object from our bucket, because
         `documents_state_is_coherent` demanded `storage_path is null` on an
         approved row.

     Which is the opposite of "it will be saved in Supabase". Migration 048
     relaxed the constraint; this is now three lines and cannot fail for a reason
     that has nothing to do with the document.

     ⚠️ THE DRIVE-COPYING CODE IS GONE RATHER THAN LEFT DISABLED. It was ~90
     lines across this file — `uploadStraightToDrive`, `projectDriveFolder` and a
     second size limit — and none of it had a caller once the rule became "the
     bucket is where documents live". Code with no caller is not a spare wheel; it
     is what stops compiling six months from now and gets deleted in a hurry by
     somebody who does not know what it was for. Git remembers it, and
     `lib/drive/*` still exists for the folder registry and the sync, which are
     genuinely still used. */
  await D.markApproved(user.id, id);

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.approved',
      after: { name: document.name },
    });
    await notify(tx, user.id, {
      userId: document.uploadedById,
      kind: 'security_alert',
      title: `${document.name} was accepted`,
      body: `${user.fullName} accepted it. It is filed and everybody on the project can open it.`,
      linkTo: '/documents',
      entityId: id,
    });
  }).catch(() => console.error('[documents] audit write failed for an approval'));

  revalidatePath('/documents');
  revalidatePath('/projects');
  return { ok: true, message: `${document.name} is filed.` };
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
  revalidatePath('/projects');
  return { ok: true, message: 'Saved.' };
}

/**
 * Rename a file. Admin, Super Admin and Team Coordinator.
 *
 * Owner, 2026-08-24: *"only in the admin and team coordinator access, I want
 * that… he can delete it, change the name of the file, view it."*
 *
 * `document.manage` is exactly that set — allow for Super Admin, Admin and Team
 * Coordinator, deny for Member (permissions.ts) — so the gate is the existing
 * permission rather than a role list written out again here. Row-level security
 * decides WHICH documents; this decides whether the verb is available at all.
 *
 * ── ⚠️ WHY NOT `updateDocumentAction` WITH A NAME-ONLY FORM ──────────────────
 * That action reads `description` and `projectId` off the form and writes both.
 * Posted from a rename box with neither field, it would blank the description and
 * detach the document from its project — on the project page whose Files tab you
 * renamed it from, so the row would vanish from the list as a side effect of being
 * renamed. See `renameDocument` in the query layer.
 *
 * ── ⚠️ WHAT THIS DOES *NOT* RENAME ──────────────────────────────────────────
 * The file in Google Drive, for a row that has one. Drive is the company's own
 * store and this is our register's label for it; quietly renaming somebody's Drive
 * file from a CRM list is a surprise in a place people do not look. The message
 * says so rather than leaving it to be discovered.
 */
export async function renameDocumentAction(
  id: string,
  name: string,
): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'document.manage')) {
    return fail('Only an Admin or a Team Coordinator can rename a file.');
  }

  const trimmed = name.trim();
  if (!trimmed) return fail('Give the file a name.');
  /* `documents.name` is text with no length cap, so this is a sanity bound rather
     than a database rule: a name longer than a line is unreadable in every list
     that shows it. */
  if (trimmed.length > 200) return fail('That name is too long — keep it under 200 characters.');

  const document = await D.getDocument(user.id, id);
  if (!document) return fail('That document is no longer there.');
  if (document.name === trimmed) return { ok: true, message: 'That is already its name.' };

  const renamed = await D.renameDocument(user.id, id, trimmed);
  if (!renamed) return fail('That file could not be renamed.');

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'document',
      entityId: id,
      action: 'document.renamed',
      before: { name: document.name },
      after: { name: trimmed },
    }),
  ).catch(() => console.error('[documents] audit write failed for a rename'));

  revalidatePath('/documents');
  revalidatePath('/projects');
  return {
    ok: true,
    message: document.driveFileId
      ? `Renamed to ${trimmed} here. The file in Google Drive keeps its own name.`
      : `Renamed to ${trimmed}.`,
  };
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
  /* The project Files tab lists the same rows — see the note on the upload. */
  revalidatePath('/projects');
  return {
    ok: true,
    message: document.driveFileId
      ? `${document.name} is off the list. The file itself is still in Google Drive.`
      : `${document.name} is deleted, and the file with it.`,
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

/**
 * The Drive folder id out of whatever a person actually pasted.
 *
 * ── ⚠️ NOBODY KNOWS THEIR FOLDER ID, AND THE FIELD USED TO DEMAND ONE ────────
 * Owner, 2026-08-18: *"if I type some folder name, it's not visible."* Quite —
 * the field wanted `1AbC…`, an opaque string you can only get by opening the
 * folder in Drive and reading the address bar. What people naturally do is paste
 * the whole URL, or type the folder's name.
 *
 * A URL we can handle, and do. A NAME we cannot — two folders may share one, and
 * guessing which was meant is the kind of helpfulness that files documents
 * somewhere nobody expects. So a name is refused, and the message points at the
 * folder list, where picking by name is exactly what happens.
 */
function driveFolderIdFrom(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  /* .../folders/<id>  ·  ...?id=<id>  ·  .../d/<id>/...  — the three shapes
     Drive puts in an address bar. */
  const fromUrl =
    /\/folders\/([a-zA-Z0-9_-]{10,})/.exec(trimmed) ??
    /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(trimmed) ??
    /\/d\/([a-zA-Z0-9_-]{10,})/.exec(trimmed);
  if (fromUrl) return fromUrl[1];

  return trimmed;
}

/** What a Drive id looks like: no spaces, and long. `root` is Drive's own alias
 *  for My Drive and is deliberately allowed through. */
function looksLikeDriveId(value: string): boolean {
  return value === 'root' || /^[a-zA-Z0-9_-]{10,}$/.test(value);
}

export async function setWatchedFolderAction(folderId: string): Promise<DocumentResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'drive.configure')) {
    return fail('Only an Admin can choose the watched folder.');
  }

  const trimmed = driveFolderIdFrom(folderId);
  if (!trimmed) {
    await D.setWatchedFolder(user.id, null);
    revalidatePath('/documents');
    return { ok: true, message: 'Folder watching is off. No projects will be created.' };
  }

  /* Caught here rather than sent to Google, because Drive answers a folder NAME
     with the same 404 it gives a deleted folder — and "that folder may not
     exist" is a useless thing to read when you typed "Client Work" and it does. */
  if (!looksLikeDriveId(trimmed)) {
    return fail(
      `"${trimmed}" is a folder name, not a folder id. Press "Read folders from Drive" below and pick it from the list — or paste the folder's full URL from Drive and this will take the id out of it.`,
    );
  }

  /* Confirmed before it is saved. Saving an unreachable id would mean the poll
     failing silently every few minutes, with the reason only ever appearing in
     a log. */
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

