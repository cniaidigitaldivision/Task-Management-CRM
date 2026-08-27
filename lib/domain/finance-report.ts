import type { ChartSpec } from '@/lib/domain/report-charts';
import type { Cell, Report } from '@/lib/domain/reports';
import { formatNumber } from '@/lib/view/number-format';
import type {
  CategorySlice,
  LedgerExpense,
  LedgerRevenue,
  MonthPoint,
  Outstanding,
  Totals,
} from '@/lib/domain/finance';

/* ============================================================================
 * FINANCE AS A REPORT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"make sure the report template is the same as the report
 * pages' PDF template."*
 *
 * So finance gets no print layout of its own. It is turned into the `Report`
 * shape that lib/pdf/report-sheet.ts already draws — the same masthead, the same
 * filter bar, the same figure cards, the same paginated table, the same notes
 * block — exactly as attendance was on 2026-08-25.
 *
 * ── ⚠️ ONE OBJECT FEEDS ALL THREE FORMATS ──────────────────────────────────
 * The CSV, the spreadsheet and the PDF are all written from this. Building it
 * inside the export action instead would mean three formats agreeing by luck;
 * building it here means the total in the PDF is the total in the CSV by
 * construction, and the whole thing is testable without a database.
 *
 * ── ⚠️ WHAT THE PDF ACTUALLY CONTAINS ──────────────────────────────────────
 * `composeReportSheet` accepts a `charts` argument and never draws it — verified
 * by grep: `charts` appears in report-sheet.ts only at its import and its
 * interface field. The exported PDF therefore holds the masthead, the filter
 * bar, four figure cards, the table and the notes. That is precisely what the
 * Reports page's own PDF holds today, which is what "the same template" means.
 * `financeCharts` below is still built, because the SCREEN draws it.
 * ========================================================================= */

const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number): Cell => ({ kind: 'number', value });
const date = (value: string | null): Cell => ({ kind: 'date', value });
const pct = (value: number): Cell => ({ kind: 'percent', value });

/**
 * A grouped rupee figure as TEXT, for the summary cards only.
 *
 * ⚠️ Grouped by `formatNumber`'s `money` form rather than `toLocaleString`, so
 * the PDF, the CSV and the screen all group identically — several `en-*` locales
 * use the lakh/crore system, and a figure that differs between the artefact and
 * the screen it came from is the one thing this report must not do.
 */
const money = (value: number): Cell => ({
  kind: 'text',
  value: `PKR ${formatNumber(Math.round(value), 'money')}`,
});

export interface FinanceReportInput {
  readonly expenses: readonly LedgerExpense[];
  readonly revenue: readonly LedgerRevenue[];
  readonly totals: Totals;
  readonly categories: readonly CategorySlice[];
  readonly series: readonly MonthPoint[];
  readonly outstanding: Outstanding;
  readonly from: string;
  readonly to: string;
  readonly rangeLabel: string;
  /** What the reader narrowed to, in words. Printed under the title. */
  readonly filters: readonly string[];
}

/**
 * Every ledger line in the period — spend and income in one table.
 *
 * ── ⚠️ ONE TABLE, NOT TWO, AND THE SIGN IS THE DIFFERENCE ──────────────────
 * The print sheet draws a single table per report, so income and spend have to
 * share it. They are distinguished by a Direction column and by the sign of the
 * amount: income is positive, spend is negative. Summing the Amount column in a
 * spreadsheet therefore lands on the net, which is the figure somebody exporting
 * this is most likely to want.
 *
 * Splitting them into two reports instead would mean two exports to reconcile by
 * hand — the thing a ledger exists to avoid.
 */
export function buildFinanceReport(input: FinanceReportInput): Report {
  const t = input.totals;

  type Line = {
    readonly on: string;
    readonly direction: string;
    readonly category: string;
    readonly detail: string;
    readonly amount: number;
    readonly settled: string | null;
    readonly who: string;
  };

  const lines: Line[] = [
    ...input.revenue.map((r) => ({
      on: r.earnedOn,
      direction: 'Income',
      category: REVENUE_KIND_LABEL[r.kind],
      detail: r.sourceName,
      amount: r.amountPkr,
      settled: r.receivedOn,
      who: r.invoiceRef ?? '—',
    })),
    ...input.expenses.map((e) => ({
      on: e.incurredOn,
      direction: 'Spend',
      category: e.categoryName,
      detail: e.title,
      /* Negative, so the column sums to the net. See the note above. */
      amount: -e.amountPkr,
      settled: e.paidOn,
      who: e.personName ?? e.vendor ?? '—',
    })),
  ].sort((a, b) => (a.on === b.on ? a.direction.localeCompare(b.direction) : b.on.localeCompare(a.on)));

  return {
    /* Not one of the four analytical reports — see the note on `Report['type']`
       in lib/domain/reports.ts. Only `reportFileStem` reads this. */
    type: 'finance',
    title: 'Finance',
    subtitle: `Income and spending · ${input.rangeLabel}`,
    period: { start: input.from, end: input.to },

    columns: [
      { key: 'date', label: 'Date', kind: 'date', width: 11 },
      { key: 'direction', label: 'Direction', kind: 'text', width: 10 },
      { key: 'category', label: 'Category', kind: 'text', width: 16 },
      { key: 'detail', label: 'Detail', kind: 'text', width: 28 },
      { key: 'amount', label: 'Amount (PKR)', kind: 'number', width: 14 },
      { key: 'settled', label: 'Settled on', kind: 'date', width: 11 },
      { key: 'who', label: 'Person / vendor', kind: 'text', width: 20 },
    ],

    rows: lines.map((line) => [
      date(line.on),
      text(line.direction),
      text(line.category),
      text(line.detail),
      num(line.amount),
      date(line.settled),
      text(line.who),
    ]),

    /* ⚠️ Only the first four reach the printed cards — `drawCards` takes
       `report.figures.slice(0, 4)`. The four that matter most are therefore
       first, and the rest are still written into the CSV and the spreadsheet.

       ── ⚠️ THE FIGURES ARE TEXT; THE AMOUNT COLUMN IS NOT ──────────────────
       A `number` cell prints through the sheet's own formatter, which writes
       `4446000` — seen on the first exported PDF, and seven unseparated digits
       is a figure the reader has to count. These four are display values that
       nothing ever sums, so they are pre-formatted here.

       The Amount COLUMN above stays `num()` for the opposite reason: it must
       remain a real number so a spreadsheet can total it, which is the whole
       point of income being positive and spend negative. */
    figures: [
      { label: 'Income', value: money(t.income), hint: input.rangeLabel },
      { label: 'Spending', value: money(t.spend), hint: `${input.expenses.length} entries` },
      {
        label: t.net >= 0 ? 'Profit' : 'Loss',
        value: money(Math.abs(t.net)),
        hint: t.net >= 0 ? 'Income exceeded spending' : 'Spending exceeded income',
      },
      {
        label: 'Margin',
        /* ⚠️ Zero when there was no income, because a figure cell cannot be
           null. The notes say what that means — the only place this shape
           allows the distinction to be drawn. */
        value: pct(t.marginPct ?? 0),
        hint: t.marginPct === null ? 'No income in this period' : 'Net against income',
      },
      {
        label: 'Unpaid bills',
        value: money(input.outstanding.unpaidSpend),
        hint: `${input.outstanding.unpaidSpendCount} not yet paid`,
      },
      {
        label: 'Awaiting payment',
        value: money(input.outstanding.unreceivedIncome),
        hint: `${input.outstanding.unreceivedIncomeCount} not yet received`,
      },
      {
        label: 'Largest cost',
        value: money(input.categories[0]?.amount ?? 0),
        hint: input.categories[0]?.label ?? 'Nothing recorded',
      },
    ],

    notes: [
      'Every figure is taken on the date a cost was incurred or income was earned, not the date money moved. A client who pays late does not move income into the month the payment arrived.',
      'Amounts are shown negative for spending and positive for income, so the Amount column sums to the net for the period.',
      'Salary and subscription lines are posted from what each person is paid and what each tool costs at the moment the month is posted. Changing a salary later does not alter a month already recorded.',
      'A subscription billed yearly is divided by twelve to give its monthly cost. It is never counted twelve times.',
      ...(t.marginPct === null
        ? ['No income was recorded in this period, so the margin is shown as zero rather than calculated.']
        : []),
      ...(input.outstanding.unpaidSpendCount > 0 || input.outstanding.unreceivedIncomeCount > 0
        ? ['"Settled on" is blank where a bill has not been paid or an invoice has not been received. Those amounts are still counted in the totals above, because the cost was incurred and the income was earned.']
        : []),
      ...(input.filters.length > 0 ? [`Filtered: ${input.filters.join('; ')}.`] : []),
    ],
  };
}

const REVENUE_KIND_LABEL: Readonly<Record<LedgerRevenue['kind'], string>> = {
  retainer: 'Package retainer',
  one_off: 'One-off project',
  add_on: 'Add-on',
};

/* ============================================================================
 * ONE SCREEN, ONE REPORT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"when I click Export, the tab we have opened, the data
 * I'm watching, and the filter I'm applying, that thing will only be
 * exported."*
 *
 * `buildFinanceReport` above is the OVERVIEW — the one screen where money in
 * and money out are deliberately shown together. The three below are the
 * separate screens, and each contains only what that screen contains.
 * ========================================================================= */

/** Expenses only, with their sub-type and whether a receipt is on file. */
export function buildExpenseReport(input: {
  expenses: readonly LedgerExpense[];
  from: string;
  to: string;
  rangeLabel: string;
  filters: readonly string[];
  subtypeOf: (row: LedgerExpense) => string | null;
}): Report {
  const total = input.expenses.reduce((sum, row) => sum + row.amountPkr, 0);
  const unpaid = input.expenses.filter((row) => row.paidOn === null);
  const missing = input.expenses.filter((row) => row.source === 'manual' && !row.hasReceipt);

  return {
    type: 'finance',
    title: 'Expenses',
    subtitle: `What the division spent · ${input.rangeLabel}`,
    period: { start: input.from, end: input.to },

    columns: [
      { key: 'date', label: 'Date', kind: 'date', width: 11 },
      { key: 'category', label: 'Category', kind: 'text', width: 15 },
      { key: 'kind', label: 'Kind', kind: 'text', width: 13 },
      { key: 'detail', label: 'What it was', kind: 'text', width: 24 },
      { key: 'payee', label: 'Paid to', kind: 'text', width: 16 },
      { key: 'amount', label: 'Amount (PKR)', kind: 'number', width: 13 },
      { key: 'paid', label: 'Paid on', kind: 'date', width: 11 },
      { key: 'proof', label: 'Proof', kind: 'text', width: 8 },
    ],

    rows: input.expenses.map((row) => [
      date(row.incurredOn),
      text(row.categoryName),
      text(input.subtypeOf(row) ?? '—'),
      text(row.title),
      text(row.personName ?? row.vendor ?? '—'),
      num(row.amountPkr),
      date(row.paidOn),
      /* ⚠️ Posted rows are marked "auto", not "missing". They were generated,
         not claimed, so there is nothing anybody failed to attach. */
      text(row.hasReceipt ? 'Yes' : row.source === 'manual' ? 'MISSING' : 'auto'),
    ]),

    figures: [
      { label: 'Total spent', value: money(total), hint: `${input.expenses.length} entries` },
      {
        label: 'Unpaid',
        value: money(unpaid.reduce((s, r) => s + r.amountPkr, 0)),
        hint: `${unpaid.length} not yet paid`,
      },
      {
        label: 'Largest',
        value: money(Math.max(0, ...input.expenses.map((r) => r.amountPkr))),
        hint: 'Single entry',
      },
      {
        label: 'Without proof',
        value: num(missing.length),
        hint: missing.length === 0 ? 'Every claim documented' : 'Filed before proof was required',
      },
    ],

    notes: [
      'Every figure is taken on the date the cost was incurred, not the date it was paid.',
      'Salary and subscription lines are posted automatically each month and carry no receipt — they were generated from what people are paid and what tools cost, not claimed by anybody.',
      ...(missing.length > 0
        ? [`${missing.length} hand-filed ${missing.length === 1 ? 'entry has' : 'entries have'} no proof attached. Those predate the rule that every expense carries its bill.`]
        : []),
      ...(input.filters.length > 0 ? [`Filtered: ${input.filters.join('; ')}.`] : []),
    ],
  };
}

/**
 * Revenue only, with where each invoice stands.
 *
 * ── ⚠️ THE COLLECTED TOTAL SUMS WHAT ARRIVED, NOT WHAT WAS BILLED ──────────
 * The first version added up the FULL VALUE of every row whose status said
 * received, which was correct while an invoice could only be paid in one go. It
 * is wrong now in both directions: a 120,000 invoice with 50,000 against it
 * counted as nothing at all, and one whose stored status happened to say
 * received counted in full whatever had actually landed.
 *
 * `paidPkr` is maintained by migration 074's trigger and is the same figure the
 * screen shows — which is the point. An export that disagrees with the page it
 * was taken from is worse than no export.
 */
export function buildIncomeReport(input: {
  revenue: readonly LedgerRevenue[];
  from: string;
  to: string;
  rangeLabel: string;
  filters: readonly string[];
  statusLabel: (row: LedgerRevenue) => string;
}): Report {
  const total = input.revenue.reduce((sum, row) => sum + row.amountPkr, 0);
  const inHand = input.revenue.reduce((sum, row) => sum + row.paidPkr, 0);
  const owed = input.revenue.reduce(
    (sum, row) => sum + Math.max(0, row.amountPkr - row.paidPkr),
    0,
  );
  const unsettled = input.revenue.filter((row) => row.amountPkr - row.paidPkr > 0);

  return {
    type: 'finance',
    title: 'Client revenue',
    subtitle: `What the division billed and collected · ${input.rangeLabel}`,
    period: { start: input.from, end: input.to },

    columns: [
      { key: 'earned', label: 'Earned', kind: 'date', width: 11 },
      { key: 'source', label: 'Project / client', kind: 'text', width: 24 },
      { key: 'kind', label: 'Kind', kind: 'text', width: 14 },
      { key: 'amount', label: 'Billed (PKR)', kind: 'number', width: 12 },
      { key: 'paid', label: 'Received (PKR)', kind: 'number', width: 13 },
      { key: 'owed', label: 'Outstanding (PKR)', kind: 'number', width: 14 },
      { key: 'payments', label: 'Payments', kind: 'number', width: 9 },
      { key: 'last', label: 'Last paid', kind: 'date', width: 11 },
      { key: 'status', label: 'Status', kind: 'text', width: 14 },
      { key: 'ref', label: 'Invoice', kind: 'text', width: 12 },
    ],

    rows: input.revenue.map((row) => [
      date(row.earnedOn),
      text(row.sourceName),
      text(REVENUE_KIND_LABEL[row.kind]),
      num(row.amountPkr),
      num(row.paidPkr),
      num(Math.max(0, row.amountPkr - row.paidPkr)),
      num(row.paymentCount),
      date(row.lastPaymentOn),
      text(input.statusLabel(row)),
      text(row.invoiceRef ?? '—'),
    ]),

    figures: [
      {
        label: 'Billed',
        value: money(total),
        hint: `${input.revenue.length} ${input.revenue.length === 1 ? 'invoice' : 'invoices'}`,
      },
      { label: 'Received', value: money(inHand), hint: 'Money in hand' },
      {
        label: 'Outstanding',
        value: money(owed),
        hint: `${unsettled.length} not settled in full`,
      },
      {
        label: 'Collected',
        value: pct(total > 0 ? Math.round((inHand / total) * 1000) / 10 : 0),
        hint: total > 0 ? 'Of what was billed' : 'Nothing billed in this period',
      },
    ],

    notes: [
      'Revenue is counted in the month it was EARNED, not the month the money arrived. A client who pays three weeks late does not move the revenue into the following month.',
      'Received counts what has ACTUALLY landed, including part payments — an invoice half paid contributes half, not nothing and not all of it.',
      'An invoice may be settled in several instalments. Each one carries its own proof: a bank message, a cheque or a screenshot.',
      'Written off and Refunded invoices are not expected to be collected, and any money already received against them is still counted.',
      ...(input.filters.length > 0 ? [`Filtered: ${input.filters.join('; ')}.`] : []),
    ],
  };
}

/** One month of payroll, person by person. */
export function buildPayrollReport(input: {
  lines: readonly {
    fullName: string;
    roleTitle: string | null;
    officeTeam: string;
    employmentType: string;
    monthlySalary: number;
    postedAmount: number | null;
    paidOn: string | null;
  }[];
  month: string;
  monthLabel: string;
  employmentLabel: (type: string) => string;
}): Report {
  const generated = input.lines.filter((l) => l.postedAmount !== null);
  const paid = generated.filter((l) => l.paidOn !== null);
  const total = input.lines.reduce((s, l) => s + (l.postedAmount ?? l.monthlySalary), 0);
  const owed = generated
    .filter((l) => l.paidOn === null)
    .reduce((s, l) => s + (l.postedAmount ?? 0), 0);

  /* The month's first and last day, without a table of month lengths. */
  const start = `${input.month}-01`;
  const [y, m] = input.month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  return {
    type: 'finance',
    title: 'Payroll',
    subtitle: `${input.monthLabel} · ${input.lines.length} on payroll`,
    period: { start, end },

    columns: [
      { key: 'person', label: 'Person', kind: 'text', width: 24 },
      { key: 'role', label: 'Role', kind: 'text', width: 22 },
      { key: 'type', label: 'Engaged as', kind: 'text', width: 14 },
      { key: 'office', label: 'Office', kind: 'text', width: 12 },
      { key: 'salary', label: 'Salary (PKR)', kind: 'number', width: 14 },
      { key: 'paid', label: 'Paid on', kind: 'date', width: 12 },
    ],

    rows: input.lines.map((line) => [
      text(line.fullName),
      text(line.roleTitle ?? '—'),
      text(input.employmentLabel(line.employmentType)),
      text(line.officeTeam === 'wah' ? 'Wah' : 'Blue Area'),
      num(line.postedAmount ?? line.monthlySalary),
      date(line.paidOn),
    ]),

    figures: [
      { label: 'Payroll', value: money(total), hint: `${input.lines.length} people` },
      { label: 'Paid', value: money(total - owed), hint: `${paid.length} settled` },
      { label: 'Still owed', value: money(owed), hint: `${generated.length - paid.length} unpaid` },
      {
        label: 'Generated',
        value: text(generated.length === input.lines.length ? 'Yes' : 'Not yet'),
        hint: generated.length === 0 ? 'This month has not been posted' : `${generated.length} rows`,
      },
    ],

    notes: [
      'Each figure is what was posted for this month, at the salary that applied when the month was generated. A later raise does not change it.',
      'The owner draws a profit share rather than a salary and is not counted here.',
      ...(generated.length === 0
        ? ['This month has not been generated yet, so the salaries shown are the current rates rather than a posted record.']
        : []),
    ],
  };
}

/** Every tool, its cost and who holds a seat. */
export function buildToolsReport(input: {
  tools: readonly {
    name: string;
    vendor: string | null;
    monthlyCostPkr: number | null;
    currency: string;
    billingCycle: string;
    seatsIncluded: number | null;
    monthlySpend: number;
    holders: readonly { fullName: string }[];
  }[];
  rangeLabel: string;
  from: string;
  to: string;
}): Report {
  const spend = input.tools.reduce((s, t) => s + t.monthlySpend, 0);
  const seats = input.tools.reduce((s, t) => s + t.holders.length, 0);
  const unpriced = input.tools.filter((t) => t.monthlyCostPkr === null && t.holders.length > 0);

  return {
    type: 'finance',
    title: 'Subscriptions',
    subtitle: `AI and creative tools · ${input.rangeLabel}`,
    period: { start: input.from, end: input.to },

    columns: [
      { key: 'tool', label: 'Tool', kind: 'text', width: 18 },
      { key: 'vendor', label: 'Vendor', kind: 'text', width: 16 },
      { key: 'price', label: 'Price (PKR)', kind: 'number', width: 13 },
      { key: 'cycle', label: 'Billed', kind: 'text', width: 10 },
      { key: 'seats', label: 'Seats', kind: 'number', width: 8 },
      { key: 'monthly', label: 'Per month (PKR)', kind: 'number', width: 14 },
      { key: 'holders', label: 'Held by', kind: 'text', width: 32 },
    ],

    rows: input.tools.map((tool) => [
      text(tool.name),
      text(tool.vendor ?? '—'),
      num(tool.monthlyCostPkr ?? 0),
      text(tool.billingCycle === 'yearly' ? 'Yearly' : 'Monthly'),
      num(tool.holders.length),
      num(tool.monthlySpend),
      text(tool.holders.map((h) => h.fullName).join(', ') || '—'),
    ]),

    figures: [
      { label: 'Monthly cost', value: money(spend), hint: `${input.tools.length} tools` },
      { label: 'Seats assigned', value: num(seats), hint: 'Across all tools' },
      { label: 'Yearly cost', value: money(spend * 12), hint: 'At the current seat count' },
      {
        label: 'Unpriced',
        value: num(unpriced.length),
        hint: unpriced.length === 0 ? 'Every tool priced' : 'Counted as zero',
      },
    ],

    notes: [
      'A tool billed yearly is divided by twelve to give its monthly cost. It is never counted twelve times.',
      'Where a price covers a fixed number of seats, the monthly cost is that price regardless of how many people hold it. Where it is per seat, it scales with the holders.',
      ...(unpriced.length > 0
        ? [`${unpriced.map((t) => t.name).join(', ')} ${unpriced.length === 1 ? 'has' : 'have'} people assigned but no price recorded, so ${unpriced.length === 1 ? 'it counts' : 'they count'} as nothing in the total above.`]
        : []),
    ],
  };
}

/**
 * The charts the SCREEN draws.
 *
 * ⚠️ Built from the same totals the table is built from, so the picture and the
 * rows can never disagree. Tokens are names, never colours — both themes have to
 * work, and a hex is one colour in two of them.
 */
export function financeCharts(input: FinanceReportInput): ChartSpec[] {
  const charts: ChartSpec[] = [];

  if (input.series.length > 0) {
    charts.push({
      kind: 'bars',
      title: 'Income against spending',
      question: 'Which months made money?',
      format: 'integer',
      bars: input.series.map((point) => ({
        label: point.label,
        value: Math.round(point.net),
        token: point.net >= 0 ? 'feedback-success' : 'feedback-error',
        note: point.net >= 0 ? undefined : 'loss',
      })),
    });
  }

  const slices = input.categories
    .filter((slice) => slice.amount > 0)
    .map((slice) => ({
      label: slice.label,
      value: Math.round(slice.amount),
      token: slice.token,
    }));

  if (slices.length > 0) {
    charts.push({
      kind: 'donut',
      title: 'Where the money went',
      question: 'What are we spending on?',
      slices,
      centreLabel: 'Total spend',
      centreValue: Math.round(input.totals.spend).toLocaleString('en-PK'),
    });
  }

  return charts;
}

/** What the reader narrowed to, as sentences for the sheet's filter bar. */
export function describeFinanceFilters(input: {
  category: string;
  office: string;
  direction: string;
  query: string;
}): string[] {
  const out: string[] = [];
  if (input.category !== 'all') out.push(`Category: ${input.category}`);
  if (input.office !== 'all') {
    out.push(`Office: ${input.office === 'blue_area' ? 'Blue Area' : 'Wah'}`);
  }
  if (input.direction !== 'all') out.push(`Showing: ${input.direction}`);
  if (input.query.trim() !== '') out.push(`Text contains "${input.query.trim()}"`);
  return out;
}
