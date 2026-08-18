import 'server-only';

import { open, seal } from '@/lib/auth/secret-box';
import { withAppRole } from '@/lib/db/client';

/* ============================================================================
 * THE DRIVE CONNECTION — the only code that touches the refresh token
 * ----------------------------------------------------------------------------
 * ⛔ THIS TOKEN GRANTS ONGOING ACCESS TO A REAL PERSON'S GOOGLE DRIVE.
 *
 * `public.drive_connection` has RLS enabled and ZERO policies, and every
 * privilege is revoked from `cni_app` — the same treatment as `break_glass`.
 * There is no client path to it in any direction. These four functions reach it
 * through the narrow SECURITY DEFINER surface in migration 027, and nothing else
 * in the codebase does.
 *
 * ── withAppRole, NOT withUser ────────────────────────────────────────────────
 * The table grants nothing to anybody, so an identity would not help. The
 * definer functions are the authorisation, and they are granted to `cni_app`
 * alone. `withAppRole` is also correct for the OAuth callback, which runs while
 * the person is being redirected back from Google.
 *
 * ── THE TOKEN IS NEVER RETURNED TO A CALLER OUTSIDE lib/drive ────────────────
 * `readConnection` is the one function that decrypts, and it is called only by
 * the OAuth module minting an access token. Screens use `connectionStatus`,
 * which returns the account address and nothing else.
 * ========================================================================= */

export interface DriveConnectionStatus {
  readonly connected: boolean;
  /** Which Google account the CRM acts as, for display. Never the token. */
  readonly accountEmail: string | null;
  readonly connectedAt: string | null;
  readonly lastError: string | null;
}

/** Safe for any screen: says whether Drive works and whose account it uses. */
export async function connectionStatus(): Promise<DriveConnectionStatus> {
  /* ⚠️ THROUGH THE FUNCTION, NEVER THE TABLE. Migration 027 revoked every
     privilege on `drive_connection` from `cni_app`, so a direct select here
     fails with `42501 permission denied` — which it did, on every load of the
     Documents screen, and surfaced as the page bouncing to sign-in. A permission
     error two layers down is a convincing impression of a session problem.

     `drive_connection_status()` (029) returns the three harmless columns and
     cannot return the token; `drive_connection_read()` is the one that can, and
     it has exactly one caller. */
  const rows = await withAppRole((tx) => tx`
    select * from app.drive_connection_status()
  `);
  const row = rows[0];
  return {
    connected: Boolean(row?.account_email),
    accountEmail: (row?.account_email as string | null) ?? null,
    connectedAt: row?.connected_at ? String(row.connected_at) : null,
    lastError: (row?.last_error as string | null) ?? null,
  };
}

/**
 * The decrypted refresh token.
 *
 * ⚠️ Callers: `lib/drive/oauth.ts` and nothing else. If a second caller ever
 * appears, that is the moment to ask why something outside the Drive client
 * needs a Google credential.
 */
export async function readRefreshToken(): Promise<string | null> {
  const rows = await withAppRole((tx) => tx`
    select * from app.drive_connection_read()
  `);
  const sealed = rows[0]?.refresh_token_encrypted as string | null | undefined;
  if (!sealed) return null;

  try {
    return open(sealed);
  } catch {
    /* The box will not open — almost always because MFA_ENCRYPTION_KEY changed.
       Treated as "not connected" rather than thrown: the Documents screen then
       offers Connect again, which is the actual fix, instead of showing a
       decryption error nobody can act on. */
    return null;
  }
}

export async function storeConnection(input: {
  accountEmail: string;
  refreshToken: string;
  actorId: string;
}): Promise<void> {
  await withAppRole((tx) => tx`
    select app.drive_connection_store(
      ${input.accountEmail},
      ${seal(input.refreshToken)},
      ${input.actorId}::uuid
    )
  `);
}

export async function clearConnection(): Promise<void> {
  await withAppRole((tx) => tx`select app.drive_connection_clear()`);
}

/** Record why Drive stopped working, so the screen can say so. */
export async function recordFailure(message: string): Promise<void> {
  await withAppRole((tx) => tx`select app.drive_connection_fail(${message})`);
}
