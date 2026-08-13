import 'server-only';

import * as D from '@/lib/db/queries/documents';

import { listSubfolders } from './client';

/* ============================================================================
 * THE FOLDER WATCH — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * Reads the watched Drive folder and turns any subfolder that has no project yet
 * into a draft one.
 *
 * ── WHY THIS IS A FUNCTION AND NOT ONLY A SERVER ACTION ──────────────────────
 * Two callers with nothing in common but the work:
 *
 *   the "Check now" button   a signed-in Admin, wanting an answer now
 *   the cron route           nobody signed in, every few minutes
 *
 * Written once here so the two cannot drift. The obvious alternative — having the
 * route call the server action — does not work: an action begins with
 * `requireUser()`, and a scheduled request has no session to satisfy it.
 *
 * ── IT IS SAFE TO RUN CONCURRENTLY ───────────────────────────────────────────
 * `projects.drive_folder_id` is unique and the insert is
 * `on conflict do nothing`, so a folder that already has a project is skipped
 * rather than duplicated. That is what makes the button and the cron safe to
 * overlap, which they will: somebody presses Check now while a scheduled run is in
 * flight and neither knows about the other.
 * ========================================================================= */

export interface SyncOutcome {
  readonly ok: boolean;
  /** How many folders became draft projects on THIS run. */
  readonly created: number;
  readonly names: readonly string[];
  /** How many subfolders were examined, so "nothing new" is distinguishable
   *  from "the folder is empty". */
  readonly examined: number;
  readonly error: string | null;
}

/**
 * Run the watch as `actorId`.
 *
 * The actor owns whatever it creates, so the caller decides whose identity that
 * is: the Admin who pressed the button, or — for the cron — the Super Admin. Every
 * write still goes through row-level security either way; there is no elevated
 * path in here.
 *
 * Records the run against `drive_sync` whatever happens, including the failure.
 * A watch that silently stops working looks identical to one with nothing to do,
 * and the screen has to be able to tell them apart.
 */
export async function runDriveSync(actorId: string): Promise<SyncOutcome> {
  const sync = await D.getDriveSync(actorId);

  if (!sync?.watchedFolderId) {
    /* Not an error and not recorded as one: no folder chosen is a configuration
       state, and writing "failed" against it would make the screen report a fault
       every few minutes for something nobody has switched on. */
    return {
      ok: false,
      created: 0,
      names: [],
      examined: 0,
      error: 'No folder is being watched.',
    };
  }

  const folders = await listSubfolders(sync.watchedFolderId);
  if (!folders.ok) {
    await D.recordSyncRun(actorId, { created: 0, error: folders.reason });
    return { ok: false, created: 0, names: [], examined: 0, error: folders.reason };
  }

  let created = 0;
  const names: string[] = [];

  for (const folder of folders.value) {
    /* Null means a project already exists for this folder — the unique index and
       `on conflict do nothing` doing their job, not a failure. */
    const id = await D.createDraftProjectFromFolder(actorId, folder);
    if (id) {
      created += 1;
      names.push(folder.name);
    }
  }

  await D.recordSyncRun(actorId, { created, error: null });

  return { ok: true, created, names, examined: folders.value.length, error: null };
}
