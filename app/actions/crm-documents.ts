'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmDocumentPath, crmRecordDocument } from '@/lib/db/queries/crm-documents';
import { DOCUMENT_KINDS } from '@/lib/domain/crm-documents';
import { signedUrl, uploadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * UPLOADING A DOCUMENT — migration 178
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"You didn't provide me a place where I can upload these
 * documents."* The letterhead had been the top blocking item on all 18 projects
 * for a day with nowhere to put one.
 *
 * ⚠️ `requireCrmAccess`, NOT a rank. The people whose job this is are `member` —
 * the bottom of Taskly's ladder — so a role check would have locked out exactly
 * the people the feature is for. Same reasoning as every other CRM route.
 *
 * ⚠️ FormData RATHER THAN TYPED ARGUMENTS, because a File cannot cross a server
 * action boundary any other way. Everything out of it is a claim and is checked.
 * ========================================================================= */

export interface UploadResult {
  readonly ok: boolean;
  readonly error?: string;
}

/* ⚠️ The bucket's own allowlist is wider than this — it takes video and zip.
   A letterhead, a brochure or a booking form is a document or an image, and a
   narrower list here means a mistyped upload is refused with a sentence rather
   than accepted and never opened. */
const ALLOWED = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const MAX_BYTES = 20 * 1024 * 1024;

const str = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

export async function uploadCrmDocumentAction(
  _prev: UploadResult,
  form: FormData,
): Promise<UploadResult> {
  const { user } = await requireCrmAccess();

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 20 MB.` };
  }
  if (!ALLOWED.has(file.type)) {
    return {
      ok: false,
      /* ⚠️ NAMES WHAT WAS SENT. "Unsupported file type" makes somebody guess. */
      error: `${file.type || 'That file type'} cannot be stored here — use a PDF, an image, or an Office document.`,
    };
  }

  const projectId = str(form, 'projectId');
  if (!projectId) return { ok: false, error: 'Choose which project this belongs to.' };

  /* ⚠️ VALIDATED AGAINST THE ENUM, never cast. A value from a form is a claim,
     and an unlisted one reaches Postgres as an invalid enum input — which comes
     back as a message about a type nobody typed. */
  const kind = str(form, 'kind');
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'Choose what kind of document this is.' };
  }

  const leadId = str(form, 'leadId') || null;
  const title = str(form, 'title') || file.name;
  if (title.length > 200) {
    return { ok: false, error: 'Keep the title under 200 characters — it is what the list shows.' };
  }

  /* ⚠️ THE PATH CARRIES A UUID AND THE `crm/` PREFIX. The uuid means an upload
     can never overwrite another (178 has a unique index on the path, so a
     collision would be refused rather than silent). The prefix keeps CRM files
     identifiable in a shared bucket when the module is lifted out. */
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().slice(0, 8) : 'bin';
  const path = `crm/${projectId}/${randomUUID()}.${ext}`;

  const stored = await uploadObject({
    path,
    body: await file.arrayBuffer(),
    contentType: file.type,
  });
  if (!stored.ok) {
    /* ⚠️ WHATEVER STORAGE ACTUALLY SAID. This codebase has a standing lesson
       about catch blocks naming a cause nobody verified. */
    return { ok: false, error: stored.message ?? 'The file could not be stored.' };
  }

  /* ⚠️ RECORDED ONLY ONCE THE BYTES ARE THERE. A row written first would list a
     document that 404s — and the first one anybody clicks would be the
     letterhead. */
  const row = await crmRecordDocument(user.id, {
    projectId,
    leadId,
    kind,
    title,
    storagePath: path,
    mime: file.type,
    sizeBytes: file.size,
  });
  if (!row) {
    return {
      ok: false,
      error: 'That project is not one you can file documents against.',
    };
  }

  revalidatePath('/documents');
  revalidatePath('/my-leads');
  return { ok: true };
}

/**
 * A short-lived link to open one.
 *
 * ⚠️ THE PATH IS READ BACK UNDER RLS rather than taken from the caller. Handed a
 * path directly, this would sign anything in the bucket for anybody — including
 * another department's files.
 */
export async function crmDocumentLinkAction(id: string): Promise<{ url?: string; error?: string }> {
  const { user } = await requireCrmAccess();

  const path = await crmDocumentPath(user.id, id);
  /* The same answer for "gone" and "not yours", so this cannot be used to find
     out which document ids exist. */
  if (!path) return { error: 'That document could not be opened. It may not be yours to see.' };

  const link = await signedUrl(path);
  return link.ok ? { url: link.value } : { error: link.message ?? "The link could not be made." };
}
