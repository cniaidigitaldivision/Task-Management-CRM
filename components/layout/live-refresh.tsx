'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/* ============================================================================
 * THE PAGE KEEPS UP WITHOUT BEING REFRESHED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"in the team member dashboard to whom the task is
 * assigned, one thing is that it shows a notification in the notification bell.
 * Second without refreshing it should display silently in the To-do task… if he
 * forgets to refresh, he doesn't know a new task has arrived."*
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 * Ask `/api/pulse` — one count and one timestamp over the caller's own
 * notifications — and when the reading MOVES, call `router.refresh()`.
 *
 * `router.refresh()` re-runs the server render for whatever page is open and
 * swaps the result in. It is not a reload: scroll position, open dialogs, typed
 * text and every other piece of client state survive. So a Member sitting on
 * their board sees the new task appear in To Do, and the bell's count change,
 * without anything under their hands moving.
 *
 * ── ⚠️ WHY THE PULSE IS ASKED FIRST, RATHER THAN JUST REFRESHING ────────────
 * `router.refresh()` re-runs EVERY query the current page makes. On the daily
 * board or the dashboard that is a lot of work to discover nothing has changed,
 * multiplied by every open tab in the office. The pulse is two aggregates on an
 * indexed table and answers "no" almost every time.
 *
 * ── ⚠️ IT STOPS WHEN THE TAB IS HIDDEN ──────────────────────────────────────
 * Load-bearing rather than tidy. Browsers keep background timers running for a
 * long while, and this product is used with several tabs open all day: without
 * this, eight forgotten tabs would each poll every 25 seconds for hours.
 * Returning to a tab asks IMMEDIATELY, which is also the moment somebody most
 * wants to be up to date.
 *
 * ── ⚠️ AND IT NEVER REFRESHES ON THE FIRST ANSWER ───────────────────────────
 * The first reading is a baseline, not a change. Refreshing on it would make
 * every page load twice — once from the navigation and once from this — which
 * is exactly the wasteful behaviour the client cache was added to remove.
 * ========================================================================= */

/* Long enough that the office's tabs are not a load problem, short enough that
   "a task has arrived" is news rather than history. */
const EVERY_MS = 25_000;

interface Pulse {
  signedIn: boolean;
  unread?: number;
  latest?: string | null;
}

export function LiveRefresh() {
  const router = useRouter();

  React.useEffect(() => {
    /* The last reading, as a string to compare. A ref rather than state: this
       must not cause a render of its own, and nothing draws it. */
    const seen = { at: null as string | null };
    let stopped = false;

    const ask = async () => {
      if (stopped || document.visibilityState !== 'visible') return;

      try {
        const response = await fetch('/api/pulse', { cache: 'no-store' });
        if (!response.ok) return;

        const pulse = (await response.json()) as Pulse;
        if (!pulse.signedIn) return;

        const reading = `${pulse.unread ?? 0}:${pulse.latest ?? ''}`;

        if (seen.at === null) {
          /* Baseline. See the header — the first answer is not news. */
          seen.at = reading;
          return;
        }

        if (seen.at !== reading) {
          seen.at = reading;
          router.refresh();
        }
      } catch {
        /* Offline, a dropped connection, a deploy swapping underneath: the next
           tick asks again. A failed poll must never surface to somebody who did
           not ask for it — they are working, not watching this. */
      }
    };

    const timer = setInterval(() => void ask(), EVERY_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', onVisible);

    /* The opening baseline, so the first real change is detected rather than
       waiting a full interval to establish what "unchanged" means. */
    void ask();

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
