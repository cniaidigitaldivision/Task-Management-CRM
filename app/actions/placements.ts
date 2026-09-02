'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { listPlatforms, type PlatformRow } from '@/lib/db/queries/catalogue';
import * as P from '@/lib/db/queries/placements';
import * as T from '@/lib/db/queries/tasks';
import { record } from '@/lib/db/queries/feed';
import { CONTENT_KINDS, type ContentKind } from '@/lib/domain/constants';

import { changeStatusAction, type ActionResult } from './tasks';

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

  /* ── ⚠️ A BARE DOMAIN IS A LINK, AND WAS BEING REFUSED ────────────────────
     Owner, 2026-09-03, pasted `www.facebook.com` and `www.instagram.com`. Both
     would have been rejected with "it should start with https://" — technically
     correct and useless: nobody copying a post URL out of a browser thinks about
     the scheme, and the fix is one line here rather than a habit thirteen people
     have to learn.

     So a value with no scheme gains `https://`. Refusal is kept for things that
     are not links at all, because the reason the check exists still holds: a
     dead link in a client report is worse than a blank one, since the report
     looks complete and is not. */
  const normalised = normaliseUrl(url);
  if (url && normalised === null) {
    return fail(
      'That does not look like a link. Paste the address of the live post, for example https://www.facebook.com/…',
    );
  }

  try {
    await P.upsertPlacement(user.id, {
      taskId,
      platformId,
      contentKind: kind as ContentKind,
      url: normalised,
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

  /* ── ⚠️ PASTING THE FIRST LIVE LINK CLAIMS AND STARTS THE TASK ─────────────
     Owner, 2026-09-02, on how the content flow should run: *"someone starts
     their to-do process. Put the link of Facebook and Instagram and mark as
     published."*

     Two things had to become true for that to be possible at all, and both are
     done here rather than asked of the person:

     1. SOMEBODY HAS TO OWN IT. Every auto-created post carries no assignee, so
        without this the rule that an assignee may not approve their own
        submission never engages — the review step the owner asked for would be
        approvable by the person who did the work. Whoever pastes the live link
        is, by evidence, who did it.

     2. IT HAS TO LEAVE BACKLOG. All sixteen of today's posts sit in Backlog,
        and Backlog reaches only To Do or Cancelled — so "Mark as published"
        could never work from there, which is exactly the refusal the owner
        photographed. Pasting a live link IS starting the work, so the task
        stops being a plan at the moment there is a URL to show for it.

     ⚠️ ONLY WHEN THERE IS A URL. A placement with no link is a planned
     destination, not published work: claiming on that would hand somebody a
     task for opening a dropdown.

     ⚠️ AND NEITHER FAILURE IS FATAL TO THE SAVE. The link is the thing the
     person came to record and it is already committed. If the claim loses a
     race, or the start is refused, the placement still stands and the worst
     outcome is that the task keeps its old owner and status — recoverable by
     hand, unlike a lost link. */
  if (url) {
    try {
      await T.claimTask(user.id, taskId);

      const task = await T.getTask(user.id, taskId);
      if (task?.status === 'backlog') {
        /* Through the ordinary action, so the transition is judged by the same
           state machine and lands in the same audit trail as a manual move.
           Duplicating that logic here is how the two would drift apart. */
        await changeStatusAction(taskId, 'todo');
      }
    } catch {
      console.error('[placements] claim or start failed; the link is saved');
    }
  }

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

/**
 * A pasted address as something storable, or null when it is not an address.
 *
 * ⚠️ `https`, not `http`: every platform this product posts to redirects to TLS
 * anyway, and storing the insecure form means a client report full of links that
 * bounce through a redirect.
 *
 * ⚠️ Deliberately NOT `new URL()` alone — `new URL('not a link')` throws, but
 * `new URL('a:b')` does not, and neither does a value with no dot in it. The
 * shape is checked explicitly: something, a dot, something, and no spaces.
 */
function normaliseUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;

  /* A host with at least one dot and no whitespace anywhere. `www.facebook.com`
     and `facebook.com/p/123` both pass; `hello world` and `notalink` do not. */
  if (!/^https?:\/\/[^\s/?#.]+\.[^\s]+$/i.test(withScheme)) return null;

  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}
