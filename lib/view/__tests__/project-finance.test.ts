import { describe, expect, it } from 'vitest';

import { redactFinance, redactOne } from '../project-finance';

/* ============================================================================
 * Money must not cross to the browser for a reader who may not see it
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: the monthly fee is Super Admin and Admin only.
 *
 * Gating the render sites was not enough — the workspace is a Client Component, so
 * the whole row is serialised into the RSC payload and a check of the real HTML found
 * the fee in it. These tests pin the server-side strip that fixed that.
 * ========================================================================= */

const ROW = {
  id: 'p1',
  name: 'Daniyal Marketing',
  monthlyFeePkr: 50_000,
  assetsTargetMin: 16,
};

describe('redactFinance', () => {
  it('removes the fee for a reader who may not see it', () => {
    const [row] = redactFinance([ROW], false);
    expect(row!.monthlyFeePkr).toBeNull();
  });

  it('keeps the fee for a reader who may', () => {
    const [row] = redactFinance([ROW], true);
    expect(row!.monthlyFeePkr).toBe(50_000);
  });

  it('leaves everything else untouched', () => {
    /* A redaction that quietly dropped a target would break the delivery bar, and
       nothing on this screen would say why. */
    const [row] = redactFinance([ROW], false);
    expect(row!.name).toBe('Daniyal Marketing');
    expect(row!.assetsTargetMin).toBe(16);
    expect(row!.id).toBe('p1');
    expect(Object.keys(row!).sort()).toEqual(Object.keys(ROW).sort());
  });

  it('nulls the fee rather than deleting the key', () => {
    /* ⚠️ Every consumer already handles `monthlyFeePkr === null` as "no fee
       recorded", so nulling needs no new branch anywhere. Deleting the key would
       break the type; a zero would be a lie that a total could add up. */
    const [row] = redactFinance([ROW], false);
    expect('monthlyFeePkr' in row!).toBe(true);
    expect(row!.monthlyFeePkr).not.toBe(0);
  });

  it('does not mutate the row it was given', () => {
    /* The caller still holds the original — `listProjects`' result is reused for the
       type-mix counts on the same page. Mutating in place would redact those too, and
       for an Admin that would be a silent regression nobody would notice. */
    const original = { ...ROW };
    redactFinance([ROW], false);
    expect(ROW).toEqual(original);
  });

  it('handles an empty list and a row with no fee', () => {
    expect(redactFinance([], false)).toEqual([]);
    const [row] = redactFinance([{ ...ROW, monthlyFeePkr: null }], false);
    expect(row!.monthlyFeePkr).toBeNull();
  });

  it('redacts every row, not just the first', () => {
    const rows = redactFinance(
      [ROW, { ...ROW, id: 'p2' }, { ...ROW, id: 'p3' }],
      false,
    );
    expect(rows.every((r) => r.monthlyFeePkr === null)).toBe(true);
  });
});

describe('redactOne', () => {
  it('applies the same rule to a single project', () => {
    expect(redactOne(ROW, false).monthlyFeePkr).toBeNull();
    expect(redactOne(ROW, true).monthlyFeePkr).toBe(50_000);
  });

  it('does not mutate its argument', () => {
    const original = { ...ROW };
    redactOne(ROW, false);
    expect(ROW).toEqual(original);
  });
});
