'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { markNotificationsRead } from '@/lib/db/queries/feed';

/* ============================================================================
 * NOTIFICATION ACTIONS
 * ----------------------------------------------------------------------------
 * No authorisation check here beyond `requireUser()`, and that is not an
 * omission: row-level security on `notifications` restricts every row to its own
 * user at every rank, so "mark all read" can only ever mark the caller's own.
 * There is no id to tamper with and no scope to widen.
 * ========================================================================= */

export async function markAllReadAction(): Promise<{ ok: true }> {
  const user = await requireUser();
  await markNotificationsRead(user.id);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function markReadAction(ids: readonly string[]): Promise<{ ok: true }> {
  const user = await requireUser();
  await markNotificationsRead(user.id, ids);
  revalidatePath('/', 'layout');
  return { ok: true };
}
