/* ============================================================================
 * SESSION POLICY — FR-149, FR-150, doc 16 §4
 * ----------------------------------------------------------------------------
 * ⛔ LAYER 2 (Domain). Pure and deterministic — `now` is always a parameter,
 *    never read from the clock. doc 20 §5.
 *
 * That constraint is what makes any of this testable. Session expiry is a pile
 * of boundary conditions — the instant before, the instant of, the instant
 * after, across an idle timeout, across an absolute cap — and none of them can
 * be tested at all if the code reads `Date.now()` internally.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PRIVILEGE DETERMINES EXPOSURE (doc 16 §4)
 *
 *                     refresh    absolute cap    idle       concurrent
 *   Super Admin        8h            12h          30m           2
 *   Admin             24h            30d           2h        unlimited
 *   Coordinator        7d            30d         none         unlimited
 *   Member             7d            30d         none         unlimited
 *
 * A Member's stolen cookie is worth one person's task list. The Super Admin's
 * is worth the company, so his window is hours and his idle timeout is half an
 * hour. The asymmetry is the control.
 * ========================================================================= */

import { SYSTEM_DEFAULTS, type Role } from './constants';

const MINUTE = 60_000;

export interface SessionLifetimes {
  /** Sliding expiry, extended on each refresh. */
  readonly refreshExpiresAt: number;
  /** Hard ceiling. No session outlives this, however active. */
  readonly absoluteExpiresAt: number;
  /** Minutes of inactivity before the session dies. Null = no idle timeout. */
  readonly idleTimeoutMinutes: number | null;
  /** Maximum simultaneous sessions. Null = unlimited. */
  readonly maxConcurrent: number | null;
}

export function refreshTtlMinutes(role: Role): number {
  switch (role) {
    case 'super_admin':
      return SYSTEM_DEFAULTS.refreshTtlSuperAdminMinutes;
    case 'admin':
      return SYSTEM_DEFAULTS.refreshTtlAdminMinutes;
    default:
      return SYSTEM_DEFAULTS.refreshTtlDefaultMinutes;
  }
}

export function absoluteCapMinutes(role: Role): number {
  return role === 'super_admin'
    ? SYSTEM_DEFAULTS.absoluteSessionCapSuperAdminMinutes
    : SYSTEM_DEFAULTS.absoluteSessionCapDefaultMinutes;
}

export function idleTimeoutMinutes(role: Role): number | null {
  switch (role) {
    case 'super_admin':
      return SYSTEM_DEFAULTS.idleTimeoutSuperAdminMinutes;
    case 'admin':
      return SYSTEM_DEFAULTS.idleTimeoutAdminMinutes;
    default:
      return SYSTEM_DEFAULTS.idleTimeoutDefaultMinutes;
  }
}

export function maxConcurrentSessions(role: Role): number | null {
  return role === 'super_admin'
    ? SYSTEM_DEFAULTS.maxConcurrentSessionsSuperAdmin
    : SYSTEM_DEFAULTS.maxConcurrentSessionsDefault;
}

/** The lifetimes to stamp on a session at sign-in. */
export function sessionLifetimes(role: Role, issuedAt: number): SessionLifetimes {
  const absoluteExpiresAt = issuedAt + absoluteCapMinutes(role) * MINUTE;
  // The sliding window can never exceed the hard cap, even at issue — for the
  // Super Admin, 8h refresh against a 12h cap, so the first window fits; the
  // clamp matters once the cap is close.
  const refreshExpiresAt = Math.min(issuedAt + refreshTtlMinutes(role) * MINUTE, absoluteExpiresAt);

  return {
    refreshExpiresAt,
    absoluteExpiresAt,
    idleTimeoutMinutes: idleTimeoutMinutes(role),
    maxConcurrent: maxConcurrentSessions(role),
  };
}

/* ==========================================================================
 * Validity
 * ========================================================================== */

/** The fields this layer needs. Not the database row — layer 1 owns that. */
export interface SessionSnapshot {
  readonly role: Role;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly revokedAt: number | null;
  readonly reuseDetectedAt: number | null;
  readonly stepUpVerifiedAt: number | null;
  readonly deviceFingerprint: string;
  readonly ipCountry: string | null;
  readonly ipAsn: string | null;
}

export type SessionRefusal =
  | 'revoked'
  | 'reuse_detected'
  | 'expired'
  | 'absolute_cap_reached'
  | 'idle_timeout';

export interface SessionVerdict {
  readonly usable: boolean;
  readonly reason: SessionRefusal | null;
  /** True when the whole account's sessions must die, not just this one. */
  readonly revokeAllSessions: boolean;
}

/**
 * Is this session still usable?
 *
 * Checked in order of severity, because the first answer is the one acted on
 * and `reuse_detected` demands a bigger response than the rest.
 */
export function evaluateSession(session: SessionSnapshot, now: number): SessionVerdict {
  /* FR-150 · a refresh token presented after it was already rotated away was
     copied. The session that presented it is not the problem — the copy is —
     so every session on the account dies, not just this one. */
  if (session.reuseDetectedAt !== null) {
    return { usable: false, reason: 'reuse_detected', revokeAllSessions: true };
  }

  if (session.revokedAt !== null) {
    return { usable: false, reason: 'revoked', revokeAllSessions: false };
  }

  if (now >= session.absoluteExpiresAt) {
    return { usable: false, reason: 'absolute_cap_reached', revokeAllSessions: false };
  }

  if (now >= session.expiresAt) {
    return { usable: false, reason: 'expired', revokeAllSessions: false };
  }

  const idle = idleTimeoutMinutes(session.role);
  if (idle !== null && now - session.lastSeenAt >= idle * MINUTE) {
    return { usable: false, reason: 'idle_timeout', revokeAllSessions: false };
  }

  return { usable: true, reason: null, revokeAllSessions: false };
}

/**
 * The new sliding expiry after a successful refresh, clamped to the hard cap.
 *
 * The clamp is the point: without it, a session that is refreshed often enough
 * never ends, and "absolute cap" would mean nothing.
 */
export function slideExpiry(session: SessionSnapshot, now: number): number {
  return Math.min(now + refreshTtlMinutes(session.role) * MINUTE, session.absoluteExpiresAt);
}

/* ==========================================================================
 * Step-up re-authentication — FR-149
 * ========================================================================== */

/**
 * Has this session re-authenticated recently enough for a 🔒 action?
 *
 * Ten minutes (SYSTEM_DEFAULTS.stepUpValidityMinutes). Long enough to complete
 * a sequence of privileged actions without re-entering credentials each time,
 * short enough that a screen left unattended is not an open door.
 *
 * Which actions demand it is `requiresStepUp()` in permissions.ts. This answers
 * only whether the session currently satisfies it.
 */
export function isStepUpValid(
  stepUpVerifiedAt: number | null,
  now: number,
  validityMinutes: number = SYSTEM_DEFAULTS.stepUpValidityMinutes,
): boolean {
  if (stepUpVerifiedAt === null) return false;
  // A timestamp in the future is a clock problem or tampering. Refuse it —
  // treating it as valid would make step-up trivially bypassable.
  if (stepUpVerifiedAt > now) return false;
  return now - stepUpVerifiedAt < validityMinutes * MINUTE;
}

/* ==========================================================================
 * Zero trust: verify on context change — doc 16 §4, NIST SP 800-207
 * ========================================================================== */

export interface RequestContext {
  readonly deviceFingerprint: string;
  readonly ipCountry: string | null;
  readonly ipAsn: string | null;
}

export type ContextChange = 'device' | 'country' | 'asn';

/**
 * What changed between the session's bound context and this request.
 *
 * A device change is the serious one: FR-150 binds a session to a device
 * precisely so a cookie replayed from another machine is not a session. Country
 * and ASN changes force re-authentication rather than outright rejection —
 * people travel, and mobile networks move between ASNs mid-session.
 *
 * A NULL on either side is "not known", not "changed". Treating unknown as a
 * change would force re-auth on every request from an IP the geo lookup could
 * not place, which trains people to expect it and defeats the control.
 */
export function detectContextChanges(
  session: SessionSnapshot,
  request: RequestContext,
): ContextChange[] {
  const changes: ContextChange[] = [];

  if (session.deviceFingerprint !== request.deviceFingerprint) changes.push('device');
  if (differs(session.ipCountry, request.ipCountry)) changes.push('country');
  if (differs(session.ipAsn, request.ipAsn)) changes.push('asn');

  return changes;
}

/** A device mismatch kills the session; the others demand re-authentication. */
export function contextChangeOutcome(changes: readonly ContextChange[]): {
  readonly reject: boolean;
  readonly requireReauth: boolean;
} {
  if (changes.includes('device')) return { reject: true, requireReauth: true };
  return { reject: false, requireReauth: changes.length > 0 };
}

function differs(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a !== b;
}
