import { shortDate } from '@/lib/view/attendance-board';
import type { ExpenseCategory, PayrollLineRow } from '@/lib/db/queries/finance';
import type { ToolBoardRow } from '@/lib/db/queries/subscriptions';
import type { PaidPerson, ReviewDue } from '@/lib/db/queries/compensation';
import {
  type CategorySlice,
  type LedgerExpense,
  type LedgerRevenue,
  type MonthKey,
  type MonthPoint,
  type Outstanding,
  type Totals,
  type WaterfallStep,
  breakEven,
  byCategory,
  changePct,
  monthLabel,
  monthOf,
  monthlySeries,
  outstanding,
  previousMonth,
  totalsFor,
  waterfall,
} from '@/lib/domain/finance';

/* ============================================================================
 * ASSEMBLING THE FINANCE SCREEN
 * ----------------------------------------------------------------------------
 * Query output plus domain arithmetic, in exactly the shape the page renders.
 * Pure — no database, no React — so the numbers on the screen can be asserted
 * without booting anything.
 *
 * ── ⚠️ THIS RUNS ON THE SERVER AND ITS OUTPUT CROSSES TO A CLIENT COMPONENT ─
 * Which means everything in the returned object is readable in `view-source` by
 * whoever loads the page. lib/view/project-finance.ts documents the real leak
 * that taught this: a monthly fee was gated at every render site and still sat
 * in the RSC payload for anybody to read.
 *
 * The defence here is not to redact this board — it is that a Coordinator never
 * receives one. `app/(app)/finance/page.tsx` branches on the server and builds
 * this only for an Admin. A Coordinator's payload contains a form and nothing
 * else. See that file.
 * ========================================================================= */

export interface FinanceHero {
  readonly income: number;
  readonly spend: number;
  readonly net: number;
  readonly marginPct: number | null;
  /** Change against the previous period, or null when it cannot be stated. */
  readonly incomeChangePct: number | null;
  readonly spendChangePct: number | null;
  /** How much more income this period needed to break even, or null if it did. */
  readonly shortfall: number | null;
}

export interface PayrollLine {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly officeTeam: string;
  readonly monthlySalary: number;
  readonly currency: string;
  /** Share of the payroll bill, 0–100. */
  readonly sharePct: number;
}

export interface OfficeSplit {
  readonly office: string;
  readonly label: string;
  readonly amount: number;
  readonly sharePct: number;
}

export interface FinanceBoard {
  readonly hero: FinanceHero;
  readonly totals: Totals;
  readonly categories: readonly CategorySlice[];
  readonly waterfall: readonly WaterfallStep[];
  readonly series: readonly MonthPoint[];
  readonly outstanding: Outstanding;
  readonly expenses: readonly LedgerExpense[];
  readonly revenue: readonly LedgerRevenue[];
  readonly payroll: readonly PayrollLine[];
  readonly payrollTotal: number;
  /**
   * One month of payroll per key, `yyyy-mm`.
   *
   * ⚠️ Keyed by month rather than flat, because the Payroll screen picks its
   * own month independently of the page's date range — a payroll is a monthly
   * event, and asking "what did we pay in June" through a six-month filter is
   * the wrong question shape.
   */
  readonly payrollFor: Readonly<Record<string, readonly PayrollLineRow[]>>;
  /** Months offered in that picker, newest first. */
  readonly payrollMonths: readonly MonthKey[];
  /** Probations and internships coming to an end, or already past. */
  readonly reviewsDue: readonly ReviewDue[];
  readonly offices: readonly OfficeSplit[];
  readonly tools: readonly ToolBoardRow[];
  readonly toolSpend: number;
  readonly seatCount: number;
  readonly categoryOptions: readonly ExpenseCategory[];
  readonly range: { readonly from: string; readonly to: string; readonly label: string };
  /** Months with posted salary/subscription rows, newest first. */
  readonly postedMonths: readonly MonthKey[];
}

export interface FinanceBoardInput {
  readonly expenses: readonly LedgerExpense[];
  readonly revenue: readonly LedgerRevenue[];
  /** The period immediately before, for the change figures. Empty is fine. */
  readonly priorExpenses: readonly LedgerExpense[];
  readonly priorRevenue: readonly LedgerRevenue[];
  readonly payroll: readonly PaidPerson[];
  readonly tools: readonly ToolBoardRow[];
  readonly categoryOptions: readonly ExpenseCategory[];
  readonly postedMonths: readonly MonthKey[];
  readonly payrollFor: Readonly<Record<string, readonly PayrollLineRow[]>>;
  readonly payrollMonths: readonly MonthKey[];
  readonly reviewsDue: readonly ReviewDue[];
  readonly from: string;
  readonly to: string;
  readonly rangeLabel: string;
}

const OFFICE_LABEL: Readonly<Record<string, string>> = {
  blue_area: 'Blue Area',
  wah: 'Wah',
};

export function buildFinanceBoard(input: FinanceBoardInput): FinanceBoard {
  const totals = totalsFor(input.expenses, input.revenue);
  const prior = totalsFor(input.priorExpenses, input.priorRevenue);
  const categories = byCategory(input.expenses);

  /* ── The monthly series ───────────────────────────────────────────────────
     Bucketed across whatever months the range spans. A single-month range
     therefore yields one point, which the chart draws as one bar rather than
     pretending to be a trend. */
  const series = monthlySeries(
    input.expenses,
    input.revenue,
    monthOf(input.from),
    monthOf(input.to),
  );

  /* ── Payroll ──────────────────────────────────────────────────────────────
     ⚠️ This is the RATE CARD — what people are paid NOW — and not what any past
     month cost. Those are the posted ledger rows, which are already inside
     `expenses`. Showing both is deliberate: one answers "what do we owe every
     month", the other "what did March actually cost", and conflating them is the
     mistake migration 064's header exists to prevent. */
  const payrollTotal = input.payroll.reduce((sum, p) => sum + p.monthlySalary, 0);
  const payroll: PayrollLine[] = input.payroll.map((person) => ({
    userId: person.userId,
    name: person.fullName,
    roleTitle: person.roleTitle,
    officeTeam: person.officeTeam,
    monthlySalary: person.monthlySalary,
    currency: person.currency,
    sharePct: payrollTotal > 0 ? round1((person.monthlySalary / payrollTotal) * 100) : 0,
  }));

  /* ── Spend by office ──────────────────────────────────────────────────────
     ⚠️ Rows with no office are deliberately EXCLUDED rather than bucketed into
     one of the two. A subscription is not bought by Blue Area or by Wah, and
     assigning it to either would invent a fact. The panel says what it covers. */
  const byOffice = new Map<string, number>();
  for (const expense of input.expenses) {
    if (!expense.officeTeam) continue;
    byOffice.set(expense.officeTeam, (byOffice.get(expense.officeTeam) ?? 0) + expense.amountPkr);
  }
  const officeTotal = [...byOffice.values()].reduce((a, b) => a + b, 0);
  const offices: OfficeSplit[] = [...byOffice.entries()]
    .map(([office, amount]) => ({
      office,
      label: OFFICE_LABEL[office] ?? office,
      amount,
      sharePct: officeTotal > 0 ? round1((amount / officeTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const seatCount = input.tools.reduce((sum, tool) => sum + tool.holders.length, 0);
  const toolSpend = input.tools.reduce((sum, tool) => sum + tool.monthlySpend, 0);

  return {
    hero: {
      income: totals.income,
      spend: totals.spend,
      net: totals.net,
      marginPct: totals.marginPct,
      incomeChangePct: changePct(totals.income, prior.income),
      spendChangePct: changePct(totals.spend, prior.spend),
      shortfall: breakEven(totals),
    },
    totals,
    categories,
    waterfall: waterfall(input.expenses, input.revenue),
    series,
    outstanding: outstanding(input.expenses, input.revenue),
    expenses: input.expenses,
    revenue: input.revenue,
    payroll,
    payrollTotal,
    payrollFor: input.payrollFor,
    payrollMonths: input.payrollMonths,
    reviewsDue: input.reviewsDue,
    offices,
    tools: input.tools,
    toolSpend,
    seatCount,
    categoryOptions: input.categoryOptions,
    range: { from: input.from, to: input.to, label: input.rangeLabel },
    postedMonths: input.postedMonths,
  };
}

/* ── Filtering, on the client ────────────────────────────────────────────── */

export interface ExpenseFilter {
  readonly category: string;
  readonly office: string;
  readonly query: string;
  readonly settled: 'all' | 'paid' | 'unpaid';
}

export function filterExpenses(
  rows: readonly LedgerExpense[],
  filter: ExpenseFilter,
): LedgerExpense[] {
  const needle = filter.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filter.category !== 'all' && row.categorySlug !== filter.category) return false;
    if (filter.office !== 'all' && row.officeTeam !== filter.office) return false;
    if (filter.settled === 'paid' && row.paidOn === null) return false;
    if (filter.settled === 'unpaid' && row.paidOn !== null) return false;
    if (needle === '') return true;

    /* Searches the fields somebody would actually type: what it was, who it was
       for, and who it was paid to. Not the amount — a numeric search box that
       matches "1" against every four-figure sum is worse than no search. */
    return (
      row.title.toLowerCase().includes(needle) ||
      (row.vendor ?? '').toLowerCase().includes(needle) ||
      (row.personName ?? '').toLowerCase().includes(needle) ||
      row.categoryName.toLowerCase().includes(needle)
    );
  });
}

/* ── The period before this one ──────────────────────────────────────────────
   For the change figures. A range of any length is shifted back by its own
   length, so "last 30 days" compares against the 30 before it and a single
   month against the month before. */

export function priorPeriod(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const day = 86_400_000;
  const length = Math.max(day, end - start + day);

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(start - length), to: iso(start - day) };
}

/* ── Ranges ──────────────────────────────────────────────────────────────────
   ⚠️ DELIBERATELY NOT `attendance-board.ts`'s RangeKey. That set opens with
   `today` and `yesterday`, which are the right questions for a timesheet and
   meaningless for a ledger — nothing is spent on most days, so "today" would
   show an empty page most of the time and read as broken. A ledger is read in
   months, quarters and years, so those are the presets.

   The two modules share `shortDate` and nothing else; duplicating a small date
   helper would be worse than importing it. */

export type RangeKey =
  | 'this_month'
  | 'last_month'
  | 'last_3'
  | 'last_6'
  | 'this_year'
  | 'last_year'
  /** Two dates the reader chose. Carried in the URL, not derived from today. */
  | 'custom';

export interface Range {
  readonly key: RangeKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * A range key and a given today, into two dates.
 *
 * ⚠️ `today` is a parameter, never a `new Date()` in here. Reading the clock
 * inside would make this untestable and let the page disagree with itself across
 * midnight — the same rule `resolveRange` in attendance-board.ts follows.
 *
 * ⚠️ Every range ENDS on the last day of its final month, not on today. A
 * ledger's month is a whole month: cutting "this month" off at the 26th would
 * make the chart's last bar shorter than the others for no reason a reader could
 * see, and would look like a collapse in spending.
 */
export function resolveRange(key: RangeKey, today: string): Range {
  const [y, m] = today.split('-').map(Number);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  /* Day 0 of the next month is the last day of this one — no table of month
     lengths, and February and leap years handle themselves. */
  const lastDayOf = (year: number, month: number) => iso(Date.UTC(year, month, 0));
  const firstDayOf = (year: number, month: number) => iso(Date.UTC(year, month - 1, 1));

  switch (key) {
    case 'last_month': {
      const year = m === 1 ? y - 1 : y;
      const month = m === 1 ? 12 : m - 1;
      return {
        key,
        label: 'Last month',
        from: firstDayOf(year, month),
        to: lastDayOf(year, month),
      };
    }
    case 'last_3':
      return {
        key,
        label: 'Last 3 months',
        from: iso(Date.UTC(y, m - 3, 1)),
        to: lastDayOf(y, m),
      };
    case 'last_6':
      return {
        key,
        label: 'Last 6 months',
        from: iso(Date.UTC(y, m - 6, 1)),
        to: lastDayOf(y, m),
      };
    case 'this_year':
      return { key, label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last_year':
      return { key, label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return {
        key: 'this_month',
        label: 'This month',
        from: firstDayOf(y, m),
        to: lastDayOf(y, m),
      };
  }
}

/** ⚠️ `custom` is absent: it is what the two date fields produce, not something
 *  anybody picks from a list. Offering it would be a control that does nothing
 *  until two other controls are used. */
export const RANGE_KEYS: readonly RangeKey[] = [
  'this_month',
  'last_month',
  'last_3',
  'last_6',
  'this_year',
  'last_year',
];

export const RANGE_LABEL: Readonly<Record<RangeKey, string>> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3: 'Last 3 months',
  last_6: 'Last 6 months',
  this_year: 'This year',
  last_year: 'Last year',
  custom: 'Custom range',
};

/** A range from two dates the reader typed. Falls back rather than erroring. */
export function customRange(from: string, to: string, today: string): Range {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!valid(from) || !valid(to)) return resolveRange('this_month', today);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return {
    key: 'custom',
    label: start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`,
    from: start,
    to: end,
  };
}

/** `Mar 2026` for a month key, re-exported so pages need one import. */
export { monthLabel, monthOf, previousMonth, shortDate };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
