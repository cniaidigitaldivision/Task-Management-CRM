import { describe, expect, it } from 'vitest';

import {
  MAX_CONCURRENT_TIMERS,
  SUSPECT_HOURS,
  alertMessage,
  canStartAnother,
  formatElapsed,
  formatRemaining,
  readTimer,
  type RunningTimer,
} from '../timers';

/* ============================================================================
 * TIMERS
 * ----------------------------------------------------------------------------
 * The cases worth testing are the boundaries, because a countdown is only ever
 * wrong at the moment it crosses one — and the moment it crosses is the only
 * moment anybody is looking.
 * ========================================================================= */

const START = Date.parse('2026-08-13T09:00:00.000Z');
const minutes = (n: number) => START + n * 60_000;

function timer(over: Partial<RunningTimer> = {}): RunningTimer {
  return {
    taskId: 't1',
    reference: 'CLI-116',
    title: 'Launch video',
    projectName: 'ABC Traders',
    startedAt: '2026-08-13T09:00:00.000Z',
    minutesBefore: 0,
    limitMinutes: 60,
    alertsSent: [],
    ...over,
  };
}

describe('readTimer', () => {
  it('counts this run and adds what was banked before it', () => {
    /* Two earlier runs of 20 minutes, plus 15 now. The chip shows 35 against the
       task and 15 against this run — and only the second is what SUSPECT_HOURS
       measures, or a task worked on across three days would look forgotten. */
    const reading = readTimer(timer({ minutesBefore: 20 }), minutes(15));
    expect(reading.minutesThisRun).toBe(15);
    expect(reading.minutesSpent).toBe(35);
  });

  it('reports remaining against the allowance, and goes negative past it', () => {
    expect(readTimer(timer(), minutes(45)).minutesRemaining).toBe(15);

    /* Not clamped at zero. The overrun IS the figure the Time & overrun report
       exists to show, so hiding it here would empty that report. */
    const over = readTimer(timer(), minutes(75));
    expect(over.minutesRemaining).toBe(-15);
    expect(over.overLimit).toBe(true);
  });

  it('has no countdown at all when the task has no limit', () => {
    /* Owner's decision. Nothing can be "10 minutes left" of an allowance that
       does not exist, and inventing a default would make every warning about a
       limit nobody set. */
    const reading = readTimer(timer({ limitMinutes: null }), minutes(300));
    expect(reading.minutesRemaining).toBeNull();
    expect(reading.overLimit).toBe(false);
    expect(reading.alertsDue).toEqual([]);
  });

  it('is not suspect on a long day, and is suspect overnight', () => {
    expect(readTimer(timer(), minutes(SUSPECT_HOURS * 60 - 1)).suspect).toBe(false);
    expect(readTimer(timer(), minutes(SUSPECT_HOURS * 60)).suspect).toBe(true);
    /* The case this exists for: started yesterday morning, still going. */
    expect(readTimer(timer(), minutes(22 * 60)).suspect).toBe(true);
  });

  it('survives an unparseable start without turning every figure into NaN', () => {
    const reading = readTimer(timer({ startedAt: 'not a date' }), minutes(30));
    expect(reading.minutesThisRun).toBe(0);
    /* The trap: NaN comparisons are all false, so `overLimit` would read false
       for a task that had massively overrun. */
    expect(Number.isNaN(reading.minutesSpent)).toBe(false);
  });

  it('never reports negative elapsed if the clocks disagree', () => {
    /* Server and browser clocks differ; a chip must not render "-3m". */
    const reading = readTimer(timer(), minutes(-3));
    expect(reading.minutesThisRun).toBe(0);
  });
});

describe('the alerts', () => {
  it('fires ten minutes out, then five, then at the limit', () => {
    expect(readTimer(timer(), minutes(49)).alertsDue).toEqual([]);
    expect(readTimer(timer(), minutes(50)).alertsDue).toEqual(['ten_minutes']);
    expect(readTimer(timer(), minutes(55)).alertsDue).toEqual([
      'ten_minutes',
      'five_minutes',
    ]);
    expect(readTimer(timer(), minutes(60)).alertsDue).toEqual([
      'ten_minutes',
      'five_minutes',
      'time_up',
    ]);
  });

  it('does not repeat one already delivered', () => {
    const reading = readTimer(
      timer({ alertsSent: ['ten_minutes', 'five_minutes'] }),
      minutes(56),
    );
    expect(reading.alertsDue).toEqual([]);
  });

  it('delivers the ones missed while the tab was closed', () => {
    /* THE reason the test is `<=` and not `===`. Away from 30 minutes left until
       2 minutes left: both warnings arrive at once, rather than neither. Firing
       only on the exact minute would mean the alerts silently depend on somebody
       watching the screen. */
    const reading = readTimer(timer(), minutes(58));
    expect(reading.alertsDue).toEqual(['ten_minutes', 'five_minutes']);
  });

  it('still owes every alert to a task discovered long past its limit', () => {
    const reading = readTimer(timer(), minutes(300));
    expect(reading.alertsDue).toEqual(['ten_minutes', 'five_minutes', 'time_up']);
  });

  it('says plainly that nothing was stopped or moved', () => {
    /* The absence is the surprising part, so the message states it. */
    const message = alertMessage('time_up', { reference: 'CLI-116', title: 'Launch video' });
    expect(message.title).toContain('Time is up');
    expect(message.body).toContain('still running');
    expect(message.body).toContain('has not been moved');
  });
});

describe('canStartAnother', () => {
  it('allows a start below the cap', () => {
    expect(canStartAnother([timer(), timer()]).allowed).toBe(true);
  });

  it('refuses the fourth and hands back the three to name', () => {
    /* Owner: *"they should definitely know that the three timers are still
       running. You have to close one."* A refusal that cannot name them is a dead
       end, so the blocking set comes back with it. */
    const running = [timer({ taskId: 'a' }), timer({ taskId: 'b' }), timer({ taskId: 'c' })];
    const result = canStartAnother(running);
    expect(result.allowed).toBe(false);
    expect(result.blocking).toHaveLength(MAX_CONCURRENT_TIMERS);
    expect(result.blocking.map((t) => t.taskId)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatting', () => {
  it('reads as hours and minutes', () => {
    expect(formatElapsed(0)).toBe('0m');
    expect(formatElapsed(45)).toBe('45m');
    expect(formatElapsed(60)).toBe('1h');
    expect(formatElapsed(135)).toBe('2h 15m');
  });

  it('says "over by" rather than showing a negative duration', () => {
    expect(formatRemaining(15)).toBe('15m left');
    expect(formatRemaining(0)).toBe('time is up');
    /* "-12m left" is a thing to decode. This is read at a glance. */
    expect(formatRemaining(-12)).toBe('over by 12m');
    expect(formatRemaining(null)).toBeNull();
  });
});
