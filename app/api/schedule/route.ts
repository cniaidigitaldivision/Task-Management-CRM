import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { listSchedulableProjects } from '@/lib/db/queries/schedule';
import { isoDateIn, nowMs } from '@/lib/now';
import { generateForProject, type GenerateOutcome } from '@/lib/schedule/run';

/* ============================================================================
 * THE NIGHTLY SCHEDULE TOP-UP — owner request 2026-08-22
 * ----------------------------------------------------------------------------
 * *"daily tasks should be automatically created."*
 *
 * Phase 1 made a person press a button. This is the same function on a timer.
 * It shares `lib/schedule/run.ts` with the button rather than reimplementing it,
 * so there is exactly one description of what a day's work should look like.
 *
 * ── WHY A ROUTE AND NOT A SCHEDULER ──────────────────────────────────────────
 * Same reasoning as `app/api/digest/route.ts`: there is no long-running process
 * in this application to own a cron, and adding one to create a few rows a night
 * would be the largest piece of infrastructure in the system. This is a URL that
 * Vercel Cron calls; the schedule lives in vercel.json.
 *
 * ── ⚠️ 02:00 UTC, AND THE ORDER MATTERS ──────────────────────────────────────
 * vercel.json cannot carry a comment, so the reasoning lives here. The digest
 * runs at 04:00 and reports on what is due. If this ran after it, the digest
 * would describe a day whose tasks did not exist yet and land in everyone's
 * inbox saying there was nothing to do. Two hours is slack for a slow run, not
 * a measurement.
 *
 * ── ⚠️ IT IS SAFE TO CALL TWICE, AND THAT IS LOAD-BEARING ────────────────────
 * Cron delivery is at-least-once. A run that times out halfway may be retried,
 * and Vercel makes no promise it will not fire twice. The generator tops each
 * day UP to its planned count rather than inserting a fresh set, so a second
 * call in the same night creates nothing. Without that property this endpoint
 * would quietly double a month's work and nobody would notice until the board
 * was unusable.
 *
 * ── IT IS NOT PUBLIC ─────────────────────────────────────────────────────────
 * An open endpoint that writes tasks into every project is a vandalism tool. The
 * caller presents `CRON_SECRET` as a bearer token, compared in constant time.
 * With no secret configured it refuses rather than defaulting to open.
 *
 * ── EACH PROJECT RUNS AS ITS OWNER ───────────────────────────────────────────
 * Not as an elevated identity writing everywhere. The only elevated read is the
 * list of project ids; every insert goes through `withUser(ownerId)` and is
 * admitted by the `tasks_insert` policy, which accepts an unassigned task from
 * anybody who can see the project. A bug in this file therefore cannot write
 * into a project its owner could not already write into.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/**
 * How far ahead to keep the calendar filled.
 *
 * ── ⚠️ NOT ONE DAY ───────────────────────────────────────────────────────────
 * "Create tomorrow's tasks" is the obvious reading and it makes a board nobody
 * can plan against: a Coordinator arriving on Monday would see Tuesday and
 * nothing else, so the whole point of an agreed rhythm — knowing what is coming
 * — is lost to the automation that was meant to serve it.
 *
 * A fortnight is far enough to plan a week and reassign work, and near enough
 * that a rhythm changed today shows up in the calendar within the fortnight
 * rather than sitting behind three months of already-created tasks. Nothing
 * breaks at other values; this is a judgement, not a constraint.
 */
const HORIZON_DAYS = 14;

function secretMatches(provided: string, expected: string): boolean {
  /* Hashed first so both sides are 32 bytes — `timingSafeEqual` throws on a
     length mismatch, and guarding that by hand reintroduces the early return the
     function exists to avoid. Same helper as the digest, same reasoning. */
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The division's own day — see `isoDateIn`. Was UTC, which at 02:00 UTC (the
 *  hour this job runs) is still the PREVIOUS day in Karachi, so the horizon was
 *  computed from yesterday and the last day of a month could be missed. */
const isoDay = (atMs: number) => isoDateIn(atMs);

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The schedule endpoint is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const now = nowMs();
  const from = isoDay(now);
  const to = isoDay(now + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const projects = await listSchedulableProjects();

  /* ── SEQUENTIAL ACROSS PROJECTS TOO ────────────────────────────────────────
     Each project already creates its tasks one at a time to stay off the
     reference counter. Running the projects themselves in parallel would put
     that back — several projects sharing one type prefix contend for the same
     counter row — and a nightly job has no deadline worth the contention. */
  const results: GenerateOutcome[] = [];
  let created = 0;
  let failed = 0;

  for (const project of projects) {
    try {
      const outcome = await generateForProject(project.ownerId, project.id, from, to);
      results.push(outcome);
      created += outcome.created;
    } catch (error) {
      /* One project's failure must not abandon the rest — a single incoherent
         rhythm should not cost every other project its schedule. Reported in the
         response body so a failing project is visible rather than silent. */
      failed += 1;
      results.push({
        projectId: project.id,
        projectName: project.name,
        created: 0,
        skipped: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    window: { from, to },
    projects: projects.length,
    created,
    failed,
    results,
  });
}
