'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { burnTimeLikeAVerify, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/hashing';
import { issueSession, type RequestFacts } from '@/lib/auth/session';
import { verifyTotp } from '@/lib/auth/totp';
import {
  findIdentity,
  getLockoutInputs,
  getVerifiedFactors,
  recordAttempt,
  recordLogin,
  setLock,
  setPassword,
} from '@/lib/db/queries/auth';
import { MFA_REQUIRED_ROLES } from '@/lib/domain/constants';
import { evaluateLockout, failureMessage, minutesUntilUnlock } from '@/lib/domain/lockout';
import type { LoginOutcome } from '@/lib/domain/lockout';

/* ============================================================================
 * SIGN IN — the server action
 * ----------------------------------------------------------------------------
 * doc 20 §1 layer 3: authenticate → authorise → validate → call domain →
 * persist → log. Every rule applied here comes from lib/domain/; this file
 * orchestrates and decides nothing of its own.
 *
 * ── THE ORDER OF OPERATIONS *IS* THE SECURITY DESIGN ─────────────────────────
 * 1. look the account up          — always, even for an unknown address
 * 2. evaluate the lock FIRST      — a locked account must not have its password
 *                                   checked at all, or the lock is a UI
 *                                   inconvenience and guessing simply continues
 * 3. verify the password          — or burn equivalent time when there was no
 *                                   account, so the response is constant-time
 * 4. require MFA where mandatory  — FR-145, before any session exists
 * 5. only then issue a session
 *
 * ── FR-155e HOLDS THROUGHOUT ─────────────────────────────────────────────────
 * Every failure returns the same generic message from `failureMessage()`, and
 * the unknown-address branch does the same Argon2 work as a real one. An error
 * string is only half of a disclosure; timing is the other half and leaks the
 * same thing to anyone who measures it.
 * ========================================================================= */

export interface SignInState {
  readonly error?: string;
  /** Set when the account is locked, so the page can offer the unlock path. */
  readonly locked?: boolean;
  readonly unlockInMinutes?: number | null;
  /** Set when the password was right but a second factor is required. */
  readonly mfaRequired?: boolean;
  readonly email?: string;
}

async function requestFacts(): Promise<RequestFacts> {
  const list = await headers();
  return {
    userAgent: list.get('user-agent'),
    acceptLanguage: list.get('accept-language'),
    // Vercel sets these. Behind another proxy they may be absent, which every
    // consumer treats as "unknown" rather than as a change (session-policy.ts).
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ipCountry: list.get('x-vercel-ip-country'),
    ipAsn: list.get('x-vercel-ip-asn'),
  };
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const now = Date.now();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const totpCode = String(formData.get('totp') ?? '').trim();
  const facts = await requestFacts();

  const generic: SignInState = { error: 'Invalid email or password.', email };

  if (!email || !password) {
    return { error: 'Enter your email and password.', email };
  }

  const log = (outcome: LoginOutcome, userId: string | null) =>
    recordAttempt({
      email,
      userId,
      outcome,
      ip: facts.ip,
      ipCountry: facts.ipCountry,
      userAgent: facts.userAgent,
    });

  /* ---- 1 · look up ------------------------------------------------------ */
  const identity = await findIdentity(email);

  if (!identity || !identity.passwordHash) {
    // FR-155e. Same work, same duration, same words.
    await burnTimeLikeAVerify(password);
    await log('unknown_account', identity?.userId ?? null);
    return generic;
  }

  /* FR-006 — a deactivated or suspended account cannot sign in, and whether an
     account is disabled is not public information either. */
  if (
    !identity.isActive ||
    identity.accountState === 'deactivated' ||
    identity.accountState === 'suspended'
  ) {
    await burnTimeLikeAVerify(password);
    await log('bad_password', identity.userId);
    return generic;
  }

  /* ---- 2 · the lock, BEFORE the password -------------------------------
   * ⚠️ Lockout arithmetic uses `dbNow`, NOT `now` (registry C-19). Every
   * timestamp in `attempts` was written by the database's clock, and the two
   * machines are not in step — 22 seconds of skew measured here. Comparing
   * database timestamps against the app's clock made every fresh failure look
   * future-dated, so evaluateLockout discarded them and the lock never tripped.
   *
   * `now` is still correct for everything the app itself times: the Argon2
   * decision, the temporary-password expiry, the session lifetimes. */
  const since = new Date(now - 24 * 60 * 60 * 1000);
  const { attempts, clearedAt, now: dbNow } = await getLockoutInputs(identity.userId, since);
  const lock = evaluateLockout(attempts, dbNow, { clearedAt });

  if (lock.isLocked) {
    // Recorded, but this does NOT extend the lock — evaluateLockout ignores
    // `locked` outcomes precisely so it cannot be used to hold someone out.
    await log('locked', identity.userId);
    await setLock(identity.userId, new Date(lock.lockedAt ?? dbNow));
    return {
      error: failureMessage(lock),
      locked: true,
      unlockInMinutes: minutesUntilUnlock(lock, dbNow),
      email,
    };
  }

  /* The cached state can be stale — a lock may have auto-cleared since the last
     attempt. The append-only ledger is the truth; reconcile the cache to it. */
  if (identity.lockedAt && !lock.isLocked) {
    await setLock(identity.userId, null);
  }

  /* ---- 3 · verify ------------------------------------------------------- */
  const passwordOk = await verifyPassword(identity.passwordHash, password);

  if (!passwordOk) {
    await log('bad_password', identity.userId);

    const after = evaluateLockout([...attempts, { outcome: 'bad_password', at: dbNow }], dbNow, {
      clearedAt,
    });
    if (after.isLocked) {
      await setLock(identity.userId, new Date(after.lockedAt ?? dbNow));
      return {
        error: failureMessage(after),
        locked: true,
        unlockInMinutes: minutesUntilUnlock(after, dbNow),
        email,
      };
    }
    return { error: failureMessage(after), email };
  }

  /* An expired temporary password (doc 16 §3 Option B) is no longer a
     credential, even though it verified. */
  if (
    identity.isTemporaryPassword &&
    identity.temporaryExpiresAt &&
    identity.temporaryExpiresAt.getTime() <= now
  ) {
    await log('bad_password', identity.userId);
    return generic;
  }

  /* ---- 4 · MFA — FR-145, before any session exists --------------------- */
  const factors = await getVerifiedFactors(identity.userId);
  const mfaMandatory = MFA_REQUIRED_ROLES.includes(identity.role);

  if (factors.length > 0) {
    if (!totpCode) {
      // The password was already correct, so asking for the code now reveals
      // nothing that step 3 did not.
      return { mfaRequired: true, email };
    }

    const totp = factors.find((f) => f.type === 'totp' && f.secretEncrypted);
    const accepted = totp ? verifyTotp(totp.secretEncrypted as string, totpCode, now) : false;

    if (!accepted) {
      // Counts toward the lockout. FR-148's rate limit has to cover the second
      // factor too, or MFA becomes an unlimited six-digit guessing game.
      await log('bad_mfa', identity.userId);
      const after = evaluateLockout([...attempts, { outcome: 'bad_mfa', at: dbNow }], dbNow, {
        clearedAt,
      });
      if (after.isLocked) {
        await setLock(identity.userId, new Date(after.lockedAt ?? dbNow));
        return { error: failureMessage(after), locked: true, email };
      }
      return { error: 'That code was not accepted.', mfaRequired: true, email };
    }
  } else if (mfaMandatory) {
    /* A privileged account with no verified factor is signed in only as far as
       the enrolment screen (FR-145). Enforced there rather than by withholding
       the session, because there is no way to enrol without one. */
    await log('success', identity.userId);
    await recordLogin(identity.userId);
    await issueSession(identity.userId, identity.role, facts, now);
    redirect('/mfa-setup');
  }

  /* ---- 5 · success ----------------------------------------------------- */
  await log('success', identity.userId);
  await recordLogin(identity.userId);

  /* doc 16 §4 — rehash transparently when the parameters are upgraded. This is
     the only moment the plaintext exists, so it is the only moment it can run. */
  if (needsRehash(identity.passwordHash)) {
    await setPassword(identity.userId, await hashPassword(password));
  }

  await issueSession(identity.userId, identity.role, facts, now);

  redirect(
    identity.isTemporaryPassword || identity.accountState === 'password_reset_required'
      ? '/profile'
      : identity.role === 'member'
        ? '/my-work'
        : '/dashboard',
  );
}
