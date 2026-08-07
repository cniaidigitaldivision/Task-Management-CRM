import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/* ============================================================================
 * ENCRYPTING SECRETS AT REST — doc 04 §2b, doc 16 §4
 * ----------------------------------------------------------------------------
 * `mfa_factors.secret_encrypted` has been named for what it should hold and
 * storing plaintext since the column was created. This is what closes that.
 *
 * Until now, database access alone was enough to generate a valid second factor
 * for any enrolled account — which quietly undid most of the point of requiring
 * one. `npm run demo:code` existed *only* because of that gap, and is deleted
 * alongside this.
 *
 * ── AES-256-GCM, NOT CBC OR CTR ──────────────────────────────────────────────
 * GCM authenticates as well as encrypts. A TOTP seed is a base32 string, so a
 * tampered ciphertext under an unauthenticated mode would decrypt to *some*
 * string — probably invalid base32, but the failure would be a confusing parse
 * error rather than "this has been altered". GCM's tag makes tampering a clean,
 * detectable failure.
 *
 * ── THE FORMAT IS VERSIONED FROM THE FIRST BYTE ──────────────────────────────
 *     v1.<iv>.<tag>.<ciphertext>       all base64url
 *
 * Two reasons a version prefix earns its place:
 *
 *   1. Rotation. Changing the key later means both must be readable during the
 *      changeover, and a format with no version has nowhere to say which is
 *      which.
 *   2. Migration. Anything WITHOUT the prefix is a legacy plaintext secret, and
 *      `open()` returns it unchanged. That is what lets encryption arrive
 *      without locking out everybody who enrolled before it — including the
 *      owner. `isLegacy()` lets callers re-encrypt on next successful use.
 *
 * ── LOSING THE KEY IS UNRECOVERABLE, AND THAT IS THE POINT ───────────────────
 * Every enrolled authenticator stops working, for everyone, permanently. The
 * only way back is printed recovery codes. `.env.example` says so; it is worth
 * saying twice, because a key stored only on the machine that uses it is not
 * backed up.
 * ========================================================================= */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — the size GCM is specified for
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'MFA_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and put it in ' +
        '.env.local and in the Vercel environment. Without it, authenticator secrets cannot be read.',
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== KEY_BYTES) {
    /* A short key would still "work" — Node would pad or throw depending on the
       mode — so it is checked rather than trusted. 32 bytes is what AES-256
       means, and a 16-byte key silently giving AES-128 is exactly the kind of
       downgrade nobody notices. */
    throw new Error(
      `MFA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}. ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** True when the stored value predates encryption and is still plaintext. */
export function isLegacyPlaintext(stored: string): boolean {
  return !stored.startsWith(`${VERSION}.`);
}

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt, or pass through a legacy plaintext value unchanged.
 *
 * Throws on a value that claims to be encrypted and is not readable — a
 * corrupted or tampered secret must fail loudly rather than be treated as
 * plaintext, which would turn "this was altered" into "your code is wrong".
 */
export function open(stored: string): string {
  if (isLegacyPlaintext(stored)) return stored;

  const parts = stored.split('.');
  if (parts.length !== 4) {
    throw new Error('Encrypted secret is malformed — expected v1.<iv>.<tag>.<ciphertext>.');
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    /* `final()` throws when the tag does not match: wrong key, or the ciphertext
       was altered. Both mean the same thing to a caller — this cannot be
       trusted — and neither should be silently converted into a bad code. */
    throw new Error(
      'An authenticator secret could not be decrypted. Either MFA_ENCRYPTION_KEY has changed, ' +
        'or the stored value was altered. Recovery codes are the way back in.',
    );
  }
}

/** Round-trips a value, for the startup check and the tests. */
export function selfTest(): boolean {
  const sample = 'JBSWY3DPEHPK3PXP';
  const restored = open(seal(sample));
  return (
    restored.length === sample.length &&
    timingSafeEqual(Buffer.from(restored), Buffer.from(sample))
  );
}
