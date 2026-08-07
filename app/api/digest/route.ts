import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { sql } from '@/lib/db/client';
import { listTasks } from '@/lib/db/queries/tasks';
import { listPendingExtensions } from '@/lib/db/queries/task-relations';
import { teamWorkload } from '@/lib/db/queries/workload';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';
import { buildDigest, digestText, type DigestTask } from '@/lib/domain/digest';
import { mergePrefs, wantsEmail } from '@/lib/domain/notification-prefs';
import { sendEmail } from '@/lib/email/send';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * THE DAILY DIGEST ENDPOINT — FR-081
 * ----------------------------------------------------------------------------
 * ── WHY A ROUTE AND NOT A SCHEDULER ──────────────────────────────────────────
 * There is no cron in this application and adding one would mean a long-running
 * process to own it. This is a route Vercel Cron (or anything else that can
 * make an HTTPS request) calls once a morning. It is idempotent in the way that
 * matters: calling it twice sends two emails, so the schedule is the thing that
 * must be right, and the schedule lives in one place.
 *
 * ── IT IS NOT PUBLIC ─────────────────────────────────────────────────────────
 * An open endpoint that emails the whole division is a spam cannon with a
 * company logo on it. The caller must present `CRON_SECRET` as a bearer token,
 * compared in constant time — a plain `===` on a secret leaks its length and
 * then its content to anybody willing to measure, which for an endpoint
 * reachable from the internet is not theoretical.
 *
 * With no secret configured it refuses outright rather than defaulting to open.
 *
 * ── IT RUNS AS EACH PERSON, ONE AT A TIME ────────────────────────────────────
 * Not as an elevated identity gathering everything and slicing it up. Each
 * digest is built inside `withUser(theirId)`, so RLS decides what goes in it —
 * a Member's digest cannot contain a task they are not on, because the query
 * that built it could not see one. That is slower and it is the only version
 * where a bug in this file cannot leak somebody's work into somebody else's
 * inbox.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/**
 * Constant-time comparison, via SHA-256 and `timingSafeEqual`.
 *
 * The digests are always 32 bytes, which removes the length problem entirely —
 * `timingSafeEqual` throws on a length mismatch, and any hand-written guard for
 * that reintroduces exactly the early return the function exists to avoid. The
 * hashing is not for secrecy; it is to make both sides the same size.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. The digest endpoint is disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const now = nowMs();
  const today = new Date(now).toISOString().slice(0, 10);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  /* The one query that runs outside an identity, and it reads only who exists —
     the same bootstrap the integration tests use, and for the same reason: it
     is looking up WHO the identities are. */
  const recipients = await sql`
    select id, full_name, email, role, notification_prefs
      from public.users
     where is_active and account_state = 'active'
  `;

  let sent = 0;
  let skipped = 0;

  for (const person of recipients) {
    const userId = person.id as string;
    const prefs = mergePrefs(person.notification_prefs);

    /* `task_due_soon` is the switch that governs this. Somebody who has turned
       off email for it has said, in as many words, that they do not want a
       morning list of what is due. */
    if (!wantsEmail(prefs, 'task_due_soon')) {
      skipped += 1;
      continue;
    }

    try {
      const [assigned, reviews, extensions] = await Promise.all([
        listTasks(userId, { assigneeId: userId, includeClosed: false, limit: 200 }),
        listTasks(userId, { statuses: ['in_review'], includeClosed: false, limit: 50 }),
        listPendingExtensions(userId),
      ]);

      const toDigestTask = (task: (typeof assigned)[number]): DigestTask => ({
        reference: task.reference,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        projectName: task.projectName,
      });

      /* BR-002: nobody reviews their own work, so their own submissions are not
         "waiting for your review". */
      const awaiting = reviews
        .filter((task) => task.assigneeId !== userId)
        .map(toDigestTask);

      let utilisationPct: number | null = null;
      if (person.role !== 'member') {
        const { people } = await teamWorkload(userId, now);
        utilisationPct = people.find((p) => p.userId === userId)?.workload.utilisationPct ?? null;
      }

      const digest = buildDigest({
        fullName: person.full_name as string,
        today,
        assigned: assigned.map(toDigestTask),
        awaitingYourReview: person.role === 'member' ? [] : awaiting,
        pendingExtensions: extensions.length,
        utilisationPct,
      });

      /* The rule this endpoint exists to respect. A morning email saying
         "nothing needs you" is how the important one gets deleted unread. */
      if (!digest.isWorthSending) {
        skipped += 1;
        continue;
      }

      await sendEmail({
        to: person.email as string,
        subject: `${digest.headline} — ${SYSTEM_DEFAULTS.teamTimezone.split('/')[1] ?? 'today'}`,
        html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(
          digestText(digest, person.full_name as string, appUrl),
        )}</pre>`,
        text: digestText(digest, person.full_name as string, appUrl),
      });

      sent += 1;
    } catch {
      /* One person's digest failing must not stop everybody else's. */
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, considered: recipients.length });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
