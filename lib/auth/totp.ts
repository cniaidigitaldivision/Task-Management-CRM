import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* ============================================================================
 * TOTP — RFC 6238, FR-145, doc 16 §4
 * ----------------------------------------------------------------------------
 * Time-based one-time passwords, for the authenticator app that Super Admin and
 * Admin accounts must enrol.
 *
 * ── WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY ────────────────────────
 * TOTP is HMAC, a counter, and a truncation rule — about sixty lines. The
 * deciding factor is that RFC 6238 publishes KNOWN-ANSWER TEST VECTORS, so a
 * from-scratch implementation can be proven correct against the specification
 * itself rather than trusted because it is popular. A dependency here would add
 * supply-chain surface (threat T-11) for something that cannot be tested more
 * convincingly than this.
 *
 * `now` is always a parameter. A verification window spanning three time steps
 * is untestable if the code reads the clock internally, and the interesting
 * cases are all boundaries.
 *
 * ── WHAT TOTP DOES AND DOES NOT PROTECT AGAINST ──────────────────────────────
 * It stops a stolen password being sufficient. It does NOT stop phishing: a
 * convincing fake login page can ask for the code and relay it within its 30
 * second window. That is why doc 16 §4 prefers a WebAuthn passkey for the Super
 * Admin — a passkey is bound to the real domain and physically cannot be
 * replayed to a fake one. TOTP is the acceptable fallback, not the target.
 * ========================================================================= */

const DIGITS = 6;
/** 30 seconds. RFC 6238's recommended default and what every authenticator app assumes. */
const PERIOD_SECONDS = 30;

/**
 * How many steps either side of the current one to accept.
 *
 * 1 means the previous, current and next code all verify — a 90-second window.
 * RFC 6238 §5.2 explicitly allows this for clock drift between the server and a
 * phone that has not synced in a while. Wider would be a real weakening: every
 * extra step is another 30 seconds in which an intercepted code stays usable.
 */
const DEFAULT_WINDOW = 1;

/* ==========================================================================
 * Base32 — RFC 4648, no padding
 * ==========================================================================
 * The encoding every authenticator app expects in an otpauth:// URI. Node has
 * no built-in base32, so both directions are here.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  // Authenticator apps display the secret in spaced groups of four, and people
  // paste it back exactly as shown. Padding is optional in RFC 4648 and some
  // apps include it.
  const clean = input.replace(/[\s=]/g, '').toUpperCase();

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* ==========================================================================
 * Secret generation
 * ========================================================================== */

/**
 * A 160-bit shared secret, base32 encoded.
 *
 * RFC 4226 §4 requires at least 128 bits and recommends 160 — which is also
 * HMAC-SHA1's output size, so nothing is wasted. Stored encrypted at rest in
 * `mfa_factors.secret_encrypted` (doc 04 §2b).
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The `otpauth://` URI that becomes the QR code at enrolment.
 *
 * The issuer appears twice by design: as a label prefix and as a parameter.
 * Older authenticator apps read only one or the other, and getting it wrong
 * means the entry shows up unlabelled in a list of a dozen accounts.
 */
export function totpUri({
  secret,
  accountName,
  issuer,
}: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ==========================================================================
 * Code generation and verification
 * ========================================================================== */

/** The time step for an instant. RFC 6238 §4.2: T = floor(unixSeconds / period). */
export function timeStep(now: number, period = PERIOD_SECONDS): number {
  return Math.floor(now / 1000 / period);
}

/**
 * HOTP for one counter value — RFC 4226 §5.3, the dynamic truncation.
 *
 * The low four bits of the last byte select where in the digest to read from.
 * That offset is why HOTP is not simply "the first four bytes": a fixed window
 * would leak more about the HMAC than a moving one.
 *
 * SHA1 is correct here and is not a weakness. RFC 6238 specifies HMAC-SHA1 as
 * the default and every authenticator app implements it; SHA1's collision
 * problems do not apply to HMAC, which relies on the keyed construction rather
 * than collision resistance. Using SHA256 would be marginally stronger in
 * theory and incompatible with most apps in practice.
 */
function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  // Big-endian 64-bit. `writeBigUInt64BE` avoids the precision loss of shifting
  // a JS number past 32 bits, which is a real bug at counters this size.
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code for an instant. Exported so enrolment can show the expected value. */
export function generateTotp(
  secret: string,
  now: number,
  options: { digits?: number; period?: number } = {},
): string {
  const { digits = DIGITS, period = PERIOD_SECONDS } = options;
  return hotp(base32Decode(secret), timeStep(now, period), digits);
}

/**
 * Verify a submitted code, accepting `window` steps either side.
 *
 * Compares in constant time and checks every step in the window regardless of
 * whether an earlier one already matched — an early return would make a code
 * from the current step measurably faster to verify than one from the previous
 * step, which narrows the search for anyone timing it.
 */
export function verifyTotp(
  secret: string,
  submitted: string,
  now: number,
  options: { window?: number; digits?: number; period?: number } = {},
): boolean {
  const { window = DEFAULT_WINDOW, digits = DIGITS, period = PERIOD_SECONDS } = options;

  const cleaned = submitted.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(cleaned)) return false;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }

  const current = timeStep(now, period);
  let matched = false;

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = hotp(key, step, digits);
    if (constantTimeEquals(expected, cleaned)) matched = true;
  }

  return matched;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Seconds until the current code expires — for the countdown on the enrolment
 * screen, so someone with four seconds left waits rather than mistyping.
 */
export function secondsUntilNextStep(now: number, period = PERIOD_SECONDS): number {
  return period - Math.floor(now / 1000) % period;
}
