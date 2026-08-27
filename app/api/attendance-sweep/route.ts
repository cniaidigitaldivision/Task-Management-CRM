import { NextResponse } from 'next/server';

import { cronRequestIsAuthorised } from '@/lib/cron-auth';
import {
  alreadyNotified,
  attendanceNow,
  monthForSweep,
  notify,
  openDaysUpTo,
} from '@/lib/db/queries/attendance';
import {
  CHASE_AFTER_MINUTES,
  LATE_AFTER_MINUTES,
  LATE_STRIKES_BEFORE_NOTICE,
  clockLabel,
  localMinutes,
  monthOf,
  needsCheckoutChase,
  reachedLateStrike,
} from '@/lib/domain/attendance';
import { lateArrivalsEmail, missedCheckoutEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { shortDate } from '@/lib/view/attendance-board';

/* ============================================================================
 * THE ATTENDANCE SWEEP
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, asked for two automatic messages:
 *
 *   *"if someone forgets to check out, then also send a reminder and auto-send
 *    mail to them… after 9 pm, it should show a notification to everyone if they
 *    didn't check out"*
 *
 *   *"If someone is coming late for the third time, there must be a notification:
 *    'You are coming late for the third time.'"*
 *
 * Both land as an in-app notification AND an email. WhatsApp is explicitly later:
 * *"Right now we didn't send a WhatsApp message but later on definitely we will
 * integrate it."*
 *
 * ── WHY A ROUTE AND NOT A SCHEDULER ─────────────────────────────────────────
 * There is no cron in this application, and adding one would mean a long-running
 * process to own it. This is a route something else calls on a timetable — the same
 * shape as app/api/digest. Call it hourly from 21:00 Karachi; calling it more often
 * is harmless (see below) and calling it in the afternoon does nothing.
 *
 * ── ⚠️ IT IS IDEMPOTENT, AND THAT IS NOT OPTIONAL HERE ──────────────────────
 * The digest route's answer to being called twice is "it sends two emails, so the
 * schedule must be right". That is acceptable for a morning summary and NOT for a
 * nag: four reminders about one forgotten check-out is how somebody learns to
 * filter this address. So before each message it asks whether one of that kind has
 * already gone to that person in the window, and the notifications table is the
 * record it asks. An hourly schedule therefore sends exactly one of each.
 *
 * ── ⚠️ IT RUNS AS NOBODY, AND ONLY READS WHAT IT MUST ───────────────────────
 * Unlike the digest — which builds each person's mail inside `withUser(theirId)` so
 * RLS decides its contents — a sweep has no user to be. There is no session to
 * scope it to, and running it as whichever Admin happened to be configured would
 * make the reminder list depend on that choice. So its two queries are written to
 * return only what a reminder needs: a name, an address, a date and a time.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** How far back to look for an identical message before sending another. */
const NAG_WINDOW_HOURS = 12;

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronRequestIsAuthorised(request)) {
    /* 404, not 403: an unauthenticated caller learns nothing about whether this
       endpoint exists. Same choice as the other scheduled routes. */
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  /* ── ⚠️ `?dryRun=1` SENDS NOTHING ─────────────────────────────────────────
     Added before this route was ever fired, for a specific reason: the demo seed
     writes about twenty days with no check-out, so the FIRST real run would email
     six people about days they never worked. A dry run does every query and every
     decision and reports exactly who would be told, which is the only safe way to
     look at that before it happens.

     It is also how to check the sweep after changing it, at any hour, without
     wondering whether somebody just got mail. */
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const now = await attendanceNow();
  const month = monthOf(now.today);

  const sent = { checkout: 0, late: 0 };
  /** Who a dry run WOULD have told, by name. Empty on a real run. */
  const would = { checkout: [] as string[], late: [] as string[] };
  const skipped = { checkout: 0, late: 0 };
  const failed: string[] = [];

  /* ── 1. Days that were never closed ─────────────────────────────────────
     ⚠️ Yesterday and earlier are chased at ANY hour, but today only after 9pm.
     The owner is explicit that working until one or two in the morning is normal,
     so a reminder at 18:30 would be telling people off for being at their desks. */
  const open = await openDaysUpTo(now.today);
  const since = new Date(Date.now() - NAG_WINDOW_HOURS * 3_600_000).toISOString();

  for (const day of open) {
    if (
      !needsCheckoutChase({
        onDate: day.onDate,
        checkedInAt: day.checkedInAt,
        checkedOutAt: null,
        today: now.today,
        nowMinutes: now.nowMinutes,
      })
    ) {
      continue;
    }

    if (await alreadyNotified(day.userId, 'attendance_missing_checkout', since)) {
      skipped.checkout += 1;
      continue;
    }

    const dayLabel = shortDate(day.onDate);
    if (dryRun) {
      would.checkout.push(`${day.name} — ${dayLabel}`);
      continue;
    }

    try {
      await notify({
        userId: day.userId,
        kind: 'attendance_missing_checkout',
        title: `You did not check out on ${dayLabel}`,
        body: `You checked in at ${clockLabel(day.checkedInAt)} and the day is still open, so no hours are recorded against it. An Admin can set the time you actually left.`,
        linkTo: '/attendance',
      });

      if (day.email) {
        await sendEmail({
          to: day.email,
          ...missedCheckoutEmail({
            fullName: day.name,
            dayLabel,
            checkedInLabel: clockLabel(day.checkedInAt),
            appUrl,
          }),
        });
      }
      sent.checkout += 1;
    } catch (error) {
      /* ⚠️ Collected, not thrown. One bad address must not stop the rest of the
         sweep — the person whose reminder failed is the one who least needs the
         whole run abandoned. */
      failed.push(`checkout/${day.name}: ${String((error as Error).message).slice(0, 80)}`);
    }
  }

  /* ── 2. The third late arrival of the month ──────────────────────────────
     ⚠️ Counted here from the raw times rather than read from anywhere, because
     "late" is one rule (`LATE_AFTER_MINUTES`) and this must be the same answer the
     page shows. The month is a calendar month, resetting on the 1st — the owner's
     choice, so the number in the message matches the number on the screen. */
  const rows = await monthForSweep(month);
  const lateByPerson = new Map<string, { name: string; email: string; count: number }>();

  for (const row of rows) {
    const minutes = localMinutes(row.checkedInAt);
    if (minutes === null || minutes <= LATE_AFTER_MINUTES) continue;
    const entry = lateByPerson.get(row.userId) ?? { name: row.name, email: row.email, count: 0 };
    entry.count += 1;
    lateByPerson.set(row.userId, entry);
  }

  /* Once per person per calendar month: the window starts at the 1st, so a second
     message this month is never sent however often the sweep runs. */
  const monthStart = `${month}-01T00:00:00.000Z`;

  for (const [userId, person] of lateByPerson) {
    if (!reachedLateStrike(person.count)) continue;

    if (await alreadyNotified(userId, 'attendance_late_streak', monthStart)) {
      skipped.late += 1;
      continue;
    }

    if (dryRun) {
      would.late.push(`${person.name} — ${person.count} late`);
      continue;
    }

    try {
      await notify({
        userId,
        kind: 'attendance_late_streak',
        title: `You have arrived late ${person.count} times this month`,
        body: `Anything after ${lateLabel()} counts as late. The count resets on the 1st. You can see the exact times on your attendance page.`,
        linkTo: '/attendance',
      });

      if (person.email) {
        await sendEmail({
          to: person.email,
          ...lateArrivalsEmail({
            fullName: person.name,
            lateCount: person.count,
            monthLabel: monthLabel(month),
            lateAfterLabel: lateLabel(),
            appUrl,
          }),
        });
      }
      sent.late += 1;
    } catch (error) {
      failed.push(`late/${person.name}: ${String((error as Error).message).slice(0, 80)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    at: now.today,
    nowMinutes: now.nowMinutes,
    /* Stated so a scheduler's log says why a run was quiet rather than looking
       broken. */
    chasingCheckouts: now.nowMinutes >= CHASE_AFTER_MINUTES,
    strikeThreshold: LATE_STRIKES_BEFORE_NOTICE,
    dryRun,
    sent,
    would,
    skipped,
    failed,
  });
}

/** `10:30 AM` — the rule, from the constant rather than typed out again. */
function lateLabel(): string {
  const h = Math.floor(LATE_AFTER_MINUTES / 60);
  const m = LATE_AFTER_MINUTES % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const MONTHS = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `August 2026`. Assembled, never formatted — see lib/now.ts. */
function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m)] ?? ''} ${year}`.trim();
}
