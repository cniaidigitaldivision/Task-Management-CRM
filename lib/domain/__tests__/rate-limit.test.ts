import { describe, expect, it } from 'vitest';

import {
  FREE_ATTEMPTS,
  HARD_LIMIT,
  WINDOW_MINUTES,
  evaluateRateLimit,
} from '../rate-limit';

/* ============================================================================
 * FR-148 — the per-source rate limiter
 * ----------------------------------------------------------------------------
 * Pure, so every case is a table. The interesting assertions are the ones about
 * what it deliberately does NOT do: it does not inconvenience somebody who
 * mistyped, and it never lets a stale burst hold a source out forever.
 * ========================================================================= */

const NOW = 1_700_000_000_000;
const minutesAgo = (m: number) => NOW - m * 60_000;

function failures(count: number, m = 1): number[] {
  return Array.from({ length: count }, () => minutesAgo(m));
}

describe('the free allowance', () => {
  it('does nothing at all to somebody who mistyped', () => {
    for (let n = 0; n <= FREE_ATTEMPTS; n += 1) {
      const decision = evaluateRateLimit({ failureTimes: failures(n), now: NOW });
      expect(decision.allowed).toBe(true);
      expect(decision.delayMs).toBe(0);
    }
  });
});

describe('the delay rises rather than stepping off a cliff', () => {
  it('grows with each failure past the allowance', () => {
    const a = evaluateRateLimit({ failureTimes: failures(FREE_ATTEMPTS + 1), now: NOW });
    const b = evaluateRateLimit({ failureTimes: failures(FREE_ATTEMPTS + 3), now: NOW });

    expect(a.allowed).toBe(true);
    expect(a.delayMs).toBeGreaterThan(0);
    /* A hard edge is easy to find and stay under. A slope costs an attacker from
       the first extra attempt and never gives them a number to calibrate to. */
    expect(b.delayMs).toBeGreaterThan(a.delayMs);
  });

  it('caps, so a flood cannot hold a request open indefinitely', () => {
    const decision = evaluateRateLimit({ failureTimes: failures(HARD_LIMIT - 1), now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.delayMs).toBeLessThanOrEqual(4_000);
  });
});

describe('the hard limit', () => {
  it('refuses the source outright, and says when to come back', () => {
    const decision = evaluateRateLimit({ failureTimes: failures(HARD_LIMIT), now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain(String(WINDOW_MINUTES));
  });
});

describe('the window', () => {
  it('ignores failures older than the window', () => {
    const old = failures(HARD_LIMIT + 5, WINDOW_MINUTES + 1);
    const decision = evaluateRateLimit({ failureTimes: old, now: NOW });
    /* Otherwise a limit would never lift, and a shared office address would be
       permanently refused after one bad afternoon. */
    expect(decision.allowed).toBe(true);
    expect(decision.recentFailures).toBe(0);
  });

  it('counts a failure exactly on the boundary', () => {
    const decision = evaluateRateLimit({
      failureTimes: [minutesAgo(WINDOW_MINUTES)],
      now: NOW,
    });
    expect(decision.recentFailures).toBe(1);
  });

  it('discards future-dated failures rather than trusting them', () => {
    /* The C-19 shape: these timestamps are written by the database and compared
       here. If the clocks disagree the wrong way, a future-dated row would
       otherwise be counted as recent. */
    const decision = evaluateRateLimit({
      failureTimes: [NOW + 60_000, NOW + 120_000, minutesAgo(1)],
      now: NOW,
    });
    expect(decision.recentFailures).toBe(1);
  });
});

describe('what it refuses to do', () => {
  it('never refuses on an empty history', () => {
    const decision = evaluateRateLimit({ failureTimes: [], now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.delayMs).toBe(0);
  });

  it('is unaffected by the order failures arrive in', () => {
    const shuffled = [minutesAgo(9), minutesAgo(1), minutesAgo(5), minutesAgo(3)];
    const ordered = [...shuffled].sort((a, b) => a - b);
    expect(evaluateRateLimit({ failureTimes: shuffled, now: NOW }).recentFailures).toBe(
      evaluateRateLimit({ failureTimes: ordered, now: NOW }).recentFailures,
    );
  });
});
