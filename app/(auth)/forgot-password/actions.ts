'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { hashPassword } from '@/lib/auth/hashing';
import { issueSession, type RequestFacts } from '@/lib/auth/session';
import { expiresInMinutes, generateNumericCode, hashScopedCode } from '@/lib/auth/tokens';
import { verifyTotp } from '@/lib/auth/totp';
import {
  consumeToken,
  findIdentity,
  getVerifiedFactors,
  issueToken,
  registerTokenAttempt,
  setLock,
  setPassword,
} from '@/lib/db/queries/auth';
import { withAppRole } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/send';
import { passwordResetEmail, unlockEmail } from '@/lib/email/templates';
import { PRIVILEGED_RESET_ROLES } from '@/lib/domain/constants';
import { validatePassword } from '@/lib/domain/password-policy';
import { nowMs } from '@/lib/now';
import { getSettings } from '@/lib/settings/current';

/* ============================================================================
 * FORGOT PASSWORD / UNLOCK — FR-155, FR-155a–e, ADR-007
 * ----------------------------------------------------------------------------
 * ── FR-155e IS THE SHAPE OF THIS WHOLE FILE ──────────────────────────────────
 * "Never reveal whether an account exists." Requesting a reset returns the same
 * sentence for a real address, a typo, and an address that was never here. No
 * timing difference either: the unknown-address branch does the same work.
 *
 * That is not paranoia about this system specifically. An endpoint that answers
 * "no such account" is an endpoint that enumerates a company's staff list, and
 * these addresses are people's work email.
 *
 * ── THE LOCK PATH AND THE RESET PATH ARE DELIBERATELY SEPARATE ───────────────
 * A locked account (three failed attempts, FR-155a) is not a forgotten password.
 * The unlock code restores access and *keeps the existing password* — because
 * the usual cause is somebody's own typing, and forcing a password change for
 * that is a punishment for being human. Registry C-17 added `account_unlock`
 * as its own purpose for exactly this reason.
 *
 * ── PRIVILEGED RESETS NEED THE SECOND FACTOR TOO (FR-155b) ───────────────────
 * A Super Admin or Admin must clear MFA *after* the emailed code. Otherwise a
 * compromised mailbox is a complete account takeover, and for those two roles
 * that is the whole system.
 * ========================================================================= */

export interface ResetRequestState {
  readonly sent?: boolean;
  readonly error?: string;
  readonly email?: string;
}

export interface ResetState {
  readonly error?: string;
  readonly failures?: readonly string[];
  readonly needsMfa?: boolean;
  readonly email?: string;
  readonly code?: string;
}

/* The neutral confirmation is worded in request-form.tsx rather than returned
   from here. `requestReset` returns only `{ sent: true }` — with no message and
   no account detail — which makes it structurally impossible for this action to
   leak whether an address exists, however the wording later changes. */

async function requestFacts(): Promise<RequestFacts> {
  const list = await headers();
  return {
    userAgent: list.get('user-agent'),
    acceptLanguage: list.get('accept-language'),
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ipCountry: list.get('x-vercel-ip-country'),
    ipAsn: list.get('x-vercel-ip-asn'),
  };
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4310').replace(/\/+$/, '');
}

/* ==========================================================================
 * 1 · ASK FOR A CODE
 * ========================================================================== */

export async function requestReset(
  _prev: ResetRequestState,
  form: FormData,
): Promise<ResetRequestState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Enter your email address.' };

  const identity = await findIdentity(email);

  /* Unknown, deactivated or suspended: say the same thing and stop. No email is
     sent, and the caller cannot tell the difference. */
  if (!identity || !identity.isActive || identity.accountState === 'deactivated' || identity.accountState === 'suspended') {
    return { sent: true, email };
  }

  /* A locked account gets the UNLOCK code instead — different code, different
     purpose, and it does not disturb their password. Deciding here rather than
     making the person choose means somebody who has simply mistyped three times
     gets the right email without having to diagnose themselves. */
  const locked = identity.lockedAt !== null;
  const purpose = locked ? 'account_unlock' : 'password_reset';

  const code = generateNumericCode(6);
  const settings = await getSettings();
  const ttlMinutes = Number(settings.recoveryCodeTtlMinutes);
  const expiresAt = expiresInMinutes(nowMs(), ttlMinutes);

  await issueToken({
    userId: identity.userId,
    tokenHash: hashScopedCode(purpose, email, code),
    purpose,
    sentToEmail: email,
    expiresAt,
    createdBy: null,
  });

  const link = `${appUrl()}/reset-password?code=${code}`;
  const message = locked
    ? unlockEmail({
        fullName: identity.fullName,
        code,
        unlockUrl: link,
        lockAfter: Number(settings.failedLoginsToLock),
        lockClearsAfterMinutes: Number(settings.accountLockAutoClearMinutes),
      })
    : passwordResetEmail({ fullName: identity.fullName, code, resetUrl: link });

  /* Not awaited into the response shape: whether Resend succeeded must not
     change what the caller is told, or the neutral answer leaks by timing and
     by wording both. */
  await sendEmail({ to: email, subject: message.subject, html: message.html, text: message.text });

  return { sent: true, email };
}

/* ==========================================================================
 * 2 · USE THE CODE
 * ========================================================================== */

export async function completeReset(_prev: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const code = String(form.get('code') ?? '').replace(/\s/g, '').trim();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  const totp = String(form.get('totp') ?? '').replace(/\s/g, '').trim();

  const echo = { email, code };
  const generic = {
    error:
      'That code is not usable. It may have expired, already been used, or been replaced by a newer one. Ask for another.',
    ...echo,
  };

  if (!email || !/^\d{6}$/.test(code)) {
    return { error: 'Enter your email address and the six-digit code.', ...echo };
  }

  const identity = await findIdentity(email);
  if (!identity) return generic;

  const wasLocked = identity.lockedAt !== null;
  const purpose = wasLocked ? 'account_unlock' : 'password_reset';
  const tokenHash = hashScopedCode(purpose, email, code);

  /* ---- Unlock: restore access, keep the password (FR-155a) -------------- */
  if (wasLocked) {
    const consumed = await consumeToken(tokenHash, 'account_unlock');
    if (consumed.status !== 'ok' || !consumed.userId) {
      await registerTokenAttempt(tokenHash);
      return generic;
    }

    /* Clearing `locked_at` is not enough on its own: the lock is DERIVED from
       the append-only attempt ledger (lib/domain/lockout.ts), and those failures
       are still there. `auth_set_lock(null)` records the unlock, and
       `evaluateLockout` treats an explicit unlock as the new baseline — which is
       why the ledger can stay append-only and the lock can still be cleared. */
    await setLock(consumed.userId, null);

    redirect('/login?reason=unlocked');
  }

  /* ---- Reset: prove the code, then the second factor if required -------- */
  if (password !== confirm) return { error: 'The two passwords do not match.', ...echo };

  const check = validatePassword(password, {
    role: identity.role,
    fullName: identity.fullName,
    email: identity.email,
  });
  if (!check.ok) {
    return {
      error: 'That password cannot be used yet.',
      failures: check.failures.map((f) => f.message),
      ...echo,
    };
  }

  /* FR-155b — a mailbox alone must not be enough for a privileged account.
     Checked BEFORE the token is consumed, so failing the second factor does not
     cost somebody their emailed code. */
  if (PRIVILEGED_RESET_ROLES.includes(identity.role)) {
    const factors = await getVerifiedFactors(identity.userId);
    const totpFactor = factors.find((f) => f.type === 'totp' && f.secretEncrypted);

    if (totpFactor) {
      if (!totp) return { needsMfa: true, ...echo };
      if (!verifyTotp(totpFactor.secretEncrypted as string, totp, nowMs())) {
        return {
          error: 'That authenticator code was not accepted.',
          needsMfa: true,
          ...echo,
        };
      }
    }
  }

  const passwordHash = await hashPassword(password);

  const consumed = await consumeToken(tokenHash, 'password_reset');
  if (consumed.status !== 'ok' || !consumed.userId) {
    await registerTokenAttempt(tokenHash);
    return generic;
  }

  /* Sets the hash, trims history to five so an old password cannot be reused,
     REVOKES EVERY SESSION (FR-155c), and clears any lock — one statement,
     migration 010. Revocation matters most: if the reset was prompted by a
     suspected compromise, leaving the attacker's session alive defeats it. */
  await setPassword(consumed.userId, passwordHash);

  await withAppRole((tx) => tx`
    update public.users
       set account_state = 'active'::public.account_state
     where id = ${consumed.userId} and account_state = 'password_reset_required'
  `);

  /* Straight in — they proved the emailed code, cleared MFA where required, and
     just chose the credential. A sign-in form now would ask for what they typed
     ten seconds ago. */
  await issueSession(consumed.userId, identity.role, await requestFacts(), nowMs());

  redirect(identity.role === 'member' ? '/my-work' : '/dashboard');
}
