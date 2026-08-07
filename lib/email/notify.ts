import 'server-only';

import { expiresInMinutes, generateNumericCode, hashScopedCode } from '@/lib/auth/tokens';
import { issueToken } from '@/lib/db/queries/auth';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

import { sendEmail } from './send';
import { loginAlertEmail, unlockEmail } from './templates';

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

      await issueToken({
        userId: input.userId,
        tokenHash: hashScopedCode('account_unlock', input.email, code),
        purpose: 'account_unlock',
        sentToEmail: input.email,
        expiresAt: expiresInMinutes(Date.now(), SYSTEM_DEFAULTS.recoveryCodeTtlMinutes),
        createdBy: null,
      });

      const message = unlockEmail({
        fullName: input.fullName,
        code,
        unlockUrl: `${input.appUrl}/reset-password?code=${code}`,
      });
      await sendEmail({
        to: input.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
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
      await sendEmail({
        to: input.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch {
      /* Never blocks or fails a sign-in. */
    }
  })();
}
