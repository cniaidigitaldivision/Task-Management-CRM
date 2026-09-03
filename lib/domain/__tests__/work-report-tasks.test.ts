import { describe, expect, it } from 'vitest';

import { PERIOD_LABEL, PERIOD_PRESETS, presetPeriod } from '../reports';

/* ============================================================================
 * TODAY AND YESTERDAY — owner request, 2026-09-03
 * ----------------------------------------------------------------------------
 * *"this month, this last week, this week, all these queries are showing. There
 * is a 'today' query not present and a 'yesterday' query not present so add
 * them."*
 *
 * The row-level task assertions live in work-report.test.ts, beside the factory
 * that builds a task the period scoper actually accepts — an input assembled by
 * hand here produced zero rows and four green-looking failures.
 * ========================================================================= */

describe('the period presets', () => {
  it('offers Today and Yesterday, and offers them first', () => {
    expect(PERIOD_PRESETS[0]).toBe('today');
    expect(PERIOD_PRESETS[1]).toBe('yesterday');
    expect(PERIOD_LABEL.today).toBe('Today');
    expect(PERIOD_LABEL.yesterday).toBe('Yesterday');
  });

  /* ⚠️ A single day is a range whose ends are EQUAL, not a start with no end —
     every reader downstream assumes both bounds are real dates. */
  it('resolves Today to one day with both ends the same', () => {
    const at = Date.UTC(2026, 8, 3, 14, 30);
    expect(presetPeriod('today', at)).toEqual({ start: '2026-09-03', end: '2026-09-03' });
  });

  it('resolves Yesterday to the day before, across a month boundary', () => {
    const at = Date.UTC(2026, 8, 1, 14, 30);
    expect(presetPeriod('yesterday', at)).toEqual({ start: '2026-08-31', end: '2026-08-31' });
  });
});
