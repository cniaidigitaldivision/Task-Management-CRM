import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { sessionLifetimes } from '@/lib/domain/session-policy';
import type { Role } from '@/lib/domain/constants';
import { createSession } from '@/lib/db/queries/auth';

import { deviceFingerprint, generateToken, hashToken } from './tokens';

/* ============================================================================
 * SESSION COOKIE — FR-150, doc 16 §4
 * ----------------------------------------------------------------------------
 * ── WHAT IS IN THE COOKIE, AND WHAT IS NOT ───────────────────────────────────
 * An opaque 256-bit refresh token, and an HMAC of it. That is all. No user id,
 * no role, no expiry, no JSON.
 *
 * A JWT is the reflex here and it is the wrong tool for this system. Its appeal
 * is skipping the database lookup — but every request already needs the
 * database, because doc 16 §4 requires the session to be checked for
 * revocation, device match, idle timeout and reuse. A JWT that must be looked up
 * anyway is a bearer token with extra steps, and it introduces a real hazard:
 * revocation cannot take effect until it expires. FR-155c ("a reset revokes all
 * sessions") and doc 16 §12 (incident response starts with revoke-everything)
 * both need revocation to be immediate.
 *
 * The role in particular must NOT be in the cookie. FR-005 says a role change
 * takes effect on the next request; a role baked into a token stays stale until
 * it expires, which is a privilege-escalation window measured in days.
 *
 * ── WHY SIGN AN ALREADY-UNGUESSABLE TOKEN ────────────────────────────────────
 * The signature does not make the token more secret — 256 random bits are
 * already beyond guessing. It buys two specific things:
 *
 *   1. A forged or corrupted cookie is rejected with one HMAC instead of a
 *      database round trip. Cheap protection against noise.
 *   2. Rotating SESSION_SECRET invalidates every cookie instantly, which is
 *      exactly what .env.example advertises: "rotating it signs everyone out —
 *      which is what you want after any staff change".
 *
 * Signing does NOT replace the database check. It runs first, and the session
 * lookup still happens.
 * ========================================================================= */

const COOKIE_NAME = 'cni_session';

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error(
      'SESSION_SECRET is not set. Generate one with `openssl rand -base64 32` and put it in .env.local.',
    );
  }
  return value;
}

function sign(token: string): string {
  return createHmac('sha256', secret()).update(token, 'utf8').digest('base64url');
}

function encode(token: string): string {
  return `${token}.${sign(token)}`;
}

/** Returns the token, or null if the cookie is absent, malformed or unsigned. */
function decode(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const token = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  const expected = sign(token);

  if (provided.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return null;
    }
  } catch {
    return null;
  }
  return token;
}

/* ==========================================================================
 * Issuing
 * ========================================================================== */

export interface RequestFacts {
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly ip: string | null;
  readonly ipCountry: string | null;
  readonly ipAsn: string | null;
}

/**
 * Create a session row and set the cookie.
 *
 * Lifetimes come from `sessionLifetimes()` in lib/domain — role-scoped per
 * doc 16 §4, so the Super Admin gets 8h inside a 12h cap while a Member gets 7d
 * inside 30d. `now` is passed in, never read here.
 */
export async function issueSession(
  userId: string,
  role: Role,
  facts: RequestFacts,
  now: number,
): Promise<string> {
  const token = generateToken();
  const life = sessionLifetimes(role, now);

  const sessionId = await createSession({
    userId,
    refreshTokenHash: hashToken(token),
    deviceFingerprint: deviceFingerprint(facts.userAgent, facts.acceptLanguage),
    expiresAt: new Date(life.refreshExpiresAt),
    absoluteExpiresAt: new Date(life.absoluteExpiresAt),
    userAgent: facts.userAgent,
    ip: facts.ip,
    ipCountry: facts.ipCountry,
    ipAsn: facts.ipAsn,
  });

  const store = await cookies();
  store.set(COOKIE_NAME, encode(token), {
    httpOnly: true,
    // Lax, not Strict. Strict would drop the cookie on the activation and
    // password-reset links people arrive on from their email client, so they
    // would land signed out immediately after signing in — doc 16 §4.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(life.absoluteExpiresAt),
  });

  return sessionId;
}

/** The raw refresh token from the request, or null. */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return decode(store.get(COOKIE_NAME)?.value);
}

/** The hash to look the session up by. */
export async function readSessionTokenHash(): Promise<string | null> {
  const token = await readSessionToken();
  return token ? hashToken(token) : null;
}

/**
 * Remove the cookie, if we are somewhere that is allowed to.
 *
 * ── WHY THIS SWALLOWS ITS OWN FAILURE ────────────────────────────────────────
 * Next.js permits a cookie write only in a Server Action or a Route Handler.
 * `requireUser()` calls this from **page renders too**, and there it throws:
 *
 *     Error: Cookies can only be modified in a Server Action or Route Handler
 *
 * Unhandled, that turned a redirect to the sign-in screen into an **HTTP 500 on
 * every page** for anybody whose session had gone stale — found 2026-08-12 when
 * `npm run smoke` reported eleven 500s for an account sitting in
 * `password_reset_required`. That is not an edge case for this application: it is
 * exactly the state a forced password reset puts somebody in (CHANGE-PLAN 4.1),
 * so the feature built in this batch made the bug reachable on purpose.
 *
 * Clearing the cookie is a courtesy — it saves the browser presenting a token
 * that will never work again. The **redirect** is the part that matters, and it
 * must not be lost because the courtesy is unavailable. So the failure is
 * swallowed rather than propagated, and the caller redirects either way.
 *
 * Returns whether it was actually removed, so a caller in a context that *can*
 * write cookies (sign-out, which is a Server Action) can still tell.
 */
export async function clearSessionCookie(): Promise<boolean> {
  try {
    const store = await cookies();
    store.delete(COOKIE_NAME);
    return true;
  } catch {
    /* A read-only context. The session is already dead server-side, so the stale
       cookie costs one rejected lookup per request until it expires on its own —
       and it carries its own `expires` from `issueSession`, so it does. */
    return false;
  }
}

/** Exposed for tests — the encode/decode pair must round-trip and reject tampering. */
export const __cookieCodec = { encode, decode, COOKIE_NAME };
