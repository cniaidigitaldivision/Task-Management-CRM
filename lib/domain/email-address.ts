/* ============================================================================
 * EMAIL ADDRESSES — the one shape the whole system agrees on
 * ----------------------------------------------------------------------------
 * ⛔ LAYER 2 (Domain). Pure and deterministic — no clock, no network, no I/O.
 *
 * ── WHY THIS IS A MODULE AND NOT A REGEX WHERE IT IS NEEDED ──────────────────
 * Migration 001 puts two constraints on `users.email`:
 *
 *     users_email_lowercase   check (email = lower(email))
 *     users_email_shaped      check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 *
 * Anything that reaches the database without satisfying both comes back as a
 * check-constraint violation — a Postgres error string, in front of somebody
 * who mistyped their own address. So the rule has to exist in TypeScript too,
 * and the moment it exists twice it has to exist in exactly ONE place, or the
 * two drift and the database wins an argument nobody knew was happening.
 *
 * `EMAIL_SHAPE` below is that Postgres pattern transcribed. `[:space:]` becomes
 * `\s`; the rest is character-for-character. Changing one without the other is
 * the bug this module exists to prevent.
 *
 * ── THIS IS STRICTER THAN THE DATABASE, IN ONE PLACE, ON PURPOSE ─────────────
 * The direction matters and only one direction is safe: everything this module
 * accepts, the constraint also accepts. The reverse is not true, and does not
 * need to be — the database is the floor, not the ceiling.
 *
 * The one addition is `TLD_SHAPE`. The SQL pattern happily accepts
 * `habiba@example.com,` — a trailing comma off a pasted list — because `com,`
 * satisfies `[^[:space:]@]+`. That address is syntactically fine and can never
 * receive mail, which for a SIGN-IN IDENTITY is the worst possible combination:
 * it saves, it looks right, and the recovery email goes nowhere. So the last
 * label of the domain must be two or more letters.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * It does not attempt RFC 5322. A fully conforming address parser accepts
 * quoted strings, comments and bracketed IP literals, rejects almost nothing,
 * and still cannot tell you whether a mailbox exists. The only proof that an
 * address works is mail arriving at it. So this catches the mistakes people
 * actually make — a missing `@`, a stray space, a trailing comma, no dot in the
 * domain — and leaves the rest to delivery.
 * ========================================================================= */

/** RFC 5321 §4.5.3.1.3: the whole forward-path is capped at 254 characters. */
export const EMAIL_MAX_LENGTH = 254;

/** Migration 001's `users_email_shaped`, transcribed. Keep the two identical. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The one rule we hold above the constraint. See the header. */
const TLD_SHAPE = /\.[a-z]{2,}$/;

export type EmailCheck =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly message: string };

/**
 * Trim and lower-case — the form `users_email_lowercase` requires.
 *
 * Lower-casing is safe for the domain (case-insensitive by RFC 1035) and
 * *technically* lossy for the local part, which RFC 5321 says a server may treat
 * as case-sensitive. In practice no mail provider anybody here uses does, and
 * the alternative — storing `Habiba@…` and `habiba@…` as two different accounts
 * that can both be signed into — is far worse than the theoretical loss.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Normalise, then say yes or say why not — in a sentence, never a pattern. */
export function validateEmailAddress(raw: string): EmailCheck {
  const email = normaliseEmail(raw);

  if (email.length === 0) return { ok: false, message: 'Enter an email address.' };

  if (email.length > EMAIL_MAX_LENGTH) {
    return {
      ok: false,
      message: `An email address cannot be longer than ${EMAIL_MAX_LENGTH} characters.`,
    };
  }

  if (!EMAIL_SHAPE.test(email)) {
    return {
      ok: false,
      message:
        'That does not look like an email address. It needs one @, something before it, and a domain with a dot in it — no spaces.',
    };
  }

  if (!TLD_SHAPE.test(email)) {
    return {
      ok: false,
      message:
        'Check the end of the domain — it should finish in letters, like .com or .pk. A stray comma or full stop from a pasted list is the usual cause.',
    };
  }

  return { ok: true, email };
}

/** Same address, ignoring case and surrounding whitespace. */
export function sameEmail(a: string, b: string): boolean {
  return normaliseEmail(a) === normaliseEmail(b);
}

/**
 * `h•••a@example.com` — enough to recognise your own address, not enough to
 * hand somebody else's to a shoulder-surfer.
 *
 * Used in the alert that goes to the OLD address, where naming the new one in
 * full would be handing an attacker's inbox to anyone who reads the message.
 */
export function maskEmail(raw: string): string {
  const email = normaliseEmail(raw);
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';

  const local = email.slice(0, at);
  const domain = email.slice(at);

  if (local.length <= 2) return `${local[0]}•••${domain}`;
  return `${local[0]}•••${local[local.length - 1]}${domain}`;
}
