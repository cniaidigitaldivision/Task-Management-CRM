import 'server-only';

import type { FolderAccess } from '@/lib/domain/folder-access';

import { withUser } from '../client';
import { isoOrNull } from '../row-values';

/* ============================================================================
 * THE FOLDER REGISTRY — migration 027
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-16: *"super admin, admin and team coordinator can see the whole
 * documents and they can make the documents viewable for members to see for any
 * project they want, and members can upload documents to the folders they are
 * viewing."*
 *
 * A row here is a folder the CRM has seen in Drive, plus the level of access
 * Members have been given in it. Migration 027 made that a boolean and migration
 * 028 replaced it, because the owner's actual request was Drive's own model:
 *
 *   *"It will give access like: it can read only files, it can view, it can add
 *   it, it can upload, it can delete… the access level is defined at the time of
 *   giving, right?"*
 *
 * Right. `upload` and above also mean the file goes STRAIGHT TO DRIVE — granting
 * the level is the approval.
 *
 * ── EVERY QUERY RUNS AS THE CALLER ───────────────────────────────────────────
 * `withUser` and no `where` clause about roles. The select policy lets anybody
 * signed in read the registry — a Member needs to see the folder to understand
 * why a document is visible to them — and the write policy is Coordinator+. If
 * a Member calls `setAccess`, Postgres refuses it. The check in the action
 * exists to produce a sentence rather than a stack trace, not to be the defence.
 * ========================================================================= */

export interface DriveFolderRow {
  readonly id: string;
  readonly driveFolderId: string;
  readonly name: string;
  readonly parentDriveId: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly memberAccess: FolderAccess;
  readonly sharedByName: string | null;
  readonly sharedAt: string | null;
  /** Documents the CRM knows about here — uploaded through it and auditable.
   *  NOT the same as what is in Drive, which is the next three fields. */
  readonly documentCount: number;
  /** Files actually in the Drive folder as of `filesCountedAt`. Null when never
   *  counted, which must not render the same as counted-and-empty. */
  readonly driveFileCount: number | null;
  readonly filesCountedAt: string | null;
  /** `driveFileCount` is a floor — the folder has more children than one page. */
  readonly fileCountPartial: boolean;
}

function toRow(row: Record<string, unknown>): DriveFolderRow {
  return {
    id: row.id as string,
    driveFolderId: row.drive_folder_id as string,
    name: row.name as string,
    parentDriveId: (row.parent_drive_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    memberAccess: (row.member_access as FolderAccess) ?? 'none',
    sharedByName: (row.shared_by_name as string | null) ?? null,
    sharedAt: isoOrNull(row.shared_at),
    documentCount: Number(row.document_count ?? 0),
    driveFileCount:
      row.drive_file_count === null || row.drive_file_count === undefined
        ? null
        : Number(row.drive_file_count),
    filesCountedAt: isoOrNull(row.files_counted_at),
    fileCountPartial: Boolean(row.file_count_partial),
  };
}

/**
 * The whole registry, shared folders first, then alphabetically.
 *
 * ⚠️ The document count is a correlated subquery rather than a `left join …
 * group by`, because `public.documents` is itself behind RLS: the join would
 * count only the documents the CALLER may read, and a Coordinator deciding
 * whether to share a folder would see a different number from a Member. A
 * subquery has the same problem, so it is deliberately counted through the same
 * policy — the number means "documents you can see in here", which is the honest
 * reading and the one that matches what clicking the folder shows.
 */
export async function listFolders(userId: string): Promise<DriveFolderRow[]> {
  const rows = await withUser(userId, (tx) => tx`
    select f.id, f.drive_folder_id, f.name, f.parent_drive_id, f.project_id,
           f.member_access, f.shared_at,
           f.drive_file_count, f.files_counted_at, f.file_count_partial,
           p.name as project_name,
           u.full_name as shared_by_name,
           (select count(*) from public.documents d where d.folder_id = f.id)
             as document_count
      from public.drive_folders f
      left join public.projects p on p.id = f.project_id
      left join public.users    u on u.id = f.shared_by_id
     order by f.member_access desc, lower(f.name)
  `);
  return rows.map((r) => toRow(r as Record<string, unknown>));
}

/** One folder, by its CRM id. Null when it does not exist or is not readable. */
export async function getFolder(
  userId: string,
  id: string,
): Promise<DriveFolderRow | null> {
  const rows = await withUser(userId, (tx) => tx`
    select f.id, f.drive_folder_id, f.name, f.parent_drive_id, f.project_id,
           f.member_access, f.shared_at,
           f.drive_file_count, f.files_counted_at, f.file_count_partial,
           p.name as project_name,
           u.full_name as shared_by_name,
           0 as document_count
      from public.drive_folders f
      left join public.projects p on p.id = f.project_id
      left join public.users    u on u.id = f.shared_by_id
     where f.id = ${id}
  `);
  const row = rows[0];
  return row ? toRow(row as Record<string, unknown>) : null;
}

/**
 * Record folders seen in Drive.
 *
 * ── ⚠️ `member_access` IS NEVER TOUCHED HERE ────────────────────────────
 * `do update` sets the name, the parent and the project and nothing else. A
 * re-sync must not un-share a folder somebody deliberately shared, and — far
 * worse in the other direction — must not carry a share forward onto a folder
 * that has been renamed into a different job. Access is only ever changed by a
 * person, in `setAccess`.
 *
 * Returns how many rows were new, so the caller can say something true about
 * what a sync did.
 */
export async function recordFolders(
  userId: string,
  folders: ReadonlyArray<{
    driveFolderId: string;
    name: string;
    parentDriveId: string | null;
    /** Files seen directly in this folder. Null when the walk did not look —
     *  a folder found as a child but never descended into. */
    fileCount: number | null;
    filePartial: boolean;
  }>,
): Promise<number> {
  if (folders.length === 0) return 0;

  return withUser(userId, async (tx) => {
    let created = 0;
    for (const folder of folders) {
      /* Paired, because migration 030 refuses a count with no timestamp: a number
         nobody can judge the age of is worse than no number. */
      const countedAt = folder.fileCount === null ? null : new Date().toISOString();

      const rows = await tx`
        insert into public.drive_folders
          (drive_folder_id, name, parent_drive_id, project_id,
           drive_file_count, files_counted_at, file_count_partial)
        values (
          ${folder.driveFolderId},
          ${folder.name},
          ${folder.parentDriveId},
          /* Bound to the project that was created from this same Drive folder,
             if there is one. Looked up rather than passed in, so the link is
             made by the database that owns both sides of it. */
          (select id from public.projects
            where drive_folder_id = ${folder.driveFolderId} limit 1),
          ${folder.fileCount},
          ${countedAt},
          ${folder.filePartial}
        )
        on conflict (drive_folder_id) do update
           set name           = excluded.name,
               parent_drive_id = excluded.parent_drive_id,
               project_id     = coalesce(public.drive_folders.project_id, excluded.project_id),
               /* ⚠️ A fresh count replaces the old one; a null does NOT. The walk
                  is depth-bounded, so the deepest folders are recorded without
                  being looked inside — and overwriting last week's real count
                  with "unknown" would make the display worse on every sync. */
               drive_file_count   = coalesce(excluded.drive_file_count,
                                             public.drive_folders.drive_file_count),
               files_counted_at   = coalesce(excluded.files_counted_at,
                                             public.drive_folders.files_counted_at),
               file_count_partial = case
                 when excluded.drive_file_count is null
                   then public.drive_folders.file_count_partial
                 else excluded.file_count_partial
               end
        returning (xmax = 0) as inserted
      `;
      if (rows[0]?.inserted) created += 1;
    }
    return created;
  });
}

/**
 * Set what Members may do in a folder.
 *
 * The attribution columns are written in the same statement as the level, because
 * migration 028 has a check constraint refusing an opened folder with no sharer:
 * half a record of who opened one up is worse than none. Dropping back to `none`
 * clears both, so the row does not keep claiming a grant that no longer exists.
 */
export async function setAccess(
  userId: string,
  id: string,
  level: FolderAccess,
): Promise<DriveFolderRow | null> {
  const granting = level !== 'none';
  const rows = await withUser(userId, (tx) => tx`
    update public.drive_folders
       set member_access = ${level}::public.folder_access,
           shared_by_id  = ${granting ? userId : null},
           shared_at     = ${granting ? new Date().toISOString() : null}
     where id = ${id}
     returning id, drive_folder_id, name, parent_drive_id, project_id,
               member_access, shared_at
  `);
  const row = rows[0];
  if (!row) return null;
  return toRow({ ...row, project_name: null, shared_by_name: null, document_count: 0 });
}
