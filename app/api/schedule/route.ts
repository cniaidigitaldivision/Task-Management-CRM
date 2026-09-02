import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isoDateIn, nowMs } from '@/lib/now';
import { runRepeatsFor } from '@/lib/schedule/repeats';

/* ============================================================================
 * THE MIDNIGHT REPEAT RUNNER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"if I say that he create a task and make it to a daily…
 * then set a tracker. Tracker inside you can set a cron job on it… exactly 12
 * AM on every day that task will be generated, right? … And next morning when
 * he go to the office he will see that now yeah this is my task."*
 *
 * ── ⚠️ WHAT THIS ROUTE USED TO DO, AND WHY IT NO LONGER DOES ────────────────
 * It filled every project's calendar from its agreed rhythm across a rolling
 * 14-day horizon. Together with the "Generate schedule" button (which reached to
 * month end) that produced 304 unassigned Backlog posts on 2026-09-02 — the
 * reason the board was slow and the reason nobody but Kashif could act on a
 * given day's work.
 *
 * The owner's instruction was explicit: *"further when a new project is created,
 * no auto static post or a real post task should not create automatically… I'm
 * not saying that generate this task daily then you will create all these task
 * of a month and put them in a database and make the database heavy. I don't
 * want that."*
 *
 * So the rhythm is a TARGET now, watched by a tracker, and the only thing this
 * route generates is the next instance of a repeat a PERSON set up on their own
 * task. Migration 085 retired the 304; the generator itself is gone.
 *
 * ── WHY A ROUTE AND NOT A SCHEDULER ─────────────────────────────────────────
 * Unchanged from before: there is no long-running process in this application
 * to own a cron, and adding one to create a few rows a night would be the
 * largest piece of infrastructure in the system. This is a URL that Vercel Cron
 * calls; the schedule lives in vercel.json.
 *
 * ── ⚠️ 19:00 UTC, WHICH IS MIDNIGHT IN KARACHI ──────────────────────────────
 * vercel.json cannot carry a comment, so the reasoning lives here. The owner
 * asked for 12 AM and meant their own midnight. This job used to run at 02:00
 * UTC, which is 07:00 in Karachi — the team would have arrived before the day's
 * work existed. Karachi is UTC+5, so 19:00 UTC is 00:00 the following Karachi
 * day, and `isoDateIn` is what turns that instant into the right date.
 *
 * The digest at 04:00 UTC still runs AFTER this, which is the order that
 * matters: a digest describing a day whose tasks do not exist yet would land in
 * every inbox saying there was nothing to do.
 *
 * ── IT IS SAFE TO CALL TWICE ────────────────────────────────────────────────
 * Cron delivery is at-least-once. `runRepeatsFor` checks whether each series
 * already has an instance on the day, so a retry creates nothing.
 *
 * ── IT IS NOT PUBLIC ────────────────────────────────────────────────────────
 * An open endpoint that writes tasks is a vandalism tool. The caller presents
 * `CRON_SECRET` as a bearer token, compared in constant time. With no secret
 * configured it refuses rather than defaulting to open.
 * ========================================================================= */

function secretMatches(provided: string, expected: string): boolean {
  /* Hashed first so both sides are 32 bytes — `timingSafeEqual` throws on a
     length mismatch, and guarding that by hand reintroduces the early return the
     function exists to avoid. Same helper as the digest, same reasoning. */
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The repeat runner is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  /* ⚠️ The division's own day, not the server's. At 19:00 UTC the Karachi date
     is already tomorrow, which is precisely the day being generated — reading
     UTC here would generate yesterday's work every night. */
  const day = isoDateIn(nowMs());

  const results = await runRepeatsFor(day);
  const created = results.filter((r) => r.createdTaskId !== null).length;

  return NextResponse.json({
    ok: true,
    day,
    series: results.length,
    created,
    results,
  });
}
