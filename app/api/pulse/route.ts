import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { notificationPulse } from '@/lib/db/queries/feed';

/* ============================================================================
 * "HAS ANYTHING HAPPENED TO ME?"
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"in the team member dashboard to whom the task is
 * assigned… without refreshing it should display silently. If he forgets to
 * refresh, he doesn't know a new task has arrived."*
 *
 * `components/layout/live-refresh.tsx` asks this every 25 seconds and calls
 * `router.refresh()` only when the answer changes.
 *
 * ── ⚠️ WHY A POLL RATHER THAN A LIVE SOCKET ─────────────────────────────────
 * Supabase Realtime would push instead of ask, and it is the better answer at a
 * different size. It needs the table published to the realtime schema, a
 * channel per client, and its own RLS reasoning — a second authorisation
 * surface beside the one this product already has. Against that: nine people,
 * one office, and a question whose answer is almost always "nothing". Two small
 * aggregates on an indexed table costs less than the machinery would.
 *
 * ── ⚠️ IT RETURNS A READING, NOT DATA ───────────────────────────────────────
 * A count and a timestamp. No titles, no ids, nothing about a task. The page
 * re-reads itself through the ordinary server render — with the ordinary RLS —
 * when the reading moves, so this endpoint cannot become a way to see anything.
 *
 * ── ⚠️ NEVER CACHED ─────────────────────────────────────────────────────────
 * A cached pulse is a pulse that never changes. Explicitly dynamic, and
 * `no-store` on the way out, so neither Next nor a CDN can hold it.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  /* ⚠️ `getCurrentUser`, not `requireUser`. This runs on a timer, and a session
     that has expired in another tab must answer "nothing to say" rather than
     throw a redirect at a background fetch — which would log an error every 25
     seconds for somebody who has simply signed out. `getCurrentUser` returns
     null on anything unexpected, which is the behaviour a poller wants. */
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { signedIn: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const pulse = await notificationPulse(user.id);

  return NextResponse.json(
    { signedIn: true, ...pulse },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
