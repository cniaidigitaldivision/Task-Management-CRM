import 'server-only';

import * as F from '@/lib/db/queries/drive-folders';
import * as D from '@/lib/db/queries/documents';

import { getFolder, listSubfolders } from './client';

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
export async function scanDriveFolders(actorId: string): Promise<FolderScanOutcome> {
  const sync = await D.getDriveSync(actorId);

  /* ── NO WATCHED FOLDER MEANS "SHOW ME EVERYTHING", NOT "DO NOTHING" ────────
     This used to refuse outright, which was the wrong instinct and produced the
     worst possible first experience: Drive says connected, the folder list says
     "No folders recorded yet", and the only way forward is to paste an opaque id
     you have to go and dig out of a Drive URL. Owner, 2026-08-18: *"the list of
     folders which is present in Google Drive is not visible… if I type some
     folder name, it's not visible."*

     `'root'` is Drive's own alias for My Drive. So with nothing configured, this
     reads the account's actual folders and the registry fills up — and the
     watched folder becomes a CHOICE FROM THAT LIST rather than a prerequisite
     for seeing it. */
  const rootId = sync?.watchedFolderId ?? 'root';

  const root = await getFolder(rootId);
  if (!root.ok) return nothing(root.reason);

  const found: Array<{ driveFolderId: string; name: string; parentDriveId: string | null }> = [
    { driveFolderId: root.value.id, name: root.value.name, parentDriveId: null },
  ];

  const seen = new Set<string>([root.value.id]);
  let truncated = false;

  /* Breadth-first, so a limit truncates the DEEPEST level rather than an
     arbitrary branch. Losing "the bottom of the tree" is explainable; losing
     "everything under the third project" is not. */
  let frontier: string[] = [root.value.id];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const parent of frontier) {
      if (found.length >= MAX_FOLDERS) {
        truncated = true;
        break;
      }

      const children = await listSubfolders(parent);
      if (!children.ok) {
        /* One unreadable branch — a folder whose sharing changed mid-walk — must
           not discard the folders already found. The walk continues and the run
           is still ok; the alternative is an all-or-nothing sync that a single
           permissions change can defeat. */
        continue;
      }

      for (const child of children.value) {
        if (seen.has(child.id)) continue;
        if (found.length >= MAX_FOLDERS) {
          truncated = true;
          break;
        }
        seen.add(child.id);
        found.push({ driveFolderId: child.id, name: child.name, parentDriveId: parent });
        next.push(child.id);
      }
    }

    if (found.length >= MAX_FOLDERS) {
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
    const created = await F.recordFolders(actorId, found);
    return { ok: true, created, examined: found.length, truncated, error: null };
  } catch {
    return nothing('The folders were read from Drive but could not be recorded.');
  }
}
