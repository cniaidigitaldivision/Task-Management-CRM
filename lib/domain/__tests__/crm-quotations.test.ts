/* ============================================================================
 * THE QUOTATION RULES
 * ----------------------------------------------------------------------------
 * These are about money a client is told, so the ones worth testing are the
 * ones that would print a wrong number on a document somebody keeps.
 * ========================================================================= */
import { describe, expect, it } from 'vitest';

import {
  needsApproval,
  netAmount,
  nextQuotationNumber,
  quotationProblems,
  quotationStatusLabel,
  toRupees,
} from '@/lib/domain/crm-quotations';

const TODAY = '2026-09-16';

const base = {
  basePrice: '4500000',
  premiumCharges: '',
  requestedDiscount: '',
  validUntil: '2026-09-30',
  terms: '',
};

describe('the arithmetic', () => {
  it('adds premium and takes off the discount', () => {
    expect(
      netAmount({
        basePrice: 4_500_000,
        premiumCharges: 200_000,
        requestedDiscount: 100_000,
        approvedDiscount: 0,
        approved: false,
      }),
    ).toBe(4_600_000);
  });

  it('⚠️ uses the APPROVED discount once it is approved, not the requested one', () => {
    /* A salesperson asks for 500k off; the manager approves 200k. The document
       must say what was authorised — printing the requested figure would quote a
       price nobody agreed to. */
    expect(
      netAmount({
        basePrice: 4_500_000,
        premiumCharges: 0,
        requestedDiscount: 500_000,
        approvedDiscount: 200_000,
        approved: true,
      }),
    ).toBe(4_300_000);
  });

  it('reads a number however somebody typed it', () => {
    expect(toRupees('1,20,00,000')).toBe(12_000_000);
    expect(toRupees('PKR 4 500 000')).toBe(4_500_000);
    expect(toRupees('   ')).toBeNull();
  });
});

describe('who has to approve it', () => {
  it('⚠️ a discount needs somebody else; list price does not', () => {
    /* The owner's rule is about the DISCOUNT, not about the existence of a
       document. Requiring a manager for every quotation at full price puts a
       person in the way of a number nobody has discretion over — and then people
       send prices from WhatsApp instead. */
    expect(needsApproval(0)).toBe(false);
    expect(needsApproval(1)).toBe(true);
  });
});

describe('what the form must refuse', () => {
  it('accepts a complete quotation', () => {
    expect(quotationProblems(base, TODAY)).toHaveLength(0);
  });

  it('a quotation with no price', () => {
    expect(quotationProblems({ ...base, basePrice: '' }, TODAY).some((p) => p.includes('price'))).toBe(
      true,
    );
  });

  it('⚠️ a discount larger than the price', () => {
    /* The database refuses it too (151). "Net −200,000" is the kind of figure
       that makes a client distrust every other number on the page. */
    const problems = quotationProblems(
      { ...base, basePrice: '1000000', requestedDiscount: '1500000' },
      TODAY,
    );
    expect(problems.some((p) => p.includes('larger than the price'))).toBe(true);
  });

  it('a discount exactly equal to the price is allowed', () => {
    /* Odd but legitimate — a giveaway unit, a settlement. The database's own
       ceiling is `<=`, and the form must not be stricter than the rule. */
    expect(
      quotationProblems({ ...base, basePrice: '1000000', requestedDiscount: '1000000' }, TODAY),
    ).toHaveLength(0);
  });

  it('⚠️ a validity date that has already passed', () => {
    const problems = quotationProblems({ ...base, validUntil: '2026-09-15' }, TODAY);
    expect(problems.some((p) => p.includes('already passed'))).toBe(true);
  });

  it('but today itself is still valid', () => {
    expect(quotationProblems({ ...base, validUntil: TODAY }, TODAY)).toHaveLength(0);
  });

  it('names the field rather than saying "invalid"', () => {
    for (const p of quotationProblems({ ...base, basePrice: '' }, TODAY)) {
      expect(p.length).toBeGreaterThan(20);
      expect(p).not.toMatch(/invalid|error/i);
    }
  });
});

describe('numbering', () => {
  it('⚠️ never repeats a number, even when the series has gaps', () => {
    /* A gap is harmless. A repeat is the one thing a client notices — two
       different documents both called QT-1043. */
    expect(nextQuotationNumber(['QT-1042', 'QT-1043'])).toBe('QT-1044');
    expect(nextQuotationNumber(['QT-1042', 'QT-1099', 'QT-1043'])).toBe('QT-1100');
  });

  it('starts the series when there is nothing yet', () => {
    expect(nextQuotationNumber([])).toBe('QT-1042');
  });

  it('ignores anything it cannot read a number from', () => {
    expect(nextQuotationNumber(['draft', 'QT-1050', ''])).toBe('QT-1051');
  });
});

describe('vocabulary', () => {
  it('⚠️ shows an unknown status rather than hiding it', () => {
    expect(quotationStatusLabel('teleported')).toBe('teleported');
    expect(quotationStatusLabel('pending_approval')).toBe('Waiting for approval');
  });
});
