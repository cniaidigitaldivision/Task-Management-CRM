'use server';

import { revalidatePath } from 'next/cache';

import { requireUser, stepUpIsFresh } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as V from '@/lib/db/queries/credentials';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * THE CREDENTIALS VAULT — owner request 2026-08-12
 * ----------------------------------------------------------------------------
 * ── WHAT THIS DOES NOT DO, AND WILL NOT ──────────────────────────────────────
 * It does not show anybody's CRM password. Those are Argon2id digests; there is
 * no key and no admin view, and adding one would mean storing passwords
 * recoverably so that a single compromised Super Admin account exposed every
 * person's password — including ones reused elsewhere. The owner was told this
 * plainly. To get into somebody's account, force a reset (CHANGE-PLAN 4.1).
 *
 * This holds the third-party logins the division keeps for clients and projects.
 *
 * ── THREE CONTROLS, AND EACH ANSWERS A DIFFERENT QUESTION ────────────────────
 *   who may see the row      row-level security (migration 023). Not this file.
 *   who may read the secret  step-up re-auth, here, every single time
 *   what happened            a CRITICAL security event per reveal, here
 *
 * The middle one is the reason this file exists rather than the queries being
 * called from a page. `credential.reveal` is in `STEP_UP_ACTIONS`, so a valid
 * session is not enough — which is the whole point of FR-149: a hijacked session
 * must not be able to do what a stolen password could, and a vault is exactly
 * where that distinction stops being theoretical.
 *
 * ── WHY A REVEAL IS LOGGED AS 'critical' ─────────────────────────────────────
 * Because it is the one action in this system that hands over a working secret,
 * and unlike every other privileged act it leaves no other trace: a role change
 * shows up in the role, a purge shows up in the absence. Reading a password
 * changes nothing at all, so if it is not written down it did not happen.
 * ========================================================================= */

export interface VaultResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The client shows the re-authentication dialog when this is set. */
  readonly stepUpRequired?: boolean;
  readonly message?: string;
}

export interface RevealResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly stepUpRequired?: boolean;
  readonly label?: string;
  readonly username?: string | null;
  readonly secret?: string;
}

const fail = (error: string): VaultResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

/** `yyyy-mm-dd` or nothing. A malformed date is refused rather than dropped. */
function optionalDate(form: FormData, key: string): string | null | 'invalid' {
  const value = str(form, key);
  if (value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid';
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return 'invalid';
  return value;
}

/* ==========================================================================
 * READ
 * ==========================================================================
 * No secrets in here. `CredentialRow` carries `hasSecret`, never the value —
 * see the note in lib/db/queries/credentials.ts.
 * ========================================================================== */

export async function listCredentialsAction(): Promise<
  { ok: true; credentials: V.CredentialRow[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'credential.view')) {
    return { ok: false, error: 'You cannot see stored credentials.' };
  }
  return { ok: true, credentials: await V.listCredentials(user.id) };
}

/* ==========================================================================
 * REVEAL — the only path to plaintext
 * ========================================================================== */

export async function revealCredentialAction(id: string): Promise<RevealResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.reveal')) {
    return { ok: false, error: 'You cannot read stored credentials.' };
  }

  /* FR-149. Checked before the row is fetched, so a refusal cannot even confirm
     that the id exists. */
  if (!stepUpIsFresh(user, nowMs())) {
    return {
      ok: false,
      stepUpRequired: true,
      error: 'Confirm it is you before a stored credential is shown.',
    };
  }

  const found = await V.revealCredential(user.id, id);
  /* Indistinguishable from "not visible to you", which is the right answer to
     give somebody trying ids. */
  if (!found) return { ok: false, error: 'That credential is not available.' };

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.revealed',
      after: { label: found.label },
    });
    await tx`
      insert into public.security_events (user_id, event_type, severity, details)
      values (
        ${user.id},
        'credential_revealed',
        'critical'::public.security_severity,
        ${tx.json({ credentialId: id, label: found.label, role: user.role })}
      )
    `;
  }).catch(() => {
    /* The audit must not swallow the reveal — the person is mid-task and the
       secret is already decrypted. But a vault whose log fails silently is not a
       vault, so this is loud in the server log. */
    console.error('[vault] AUDIT WRITE FAILED for a credential reveal', { id });
  });

  return {
    ok: true,
    label: found.label,
    username: found.username,
    secret: found.secret,
  };
}

/* ==========================================================================
 * WRITE
 * ========================================================================== */

function readInput(form: FormData): V.CredentialInput | { error: string } {
  const label = str(form, 'label');
  if (!label) return { error: 'Give it a name — "ABC Traders portal", say.' };

  const url = optional(form, 'url');
  if (url && !/^https?:\/\//i.test(url)) {
    return { error: 'A link has to start with http:// or https://' };
  }

  const expiresAt = optionalDate(form, 'expiresAt');
  if (expiresAt === 'invalid') return { error: 'That expiry date is not a real date.' };

  return {
    label,
    kind: str(form, 'kind') || 'other',
    projectId: optional(form, 'projectId'),
    issuedToId: optional(form, 'issuedToId'),
    username: optional(form, 'username'),
    /* NOT trimmed. A password may legitimately begin or end with a space, and
       silently removing one produces a credential that does not work and a
       person who cannot see why. */
    secret: String(form.get('secret') ?? ''),
    url,
    notes: optional(form, 'notes'),
    expiresAt: expiresAt,
  };
}

export async function saveCredentialAction(
  _prev: VaultResult,
  form: FormData,
): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.manage')) {
    return fail('Only an Admin or a project owner can store credentials.');
  }

  const input = readInput(form);
  if ('error' in input) return fail(input.error);

  const id = str(form, 'id');

  try {
    if (id) {
      await V.updateCredential(user.id, id, input);
    } else {
      await V.createCredential(user.id, input);
    }
  } catch {
    /* The insert policy refuses a project the actor does not own, and the check
       constraints refuse a malformed row. Both arrive here as an opaque error, so
       the message names the likely cause rather than guessing at the exact one. */
    return fail(
      'That could not be saved. You can only store credentials against a project you own.',
    );
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id || null,
      action: id ? 'credential.updated' : 'credential.created',
      /* The label and where it points, never the secret. An audit log that
         recorded the value would defeat the encryption it sits beside. */
      after: {
        label: input.label,
        kind: input.kind,
        projectId: input.projectId,
        issuedToId: input.issuedToId,
        secretStored: input.secret !== '',
      },
    }),
  ).catch(() => console.error('[vault] audit write failed for a credential save'));

  revalidatePath('/vault');
  return { ok: true, message: id ? 'Saved.' : `${input.label} is stored.` };
}

/** Forget the secret, keep the record of the account. */
export async function clearSecretAction(id: string): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.manage')) return fail('You cannot change stored credentials.');

  await V.clearSecret(user.id, id);
  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.secret_cleared',
    }),
  ).catch(() => console.error('[vault] audit write failed for a secret clear'));

  revalidatePath('/vault');
  return {
    ok: true,
    message: 'The stored password is gone. The record of the account stays.',
  };
}

/**
 * Delete the whole entry.
 *
 * Admin and above only (the RLS delete policy agrees). A Coordinator may keep a
 * credential up to date but not make the record vanish — losing the record of a
 * third-party account nobody has revoked is worse than an out-of-date entry.
 */
export async function deleteCredentialAction(id: string): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.delete')) {
    return fail('Only an Admin can delete a stored credential.');
  }

  /* Read the label BEFORE deleting, so the audit entry says what went. Reveal is
     the wrong function for that — it would log a CRITICAL read that did not
     happen — so this deliberately takes the label from the list. */
  const all = await V.listCredentials(user.id);
  const label = all.find((c) => c.id === id)?.label ?? 'unknown';

  const removed = await V.deleteCredential(user.id, id);
  if (!removed) return fail('That credential is no longer there.');

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.deleted',
      before: { label },
    }),
  ).catch(() => console.error('[vault] audit write failed for a credential delete'));

  revalidatePath('/vault');
  return { ok: true, message: `${label} is deleted.` };
}
