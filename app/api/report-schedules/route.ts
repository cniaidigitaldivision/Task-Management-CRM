import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runDueSchedules } from '@/lib/reports/schedule-runner';

/* ============================================================================
 * THE SCHEDULED-REPORT RUNNER
 * ----------------------------------------------------------------------------
 * Files every report whose schedule is due. The Studio's Reports & Exports tab
 * tells people a scheduled report *"files itself into the Reports tab on its due
 * date"*, and this is what makes that sentence true.
 *
 * ── ⚠️ ONCE A DAY AT 19:05 UTC = 00:05 KARACHI ─────────────────────────────
 * vercel.json cannot carry a comment, so the reasoning lives here. The finest
 * cadence a schedule can have is daily, so running more often would re-read the
 * same rows and find nothing due. Just after midnight local means a report
 * covering "yesterday" is waiting before anybody arrives.
 *
 * ⚠️ FIVE MINUTES PAST, NOT ON THE HOUR, and the offset is deliberate: the
 * repeat-task runner is registered at 19:00 and creates the day's recurring
 * tasks. A daily report firing at the same instant would be composing yesterday
 * while that job writes today — two jobs contending for the same connection pool
 * over the same tables, for no benefit. Five minutes costs nobody anything.
 *
 * ── ⚠️ WHY IT ALWAYS RETURNS 200, EVEN WHEN SCHEDULES FAILED ───────────────
 * A per-schedule failure is a RESULT, not a request error. Vercel Cron retries a
 * non-2xx, and retrying is exactly wrong here: the schedules that already filed
 * would file a SECOND report — `project_reports` is append-only and a redo is
 * legitimate, so nothing would stop the duplicate — while the broken one fails
 * identically. The failures are in the body and on `report_schedules.last_error`,
 * which is what the page reads.
 *
 * A 500 is reserved for the runner being unable to run at all, which IS worth
 * retrying.
 *
 * ── ⚠️ SAFE TO CALL TWICE ON THE SAME DAY ──────────────────────────────────
 * Cron delivery is at-least-once. `app.record_schedule_run` advances
 * `next_run_on` before the next tick can see the row, so a second delivery finds
 * nothing due — the guard is the due date, not an in-memory lock.
 *
 * ── NOT PUBLIC ─────────────────────────────────────────────────────────────
 * Same guard as the Meta sync and the repeat runner: `CRON_SECRET` as a bearer
 * token, compared in constant time, refusing outright when no secret is
 * configured rather than defaulting to open.
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
      { error: 'CRON_SECRET is not configured. Scheduled reports are disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  try {
    const results = await runDueSchedules();

    return NextResponse.json({
      ok: true,
      due: results.length,
      filed: results.filter((r) => r.outcome === 'ok').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'The scheduled reports could not run.',
      },
      { status: 500 },
    );
  }
}
