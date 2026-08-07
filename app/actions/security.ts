'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withAppRole, withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { setLock } from '@/lib/db/queries/auth';
import { getAccountState } from '@/lib/db/queries/provisioning';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * SECURITY ACTIONS — FR-154, FR-155a
 * ----------------------------------------------------------------------------
 * Ending sessions, and releasing a locked account.
 *
 * ── EVERY ACTION HERE AUDITS ITSELF ──────────────────────────────────────────
 * Including the ones that look harmless. "Who unlocked that account and when"
 * is precisely the question asked after an incident, and an unlock performed
 * with no trace is indistinguishable from an attacker clearing their own lock.
 * ========================================================================= */

export interface SecurityActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly note?: string;
}

const fail = (error: string): SecurityActionResult => ({ ok: false, error });

/**
 * End one of your own sessions.
 *
 * Scoped by `user_id` in the statement AND by RLS, so an id belonging to
 * somebody else matches nothing rather than ending their session.
 */
export async function revokeSessionAction(sessionId: string): Promise<SecurityActionResult> {
  const user = await requireUser();

  const rows = await withUser(user.id, (tx) => tx`
    update public.sessions
       set revoked_at = now(), revoked_reason = 'signed_out_by_owner'
     where id = ${sessionId} and user_id = ${user.id} and revoked_at is null
    returning id
  `);

  if (rows.length === 0) return fail('That session has already ended.');

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'session',
      entityId: sessionId,
      action: 'session.revoked',
      after: { self: true },
    }),
  );

  revalidatePath('/security');
  return {
    ok: true,
    note:
      sessionId === user.sessionId
        ? 'That was the session you are using — you will be signed out on your next click.'
        : 'That device is signed out.',
  };
}

/**
 * FR-154 — sign out everywhere except here.
 *
 * The current session is deliberately spared. "Sign out of everything" that also
 * signs you out of the tab you clicked it in reads as a bug, and the person then
 * cannot tell whether it worked. Ending this one as well is a separate, explicit
 * choice on the row itself.
 */
export async function revokeOtherSessionsAction(): Promise<SecurityActionResult> {
  const user = await requireUser();

  const rows = await withUser(user.id, (tx) => tx`
    update public.sessions
       set revoked_at = now(), revoked_reason = 'signed_out_everywhere'
     where user_id = ${user.id} and id <> ${user.sessionId} and revoked_at is null
    returning id
  `);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'session',
      entityId: null,
      action: 'session.revoked_all_others',
      after: { count: rows.length },
    }),
  );

  revalidatePath('/security');
  return {
    ok: true,
    note:
      rows.length === 0
        ? 'There were no other sessions.'
        : `${rows.length} other ${rows.length === 1 ? 'device is' : 'devices are'} signed out. This one is still active.`,
  };
}

/**
 * Release a locked account without touching the password.
 *
 * ── CLEARING `locked_at` IS NOT ENOUGH ON ITS OWN ────────────────────────────
 * The lock is DERIVED from the append-only attempt ledger, never stored as a
 * counter (that is what stops it being quietly reset). So the failures are still
 * there after the column is cleared. `auth_set_lock(null)` records the unlock,
 * and `evaluateLockout` treats an explicit unlock as the new baseline — which is
 * how the ledger stays append-only and the lock can still be lifted.
 */
export async function unlockAccountAction(userId: string): Promise<SecurityActionResult> {
  const user = await requireUser();

  const target = await getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'user.force_password_reset', {
    ownerId: userId,
    ownerRole: target.role,
  })) {
    return fail('Only an Admin can unlock an account, and only for somebody below them.');
  }

  await setLock(userId, null);

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.unlocked',
      after: { email: target.email },
    });
    /* A `warning` event rather than `info`: an unlock is routine, but a burst of
       them is not, and the alert stream is where that pattern shows up. */
    await tx`
      insert into public.security_events (user_id, event_type, severity, details)
      values (${userId}, 'account_unlocked', 'warning'::public.security_severity,
              ${tx.json({ by: user.email, byRole: user.role })})
    `;
  });

  revalidatePath('/security');
  revalidatePath('/team');
  return {
    ok: true,
    note: `${target.fullName} can sign in again. Their password is unchanged — an unlock is not a reset.`,
  };
}

/** doc 16 §6. Read-only: the seal is only broken outside the application. */
export async function breakGlassStatus(): Promise<{
  configured: boolean;
  used: boolean;
  note: string;
}> {
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    return { configured: false, used: false, note: 'Super Admin only.' };
  }

  /* `break_glass` has RLS on with ZERO policies and every privilege revoked from
     cni_app — doc 04 §5's "no client read path at all". So even the Super Admin
     cannot read it through the app, by design, and the honest answer is to say
     so rather than to add a policy that would defeat the point. */
  const rows = await withAppRole((tx) => tx`
    select count(*) filter (where severity = 'critical') as criticals
      from public.security_events
     where event_type = 'break_glass_used'
  `);

  const used = Number(rows[0]?.criticals ?? 0) > 0;
  return {
    configured: true,
    used,
    note: used
      ? 'The sealed credential HAS been used. Every use writes a critical event that commits even when the surrounding transaction is rolled back.'
      : 'Never used. The credential itself is unreadable through this application by design — the table has row-level security enabled with no policies at all, so there is no client read path to it.',
  };
}
