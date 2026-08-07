import 'server-only';

import type { Role } from '@/lib/domain/constants';
import type { LoginAttempt, LoginOutcome } from '@/lib/domain/lockout';
import type { InvitationPurpose } from '@/types/aliases';

import { withAppRole } from '../client';

/* ============================================================================
 * AUTH QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * Typed wrappers over the pre-authentication SECURITY DEFINER surface
 * (registry C-15). Every function here is a thin call into one `app.auth_*`
 * function and a shape conversion. There is no logic in this file on purpose:
 * decisions belong in lib/domain/, orchestration in the server action.
 *
 * All of it runs through `withAppRole` — as `cni_app`, with RLS active and no
 * identity. These paths work because the definer functions are the small,
 * individually reviewed set permitted to see across it.
 * ========================================================================= */

export interface FoundIdentity {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly accountState: string;
  readonly isActive: boolean;
  readonly lockedAt: Date | null;
  readonly passwordHash: string | null;
  readonly isTemporaryPassword: boolean;
  readonly temporaryExpiresAt: Date | null;
  readonly hasVerifiedMfa: boolean;
}

/**
 * Look up an account by email. Returns `null` for an unknown address rather
 * than throwing — FR-155e requires the caller to behave identically either way,
 * and an exception is a behavioural difference an attacker can measure.
 */
export async function findIdentity(email: string): Promise<FoundIdentity | null> {
  const rows = await withAppRole(
    (tx) => tx`select * from app.auth_find_identity(${email.trim().toLowerCase()})`,
  );
  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.user_id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    role: row.role as Role,
    accountState: row.account_state as string,
    isActive: row.is_active as boolean,
    lockedAt: (row.locked_at as Date | null) ?? null,
    passwordHash: (row.password_hash as string | null) ?? null,
    isTemporaryPassword: row.is_temporary_password as boolean,
    temporaryExpiresAt: (row.temporary_expires_at as Date | null) ?? null,
    hasVerifiedMfa: row.has_verified_mfa as boolean,
  };
}

/** Append to the append-only attempt ledger. Every attempt, including unknown addresses. */
export async function recordAttempt(input: {
  email: string;
  userId: string | null;
  outcome: LoginOutcome;
  ip?: string | null;
  ipCountry?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await withAppRole(
    (tx) => tx`
      select app.auth_record_attempt(
        ${input.email.trim().toLowerCase()},
        ${input.userId},
        ${input.outcome}::public.login_outcome,
        ${input.ip ?? null}::inet,
        ${input.ipCountry ?? null},
        ${input.userAgent ?? null}
      )
    `,
  );
}

/**
 * Everything `evaluateLockout()` needs, in one round trip.
 *
 * The RULE is not here. This returns the ledger and the last explicit unlock;
 * lib/domain/lockout.ts decides. Implementing "3 failures in 30 minutes" in SQL
 * as well would be two sources of truth for a security control.
 *
 * ⚠️ `now` COMES FROM THE DATABASE, and the caller must use it (registry C-19).
 *
 * Every timestamp here was written by `now()` on the database server. Comparing
 * them against the application server's clock is only safe if the two agree, and
 * they do not: measured 22 seconds of skew between this machine and Supabase.
 *
 * `evaluateLockout` discards future-dated attempts as a safety measure, so with
 * the database ahead, EVERY freshly recorded failure looks like it is in the
 * future and is thrown away — the counter never reaches three and the lockout
 * silently never trips. A security control that fails open under a few seconds
 * of clock drift is not a control.
 *
 * Returning the database's own clock removes the problem rather than tolerating
 * it: both sides of every comparison then come from the same source.
 */
export async function getLockoutInputs(
  userId: string,
  since: Date,
): Promise<{ attempts: LoginAttempt[]; clearedAt: number | null; now: number }> {
  return withAppRole(async (tx) => {
    const [attempts, unlock] = await Promise.all([
      tx`select outcome, created_at from app.auth_recent_attempts(${userId}, ${since})`,
      tx`
        select app.auth_last_unlock_at(${userId})     as at,
               extract(epoch from now()) * 1000       as now_ms
      `,
    ]);

    return {
      attempts: attempts.map((row) => ({
        outcome: row.outcome as LoginOutcome,
        at: new Date(row.created_at as string | Date).getTime(),
      })),
      clearedAt: unlock[0]?.at ? new Date(unlock[0].at as string | Date).getTime() : null,
      now: Number(unlock[0].now_ms),
    };
  });
}

/** Cache the lockout verdict on `users`. Pass null to clear. */
export async function setLock(userId: string, lockedAt: Date | null): Promise<void> {
  await withAppRole((tx) => tx`select app.auth_set_lock(${userId}, ${lockedAt})`);
}

/** Stamp `last_login_at`, and clear a lock that has since auto-expired. */
export async function recordLogin(userId: string): Promise<void> {
  await withAppRole((tx) => tx`select app.auth_record_login(${userId})`);
}

/* ==========================================================================
 * MFA
 * ========================================================================== */

export interface VerifiedFactor {
  readonly factorId: string;
  readonly type: 'totp' | 'webauthn' | 'recovery_codes';
  readonly secretEncrypted: string | null;
  readonly credentialId: string | null;
  readonly publicKey: string | null;
  readonly signCount: number;
  readonly isPrimary: boolean;
}

export async function getVerifiedFactors(userId: string): Promise<VerifiedFactor[]> {
  const rows = await withAppRole(
    (tx) => tx`select * from app.auth_verified_factors(${userId})`,
  );
  return rows.map((row) => ({
    factorId: row.factor_id as string,
    type: row.type as VerifiedFactor['type'],
    secretEncrypted: (row.secret_encrypted as string | null) ?? null,
    credentialId: (row.credential_id as string | null) ?? null,
    publicKey: (row.public_key as string | null) ?? null,
    signCount: Number(row.sign_count ?? 0),
    isPrimary: row.is_primary as boolean,
  }));
}

/* ==========================================================================
 * Sessions
 * ========================================================================== */

/**
 * FR-151. Has this account signed in from this device before?
 *
 * ⚠️ Ask BEFORE creating the session. `createSession` writes a row carrying this
 * same fingerprint, so afterwards the answer is always yes — matching the
 * session that was just created.
 */
export async function deviceIsKnown(userId: string, fingerprint: string): Promise<boolean> {
  const rows = await withAppRole(
    (tx) => tx`select app.auth_device_is_known(${userId}, ${fingerprint}) as known`,
  );
  return rows[0]?.known === true;
}

export async function createSession(input: {
  userId: string;
  refreshTokenHash: string;
  deviceFingerprint: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
  ipCountry?: string | null;
  ipAsn?: string | null;
  rotatedFrom?: string | null;
}): Promise<string> {
  const rows = await withAppRole(
    (tx) => tx`
      select app.auth_create_session(
        ${input.userId}, ${input.refreshTokenHash}, ${input.deviceFingerprint},
        ${input.expiresAt}, ${input.absoluteExpiresAt},
        ${input.userAgent ?? null}, ${input.ip ?? null}::inet,
        ${input.ipCountry ?? null}, ${input.ipAsn ?? null},
        ${input.rotatedFrom ?? null}
      ) as id
    `,
  );
  return rows[0].id as string;
}

export type ReuseOutcome = 'ok' | 'reuse_detected' | 'unknown';

/** FR-150. A replayed refresh token revokes every session on the account. */
export async function detectReuse(
  refreshTokenHash: string,
): Promise<{ outcome: ReuseOutcome; userId: string | null; sessionId: string | null }> {
  const rows = await withAppRole(
    (tx) => tx`select * from app.auth_detect_reuse(${refreshTokenHash})`,
  );
  const row = rows[0];
  return {
    outcome: row.outcome as ReuseOutcome,
    userId: (row.user_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
  };
}

export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const rows = await withAppRole(
    (tx) => tx`select app.auth_revoke_all_sessions(${userId}, ${reason}) as n`,
  );
  return Number(rows[0].n ?? 0);
}

/* ==========================================================================
 * Tokens
 * ========================================================================== */

export type ConsumeStatus =
  | 'ok'
  | 'not_found'
  | 'already_used'
  | 'superseded'
  | 'expired'
  | 'burned';

export async function issueToken(input: {
  userId: string;
  tokenHash: string;
  purpose: InvitationPurpose;
  sentToEmail: string;
  expiresAt: Date;
  createdBy?: string | null;
}): Promise<string> {
  const rows = await withAppRole(
    (tx) => tx`
      select app.auth_issue_token(
        ${input.userId}, ${input.tokenHash},
        ${input.purpose}::public.invitation_purpose,
        ${input.sentToEmail}, ${input.expiresAt}, ${input.createdBy ?? null}
      ) as id
    `,
  );
  return rows[0].id as string;
}

export async function consumeToken(
  tokenHash: string,
  purpose: InvitationPurpose,
): Promise<{ status: ConsumeStatus; userId: string | null }> {
  const rows = await withAppRole(
    (tx) => tx`
      select * from app.auth_consume_token(
        ${tokenHash}, ${purpose}::public.invitation_purpose
      )
    `,
  );
  const row = rows[0];
  return {
    status: row.status as ConsumeStatus,
    userId: (row.user_id as string | null) ?? null,
  };
}

/** Counts a wrong code entry. At 5 the code is burned (FR-155). */
export async function registerTokenAttempt(tokenHash: string): Promise<number> {
  const rows = await withAppRole(
    (tx) => tx`select app.auth_register_token_attempt(${tokenHash}) as n`,
  );
  return Number(rows[0].n ?? 0);
}

/* ==========================================================================
 * Passwords
 * ========================================================================== */

/** Sets the hash, trims history, revokes every session, clears any lock. */
export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await withAppRole((tx) => tx`select app.auth_set_password(${userId}, ${passwordHash})`);
}
