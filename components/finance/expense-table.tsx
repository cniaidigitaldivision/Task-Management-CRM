'use client';

import * as React from 'react';
import { Check, Circle, Loader2, Paperclip, Search, Trash2 } from 'lucide-react';

import { deleteExpenseAction, receiptUrlAction } from '@/app/actions/finance';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { subtypeLabel } from '@/lib/domain/expense-subtypes';
import { pkr } from '@/lib/domain/money';
import type { LedgerExpense } from '@/lib/domain/finance';
import { filterExpenses, type ExpenseFilter, type FinanceBoard } from '@/lib/view/finance-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT WENT OUT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"We have to maintain expenses separately."*
 *
 * This used to be half of a combined ledger, which meant the category filter
 * offered "Retainer" and "One-off" alongside "Salaries" — he asked why those
 * were there. They were income kinds. Expenses now have their own screen and
 * their own filters, and every one of them is about spending.
 *
 * ── ⚠️ NO EDIT BUTTON, DELIBERATELY ────────────────────────────────────────
 * Owner: *"the whole expense can be deleted but it cannot be updated [...] Then
 * I have to add a new record."* A filed expense is a claim backed by a receipt;
 * editing the amount while the receipt stays put breaks the only thing that
 * makes the row trustworthy. Settling it is not an edit and stays.
 * ========================================================================= */

const SETTLED = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid only' },
  { value: 'paid', label: 'Paid only' },
];

export function ExpenseTable({
  board,
  canManage,
  filter,
  onFilter,
  onSettle,
  onDeleted,
}: {
  board: FinanceBoard;
  canManage: boolean;
  filter: ExpenseFilter;
  onFilter: (next: ExpenseFilter) => void;
  onSettle: (id: string, paid: boolean) => void;
  onDeleted: (message: string) => void;
}) {
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<LedgerExpense | null>(null);

  /* Narrowing goes back to page one — staying on page 7 of a two-page result
     shows an empty table, which reads as "no matches" when there are matches. */
  const narrow = (next: Partial<ExpenseFilter>) => {
    onFilter({ ...filter, ...next });
    setPage(1);
  };

  const rows = filterExpenses(board.expenses, filter);

  const PER_PAGE = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PER_PAGE;
  const visible = rows.slice(start, start + PER_PAGE);

  /* ⚠️ Over every matching row, not the visible page. A total that changed as
     you paged through one filter is indistinguishable from the data changing. */
  const total = rows.reduce((sum, row) => sum + row.amountPkr, 0);
  const unpaid = rows.filter((r) => r.paidOn === null).reduce((s, r) => s + r.amountPkr, 0);

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-stretch gap-3 lg:flex-row lg:items-center">
          <div>
            <CardTitle>Expenses</CardTitle>
            <CardDescription>
              {rows.length} of {board.expenses.length} · {pkr(total)}
              {unpaid > 0 && ` · ${pkr(unpaid)} unpaid`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
                aria-hidden="true"
              />
              <Input
                size="sm"
                value={filter.query}
                onChange={(event) => narrow({ query: event.target.value })}
                placeholder="Search"
                aria-label="Search expenses"
                className="w-36 pl-8"
              />
            </span>

            <Select
              label="Category"
              size="sm"
              value={filter.category}
              onChange={(event) => narrow({ category: event.target.value })}
            >
              <option value="all">All categories</option>
              {board.categoryOptions.map((option) => (
                <option key={option.id} value={option.slug}>
                  {option.name}
                </option>
              ))}
            </Select>

            <Select
              label="Office"
              size="sm"
              value={filter.office}
              onChange={(event) => narrow({ office: event.target.value })}
            >
              <option value="all">All offices</option>
              <option value="blue_area">Blue Area</option>
              <option value="wah">Wah</option>
            </Select>

            <Select
              label="Paid"
              size="sm"
              value={filter.settled}
              onChange={(event) =>
                narrow({ settled: event.target.value as ExpenseFilter['settled'] })
              }
            >
              {SETTLED.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>

        <CardBody className="px-0 py-0">
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-caption text-text-tertiary">
              Nothing matches. Try a wider period or fewer filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] border-collapse text-caption">
                <thead>
                  <tr className="border-b border-border-default text-left">
                    <Th className="w-24">Date</Th>
                    <Th className="w-40">Category</Th>
                    <Th>What it was</Th>
                    <Th className="w-36">Paid to</Th>
                    <Th className="w-32 text-right">Amount</Th>
                    <Th className="w-24 text-center">Paid</Th>
                    <Th className="w-20 text-center">Proof</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setOpen(row)}
                      className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-bg-surface-raised"
                    >
                      <Td className="text-text-tertiary">{shortDate(row.incurredOn)}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: `var(--${row.categoryToken})` }}
                          />
                          <span className="truncate text-text-secondary">
                            {row.categoryName}
                            {/* The second level — which utility, which tool. */}
                            {subtypeLabel(row.categorySlug, row.subtype, row.subtypeOther) && (
                              <span className="text-text-tertiary">
                                {' · '}
                                {subtypeLabel(row.categorySlug, row.subtype, row.subtypeOther)}
                              </span>
                            )}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="text-text-primary">{row.title}</span>
                        {row.source !== 'manual' && (
                          <span className="ml-1.5 rounded-full bg-bg-surface-sunken px-1.5 py-0.5 text-micro text-text-tertiary">
                            auto
                          </span>
                        )}
                        {row.seatHolderName && (
                          <span className="ml-1.5 text-micro text-text-tertiary">
                            for {row.seatHolderName}
                          </span>
                        )}
                      </Td>
                      <Td className="truncate text-text-tertiary">
                        {row.personName ?? row.vendor ?? '—'}
                      </Td>
                      <Td className="tabular text-right font-semibold text-text-primary">
                        {pkr(row.amountPkr).replace('PKR ', '')}
                      </Td>
                      <Td className="text-center">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSettle(row.id, row.paidOn === null);
                          }}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro transition-colors',
                            canManage && 'hover:bg-bg-surface-sunken',
                          )}
                          style={{ color: row.paidOn ? 'var(--money-in)' : 'var(--text-tertiary)' }}
                          title={row.paidOn ? `Paid ${row.paidOn}` : 'Not paid yet'}
                        >
                          {row.paidOn ? (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <Circle className="h-3 w-3" aria-hidden="true" />
                          )}
                          {row.paidOn ? 'Yes' : 'No'}
                        </button>
                      </Td>
                      <Td className="text-center">
                        {row.hasReceipt ? (
                          <Paperclip
                            className="mx-auto h-3.5 w-3.5"
                            style={{ color: 'var(--money-in)' }}
                            aria-label="Receipt attached"
                          />
                        ) : (
                          /* ⚠️ Posted rows have no receipt and never will — they
                             were generated, not claimed. Saying "—" rather than
                             flagging them keeps the warning meaningful. */
                          <span className="text-micro text-text-tertiary">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-default bg-bg-surface-sunken">
                    <Td colSpan={4} className="font-semibold text-text-primary">
                      Total of all {rows.length} matching {rows.length === 1 ? 'entry' : 'entries'}
                    </Td>
                    <Td className="tabular text-right font-bold text-text-primary">
                      {pkr(total).replace('PKR ', '')}
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
              label="expenses"
            />
          )}
        </CardBody>
      </Card>

      {open && (
        <ExpenseDetail
          expense={open}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onDeleted={(message) => {
            setOpen(null);
            onDeleted(message);
          }}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * One expense, and its proof
 * ------------------------------------------------------------------------- */

function ExpenseDetail({
  expense,
  canManage,
  onClose,
  onDeleted,
}: {
  expense: LedgerExpense;
  canManage: boolean;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  /* ⚠️ Signed on demand rather than held in the row. The bucket is private
     precisely so a link cannot be forwarded and used forever; the path never
     reaches the browser at all. */
  const openReceipt = async () => {
    setBusy('receipt');
    setError(null);
    const result = await receiptUrlAction(expense.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    const result = await deleteExpenseAction(expense.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDeleted(result.message);
  };

  return (
    <Dialog open onClose={onClose} title={expense.title} description={expense.categoryName}>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Detail label="Amount" value={pkr(expense.amountPkr)} strong />
        <Detail label="Date incurred" value={expense.incurredOn} />
        <Detail label="Paid on" value={expense.paidOn ?? 'Not paid yet'} />
        <Detail
          label="Kind"
          value={subtypeLabel(expense.categorySlug, expense.subtype, expense.subtypeOther) ?? '—'}
        />
        <Detail
          label="Office"
          value={
            expense.officeTeam === 'wah'
              ? 'Wah'
              : expense.officeTeam === 'blue_area'
                ? 'Blue Area'
                : 'Not office-specific'
          }
        />
        <Detail label="Paid to" value={expense.vendor ?? expense.personName ?? '—'} />
        {expense.seatHolderName && <Detail label="Seat for" value={expense.seatHolderName} />}
      </dl>

      <div className="mt-5 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken p-4">
        {expense.hasReceipt ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption font-semibold text-text-primary">Proof of payment</p>
              <p className="truncate text-micro text-text-tertiary">
                {expense.receiptName ?? 'Attached'}
              </p>
            </div>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void openReceipt()}>
              {busy === 'receipt' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Open
            </Button>
          </div>
        ) : (
          <p className="text-caption text-text-tertiary">
            {expense.source === 'manual'
              ? 'No receipt on file — this was filed before proof was required.'
              : 'Posted automatically each month, so there is no receipt to attach.'}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-3 text-caption font-medium" role="alert" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        {/* ⚠️ Delete, never edit. See this file's header. The two-step confirm
            is because there is no undo and no amendment path — filing again is
            the only way back. */}
        {canManage && expense.source === 'manual' ? (
          confirming ? (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void remove()}>
                {busy === 'delete' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Delete for good
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </Button>
          )
        ) : (
          <span className="text-micro text-text-tertiary">
            {expense.source === 'manual' ? '' : 'Posted rows are removed by unposting the month.'}
          </span>
        )}

        <Button size="md" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {confirming && (
        <p className="mt-3 text-caption text-text-secondary">
          A recorded expense cannot be edited — deleting removes it and its receipt for good.
          If the figure was wrong, delete this and file it again.
        </p>
      )}
    </Dialog>
  );
}

function Detail({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-micro text-text-tertiary">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-caption',
          strong ? 'tabular font-bold text-text-primary' : 'text-text-secondary',
        )}
      >
        {value}
      </dd>
    </div>
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

/** `26 Aug`. The table never shows a year in a row — the range says it. */
function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}`.trim();
}
