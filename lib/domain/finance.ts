/* ============================================================================
 * PROFIT AND LOSS — THE ARITHMETIC, AND NOTHING ELSE
 * ----------------------------------------------------------------------------
 * Pure. No database, no React, no clock, no randomness (doc 20 §1) — so every
 * figure the finance page prints can be asserted in a unit test without a
 * connection, and the number in the PDF is the number on the screen by
 * construction rather than by luck.
 *
 * ── ⚠️ EVERY TOTAL HERE IS TAKEN ON THE ACCOUNTING DATE ─────────────────────
 * `incurredOn` for spend, `earnedOn` for income — never the date money moved.
 * That is accrual accounting and it is the whole reason both dates exist:
 * a client who pays three weeks late must not make August look like a bad month
 * and September like a miracle. `paidOn`/`receivedOn` answer one different
 * question — what is still outstanding — and are used ONLY for that.
 * ========================================================================= */

/** A month, as `yyyy-mm`. The key every series is bucketed by. */
export type MonthKey = string;

export interface LedgerExpense {
  readonly id: string;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly categoryToken: string;
  readonly title: string;
  readonly amountPkr: number;
  /** The accounting date, `yyyy-mm-dd`. */
  readonly incurredOn: string;
  readonly paidOn: string | null;
  readonly officeTeam: string | null;
  readonly vendor: string | null;
  readonly personName: string | null;
  readonly source: 'manual' | 'payroll_run' | 'subscription_run';
  /** The second level: which utility, which tool. Null where none applies. */
  readonly subtype: string | null;
  readonly subtypeOther: string | null;
  /** For a tool expense: whose seat it paid for. */
  readonly seatHolderName: string | null;
  /**
   * Whether a receipt is attached.
   *
   * ⚠️ A BOOLEAN, NOT THE PATH. The storage key is useless to a browser (the
   * bucket is private) and handing it out invites somebody to build a URL from
   * it. The path stays server-side; a link is signed on demand when a reader
   * actually opens the row.
   */
  readonly hasReceipt: boolean;
  readonly receiptName: string | null;
}

/** Where a piece of income stands. `received` is the only money in hand. */
export type RevenueStatus = 'pending' | 'invoiced' | 'received' | 'returned' | 'written_off';

export interface LedgerRevenue {
  readonly id: string;
  readonly kind: 'retainer' | 'one_off' | 'add_on';
  readonly sourceName: string;
  /** The project this was billed against, where there is one. */
  readonly projectId: string | null;
  /** What was BILLED. */
  readonly amountPkr: number;
  /**
   * What has actually ARRIVED, across every instalment.
   *
   * ⚠️ Maintained in the database by `sync_revenue_settlement` (migration 074),
   * never computed here and never written by the application. Two places
   * totalling the same payments is two places that can disagree.
   */
  readonly paidPkr: number;
  /** How many separate receipts make up `paidPkr`. */
  readonly paymentCount: number;
  /** The accounting date, `yyyy-mm-dd`. */
  readonly earnedOn: string;
  /** When it was settled IN FULL, or null while anything is outstanding. */
  readonly receivedOn: string | null;
  /** The most recent instalment, settled or not. */
  readonly lastPaymentOn: string | null;
  readonly invoiceRef: string | null;
  readonly status: RevenueStatus;
  readonly statusNote: string | null;
}

/** One receipt against an invoice. Many of these may share a `revenueId`. */
export interface RevenuePayment {
  readonly id: string;
  readonly revenueId: string;
  readonly amountPkr: number;
  readonly receivedOn: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly note: string | null;
  /**
   * ⚠️ A BOOLEAN, NOT THE PATH — the same rule receipts follow. The storage key
   * is useless to a browser (the bucket is private) and handing it out invites
   * somebody to build a URL from it. A link is signed on demand instead.
   */
  readonly hasProof: boolean;
  readonly proofName: string | null;
  readonly proofMime: string | null;
  readonly recordedBy: string | null;
  readonly createdAt: string;
}

export type PaymentMethod = 'bank_transfer' | 'cash' | 'cheque' | 'online' | 'other';

export const PAYMENT_METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  online: 'Online / wallet',
  other: 'Other',
};

/* ============================================================================
 * WHERE AN INVOICE STANDS
 * ----------------------------------------------------------------------------
 * ── ⚠️ TWO IDEAS, NOT ONE, AND CONFLATING THEM IS WHAT WENT WRONG ──────────
 * An invoice has a BILLING state — has it been raised, has it been written off
 * — and a SETTLEMENT state, which is arithmetic: billed against collected. The
 * first is a decision somebody records; the second is a fact about money.
 *
 * The stored `status` enum only ever expressed the first, which is why it could
 * not say "half paid". Adding a value to it was the obvious fix and a bad one:
 * Postgres refuses to USE a new enum value in the transaction that adds it
 * (migrations 066/067 exist solely because of that), and more importantly it
 * would have put a derived fact into a column somebody can set by hand.
 *
 * So the settlement view is computed here, from the amounts, and the terminal
 * decisions win over it. One badge on screen, two honest inputs.
 * ========================================================================= */

export type SettlementState =
  | 'pending'
  | 'invoiced'
  | 'part_paid'
  | 'received'
  | 'returned'
  | 'written_off';

/**
 * The single state to show for an invoice.
 *
 * ⚠️ `written_off` and `returned` are checked FIRST. Money can arrive against a
 * written-off invoice — a debt honoured late, a reversed refund — and the
 * receipt is still recorded, but the invoice's own verdict is not overturned by
 * arithmetic. Migration 074's trigger makes the same call, in the same order,
 * for the same reason; if one changes, change both.
 */
export function settlementOf(entry: {
  status: RevenueStatus;
  amountPkr: number;
  paidPkr: number;
}): SettlementState {
  if (entry.status === 'written_off' || entry.status === 'returned') return entry.status;
  if (entry.amountPkr > 0 && entry.paidPkr >= entry.amountPkr) return 'received';
  if (entry.paidPkr > 0) return 'part_paid';
  return entry.status === 'received' ? 'invoiced' : entry.status;
}

/** What is still owed. Never negative — an overpayment is not a debt. */
export function outstandingOf(entry: { amountPkr: number; paidPkr: number }): number {
  return Math.max(0, entry.amountPkr - entry.paidPkr);
}

/**
 * Paid beyond the invoice — an advance, or a double transfer.
 *
 * ⚠️ Surfaced rather than clamped away. An overpayment is somebody's money sitting
 * in the account, and a screen that silently shows it as "paid in full" is how it
 * stays unreturned.
 */
export function overpaidOf(entry: { amountPkr: number; paidPkr: number }): number {
  return Math.max(0, entry.paidPkr - entry.amountPkr);
}

/** How each state reads, and whether the money is in hand. */
export const REVENUE_STATUS_META: Readonly<
  Record<SettlementState, { label: string; token: string; collected: boolean }>
> = {
  pending: { label: 'Not billed', token: 'status-backlog', collected: false },
  invoiced: { label: 'Awaiting payment', token: 'status-todo', collected: false },
  part_paid: { label: 'Part paid', token: 'status-progress', collected: false },
  received: { label: 'Paid in full', token: 'status-done', collected: true },
  returned: { label: 'Refunded', token: 'status-blocked', collected: false },
  written_off: { label: 'Written off', token: 'status-cancelled', collected: false },
};

/**
 * The states an Admin may set by hand.
 *
 * ⚠️ `part_paid` and `received` are NOT among them, and that is the point. Both
 * are consequences of money arriving, so they are reached by recording a
 * payment — never by choosing them from a menu. A status picker that can mark
 * an invoice paid without a receipt behind it is exactly the accuracy hole the
 * owner closed on expenses: *"It's not about trust, it's about accuracy."*
 */
export const SETTABLE_REVENUE_STATUSES: readonly RevenueStatus[] = [
  'pending',
  'invoiced',
  'returned',
  'written_off',
];

/* ── Months ─────────────────────────────────────────────────────────────────
   Deliberately string arithmetic rather than `Date`. A `new Date('2026-03-01')`
   is parsed as UTC midnight, and in Karachi (+05:00) that is still February
   the 28th at 7pm — so bucketing through a Date object files the first day of
   every month under the previous one. These functions cannot make that mistake
   because they never construct a Date at all. */

/** `2026-03-17` → `2026-03`. */
export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

/** `2026-03` → `2026-04`, rolling the year over at December. */
export function nextMonth(key: MonthKey): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** `2026-03` → `2026-02`, rolling back at January. */
export function previousMonth(key: MonthKey): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to` inclusive, oldest first. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  if (from > to) return [];
  const out: MonthKey[] = [];
  let cursor = from;
  /* Bounded rather than `while (true)`: a malformed key would otherwise spin
     forever, and 600 months is fifty years — past any range this will see. */
  for (let i = 0; i < 600 && cursor <= to; i += 1) {
    out.push(cursor);
    cursor = nextMonth(cursor);
  }
  return out;
}

/** `2026-03` → `Mar 2026`. */
export function monthLabel(key: MonthKey): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = Number(key.slice(5, 7));
  return `${MONTHS[month - 1] ?? '???'} ${key.slice(0, 4)}`;
}

/** `2026-03` → `2026-03-01`, the date column value a posted row carries. */
export function monthStart(key: MonthKey): string {
  return `${key}-01`;
}

/* ── Totals ──────────────────────────────────────────────────────────────── */

export interface Totals {
  readonly income: number;
  readonly spend: number;
  /** Income minus spend. Negative is a loss, and is shown as one. */
  readonly net: number;
  /**
   * Net as a percentage of income, or null when there was no income.
   *
   * ⚠️ NULL, NOT ZERO. A month that earned nothing and spent 800,000 has no
   * meaningful margin — the honest answer is "there is no ratio here", and 0%
   * would read as break-even, which is the opposite of what happened.
   */
  readonly marginPct: number | null;
}

export function totalsFor(
  expenses: readonly LedgerExpense[],
  revenue: readonly LedgerRevenue[],
): Totals {
  const spend = sum(expenses, (e) => e.amountPkr);
  const income = sum(revenue, (r) => r.amountPkr);
  return {
    income,
    spend,
    net: income - spend,
    marginPct: income > 0 ? round1(((income - spend) / income) * 100) : null,
  };
}

/** One month's figures, for the trend chart. */
export interface MonthPoint extends Totals {
  readonly month: MonthKey;
  readonly label: string;
}

/**
 * A point for every month in the range, INCLUDING the empty ones.
 *
 * ⚠️ Gaps are filled with zeroes rather than skipped. A line chart that silently
 * drops March draws April straight after February and slopes the wrong way — the
 * axis then lies about the shape of the year, which is the one thing a trend is
 * read for.
 */
export function monthlySeries(
  expenses: readonly LedgerExpense[],
  revenue: readonly LedgerRevenue[],
  from: MonthKey,
  to: MonthKey,
): MonthPoint[] {
  const spendBy = bucket(expenses, (e) => monthOf(e.incurredOn), (e) => e.amountPkr);
  const incomeBy = bucket(revenue, (r) => monthOf(r.earnedOn), (r) => r.amountPkr);

  return monthsBetween(from, to).map((month) => {
    const income = incomeBy.get(month) ?? 0;
    const spend = spendBy.get(month) ?? 0;
    return {
      month,
      label: monthLabel(month),
      income,
      spend,
      net: income - spend,
      marginPct: income > 0 ? round1(((income - spend) / income) * 100) : null,
    };
  });
}

/* ── Where the money went ───────────────────────────────────────────────── */

export interface CategorySlice {
  readonly slug: string;
  readonly label: string;
  readonly token: string;
  readonly amount: number;
  /** Share of total spend, 0–100. */
  readonly sharePct: number;
  readonly count: number;
}

/** Spend grouped by category, biggest first. */
export function byCategory(expenses: readonly LedgerExpense[]): CategorySlice[] {
  const groups = new Map<string, { label: string; token: string; amount: number; count: number }>();

  for (const expense of expenses) {
    const existing = groups.get(expense.categorySlug);
    if (existing) {
      existing.amount += expense.amountPkr;
      existing.count += 1;
    } else {
      groups.set(expense.categorySlug, {
        label: expense.categoryName,
        token: expense.categoryToken,
        amount: expense.amountPkr,
        count: 1,
      });
    }
  }

  const total = sum(expenses, (e) => e.amountPkr);

  return [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      label: g.label,
      token: g.token,
      amount: g.amount,
      /* Guarded: an empty ledger divides by zero and every share becomes NaN,
         which renders as "NaN%" rather than as nothing. */
      sharePct: total > 0 ? round1((g.amount / total) * 100) : 0,
      count: g.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/* ── The waterfall ──────────────────────────────────────────────────────────
   Income, then each category as a step down, ending on what is left. It is the
   one picture that answers "where did it all go" in a single glance, which no
   chart in this product currently does. */

export interface WaterfallStep {
  readonly label: string;
  readonly token: string;
  /** Positive for income, negative for spend. */
  readonly delta: number;
  /** The running total BEFORE this step — where the bar starts. */
  readonly from: number;
  /** The running total AFTER it — where the bar ends. */
  readonly to: number;
  readonly kind: 'income' | 'spend' | 'net';
}

/**
 * ⚠️ Small categories are folded into one "Other" step rather than drawn.
 * Eleven steps of which six are under two percent is a chart that is mostly
 * hairlines — unreadable, and it hides the four that matter. The fold is stated
 * in the step's own label so nothing is silently dropped.
 */
export function waterfall(
  expenses: readonly LedgerExpense[],
  revenue: readonly LedgerRevenue[],
  minSharePct = 3,
): WaterfallStep[] {
  const income = sum(revenue, (r) => r.amountPkr);
  const slices = byCategory(expenses);

  const big = slices.filter((s) => s.sharePct >= minSharePct);
  const small = slices.filter((s) => s.sharePct < minSharePct);

  const steps: WaterfallStep[] = [];
  let running = 0;

  steps.push({
    label: 'Income',
    token: 'status-done',
    delta: income,
    from: 0,
    to: income,
    kind: 'income',
  });
  running = income;

  for (const slice of big) {
    steps.push({
      label: slice.label,
      token: slice.token,
      delta: -slice.amount,
      from: running,
      to: running - slice.amount,
      kind: 'spend',
    });
    running -= slice.amount;
  }

  if (small.length > 0) {
    const amount = sum(small, (s) => s.amount);
    steps.push({
      label: small.length === 1 ? small[0].label : `${small.length} smaller categories`,
      token: 'status-cancelled',
      delta: -amount,
      from: running,
      to: running - amount,
      kind: 'spend',
    });
    running -= amount;
  }

  steps.push({
    label: running >= 0 ? 'Profit' : 'Loss',
    token: running >= 0 ? 'status-done' : 'status-blocked',
    delta: running,
    from: 0,
    to: running,
    kind: 'net',
  });

  return steps;
}

/* ── What has not been settled ───────────────────────────────────────────── */

export interface Outstanding {
  readonly unpaidSpend: number;
  readonly unpaidSpendCount: number;
  readonly unreceivedIncome: number;
  readonly unreceivedIncomeCount: number;
}

/**
 * ⚠️ This is the ONLY place settlement is read. Everything else is on the
 * accounting date — see the header.
 *
 * ⚠️ Income is judged on STATUS, not on `receivedOn`. A returned payment and a
 * written-off invoice both have no received date, and neither is money anybody
 * is still waiting for — counting them as outstanding would keep a debt on the
 * books that has already been settled or abandoned.
 */
export function outstanding(
  expenses: readonly LedgerExpense[],
  revenue: readonly LedgerRevenue[],
): Outstanding {
  const unpaid = expenses.filter((e) => e.paidOn === null);
  const unreceived = revenue.filter((r) => r.status === 'pending' || r.status === 'invoiced');
  return {
    unpaidSpend: sum(unpaid, (e) => e.amountPkr),
    unpaidSpendCount: unpaid.length,
    unreceivedIncome: sum(unreceived, (r) => r.amountPkr),
    unreceivedIncomeCount: unreceived.length,
  };
}

/**
 * How much income a month needs before it stops losing money.
 *
 * Returns null when the month is already profitable — "you need 0 more" is a
 * statement about a problem that does not exist, and a tile showing it invites
 * the reader to look for one.
 */
export function breakEven(totals: Totals): number | null {
  return totals.net >= 0 ? null : totals.spend - totals.income;
}

/**
 * Change between two figures, as a percentage.
 *
 * ⚠️ Guarded exactly as `lib/view/dashboard-model.ts` is, and for the same
 * reason: a base of 2 growing to 36 is a true "+1700%" and a useless one. Below
 * a floor, or past a ratio, the honest answer is a word rather than a number.
 * That guard was added after the dashboard printed "+1640%" at a reader.
 */
export function changePct(current: number, previous: number): number | null {
  const MIN_BASE = 1_000;   // a rupee base makes any change look infinite
  const MAX_RATIO = 10;
  if (previous < MIN_BASE) return null;
  const ratio = current / previous;
  if (ratio > MAX_RATIO) return null;
  return round1(((current - previous) / previous) * 100);
}

/* ── Small shared helpers ────────────────────────────────────────────────── */

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function bucket<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  valueOf: (item: T) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, (map.get(key) ?? 0) + valueOf(item));
  }
  return map;
}

/** One decimal place, without the float dust `x * 10 / 10` leaves behind. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
