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

  /* ── For the folder table. All four are derived from `public.documents` ────
     and therefore sit behind the same RLS as `documentCount` — see the note on
     `listFolders`. They describe what the READER can see in the folder, which is
     the only honest thing they could describe and matches what opening it shows. */

  /**
   * Bytes of the files directly in this Drive folder, as of `filesCountedAt`.
   *
   * ⚠️ FROM DRIVE, not from `public.documents`. The first version of this summed
   * the CRM's own uploads and was therefore 0 on all 33 folders — the division
   * files in Drive, not through this system. Owner: *"Even the real drive size,
   * folder size, anything should be real."*
   *
   * Null means never counted, which is NOT the same as 0. See migration 056.
   */
  readonly driveSizeBytes: number | null;
  /**
   * How many of `driveFileCount` reported a size.
   *
   * ⚠️ Google-native files (Docs, Sheets, Slides) have no byte size, so a folder
   * of twelve Google Docs is honestly "12 files, 0 B". This is what lets the
   * screen say that rather than look broken.
   */
  readonly driveSizedFileCount: number | null;
  /** The newest modifiedTime among the files directly inside. */
  readonly driveModifiedAt: string | null;
  /** Documents in here that came through this system. Usually 0 — see above. */
  readonly lastActivityAt: string | null;
  readonly lastActivityBy: string | null;
  /**
   * The Google accounts that own the files in here, most recently active first.
   *
   * ⚠️ FILE OWNERS FROM DRIVE — not this system's users, and not the folder's own
   * owner. The folder has exactly one owner and a column of identical single
   * avatars says nothing; who has actually put work in here is the useful answer.
   *
   * ⚠️ These are GOOGLE identities. Most will never match a `public.users` row,
   * which is why they are cached jsonb rather than a join — see migration 056.
   * `photo` is Google's own avatar URL and is loaded by the browser directly.
   *
   * Capped at five by the sync; the table draws three and counts the rest.
   */
  readonly owners: readonly {
    readonly name: string;
    readonly email: string | null;
    readonly photo: string | null;
  }[];
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
    /* ⚠️ Null-preserving. `Number(null)` is 0, and "never counted" must not
       render as "empty" — migration 056 says so explicitly. */
    driveSizeBytes:
      row.drive_size_bytes === null || row.drive_size_bytes === undefined
        ? null
        : Number(row.drive_size_bytes),
    driveSizedFileCount:
      row.drive_sized_file_count === null || row.drive_sized_file_count === undefined
        ? null
        : Number(row.drive_sized_file_count),
    driveModifiedAt: isoOrNull(row.drive_modified_at),
    lastActivityAt: isoOrNull(row.last_activity_at),
    lastActivityBy: (row.last_activity_by as string | null) ?? null,
    /* The column is nullable and jsonb, so both "no column value" and "not an
       array" have to land on an empty list rather than throw in a page render. */
    owners: Array.isArray(row.drive_owners)
      ? (row.drive_owners as Array<Record<string, unknown>>)
          .map((o) => ({
            name: (o.name as string | null) ?? 'Someone',
            email: (o.email as string | null) ?? null,
            photo: (o.photo as string | null) ?? null,
          }))
          .filter((o) => o.name.length > 0)
      : [],
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
             as document_count,
           /* Straight from the sync — see migration 056. No aggregation here,
              because Drive already answered and the answer is cached. */
           f.drive_size_bytes, f.drive_sized_file_count, f.drive_modified_at,
           f.drive_owners,
           recent.last_activity_at,
           recent.last_activity_by
      from public.drive_folders f
      left join public.projects p on p.id = f.project_id
      left join public.users    u on u.id = f.shared_by_id
      /* ⚠️ LATERAL, so each subquery sees this folder's id. Both are ordered and
         limited, which a correlated scalar subquery cannot express. */
      left join lateral (
        select d.created_at as last_activity_at, du.full_name as last_activity_by
          from public.documents d
          left join public.users du on du.id = d.uploaded_by_id
         where d.folder_id = f.id
         order by d.created_at desc
         limit 1
      ) recent on true
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
           /* ⚠️ Zeroed deliberately. This is the single-folder read used when
              deciding access, where the counts are not shown and computing them
              would be three subqueries nobody looks at. 'toRow' still needs the
              keys to exist, so they are named rather than omitted. */
           0 as document_count,
           f.drive_size_bytes, f.drive_sized_file_count, f.drive_modified_at,
           f.drive_owners,
           null::timestamptz as last_activity_at,
           null::text as last_activity_by
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
    /** All four null when the walk did not look inside. Written together with the
     *  count, from the one request that produced all of them. */
    sizeBytes: number | null;
    sizedFileCount: number | null;
    lastModified: string | null;
    owners: readonly { name: string; email: string | null; photo: string | null }[] | null;
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
           drive_file_count, files_counted_at, file_count_partial,
           drive_size_bytes, drive_sized_file_count, drive_modified_at, drive_owners)
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
          ${folder.filePartial},
          ${folder.sizeBytes},
          ${folder.sizedFileCount},
          ${folder.lastModified},
          /* ── ⚠️ THE ARRAY ITSELF, NOT A STRINGIFIED COPY OF IT ────────────────
             This called JSON.stringify first, on the assumption that postgres.js
             sends a JS array as a Postgres array literal. It does not, for a jsonb
             target — it JSON-encodes the value already. So a pre-stringified array
             arrived as a JSON *string* and jsonb_typeof came back 'string' rather
             than 'array'.

             Migration 056's drive_folders_owners_is_array check refused it on the
             very first write, which is precisely why that constraint exists:
             without it the column would have filled quietly with double-encoded
             strings and the page would have thrown on .map weeks later, far from
             the cause.

             Confirmed against the database: a plain array yields 'array' and the
             stringified form yields 'string'.

             ⚠️ Sent through tx.json() rather than as a bare array. Both produce
             'array' at runtime — measured — but postgres.js's own types do not
             accept an array of objects as a parameter, so the bare form compiled
             only behind an assertion. Silencing a driver that is telling you which
             helper to use is how the double-encoding got in to begin with.

             ⚠️ No backticks anywhere in this comment: it sits inside a JS template
             literal, so one would close the SQL string. That has now bitten this
             file twice. */
          ${folder.owners === null ? null : tx.json([...folder.owners])}::jsonb
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
               end,
               /* ⚠️ Same rule as the count above: a fresh reading replaces the old
                  one, a null does NOT. The walk is depth-bounded, so the deepest
                  folders are recorded without being looked inside — overwriting
                  last week's real size with "unknown" would make the display worse
                  on every sync. All four move together because they came from one
                  request; keeping some and discarding others would leave a row
                  describing two different moments. */
               drive_size_bytes = coalesce(excluded.drive_size_bytes,
                                           public.drive_folders.drive_size_bytes),
               drive_sized_file_count = coalesce(excluded.drive_sized_file_count,
                                                 public.drive_folders.drive_sized_file_count),
               drive_modified_at = coalesce(excluded.drive_modified_at,
                                            public.drive_folders.drive_modified_at),
               drive_owners = coalesce(excluded.drive_owners,
                                       public.drive_folders.drive_owners)
        returning (xmax = 0) as inserted
      `;
      if (rows[0]?.inserted) created += 1;
    }
    return created;
  });
}

/* ==========================================================================
 * NAMED-PERSON GRANTS — migration 031
 * --------------------------------------------------------------------------
 * Owner, 2026-08-18: *"when I want that specifically I can select any team
 * member. For example Yusra, I want this access, for example Rafi, I want some
 * other access."*
 *
 * Grants only ADD. Effective access is the greater of the folder's everyone
 * level and any grant naming the person — `app.folder_grants` decides that, and
 * these functions only maintain the rows.
 * ========================================================================== */

export interface FolderGrantRow {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: string;
  readonly access: FolderAccess;
  readonly grantedByName: string | null;
  readonly grantedAt: string | null;
}

/** Who is named on one folder. Coordinator+ sees all; a Member sees only their
 *  own row, by the `drive_folder_grants_select` policy. */
export async function listGrants(
  userId: string,
  folderId: string,
): Promise<FolderGrantRow[]> {
  const rows = await withUser(userId, (tx) => tx`
    select g.user_id, g.access, g.granted_at,
           u.full_name, u.email, u.role,
           b.full_name as granted_by_name
      from public.drive_folder_grants g
      join public.users u on u.id = g.user_id
      left join public.users b on b.id = g.granted_by_id
     where g.folder_id = ${folderId}
     order by lower(u.full_name)
  `);
  return rows.map((r) => ({
    userId: r.user_id as string,
    fullName: (r.full_name as string | null) ?? 'Unknown',
    email: (r.email as string | null) ?? '',
    role: r.role as string,
    access: r.access as FolderAccess,
    grantedByName: (r.granted_by_name as string | null) ?? null,
    grantedAt: isoOrNull(r.granted_at),
  }));
}

/**
 * Name a person, or change what they were named for.
 *
 * Upserted rather than insert-or-fail: the unique index on (folder, user) exists
 * so "what can Yusra do here" has one answer, and raising her level is the same
 * intent as granting it in the first place.
 */
export async function grantAccess(
  userId: string,
  input: { folderId: string; personId: string; access: FolderAccess },
): Promise<void> {
  await withUser(userId, (tx) => tx`
    insert into public.drive_folder_grants
      (folder_id, user_id, access, granted_by_id, granted_at)
    values (${input.folderId}, ${input.personId},
            ${input.access}::public.folder_access, ${userId}, now())
    on conflict (folder_id, user_id) do update
       set access = excluded.access,
           /* Re-attributed: whoever last changed it is who is answerable for the
              level that is now in force. */
           granted_by_id = excluded.granted_by_id,
           granted_at    = excluded.granted_at
  `);
}

/** Remove a person's grant. They fall back to the folder's everyone level. */
export async function revokeAccess(
  userId: string,
  folderId: string,
  personId: string,
): Promise<boolean> {
  const rows = await withUser(userId, (tx) => tx`
    delete from public.drive_folder_grants
     where folder_id = ${folderId} and user_id = ${personId}
     returning user_id
  `);
  return rows.length > 0;
}

/**
 * Whether the caller may read inside this folder.
 *
 * ⚠️ Asks `app.folder_grants` — the SAME predicate the `documents` policies and
 * the file-streaming route use. Reimplementing the rule in TypeScript is how a
 * file list and a file download come to disagree about who may see what.
 */
export async function mayReadFolder(userId: string, folderId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) => tx`
    select app.folder_grants(${folderId}::uuid, 'view'::public.folder_access) as allowed
  `);
  return Boolean(rows[0]?.allowed);
}

/** Whether the caller may delete inside this folder. Same predicate as the
 *  `documents_delete` policy, so the file list and the register agree. */
export async function mayManageFolder(userId: string, folderId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) => tx`
    select app.folder_grants(${folderId}::uuid, 'manage'::public.folder_access) as allowed
  `);
  return Boolean(rows[0]?.allowed);
}

/** How many people are named on each folder, so the list can say so without a
 *  query per row. */
export async function grantCounts(userId: string): Promise<Map<string, number>> {
  const rows = await withUser(userId, (tx) => tx`
    select folder_id, count(*)::int as n
      from public.drive_folder_grants
     group by folder_id
  `);
  return new Map(rows.map((r) => [r.folder_id as string, Number(r.n)]));
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
