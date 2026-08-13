import { describe, expect, it } from 'vitest';

import { type NumberFormat, formatNumber } from '@/lib/view/number-format';

/* ============================================================================
 * Number formats
 * ----------------------------------------------------------------------------
 * These strings appear on axes and inside KPI figures, where two panels
 * disagreeing about how to print the same number is immediately visible. The
 * point of a named format is that they cannot disagree — so what is worth
 * asserting is that each name is stable and that none of them can produce `NaN`
 * or a wall of decimal places on a dashboard.
 * ========================================================================= */

const ALL: readonly NumberFormat[] = [
  'integer',
  'decimal',
  'percent',
  'hours',
  'points',
  'compact',
];

describe('formatNumber', () => {
  it('defaults to whole numbers, because almost everything here is a count', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(42.4)).toBe('42');
    expect(formatNumber(42.6)).toBe('43');
  });

  it('keeps one decimal where rounding would say something false', () => {
    expect(formatNumber(94.64, 'decimal')).toBe('94.6');
    expect(formatNumber(94, 'decimal')).toBe('94.0');
  });

  it('drops a percentage\'s decimal only when it is a whole number', () => {
    /* 94.0% and 94.6% must not print alike, but a flat 94% should not carry a
       pointless ".0" across four KPI cards. */
    expect(formatNumber(94, 'percent')).toBe('94%');
    expect(formatNumber(94.6, 'percent')).toBe('94.6%');
    expect(formatNumber(0, 'percent')).toBe('0%');
    expect(formatNumber(100, 'percent')).toBe('100%');
  });

  it('carries its unit for hours and points', () => {
    expect(formatNumber(7.5, 'hours')).toBe('7.5h');
    expect(formatNumber(8, 'hours')).toBe('8h');
    expect(formatNumber(13, 'points')).toBe('13 pts');
    expect(formatNumber(13.4, 'points')).toBe('13 pts');
  });

  it('compacts thousands for an axis, without a pointless decimal', () => {
    expect(formatNumber(0, 'compact')).toBe('0');
    expect(formatNumber(999, 'compact')).toBe('999');
    expect(formatNumber(1000, 'compact')).toBe('1k');
    expect(formatNumber(1200, 'compact')).toBe('1.2k');
    expect(formatNumber(5000, 'compact')).toBe('5k');
    expect(formatNumber(12_500, 'compact')).toBe('12.5k');
    expect(formatNumber(1_000_000, 'compact')).toBe('1m');
    expect(formatNumber(2_400_000, 'compact')).toBe('2.4m');
  });

  it('compacts negatives symmetrically', () => {
    expect(formatNumber(-1200, 'compact')).toBe('-1.2k');
  });

  it('prints an em dash rather than NaN, in every format', () => {
    /* A gap in the data should read as a gap. "NaN" on a dashboard reads as a
       broken dashboard, and "NaN pts" reads as a broken dashboard with a unit. */
    for (const kind of ALL) {
      for (const bad of [NaN, Infinity, -Infinity]) {
        expect(formatNumber(bad, kind)).toBe('—');
      }
    }
  });

  it('never produces floating-point debris', () => {
    for (const kind of ALL) {
      for (let v = 0; v < 40; v += 0.7) {
        expect(formatNumber(v, kind)).not.toMatch(/\d{6,}/);
      }
    }
  });

  it('is locale-independent — two panels must not disagree', () => {
    /* Deliberately not Intl: it would localise the separator, and an axis
       rendering "1,2k" beside a figure rendering "1.2k" is worse than either. */
    expect(formatNumber(1200, 'compact')).not.toContain(',');
    expect(formatNumber(1_234_567)).toBe('1234567');
  });
});
