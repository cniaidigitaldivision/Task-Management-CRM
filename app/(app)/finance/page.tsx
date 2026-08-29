import type { Metadata } from 'next';

import { ExpenseDropBox } from '@/components/finance/expense-drop-box';
import { FinanceWorkspace } from '@/components/finance/finance-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listSalaried, reviewsDue } from '@/lib/db/queries/compensation';
import {
  listExpenseCategories,
  listExpenses,
  listProjectsForPicker,
  listRevenue,
  payrollMonth,
  postedMonths,
} from '@/lib/db/queries/finance';
import {
  companyLetterhead,
  listBillingProfiles,
  listInvoices,
  signerProfile,
} from '@/lib/db/queries/invoices';
import { listTools, toolBoard } from '@/lib/db/queries/subscriptions';
import { listPeople } from '@/lib/db/queries/people';
import { can } from '@/lib/domain/permissions';
import { monthOf } from '@/lib/domain/finance';
import {
  RANGE_KEYS,
  buildFinanceBoard,
  customRange,
  priorPeriod,
  resolveRange,
  type RangeKey,
} from '@/lib/view/finance-board';

export const metadata: Metadata = { title: 'Finance' };

/* ============================================================================
 * FINANCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: manage every expense and the income from project packages,
 * show profit and loss graphically, and — the part that shapes this file —
 * *"the team coordinator can also add expenses. The list of expenses, their
 * report, or their analysis should only be visible to the admin and the super
 * admin."*
 *
 * ── ⚠️ THE BRANCH BELOW IS THE SECURITY BOUNDARY. IT IS HERE FOR A REASON ──
 * `FinanceWorkspace` is a Client Component, so EVERY PROP IT RECEIVES IS
 * SERIALISED INTO THE RSC PAYLOAD and is readable with view-source by whoever
 * loaded the page. Rendering the workspace and hiding its figures with CSS, or
 * with a `canView` prop, would leave the entire division's payroll sitting in
 * the HTML for the one person the owner named as not being allowed to see it.
 *
 * That is not hypothetical. `lib/view/project-finance.ts` exists because exactly
 * this happened with a single monthly fee: it was gated at every render site and
 * still found in the response body on /projects.
 *
 * So a Coordinator is never handed a board. The queries are not even issued for
 * them — `buildFinanceBoard` is inside the `canView` branch — and what crosses
 * the boundary is a form and a list of category names. Even if that branch were
 * removed tomorrow, RLS returns them empty arrays; but the branch is what keeps
 * the payload honest, and the payload is the thing that leaks.
 *
 * ── ⚠️ TWO CLOCK READINGS WOULD BE ONE TOO MANY ────────────────────────────
 * `today` is read once and every range derives from it, so the page cannot
 * straddle midnight and disagree with itself about which month it is.
 * ========================================================================= */

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const canView = can(actor, 'finance.view');
  const canManage = can(actor, 'finance.manage');
  const canFile = can(actor, 'finance.record_expense');

  const params = await searchParams;

  /* Karachi, not the server's timezone — every other date in this product is
     Karachi and a ledger that disagreed by a day would file month-end rows into
     the wrong month. */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

  const range =
    params.range === 'custom'
      ? customRange(params.from ?? today, params.to ?? today, today)
      : resolveRange(
          RANGE_KEYS.includes(params.range as RangeKey) ? (params.range as RangeKey) : 'this_month',
          today,
        );

  /* ── The Coordinator's screen ───────────────────────────────────────────────
     A form, and nothing else. Owner: the list, the report and the analysis are
     not theirs. This returns BEFORE any figure is read, so none can be
     serialised. See the header. */
  if (!canView) {
    /* ⚠️ The tool list and the people list ARE sent to a Coordinator, and that
       is safe: `subscriptions` holds no price (migration 063 keeps costs in a
       table their role cannot read), and the team directory is open to
       everybody already. Neither is a figure. */
    const [categories, tools, team] = await Promise.all([
      listExpenseCategories(user.id),
      listTools(user.id),
      listPeople(user.id),
    ]);

    return (
      <div className="mx-auto max-w-[var(--content-max)] space-y-6">
        <PageHeader
          eyebrow="AI & Digital Division"
          title="File an expense"
          description="Record what the division has spent — a bill, a purchase, a subscription. Every entry needs its receipt. Finance picks it up from here."
        />
        <ExpenseDropBox
          categories={categories}
          canFile={canFile}
          tools={tools.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))}
          people={team.map((p) => ({ id: p.id, name: p.fullName, roleTitle: p.roleTitle }))}
        />
      </div>
    );
  }

  /* ── The Admin's screen ─────────────────────────────────────────────────── */
  const prior = priorPeriod(range.from, range.to);

  /* ── ⚠️ THE PAYROLL SCREEN PICKS ITS OWN MONTH ────────────────────────────
     Independently of the range filter above — a payroll is a monthly event, and
     asking "what did we pay in June" through a six-month range is the wrong
     question shape. Twelve months are loaded so the picker can move without a
     round trip; each is one small query against an indexed column. */
  const thisMonth = monthOf(today);
  const months = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = thisMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });

  const [
    expenses,
    revenue,
    priorExpenses,
    priorRevenue,
    payroll,
    tools,
    categories,
    posted,
    projects,
    team,
    reviews,
    payrollByMonth,
    invoices,
    billing,
    company,
    signer,
  ] = await Promise.all([
    listExpenses(user.id, range.from, range.to),
    listRevenue(user.id, range.from, range.to),
    listExpenses(user.id, prior.from, prior.to),
    listRevenue(user.id, prior.from, prior.to),
    /* ⚠️ `listSalaried`, not `listPayroll` — the owner draws a profit share and
       must never be added into a salary bill. Migration 067. */
    listSalaried(user.id),
    toolBoard(user.id),
    listExpenseCategories(user.id),
    postedMonths(user.id),
    listProjectsForPicker(user.id),
    listPeople(user.id),
    reviewsDue(user.id),
    Promise.all(months.map((m) => payrollMonth(user.id, m))),
    /* ── ⚠️ EVERY INVOICE, NOT JUST THE RANGE'S ─────────────────────────────
       Deliberately outside `range`. An invoice raised in June and still unpaid
       has to be visible in September — the tab exists to chase money, and
       filtering it to the month on the toolbar would hide exactly the debts
       worth chasing. Same call the client accounts page makes.

       ⚠️ AND ALL FOUR ARE INSIDE THE `canView` BRANCH, like everything above.
       They are figures, and this file's header explains at length why a
       Coordinator is never handed a board: every prop crosses into the RSC
       payload and is readable with view-source. */
    listInvoices(user.id),
    listBillingProfiles(user.id),
    companyLetterhead(user.id),
    signerProfile(user.id),
  ]);

  const board = buildFinanceBoard({
    expenses,
    revenue,
    priorExpenses,
    priorRevenue,
    payroll,
    tools,
    categoryOptions: categories,
    postedMonths: posted,
    payrollFor: Object.fromEntries(months.map((m, i) => [m, payrollByMonth[i]])),
    payrollMonths: months,
    reviewsDue: reviews,
    from: range.from,
    to: range.to,
    rangeLabel: range.label,
  });

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Finance"
        description="What the division earns, what it spends, and what is left. Every figure is taken on the month a cost was incurred or income was earned — not the day money moved."
      />

      <FinanceWorkspace
        board={board}
        range={range}
        today={today}
        thisMonth={thisMonth}
        canManage={canManage}
        invoices={invoices}
        billing={billing}
        company={company}
        /* ⚠️ Only whether a signature EXISTS, never the path to it. A storage
           key is useless to a browser and handing one out invites somebody to
           build a URL from it — the same rule receipts and library documents
           follow. */
        signer={{ name: signer.fullName, title: signer.roleTitle, has: signer.signaturePath !== null }}
        /* ⚠️ `invoice.issue`, NOT `canManage`. They resolve to the same people
           today and are separate actions on purpose — the owner said this list
           will change, and widening who may bill a client must not widen who
           may read the payroll. */
        canIssue={can(actor, 'invoice.issue')}
        people={team.map((person) => ({
          id: person.id,
          name: person.fullName,
          roleTitle: person.roleTitle,
        }))}
        projects={projects}
      />
    </div>
  );
}
