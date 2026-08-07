'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { NOTIFICATION_KINDS, type NotificationKind } from '@/lib/domain/constants';
import {
  applyLocks,
  defaultPrefs,
  mergePrefs,
  type NotificationPrefs,
} from '@/lib/domain/notification-prefs';

/* ============================================================================
 * NOTIFICATION PREFERENCES — FR-078
 * ----------------------------------------------------------------------------
 * `settings.own_notification_prefs` is allowed to every role (doc 03 §3.6),
 * which is the point: these are personal, not administrative. The only
 * authorisation question is "is this your row", and it is answered by writing
 * `where id = app.current_user_id()` rather than trusting an id from the form.
 * ========================================================================= */

export interface PrefsResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly note?: string;
}

export async function getMyPrefsAction(): Promise<NotificationPrefs> {
  const user = await requireUser();
  const rows = await withUser(user.id, (tx) => tx`
    select notification_prefs from public.users where id = ${user.id}
  `);
  return mergePrefs(rows[0]?.notification_prefs);
}

export async function saveMyPrefsAction(
  incoming: Record<string, { inApp: boolean; email: boolean }>,
): Promise<PrefsResult> {
  const user = await requireUser();

  /* Rebuilt from the known list rather than stored as sent. A payload with an
     unknown key would otherwise be written verbatim into the jsonb column and
     read back forever as a setting nothing consumes. */
  const clean = defaultPrefs();
  for (const kind of NOTIFICATION_KINDS as readonly NotificationKind[]) {
    const value = incoming[kind];
    if (!value) continue;
    clean[kind] = { inApp: Boolean(value.inApp), email: Boolean(value.email) };
  }

  /* The locks are re-applied server-side. The UI disables those switches, but a
     disabled control is a courtesy and this is the rule. */
  const locked = applyLocks(clean);

  await withUser(user.id, (tx) => tx`
    update public.users
       set notification_prefs = ${tx.json(locked as never)}
     where id = ${user.id}
  `);

  revalidatePath('/profile');
  return { ok: true, note: 'Saved. This affects what reaches you from now on.' };
}
