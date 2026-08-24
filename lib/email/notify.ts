import 'server-only';

import { expiresInMinutes, generateNumericCode, hashScopedCode } from '@/lib/auth/tokens';
import { issueToken } from '@/lib/db/queries/auth';

import { sendEmail } from './send';
import { emailChangedEmail, loginAlertEmail, unlockEmail } from './templates';
import { getSettings } from '@/lib/settings/current';

/* ============================================================================
 * MAIL SENT BY THE SYSTEM, NOT BY A PERSON
 * ----------------------------------------------------------------------------
 * The sign-in path triggers these, which makes them different from every other
 * email in the application in one way that matters:
 *
 * ── NOTHING HERE MAY SLOW DOWN OR BREAK A SIGN-IN ────────────────────────────
 * Every function returns void and swallows its own failures. A sign-in that
 * fails because Resend is unreachable would be absurd — and worse, a sign-in
 * that takes ten seconds because it waits for a mail API has just been given a
 * denial-of-service handle by anyone who can hit the login form.
 *
 * So these are fire-and-forget: called without `await`, they run alongside the
 * response. If the mail never goes, the lock still applies and the session is
 * still issued. The email is a courtesy on top of a control, never part of it.
 *
 * ── THE UNLOCK CODE IS ISSUED HERE, NOT WHEN SOMEBODY ASKS ───────────────────
 * A locked account is told at the moment it locks, because the person is sitting
 * there right now wondering why their password stopped working. Making them find
 * "forgot password" to discover they are locked is a worse thirty seconds than
 * simply telling them.
 * ========================================================================= */

/**
 * Tell somebody their account just locked, and give them the way back in.
 *
 * FR-155a. The code restores access and leaves the password alone — the usual
 * cause is their own typing, and forcing a password change for that punishes
 * somebody for being human.
 */
export function notifyAccountLocked(input: {
  userId: string;
  email: string;
  fullName: string;
  appUrl: string;
}): void {
  void (async () => {
    try {
      const code = generateNumericCode(6);
      const settings = await getSettings();

      await issueToken({
        userId: input.userId,
        tokenHash: hashScopedCode('account_unlock', input.email, code),
        purpose: 'account_unlock',
        sentToEmail: input.email,
        expiresAt: expiresInMinutes(Date.now(), Number(settings.recoveryCodeTtlMinutes)),
        createdBy: null,
      });

      const message = unlockEmail({
        fullName: input.fullName,
        code,
        unlockUrl: `${input.appUrl}/reset-password?code=${code}`,
        lockAfter: Number(settings.failedLoginsToLock),
        lockClearsAfterMinutes: Number(settings.accountLockAutoClearMinutes),
      });
      /* Spread whole, not field by field. Every template also carries the
         header mark as an inline attachment, and a call that names subject,
         html and text individually drops it — silently, as a broken image in
         somebody's inbox with nothing logged anywhere. */
      await sendEmail({ to: input.email, ...message });
    } catch {
      /* Swallowed on purpose. The lock is already applied and the ledger already
         records it; a failed email must not undo either, and must not surface as
         an error on a sign-in screen where it would only confuse. */
    }
  })();
}

/**
 * FR-151 — tell somebody they signed in, and from where.
 *
 * ── WHY THIS IS WORTH THE NOISE ──────────────────────────────────────────────
 * It is the only control in the system that catches a *successful* compromise.
 * Everything else — the lockout, MFA, rate limiting — resists the attempt. Once
 * somebody is in with a valid password and a valid code, the only thing left is
 * the real owner reading an email that says "signed in from Lahore" when they
 * are in Karachi.
 *
 * Sent only for a device that has not been seen before, so it stays meaningful.
 * One of these a day trains people to ignore them, and an ignored alert is worse
 * than none because it is mistaken for coverage.
 */
export function notifyNewDeviceSignIn(input: {
  email: string;
  fullName: string;
  when: Date;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  appUrl: string;
}): void {
  void (async () => {
    try {
      const message = loginAlertEmail(input);
      /* Spread whole, not field by field. Every template also carries the
         header mark as an inline attachment, and a call that names subject,
         html and text individually drops it — silently, as a broken image in
         somebody's inbox with nothing logged anywhere. */
      await sendEmail({ to: input.email, ...message });
    } catch {
      /* Never blocks or fails a sign-in. */
    }
  })();
}

/**
 * REDESIGN-PLAN §2 — the sign-in address changed. Tell the address it *was*.
 *
 * ── `previousEmail` IS THE RECIPIENT, AND IT IS THE WHOLE POINT ──────────────
 * Sending this to the new address would be a receipt, which is worthless: the
 * person who made the change already knows. It is the *old* mailbox that has
 * just quietly lost an account, and its owner is the only one who can tell that
 * this was not them.
 *
 * ── FIRE-AND-FORGET, LIKE EVERYTHING ELSE HERE — WITH ONE DIFFERENCE ─────────
 * The change is already committed and already in the audit trail and the
 * security log before this runs, so a mail failure costs the alert and nothing
 * else. That is the same trade the rest of this file makes. It is a worse trade
 * here than anywhere else in the system, because this alert is the only control
 * on the change rather than a courtesy on top of one — which is exactly why the
 * event is written to `security_events` first, where the Super Admin sees it
 * whether or not Resend was reachable.
 */
export function notifyEmailChanged(input: {
  previousEmail: string;
  newEmail: string;
  fullName: string;
  when: Date;
  isSuperAdmin: boolean;
  appUrl: string;
}): void {
  void (async () => {
    try {
      const message = emailChangedEmail({
        fullName: input.fullName,
        newEmail: input.newEmail,
        when: input.when,
        isSuperAdmin: input.isSuperAdmin,
        appUrl: input.appUrl,
      });
      await sendEmail({ to: input.previousEmail, ...message });
    } catch {
      /* The change stands, and the security event is already written. */
    }
  })();
}
