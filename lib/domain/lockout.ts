/* ============================================================================
 * ACCOUNT LOCKOUT — FR-148, FR-155a, ADR-007
 * ----------------------------------------------------------------------------
 * ⛔ LAYER 2 (Domain). Pure, deterministic, `now` always a parameter. doc 20 §1.
 *
 *   "Three failed sign-in attempts locks the account. Cleared by an emailed
 *    unlock code, or by an Admin for Coordinators and Members. Auto-clears
 *    after 30 minutes."                              — doc 16 §6, ADR-007
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LOCK IS DERIVED, NOT COUNTED
 *
 * There is no `failed_login_count` column, deliberately. A counter is a number
 * any code path can reset, and the one that matters — "failures since this
 * account last succeeded" — is a question a counter cannot answer after the
 * fact. `login_attempts` is append-only (migration 003), so the ledger cannot
 * be quietly rewritten, and the answer is always recomputable from it.
 *
 * `users.locked_at` still exists and is still written, because the account
 * STATE has to be readable without replaying history — but it is a cache of
 * this function's answer, never the source of it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY ONLY SOME OUTCOMES COUNT
 *
 * doc 16 §4 names the risk plainly: a 3-strike lock is trivial for an outsider
 * to trigger against a known email address. Three defences, and two of them
 * live here:
 *
 *   · `locked` attempts do NOT extend the lock. Otherwise anyone who knows the
 *     address can hold a colleague out permanently by hammering it — the lock
 *     would renew itself for as long as the attacker kept trying.
 *   · the lock auto-clears 30 minutes after the failure that caused it, not
 *     30 minutes after the last attempt, for the same reason.
 *   · per-IP throttling (layer 3) cuts an attacker off long before they can
 *     cycle through accounts.
 * ========================================================================= */

import { SYSTEM_DEFAULTS } from './constants';

/** The outcomes recorded in `login_attempts`. Mirrors the DB enum. */
export type LoginOutcome = 'success' | 'bad_password' | 'bad_mfa' | 'locked' | 'unknown_account';

export interface LoginAttempt {
  readonly outcome: LoginOutcome;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface LockoutSettings {
  readonly failedLoginsToLock: number;
  readonly autoClearMinutes: number;
}

export const DEFAULT_LOCKOUT_SETTINGS: LockoutSettings = {
  failedLoginsToLock: SYSTEM_DEFAULTS.failedLoginsToLock,
  autoClearMinutes: SYSTEM_DEFAULTS.accountLockAutoClearMinutes,
};

export interface LockoutState {
  /** Is the account locked right now? */
  readonly isLocked: boolean;
  /** Consecutive credential failures since the last success or unlock. */
  readonly failures: number;
  /** How many more failures before the lock trips. 0 once locked. */
  readonly attemptsRemaining: number;
  /** When the lock tripped, or null. */
  readonly lockedAt: number | null;
  /** When it clears on its own, or null. */
  readonly unlocksAt: number | null;
  /**
   * FR-148's escalating message: attempt 2 warns before attempt 3 locks.
   * Deliberately not a full failure count — telling an attacker exactly how
   * many tries a real account has left is free reconnaissance.
   */
  readonly warnBeforeLock: boolean;
}

/**
 * Only these end a session of guessing. `locked` means the attempt was refused
 * before any credential was checked, so it says nothing about whether the
 * attacker is getting closer — and counting it would let them extend the lock
 * at will. `unknown_account` cannot belong to an existing account at all.
 */
function isCredentialFailure(outcome: LoginOutcome): boolean {
  return outcome === 'bad_password' || outcome === 'bad_mfa';
}

/**
 * Work out whether an account is locked, from its attempt history.
 *
 * `attempts` may arrive in any order; it is sorted here rather than trusting
 * the caller's query. `clearedAt` is the moment of the last successful unlock
 * (an emailed code redeemed, or an Admin unlocking a Coordinator or Member) —
 * failures before it are history and must not count again.
 */
export function evaluateLockout(
  attempts: readonly LoginAttempt[],
  now: number,
  options: {
    readonly settings?: LockoutSettings;
    /** Epoch ms of the last explicit unlock, if any. */
    readonly clearedAt?: number | null;
  } = {},
): LockoutState {
  const settings = options.settings ?? DEFAULT_LOCKOUT_SETTINGS;
  const clearedAt = options.clearedAt ?? null;

  const relevant = [...attempts]
    .filter((a) => a.at <= now)
    .filter((a) => (clearedAt === null ? true : a.at > clearedAt))
    .sort((a, b) => a.at - b.at);

  // Everything before the most recent success is spent.
  const lastSuccess = findLastIndex(relevant, (a) => a.outcome === 'success');
  const since = lastSuccess === -1 ? relevant : relevant.slice(lastSuccess + 1);

  const failures = since.filter((a) => isCredentialFailure(a.outcome));
  const threshold = Math.max(1, settings.failedLoginsToLock);

  if (failures.length < threshold) {
    return {
      isLocked: false,
      failures: failures.length,
      attemptsRemaining: threshold - failures.length,
      lockedAt: null,
      unlocksAt: null,
      warnBeforeLock: failures.length === threshold - 1,
    };
  }

  // The lock trips on the Nth failure — not the most recent one. Anchoring it
  // to the latest attempt is what would let an attacker hold the lock open.
  const lockedAt = failures[threshold - 1].at;
  const unlocksAt = lockedAt + settings.autoClearMinutes * 60_000;

  if (now >= unlocksAt) {
    // Auto-cleared. Failures after the lock tripped are ignored for the same
    // anti-DoS reason, so the account comes back with a clean slate.
    return {
      isLocked: false,
      failures: 0,
      attemptsRemaining: threshold,
      lockedAt: null,
      unlocksAt: null,
      warnBeforeLock: false,
    };
  }

  return {
    isLocked: true,
    failures: failures.length,
    attemptsRemaining: 0,
    lockedAt,
    unlocksAt,
    warnBeforeLock: false,
  };
}

/**
 * The message shown after a failed attempt.
 *
 * FR-155e and doc 16 §4: never reveal whether an account exists. Every variant
 * below is safe to show for an address that was never registered, which is why
 * the wording is about *this attempt* rather than *this account*.
 */
export function failureMessage(state: LockoutState): string {
  if (state.isLocked) {
    return 'This account has been locked after too many failed sign-in attempts.';
  }
  if (state.warnBeforeLock) {
    return 'Invalid email or password. One attempt remains before the account is locked.';
  }
  return 'Invalid email or password.';
}

/** Minutes until an auto-clear, rounded up. Null when not locked. */
export function minutesUntilUnlock(state: LockoutState, now: number): number | null {
  if (!state.isLocked || state.unlocksAt === null) return null;
  return Math.max(0, Math.ceil((state.unlocksAt - now) / 60_000));
}

/* -------------------------------------------------------------------------- */

/** Array.prototype.findLastIndex needs ES2023; this keeps the target low. */
function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i;
  }
  return -1;
}
