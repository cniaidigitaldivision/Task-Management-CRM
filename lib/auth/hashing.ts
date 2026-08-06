import 'server-only';

import { hash, verify } from '@node-rs/argon2';

/* ============================================================================
 * PASSWORD HASHING — Argon2id, FR-147, doc 16 §4
 * ----------------------------------------------------------------------------
 * Argon2id is the current OWASP first choice: memory-hard, so a GPU or ASIC
 * cannot parallelise an attack the way it can against bcrypt or PBKDF2. The
 * `id` variant is the hybrid — Argon2i's side-channel resistance on the first
 * pass, Argon2d's GPU resistance after.
 *
 * ── THE PARAMETERS, AND WHY THESE ONES ───────────────────────────────────────
 * Measured on this machine, 5 runs each:
 *
 *     m=19MiB  t=2  p=1     14ms    ← OWASP ASVS L2 minimum
 *     m=64MiB  t=3  p=1     99ms    ← chosen
 *     m=64MiB  t=4  p=2    130ms
 *
 * 99ms is the right point on that curve. The cost of a login is invisible to a
 * person and roughly 7× the floor for an attacker, and 64 MiB of memory per
 * attempt is what actually limits how many hashes can be computed in parallel —
 * time cost alone is the parameter attackers scale past most easily.
 *
 * Single lane (p=1) on purpose: a serverless function usually has one usable
 * vCPU, so extra lanes buy little and make timing less predictable across cold
 * and warm starts. The measurement above bears that out — doubling lanes and
 * adding a pass cost 31ms for no real gain in memory hardness.
 *
 * Seven people signing in a few times a day. There is no throughput argument
 * for going cheaper.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────
 * No salt parameter: Argon2 generates a per-password salt and encodes it in the
 * output string, which is why the hash is self-describing and `verify` needs
 * nothing but the hash and the candidate.
 *
 * No pepper either. A pepper protects a leaked database when the application
 * secret did not leak with it — but this hash sits in the same Postgres that
 * `TOKEN_PEPPER` protects the six-digit recovery codes in, and those genuinely
 * need it (a million possibilities is trivially enumerable). A 12-character
 * minimum password behind Argon2id at these parameters is not. Adding a pepper
 * here would mean every password becomes unverifiable the day that secret is
 * lost, for no meaningful gain. See lib/auth/tokens.ts for where it does earn
 * its keep.
 * ========================================================================= */

/**
 * `algorithm: 2` is Argon2id.
 *
 * The library exports an `Algorithm` const enum, which TypeScript refuses to
 * read under `isolatedModules` — a const enum has no runtime representation to
 * import, and Next compiles each file in isolation. The numeric value is from
 * the Argon2 reference implementation (0 = Argon2d, 1 = Argon2i, 2 = Argon2id)
 * and is fixed by the spec, so it cannot drift. Verified in the smoke test: the
 * resulting hashes carry the `$argon2id$` prefix.
 */
const PARAMS = {
  algorithm: 2,
  /** 64 MiB. The parameter that limits parallel attack, not time cost. */
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Hash a password for storage in `auth_identities.password_hash`.
 *
 * The caller must have already run it through `validatePassword()`
 * (lib/domain/password-policy.ts) plus the breach and reuse checks — this
 * function deliberately does not validate, so there is exactly one place that
 * decides whether a password is acceptable.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/**
 * Verify a candidate against a stored hash.
 *
 * Returns `false` on a malformed or unrecognised hash rather than throwing. A
 * corrupt row should refuse the sign-in, not produce a 500 that tells an
 * attacker they found something unusual about this particular account.
 */
export async function verifyPassword(storedHash: string, candidate: string): Promise<boolean> {
  if (!storedHash || !candidate) return false;
  try {
    return await verify(storedHash, candidate);
  } catch {
    return false;
  }
}

/**
 * Does this hash need rehashing at the current parameters?
 *
 * doc 16 §4: "Rehashed transparently on login if parameters are upgraded." The
 * only moment the plaintext password is available is the instant it is
 * successfully verified, so that is the only moment an upgrade can happen —
 * which is why this is checked on every successful sign-in rather than in a
 * migration.
 *
 * Parsed from the hash's own prefix, e.g. `$argon2id$v=19$m=65536,t=3,p=1$…`.
 */
export function needsRehash(storedHash: string): boolean {
  const match = storedHash.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!match) return true; // not Argon2id at all, or a version we do not write

  const [, m, t, p] = match;
  return (
    Number(m) < PARAMS.memoryCost ||
    Number(t) < PARAMS.timeCost ||
    Number(p) !== PARAMS.parallelism
  );
}

/**
 * A dummy verification, for the sign-in path when no account matched.
 *
 * FR-155e requires a constant-time response whether or not an account exists.
 * Returning early for an unknown address is ~99ms faster than verifying a real
 * one, and that difference alone is a usable account-enumeration oracle — it
 * needs no error message to leak the same thing.
 *
 * ⚠️ The hash below MUST be a real, well-formed Argon2id hash at the current
 * parameters. A made-up string looks like it would work and does not: Argon2
 * rejects a malformed hash while parsing, before allocating any memory, so
 * `verify` returns in under a millisecond and the timing gap it was meant to
 * close stays wide open. Measured — this one takes 104ms against a wrong
 * candidate, matching a genuine verification.
 *
 * It is the hash of a fixed nonsense string. No password produces it, and
 * knowing it reveals nothing.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$gjt6o3VGxfJABn9eGy0q5A$' +
  'PMdSrSr6xiumSTnF9D/fcnm0RtEHP3UJgmgl7QA7KSA';

export async function burnTimeLikeAVerify(candidate: string): Promise<void> {
  try {
    await verify(DECOY_HASH, candidate || 'x');
  } catch {
    // Never throws for a well-formed hash, but a refusal here must not surface
    // as a different response than a real failed verification would.
  }
}

/** Exposed so a test can prove the decoy still costs what a real verify costs. */
export const DECOY_HASH_FOR_TESTS = DECOY_HASH;
