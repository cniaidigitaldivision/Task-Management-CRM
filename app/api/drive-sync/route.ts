import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { auditAlone } from '@/lib/db/queries/audit';
import { superAdminId } from '@/lib/db/queries/documents';
import { notifySelf } from '@/lib/db/queries/feed';
import { withUser } from '@/lib/db/client';
import { describeDrive } from '@/lib/drive/client';
import { runDriveSync } from '@/lib/drive/sync';

/* ============================================================================
 * THE DRIVE FOLDER WATCH — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * *"Watch one parent folder, poll every few minutes."* This is the endpoint a
 * scheduler calls. The work itself is `lib/drive/sync.ts`, shared with the
 * "Check now" button — so the two cannot drift, and neither is the authority.
 *
 * ── WHY A ROUTE RATHER THAN A TIMER INSIDE THE APPLICATION ───────────────────
 * Same reasoning as `/api/digest`, which this deliberately mirrors: there is no
 * long-running process here to own a `setInterval`, and there should not be. A
 * serverless instance can be replaced between any two requests, so an in-process
 * timer would fire an unpredictable number of times — nought on a cold platform,
 * several with several instances warm.
 *
 * ── ⚠️ IT IS NOT PUBLIC, AND REFUSES RATHER THAN DEFAULTING TO OPEN ──────────
 * `CRON_SECRET` as a bearer token, compared in constant time. With no secret
 * configured it answers 503, not 200 — the failure mode is "off", never "public".
 *
 * A plain `===` on a secret leaks its length and then its content to anybody
 * willing to measure, which for a URL reachable from the internet is not
 * theoretical. Both sides are hashed to 32 bytes first so `timingSafeEqual` never
 * sees a length mismatch — its own throw on that would reintroduce exactly the
 * early return it exists to avoid.
 *
 * ── IT RUNS AS THE SUPER ADMIN, NOT AS AN ELEVATED IDENTITY ──────────────────
 * A draft project needs an owner and a creator, and a scheduled request has
 * nobody. Rather than bypass row-level security — which would make this the one
 * write path in the application outside the policy — it acts as the Super Admin,
 * who is guaranteed to exist for the life of the database (BR-028,
 * `users_single_super_admin_idx`). See `superAdminId()` for why not the person who
 * configured the watch.
 *
 * ── SAFE TO OVERLAP WITH ITSELF AND WITH THE BUTTON ──────────────────────────
 * `projects.drive_folder_id` is unique and the insert is
 * `on conflict do nothing`, so a folder that already has a project is skipped.
 * Two runs at once therefore produce one project, not two — which matters because
 * they WILL overlap: somebody presses Check now while a scheduled run is in flight
 * and neither knows about the other.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** See the note above on why both sides are hashed before comparing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The Drive watch endpoint is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  /* Checked before doing anything, so an unconfigured Drive answers plainly
     instead of failing inside the sync every few minutes. 200, not an error: the
     schedule is working correctly and there is simply nothing connected. */
  const drive = describeDrive();
  if (!drive.configured) {
    return NextResponse.json({
      ok: true,
      skipped: 'Google Drive is not connected. See docs/GOOGLE-DRIVE-SETUP.md.',
    });
  }

  const actorId = await superAdminId();
  if (!actorId) {
    /* Only reachable before first-run setup, or if the Super Admin were
       deactivated — which migration 005's trigger refuses. Worth answering
       honestly rather than crashing. */
    return NextResponse.json(
      { error: 'No active Super Admin, so nothing can own a draft project.' },
      { status: 503 },
    );
  }

  const result = await runDriveSync(actorId);

  if (!result.ok) {
    /* Recorded on `drive_sync` by the sync itself, so the Documents screen shows
       the reason. 200 because the ENDPOINT worked: answering 500 would make a
       cron dashboard show a failing job for a folder somebody has not shared yet,
       which sends people to look in the wrong place. */
    return NextResponse.json({ ok: false, error: result.error });
  }

  /* Only audited and announced when something happened. A row every few minutes
     saying "nothing new" would bury the audit log in noise and make the one entry
     that matters unfindable — the same reasoning that keeps `activity_log` and
     `audit_log` separate. */
  if (result.created > 0) {
    await withUser(actorId, async (tx) => {
      await notifySelf(tx, {
        userId: actorId,
        kind: 'security_alert',
        title: `${result.created} draft ${result.created === 1 ? 'project' : 'projects'} from Drive`,
        body: `${result.names.join(', ')} — set a type and owner to confirm.`,
        linkTo: '/projects',
      });
    }).catch(() => undefined);

    await auditAlone(
      /* The email and role are copied onto the audit row rather than joined, so
         the entry says what was true when it happened. `system@` names what
         actually did it: attributing a scheduled run to the Super Admin's own
         address would read as though they had pressed something. */
      { id: actorId, email: 'system@cron', role: 'super_admin' },
      {
        entityType: 'project',
        entityId: null,
        action: 'drive.projects_drafted',
        after: { created: result.created, names: result.names, trigger: 'cron' },
      },
    ).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    examined: result.examined,
    created: result.created,
    names: result.names,
  });
}
