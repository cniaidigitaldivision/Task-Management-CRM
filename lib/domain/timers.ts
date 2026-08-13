/* ============================================================================
 * TIMERS — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * *"An alarm/timer feature that can hold three concurrent tasks at once on
 * timer, and start and stop should be done auto or manual."*
 *
 * The decisions, as settled with the owner:
 *
 *   three at once      a fourth is REFUSED, naming the three that are running,
 *                      so the person knows what to pause rather than guessing
 *   start              manual only. Nothing starts a clock as a side effect
 *   stop               manual only. Nothing stops itself either
 *   at the limit       notify — 10 minutes left, 5 minutes left, time is up
 *   the task's status  is never touched by a timer, in either direction
 *
 * ── WHY NOTHING AUTO-STOPS, AND WHAT PROTECTS THE NUMBERS INSTEAD ────────────
 * Stopping at 17:00 was offered and declined. That leaves one real hazard: a
 * timer left running overnight banks sixteen hours nobody worked, and that figure
 * flows straight into the Time & overrun report.
 *
 * So the clock keeps running, as instructed, and the number is protected a
 * different way: past `SUSPECT_HOURS` a run is marked **suspect**. The timer bar
 * says so, and anything reading time can ask. A suspect figure is visible rather
 * than silently averaged into a report — which is the part that mattered.
 *
 * ── THIS FILE IS PURE ────────────────────────────────────────────────────────
 * No clock, no database, no React (doc 20 §1). `now` is always passed in. A
 * countdown that read `Date.now()` internally could not be tested at the exact
 * moment a threshold crosses, which is the only moment worth testing.
 * ========================================================================= */

/** Owner's number. A fourth start is refused, not queued and not silent. */
export const MAX_CONCURRENT_TIMERS = 3;

/**
 * How long a single run may last before it is presumed forgotten.
 *
 * Twelve hours, not eight: a long day is real, and a false accusation on a day
 * somebody genuinely worked late is worse than a slightly late flag. Nothing is
 * changed by this — it only marks the figure as one to check.
 */
export const SUSPECT_HOURS = 12;

/** The three moments a person is told about, in the order they arrive. */
export const TIMER_ALERTS = ['ten_minutes', 'five_minutes', 'time_up'] as const;
export type TimerAlert = (typeof TIMER_ALERTS)[number];

const ALERT_AT_MINUTES_REMAINING: Readonly<Record<TimerAlert, number>> = {
  ten_minutes: 10,
  five_minutes: 5,
  time_up: 0,
};

export interface RunningTimer {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly projectName: string;
  /** When this run began. Elapsed is computed from it, never sent by a client. */
  readonly startedAt: string;
  /** Banked minutes from earlier runs, before this one started. */
  readonly minutesBefore: number;
  /** The allowance including any granted extension, or null for no limit. */
  readonly limitMinutes: number | null;
  /** Alerts already delivered for THIS run, so none can fire twice. */
  readonly alertsSent: readonly TimerAlert[];
}

export interface TimerReading {
  readonly taskId: string;
  /** Total against the task: this run plus everything banked before it. */
  readonly minutesSpent: number;
  /** This run alone. What `SUSPECT_HOURS` is measured against. */
  readonly minutesThisRun: number;
  /**
   * Minutes left of the allowance, or null when there is no limit.
   *
   * Negative once past it — deliberately. Clamping at zero would hide the
   * overrun, and the overrun is what the Time & overrun report is for.
   */
  readonly minutesRemaining: number | null;
  readonly overLimit: boolean;
  /** Running longer than `SUSPECT_HOURS`. Presumed forgotten, not stopped. */
  readonly suspect: boolean;
  /** Alerts now due that have not been sent for this run. */
  readonly alertsDue: readonly TimerAlert[];
}

/**
 * Read one running timer at a moment.
 *
 * `nowMs` is a parameter and always will be. The browser calls this every second
 * to redraw a chip; a test calls it at the exact millisecond a threshold crosses.
 */
export function readTimer(timer: RunningTimer, nowMs: number): TimerReading {
  const startedMs = Date.parse(timer.startedAt);
  /* An unparseable timestamp yields zero elapsed rather than NaN. NaN would
     propagate into every comparison below and quietly make `overLimit` false. */
  const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, nowMs - startedMs);

  const minutesThisRun = Math.floor(elapsedMs / 60_000);
  const minutesSpent = timer.minutesBefore + minutesThisRun;

  const limit = timer.limitMinutes;
  const minutesRemaining = limit === null ? null : limit - minutesSpent;

  return {
    taskId: timer.taskId,
    minutesSpent,
    minutesThisRun,
    minutesRemaining,
    overLimit: minutesRemaining !== null && minutesRemaining < 0,
    suspect: minutesThisRun >= SUSPECT_HOURS * 60,
    alertsDue: alertsDue(timer, minutesRemaining),
  };
}

/**
 * Which alerts have come due and not yet been sent.
 *
 * ── A LATE ARRIVAL STILL GETS THE ALERTS IT MISSED ───────────────────────────
 * The test is `remaining <= threshold`, not `remaining === threshold`. Somebody
 * who closes the tab at 30 minutes left and returns at 2 gets both the ten- and
 * five-minute warnings at once, rather than neither. Missing them entirely is the
 * worse failure: the point is to be told before the limit, and "you were away
 * when it happened" is no help.
 *
 * ── AND NOTHING FIRES WITHOUT A LIMIT ────────────────────────────────────────
 * A task with no allowance cannot be ten minutes from anything. Owner's decision,
 * and the alternative — a default allowance — would make every warning about a
 * limit nobody set.
 */
function alertsDue(
  timer: RunningTimer,
  minutesRemaining: number | null,
): readonly TimerAlert[] {
  if (minutesRemaining === null) return [];

  return TIMER_ALERTS.filter(
    (alert) =>
      !timer.alertsSent.includes(alert) &&
      minutesRemaining <= ALERT_AT_MINUTES_REMAINING[alert],
  );
}

/** The sentence a person reads. Written here so the bar and the bell agree. */
export function alertMessage(
  alert: TimerAlert,
  task: { reference: string; title: string },
): { title: string; body: string } {
  switch (alert) {
    case 'ten_minutes':
      return {
        title: `10 minutes left on ${task.reference}`,
        body: `${task.title} — you are ten minutes from its time limit.`,
      };
    case 'five_minutes':
      return {
        title: `5 minutes left on ${task.reference}`,
        body: `${task.title} — five minutes of the allowance remain.`,
      };
    case 'time_up':
      return {
        title: `Time is up on ${task.reference}`,
        /* Says plainly what has NOT happened, because the absence is the
           surprising part: nothing stopped and nothing moved. */
        body: `${task.title} has reached its time limit. The timer is still running and the task has not been moved — stop it or request an extension.`,
      };
  }
}

/**
 * Can another timer start?
 *
 * Returns the running set when it cannot, so the refusal can name them. "You
 * already have three running" is a dead end; naming them is the next action.
 */
export function canStartAnother(running: readonly RunningTimer[]): {
  readonly allowed: boolean;
  readonly blocking: readonly RunningTimer[];
} {
  if (running.length < MAX_CONCURRENT_TIMERS) return { allowed: true, blocking: [] };
  return { allowed: false, blocking: running };
}

/** `2h 15m`, `45m`, or `—`. Matches `formatMinutes` in lib/domain/reports.ts. */
export function formatElapsed(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The countdown, as words.
 *
 * Over the limit reads as "over by 12m" rather than "-12m left": a negative
 * duration is a thing to decode, and this is read at a glance.
 */
export function formatRemaining(minutesRemaining: number | null): string | null {
  if (minutesRemaining === null) return null;
  if (minutesRemaining < 0) return `over by ${formatElapsed(-minutesRemaining)}`;
  if (minutesRemaining === 0) return 'time is up';
  return `${formatElapsed(minutesRemaining)} left`;
}
