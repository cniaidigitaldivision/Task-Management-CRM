'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { createLibraryDocument } from '@/lib/db/queries/library';
import {
  LIBRARY_CATEGORY_LABEL,
  isLibraryViewable,
  libraryExtensionOf,
  toLibraryCategory,
  validateLibraryUpload,
} from '@/lib/domain/library';
import { can } from '@/lib/domain/permissions';
import { removeLibraryObject, uploadLibraryObject } from '@/lib/storage/library';

/* ============================================================================
 * ADDING TO THE COMPANY LIBRARY — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"On the documentation page within the Company Library tab, there is no button
 * to upload any file in this category or in this company library. Add a proper
 * form modal or popup which will let me upload only to this company library…
 * Make sure that everything is logically properly implemented and isolated. It
 * will not disturb or break any other working thing."*
 *
 * ── ⚠️ WHY THIS IS ITS OWN ACTION FILE AND NOT A FUNCTION IN documents.ts ────
 * "Isolated" is the owner's word and it is also the correct design. The two
 * flows share a screen and nothing else:
 *
 *                      app/actions/documents.ts       this file
 *   bucket             CNI-Task Management Docs       cni-library
 *   who may write      everybody (`document.request`) Admin+ (`library.manage`)
 *   approval          pending → approved → Drive     none; it is published
 *   table              public.documents               public.library_documents
 *   what a row is      one project's file             company collateral
 *
 * `requestDocumentAction` is ~250 lines that branch on destination, folder
 * access, rank and approval. Adding a third branch to it for a flow that shares
 * none of those inputs is how a change to the library breaks an upload — which
 * is precisely what the owner asked not to happen. Nothing in this file imports
 * from that one, and nothing in that one changes.
 *
 * ── THE ORDER OF OPERATIONS ─────────────────────────────────────────────────
 *   1. permission        `library.manage`, Admin+
 *   2. validate          the same pure rules the dialogue already ran
 *   3. bytes → bucket    `cni-library`
 *   4. row → database    through RLS, as the caller
 *   5. on a failed 4     DELETE THE OBJECT, then report
 *
 * Step 5 is the half that is normally skipped. Without it a failed insert leaves
 * a paid-for object nobody can see, list or remove — and because `storage_path`
 * is unique, retrying the same file under a fresh uuid works, so the litter is
 * never even noticed. The bytes are ours and nobody else's, so unlike the Drive
 * path in `requestDocumentAction` there is no reason to keep them.
 * ========================================================================= */

export interface LibraryResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
}

const fail = (error: string): LibraryResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/**
 * A path inside the `cni-library` bucket.
 *
 * `<category>/<uuid>-<readable name>.<ext>`, and every part of that earns its
 * place:
 *
 *   category   the owner's reason for the bucket was *"where I can easily manage
 *              them"* — browsing it in the Supabase dashboard has to group the
 *              way the screen does. The existing rows are foldered by hand
 *              (`packages/2026/…`); this is the same idea, generated.
 *   uuid       `library_documents_path_key` is unique. Two files genuinely named
 *              `rate-card.pdf` a year apart must not collide, and a collision
 *              here uploads with `x-upsert: true` — it would OVERWRITE the older
 *              document's bytes while its row still points at them.
 *   the name   so a human reading the bucket recognises the file. A directory of
 *              bare uuids is unmanageable, which is the thing being avoided.
 *   the ext    load-bearing, not cosmetic: `/api/library/[id]` takes the download
 *              filename's suffix FROM THE PATH (`nameWithExtension`). Drop it and
 *              every download arrives extensionless.
 */
function objectPath(category: string, fileName: string): string {
  const extension = libraryExtensionOf(fileName);
  const stem = fileName
    .slice(0, extension ? fileName.length - extension.length - 1 : undefined)
    .toLowerCase()
    /* ASCII, lowercase, dashes. The path is a URL segment and a header value
       further downstream; anything else is somebody else's escaping bug. */
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const base = `${crypto.randomUUID()}${stem ? `-${stem}` : ''}`;
  return `${category}/${base}${extension ? `.${extension}` : ''}`;
}

export async function uploadLibraryDocumentAction(
  _prev: LibraryResult,
  form: FormData,
): Promise<LibraryResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'library.manage')) {
    return fail(
      'Only an Admin can add to the company library. Everybody can read it — ask an Admin to publish this one.',
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return fail('Choose a file to add to the library.');
  }

  /* The typed title wins, falling back to the file's own name. Somebody who has
     taken the trouble to name it meant that name — and the title is what the
     library lists and what a download is called, so it is worth typing. */
  const title = str(form, 'title') || file.name;
  if (!title) return fail('Give the document a title.');
  if (title.length > 200) {
    return fail('That title is too long for the library list — keep it under 200 characters.');
  }

  /* ⚠️ Validated against the enum rather than cast. `category` arrives from a
     form, which is a claim; an unlisted value reaches Postgres as an invalid enum
     input and comes back as a message about a type nobody typed. */
  const category = toLibraryCategory(str(form, 'category'));
  if (!category) return fail('Choose which kind of document this is.');

  /* ⚠️ THE SAME PURE FUNCTION THE DIALOGUE RAN, run again here. The client copy
     saves a pointless upload; this one is the decision. A form field is a claim
     and `accept` on a file input is a filter on a picker, not a rule. */
  const check = validateLibraryUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!check.ok) return fail(check.message);

  const summary = str(form, 'summary') || null;

  /* ── PAGE COUNT: OPTIONAL, AND REFUSED RATHER THAN COERCED ────────────────
     `library_pages_sane` permits null or a positive integer, so "0" and "twelve"
     are refused here with a sentence instead of arriving as a constraint
     violation. Left empty the row shows its file size, which is what the panel
     already does for anything unpaginated. */
  const pagesTyped = str(form, 'pageCount');
  let pageCount: number | null = null;
  if (pagesTyped) {
    const parsed = Number(pagesTyped);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000) {
      return fail('Pages has to be a whole number above zero, or left empty.');
    }
    pageCount = parsed;
  }

  const mimeType = file.type || 'application/octet-stream';
  const path = objectPath(category, file.name);

  const stored = await uploadLibraryObject({
    path,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: mimeType,
  });
  if (!stored.ok) {
    /* `uploadLibraryObject` already maps the two failures worth naming — an
       unaccepted type and the size ceiling — into sentences. Anything else is
       passed through rather than paraphrased, because an unrecognised storage
       error is more useful read than made vague. */
    return fail(stored.message);
  }

  let id: string;
  try {
    id = await createLibraryDocument(user.id, {
      title,
      category,
      storagePath: path,
      mimeType,
      sizeBytes: file.size,
      summary,
      pageCount,
      /* Derived, never asked — see `isLibraryViewable`. It decides whether the
         row offers "open in a tab", and whether the route serves the bytes
         inline or as a download. */
      isViewable: isLibraryViewable(mimeType, file.name),
    });
  } catch {
    /* ⚠️ THE ROLLBACK. See the header: without it the bucket keeps an object no
       screen can reach and no query can find, and the person simply retries. */
    await removeLibraryObject(path);
    return fail(
      `${title} could not be recorded in the library, so it was not kept. Nothing was changed — try again, and tell an Admin if it keeps happening.`,
    );
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      /* 'document' rather than a new entity type: the audit reader's existing
         document filter is the right place to find "an Admin published company
         collateral". The action name carries the distinction. */
      entityType: 'document',
      entityId: id,
      action: 'library.published',
      after: { title, category, sizeBytes: file.size, mimeType, storagePath: path },
    }),
  ).catch(() => console.error('[library] audit write failed for a library upload'));

  /* Only this page lists the library. Revalidating anything else would be a
     guess, and a wrong one costs every other screen a re-render. */
  revalidatePath('/documents');

  return {
    ok: true,
    message: `${title} is in the company library, under ${LIBRARY_CATEGORY_LABEL[category]}. Everybody signed in can read it now.`,
  };
}
