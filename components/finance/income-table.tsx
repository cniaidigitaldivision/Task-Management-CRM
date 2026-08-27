'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Plus, Upload, Wallet } from 'lucide-react';

import { setRevenueStatusAction } from '@/app/actions/finance';
import { PaymentDialog } from '@/components/finance/payment-dialog';
import { ProofViewer, type ProofTarget } from '@/components/finance/proof-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import {
  REVENUE_STATUS_META,
  SETTABLE_REVENUE_STATUSES,
  outstandingOf,
  settlementOf,
  type LedgerRevenue,
  type RevenueStatus,
  type SettlementState,
} from '@/lib/domain/finance';
import { pkr } from '@/lib/domain/money';
import type { FinanceBoard } from '@/lib/view/finance-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CLIENT REVENUE — WHAT WAS BILLED, AND WHAT HAS ACTUALLY ARRIVED
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26:
 *
 *   "It's not compulsory that on the 1st of each month we are getting the
 *    money. It could be any day. It could be maybe after months [...] but we
 *    will want to keep track of whether we get money from that project."
 *
 * Owner, 2026-08-27:
 *
 *   "For income you can use a proper word because 'project income' is not an
 *    appropriate word here."
 *
 *   "It's not possible that in some project they are giving money in one go.
 *    Maybe they are giving two monies in pieces, two times or three times, in
 *    one month."
 *
 * ── ⚠️ WHY "REVENUE" AND NOT "PROJECT INCOME" ──────────────────────────────
 * Because the rows are not income; they are INVOICES, and an invoice is a claim
 * on a client rather than money in the bank. Calling the tab "income" is what
 * made the old screen read as though 300,000 had arrived when 120,000 had. The
 * two figures now sit side by side and the tab is named after what it holds.
 *
 * ── ⚠️ THE MONTH IT WAS EARNED IS NOT THE DAY IT ARRIVED ───────────────────
 * Both are shown, in separate columns, because they are genuinely different
 * facts and the whole ledger is built on the first. A retainer earned in June
 * and paid in September is June's REVENUE and September's CASH — collapsing
 * them would make one of those two questions unanswerable.
 *
 * ── ⚠️ THE STATUS PICKER NO LONGER OFFERS "RECEIVED" ───────────────────────
 * Paid and part-paid are consequences of money arriving, so they are reached by
 * recording a payment — never by choosing them from a menu. A status control
 * that can mark an invoice settled with no receipt behind it is exactly the
 * accuracy hole the owner closed on expenses. See `SETTABLE_REVENUE_STATUSES`.
 * ========================================================================= */

const KIND_LABEL: Readonly<Record<LedgerRevenue['kind'], string>> = {
  retainer: 'Package retainer',
  one_off: 'One-off project',
  add_on: 'Add-on',
};

export function IncomeTable({
  board,
  canManage,
  filter,
  onFilter,
  today,
  onChanged,
}: {
  board: FinanceBoard;
  canManage: boolean;
  filter: 'all' | SettlementState;
  onFilter: (next: 'all' | SettlementState) => void;
  today: string;
  /** Ask the page to refetch after money is recorded. */
  onChanged?: () => void;
}) {
  const [page, setPage] = React.useState(1);
  const [changing, setChanging] = React.useState<LedgerRevenue | null>(null);
  const [paying, setPaying] = React.useState<LedgerRevenue | null>(null);
  const [proof, setProof] = React.useState<ProofTarget | null>(null);

  /* ⚠️ Filtered on the DERIVED state, not on the stored `status`. A part-paid
     invoice is stored as `invoiced`, so filtering on the column would put it
     under "awaiting payment" — where somebody looking for what is half-settled
     would never find it. */
  const rows = board.revenue.filter(
    (row) => filter === 'all' || settlementOf(row) === filter,
  );

  const PER_PAGE = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PER_PAGE;
  const visible = rows.slice(start, start + PER_PAGE);

  const billed = rows.reduce((sum, row) => sum + row.amountPkr, 0);
  /* ⚠️ The COLLECTED total sums what actually arrived, including part payments
     — not the full value of rows whose status happens to say received. The old
     version did the latter, so a 120,000 invoice with 50,000 against it counted
     as nothing at all. */
  const collected = rows.reduce((sum, row) => sum + row.paidPkr, 0);
  const owed = rows.reduce((sum, row) => sum + outstandingOf(row), 0);

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <CardTitle>Client revenue</CardTitle>
            <CardDescription>
              {rows.length} {rows.length === 1 ? 'invoice' : 'invoices'} · {pkr(billed)} billed ·{' '}
              <span style={{ color: 'var(--money-in)' }}>{pkr(collected)} received</span>
              {owed > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--money-due)' }}>{pkr(owed)} outstanding</span>
                </>
              )}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/finance/clients"
              className="inline-flex shrink-0 items-center gap-1.5 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
            >
              By client
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>

            <Select
              label="Status"
              size="sm"
              value={filter}
              onChange={(event) => {
                onFilter(event.target.value as 'all' | SettlementState);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {(Object.keys(REVENUE_STATUS_META) as SettlementState[]).map((key) => (
                <option key={key} value={key}>
                  {REVENUE_STATUS_META[key].label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>

        <CardBody className="px-0 py-0">
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-caption text-text-tertiary">
              No revenue recorded in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-caption">
                <thead>
                  <tr className="border-b border-border-default text-left">
                    <Th className="w-24">Earned</Th>
                    <Th>Project / client</Th>
                    <Th className="w-32">Kind</Th>
                    <Th className="w-28 text-right">Billed</Th>
                    <Th className="w-28 text-right">Received</Th>
                    <Th className="w-28 text-right">Outstanding</Th>
                    <Th className="w-36">Status</Th>
                    <Th className="w-24 text-center">Payments</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const state = settlementOf(row);
                    const meta = REVENUE_STATUS_META[state];
                    const balance = outstandingOf(row);

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border-subtle transition-colors last:border-0 hover:bg-bg-surface-raised"
                      >
                        <Td className="text-text-tertiary">{shortDate(row.earnedOn)}</Td>

                        <Td>
                          {/* ⚠️ A link only where there IS a project. 064 allows
                              income against a bare client name for work that
                              predates the project record, and a statement page
                              cannot be addressed for one of those by id. */}
                          {row.projectId ? (
                            <Link
                              href={`/finance/clients/${row.projectId}`}
                              className="text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
                            >
                              {row.sourceName}
                            </Link>
                          ) : (
                            <span className="text-text-primary">{row.sourceName}</span>
                          )}
                          {row.invoiceRef && (
                            <span className="ml-1.5 text-micro text-text-tertiary">
                              {row.invoiceRef}
                            </span>
                          )}
                        </Td>

                        <Td className="text-text-secondary">{KIND_LABEL[row.kind]}</Td>

                        <Td className="tabular text-right font-semibold text-text-primary">
                          {pkr(row.amountPkr).replace('PKR ', '')}
                        </Td>

                        <Td
                          className="tabular text-right font-semibold"
                          style={{
                            color: row.paidPkr > 0 ? 'var(--money-in)' : 'var(--text-tertiary)',
                          }}
                        >
                          {row.paidPkr > 0 ? pkr(row.paidPkr).replace('PKR ', '') : '—'}
                          {row.lastPaymentOn && (
                            <span className="block text-micro font-normal text-text-tertiary">
                              {shortDate(row.lastPaymentOn)}
                            </span>
                          )}
                        </Td>

                        <Td
                          className="tabular text-right font-semibold"
                          style={{
                            color: balance > 0 ? 'var(--money-due)' : 'var(--text-tertiary)',
                          }}
                        >
                          {balance > 0 ? pkr(balance).replace('PKR ', '') : '—'}
                        </Td>

                        <Td>
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => setChanging(row)}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium transition-colors',
                              canManage && 'hover:brightness-95',
                            )}
                            style={{
                              backgroundColor: `color-mix(in oklab, var(--${meta.token}) 16%, transparent)`,
                              color: `var(--${meta.token})`,
                            }}
                            title={row.statusNote ?? (canManage ? 'Change status' : meta.label)}
                          >
                            {meta.label}
                          </button>
                        </Td>

                        {/* ── The instalments ──────────────────────────────
                            One control that both COUNTS what has arrived and
                            opens the place to add more. Two separate controls
                            here were tried on paper and rejected: the count is
                            the reason somebody clicks. */}
                        <Td className="text-center">
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => setPaying(row)}
                            title={
                              canManage
                                ? 'Payments against this invoice'
                                : `${row.paymentCount} payment(s)`
                            }
                            className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-2 py-0.5 text-micro text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                          >
                            {row.paymentCount === 0 ? (
                              <>
                                <Plus className="h-3 w-3" aria-hidden="true" />
                                Add
                              </>
                            ) : (
                              <>
                                <Wallet className="h-3 w-3" aria-hidden="true" />
                                {row.paymentCount}
                              </>
                            )}
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-border-default bg-bg-surface-sunken">
                    <Td colSpan={3} className="font-semibold text-text-primary">
                      Total of all {rows.length} matching{' '}
                      {rows.length === 1 ? 'invoice' : 'invoices'}
                    </Td>
                    <Td className="tabular text-right font-bold text-text-primary">
                      {pkr(billed).replace('PKR ', '')}
                    </Td>
                    <Td
                      className="tabular text-right font-bold"
                      style={{ color: 'var(--money-in)' }}
                    >
                      {pkr(collected).replace('PKR ', '')}
                    </Td>
                    <Td
                      className="tabular text-right font-bold"
                      style={{ color: owed > 0 ? 'var(--money-due)' : 'var(--text-tertiary)' }}
                    >
                      {owed > 0 ? pkr(owed).replace('PKR ', '') : '—'}
                    </Td>
                    <Td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <Pagination
              className="border-t border-border-subtle px-5 py-3"
              page={safePage}
              pageCount={pageCount}
              onPage={setPage}
              from={start + 1}
              to={Math.min(start + PER_PAGE, rows.length)}
              total={rows.length}
              label="invoices"
            />
          )}
        </CardBody>
      </Card>

      {changing && (
        <StatusDialog entry={changing} onClose={() => setChanging(null)} />
      )}

      <PaymentDialog
        entry={paying}
        today={today}
        onClose={() => setPaying(null)}
        onChanged={() => onChanged?.()}
      />

      <ProofViewer target={proof} onClose={() => setProof(null)} />
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Changing where an invoice stands
 * ------------------------------------------------------------------------- */

/**
 * ── ⚠️ THIS DIALOG NO LONGER TAKES A PAYMENT ──────────────────────────────
 * It used to: choosing `received` demanded a date and a proof, right here. That
 * was the only way to record money before instalments existed, and it is now
 * the wrong place — one invoice can have three receipts and this form can hold
 * one. Everything about money arriving moved to `PaymentDialog`.
 *
 * What is left is the BILLING lifecycle, which is genuinely a choice somebody
 * makes: has the bill gone out, has it been written off, was it refunded. The
 * picker offers only those; see `SETTABLE_REVENUE_STATUSES`.
 */
function StatusDialog({
  entry,
  onClose,
}: {
  entry: LedgerRevenue;
  onClose: () => void;
}) {
  const [status, setStatus] = React.useState<RevenueStatus>(
    /* ⚠️ Falls back to `invoiced` when the stored status is `received`, because
       `received` is not offered any more — leaving it selected would show a
       picker whose current value is absent from its own options, which renders
       as an empty box. */
    entry.status === 'received' ? 'invoiced' : entry.status,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const settled = entry.paidPkr >= entry.amountPkr && entry.amountPkr > 0;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await setRevenueStatusAction(entry.id, new FormData(event.currentTarget));
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${entry.sourceName} — ${pkr(entry.amountPkr)}`}
      description="Where the bill stands. Money arriving is recorded as a payment."
    >
      <form id="status-form" onSubmit={submit} className="space-y-4">
        {/* ⚠️ Says WHY the obvious option is missing. A picker that silently
            lacks "received" reads as a bug; one sentence turns it into a rule. */}
        {settled ? (
          <p className="rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
            This invoice is settled in full from its payments. Marking it written off or
            refunded here will not remove those receipts.
          </p>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
            Paid and part paid are set by recording a payment, not chosen here — so no
            invoice can be marked settled without a receipt behind it.
          </p>
        )}

        <Field label="Status" htmlFor="status">
          <Select
            id="status"
            name="status"
            size="md"
            className="w-full"
            value={status}
            onChange={(event) => setStatus(event.target.value as RevenueStatus)}
          >
            {SETTABLE_REVENUE_STATUSES.map((key) => (
              <option key={key} value={key}>
                {REVENUE_STATUS_META[key].label}
              </option>
            ))}
          </Select>
        </Field>

        {(status === 'returned' || status === 'written_off') && (
          <Field
            label={status === 'returned' ? 'Why was it refunded' : 'Why write it off'}
            htmlFor="statusNote"
            hint="Worth recording — this is a figure somebody will ask about."
          >
            <Textarea
              id="statusNote"
              name="statusNote"
              rows={2}
              maxLength={400}
              defaultValue={entry.statusNote ?? ''}
            />
          </Field>
        )}

        {error && (
          <p
            className="text-caption font-medium"
            role="alert"
            style={{ color: 'var(--feedback-error)' }}
          >
            {error}
          </p>
        )}
      </form>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form="status-form" variant="primary" size="md" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="h-4 w-4" aria-hidden="true" />
          )}
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 text-micro font-semibold tracking-wide text-text-tertiary uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  colSpan,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return (
    <td colSpan={colSpan} style={style} className={cn('px-4 py-2.5', className)}>
      {children}
    </td>
  );
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}`.trim();
}

/* ⚠️ Kept exported so the workspace's Paperclip column and the statement page
   can open the same viewer without importing three actions each. */
export { ProofViewer };
