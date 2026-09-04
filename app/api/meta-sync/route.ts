import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runMetaSync } from '@/lib/meta/sync';

/* ============================================================================
 * THE META SYNC RUNNER
 * ----------------------------------------------------------------------------
 * Pulls each linked Facebook Page and Instagram account's figures into Taskly's
 * own tables. The Trend & Engagement Studio reads those tables and never calls
 * Meta itself — owner, 2026-09-04: *"I will not fetch live things… I will set a
 * cron job… We will fetch data from the database and show and draw a graph."*
 *
 * ── ⚠️ EVERY TWO HOURS, WHICH THE OWNER CHOSE ──────────────────────────────
 * vercel.json cannot carry a comment, so the reasoning lives here. Meta's daily
 * aggregates settle a few times a day rather than continuously, so hourly would
 * mostly re-read identical rows and double the API budget for nothing. Two hours
 * keeps the Studio no more than two hours stale, which is well inside what
 * anybody reading a monthly trend needs.
 *
 * ── ⚠️ WHY IT ALWAYS RETURNS 200, EVEN WHEN ACCOUNTS FAILED ────────────────
 * A per-account failure is a RESULT, not a request error. Vercel Cron retries a
 * non-2xx, and retrying is exactly wrong here: a client who revoked access will
 * fail identically on every retry, while the accounts that already succeeded
 * would be re-pulled each time. The failures are in the body, on the account row
 * and in `meta_sync_runs`, which is where Settings & Sync reads them.
 *
 * A 500 is reserved for the sync being unable to run at all — no token
 * configured, database unreachable — which IS worth retrying.
 *
 * ── SAFE TO CALL TWICE ──────────────────────────────────────────────────────
 * Cron delivery is at-least-once, and every write is an upsert keyed to correct
 * rather than duplicate. Migration 092's self-check asserts precisely this.
 *
 * ── NOT PUBLIC ──────────────────────────────────────────────────────────────
 * Same guard as the repeat runner: `CRON_SECRET` as a bearer token, compared in
 * constant time, refusing outright when no secret is configured rather than
 * defaulting to open.
 * ========================================================================= */

function secretMatches(provided: string, expected: string): boolean {
  /* Hashed first so both sides are 32 bytes — `timingSafeEqual` throws on a
     length mismatch, and guarding that by hand reintroduces the early return the
     function exists to avoid. */
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The Meta sync is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  /* ?backfill=1 forces the full 30-day window for every account rather than the
     routine trailing week. Used for the first pull and to repair a gap. */
  const backfill = new URL(request.url).searchParams.get('backfill') === '1';

  try {
    const results = await runMetaSync({ backfill });

    return NextResponse.json({
      ok: true,
      backfill,
      accounts: results.length,
      succeeded: results.filter((r) => r.outcome === 'ok').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      daysWritten: results.reduce((n, r) => n + r.daysWritten, 0),
      postsWritten: results.reduce((n, r) => n + r.postsWritten, 0),
      results,
    });
  } catch (error) {
    /* The sync could not run at all — worth a retry, so a 500. */
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The Meta sync could not run.' },
      { status: 500 },
    );
  }
}
