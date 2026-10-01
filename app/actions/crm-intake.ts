'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { listIntakeKeys, type CrmIntakeKey } from '@/lib/db/queries/crm-intake';

/* ============================================================================
 * ISSUING AND WITHDRAWING AN INTAKE KEY
 * ----------------------------------------------------------------------------
 * Migration 277. Every one of these calls a SECURITY DEFINER that checks the
 * caller again, so a screen that drew a button it should not have is refused by
 * the database rather than obeyed.
 * ========================================================================= */

export interface IntakeResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The plaintext key. Returned ONCE, by `mint` only, and never again. */
  readonly key?: string;
  readonly keys?: readonly CrmIntakeKey[];
}

/* ⚠️ BY SQLSTATE, NOT BY GUESSING AT THE MESSAGE — migration 271's lesson,
   where a catch block told a real manager they were not a manager. */
function refusal(err: unknown, what: string): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23514') {
    const message = String((err as { message?: string } | null)?.message ?? '').trim();
    return message || `Only a manager of that project, or an Admin, can ${what}.`;
  }
  if (code === '42501') {
    return `The database refused this app permission to ${what}. This needs a migration, not a role change.`;
  }
  const detail = String((err as { message?: string } | null)?.message ?? '').trim();
  return detail ? `That did not save: ${detail}` : 'That did not save.';
}

export async function listIntakeKeysAction(projectId: string | null): Promise<IntakeResult> {
  const user = await requireUser();
  try {
    return { ok: true, keys: await listIntakeKeys(user.id, projectId) };
  } catch {
    return { ok: false, error: 'Those keys could not be read.' };
  }
}

/**
 * Issue a key for a project.
 *
 * ⚠️ THE PLAINTEXT COMES BACK ONCE AND IS NEVER STORED. The dialog shows it
 * with a copy button and says plainly that closing the panel loses it — which
 * is the honest version of a secret nobody can recover, rather than a screen
 * that implies it can be looked up later.
 */
export async function mintIntakeKeyAction(
  projectId: string,
  label: string,
  source: string,
  origins: readonly string[] = [],
): Promise<IntakeResult> {
  const user = await requireUser();
  if (!projectId) return { ok: false, error: 'Choose a project first.' };
  if (!label.trim()) {
    return { ok: false, error: 'Give the key a label, so somebody can tell later what it was for.' };
  }

  try {
    const rows = await withUser(user.id, (tx) => tx`
      select app.crm_mint_intake_key(
        ${projectId}::uuid, ${label.trim()},
        ${source}::public.crm_lead_source,
        ${origins as unknown as string[]}::text[]
      ) as out
    `);
    const out = (rows as Array<Record<string, unknown>>)[0]?.out as { key?: string } | undefined;
    revalidatePath('/leads');
    return { ok: true, key: out?.key };
  } catch (err) {
    return { ok: false, error: refusal(err, 'issue an intake key') };
  }
}

export async function revokeIntakeKeyAction(keyId: string): Promise<IntakeResult> {
  const user = await requireUser();
  try {
    const rows = await withUser(user.id, (tx) => tx`
      select app.crm_revoke_intake_key(${keyId}::uuid) as ok
    `);
    if (!(rows as Array<Record<string, unknown>>)[0]?.ok) {
      return { ok: false, error: 'That key could not be found.' };
    }
    revalidatePath('/leads');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: refusal(err, 'withdraw an intake key') };
  }
}
