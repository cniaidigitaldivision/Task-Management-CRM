'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { record } from '@/lib/db/queries/feed';
import * as R from '@/lib/db/queries/task-relations';
import * as T from '@/lib/db/queries/tasks';
import {
  MAX_ATTACHMENT_BYTES,
  safeFileName,
  storagePath,
  validateUpload,
} from '@/lib/domain/attachments';
import { can } from '@/lib/domain/permissions';
import { describeStorage, removeObject, signedUrl, uploadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * ATTACHMENT ACTIONS — FR-029
 * ----------------------------------------------------------------------------
 * ── THE ORDER OF THE TWO WRITES IS THE WHOLE DESIGN ──────────────────────────
 * A file lives in two places: an object in the bucket, and a row in
 * `attachments`. They cannot be written atomically — one is HTTP and the other
 * is Postgres — so one of them has to go first, and the choice decides which
 * failure the system suffers.
 *
 *   row first, then file   → a row pointing at nothing. The attachment appears
 *                            in the list, and every download fails forever.
 *   file first, then row   → an object nobody references. Invisible, costs a
 *                            few kilobytes, and cleanable.
 *
 * So: file first. An orphaned object is litter; an orphaned row is a broken
 * promise on screen. And when the row write fails, the object is deleted again
 * immediately — best-effort, because a failed cleanup must not turn one problem
 * into an error message about a second one.
 *
 * Deleting reverses it for the same reason: row first, then object. If the
 * object delete fails the row is already gone, so nobody sees a file they
 * cannot remove.
 * ========================================================================= */

export interface AttachmentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly note?: string;
  /** For a download: the short-lived link. */
  readonly url?: string;
}

const fail = (error: string): AttachmentResult => ({ ok: false, error });

function touch(): void {
  revalidatePath('/tasks');
  revalidatePath('/my-work');
}

/**
 * Attach a file to a task.
 *
 * Takes FormData rather than typed arguments because a File cannot be passed to
 * a server action any other way — it has to arrive as multipart, and Next's
 * action encoding gives us the `File` back on this side.
 */
export async function uploadAttachmentAction(
  taskId: string,
  form: FormData,
): Promise<AttachmentResult> {
  const user = await requireUser();

  const storage = describeStorage();
  if (!storage.configured) return fail(storage.reason ?? 'File storage is not set up.');

  /* The fetch is the authorisation: RLS returns nothing for a task this person
     cannot see, so "not found" and "not yours" collapse into one answer. */
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  /* `attachments_insert` also requires the task be visible, which it now is.
     This adds the doc 03 rule on top: commenting rights are the right test —
     an attachment is a contribution to the conversation about a task, and
     anybody who may comment may attach. */
  const actor = { role: user.role, id: user.id };
  if (
    !can(actor, 'task.comment', {
      assigneeId: task.assigneeId ?? undefined,
      createdById: task.createdById,
    })
  ) {
    return fail('You can attach files to tasks assigned to you or raised by you.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return fail('Choose a file first.');

  const fileName = safeFileName(file.name);
  const check = validateUpload({
    fileName,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!check.ok) return fail(check.message);

  /* The id is generated here rather than by the database, because the storage
     path needs it and the object is written before the row exists. */
  const attachmentId = crypto.randomUUID();
  const path = storagePath(taskId, attachmentId, fileName);

  const stored = await uploadObject({
    path,
    body: await file.arrayBuffer(),
    contentType: file.type,
  });
  if (!stored.ok) return fail(stored.message);

  try {
    await withUser(user.id, async (tx) => {
      await tx`
        insert into public.attachments
          (id, task_id, uploaded_by_id, file_path, file_name, mime_type, size_bytes)
        values (
          ${attachmentId}, ${taskId}, ${user.id},
          ${path}, ${fileName}, ${file.type}, ${file.size}
        )
      `;
      await record(tx, user.id, {
        entityType: 'task',
        entityId: taskId,
        action: 'attachment_added',
        summary: `attached ${fileName} to ${task.reference}`,
        after: { fileName, sizeBytes: file.size },
      });
    });
  } catch {
    /* The object is already up there and now references nothing. Take it back
       down. Best-effort: if this also fails, the result is a few unreferenced
       kilobytes, and reporting a cleanup failure on top of the real one helps
       nobody. */
    await removeObject(path);
    return fail('The file went up but could not be recorded. Nothing was saved — try again.');
  }

  touch();
  return { ok: true, note: `${fileName} attached.` };
}

/**
 * A link to download one.
 *
 * Minted per click and never stored. That is the point of the private bucket:
 * the link is derived from a permission check made a moment ago, rather than
 * being a permanent address that outlives the permission.
 */
export async function attachmentUrlAction(attachmentId: string): Promise<AttachmentResult> {
  const user = await requireUser();

  const attachment = await R.getAttachment(user.id, attachmentId);
  if (!attachment) return fail('That file is no longer here.');

  const link = await signedUrl(attachment.filePath, attachment.fileName);
  if (!link.ok) return fail(link.message);

  return { ok: true, url: link.value };
}

/**
 * Remove an attachment.
 *
 * `attachments_delete` permits the uploader or a Coordinator and above. RLS
 * expresses a refusal as zero rows rather than an error, so the row delete
 * reports whether it happened — otherwise the object would be destroyed for a
 * row that is still on screen, which is the worst of both.
 */
export async function deleteAttachmentAction(attachmentId: string): Promise<AttachmentResult> {
  const user = await requireUser();

  const attachment = await R.getAttachment(user.id, attachmentId);
  if (!attachment) return fail('That file is no longer here.');

  const removed = await R.deleteAttachmentRow(user.id, attachmentId);
  if (!removed) {
    return fail('Only whoever uploaded it, or a Coordinator, can remove a file.');
  }

  /* Row first, object second — see the header. A failure here leaves an
     unreferenced object, which is litter rather than a broken screen. */
  await removeObject(attachment.filePath);

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'task',
      entityId: attachment.taskId,
      action: 'attachment_removed',
      summary: `removed ${attachment.fileName}`,
      before: { fileName: attachment.fileName },
    }),
  );

  touch();
  return { ok: true, note: `${attachment.fileName} removed.` };
}

/** So the panel can say "storage is not configured" instead of failing on click. */
export async function storageStatusAction(): Promise<{
  configured: boolean;
  reason: string | null;
  maxBytes: number;
}> {
  await requireUser();
  const status = describeStorage();
  return {
    configured: status.configured,
    reason: status.reason,
    maxBytes: MAX_ATTACHMENT_BYTES,
  };
}
