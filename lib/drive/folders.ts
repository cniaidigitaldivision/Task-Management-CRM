import 'server-only';

import * as F from '@/lib/db/queries/drive-folders';
import * as D from '@/lib/db/queries/documents';

import { getFolder, listChildren } from './client';

/* ============================================================================
 * WALKING THE DRIVE TREE INTO THE REGISTRY — owner request 2026-08-16
 * ----------------------------------------------------------------------------
 * `lib/drive/sync.ts` reads ONE level below the watched folder and turns new
 * subfolders into draft projects. This walks the whole tree and records every
 * folder it finds, so there is something to attach a document to and something to
 * put a "visible to members" switch on.
 *
 * The two are deliberately separate. Project creation is a business event with a
 * draft, an owner and a type; recording a folder is bookkeeping. Merging them
 * would mean every folder five levels down became a draft project.
 *
 * ── THE WALK IS BOUNDED, ON PURPOSE ──────────────────────────────────────────
 * A real Drive is a tree somebody else edits. Three limits, all of which report
 * rather than throw:
 *
 *   depth   6   — deep enough for project/year/client/stage nesting
 *   folders 500 — the registry is a picker; nobody chooses from more than that
 *   seen    a Set — Drive shortcuts can make a folder appear under two parents,
 *                   and without this the walk would revisit it forever
 *
 * Hitting a limit is reported in `truncated` and is NOT an error: recording 500
 * of 900 folders is useful, and failing the whole sync because a Drive is large
 * would be worse than being honest about where it stopped.
 * ========================================================================= */

const MAX_DEPTH = 6;
const MAX_FOLDERS = 500;

export interface FolderScanOutcome {
  readonly ok: boolean;
  /** Folders recorded for the first time on THIS run. */
  readonly created: number;
  /** Every folder seen, including ones already known. */
  readonly examined: number;
  /** True when a limit stopped the walk before the tree ran out. */
  readonly truncated: boolean;
  readonly error: string | null;
}

const nothing = (error: string | null): FolderScanOutcome => ({
  ok: error === null,
  created: 0,
  examined: 0,
  truncated: false,
  error,
});

/**
 * Read the folder tree under the watched root and record it.
 *
 * Runs as `actorId` — every write goes through row-level security, so this is
 * Coordinator+ by the policy on `drive_folders` and not by a check here.
 *
 * The watched ROOT is recorded too, not only its children. Otherwise the most
 * obvious place to file a document — the top folder — would be the one place the
 * picker could not offer.
 */
/**
 * One folder as the walk knows it.
 *
 * ⚠️ Named rather than inlined into the Map, because three things have to agree on
 * it now: this Map, the `UNCOUNTED` partial that seeds it, and `recordFolders`'s
 * parameter. When it was an inline literal, adding a field meant finding four
 * places by compiler error — which is how the first attempt at this shipped a
 * folder whose size and count came from different syncs.
 *
 * All of `sizeBytes`, `sizedFileCount`, `lastModified` and `owners` are null
 * together or set together: they come from ONE Drive response and describe one
 * moment. See migration 056.
 */
interface FolderFacts {
  driveFolderId: string;
  name: string;
  parentDriveId: string | null;
  fileCount: number | null;
  filePartial: boolean;
  sizeBytes: number | null;
  sizedFileCount: number | null;
  lastModified: string | null;
  owners: readonly { name: string; email: string | null; photo: string | null }[] | null;
}

export async function scanDriveFolders(actorId: string): Promise<FolderScanOutcome> {
  const sync = await D.getDriveSync(actorId);

  /* ── ⚠️ THE REGISTRY IS NOT SCOPED TO THE WATCHED FOLDER ───────────────────
     It was, and that was a conflation of two unrelated jobs:

       the watched folder   where NEW subfolders become draft projects. One
                            folder, chosen deliberately, used by "Check now".
       the registry         which folders exist in this Drive at all, so a
                            document can be filed and a level granted.

     Scoping the registry to the watched folder meant that the moment one was
     set, every folder outside its subtree stopped being visited — so the 32
     folders recorded by an earlier scan of My Drive kept "not counted yet"
     forever, however many times the button was pressed. Owner, 2026-08-18:
     *"Why is it saying that it is not counted yet?"*

     So the walk starts at My Drive AND at the watched folder. Both, because
     neither alone is enough: `'root'` misses a folder shared into the account
     from outside, and the watched folder misses everything beside it. */
  const roots: string[] = ['root'];
  if (sync?.watchedFolderId) roots.push(sync.watchedFolderId);

  const root = await getFolder(roots[0]);
  if (!root.ok) return nothing(root.reason);

  /**
   * A folder that is known to exist but has not been looked inside.
   *
   * ⚠️ NULL, NOT ZERO. `recordFolders` keeps an existing value when the new one is
   * null and replaces it when it is not — so null means "I did not look, keep what
   * you had", while 0 would mean "I looked and it is empty" and would wipe a real
   * reading. The walk is depth-bounded, so the deepest level is always recorded
   * this way and must not clear last sync's numbers.
   */
  const UNCOUNTED = {
    sizeBytes: null,
    sizedFileCount: null,
    lastModified: null,
    owners: null,
  } satisfies Pick<FolderFacts, 'sizeBytes' | 'sizedFileCount' | 'lastModified' | 'owners'>;

  /* Keyed by Drive id so a folder discovered as a CHILD (name and parent known,
     contents not yet) can be upgraded in place when the walk reaches it and
     counts its files. An array would mean scanning it to find the entry. */
  const found = new Map<string, FolderFacts>([
    [
      root.value.id,
      {
        driveFolderId: root.value.id,
        name: root.value.name,
        parentDriveId: null,
        fileCount: null,
        filePartial: false,
        ...UNCOUNTED,
      },
    ],
  ]);

  const seen = new Set<string>([root.value.id]);
  let truncated = false;

  /* Breadth-first, so a limit truncates the DEEPEST level rather than an
     arbitrary branch. Losing "the bottom of the tree" is explainable; losing
     "everything under the third project" is not. */
  let frontier: string[] = [root.value.id];

  /* The watched folder joins the frontier if it is not already My Drive or a
     child of it that this walk would reach anyway. Adding it unconditionally is
     harmless — `seen` stops it being walked twice. */
  for (const extra of roots.slice(1)) {
    const folder = await getFolder(extra);
    if (!folder.ok) continue; // Unreachable watched folder is not fatal to a scan.
    if (seen.has(folder.value.id)) continue;
    seen.add(folder.value.id);
    found.set(folder.value.id, {
      driveFolderId: folder.value.id,
      name: folder.value.name,
      parentDriveId: null,
      fileCount: null,
      filePartial: false,
      ...UNCOUNTED,
    });
    frontier.push(folder.value.id);
  }

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const parent of frontier) {
      if (found.size >= MAX_FOLDERS) {
        truncated = true;
        break;
      }

      /* `listChildren`, not `listSubfolders` — same one request, but it returns
         the file count as well. Owner, 2026-08-18: every folder showed "0
         documents" because nothing had ever counted what is in Drive. */
      const children = await listChildren(parent);
      if (!children.ok) {
        /* One unreadable branch — a folder whose sharing changed mid-walk — must
           not discard the folders already found. The walk continues and the run
           is still ok; the alternative is an all-or-nothing sync that a single
           permissions change can defeat. */
        continue;
      }

      /* This folder has now been looked inside, so everything about it is known.
         ⚠️ ALL SIX MOVE TOGETHER, from the one response. They are cached as a
         snapshot of a single moment (migration 056); setting some while leaving
         others from a previous sync would leave a row describing two different
         times — a size from last week beside a count from today. */
      const entry = found.get(parent);
      if (entry) {
        entry.fileCount = children.value.fileCount;
        entry.filePartial = children.value.truncated;
        entry.sizeBytes = children.value.sizeBytes;
        entry.sizedFileCount = children.value.sizedFileCount;
        entry.lastModified = children.value.lastModified;
        entry.owners = children.value.owners;
      }

      for (const child of children.value.folders) {
        if (seen.has(child.id)) continue;
        if (found.size >= MAX_FOLDERS) {
          truncated = true;
          break;
        }
        seen.add(child.id);
        /* Recorded with a null count: known to exist, not yet looked inside. If
           the walk reaches it, the block above fills the count in. */
        found.set(child.id, {
          driveFolderId: child.id,
          name: child.name,
          parentDriveId: parent,
          fileCount: null,
          filePartial: false,
          ...UNCOUNTED,
        });
        next.push(child.id);
      }
    }

    if (found.size >= MAX_FOLDERS) {
      truncated = true;
      break;
    }
    frontier = next;
  }

  /* One more level would have existed but was not read. Reported, because a
     picker that quietly omits folders is one somebody will file into the wrong
     place because of. */
  if (frontier.length > 0 && !truncated) truncated = true;

  try {
    const created = await F.recordFolders(actorId, [...found.values()]);
    return { ok: true, created, examined: found.size, truncated, error: null };
  } catch {
    return nothing('The folders were read from Drive but could not be recorded.');
  }
}
