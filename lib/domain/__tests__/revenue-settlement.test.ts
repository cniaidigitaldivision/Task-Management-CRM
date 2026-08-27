import { describe, expect, it } from 'vitest';

import {
  outstandingOf,
  overpaidOf,
  REVENUE_STATUS_META,
  SETTABLE_REVENUE_STATUSES,
  settlementOf,
  type RevenueStatus,
} from '@/lib/domain/finance';

/* ============================================================================
 * WHERE AN INVOICE STANDS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"It's not possible that in some project they are giving
 * money in one go. Maybe they are giving two monies in pieces, two times or
 * three times, in one month."*
 *
 * ── ⚠️ THIS FILE MIRRORS A DATABASE TRIGGER, AND THAT IS THE RISK IT GUARDS ─
 * `sync_revenue_settlement` (migration 074) decides the same thing in SQL, for
 * the stored column. Two implementations of one rule is a drift waiting to
 * happen — so the cases below are written to match the trigger's own self-check
 * exactly, and the ORDER of the branches is asserted, not just the outcomes.
 * ========================================================================= */

const invoice = (amountPkr: number, paidPkr: number, status: RevenueStatus) => ({
  amountPkr,
  paidPkr,
  status,
});

describe('an ordinary invoice', () => {
  it('is awaiting payment when nothing has arrived', () => {
    expect(settlementOf(invoice(120_000, 0, 'invoiced'))).toBe('invoiced');
  });

  it('is not billed while it is still pending', () => {
    expect(settlementOf(invoice(120_000, 0, 'pending'))).toBe('pending');
  });

  it('is part paid after the first instalment', () => {
    expect(settlementOf(invoice(120_000, 50_000, 'invoiced'))).toBe('part_paid');
  });

  it('is paid in full once the instalments cover it', () => {
    expect(settlementOf(invoice(120_000, 120_000, 'invoiced'))).toBe('received');
  });

  it('is paid in full when the client overpays', () => {
    expect(settlementOf(invoice(120_000, 130_000, 'invoiced'))).toBe('received');
  });
});

describe('terminal decisions win over the arithmetic', () => {
  /* ⚠️ The case that broke the first version of the trigger. Money DOES arrive
     against written-off invoices — a debt honoured late, a reversed refund —
     and the receipt is recorded, but the verdict somebody took is not undone by
     a sum. */
  it('a written-off invoice stays written off even when paid in full', () => {
    expect(settlementOf(invoice(100_000, 100_000, 'written_off'))).toBe('written_off');
  });

  it('a refunded invoice stays refunded even when paid in full', () => {
    expect(settlementOf(invoice(100_000, 100_000, 'returned'))).toBe('returned');
  });

  it('checks the terminal states BEFORE the amounts, not after', () => {
    // If the order were reversed, both of the above would read "received".
    // Asserted as an order rather than as two outcomes, because the outcomes
    // agree for every other input and would not catch a reordering.
    for (const terminal of ['written_off', 'returned'] as const) {
      for (const paid of [0, 1, 99_999, 100_000, 250_000]) {
        expect(settlementOf(invoice(100_000, paid, terminal))).toBe(terminal);
      }
    }
  });
});

describe('undoing a payment', () => {
  it('falls back to awaiting payment, never to not-billed', () => {
    /* ⚠️ A stored status of `received` with nothing paid means a payment was
       deleted. The bill was certainly issued, so calling it "not billed" would
       be a worse lie than the one being corrected. The trigger makes the same
       choice. */
    expect(settlementOf(invoice(120_000, 0, 'received'))).toBe('invoiced');
  });

  it('reports part paid when only some of the payments were removed', () => {
    expect(settlementOf(invoice(120_000, 20_000, 'received'))).toBe('part_paid');
  });
});

describe('a zero-value invoice', () => {
  it('is not silently "paid in full"', () => {
    /* ⚠️ `0 >= 0` is true, so without the `amountPkr > 0` guard a placeholder
       row with no amount would report itself collected and quietly inflate the
       collected figure on the hero. */
    expect(settlementOf(invoice(0, 0, 'invoiced'))).toBe('invoiced');
  });
});

describe('what is owed', () => {
  it('is the difference while money is outstanding', () => {
    expect(outstandingOf({ amountPkr: 120_000, paidPkr: 50_000 })).toBe(70_000);
  });

  it('is nil once the invoice is covered', () => {
    expect(outstandingOf({ amountPkr: 120_000, paidPkr: 120_000 })).toBe(0);
  });

  it('never goes negative when a client overpays', () => {
    // A negative "outstanding" would subtract from the division's receivables
    // and understate what every other client owes.
    expect(outstandingOf({ amountPkr: 120_000, paidPkr: 150_000 })).toBe(0);
  });

  it('reports the overpayment separately rather than hiding it', () => {
    // Somebody's money is sitting in the account; a screen that shows only
    // "paid in full" is how it stays unreturned.
    expect(overpaidOf({ amountPkr: 120_000, paidPkr: 150_000 })).toBe(30_000);
    expect(overpaidOf({ amountPkr: 120_000, paidPkr: 120_000 })).toBe(0);
    expect(overpaidOf({ amountPkr: 120_000, paidPkr: 90_000 })).toBe(0);
  });
});

describe('what an Admin may set by hand', () => {
  it('does not offer paid or part paid', () => {
    /* ⚠️ Both are consequences of money arriving. Offering them in a menu is a
       way to mark an invoice paid with no receipt behind it — the accuracy hole
       the owner closed on expenses. */
    expect(SETTABLE_REVENUE_STATUSES).not.toContain('received');
    expect(SETTABLE_REVENUE_STATUSES as readonly string[]).not.toContain('part_paid');
  });

  it('offers every other lifecycle state', () => {
    expect([...SETTABLE_REVENUE_STATUSES].sort()).toEqual(
      ['invoiced', 'pending', 'returned', 'written_off'].sort(),
    );
  });
});

describe('the labels', () => {
  it('covers every settlement state', () => {
    const states = [
      'pending',
      'invoiced',
      'part_paid',
      'received',
      'returned',
      'written_off',
    ] as const;
    for (const state of states) {
      expect(REVENUE_STATUS_META[state]?.label).toBeTruthy();
    }
  });

  it('counts only paid-in-full as money in hand', () => {
    // ⚠️ `part_paid` must NOT be collected. Counting a half-paid invoice as
    // income received is how a cash position reads better than the bank does.
    const collected = Object.entries(REVENUE_STATUS_META)
      .filter(([, meta]) => meta.collected)
      .map(([key]) => key);
    expect(collected).toEqual(['received']);
  });
});
