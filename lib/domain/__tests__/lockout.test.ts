import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCKOUT_SETTINGS,
  evaluateLockout,
  failureMessage,
  minutesUntilUnlock,
  type LoginAttempt,
} from '../lockout';

/* ============================================================================
 * ACCOUNT LOCKOUT — FR-148, FR-155a, ADR-007
 * ----------------------------------------------------------------------------
 * The interesting cases are all boundaries and all adversarial: the instant the
 * lock clears, the instant before, and the several ways an attacker could try
 * to keep someone locked out. None of them are testable at all if the code
 * reads the clock internally — which is why `now` is a parameter (doc 20 §5).
 * ========================================================================= */

/** A fixed instant. Deliberately not Date.now(): these tests must not drift. */
const T0 = 1_775_000_000_000;
const MINUTE = 60_000;

const at = (minutes: number) => T0 + minutes * MINUTE;
const fail = (minutes: number): LoginAttempt => ({ outcome: 'bad_password', at: at(minutes) });
const ok = (minutes: number): LoginAttempt => ({ outcome: 'success', at: at(minutes) });
const blocked = (minutes: number): LoginAttempt => ({ outcome: 'locked', at: at(minutes) });

describe('counting up to the lock', () => {
  it('an account with no history is not locked', () => {
    const state = evaluateLockout([], at(0));
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(0);
    expect(state.attemptsRemaining).toBe(3);
    expect(state.warnBeforeLock).toBe(false);
  });

  it('one failure leaves two attempts', () => {
    const state = evaluateLockout([fail(0)], at(1));
    expect(state.isLocked).toBe(false);
    expect(state.attemptsRemaining).toBe(2);
    expect(state.warnBeforeLock).toBe(false);
  });

  it('two failures warn before the third locks — FR-148', () => {
    const state = evaluateLockout([fail(0), fail(1)], at(2));
    expect(state.isLocked).toBe(false);
    expect(state.attemptsRemaining).toBe(1);
    expect(state.warnBeforeLock).toBe(true);
    expect(failureMessage(state)).toContain('One attempt remains');
  });

  it('three failures lock the account', () => {
    const state = evaluateLockout([fail(0), fail(1), fail(2)], at(3));
    expect(state.isLocked).toBe(true);
    expect(state.attemptsRemaining).toBe(0);
    expect(state.lockedAt).toBe(at(2));
    expect(state.unlocksAt).toBe(at(2 + 30));
  });

  it('a failed MFA code counts the same as a failed password', () => {
    const attempts: LoginAttempt[] = [
      { outcome: 'bad_password', at: at(0) },
      { outcome: 'bad_mfa', at: at(1) },
      { outcome: 'bad_mfa', at: at(2) },
    ];
    expect(evaluateLockout(attempts, at(3)).isLocked).toBe(true);
  });

  it('an attempt on an address with no account never locks anything', () => {
    const attempts: LoginAttempt[] = Array.from({ length: 10 }, (_, i) => ({
      outcome: 'unknown_account' as const,
      at: at(i),
    }));
    expect(evaluateLockout(attempts, at(11)).isLocked).toBe(false);
  });
});

describe('a success wipes the slate', () => {
  it('resets the count', () => {
    const state = evaluateLockout([fail(0), fail(1), ok(2)], at(3));
    expect(state.failures).toBe(0);
    expect(state.attemptsRemaining).toBe(3);
  });

  it('only failures AFTER the last success count', () => {
    const state = evaluateLockout([fail(0), fail(1), ok(2), fail(3), fail(4)], at(5));
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(2);
  });

  it('two before and three after still locks', () => {
    const state = evaluateLockout([fail(0), fail(1), ok(2), fail(3), fail(4), fail(5)], at(6));
    expect(state.isLocked).toBe(true);
    expect(state.lockedAt).toBe(at(5));
  });
});

describe('the 30-minute auto-clear — Q-048', () => {
  const locked: LoginAttempt[] = [fail(0), fail(1), fail(2)];

  it('is still locked one millisecond before the clear', () => {
    expect(evaluateLockout(locked, at(32) - 1).isLocked).toBe(true);
  });

  it('is unlocked exactly at the clear', () => {
    const state = evaluateLockout(locked, at(32));
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(0);
    expect(state.attemptsRemaining).toBe(3);
  });

  it('stays unlocked afterwards', () => {
    expect(evaluateLockout(locked, at(120)).isLocked).toBe(false);
  });

  it('reports the minutes remaining, rounded up', () => {
    const state = evaluateLockout(locked, at(2));
    expect(minutesUntilUnlock(state, at(2))).toBe(30);
    expect(minutesUntilUnlock(state, at(17))).toBe(15);
    expect(minutesUntilUnlock(state, at(31.5))).toBe(1);
  });

  it('reports null when the account is not locked', () => {
    expect(minutesUntilUnlock(evaluateLockout([], at(0)), at(0))).toBeNull();
  });
});

/* ==========================================================================
 * The anti-DoS properties — doc 16 §4
 * ==========================================================================
 * A three-strike lock is trivial to trigger against a known email address.
 * These are the tests that prove someone cannot use it to hold a colleague out.
 */

describe('an attacker cannot hold the lock open', () => {
  it('attempts refused while locked do NOT extend the lock', () => {
    const attempts: LoginAttempt[] = [
      fail(0),
      fail(1),
      fail(2), // locks, clears at minute 32
      blocked(10),
      blocked(20),
      blocked(31), // hammering right up to the boundary
    ];
    // Anchored to the third FAILURE, not the last attempt, so it still clears.
    expect(evaluateLockout(attempts, at(32)).isLocked).toBe(false);
  });

  it('further password guesses while locked do not extend it either', () => {
    const attempts: LoginAttempt[] = [fail(0), fail(1), fail(2), fail(20), fail(31)];
    const state = evaluateLockout(attempts, at(32));
    expect(state.isLocked).toBe(false);
    expect(state.lockedAt).toBeNull();
  });

  it('the lock is anchored to the third failure, not the most recent one', () => {
    const attempts: LoginAttempt[] = [fail(0), fail(1), fail(2), fail(25)];
    expect(evaluateLockout(attempts, at(3)).lockedAt).toBe(at(2));
  });
});

describe('an explicit unlock', () => {
  const attempts: LoginAttempt[] = [fail(0), fail(1), fail(2)];

  it('discards every failure that came before it', () => {
    const state = evaluateLockout(attempts, at(5), { clearedAt: at(3) });
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(0);
  });

  it('does not protect against failures that come after it', () => {
    const after: LoginAttempt[] = [...attempts, fail(4), fail(5), fail(6)];
    const state = evaluateLockout(after, at(7), { clearedAt: at(3) });
    expect(state.isLocked).toBe(true);
    expect(state.lockedAt).toBe(at(6));
  });
});

describe('input robustness', () => {
  it('does not care what order the attempts arrive in', () => {
    const shuffled: LoginAttempt[] = [fail(2), ok(1), fail(0)];
    const state = evaluateLockout(shuffled, at(3));
    // Sorted: fail(0), ok(1), fail(2) — one failure since the success.
    expect(state.failures).toBe(1);
  });

  it('ignores attempts dated in the future', () => {
    const state = evaluateLockout([fail(0), fail(1), fail(99)], at(2));
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(2);
  });

  it('is deterministic', () => {
    const attempts: LoginAttempt[] = [fail(0), fail(1), fail(2)];
    const first = evaluateLockout(attempts, at(5));
    for (let i = 0; i < 20; i += 1) {
      expect(evaluateLockout(attempts, at(5))).toEqual(first);
    }
  });

  it('does not mutate the array it is given', () => {
    const attempts: LoginAttempt[] = [fail(2), fail(0), fail(1)];
    const snapshot = [...attempts];
    evaluateLockout(attempts, at(3));
    expect(attempts).toEqual(snapshot);
  });

  it('honours a non-default threshold', () => {
    const settings = { failedLoginsToLock: 5, autoClearMinutes: 10 };
    const four: LoginAttempt[] = [fail(0), fail(1), fail(2), fail(3)];
    expect(evaluateLockout(four, at(4), { settings }).isLocked).toBe(false);
    expect(evaluateLockout([...four, fail(4)], at(5), { settings }).isLocked).toBe(true);
  });

  it('treats a threshold below 1 as 1 rather than locking instantly on zero', () => {
    const settings = { failedLoginsToLock: 0, autoClearMinutes: 30 };
    expect(evaluateLockout([], at(0), { settings }).isLocked).toBe(false);
    expect(evaluateLockout([fail(0)], at(1), { settings }).isLocked).toBe(true);
  });
});

describe('FR-155e — messages never reveal whether an account exists', () => {
  it('the ordinary refusal is generic', () => {
    expect(failureMessage(evaluateLockout([], at(0)))).toBe('Invalid email or password.');
  });

  it('no message names the account or the person', () => {
    const states = [
      evaluateLockout([], at(0)),
      evaluateLockout([fail(0), fail(1)], at(2)),
      evaluateLockout([fail(0), fail(1), fail(2)], at(3)),
    ];
    for (const state of states) {
      const message = failureMessage(state);
      expect(message).not.toMatch(/@/);
      expect(message.toLowerCase()).not.toContain('user');
      expect(message.toLowerCase()).not.toContain('exists');
    }
  });
});

describe('the defaults match the specification', () => {
  it('locks after 3 and clears after 30 minutes — ADR-007, Q-048', () => {
    expect(DEFAULT_LOCKOUT_SETTINGS.failedLoginsToLock).toBe(3);
    expect(DEFAULT_LOCKOUT_SETTINGS.autoClearMinutes).toBe(30);
  });
});
