import { describe, expect, it } from 'vitest';

import { operationsAdvice, operationsScore, type OpsInputs } from '../ops-score';

/* ============================================================================
 * THE OPERATIONS SCORE
 * ----------------------------------------------------------------------------
 * This figure sits where the owner's reference put "AI Productivity 87/100",
 * and the whole reason it exists rather than a constant is that it is a real
 * measurement. A real measurement has to be right — and the ways it can be
 * quietly wrong are the ones tested here: an empty table scoring as a crisis,
 * an idle team scoring as excellent, a missing input dragging the total down.
 * ========================================================================= */

const BASE: OpsInputs = {
  completed: 40,
  overdue: 0,
  open: 20,
  utilisationPct: 70,
  softThresholdPct: 85,
  expectedToday: 6,
  onTimeToday: 6,
};

describe('operationsScore', () => {
  it('is high when delivery, capacity and attendance are all healthy', () => {
    const { score } = operationsScore(BASE);
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it('falls when work is running late', () => {
    const healthy = operationsScore(BASE).score;
    const late = operationsScore({ ...BASE, completed: 20, overdue: 20 }).score;
    expect(late).toBeLessThan(healthy);
  });

  it('penalises being OVER capacity', () => {
    /* Over the soft threshold is a planning failure, not an achievement. */
    const healthy = operationsScore(BASE).score;
    const over = operationsScore({ ...BASE, utilisationPct: 110 }).score;
    expect(over).toBeLessThan(healthy);
  });

  it('penalises being far UNDER capacity too', () => {
    /* ⚠️ The trap a one-sided score falls into: 12% utilisation is not better
       than 70%, it is an idle team, and a score that rewarded it would tell
       somebody to keep the pipeline empty. */
    const healthy = operationsScore(BASE).score;
    const idle = operationsScore({ ...BASE, utilisationPct: 12 }).score;
    expect(idle).toBeLessThan(healthy);
  });

  it('treats a missing input as absent, never as zero', () => {
    /* A division with no attendance rows must not be reported as 0% punctual.
       Dropping the part re-weights the others instead of dragging the total. */
    const withAttendance = operationsScore(BASE);
    const without = operationsScore({ ...BASE, expectedToday: 0, onTimeToday: 0 });

    expect(without.parts.punctuality).toBeNull();
    expect(without.score).toBeGreaterThanOrEqual(withAttendance.score - 2);
  });

  it('says so, rather than scoring zero, when there is nothing to measure', () => {
    const empty = operationsScore({
      completed: 0,
      overdue: 0,
      open: 0,
      utilisationPct: 0,
      softThresholdPct: 85,
      expectedToday: 0,
      onTimeToday: 0,
    });
    expect(empty.parts).toEqual({ delivery: null, capacity: null, punctuality: null });
    expect(empty.headline).toMatch(/not enough/i);
  });

  it('never leaves the 0–100 range, whatever it is given', () => {
    const extremes: OpsInputs[] = [
      { ...BASE, utilisationPct: 1000 },
      { ...BASE, completed: 0, overdue: 9999 },
      { ...BASE, onTimeToday: 999, expectedToday: 1 },
      { ...BASE, utilisationPct: -50 },
    ];
    for (const input of extremes) {
      const { score } = operationsScore(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(score)).toBe(true);
    }
  });

  it('reads the headline off the score', () => {
    expect(operationsScore(BASE).headline).toMatch(/healthy/i);
    expect(operationsScore({ ...BASE, completed: 5, overdue: 40 }).headline).toMatch(
      /attention|slipping/i,
    );
  });
});

describe('operationsAdvice', () => {
  const ADVICE = {
    ...BASE,
    atRisk: 0,
    blocked: 0,
    pendingExtensions: 0,
  };

  it('says nothing when nothing is wrong', () => {
    expect(operationsAdvice(ADVICE)).toEqual([]);
  });

  it('puts blocked work first — that work is stopped', () => {
    const lines = operationsAdvice({ ...ADVICE, blocked: 2, overdue: 5, atRisk: 3 });
    expect(lines[0]).toMatch(/blocked/i);
  });

  it('never returns more than three lines', () => {
    const lines = operationsAdvice({
      ...ADVICE,
      blocked: 3,
      overdue: 9,
      atRisk: 4,
      pendingExtensions: 2,
      utilisationPct: 5,
    });
    expect(lines).toHaveLength(3);
  });

  it('gets the singular and the plural right', () => {
    expect(operationsAdvice({ ...ADVICE, blocked: 1 })[0]).toContain('task is');
    expect(operationsAdvice({ ...ADVICE, blocked: 2 })[0]).toContain('tasks are');
  });
});
