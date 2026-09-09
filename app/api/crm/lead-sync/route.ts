import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { importLeads } from '@/lib/crm/lead-import';

/* ============================================================================
 * THE LEAD IMPORT RUNNER
 * ----------------------------------------------------------------------------
 * Pulls Meta lead-ad submissions into `crm_leads`. Step 2 of
 * docs/crm/08-TWELVE-STEPS.md.
 *
 * Deliberately the same shape as `app/api/meta-sync/route.ts` — same guard, same
 * always-200 rule, same reasoning — because they are the same kind of job and
 * somebody reading one should recognise the other.
 *
 * ── ⚠️ WHY IT ALWAYS RETURNS 200, EVEN WHEN A PAGE FAILED ──────────────────
 * A per-page failure is a RESULT, not a request error. A scheduler retries a
 * non-2xx, and retrying is exactly wrong here: a client who revoked access will
 * fail identically every time, while the pages that already imported would be
 * re-pulled on each retry. The failures are in the body and on the result rows.
 *
 * A 500 is reserved for the job being unable to run at all.
 *
 * ── NOT PUBLIC ──────────────────────────────────────────────────────────────
 * `CRON_SECRET` as a bearer token, compared in constant time, refusing outright
 * when no secret is configured rather than defaulting to open.
 * ========================================================================= */

function secretMatches(provided: string, expected: string): boolean {
  /* Hashed first so both sides are 32 bytes — `timingSafeEqual` throws on a
     length mismatch, and guarding that by hand reintroduces the early return
     the function exists to avoid. */
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The lead import is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  /* ⚠️ `?project=<uuid>` NARROWS THE RUN, and it is how the owner's "one project
     at a time" instruction is honoured without narrowing the schema. Absent
     means every readable page — which is what the second project will want, and
     it will need no code change. */
  const projectId = new URL(request.url).searchParams.get('project');

  try {
    const result = await importLeads({ projectId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    /* Unable to run at all — no database, no configuration. Worth retrying. */
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'The lead import could not run.',
      },
      { status: 500 },
    );
  }
}
