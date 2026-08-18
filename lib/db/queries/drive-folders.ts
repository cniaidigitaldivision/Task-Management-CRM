import 'server-only';

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
 * A row here is a folder the CRM has seen in Drive, plus one switch:
 * `visible_to_members`. That switch is what turns "Coordinator+ sees everything"
 * into "and Members see this bit too".
 *
 * ── EVERY QUERY RUNS AS THE CALLER ───────────────────────────────────────────
 * `withUser` and no `where` clause about roles. The select policy lets anybody
 * signed in read the registry — a Member needs to see the folder to understand
 * why a document is visible to them — and the write policy is Coordinator+. If
 * a Member calls `setVisibility`, Postgres refuses it. The check in the action
 * exists to produce a sentence rather than a stack trace, not to be the defence.
 * ========================================================================= */

export interface DriveFolderRow {
  readonly id: string;
  readonly driveFolderId: string;
  readonly name: string;
  readonly parentDriveId: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly visibleToMembers: boolean;
  readonly sharedByName: string | null;
  readonly sharedAt: string | null;
  /** How many documents are filed here. Shown so "share this" has a size. */
  readonly documentCount: number;
}

function toRow(row: Record<string, unknown>): DriveFolderRow {
  return {
    id: row.id as string,
    driveFolderId: row.drive_folder_id as string,
    name: row.name as string,
    parentDriveId: (row.parent_drive_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    visibleToMembers: Boolean(row.visible_to_members),
    sharedByName: (row.shared_by_name as string | null) ?? null,
    sharedAt: isoOrNull(row.shared_at),
    documentCount: Number(row.document_count ?? 0),
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
           f.visible_to_members, f.shared_at,
           p.name as project_name,
           u.full_name as shared_by_name,
           (select count(*) from public.documents d where d.folder_id = f.id)
             as document_count
      from public.drive_folders f
      left join public.projects p on p.id = f.project_id
      left join public.users    u on u.id = f.shared_by_id
     order by f.visible_to_members desc, lower(f.name)
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
           f.visible_to_members, f.shared_at,
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
 * ── ⚠️ `visible_to_members` IS NEVER TOUCHED HERE ────────────────────────────
 * `do update` sets the name, the parent and the project and nothing else. A
 * re-sync must not un-share a folder somebody deliberately shared, and — far
 * worse in the other direction — must not carry a share forward onto a folder
 * that has been renamed into a different job. Sharing is only ever changed by a
 * person, in `setVisibility`.
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
  }>,
): Promise<number> {
  if (folders.length === 0) return 0;

  return withUser(userId, async (tx) => {
    let created = 0;
    for (const folder of folders) {
      const rows = await tx`
        insert into public.drive_folders (drive_folder_id, name, parent_drive_id, project_id)
        values (
          ${folder.driveFolderId},
          ${folder.name},
          ${folder.parentDriveId},
          /* Bound to the project that was created from this same Drive folder,
             if there is one. Looked up rather than passed in, so the link is
             made by the database that owns both sides of it. */
          (select id from public.projects
            where drive_folder_id = ${folder.driveFolderId} limit 1)
        )
        on conflict (drive_folder_id) do update
           set name           = excluded.name,
               parent_drive_id = excluded.parent_drive_id,
               project_id     = coalesce(public.drive_folders.project_id, excluded.project_id)
        returning (xmax = 0) as inserted
      `;
      if (rows[0]?.inserted) created += 1;
    }
    return created;
  });
}

/**
 * Turn a folder's member visibility on or off.
 *
 * The attribution columns are written in the same statement as the switch, because
 * migration 027 has a check constraint refusing a visible folder with no sharer:
 * half a record of who exposed a folder is worse than none.
 */
export async function setVisibility(
  userId: string,
  id: string,
  visible: boolean,
): Promise<DriveFolderRow | null> {
  const rows = await withUser(userId, (tx) => tx`
    update public.drive_folders
       set visible_to_members = ${visible},
           shared_by_id = ${visible ? userId : null},
           shared_at    = ${visible ? new Date().toISOString() : null}
     where id = ${id}
     returning id, drive_folder_id, name, parent_drive_id, project_id,
               visible_to_members, shared_at
  `);
  const row = rows[0];
  if (!row) return null;
  return toRow({ ...row, project_name: null, shared_by_name: null, document_count: 0 });
}
