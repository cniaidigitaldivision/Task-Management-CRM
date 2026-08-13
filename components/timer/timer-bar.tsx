'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pause, Timer } from 'lucide-react';

import {
  pauseTimerAction,
  recordTimerAlertAction,
  runningTimersAction,
} from '@/app/actions/tasks';
import {
  MAX_CONCURRENT_TIMERS,
  formatElapsed,
  formatRemaining,
  readTimer,
  type RunningTimer,
} from '@/lib/domain/timers';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE TIMER BAR — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * *"A small clock displayed on top of the navbar. When I hover on that clock it
 * shows what is running… send a notification instantly, like 10 minutes left,
 * 5 minutes left."*
 *
 * Up to three chips in the top bar, on every page. The point of it being always
 * visible is the whole point of the feature: a running timer nobody can see is how
 * a clock gets left on overnight, and this system does not stop one by itself.
 *
 * ── THE COUNTDOWN IS COMPUTED HERE, THE ELAPSED TIME IS NOT ──────────────────
 * The server sends `startedAt` — the database's own clock — and this ticks against
 * it once a second. What it never does is send elapsed time back: `pauseTimer`
 * computes the banked minutes in SQL from `timer_started_at` to `now()`, so a
 * browser cannot write its own time sheet, and clock skew (22 seconds, measured in
 * registry C-19) cannot creep into recorded time.
 *
 * So this component is a display over a server fact. If it were closed all day the
 * banked time would be identical.
 *
 * ── WHY IT POLLS, AND WHY SLOWLY ─────────────────────────────────────────────
 * Ticking is local and costs nothing. Polling exists only to notice a timer
 * started or paused in ANOTHER tab, which is why it is every 60 seconds rather
 * than every second — and why every action here refetches immediately rather than
 * waiting for the next poll.
 * ========================================================================= */

/** How often to re-ask the server what is running. See the note above. */
const POLL_MS = 60_000;

export function TimerBar({ initialTimers }: { initialTimers: readonly RunningTimer[] }) {
  const router = useRouter();
  const [timers, setTimers] = React.useState<readonly RunningTimer[]>(initialTimers);

  /* Ticks the display. Held in state rather than read during render so the render
     stays pure — the same reason the calendar takes `todayIso` as a prop. */
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const result = await runningTimersAction();
      setTimers(result.timers as readonly RunningTimer[]);
    } catch {
      /* A failed poll keeps the last known set ticking. Clearing the bar because
         one request failed would look as though the timers had stopped. */
    }
  }, []);

  React.useEffect(() => {
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  /* ── DELIVERING THE COUNTDOWN ALERTS ──────────────────────────────────────
     This browser notices the threshold; the SERVER decides whether the alert is
     genuinely outstanding (`app.timer_mark_alert`) and returns true only for the
     caller that recorded it. So two open tabs cannot both notify, and neither can
     a reload.

     `sent` is a local guard on top of that, to stop this effect firing the same
     request repeatedly in the seconds before the server's answer comes back and
     the refetched `alertsSent` arrives. */
  const sent = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const due: Array<{ taskId: string; alert: string }> = [];

    for (const timer of timers) {
      for (const alert of readTimer(timer, now).alertsDue) {
        const key = `${timer.taskId}:${timer.startedAt}:${alert}`;
        if (sent.current.has(key)) continue;
        sent.current.add(key);
        due.push({ taskId: timer.taskId, alert });
      }
    }

    if (due.length === 0) return;

    void (async () => {
      for (const item of due) {
        try {
          await recordTimerAlertAction(item.taskId, item.alert);
        } catch {
          /* Let it be retried on the next tick rather than lost. */
          sent.current.delete(`${item.taskId}:${item.alert}`);
        }
      }
      /* Brings back the updated `alertsSent`, and refreshes the bell count. */
      await refresh();
      router.refresh();
    })();
  }, [timers, now, refresh, router]);

  const pause = async (taskId: string) => {
    setBusy(taskId);
    try {
      await pauseTimerAction(taskId);
      await refresh();
      router.refresh();
    } catch {
      /* The next poll will show the truth either way. */
    } finally {
      setBusy(null);
    }
  };

  /* Nothing running is nothing to show. An empty "0 timers" chip is furniture in
     the busiest strip of the interface. */
  if (timers.length === 0) return null;

  const readings = timers.map((timer) => ({ timer, reading: readTimer(timer, now) }));
  const anyOver = readings.some((r) => r.reading.overLimit);
  const anySuspect = readings.some((r) => r.reading.suspect);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* The clock the owner asked for. Its title is the hover summary, so the
          whole set is readable without opening anything. */}
      <span
        className={cn(
          'hidden shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 sm:inline-flex',
          anyOver || anySuspect ? 'text-text-primary' : 'text-text-secondary',
        )}
        title={readings
          .map(
            ({ timer, reading }) =>
              `${timer.reference} · ${formatElapsed(reading.minutesSpent)}${
                formatRemaining(reading.minutesRemaining)
                  ? ` · ${formatRemaining(reading.minutesRemaining)}`
                  : ''
              }`,
          )
          .join('\n')}
      >
        {anyOver || anySuspect ? (
          <AlertTriangle
            className="h-3.5 w-3.5"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--feedback-error)' }}
          />
        ) : (
          <Timer className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        )}
        <span className="tabular text-micro font-semibold">
          {timers.length}/{MAX_CONCURRENT_TIMERS}
        </span>
      </span>

      <ul className="flex min-w-0 items-center gap-1">
        {readings.map(({ timer, reading }) => {
          const remaining = formatRemaining(reading.minutesRemaining);

          return (
            <li key={timer.taskId} className="min-w-0">
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1 rounded-lg border px-1.5 py-1',
                  reading.overLimit || reading.suspect
                    ? 'border-transparent'
                    : 'border-border-default',
                )}
                style={
                  reading.overLimit || reading.suspect
                    ? {
                        backgroundColor:
                          'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                      }
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => router.push(`/tasks?task=${timer.taskId}` as never)}
                  className="flex min-w-0 items-baseline gap-1.5 text-left focus-visible:outline-none"
                  title={[
                    `${timer.reference} · ${timer.title}`,
                    timer.projectName,
                    `${formatElapsed(reading.minutesSpent)} spent`,
                    remaining ?? 'no time limit set',
                    reading.suspect
                      ? 'Running over 12 hours — check this figure before it is reported'
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="font-mono text-micro font-semibold text-text-brand">
                    {timer.reference}
                  </span>
                  <span className="tabular text-micro font-semibold text-text-primary">
                    {formatElapsed(reading.minutesSpent)}
                  </span>
                  {/* Only shown when there IS a limit. A task without one has
                      nothing to count down to, and inventing an allowance would
                      make every warning about a limit nobody set. */}
                  {remaining && (
                    <span
                      className="hidden text-micro lg:inline"
                      style={{
                        color: reading.overLimit
                          ? 'var(--feedback-error)'
                          : reading.minutesRemaining !== null && reading.minutesRemaining <= 10
                            ? 'var(--feedback-warning)'
                            : 'var(--text-tertiary)',
                      }}
                    >
                      {remaining}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  aria-label={`Pause the timer on ${timer.reference}`}
                  title={`Pause ${timer.reference}`}
                  disabled={busy !== null}
                  onClick={() => void pause(timer.taskId)}
                  className="shrink-0 rounded p-0.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none disabled:opacity-45"
                >
                  <Pause className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
