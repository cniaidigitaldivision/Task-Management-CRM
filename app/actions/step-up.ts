'use server';

import { requireUser } from '@/lib/auth/current-user';
import { burnTimeLikeAVerify, verifyPassword } from '@/lib/auth/hashing';
import { verifyTotp } from '@/lib/auth/totp';
import { withAppRole } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { findIdentity, getVerifiedFactors } from '@/lib/db/queries/auth';
import { withUser } from '@/lib/db/client';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * STEP-UP RE-AUTHENTICATION — FR-149
 * ----------------------------------------------------------------------------
 * `requiresStepUp()` has existed and been tested since Step 3, the column has
 * existed since migration 001, and `app.session_mark_step_up` since 014.
 * Nothing called any of them. This is the piece that was missing, and it was
 * deliberately carried here rather than bolted onto the end of Step 4 — it
 * belongs with the settings it protects.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────
 * A session lasts hours or days. An unlocked laptop, a borrowed machine, a tab
 * left open in a shared office — all of them present a *valid* session. For
 * ordinary work that is the right trade. For changing somebody's role, resetting
 * an authenticator, or editing the capacity thresholds the whole workload model
 * rests on, it is not: those want proof that the person at the keyboard is still
 * the account holder, not merely that they were an hour ago.
 *
 * ── WHY IT ASKS FOR THE PASSWORD AND NOT JUST A CODE ─────────────────────────
 * The phone is usually sitting next to the unlocked laptop. A second factor
 * proves possession of something that is already in the room; the password
 * proves knowledge, which is the thing a passer-by does not have. Privileged
 * accounts are asked for both, because for those the phone may be the only
 * thing an attacker with the password lacks.
 *
 * ── TEN MINUTES, THEN IT LAPSES ──────────────────────────────────────────────
 * Long enough to finish the piece of work that needed it; short enough that
 * walking away does not leave the elevated state armed. Stored on the SESSION,
 * so stepping up in one browser does not silently elevate another.
 * ========================================================================= */

export interface StepUpState {
  readonly ok?: boolean;
  readonly error?: string;
  readonly needsTotp?: boolean;
}

/* The two predicates — `stepUpRequired` and `needsStepUp` — live in
   lib/auth/step-up.ts. A 'use server' module may only export async functions,
   and every export of one is a callable endpoint; a boolean helper should be
   neither. */

/**
 * Prove it: password, plus the authenticator for a privileged role.
 *
 * ── FAILURES ARE AUDITED ─────────────────────────────────────────────────────
 * A failed step-up is more interesting than a successful one. Somebody at a
 * borrowed keyboard trying passwords against a live session is precisely the
 * situation this exists to catch, and it would leave no trace anywhere else —
 * `login_attempts` never sees it, because they are already signed in.
 */
export async function completeStepUp(
  _prev: StepUpState,
  form: FormData,
): Promise<StepUpState> {
  const user = await requireUser();

  const password = String(form.get('password') ?? '');
  const totp = String(form.get('totp') ?? '').replace(/\s/g, '').trim();

  if (!password) return { error: 'Enter your password.' };

  const identity = await findIdentity(user.email);
  if (!identity?.passwordHash) {
    /* Should be unreachable — they are signed in. Burn the time anyway so this
       branch cannot be told apart from a wrong password by how long it took. */
    await burnTimeLikeAVerify(password);
    return { error: 'That did not work. Sign out and back in.' };
  }

  if (!(await verifyPassword(identity.passwordHash, password))) {
    await withUser(user.id, (tx) =>
      audit(tx, user, {
        entityType: 'security',
        entityId: user.id,
        action: 'session.step_up_failed',
        outcome: 'failed',
        after: { reason: 'bad_password' },
      }),
    ).catch(() => {});
    return { error: 'That password was not accepted.' };
  }

  /* A privileged account is asked for the second factor too. For an Admin or
     Super Admin, the password may be the part an attacker already has. */
  const factors = await getVerifiedFactors(user.id);
  const totpFactor = factors.find((f) => f.type === 'totp' && f.secretEncrypted);

  if (totpFactor) {
    if (!totp) return { needsTotp: true };
    if (!verifyTotp(totpFactor.secretEncrypted as string, totp, nowMs())) {
      await withUser(user.id, (tx) =>
        audit(tx, user, {
          entityType: 'security',
          entityId: user.id,
          action: 'session.step_up_failed',
          outcome: 'failed',
          after: { reason: 'bad_totp' },
        }),
      ).catch(() => {});
      return { error: 'That authenticator code was not accepted.', needsTotp: true };
    }
  }

  await withAppRole((tx) => tx`select app.session_mark_step_up(${user.sessionId})`);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'security',
      entityId: user.id,
      action: 'session.step_up',
      after: { withSecondFactor: Boolean(totpFactor) },
    }),
  ).catch(() => {});

  return { ok: true };
}
