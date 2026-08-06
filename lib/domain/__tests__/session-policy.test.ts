import { describe, expect, it } from 'vitest';

import { ROLES, SYSTEM_DEFAULTS, type Role } from '../constants';
import {
  absoluteCapMinutes,
  contextChangeOutcome,
  detectContextChanges,
  evaluateSession,
  idleTimeoutMinutes,
  isStepUpValid,
  maxConcurrentSessions,
  refreshTtlMinutes,
  sessionLifetimes,
  slideExpiry,
  type SessionSnapshot,
} from '../session-policy';

/* ============================================================================
 * SESSION POLICY — FR-149, FR-150, doc 16 §4
 * ========================================================================= */

const T0 = 1_775_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    role: 'member',
    createdAt: T0,
    lastSeenAt: T0,
    expiresAt: T0 + 7 * DAY,
    absoluteExpiresAt: T0 + 30 * DAY,
    revokedAt: null,
    reuseDetectedAt: null,
    stepUpVerifiedAt: null,
    deviceFingerprint: 'device-a',
    ipCountry: 'PK',
    ipAsn: 'AS17557',
    ...overrides,
  };
}

/* ==========================================================================
 * The table in doc 16 §4
 * ========================================================================== */

describe('lifetimes are scoped to privilege — doc 16 §4', () => {
  it('refresh: Super Admin 8h · Admin 24h · others 7d', () => {
    expect(refreshTtlMinutes('super_admin')).toBe(8 * 60);
    expect(refreshTtlMinutes('admin')).toBe(24 * 60);
    expect(refreshTtlMinutes('team_coordinator')).toBe(7 * 24 * 60);
    expect(refreshTtlMinutes('member')).toBe(7 * 24 * 60);
  });

  it('absolute cap: Super Admin 12h · others 30d', () => {
    expect(absoluteCapMinutes('super_admin')).toBe(12 * 60);
    for (const role of ['admin', 'team_coordinator', 'member'] as Role[]) {
      expect(absoluteCapMinutes(role)).toBe(30 * 24 * 60);
    }
  });

  it('idle timeout: Super Admin 30m · Admin 2h · others none', () => {
    expect(idleTimeoutMinutes('super_admin')).toBe(30);
    expect(idleTimeoutMinutes('admin')).toBe(120);
    expect(idleTimeoutMinutes('team_coordinator')).toBeNull();
    expect(idleTimeoutMinutes('member')).toBeNull();
  });

  it('concurrent sessions: Super Admin 2 · others unlimited', () => {
    expect(maxConcurrentSessions('super_admin')).toBe(2);
    for (const role of ['admin', 'team_coordinator', 'member'] as Role[]) {
      expect(maxConcurrentSessions(role)).toBeNull();
    }
  });

  it('every role gets a shorter window than the one below it', () => {
    expect(refreshTtlMinutes('super_admin')).toBeLessThan(refreshTtlMinutes('admin'));
    expect(refreshTtlMinutes('admin')).toBeLessThan(refreshTtlMinutes('member'));
    expect(absoluteCapMinutes('super_admin')).toBeLessThan(absoluteCapMinutes('member'));
  });
});

describe('sessionLifetimes', () => {
  it.each(ROLES)('%s gets a sliding window inside its hard cap', (role) => {
    const life = sessionLifetimes(role, T0);
    expect(life.refreshExpiresAt).toBeGreaterThan(T0);
    expect(life.refreshExpiresAt).toBeLessThanOrEqual(life.absoluteExpiresAt);
  });

  it('the Super Admin gets 8h inside a 12h cap', () => {
    const life = sessionLifetimes('super_admin', T0);
    expect(life.refreshExpiresAt).toBe(T0 + 8 * HOUR);
    expect(life.absoluteExpiresAt).toBe(T0 + 12 * HOUR);
    expect(life.idleTimeoutMinutes).toBe(30);
    expect(life.maxConcurrent).toBe(2);
  });

  it('a Member gets 7d inside a 30d cap and no idle timeout', () => {
    const life = sessionLifetimes('member', T0);
    expect(life.refreshExpiresAt).toBe(T0 + 7 * DAY);
    expect(life.absoluteExpiresAt).toBe(T0 + 30 * DAY);
    expect(life.idleTimeoutMinutes).toBeNull();
    expect(life.maxConcurrent).toBeNull();
  });
});

/* ==========================================================================
 * Validity
 * ========================================================================== */

describe('evaluateSession', () => {
  it('a fresh session is usable', () => {
    expect(evaluateSession(session(), T0 + MINUTE)).toEqual({
      usable: true,
      reason: null,
      revokeAllSessions: false,
    });
  });

  it('is usable one millisecond before expiry and dead at it', () => {
    const s = session({ expiresAt: T0 + HOUR });
    expect(evaluateSession(s, T0 + HOUR - 1).usable).toBe(true);
    expect(evaluateSession(s, T0 + HOUR).usable).toBe(false);
    expect(evaluateSession(s, T0 + HOUR).reason).toBe('expired');
  });

  it('refuses a revoked session', () => {
    const verdict = evaluateSession(session({ revokedAt: T0 }), T0 + MINUTE);
    expect(verdict.reason).toBe('revoked');
    expect(verdict.revokeAllSessions).toBe(false);
  });

  it('the absolute cap ends a session even while the sliding window is open', () => {
    const s = session({ expiresAt: T0 + 30 * DAY, absoluteExpiresAt: T0 + HOUR });
    const verdict = evaluateSession(s, T0 + HOUR + 1);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe('absolute_cap_reached');
  });

  it('FR-150 — token reuse kills every session on the account', () => {
    const verdict = evaluateSession(session({ reuseDetectedAt: T0 }), T0 + MINUTE);
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe('reuse_detected');
    expect(verdict.revokeAllSessions).toBe(true);
  });

  it('reports reuse ahead of revocation — it is the more serious answer', () => {
    const s = session({ reuseDetectedAt: T0, revokedAt: T0 });
    expect(evaluateSession(s, T0 + MINUTE).reason).toBe('reuse_detected');
  });

  it('reports reuse even on an expired session, so the alarm is not lost', () => {
    const s = session({ reuseDetectedAt: T0, expiresAt: T0 - 1 });
    const verdict = evaluateSession(s, T0 + MINUTE);
    expect(verdict.reason).toBe('reuse_detected');
    expect(verdict.revokeAllSessions).toBe(true);
  });
});

describe('idle timeout', () => {
  it("ends the Super Admin's session after 30 minutes of inactivity", () => {
    const s = session({ role: 'super_admin', lastSeenAt: T0, expiresAt: T0 + 8 * HOUR });
    expect(evaluateSession(s, T0 + 29 * MINUTE).usable).toBe(true);
    expect(evaluateSession(s, T0 + 30 * MINUTE).reason).toBe('idle_timeout');
  });

  it("ends an Admin's after two hours", () => {
    const s = session({ role: 'admin', lastSeenAt: T0, expiresAt: T0 + 24 * HOUR });
    expect(evaluateSession(s, T0 + 119 * MINUTE).usable).toBe(true);
    expect(evaluateSession(s, T0 + 120 * MINUTE).reason).toBe('idle_timeout');
  });

  it.each(['team_coordinator', 'member'] as Role[])('never idles out a %s', (role) => {
    const s = session({ role, lastSeenAt: T0, expiresAt: T0 + 7 * DAY });
    expect(evaluateSession(s, T0 + 6 * DAY).usable).toBe(true);
  });
});

describe('slideExpiry', () => {
  it('extends the window from now', () => {
    const s = session({ role: 'admin' });
    expect(slideExpiry(s, T0 + HOUR)).toBe(T0 + HOUR + 24 * HOUR);
  });

  it('never pushes past the absolute cap — otherwise the cap means nothing', () => {
    const s = session({ role: 'super_admin', absoluteExpiresAt: T0 + 12 * HOUR });
    // 11h in, an 8h slide would reach 19h. It must clamp to 12h.
    expect(slideExpiry(s, T0 + 11 * HOUR)).toBe(T0 + 12 * HOUR);
  });

  it('a session refreshed forever still dies at the cap', () => {
    const s = session({ role: 'super_admin', absoluteExpiresAt: T0 + 12 * HOUR });
    let now = T0;
    for (let i = 0; i < 100; i += 1) {
      now += 10 * MINUTE;
      const next = slideExpiry(s, now);
      expect(next).toBeLessThanOrEqual(s.absoluteExpiresAt);
    }
    expect(evaluateSession(s, T0 + 12 * HOUR).usable).toBe(false);
  });
});

/* ==========================================================================
 * Step-up — FR-149
 * ========================================================================== */

describe('isStepUpValid', () => {
  it('a session that has never re-authenticated does not qualify', () => {
    expect(isStepUpValid(null, T0)).toBe(false);
  });

  it('holds for ten minutes and no longer', () => {
    expect(isStepUpValid(T0, T0)).toBe(true);
    expect(isStepUpValid(T0, T0 + 10 * MINUTE - 1)).toBe(true);
    expect(isStepUpValid(T0, T0 + 10 * MINUTE)).toBe(false);
  });

  it('refuses a timestamp in the future — a clock problem or tampering', () => {
    expect(isStepUpValid(T0 + MINUTE, T0)).toBe(false);
  });

  it('matches the configured validity window', () => {
    expect(SYSTEM_DEFAULTS.stepUpValidityMinutes).toBe(10);
    expect(isStepUpValid(T0, T0 + 4 * MINUTE, 5)).toBe(true);
    expect(isStepUpValid(T0, T0 + 5 * MINUTE, 5)).toBe(false);
  });
});

/* ==========================================================================
 * Zero trust — doc 16 §4
 * ========================================================================== */

describe('detectContextChanges', () => {
  const base = { deviceFingerprint: 'device-a', ipCountry: 'PK', ipAsn: 'AS17557' };

  it('sees nothing when nothing changed', () => {
    expect(detectContextChanges(session(), base)).toEqual([]);
  });

  it('spots a different device', () => {
    expect(detectContextChanges(session(), { ...base, deviceFingerprint: 'device-b' })).toEqual([
      'device',
    ]);
  });

  it('spots a different country and a different network', () => {
    expect(detectContextChanges(session(), { ...base, ipCountry: 'AE' })).toEqual(['country']);
    expect(detectContextChanges(session(), { ...base, ipAsn: 'AS9541' })).toEqual(['asn']);
  });

  it('treats an unknown value as unknown, not as a change', () => {
    // Otherwise every request the geo lookup cannot place would force re-auth,
    // which trains people to expect it and defeats the control.
    expect(detectContextChanges(session(), { ...base, ipCountry: null })).toEqual([]);
    expect(detectContextChanges(session({ ipAsn: null }), base)).toEqual([]);
  });

  it('reports several changes at once', () => {
    const changes = detectContextChanges(session(), {
      deviceFingerprint: 'device-b',
      ipCountry: 'AE',
      ipAsn: 'AS9541',
    });
    expect(changes).toEqual(['device', 'country', 'asn']);
  });
});

describe('contextChangeOutcome', () => {
  it('a device mismatch rejects the session outright — FR-150', () => {
    expect(contextChangeOutcome(['device'])).toEqual({ reject: true, requireReauth: true });
  });

  it('a country or network change only demands re-authentication', () => {
    // People travel, and mobile networks move between ASNs mid-session.
    expect(contextChangeOutcome(['country'])).toEqual({ reject: false, requireReauth: true });
    expect(contextChangeOutcome(['asn'])).toEqual({ reject: false, requireReauth: true });
  });

  it('no change means no interruption', () => {
    expect(contextChangeOutcome([])).toEqual({ reject: false, requireReauth: false });
  });
});

describe('doc 20 §5 — determinism', () => {
  it('gives the same verdict every time', () => {
    const s = session({ role: 'admin', lastSeenAt: T0 });
    const first = evaluateSession(s, T0 + HOUR);
    for (let i = 0; i < 20; i += 1) {
      expect(evaluateSession(s, T0 + HOUR)).toEqual(first);
    }
  });

  it('does not mutate the session it is given', () => {
    const s = session();
    const snapshot = JSON.stringify(s);
    evaluateSession(s, T0 + HOUR);
    slideExpiry(s, T0 + HOUR);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
