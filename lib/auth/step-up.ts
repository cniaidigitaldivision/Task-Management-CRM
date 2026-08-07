import 'server-only';

import { requireUser, stepUpIsFresh, type CurrentUser } from '@/lib/auth/current-user';
import { requiresStepUp, type Action } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * STEP-UP — THE PREDICATES (FR-149)
 * ----------------------------------------------------------------------------
 * These live here rather than beside `completeStepUp` for a mechanical reason:
 * a `'use server'` module may only export async functions, and `needsStepUp` is
 * a synchronous check on an actor already in hand. Exporting it from the actions
 * file failed the build outright — which is the right failure, because every
 * export of a `'use server'` module is a callable HTTP endpoint, and a boolean
 * helper has no business being one.
 *
 * The challenge itself stays in app/actions/step-up.ts, where the header
 * explains what it is for.
 * ========================================================================= */

/**
 * Does this actor need to re-authenticate before `action`?
 *
 * Two questions in one: is the action sensitive at all (doc 03), and is their
 * proof still fresh. Reads the session, so prefer `needsStepUp` when the caller
 * already holds the user.
 */
export async function stepUpRequired(action: Action): Promise<boolean> {
  if (!requiresStepUp(action)) return false;
  const user = await requireUser();
  return !stepUpIsFresh(user, nowMs());
}

/** The same check for an actor already in hand, without a second session read. */
export function needsStepUp(user: CurrentUser, action: Action): boolean {
  return requiresStepUp(action) && !stepUpIsFresh(user, nowMs());
}
