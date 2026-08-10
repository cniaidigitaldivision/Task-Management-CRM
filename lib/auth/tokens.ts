import 'server-only';

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/* ============================================================================
 * TOKENS AND ONE-TIME CODES — FR-142, FR-155, doc 16 §3, §6
 * ----------------------------------------------------------------------------
 * Activation links, password-reset codes, account-unlock codes, recovery codes,
 * session refresh tokens and the sealed break-glass credential.
 *
 * ── ONE RULE ABOVE ALL OTHERS ────────────────────────────────────────────────
 * The raw value is returned to the caller ONCE, to be emailed or displayed, and
 * only its SHA-256 digest is ever stored. Migration 001 enforces that at the
 * database level: `token_hash` is constrained to `^[0-9a-f]{64}$`, so a column
 * holding a raw token is not a mistake anyone can make quietly — it is a check
 * constraint violation.
 *
 * ── WHY SHA-256 HERE AND ARGON2 FOR PASSWORDS ────────────────────────────────
 * Not an inconsistency. A 256-bit random token has no structure to guess: there
 * is nothing for a slow hash to protect, and these are verified on paths that
 * must stay fast. A password is low-entropy and human-chosen, which is exactly
 * what Argon2id's memory hardness exists for.
 *
 * The six-digit codes are the exception, and the reason TOKEN_PEPPER exists.
 * ========================================================================= */

/**
 * Added before hashing the short codes.
 *
 * A six-digit code has a million possibilities. Against a bare SHA-256, someone
 * holding a stolen database dump can enumerate all million in well under a
 * second and recover every live reset code. The pepper lives in the environment
 * rather than the database, so a dump alone is not enough — the attacker needs
 * the application secret too.
 *
 * Read lazily. Reading at module load would crash any import of this file when
 * the variable is missing, including in tooling that never needs it.
 */
function pepper(): string {
  const value = process.env.TOKEN_PEPPER;
  if (!value) {
    throw new Error(
      'TOKEN_PEPPER is not set. Generate one with `openssl rand -base64 32` and put it in .env.local.',
    );
  }
  return value;
}

/* ==========================================================================
 * Long tokens — activation and reset links, session refresh tokens
 * ========================================================================== */

/**
 * A 256-bit token, base64url so it survives a URL and an email client without
 * escaping. doc 16 §3: "a 256-bit cryptographically random activation token".
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The digest stored in `invitations.token_hash` / `sessions.refresh_token_hash`.
 *
 * No pepper: 256 bits of entropy is not enumerable, so there is nothing for one
 * to protect, and it would make every live session and invitation unverifiable
 * the day the secret rotated.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The opaque lookup key carried in a forced-reset link so the Super Admin's
 * status trail can record that the link was opened (CHANGE-PLAN 4.1).
 *
 * ── THIS IS NOT A CREDENTIAL, AND THAT IS THE POINT ──────────────────────────
 * It exists because the token hash is scoped — `hashScopedCode(purpose, email,
 * code)` — and at `/reset-password?code=…` the email has not been typed yet, so
 * the row cannot be found from the URL at all. Something else has to identify
 * it, and this is that something.
 *
 * It grants nothing. Possessing one lets you stamp `link_opened_at` on a reset
 * you were already sent, and nothing else: the six-digit code remains the only
 * secret, is still stored only as a digest, and is still the only thing that can
 * change a password. The worst a leaked value achieves is a false "opened",
 * which is why it is stored in clear rather than hashed — a hash would make the
 * lookup impossible for no gain.
 *
 * Still 256 bits, because a *guessable* one would let somebody mark other
 * people's resets as opened, and that is noise in a security screen whose only
 * value is signal.
 */
export function generateTrailRef(): string {
  return randomBytes(32).toString('base64url');
}

/* ==========================================================================
 * Short codes — emailed one-time codes, FR-155
 * ========================================================================== */

/**
 * A six-digit code, uniformly distributed and zero-padded.
 *
 * `randomInt` rather than `Math.floor(Math.random() * n)`: `Math.random` is not
 * cryptographically secure and is seeded predictably enough that codes could be
 * guessed from a few samples. `randomInt` also rejection-samples, so there is
 * no modulo bias making some codes likelier than others.
 *
 * Six digits is the owner's decision (ADR-007) and it is defensible because
 * three things bound it: fifteen minutes of validity, five entry attempts
 * before the code burns, and requesting a new code invalidates the old one.
 * Without those, six digits would be far too few.
 */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/** Peppered, because a million possibilities is trivially enumerable. */
export function hashCode(code: string): string {
  return createHash('sha256').update(`${pepper()}:${code}`, 'utf8').digest('hex');
}

/**
 * A short code bound to the account it was issued for.
 *
 * ── WHY THE ACCOUNT IS IN THE HASH, AND NOT ONLY THE CODE ────────────────────
 * Two reasons, and the second is the important one.
 *
 * 1. `invitations.token_hash` is globally UNIQUE (migration 001). Two people
 *    holding the same six digits — which happens roughly once in a million
 *    issues, so eventually — would produce the same digest, and the second
 *    request would fail with a unique violation nobody could explain.
 *
 * 2. Far more seriously: with an unscoped hash, guessing *any* live code in the
 *    system resets *somebody's* password. The attacker does not need to know
 *    whose. Across a team, every outstanding code widens the target, and the
 *    six-digit space collapses accordingly.
 *
 *    Scoped, a guess has to be right for a *named* account. That restores the
 *    bound the design assumed: one account, one million possibilities, five
 *    attempts, fifteen minutes.
 *
 * The purpose is included as well, so a reset code cannot be presented as an
 * unlock code — the two flows have different consequences.
 */
export function hashScopedCode(purpose: string, accountEmail: string, code: string): string {
  return createHash('sha256')
    .update(`${pepper()}:${purpose}:${accountEmail.trim().toLowerCase()}:${code}`, 'utf8')
    .digest('hex');
}

/* ==========================================================================
 * Recovery codes — SA-9
 * ========================================================================== */

/**
 * Ten single-use codes, shown once at setup and never again.
 *
 * Crockford-style alphabet with I, L, O, U and 0/1 removed: these are printed
 * and typed back in by a person under stress, having lost their phone. A code
 * that cannot be misread is worth more than four extra bits.
 *
 * Grouped `XXXX-XXXX` for the same reason.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from(
      { length: 8 },
      () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)],
    );
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  });
}

/**
 * Normalise before hashing, so the stored digest does not depend on how someone
 * happened to type it. Lower case, spaces and hyphens stripped.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(`${pepper()}:recovery:${normaliseRecoveryCode(code)}`, 'utf8')
    .digest('hex');
}

/* ==========================================================================
 * Comparison
 * ========================================================================== */

/**
 * Compare two hex digests without leaking how far the comparison got.
 *
 * `a === b` on strings short-circuits at the first differing character, and the
 * timing difference is measurable across enough requests. It matters less for a
 * digest than for a raw secret — you cannot walk a hash byte-by-byte without
 * being able to compute preimages — but the correct comparison costs nothing,
 * so there is no reason to use the wrong one.
 */
export function digestsMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/* ==========================================================================
 * Expiry helpers — `now` is a parameter, per doc 20 §5
 * ========================================================================== */

export function expiresInMinutes(now: number, minutes: number): Date {
  return new Date(now + minutes * 60_000);
}

export function expiresInHours(now: number, hours: number): Date {
  return new Date(now + hours * 3_600_000);
}

/**
 * A device fingerprint for session binding (FR-150).
 *
 * Deliberately coarse — user agent plus accept-language, hashed. A fingerprint
 * that includes the IP address would invalidate the session every time someone
 * moved between wifi and mobile data, which trains people to expect random
 * sign-outs and destroys the signal when a real one happens. IP and ASN changes
 * are handled separately, by `detectContextChanges()` in session-policy.ts,
 * which asks for re-authentication instead of killing the session.
 */
export function deviceFingerprint(userAgent: string | null, acceptLanguage: string | null): string {
  return createHash('sha256')
    .update(`${userAgent ?? 'unknown'}|${acceptLanguage ?? 'unknown'}`, 'utf8')
    .digest('hex');
}
