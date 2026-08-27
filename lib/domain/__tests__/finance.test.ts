import { describe, expect, it } from 'vitest';

import {
  type LedgerExpense,
  type LedgerRevenue,
  breakEven,
  byCategory,
  changePct,
  monthLabel,
  monthOf,
  monthsBetween,
  monthlySeries,
  nextMonth,
  outstanding,
  previousMonth,
  totalsFor,
  waterfall,
} from '@/lib/domain/finance';
import { pkr, pkrCompact, plain, signed } from '@/lib/domain/money';

/* ============================================================================
 * THE LEDGER'S ARITHMETIC
 * ----------------------------------------------------------------------------
 * These exist because every figure the finance page prints comes through this
 * module, and a wrong one is not a visual bug — it is a number somebody takes
 * into a meeting. The cases below are chosen for the mistakes that are easy to
 * make and hard to see: a month bucketed by UTC, a margin computed against zero
 * income, a growth figure against a base of two.
 * ========================================================================= */

function expense(over: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    id: 'e1',
    categorySlug: 'utilities',
    categoryName: 'Utility bills',
    categoryToken: 'load-warning',
    title: 'Electricity',
    amountPkr: 1000,
    incurredOn: '2026-08-10',
    paidOn: null,
    officeTeam: 'blue_area',
    vendor: null,
    personName: null,
    source: 'manual',
    subtype: null,
    subtypeOther: null,
    seatHolderName: null,
    /* Every fixture carries a receipt, because from migration 065 every
       hand-filed row must — a fixture without one describes a row the database
       would refuse. */
    hasReceipt: true,
    receiptName: 'bill.png',
    ...over,
  };
}

function revenue(over: Partial<LedgerRevenue> = {}): LedgerRevenue {
  return {
    id: 'r1',
    kind: 'retainer',
    sourceName: 'GC Royal Emporium',
    projectId: null,
    amountPkr: 5000,
    /* Migration 073 moved the evidence onto the payments and added the
       collected total here. Nothing is billed as paid by default. */
    paidPkr: 0,
    paymentCount: 0,
    earnedOn: '2026-08-01',
    receivedOn: null,
    lastPaymentOn: null,
    invoiceRef: null,
    status: 'pending',
    statusNote: null,
    ...over,
  };
}

describe('month arithmetic', () => {
  it('rolls the year over in both directions', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-08')).toBe('2026-09');
  });

  /* ⚠️ The bug this guards: `new Date('2026-03-01')` is UTC midnight, which in
     Karachi (+05:00) is still 28 February. Anything that bucketed through a Date
     object would file the first of every month under the month before. These
     functions never construct one. */
  it('buckets the first of a month into that month, not the previous one', () => {
    expect(monthOf('2026-03-01')).toBe('2026-03');
    expect(monthOf('2026-01-01')).toBe('2026-01');
  });

  it('lists every month in a span, inclusive', () => {
    expect(monthsBetween('2026-06', '2026-09')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('returns nothing for a backwards span rather than looping', () => {
    expect(monthsBetween('2026-09', '2026-06')).toEqual([]);
  });

  it('labels a month readably', () => {
    expect(monthLabel('2026-08')).toBe('Aug 2026');
  });
});

describe('totals', () => {
  it('nets income against spend', () => {
    const t = totalsFor([expense({ amountPkr: 300 })], [revenue({ amountPkr: 1000 })]);
    expect(t.income).toBe(1000);
    expect(t.spend).toBe(300);
    expect(t.net).toBe(700);
    expect(t.marginPct).toBe(70);
  });

  it('reports a loss as a negative net', () => {
    const t = totalsFor([expense({ amountPkr: 8000 })], [revenue({ amountPkr: 2000 })]);
    expect(t.net).toBe(-6000);
    expect(t.marginPct).toBe(-300);
  });

  /* ⚠️ Null, never zero. A month that earned nothing and spent 800,000 has no
     meaningful margin, and 0% would read as break-even — the opposite of what
     happened. */
  it('has no margin when there was no income', () => {
    const t = totalsFor([expense({ amountPkr: 8000 })], []);
    expect(t.marginPct).toBeNull();
    expect(t.net).toBe(-8000);
  });
});

describe('monthlySeries', () => {
  /* ⚠️ A chart that silently drops March draws April straight after February and
     slopes the wrong way. Empty months must be present as zeroes. */
  it('emits a point for every month, including empty ones', () => {
    const series = monthlySeries(
      [expense({ incurredOn: '2026-06-10', amountPkr: 100 })],
      [revenue({ earnedOn: '2026-08-01', amountPkr: 900 })],
      '2026-06',
      '2026-08',
    );

    expect(series.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(series[1].income).toBe(0);
    expect(series[1].spend).toBe(0);
    expect(series[1].net).toBe(0);
    expect(series[2].income).toBe(900);
  });

  it('buckets on the accounting date, not the payment date', () => {
    const series = monthlySeries(
      [],
      /* Earned in July, paid in September. It belongs to July. */
      [revenue({ earnedOn: '2026-07-31', receivedOn: '2026-09-15', amountPkr: 500 })],
      '2026-07',
      '2026-09',
    );

    expect(series[0].income).toBe(500);
    expect(series[2].income).toBe(0);
  });
});

describe('byCategory', () => {
  it('groups and orders by size', () => {
    const slices = byCategory([
      expense({ id: 'a', categorySlug: 'rent', categoryName: 'Rent', amountPkr: 100 }),
      expense({ id: 'b', categorySlug: 'salaries', categoryName: 'Salaries', amountPkr: 900 }),
      expense({ id: 'c', categorySlug: 'rent', categoryName: 'Rent', amountPkr: 200 }),
    ]);

    expect(slices.map((s) => s.slug)).toEqual(['salaries', 'rent']);
    expect(slices[1].amount).toBe(300);
    expect(slices[1].count).toBe(2);
    expect(slices[0].sharePct).toBe(75);
  });

  it('produces no NaN shares on an empty ledger', () => {
    expect(byCategory([])).toEqual([]);
  });
});

describe('waterfall', () => {
  it('runs income down through each cost to the net', () => {
    const steps = waterfall(
      [
        expense({ id: 'a', categorySlug: 'salaries', categoryName: 'Salaries', amountPkr: 600 }),
        expense({ id: 'b', categorySlug: 'rent', categoryName: 'Rent', amountPkr: 200 }),
      ],
      [revenue({ amountPkr: 1000 })],
    );

    expect(steps[0].kind).toBe('income');
    expect(steps[0].to).toBe(1000);
    expect(steps[1].from).toBe(1000);
    expect(steps[1].to).toBe(400);
    expect(steps[2].to).toBe(200);

    const net = steps[steps.length - 1];
    expect(net.kind).toBe('net');
    expect(net.to).toBe(200);
    expect(net.label).toBe('Profit');
  });

  /* ⚠️ A negative final step must be labelled and coloured as a loss. A small
     positive-looking bar at the foot of a waterfall reads as a thin profit,
     which is the most expensive misreading this chart could invite. */
  it('labels a negative result as a loss', () => {
    const steps = waterfall([expense({ amountPkr: 5000 })], [revenue({ amountPkr: 1000 })]);
    const net = steps[steps.length - 1];
    expect(net.label).toBe('Loss');
    expect(net.to).toBe(-4000);
    expect(net.token).toBe('status-blocked');
  });

  it('folds categories under the threshold into one step', () => {
    const steps = waterfall(
      [
        expense({ id: 'a', categorySlug: 'salaries', categoryName: 'Salaries', amountPkr: 9800 }),
        expense({ id: 'b', categorySlug: 'tea', categoryName: 'Tea', amountPkr: 100 }),
        expense({ id: 'c', categorySlug: 'pens', categoryName: 'Pens', amountPkr: 100 }),
      ],
      [revenue({ amountPkr: 10_000 })],
    );

    /* income + salaries + the fold + net */
    expect(steps).toHaveLength(4);
    expect(steps[2].label).toBe('2 smaller categories');
    expect(steps[2].delta).toBe(-200);
  });
});

describe('outstanding', () => {
  it('counts only what has not settled', () => {
    const o = outstanding(
      [
        expense({ id: 'a', amountPkr: 100, paidOn: '2026-08-11' }),
        expense({ id: 'b', amountPkr: 250, paidOn: null }),
      ],
      [
        revenue({ id: 'r1', amountPkr: 900, status: 'invoiced' }),
        revenue({ id: 'r2', amountPkr: 100, status: 'received', receivedOn: '2026-08-05' }),
      ],
    );

    expect(o.unpaidSpend).toBe(250);
    expect(o.unpaidSpendCount).toBe(1);
    expect(o.unreceivedIncome).toBe(900);
    expect(o.unreceivedIncomeCount).toBe(1);
  });

  /* ⚠️ The case that made this read STATUS instead of `receivedOn`. Both of
     these have no received date, and neither is money anybody is still waiting
     for — counting them would keep a debt on the books that has already been
     abandoned or refunded. */
  it('does not chase money that was returned or written off', () => {
    const o = outstanding(
      [],
      [
        revenue({ id: 'r1', amountPkr: 900, status: 'pending' }),
        revenue({ id: 'r2', amountPkr: 500, status: 'returned' }),
        revenue({ id: 'r3', amountPkr: 700, status: 'written_off' }),
      ],
    );

    expect(o.unreceivedIncome).toBe(900);
    expect(o.unreceivedIncomeCount).toBe(1);
  });
});

describe('breakEven', () => {
  it('says how much more income a loss needed', () => {
    expect(breakEven(totalsFor([expense({ amountPkr: 900 })], [revenue({ amountPkr: 400 })]))).toBe(
      500,
    );
  });

  /* Null rather than 0: "you need 0 more" describes a problem that does not
     exist and invites the reader to go looking for one. */
  it('says nothing when the period was profitable', () => {
    expect(breakEven(totalsFor([expense({ amountPkr: 100 })], [revenue({ amountPkr: 400 })]))).toBeNull();
  });
});

describe('changePct', () => {
  it('reports an ordinary change', () => {
    expect(changePct(12_000, 10_000)).toBe(20);
    expect(changePct(8_000, 10_000)).toBe(-20);
  });

  /* ⚠️ The guard that exists because the dashboard once printed "+1640%". A
     tiny base makes any change look enormous and tells the reader nothing. */
  it('refuses a figure when the base is too small to mean anything', () => {
    expect(changePct(36_000, 2)).toBeNull();
    expect(changePct(500, 900)).toBeNull();
  });

  it('refuses a figure when the ratio is absurd', () => {
    expect(changePct(500_000, 10_000)).toBeNull();
  });
});

describe('money formatting', () => {
  it('pins the locale so the server and the browser agree', () => {
    expect(pkr(120_000)).toBe('PKR 120,000');
    expect(plain(1_234_567)).toBe('1,234,567');
  });

  it('compacts large figures and leaves small ones exact', () => {
    expect(pkrCompact(805_000)).toBe('PKR 8.1L');
    expect(pkrCompact(9_400)).toBe('PKR 9.4k');
    /* ⚠️ Below a thousand the exact figure is printed. "PKR 0k" for 940 rupees
       would be a lie told to save four characters. */
    expect(pkrCompact(940)).toBe('PKR 940');
  });

  it('drops a trailing zero that would imply precision', () => {
    expect(pkrCompact(2_000)).toBe('PKR 2k');
  });

  /* ⚠️ A true minus sign, not a hyphen: at the weight these are set, a hyphen
     is easy to miss, and missing it inverts a profit line. */
  it('signs a figure with a real minus sign', () => {
    expect(signed(42_000)).toBe('+PKR 42,000');
    expect(signed(-8_500)).toBe('−PKR 8,500');
    expect(signed(0)).toBe('PKR 0');
  });
});
