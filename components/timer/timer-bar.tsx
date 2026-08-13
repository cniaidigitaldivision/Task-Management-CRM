'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Pause, Play, Timer } from 'lucide-react';

import {
  pauseTimerAction,
  recordTimerAlertAction,
  runningTimersAction,
  startTimerAction,
  startableTasksAction,
} from '@/app/actions/tasks';
import {
  MAX_CONCURRENT_TIMERS,
  formatElapsed,
  formatRemaining,
  readTimer,
  type RunningTimer,
} from '@/lib/domain/timers';
import { STATUS_META } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/** One row of the picker's "start a timer on" list. */
type Startable = Awaited<ReturnType<typeof startableTasksAction>>['tasks'][number];

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

  /* The picker. Closed by default; opened by the clock. */
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

  const readings = timers.map((timer) => ({ timer, reading: readTimer(timer, now) }));
  const anyOver = readings.some((r) => r.reading.overLimit);
  const anySuspect = readings.some((r) => r.reading.suspect);

  return (
    <div ref={panelRef} className="relative flex min-w-0 items-center gap-1.5">
      {/* ── THE CLOCK IS ALWAYS HERE NOW ─────────────────────────────────────
          Owner, 2026-08-13: *"I can't see the timer option. Where is the timer
          option? The timer should be on the top right so I can select from it."*

          They were right, and the reason was that this whole bar returned null
          when nothing was running — so it only appeared once a timer had been
          started from somewhere else. A control you cannot find until you have
          already used it is not a control.

          It is now always present, and clicking it opens a picker of their own
          tasks, so a timer can be started from here rather than only from a task's
          own screen. */}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          timers.length === 0
            ? 'Timers — none running'
            : `Timers — ${timers.length} of ${MAX_CONCURRENT_TIMERS} running`
        }
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1',
          'transition-colors duration-[120ms] hover:bg-bg-hover focus-visible:outline-none',
          timers.length === 0 ? 'text-text-tertiary' : 'text-text-secondary',
        )}
        title={
          timers.length === 0
            ? 'No timer running — click to start one'
            : readings
                .map(
                  ({ timer, reading }) =>
                    `${timer.reference} · ${formatElapsed(reading.minutesSpent)}${
                      formatRemaining(reading.minutesRemaining)
                        ? ` · ${formatRemaining(reading.minutesRemaining)}`
                        : ''
                    }`,
                )
                .join('\n')
        }
      >
        {anyOver || anySuspect ? (
          <AlertTriangle
            className="h-4 w-4"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--feedback-error)' }}
          />
        ) : (
          <Timer
            className={cn('h-4 w-4', timers.length > 0 && 'text-text-brand')}
            strokeWidth={2.25}
            aria-hidden="true"
          />
        )}
        {/* The count only appears once something is running. "0/3" on an idle
            morning is a number nobody needs. */}
        {timers.length > 0 && (
          <span className="tabular text-micro font-semibold">
            {timers.length}/{MAX_CONCURRENT_TIMERS}
          </span>
        )}
      </button>

      {open && (
        <TimerPicker
          readings={readings}
          onClose={() => setOpen(false)}
          onStarted={async () => {
            await refresh();
            router.refresh();
          }}
          onPause={(id) => void pause(id)}
          busy={busy}
        />
      )}

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

/* ============================================================================
 * THE PICKER
 * ----------------------------------------------------------------------------
 * What is running, and what could be. Owner instruction, 2026-08-13: the timer
 * must be selectable from the top right rather than only from a task's own page.
 *
 * ── IT LOADS ITS LIST WHEN OPENED, NOT WITH THE PAGE ─────────────────────────
 * Fetching fifty of somebody's tasks on every page load, to fill a panel almost
 * nobody opens, is a query for nothing. Mounted on demand by the caller, so
 * opening it is what starts the fetch.
 * ========================================================================= */

function TimerPicker({
  readings,
  onClose,
  onStarted,
  onPause,
  busy,
}: {
  readings: ReadonlyArray<{ timer: RunningTimer; reading: ReturnType<typeof readTimer> }>;
  onClose: () => void;
  onStarted: () => void | Promise<void>;
  onPause: (taskId: string) => void;
  busy: string | null;
}) {
  const [tasks, setTasks] = React.useState<Startable[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void startableTasksAction()
      .then((result) => {
        if (!cancelled) setTasks(result.tasks);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const atLimit = readings.length >= MAX_CONCURRENT_TIMERS;
  /* Anything already running is shown in the section above, so it is not offered
     again below as though it were idle. */
  const runningIds = new Set(readings.map((r) => r.timer.taskId));
  const startable = (tasks ?? []).filter((t) => !runningIds.has(t.taskId));

  const start = async (taskId: string) => {
    setStarting(taskId);
    setError(null);
    try {
      const result = await startTimerAction(taskId);
      if (!result.ok) {
        /* The refusal already names the three running tasks — shown verbatim
           rather than summarised, because knowing WHICH to pause is the point. */
        setError(result.error ?? 'That timer could not be started.');
        return;
      }
      await onStarted();
      onClose();
    } catch {
      setError('The server did not answer.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div
      role="menu"
      className="absolute top-[calc(100%+8px)] right-0 z-50 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-[var(--shadow-xl)]"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <span className="text-caption font-semibold text-text-primary">Timers</span>
        <span className="tabular text-micro text-text-tertiary">
          {readings.length} of {MAX_CONCURRENT_TIMERS} running
        </span>
      </div>

      {error && (
        <p
          className="px-3.5 py-2 text-micro"
          style={{ color: 'var(--feedback-error)', backgroundColor: 'var(--bg-subtle)' }}
        >
          {error}
        </p>
      )}

      {/* ---- Running now ---- */}
      {readings.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {readings.map(({ timer, reading }) => (
            <li key={timer.taskId} className="flex items-center gap-2 px-3.5 py-2.5">
              <span
                aria-hidden="true"
                className="h-6 w-[3px] shrink-0 rounded-full"
                style={{
                  backgroundColor: reading.overLimit
                    ? 'var(--feedback-error)'
                    : 'var(--accent-primary)',
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium text-text-primary">
                  {timer.reference} · {timer.title}
                </span>
                <span className="tabular text-micro text-text-tertiary">
                  {formatElapsed(reading.minutesSpent)}
                  {formatRemaining(reading.minutesRemaining) && (
                    <>
                      {' · '}
                      <span
                        style={{
                          color: reading.overLimit ? 'var(--feedback-error)' : undefined,
                        }}
                      >
                        {formatRemaining(reading.minutesRemaining)}
                      </span>
                    </>
                  )}
                  {reading.suspect && (
                    <span style={{ color: 'var(--feedback-error)' }}> · check this figure</span>
                  )}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Pause ${timer.reference}`}
                disabled={busy !== null}
                onClick={() => onPause(timer.taskId)}
                className="shrink-0 rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none disabled:opacity-45"
              >
                <Pause className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ---- What can be started ---- */}
      <div className="border-t border-border-subtle">
        <p className="px-3.5 pt-2.5 pb-1 text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          {atLimit ? 'Pause one to start another' : 'Start a timer on'}
        </p>

        {tasks === null ? (
          <p className="flex items-center gap-2 px-3.5 pb-3 text-micro text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Reading your work…
          </p>
        ) : startable.length === 0 ? (
          <p className="px-3.5 pb-3 text-micro text-text-tertiary">
            Nothing of yours is open. A timer runs on work in progress.
          </p>
        ) : (
          <ul className="max-h-[15rem] overflow-y-auto pb-1">
            {startable.map((task) => (
              <li key={task.taskId}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={atLimit || starting !== null}
                  onClick={() => void start(task.taskId)}
                  title={
                    atLimit
                      ? 'Three timers are already running — pause one first'
                      : `Start timing ${task.reference}`
                  }
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  {starting === task.taskId ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play
                      className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-text-primary">
                      {task.reference} · {task.title}
                    </span>
                    <span className="block truncate text-micro text-text-tertiary">
                      {task.projectName} · {STATUS_META[task.status].label}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
