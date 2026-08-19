'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { listPlatforms, type PlatformRow } from '@/lib/db/queries/catalogue';
import * as P from '@/lib/db/queries/placements';
import { record } from '@/lib/db/queries/feed';
import { CONTENT_KINDS, type ContentKind } from '@/lib/domain/constants';

import type { ActionResult } from './tasks';

/* ============================================================================
 * PUBLISHED DESTINATIONS — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Once the Reel is done you will see that the task management will show which
 * social media page the pages are for… paste a Facebook post link. For a Facebook
 * Reel paste the Facebook Reel link."*
 *
 * ── NO PERMISSION CHECK BEYOND SEEING THE TASK, AND THAT IS THE DESIGN ───────
 * The RLS policy is `app.task_is_visible(task_id)` for both reads and writes, so
 * whoever can open the task can record where it went. Adding a Coordinator-only
 * check here would mean the person who actually published the reel has to ask
 * somebody else to paste the link — which is how links stop being recorded, and
 * an unrecorded link is a report the CEO cannot click.
 * ========================================================================= */

const fail = (error: string): ActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

export async function listPlacementsAction(
  taskId: string,
): Promise<
  | { ok: true; placements: P.PlacementRow[]; platforms: PlatformRow[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const [placements, platforms] = await Promise.all([
    P.listPlacements(user.id, taskId),
    listPlatforms(user.id),
  ]);
  return { ok: true, placements, platforms };
}

export async function savePlacementAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const taskId = str(form, 'taskId');
  const platformId = str(form, 'platformId');
  const kind = str(form, 'contentKind');
  const url = str(form, 'url');

  if (!taskId || !platformId) return fail('Choose a platform.');
  if (!(CONTENT_KINDS as readonly string[]).includes(kind)) {
    return fail('Choose what it was published as.');
  }

  /* ⚠️ Checked here as well as by the database constraint, because the message
     matters. Postgres would refuse `done` with a check-violation the UI would
     have to translate; saying it plainly costs one line. A dead link in a board
     report is worse than a blank — the report looks complete and is not. */
  if (url && !/^https?:\/\/\S+$/.test(url)) {
    return fail('That does not look like a link. It should start with https://');
  }

  try {
    await P.upsertPlacement(user.id, {
      taskId,
      platformId,
      contentKind: kind as ContentKind,
      url: url || null,
      publishedOn: str(form, 'publishedOn') || null,
      notes: str(form, 'notes') || null,
    });
  } catch {
    /* The realistic failure is RLS refusing a task the caller cannot see. */
    return fail('That could not be saved. You may not have access to this task.');
  }

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'task',
      entityId: taskId,
      action: 'task.placement_recorded',
      after: { platformId, contentKind: kind, hasUrl: Boolean(url) },
    }),
  ).catch(() => console.error('[placements] activity write failed'));

  revalidatePath('/tasks');
  return {
    ok: true,
    /* Said explicitly, because a placement with no URL is legitimate — planned,
       not yet live — and silence would leave somebody wondering if it saved. */
    warning: url ? undefined : 'Saved. Add the link once it goes live.',
  };
}

export async function removePlacementAction(id: string): Promise<ActionResult> {
  const user = await requireUser();

  const removed = await P.removePlacement(user.id, id);
  if (!removed) return fail('That destination was already gone.');

  revalidatePath('/tasks');
  return { ok: true };
}
