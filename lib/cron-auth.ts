import { createHash, timingSafeEqual } from 'node:crypto';

/* ============================================================================
 * AUTHENTICATING A SCHEDULED CALL
 * ----------------------------------------------------------------------------
 * There is no cron in this application; the scheduled work is a set of routes
 * that something else — Vercel Cron, or anything that can make an HTTPS request —
 * calls on a timetable. An open endpoint that emails the whole division is a spam
 * cannon with a company logo on it, so every one of them requires `CRON_SECRET`.
 *
 * ── ⚠️ WHY THE COMPARISON IS CONSTANT TIME ──────────────────────────────────
 * A plain `===` on a secret leaks its length and then its content to anybody
 * willing to measure, which for an endpoint reachable from the internet is not
 * theoretical. Both sides are hashed to 32 bytes first, which removes the length
 * problem entirely: `timingSafeEqual` throws on a length mismatch, and any
 * hand-written guard for that reintroduces exactly the early return the function
 * exists to avoid. The hashing is not for secrecy — it is to make both sides the
 * same size.
 *
 * ── ⚠️ NOTE FOR WHOEVER TOUCHES THE OTHER ROUTES ────────────────────────────
 * This logic is currently written out a FOURTH time in app/api/digest,
 * app/api/drive-sync and app/api/schedule. It was extracted here for the
 * attendance sweep rather than by editing those three, because they work and the
 * owner asked for this feature to be isolated: *"Do not disturb any other working
 * thing."* They should converge on this file — but as its own change, where a
 * mistake in a security check is not buried inside a feature.
 * ========================================================================= */

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Whether a request carries the scheduling secret.
 *
 * ⚠️ REFUSES WHEN NOTHING IS CONFIGURED, rather than defaulting to open. A missing
 * `CRON_SECRET` in production would otherwise publish the endpoint.
 */
export function cronRequestIsAuthorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET ?? '';
  if (expected === '') return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (provided === '') return false;

  return timingSafeEqual(digest(provided), digest(expected));
}
