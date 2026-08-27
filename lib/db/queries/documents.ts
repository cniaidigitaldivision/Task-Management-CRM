import 'server-only';

import { sql, withUser } from '../client';
import { isoOrNull } from '../row-values';
import type { FolderAccess } from '@/lib/domain/folder-access';

/* ============================================================================
 * THE DOCUMENT REGISTER — migration 025
 * ----------------------------------------------------------------------------
 * Every query runs as the caller, so `app.can_read_document` decides what comes
 * back: Admin+ sees the whole register, anybody sees their own uploads and
 * anything on a project visible to them. There is no `where` clause here doing
 * that job, which is the point.
 * ========================================================================= */

export type DocumentState = 'pending' | 'approved' | 'rejected';

export interface DocumentRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly folderId: string | null;
  readonly folderName: string | null;
  /** What Members may do in the folder it is filed in. Carried on the row so the
   *  register can say WHY a document is visible, rather than leaving somebody to
   *  infer it. `'none'` when it is unfiled. */
  readonly folderAccess: FolderAccess;
  readonly state: DocumentState;
  readonly storagePath: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly driveFileId: string | null;
  readonly driveWebLink: string | null;
  readonly uploadedById: string;
  readonly uploadedByName: string | null;
  /** For the Files table's "Added by" column. A row of faces is only
   *  recognisable if it has faces in it. */
  readonly uploadedByAvatarUrl: string | null;
  /**
   * Which upload of this name-and-project this row is, oldest first.
   *
   * ⚠️ COUNTED, NOT STORED. There is no version column in the schema — see the
   * note in `SELECT`. So `version` is 1 for a file uploaded once, and the newest
   * of three uploads of the same name is 3.
   */
  readonly version: number;
  /** How many uploads share this name and project. `version === versionCount`
   *  means this is the current one. */
  readonly versionCount: number;
  /** The uploader's role on this project, as a raw enum. Null when they are not a
   *  member of it — which happens, and reads as no role rather than an error. */
  readonly uploadedByProjectRole: string | null;
  /** The project's type, for the second line under its name. */
  readonly projectType: string | null;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: string;
}

const SELECT = `
  select d.id, d.name, d.description, d.project_id, d.folder_id, d.state,
         d.storage_path, d.mime_type, d.size_bytes, d.drive_file_id,
         d.drive_web_link, d.uploaded_by_id, d.decided_at, d.decision_reason,
         d.created_at,
         p.name as project_name,
         f.name as folder_name,
         coalesce(f.member_access, 'none'::public.folder_access) as folder_access,
         u.full_name as uploaded_by_name,
         u.avatar_url as uploaded_by_avatar_url,
         dc.full_name as decided_by_name,
         p.type as project_type,
         /* ── VERSION, DERIVED FROM THE UPLOAD HISTORY THAT ALREADY EXISTS ────
            The owner's layout shows a version under each file name. There is no
            version column anywhere in this schema and inventing one on the row
            would be a made-up number printed as a fact.

            But the history is real: uploading "Project Plan" into GC Royal three
            times IS three rows, and the third one is version 3. So it is counted
            rather than stored — a window function over name-and-project, oldest
            first.

            ⚠️ MATCHED ON A NORMALISED NAME. "project plan.pdf", "Project Plan.pdf"
            and " Project Plan.pdf " are the same document to a person, and treating
            them as three separate v1s would make the column useless the first time
            somebody typed a capital differently. 'btrim' and 'lower' are the
            cheapest defence that does not also merge genuinely different files.

            ⚠️ PARTITIONED BY project_id, so the same brief filed under two clients
            does not become v2 of the other. 'coalesce' to a constant uuid keeps
            unfiled documents partitioned together rather than each in a null
            partition of its own — nulls never group in a window.

            ⚠️ RUNS OVER WHAT THE READER MAY SEE, because 'documents' is behind RLS.
            So a version is "the Nth of these you can see", which is the same
            honesty the folder counts carry and the only thing it could truthfully
            be without a stored column. */
         row_number() over (
           partition by lower(btrim(d.name)),
                        coalesce(d.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
           order by d.created_at
         ) as version,
         count(*) over (
           partition by lower(btrim(d.name)),
                        coalesce(d.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
         ) as version_count,
         /* What the uploader does ON THIS PROJECT — "Manager", "Design" — rather
            than their system rank. The owner's layout shows a job under the name,
            and a project role is the honest source: PROJECT_ROLE_LABEL already
            turns these into words for three other screens. */
         pm.role as uploaded_by_project_role
    from public.documents d
    left join public.projects p  on p.id = d.project_id
    left join public.drive_folders f on f.id = d.folder_id
    left join public.users    u  on u.id = d.uploaded_by_id
    left join public.users    dc on dc.id = d.decided_by_id
    left join public.project_members pm
           on pm.project_id = d.project_id and pm.user_id = d.uploaded_by_id
`;

function toRow(row: Record<string, unknown>): DocumentRow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
    folderName: (row.folder_name as string | null) ?? null,
    folderAccess: (row.folder_access as FolderAccess) ?? 'none',
    state: row.state as DocumentState,
    storagePath: (row.storage_path as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    driveFileId: (row.drive_file_id as string | null) ?? null,
    driveWebLink: (row.drive_web_link as string | null) ?? null,
    uploadedById: row.uploaded_by_id as string,
    uploadedByName: (row.uploaded_by_name as string | null) ?? null,
    uploadedByAvatarUrl: (row.uploaded_by_avatar_url as string | null) ?? null,
    /* ⚠️ Defaulted to 1, not 0. Every path that reads a document row goes through
       here, and `getDocument` does not compute the window — a document is at least
       its own first version, and 0 would print as "v0". */
    version: Number(row.version ?? 1),
    versionCount: Number(row.version_count ?? 1),
    uploadedByProjectRole: (row.uploaded_by_project_role as string | null) ?? null,
    projectType: (row.project_type as string | null) ?? null,
    decidedByName: (row.decided_by_name as string | null) ?? null,
    decidedAt: isoOrNull(row.decided_at),
    decisionReason: (row.decision_reason as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

/**
 * Everything this actor may see.
 *
 * Pending first, then newest — the queue is the reason an Admin opens this screen,
 * and a queue sorted by date puts the oldest waiting item wherever it happens to
 * fall. `state = 'pending'` sorts before the rest explicitly rather than relying
 * on the enum's declaration order, which is a fact about the type rather than a
 * decision about this list.
 */
export async function listDocuments(actorId: string): Promise<DocumentRow[]> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${SELECT}
      order by (d.state = 'pending') desc, d.created_at desc`),
  );
  return rows.map((row) => toRow(row as Record<string, unknown>));
}

export async function getDocument(
  actorId: string,
  id: string,
): Promise<DocumentRow | null> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${SELECT} where d.id = $1`, [id]),
  );
  const row = rows[0];
  return row ? toRow(row as Record<string, unknown>) : null;
}

/** A request. Always `pending` — the policy refuses anything else on insert. */
export async function createDocumentRequest(
  actorId: string,
  input: {
    name: string;
    description: string | null;
    projectId: string | null;
    /** The registry folder to file it in. Null means unfiled — Admin+ only by
     *  `app.can_read_document`, which is why the upload form offers a folder. */
    folderId: string | null;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
  },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.documents
      (name, description, project_id, folder_id, storage_path, mime_type,
       size_bytes, uploaded_by_id)
    values
      (${input.name}, ${input.description}, ${input.projectId}, ${input.folderId},
       ${input.storagePath}, ${input.mimeType}, ${input.sizeBytes}, ${actorId})
    returning id
  `);
  return rows[0].id as string;
}

/**
 * Record a document that went STRAIGHT to Drive — no approval queue.
 *
 * ── ⚠️ THE DECIDER IS THE UPLOADER, AND THAT IS HONEST ───────────────────────
 * `documents_state_is_coherent` requires an approved row to name who decided.
 * Here that is the uploader, because the decision was genuinely theirs to make:
 * somebody senior enough to grant `upload` on this folder had already decided
 * that anyone with access may file into it (owner, 2026-08-16 — *"it shouldn't
 * be required approval because an admin is assigning access"*). Naming the
 * granting Coordinator instead would be a lie about who pressed the button; a
 * null would break the state machine. The audit trail carries the folder and its
 * level, so "why was this allowed" is answerable.
 *
 * `storage_path` is never set: the bytes went to Drive, not to our bucket, so
 * there is nothing to clean up afterwards.
 */
export async function createApprovedDocument(
  actorId: string,
  input: {
    name: string;
    description: string | null;
    projectId: string | null;
    folderId: string;
    mimeType: string;
    sizeBytes: number;
    driveFileId: string;
    driveWebLink: string | null;
  },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.documents
      (name, description, project_id, folder_id, mime_type, size_bytes,
       uploaded_by_id, state, drive_file_id, drive_web_link,
       decided_by_id, decided_at)
    values
      (${input.name}, ${input.description}, ${input.projectId}, ${input.folderId},
       ${input.mimeType}, ${input.sizeBytes}, ${actorId},
       'approved'::public.document_state, ${input.driveFileId}, ${input.driveWebLink},
       ${actorId}, now())
    returning id
  `);
  return rows[0].id as string;
}

/**
 * Record that a document reached Drive.
 *
 * Deliberately takes the Drive ids as arguments rather than doing the upload:
 * this layer does not talk to Google. The action uploads first and calls this only
 * once the bytes are safely there — so a row can never claim to be in Drive
 * because an approval was attempted.
 */
/**
 * File a document that needs no approval, already accepted.
 *
 * Owner, 2026-08-24: *"anything uploaded by admin, anything uploaded by the team
 * coordinator, will not be sent to approval. It will be automatically
 * uploaded."*
 *
 * ── ⚠️ WHY THIS IS A SEPARATE INSERT AND NOT insert-then-approve ─────────────
 * Two statements would leave a window in which the row is `pending`, and that
 * window is visible: the approver queue is a live count, so a Coordinator's own
 * upload would flash into everybody's notifications and out again. Worse, if the
 * second statement failed the file would sit in the queue for its own author to
 * approve — which is the one thing `document.approve` exists to prevent.
 *
 * `decided_by_id` is the uploader, and that is honest rather than convenient:
 * they did decide, by having the authority to. The audit trail says
 * `document.uploaded` rather than `document.approved` so the two cases stay
 * distinguishable afterwards.
 *
 * ⚠️ Requires migration 048. Before it, `documents_state_is_coherent` demanded a
 * `drive_file_id` on any approved row and this insert would be refused outright.
 */
export async function createDocumentApproved(
  actorId: string,
  input: {
    name: string;
    description: string | null;
    projectId: string | null;
    folderId: string | null;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
  },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.documents
      (name, description, project_id, folder_id, storage_path, mime_type,
       size_bytes, uploaded_by_id, state, decided_by_id, decided_at)
    values
      (${input.name}, ${input.description}, ${input.projectId}, ${input.folderId},
       ${input.storagePath}, ${input.mimeType}, ${input.sizeBytes}, ${actorId},
       'approved'::public.document_state, ${actorId}, now())
    returning id
  `);
  return rows[0].id as string;
}

/**
 * Accept a pending document, leaving the file where it is.
 *
 * Owner, 2026-08-24: *"I will accept it and then it will be added to the
 * bucket."* It is already in the bucket — so acceptance is a state change and
 * nothing else. No bytes move, nothing is deleted, and no Google OAuth client
 * needs to exist.
 *
 * ⚠️ REPLACES THE DRIVE-COPYING VERSION. That one pulled the object back out of
 * Supabase, pushed it to Drive, cleared `storage_path` and deleted the object —
 * because `documents_state_is_coherent` required exactly that shape. Migration
 * 048 relaxed the constraint; `markApprovedIntoDrive` below keeps the old path
 * available for the case where somebody genuinely wants a copy in Drive.
 */
export async function markApproved(actorId: string, id: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.documents
       set state = 'approved'::public.document_state,
           decided_by_id = ${actorId},
           decided_at = now()
     where id = ${id} and state = 'pending'::public.document_state
  `);
}

export async function markApprovedIntoDrive(
  actorId: string,
  id: string,
  drive: { fileId: string; webLink: string | null },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.documents
       set state = 'approved'::public.document_state,
           drive_file_id = ${drive.fileId},
           drive_web_link = ${drive.webLink},
           /* Cleared because the file is no longer there — the constraint
              documents_state_is_coherent enforces that it must be.
              (No backticks in here: this is inside a tagged template, and one
              would end the string.) */
           storage_path = null,
           decided_by_id = ${actorId},
           decided_at = now()
     where id = ${id} and state = 'pending'::public.document_state
  `);
}

/**
 * Refuse a document.
 *
 * `storage_path` is cleared along with the decision, because the action deletes
 * the object — a row that still named the path would be pointing at a file that no
 * longer exists, which is exactly the kind of quiet inconsistency somebody later
 * reads as a storage fault. Caught by looking at the row after a rejection rather
 * than by assuming the update was complete.
 *
 * The ROW stays, with the reason. That is the part anybody needs; the bytes are
 * not coming back and keeping them serves nobody.
 */
export async function markRejected(
  actorId: string,
  id: string,
  reason: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.documents
       set state = 'rejected'::public.document_state,
           storage_path = null,
           decided_by_id = ${actorId},
           decided_at = now(),
           decision_reason = ${reason}
     where id = ${id} and state = 'pending'::public.document_state
  `);
}

/**
 * Change only the name.
 *
 * ── ⚠️ WHY THIS IS NOT `updateDocument` WITH TWO FIELDS OMITTED ──────────────
 * `updateDocument` SETS `description` and `project_id` from whatever it is handed,
 * so calling it to rename a file — with nothing to say about the other two —
 * writes `null` into both. On the project Files tab that would silently unfile the
 * document from the project whose page you renamed it on, and it would disappear
 * from the tab as a result of a rename. Found by reading what the `set` clause
 * does rather than what the function is called.
 *
 * Returns whether a row was actually renamed, so the action can tell "no longer
 * there" from "done" instead of reporting success either way. A row invisible under
 * RLS updates nothing and returns nothing, which is the correct answer to give.
 */
export async function renameDocument(
  actorId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.documents
       set name = ${name}
     where id = ${id}
    returning id
  `);
  return rows.length > 0;
}

export async function updateDocument(
  actorId: string,
  id: string,
  input: { name: string; description: string | null; projectId: string | null },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.documents
       set name = ${input.name},
           description = ${input.description},
           project_id = ${input.projectId}
     where id = ${id}
  `);
}

export async function deleteDocument(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.documents where id = ${id} returning id
  `);
  return rows.length > 0;
}

/* ==========================================================================
 * THE POLL'S CURSOR
 * ========================================================================== */

export interface DriveSyncRow {
  readonly watchedFolderId: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
  readonly lastCreated: number;
}

export async function getDriveSync(actorId: string): Promise<DriveSyncRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select watched_folder_id, last_checked_at, last_error, last_created
      from public.drive_sync where id = 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    watchedFolderId: (row.watched_folder_id as string | null) ?? null,
    lastCheckedAt: isoOrNull(row.last_checked_at),
    lastError: (row.last_error as string | null) ?? null,
    lastCreated: Number(row.last_created ?? 0),
  };
}

export async function setWatchedFolder(
  actorId: string,
  folderId: string | null,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.drive_sync
       set watched_folder_id = ${folderId},
           /* Cleared with the folder: an error about the previous folder said
              nothing about this one, and a stale error reads as a live fault. */
           last_error = null
     where id = 1
  `);
}

export async function recordSyncRun(
  actorId: string,
  input: { created: number; error: string | null },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.drive_sync
       set last_checked_at = now(),
           last_created = ${input.created},
           last_error = ${input.error}
     where id = 1
  `);
}

/**
 * Create a draft project from a Drive folder.
 *
 * ── WHY THIS IS NOT `createProject` ──────────────────────────────────────────
 * A folder name cannot supply a type, an owner or any dates, and `createProject`
 * rightly requires them. A draft is the honest shape for what a folder actually
 * tells us: a name, and where it came from.
 *
 * The unique index on `drive_folder_id` is what makes a repeated poll safe, and
 * `on conflict do nothing` is what turns that from an error into the correct
 * outcome — a second poll finds the project already exists and moves on.
 *
 * Returns null when the project was already there.
 */
export async function createDraftProjectFromFolder(
  actorId: string,
  folder: { id: string; name: string },
): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.projects
      (name, type, code, status, owner_id, is_draft, drive_folder_id, created_by_id)
    values (
      ${folder.name},
      /* 'other' is the catch-all, and is_draft is what says the type has not been
         chosen — so nothing has to guess between "genuinely other" and "not yet
         decided". */
      'other'::public.project_type,
      /* A code is required and must be unique. Derived from the folder id, which
         already is: the owner replaces it when they confirm the project. */
      ${'DR-' + folder.id.slice(-8).toUpperCase()},
      'active'::public.project_status,
      ${actorId},
      true,
      ${folder.id},
      ${actorId}
    )
    on conflict (drive_folder_id) where drive_folder_id is not null do nothing
    returning id
  `);
  return (rows[0]?.id as string | undefined) ?? null;
}

/**
 * The Super Admin's id, for work that has no signed-in actor.
 *
 * ── WHY THE CRON NEEDS THIS AT ALL ───────────────────────────────────────────
 * A draft project needs a `created_by_id` and an `owner_id`, and a scheduled run
 * has nobody. The alternatives were worse:
 *
 *   • run under `withAppRole` and bypass RLS — which would make the poll the one
 *     code path in the application that can write outside the policy
 *   • add a nullable "system" actor — which every foreign key and every audit
 *     reader would then have to handle
 *
 * So it runs as a real identity, and the Super Admin is the only one guaranteed to
 * exist: `users_single_super_admin_idx` makes exactly one of them a property of the
 * database for its lifetime (BR-028). RLS therefore still applies to every write
 * the poll makes — it is simply acting as the person who owns the system.
 *
 * Deliberately **not** the person who configured the watch: they may since have
 * left, and a draft project owned by a deactivated account is a project nobody
 * sees.
 *
 * Runs outside an identity because it is looking up WHO the identity is — the same
 * bootstrap, and the same justification, as the digest route's recipient query.
 */
export async function superAdminId(): Promise<string | null> {
  const rows = await sql`
    select id from public.users
     where role = 'super_admin' and is_active
     limit 1
  `;
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function listDraftProjects(
  actorId: string,
): Promise<Array<{ id: string; name: string; driveFolderId: string | null }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, drive_folder_id from public.projects
     where is_draft order by created_at desc
  `);
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    driveFolderId: (row.drive_folder_id as string | null) ?? null,
  }));
}
