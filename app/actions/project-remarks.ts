'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { record } from '@/lib/db/queries/feed';
import {
  deleteProjectRemark,
  insertProjectRemark,
  listProjectRemarks,
  type RemarkRow,
} from '@/lib/db/queries/project-remarks';
import { withUser } from '@/lib/db/client';

/* ============================================================================
 * REMARK ACTIONS
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO ROLE CHECK, AND IT IS NOT AN OVERSIGHT ────────────────────────────
 * Migration 104's policies decide all three questions — who may read a
 * project's remarks, who may write one, under whose name — through
 * `app.project_is_visible`, the same predicate that decides whether the project
 * page opens at all. A `can(...)` call here would be a second rule to keep in
 * step with the first, and the first is the one the database enforces.
 *
 * What IS here is the reading back of a policy violation as a sentence. An
 * insert refused by RLS arrives as an opaque Postgres error; nobody should see
 * that, and "you cannot post here" is the only thing it can honestly mean.
 * ========================================================================= */

export interface RemarkResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly remarks?: readonly RemarkRow[];
}

/** The longest a remark may be. Mirrors the CHECK constraint in 104. */
const MAX_BODY = 4000;

/**
 * The thread, fetched when the dialog opens rather than shipped with the page.
 *
 * ⚠️ Also returned by `addRemarkAction` and `removeRemarkAction`, so the dialog
 * re-renders from the SERVER's copy after every write instead of appending
 * locally. Appending locally is one line shorter and drifts: two people with the
 * dialog open produce two different orders, and neither matches the database.
 */
export async function listRemarksAction(projectId: string): Promise<RemarkResult> {
  const user = await requireUser();
  try {
    return { ok: true, remarks: await listProjectRemarks(user.id, projectId) };
  } catch {
    return { ok: false, error: 'Those remarks could not be loaded.' };
  }
}

export async function addRemarkAction(projectId: string, body: string): Promise<RemarkResult> {
  const user = await requireUser();

  const text = body.trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  if (text.length > MAX_BODY) {
    return { ok: false, error: `That is longer than ${MAX_BODY} characters.` };
  }

  try {
    const id = await insertProjectRemark(user.id, projectId, text);

    /* ⚠️ LOGGED AGAINST THE PROJECT, and the summary carries no text. The
       activity feed is visible to everybody who can see the project — which is
       the same audience as the remark itself, so no secret is spilled — but a
       feed that repeats every note in full is a feed nobody skims. The entry
       says a remark was left; the remark says what it said. */
    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'project',
        entityId: projectId,
        action: 'remark_added',
        summary: 'left a remark',
        after: { remarkId: id },
      }),
    );
  } catch {
    return {
      ok: false,
      error: 'That remark could not be saved. You may not have access to this project.',
    };
  }

  /* The badge on the project page counts them, so the page has to be re-read. */
  revalidatePath('/projects');
  return { ok: true, remarks: await listProjectRemarks(user.id, projectId) };
}

export async function removeRemarkAction(
  projectId: string,
  remarkId: string,
): Promise<RemarkResult> {
  const user = await requireUser();

  const removed = await deleteProjectRemark(user.id, remarkId);
  if (!removed) {
    /* ⚠️ The honest reading of "no rows matched". The delete policy admits the
       author and any Admin, so a miss means neither — or that somebody else
       removed it a moment ago, which needs no explanation of its own. */
    return { ok: false, error: 'That remark is not yours to remove.' };
  }

  revalidatePath('/projects');
  return { ok: true, remarks: await listProjectRemarks(user.id, projectId) };
}
