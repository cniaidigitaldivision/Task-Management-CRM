'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight, ArrowUpRight, Banknote, Bell, CalendarClock, Check, Circle,
  Download, FileText, Loader2, Plus, Receipt, RefreshCw, Settings2, Sparkles,
  TrendingDown, TrendingUp, Users, Wallet,
} from 'lucide-react';

import {
  exportFinanceAction,
  payAllSalariesAction,
  runMonthAction,
  setExpensePaidAction,
  setSalaryPaidAction,
} from '@/app/actions/finance';
import { PlWaterfall } from '@/components/finance/pl-waterfall';
import { Reveal } from '@/components/finance/reveal';
import { EntryDialog } from '@/components/finance/entry-dialog';
import { ExpenseTable } from '@/components/finance/expense-table';
import { IncomeTable } from '@/components/finance/income-table';
import { InvoiceSettings } from '@/components/finance/invoice-settings';
import { InvoiceTable } from '@/components/finance/invoice-table';
import { SubscriptionBoard } from '@/components/finance/subscription-board';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Donut3D, TrendChart } from '@/components/ui/chart';
import { CountUp } from '@/components/ui/count-up';
import { Select } from '@/components/ui/select';
import { downloadCsv, downloadXlsxFromBase64, openPdfInTab } from '@/lib/download';
import { monthLabel, type SettlementState } from '@/lib/domain/finance';
import { pkr, pkrCompact, signed } from '@/lib/domain/money';
import type { ProjectOption } from '@/lib/db/queries/finance';
import type { BillingProfile, InvoiceRow } from '@/lib/db/queries/invoices';
import type { CompanyLetterhead } from '@/lib/domain/invoice';
import {
  RANGE_KEYS,
  RANGE_LABEL,
  type ExpenseFilter,
  type FinanceBoard,
  type Range,
  type RangeKey,
} from '@/lib/view/finance-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE FINANCE SURFACE
 * ----------------------------------------------------------------------------
 * ── ⚠️ THIS COMPONENT IS NEVER RENDERED FOR A COORDINATOR ──────────────────
 * Not "renders nothing" — never rendered. `app/(app)/finance/page.tsx` returns a
 * different tree before any figure is read, because a Client Component's props
 * are serialised into the RSC payload and would be readable in view-source. The
 * note there is the one to read; this file assumes the reader is an Admin.
 *
 * ── ⚠️ THE RANGE LIVES IN THE URL ───────────────────────────────────────────
 * So a period is shareable, survives a refresh and comes back from the Back
 * button — and so the server rebuilds the board rather than this component
 * re-deriving one, which is what stops the screen and the export disagreeing.
 * ========================================================================= */

/* ── ⚠️ FIVE SEPARATE THINGS, NOT ONE LEDGER ────────────────────────────────
   Owner, 2026-08-26: *"you are mixing the expenses, the packages, our business,
   or our project income [...] We have to maintain expenses separately [...] Keep
   the things separate."*

   The old Ledger tab listed expenses and income in one table, which meant
   filtering to "Salaries" also offered "Retainer" and "One-off" as categories —
   he asked why those were there, and he was right to. Money going out and money
   coming in answer different questions and are now different screens.

   OVERVIEW is the ONLY place they meet, and that is deliberate: *"if you are
   giving this analysis over here, then give me some place [...] that comparison
   you should give me in the Overview page. I don't want this in other pages."* */
type Tab = 'overview' | 'expenses' | 'income' | 'invoices' | 'payroll' | 'tools' | 'invoice_setup';

const TABS: readonly {
  key: Tab;
  label: string;
  /** `style` included — the active tab tints its glyph with the accent. */
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}[] = [
  { key: 'overview', label: 'Overview', icon: TrendingUp },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'income', label: 'Revenue', icon: Banknote },
  /* ── ⚠️ INVOICES ARE THEIR OWN TAB, BESIDE REVENUE AND NOT INSIDE IT ──────
     Owner request 2026-08-29. Revenue is a LEDGER — one row per piece of income
     in the month being looked at, which is the right shape for "what did August
     earn". Invoices are DOCUMENTS with their own lifecycle: raised, sent,
     chased, paid or voided, and none of that is bounded by a month. A client
     asking about CNI-2026-0004 is not asking a question about a date range.

     They are the same underlying rows (migration 076 — an invoice IS billed
     income, with a number and a recipient), which is exactly why the two views
     never disagree about a total. */
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'payroll', label: 'Payroll', icon: Users },
  { key: 'tools', label: 'Subscriptions', icon: Sparkles },
  /* Last, because it is set up once and then forgotten — see the panel's own
     header for why it is here rather than on the Settings page. */
  { key: 'invoice_setup', label: 'Invoice setup', icon: Settings2 },
];

export function FinanceWorkspace({
  board,
  range,
  today,
  thisMonth,
  canManage,
  people,
  projects,
  invoices,
  billing,
  company,
  signer,
  canIssue,
}: {
  board: FinanceBoard;
  range: Range;
  today: string;
  thisMonth: string;
  canManage: boolean;
  people: readonly { id: string; name: string; roleTitle: string | null }[];
  projects: readonly ProjectOption[];
  /* ── Invoicing — owner request 2026-08-29 ────────────────────────────────
     ⚠️ DELIBERATELY NOT BOUNDED BY THE PAGE'S DATE RANGE, unlike everything in
     `board`. An invoice raised in June and still unpaid has to be visible in
     September, or the one screen for chasing money hides the debts worth
     chasing. Same reasoning as the client accounts page. */
  invoices: readonly InvoiceRow[];
  billing: readonly BillingProfile[];
  company: CompanyLetterhead;
  /** Whose name and signature go on an invoice this person issues. */
  signer: { name: string; title: string | null; has: boolean };
  /** `invoice.issue` — Admin+, and deliberately a different action from
   *  `finance.manage`. See lib/domain/permissions.ts. */
  canIssue: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>('overview');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = React.useState<'expense' | 'revenue' | null>(null);

  /* ── ⚠️ THE FILTERS LIVE HERE, NOT IN THE TABLES ───────────────────────────
     Owner, 2026-08-26: *"when I click Export, the tab we have opened, the data
     I'm watching, and the filter I'm applying, that thing will only be
     exported."*

     A filter held inside the table is invisible to the Export button, so the
     export would silently send the unfiltered set — the one thing that makes a
     printed report disagree with the screen it came from. Lifting the state up
     is what lets `ExportMenu` describe exactly what is being looked at. */
  const [expenseFilter, setExpenseFilter] = React.useState<ExpenseFilter>({
    category: 'all',
    office: 'all',
    query: '',
    settled: 'all',
  });
  const [incomeStatus, setIncomeStatus] = React.useState<'all' | SettlementState>('all');

  const setRange = (key: RangeKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set('range', key);
    url.searchParams.delete('from');
    url.searchParams.delete('to');
    window.location.href = url.toString();
  };

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(label);
    setNotice(null);
    const result = await fn();
    setBusy(null);
    setNotice({
      ok: result.ok,
      text: result.ok ? (result.message ?? 'Done.') : (result.error ?? 'That did not work.'),
    });
  };

  return (
    <div className="space-y-5">
      {/* Releases every `data-reveal` bar as it is scrolled to. Without it they
          stay at zero width, which reads as "nothing was spent". */}
      <Reveal />

      {/* ── The controls ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Period"
            size="md"
            value={range.key}
            icon={CalendarClock}
            onChange={(event) => setRange(event.target.value as RangeKey)}
          >
            {RANGE_KEYS.map((key) => (
              <option key={key} value={key}>
                {RANGE_LABEL[key]}
              </option>
            ))}
            {range.key === 'custom' && <option value="custom">{range.label}</option>}
          </Select>

          <span className="text-caption text-text-tertiary">{range.label}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* ── ⚠️ "POST THIS MONTH" IS GONE FROM HERE ──────────────────────
              Owner, 2026-08-26: *"educate me on what the purpose of the above
              Month Posted button is. If I click it, it loads something and then
              says 'You already posted, nothing changed.' I don't understand
              what that exactly is."*

              A button on the Overview that silently writes salary rows into
              another tab is a button nobody can be expected to understand. It
              now lives inside Payroll, beside the list it creates, where its
              effect is visible the moment it is pressed. */}
          {canManage && (
            <>
              <Button size="md" variant="secondary" onClick={() => setDialog('revenue')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Invoice
              </Button>

              <Button size="md" variant="primary" onClick={() => setDialog('expense')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Expense
              </Button>
            </>
          )}

          {/* Exports exactly what this tab is showing — see `ExportMenu`.

              ⚠️ HIDDEN ON THE TWO INVOICE TABS. `exportFinanceAction` builds a
              report for five named scopes and knows nothing about invoices, so
              offering the button there would produce the Overview export under
              a label promising invoices — silently exporting something other
              than what is on screen, which is the exact failure the owner
              raised when this menu was built. Nothing is exported rather than
              the wrong thing. */}
          {tab !== 'invoices' && tab !== 'invoice_setup' && (
          <ExportMenu
            range={range}
            tab={tab}
            expenseFilter={expenseFilter}
            incomeStatus={incomeStatus}
            thisMonth={thisMonth}
          />
          )}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="text-caption font-medium"
          style={{ color: notice.ok ? 'var(--feedback-success)' : 'var(--feedback-error)' }}
        >
          {notice.text}
        </p>
      )}

      {/* ── The four figures ──────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyTile
          label="Income"
          amount={board.hero.income}
          token="status-done"
          icon={ArrowUpRight}
          changePct={board.hero.incomeChangePct}
          changeIsGood
          hint={`${board.revenue.length} entries`}
        />
        <MoneyTile
          label="Spending"
          amount={board.hero.spend}
          token="status-blocked"
          icon={ArrowDownRight}
          changePct={board.hero.spendChangePct}
          changeIsGood={false}
          hint={`${board.expenses.length} entries`}
        />
        <MoneyTile
          label={board.hero.net >= 0 ? 'Profit' : 'Loss'}
          amount={Math.abs(board.hero.net)}
          token={board.hero.net >= 0 ? 'status-done' : 'status-blocked'}
          icon={board.hero.net >= 0 ? TrendingUp : TrendingDown}
          hint={
            board.hero.marginPct === null
              ? 'No income in this period'
              : `${board.hero.marginPct}% margin`
          }
        />
        <MoneyTile
          label="Outstanding"
          amount={board.outstanding.unreceivedIncome}
          token="load-warning"
          icon={Wallet}
          hint={
            board.outstanding.unreceivedIncomeCount === 0
              ? 'Everything invoiced is in'
              : `${board.outstanding.unreceivedIncomeCount} invoices unpaid`
          }
        />
      </div>

      {/* ── ⚠️ THE SELECTED TAB HAS TO LOOK SELECTED ──────────────────────────
          Owner, 2026-08-26: *"I don't understand which tab is open [...] Just
          changing the text is not enough. Make it more prominent, make some
          shadow, make some underline, or do something like that."*

          The old version changed only the text colour and a 2px rule, which at
          `--text-tertiary` against `--text-primary` is a difference of about
          one shade. This gives the active tab its own raised surface, a border,
          a shadow and a full-weight accent bar — four signals rather than one,
          so it reads as selected at a glance and without relying on colour
          alone. */}
      <div
        role="tablist"
        aria-label="Finance sections"
        className="flex flex-wrap gap-1.5 rounded-[var(--radius-lg)] border border-border-subtle bg-bg-surface-sunken p-1.5"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={cn(
                'relative inline-flex items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-2 text-caption transition-all duration-[var(--duration-fast)]',
                active
                  ? 'bg-bg-surface font-semibold text-text-primary shadow-[var(--shadow-sm)]'
                  : 'font-medium text-text-tertiary hover:bg-bg-surface/60 hover:text-text-secondary',
              )}
              style={
                active
                  ? {
                      borderTop: '1px solid var(--border-subtle)',
                      borderLeft: '1px solid var(--border-subtle)',
                      borderRight: '1px solid var(--border-subtle)',
                      borderBottom: '2px solid var(--accent-primary)',
                    }
                  : { border: '1px solid transparent' }
              }
            >
              <Icon
                className="h-4 w-4"
                aria-hidden="true"
                style={active ? { color: 'var(--accent-primary)' } : undefined}
              />
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <Overview board={board} />}

      {tab === 'expenses' && (
        <ExpenseTable
          board={board}
          canManage={canManage}
          filter={expenseFilter}
          onFilter={setExpenseFilter}
          onSettle={(id, paid) => void run('settle', () => setExpensePaidAction(id, paid))}
          onDeleted={(message) => setNotice({ ok: true, text: message })}
        />
      )}

      {tab === 'income' && (
        <IncomeTable
          board={board}
          canManage={canManage}
          filter={incomeStatus}
          onFilter={setIncomeStatus}
          today={today}
          /* ⚠️ A server refresh, not local state. Recording a payment moves the
             hero figures, the waterfall and the row itself — recomputing three
             of them in the browser is three chances to disagree with the
             database that just recalculated them in a trigger. */
          onChanged={() => router.refresh()}
        />
      )}

      {/* ---- INVOICES ------------------------------------------------------
          Everything about the document: raise it, read the PDF, send it, void
          it. The money against it is still recorded on the Revenue tab, which
          is the same rows seen as a ledger. */}
      {tab === 'invoices' && (
        <InvoiceTable
          invoices={invoices}
          projects={billing}
          today={today}
          canIssue={canIssue}
          signerName={signer.name}
          signerTitle={signer.title}
          hasSavedSignature={signer.has}
          defaultTaxRatePct={company.defaultTaxRatePct}
          taxLabel={company.taxLabel}
          thisMonth={thisMonth}
          /* ⚠️ Reuses this screen's own notice strip rather than growing a
             second one. Two places reporting outcomes is two places to keep
             consistent, and the one nobody is looking at goes stale. */
          onDone={(result) =>
            setNotice({ ok: result.ok, text: result.error ?? result.warning ?? result.message ?? '' })
          }
        />
      )}

      {tab === 'invoice_setup' && (
        <InvoiceSettings company={company} projects={billing} signature={signer} />
      )}

      {tab === 'payroll' && (
        <PayrollPanel
          board={board}
          canManage={canManage}
          thisMonth={thisMonth}
          busy={busy}
          onRun={(month) => void run('post', () => runMonthAction(month))}
          onPayAll={(month) => void run('payall', () => payAllSalariesAction(month))}
          onSettle={(expenseId, paid) =>
            void run('settle', () => setSalaryPaidAction(expenseId, paid))
          }
        />
      )}

      {tab === 'tools' && (
        <SubscriptionBoard board={board} people={people} canManage={canManage} />
      )}

      {dialog && (
        <EntryDialog
          kind={dialog}
          open
          onClose={() => setDialog(null)}
          categories={board.categoryOptions}
          projects={projects}
          tools={board.tools.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))}
          people={people}
          today={today}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The overview
 * ------------------------------------------------------------------------- */

function Overview({ board }: { board: FinanceBoard }) {
  const slices = board.categories
    .filter((slice) => slice.amount > 0)
    .map((slice) => ({ label: slice.label, value: Math.round(slice.amount), token: slice.token }));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ── Where the money went ─────────────────────────────────────────── */}
        <Card lit>
          <CardHeader>
            <div>
              <CardTitle>Where the money went</CardTitle>
              <CardDescription>
                Income at the top, each cost stepping down from it, and what is left.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <PlWaterfall steps={board.waterfall} />

            {board.hero.shortfall !== null && (
              /* ⚠️ Only shown on a loss. `breakEven` returns null when the period
                 was profitable, because "you need 0 more" describes a problem
                 that does not exist and invites the reader to look for one. */
              <p className="mt-4 rounded-[var(--radius-sm)] border border-border-subtle bg-bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
                <strong className="font-semibold text-text-primary">
                  {pkr(board.hero.shortfall)}
                </strong>{' '}
                more income would have broken even over this period.
              </p>
            )}
          </CardBody>
        </Card>

        {/* ── The split ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Spending by category</CardTitle>
              <CardDescription>{pkr(board.totals.spend)} across {board.categories.length} categories</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {slices.length === 0 ? (
              <p className="py-10 text-center text-caption text-text-tertiary">
                Nothing recorded in this period.
              </p>
            ) : (
              /* ⚠️ NO SEPARATE LEGEND. `Donut3D` renders its own, with the
                 label, the figure and the share — a second list underneath was
                 the same data twice, which made the card twice as tall and gave
                 the reader two places to look for one number. */
              <Donut3D
                slices={slices}
                centreLabel="Total spend"
                centreValue={pkrCompact(board.totals.spend).replace('PKR ', '')}
                size={190}
                format="money"
                caption="Spending by category"
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── The trend ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Month by month</CardTitle>
            <CardDescription>
              Income against spending. Every month in the period is drawn, including
              the empty ones.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {board.series.length <= 1 ? (
            /* ⚠️ A single month is not a trend. Drawing one point as a line
               chart produces a flat line that reads as "nothing changed", which
               is a claim about a period this data cannot make. */
            <p className="py-8 text-center text-caption text-text-tertiary">
              Choose a longer period to see a trend — this range covers one month.
            </p>
          ) : (
            <TrendChart
              labels={board.series.map((point) => point.label)}
              series={[
                {
                  label: 'Income',
                  token: 'status-done',
                  points: board.series.map((point) => Math.round(point.income)),
                },
                {
                  label: 'Spending',
                  token: 'status-blocked',
                  points: board.series.map((point) => Math.round(point.spend)),
                },
              ]}
              height={240}
              format="money"
              fill={false}
              /* ── ⚠️ `animate` IS DELIBERATELY OFF ──────────────────────────
                 That prop adds `.line-draw`, which sets `stroke-dasharray` and
                 leaves it set after the draw finishes. This chart's viewBox is
                 anisotropic, and chart.tsx's own cursor-layer comment records
                 what that does to dashes: they come out uneven. Measured here —
                 the Spending line rendered as a row of disconnected segments
                 with regular gaps, still there six seconds after load, on a line
                 whose whole job is to be followed across six months.

                 The prop's own doc says it is opt-in for callers that "have been
                 looked at". This one was, and it fails. The page's motion comes
                 from the waterfall instead. */
              caption="Income against spending, by month"
            />
          )}
        </CardBody>
      </Card>

      {/* ── Offices and unpaid bills ──────────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>By office</CardTitle>
              <CardDescription>
                Rent and bills only — costs that belong to a place.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {board.offices.length === 0 ? (
              <p className="py-6 text-center text-caption text-text-tertiary">
                Nothing in this period was recorded against an office.
              </p>
            ) : (
              <ul className="space-y-3" data-reveal="out">
                {board.offices.map((office) => (
                  <li key={office.office}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-caption font-medium text-text-primary">
                        {office.label}
                      </span>
                      <span className="tabular text-caption text-text-secondary">
                        {pkr(office.amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-surface-sunken">
                      <span
                        className="reveal-bar block h-full rounded-full"
                        style={{
                          width: `${office.sharePct}%`,
                          backgroundColor: 'var(--accent-primary)',
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* Says what the panel excludes, because a total that leaves
                something out has to name it. */}
            <p className="mt-4 text-micro text-text-tertiary">
              Salaries follow the person&rsquo;s office. Subscriptions and other
              division-wide costs belong to neither and are not counted here.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Not yet settled</CardTitle>
              <CardDescription>Counted in the totals above — the cost is real either way.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {/* ⚠️ `--money-*` rather than the chart tokens these started with.
                `--load-warning` measured 2.80:1 against white here — the worst
                contrast on the page, on a figure somebody came to read. */}
            <SettleRow
              label="Bills we have not paid"
              amount={board.outstanding.unpaidSpend}
              count={board.outstanding.unpaidSpendCount}
              token="money-due"
            />
            <SettleRow
              label="Invoices not yet received"
              amount={board.outstanding.unreceivedIncome}
              count={board.outstanding.unreceivedIncomeCount}
              token="money-wait"
            />
            <div className="border-t border-border-subtle pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-caption text-text-secondary">Net position</span>
                <span
                  className="tabular text-body font-bold"
                  style={{
                    color:
                      board.outstanding.unreceivedIncome - board.outstanding.unpaidSpend >= 0
                        ? 'var(--money-in)'
                        : 'var(--money-out)',
                  }}
                >
                  {signed(
                    board.outstanding.unreceivedIncome - board.outstanding.unpaidSpend,
                  )}
                </span>
              </div>
              <p className="mt-1 text-micro text-text-tertiary">
                What is owed to the division, less what it owes.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SettleRow({
  label,
  amount,
  count,
  token,
}: {
  label: string;
  amount: number;
  count: number;
  token: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-caption text-text-secondary">{label}</p>
        <p className="text-micro text-text-tertiary">
          {count === 0 ? 'Nothing outstanding' : `${count} entr${count === 1 ? 'y' : 'ies'}`}
        </p>
      </div>
      <span className="tabular shrink-0 text-body font-semibold" style={{ color: `var(--${token})` }}>
        {pkr(amount)}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Payroll
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Payroll — one month, person by person
 * ------------------------------------------------------------------------- */

function PayrollPanel({
  board,
  canManage,
  thisMonth,
  busy,
  onRun,
  onPayAll,
  onSettle,
}: {
  board: FinanceBoard;
  canManage: boolean;
  thisMonth: string;
  busy: string | null;
  onRun: (month: string) => void;
  onPayAll: (month: string) => void;
  onSettle: (expenseId: string, paid: boolean) => void;
}) {
  /* ⚠️ Its OWN month, independent of the page's date range. Owner: *"payroll
     should be properly maintained month by month."* A payroll is a monthly
     event; asking "what did we pay in June" through a six-month range filter is
     the wrong question shape entirely. */
  const [month, setMonth] = React.useState(thisMonth);
  const lines = board.payrollFor[month] ?? [];

  const generated = lines.filter((l) => l.expenseId !== null);
  const paid = generated.filter((l) => l.paidOn !== null);
  const owed = generated
    .filter((l) => l.paidOn === null)
    .reduce((sum, l) => sum + (l.postedAmount ?? l.monthlySalary), 0);

  const notGenerated = generated.length === 0;

  return (
    <div className="space-y-5">
      {/* ── Pay reviews that are due ─────────────────────────────────────────
          Owner: *"give me a notification: when a new employee is added or 3
          months are completed, you have to enter a new salary for this
          employee."* Overdue ones are kept rather than expired — the one nobody
          actioned is the one that matters. */}
      {board.reviewsDue.length > 0 && (
        <Card accentToken="load-warning">
          <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Bell className="h-4 w-4 shrink-0" style={{ color: 'var(--load-warning)' }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-semibold text-text-primary">
                {board.reviewsDue.length === 1 ? 'A pay review is due' : `${board.reviewsDue.length} pay reviews are due`}
              </p>
              <p className="text-micro text-text-tertiary">
                {board.reviewsDue
                  .map((r) =>
                    `${r.fullName} — ${EMPLOYMENT_LABEL[r.employmentType] ?? r.employmentType} ${
                      r.daysAway < 0
                        ? `ended ${Math.abs(r.daysAway)} days ago`
                        : r.daysAway === 0
                          ? 'ends today'
                          : `ends in ${r.daysAway} days`
                    }`,
                  )
                  .join(' · ')}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Payroll</CardTitle>
            <CardDescription>
              {monthLabel(month)} · {lines.length} on payroll ·{' '}
              {pkr(lines.reduce((s, l) => s + (l.postedAmount ?? l.monthlySalary), 0))}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Month"
              size="sm"
              value={month}
              icon={CalendarClock}
              onChange={(event) => setMonth(event.target.value)}
            >
              {board.payrollMonths.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
            </Select>

            {canManage && notGenerated && (
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => onRun(month)}>
                {busy === 'post' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Generate {monthLabel(month)}
              </Button>
            )}

            {canManage && !notGenerated && owed > 0 && (
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => onPayAll(month)}>
                {busy === 'payall' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Pay all ({pkrCompact(owed)})
              </Button>
            )}
          </div>
        </CardHeader>

        <CardBody className="px-0 py-0">
          {/* ⚠️ "Not generated" is a different answer from "not paid", and the
              button to press differs. Saying so plainly is the whole reason
              `payrollMonth` LEFT JOINs from people to rows. */}
          {notGenerated && (
            <p className="border-b border-border-subtle bg-bg-surface-sunken px-5 py-3 text-caption text-text-secondary">
              {monthLabel(month)} has not been generated yet. Generating it writes one
              expense per person at the salary on file <strong>today</strong> — after that,
              a raise never rewrites this month.
            </p>
          )}

          {lines.length === 0 ? (
            <p className="px-5 py-12 text-center text-caption text-text-tertiary">
              Nobody has a salary on file. Set one from a person&rsquo;s profile.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {lines.map((line) => (
                <li key={line.userId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={line.fullName} src={line.avatarUrl} size="sm" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption font-medium text-text-primary">
                      {line.fullName}
                    </p>
                    <p className="truncate text-micro text-text-tertiary">
                      {line.roleTitle ?? '—'} · {line.officeTeam === 'wah' ? 'Wah' : 'Blue Area'}
                    </p>
                  </div>

                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-micro font-medium"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--${EMPLOYMENT_TOKEN[line.employmentType] ?? 'status-done'}) 15%, transparent)`,
                      color: `var(--${EMPLOYMENT_TOKEN[line.employmentType] ?? 'status-done'})`,
                    }}
                  >
                    {EMPLOYMENT_LABEL[line.employmentType] ?? line.employmentType}
                  </span>

                  <span className="tabular w-28 shrink-0 text-right text-caption font-semibold text-text-primary">
                    {pkr(line.postedAmount ?? line.monthlySalary, line.currency)}
                  </span>

                  <span className="w-24 shrink-0 text-right">
                    {line.expenseId === null ? (
                      <span className="text-micro text-text-tertiary">not generated</span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => onSettle(line.expenseId!, line.paidOn === null)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium transition-colors',
                          canManage && 'hover:bg-bg-surface-sunken',
                        )}
                        style={{
                          color: line.paidOn ? 'var(--money-in)' : 'var(--text-tertiary)',
                        }}
                        title={line.paidOn ? `Paid ${line.paidOn}` : 'Not paid yet'}
                      >
                        {line.paidOn ? (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Circle className="h-3 w-3" aria-hidden="true" />
                        )}
                        {line.paidOn ? 'Paid' : 'Unpaid'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {generated.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-default bg-bg-surface-sunken px-5 py-3">
              <span className="text-caption text-text-secondary">
                {paid.length} of {generated.length} paid
              </span>
              <span className="tabular text-caption font-bold" style={{ color: owed > 0 ? 'var(--money-due)' : 'var(--money-in)' }}>
                {owed > 0 ? `${pkr(owed)} still owed` : 'Fully settled'}
              </span>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const EMPLOYMENT_LABEL: Readonly<Record<string, string>> = {
  full_time: 'Full time',
  probation: 'Probation',
  intern: 'Intern',
  contract: 'Contract',
  owner: 'Owner',
};

const EMPLOYMENT_TOKEN: Readonly<Record<string, string>> = {
  full_time: 'status-done',
  probation: 'load-warning',
  intern: 'status-todo',
  contract: 'status-review',
  owner: 'accent-gold',
};

/* ---------------------------------------------------------------------------
 * A figure tile
 * ------------------------------------------------------------------------- */

function MoneyTile({
  label,
  amount,
  token,
  icon: Icon,
  hint,
  changePct,
  changeIsGood,
}: {
  label: string;
  amount: number;
  token: string;
  /** `style` included — the tile tints the glyph with the metric's own token. */
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
  hint: string;
  changePct?: number | null;
  changeIsGood?: boolean;
}) {
  /* ⚠️ `changePct` is null when the base was too small or the ratio absurd —
     see `changePct` in lib/domain/finance.ts. Null renders NOTHING rather than
     "0%", which would claim the figure held steady when in fact it could not be
     stated. The dashboard printed "+1640%" before that guard existed. */
  const up = (changePct ?? 0) > 0;
  const good = changeIsGood ? up : !up;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, var(--${token}) 20%, transparent) 0%, transparent 62%)`,
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption text-text-secondary">{label}</p>
          <Icon className="h-4 w-4" strokeWidth={2} style={{ color: `var(--${token})` }} aria-hidden="true" />
        </div>

        <p className="tabular mt-2 text-h1 leading-none font-bold text-text-primary">
          <span className="text-body font-medium text-text-tertiary">PKR </span>
          {/* ⚠️ `money`, not `integer` — the latter prints `4446000`. */}
          <CountUp value={Math.round(amount)} format="money" />
        </p>

        <div className="mt-2 flex items-center gap-2">
          {changePct !== null && changePct !== undefined && (
            <span
              className="tabular inline-flex items-center gap-0.5 text-micro font-semibold"
              style={{ color: good ? 'var(--money-in)' : 'var(--money-out)' }}
            >
              {up ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              )}
              {Math.abs(changePct)}%
            </span>
          )}
          <span className="truncate text-micro text-text-tertiary">{hint}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ Exports the OPEN TAB, with its filters.
 *
 * Owner, 2026-08-26: *"when I click Export, the tab we have opened, the data
 * I'm watching, and the filter I'm applying, that thing will only be
 * exported."* The scope and the filters travel to the action, which rebuilds
 * that screen's report server-side — it never trusts rows from the browser.
 */
function ExportMenu({
  range,
  tab,
  expenseFilter,
  incomeStatus,
  thisMonth,
}: {
  range: Range;
  /** ⚠️ Narrower than `Tab` on purpose: these are the five scopes
   *  `exportFinanceAction` can actually build. The caller does not render this
   *  menu on the others, and this type is what makes forgetting that a compile
   *  error rather than a wrong export. */
  tab: Exclude<Tab, 'invoices' | 'invoice_setup'>;
  expenseFilter: ExpenseFilter;
  incomeStatus: 'all' | SettlementState;
  thisMonth: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDetailsElement>(null);

  /* Close on an outside click or Escape — a menu that only closes by
     re-clicking its own button is a menu people leave open. */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(format);
    setError(null);

    const result = await exportFinanceAction({
      from: range.from,
      to: range.to,
      rangeLabel: range.label,
      /* The expense filters travel whatever the tab, because Overview totals
         are built from the same rows; the action ignores them where they do
         not apply. */
      category: expenseFilter.category,
      office: expenseFilter.office,
      query: expenseFilter.query,
      settled: expenseFilter.settled,
      scope: tab,
      month: thisMonth,
      status: incomeStatus,
      format,
    });

    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setOpen(false);

    if (format === 'csv') {
      downloadCsv(result.fileName, result.content);
      return;
    }
    if (format === 'xlsx') {
      downloadXlsxFromBase64(result.fileName, result.content);
      return;
    }

    /* ⚠️ The PDF opens in a tab rather than downloading — the owner's
       instruction, and the same as every other export here. `openPdfInTab`
       returns false when the popup blocker refuses it, which is worth saying out
       loud rather than looking like nothing happened. */
    if (!openPdfInTab(result.fileName, result.content)) {
      setError('Allow pop-ups for this site to open the PDF.');
    }
  };

  return (
    <span className="relative inline-flex flex-col items-end gap-1">
      <details ref={ref} open={open}>
        <summary
          className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-md)] border border-border-default bg-bg-surface px-3 text-caption font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-bg-surface-raised"
          onClick={(event) => {
            event.preventDefault();
            setOpen((was) => !was);
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          Export
        </summary>

        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-bg-surface shadow-[var(--shadow-lg)]">
          {(['pdf', 'xlsx', 'csv'] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(format)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-caption text-text-secondary transition-colors hover:bg-bg-surface-raised hover:text-text-primary disabled:opacity-50"
            >
              <span>
                {format === 'pdf' ? 'PDF report' : format === 'xlsx' ? 'Spreadsheet' : 'CSV'}
              </span>
              {busy === format && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            </button>
          ))}
          {/* Names what is about to leave, so nobody has to guess whether the
              open tab or the whole ledger is coming out. */}
          <p className="border-t border-border-subtle px-3 py-2 text-micro text-text-tertiary">
            {TABS.find((t) => t.key === tab)?.label ?? 'This view'} · {range.label}
          </p>
        </div>
      </details>

      {error && (
        <span className="absolute top-full right-0 mt-1 w-56 text-right text-micro" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
