'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Paperclip, Plus, Wallet } from 'lucide-react';
import Link from 'next/link';

import { PaymentDialog } from '@/components/finance/payment-dialog';
import { ProofViewer, type ProofTarget } from '@/components/finance/proof-viewer';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  PAYMENT_METHOD_LABEL,
  REVENUE_STATUS_META,
  monthLabel,
  monthOf,
  outstandingOf,
  settlementOf,
  type LedgerRevenue,
  type RevenuePayment,
} from '@/lib/domain/finance';
import { pkr } from '@/lib/domain/money';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ONE CLIENT'S ACCOUNT — THE STATEMENT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27:
 *
 *   "When I click on some project, all of that project's details will also be
 *    opened on a separate page [...] There, all the incomes of Daniyal
 *    Marketing, for example, should be displayed: this payment was received on
 *    this date and in this month. We have received these two main payments and
 *    the total of this whole payment received this month. You can say it
 *    properly, like a professional financier."
 *
 * ── ⚠️ THE SHAPE IS A STATEMENT OF ACCOUNT, NOT A FILTERED LEDGER ──────────
 * The obvious build is "the revenue table, filtered to one client". That
 * answers none of the questions somebody opens a client's page to ask. A
 * statement is read in a fixed order and this follows it:
 *
 *   1. the balance — billed, received, outstanding, at the top, unavoidable
 *   2. the month-by-month position — where the money went in and out of step
 *   3. the invoices, each with its own receipts nested underneath
 *
 * ── ⚠️ TWO MONTHLY TOTALS, AND THEY DO NOT MATCH ───────────────────────────
 * "Billed in August" and "received in August" are different columns because
 * they are different months' worth of money: a June retainer paid in September
 * is June revenue and September cash. Showing one figure would hide exactly the
 * lag the owner is trying to see. Accountants call this accrual versus cash;
 * the screen does not use those words, it just shows both.
 * ========================================================================= */

export interface StatementClient {
  readonly projectId: string | null;
  readonly name: string;
  readonly code: string | null;
  readonly type: string | null;
  readonly monthlyFeePkr: number | null;
}

export function ClientStatement({
  client,
  invoices,
  payments,
  today,
}: {
  client: StatementClient;
  invoices: readonly LedgerRevenue[];
  payments: readonly RevenuePayment[];
  today: string;
}) {
  const router = useRouter();
  const [paying, setPaying] = React.useState<LedgerRevenue | null>(null);
  const [proof, setProof] = React.useState<ProofTarget | null>(null);

  /* ⚠️ Grouped once, in a memo, rather than filtered inside the render of each
     invoice. A statement with 24 invoices and 40 receipts is 960 comparisons
     per render otherwise — invisible at this size and the kind of thing that
     makes a page mysteriously slow two years from now. */
  const byInvoice = React.useMemo(() => {
    const map = new Map<string, RevenuePayment[]>();
    for (const payment of payments) {
      const existing = map.get(payment.revenueId);
      if (existing) existing.push(payment);
      else map.set(payment.revenueId, [payment]);
    }
    /* Oldest first inside an invoice: a payment history reads forwards. */
    for (const list of map.values()) list.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
    return map;
  }, [payments]);

  const billed = invoices.reduce((sum, i) => sum + i.amountPkr, 0);
  const received = invoices.reduce((sum, i) => sum + i.paidPkr, 0);
  const owed = invoices.reduce((sum, i) => sum + outstandingOf(i), 0);

  /* ── The month-by-month position ────────────────────────────────────────
     ⚠️ Built from BOTH sides — invoices bucketed by the month they were earned
     in, receipts by the month the money landed. A month can appear because of
     either, which is why the keys are unioned rather than taken from the
     invoices alone: a September payment against a June invoice would otherwise
     have no row to appear in. */
  const months = React.useMemo(() => {
    const rows = new Map<string, { billed: number; received: number }>();

    const touch = (key: string) => {
      const existing = rows.get(key);
      if (existing) return existing;
      const created = { billed: 0, received: 0 };
      rows.set(key, created);
      return created;
    };

    for (const invoice of invoices) touch(monthOf(invoice.earnedOn)).billed += invoice.amountPkr;
    for (const payment of payments) touch(monthOf(payment.receivedOn)).received += payment.amountPkr;

    return [...rows.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, value]) => ({ key, ...value }));
  }, [invoices, payments]);

  return (
    <>
      <div className="space-y-5 pb-16">
        <Link
          href="/finance"
          className="inline-flex items-center gap-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Finance
        </Link>

        {/* ── The balance ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <CardTitle>{client.name}</CardTitle>
              <CardDescription>
                {[
                  client.code,
                  client.type,
                  client.monthlyFeePkr !== null
                    ? `${pkr(client.monthlyFeePkr)} a month`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Client account'}
              </CardDescription>
            </div>
          </CardHeader>

          <CardBody>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label="Billed to date" value={pkr(billed)} />
              <Figure label="Received" value={pkr(received)} tone="in" />
              <Figure label="Outstanding" value={pkr(owed)} tone={owed > 0 ? 'due' : 'in'} />
              <Figure
                label="Invoices"
                value={`${invoices.length}`}
                caption={`${payments.length} ${payments.length === 1 ? 'receipt' : 'receipts'}`}
              />
            </dl>

            {/* ⚠️ Says what the balance MEANS rather than leaving somebody to
                infer it. "Outstanding" is the number that gets acted on. */}
            {owed > 0 && (
              <p className="mt-3 text-caption text-text-secondary">
                {client.name} still owes <strong style={{ color: 'var(--money-due)' }}>{pkr(owed)}</strong>
                {' '}across{' '}
                {invoices.filter((i) => outstandingOf(i) > 0).length} unsettled{' '}
                {invoices.filter((i) => outstandingOf(i) > 0).length === 1 ? 'invoice' : 'invoices'}.
              </p>
            )}
          </CardBody>
        </Card>

        {/* ── Month by month ───────────────────────────────────────────────── */}
        {months.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Month by month</CardTitle>
                <CardDescription>
                  What was billed in each month, and what actually arrived in it. The two do
                  not have to match — a June retainer paid in September is June&rsquo;s
                  revenue and September&rsquo;s cash.
                </CardDescription>
              </div>
            </CardHeader>

            <CardBody className="px-0 py-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-caption">
                  <thead>
                    <tr className="border-b border-border-default text-left">
                      <Th>Month</Th>
                      <Th className="w-36 text-right">Billed</Th>
                      <Th className="w-36 text-right">Received</Th>
                      <Th className="w-36 text-right">Difference</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((row) => {
                      const gap = row.received - row.billed;
                      return (
                        <tr key={row.key} className="border-b border-border-subtle last:border-0">
                          <Td className="font-medium text-text-primary">{monthLabel(row.key)}</Td>
                          <Td className="tabular text-right text-text-primary">
                            {row.billed > 0 ? pkr(row.billed).replace('PKR ', '') : '—'}
                          </Td>
                          <Td
                            className="tabular text-right"
                            style={{
                              color: row.received > 0 ? 'var(--money-in)' : 'var(--text-tertiary)',
                            }}
                          >
                            {row.received > 0 ? pkr(row.received).replace('PKR ', '') : '—'}
                          </Td>
                          <Td
                            className="tabular text-right"
                            style={{
                              color:
                                gap === 0
                                  ? 'var(--text-tertiary)'
                                  : gap > 0
                                    ? 'var(--money-in)'
                                    : 'var(--money-due)',
                            }}
                          >
                            {gap === 0
                              ? '—'
                              : `${gap > 0 ? '+' : '−'}${pkr(Math.abs(gap)).replace('PKR ', '')}`}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border-default bg-bg-surface-sunken">
                      <Td className="font-semibold text-text-primary">All time</Td>
                      <Td className="tabular text-right font-bold text-text-primary">
                        {pkr(billed).replace('PKR ', '')}
                      </Td>
                      <Td
                        className="tabular text-right font-bold"
                        style={{ color: 'var(--money-in)' }}
                      >
                        {pkr(received).replace('PKR ', '')}
                      </Td>
                      <Td
                        className="tabular text-right font-bold"
                        style={{ color: owed > 0 ? 'var(--money-due)' : 'var(--text-tertiary)' }}
                      >
                        {owed > 0 ? `−${pkr(owed).replace('PKR ', '')}` : '—'}
                      </Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── Every invoice, with its receipts underneath ──────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Invoices and payments</CardTitle>
              <CardDescription>
                Newest first. Each payment shows the day it landed, how it arrived, and its
                proof.
              </CardDescription>
            </div>
          </CardHeader>

          <CardBody className="px-0 py-0">
            {invoices.length === 0 ? (
              <p className="px-5 py-12 text-center text-caption text-text-tertiary">
                Nothing has been billed to {client.name} yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {invoices.map((invoice) => {
                  const state = settlementOf(invoice);
                  const meta = REVENUE_STATUS_META[state];
                  const balance = outstandingOf(invoice);
                  const receipts = byInvoice.get(invoice.id) ?? [];

                  return (
                    <li key={invoice.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="text-caption font-semibold text-text-primary">
                              {pkr(invoice.amountPkr)}
                            </span>
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium"
                              style={{
                                backgroundColor: `color-mix(in oklab, var(--${meta.token}) 16%, transparent)`,
                                color: `var(--${meta.token})`,
                              }}
                            >
                              {meta.label}
                            </span>
                            {invoice.invoiceRef && (
                              <span className="text-micro text-text-tertiary">
                                {invoice.invoiceRef}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-micro text-text-tertiary">
                            Earned {monthLabel(monthOf(invoice.earnedOn))}
                            {balance > 0 && (
                              <>
                                {' · '}
                                <span style={{ color: 'var(--money-due)' }}>
                                  {pkr(balance)} outstanding
                                </span>
                              </>
                            )}
                          </p>
                          {invoice.statusNote && (
                            <p className="mt-1 text-micro text-text-secondary">
                              {invoice.statusNote}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setPaying(invoice)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-1 text-micro text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                        >
                          {receipts.length === 0 ? (
                            <>
                              <Plus className="h-3 w-3" aria-hidden="true" />
                              Record a payment
                            </>
                          ) : (
                            <>
                              <Wallet className="h-3 w-3" aria-hidden="true" />
                              {receipts.length}{' '}
                              {receipts.length === 1 ? 'payment' : 'payments'}
                            </>
                          )}
                        </button>
                      </div>

                      {receipts.length > 0 && (
                        /* ⚠️ Indented and rule-marked, so a receipt is visibly
                            SUBORDINATE to its invoice. A flat list of both was
                            tried and reads as two unrelated tables sharing a
                            card. */
                        <ol className="mt-2.5 ml-1 space-y-1.5 border-l-2 border-border-subtle pl-4">
                          {receipts.map((receipt) => (
                            <li
                              key={receipt.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1"
                            >
                              <span
                                className="tabular text-caption font-medium"
                                style={{ color: 'var(--money-in)' }}
                              >
                                {pkr(receipt.amountPkr)}
                              </span>
                              <span className="text-micro text-text-secondary">
                                {receipt.receivedOn}
                              </span>
                              <span className="text-micro text-text-tertiary">
                                {PAYMENT_METHOD_LABEL[receipt.method]}
                                {receipt.reference ? ` · ${receipt.reference}` : ''}
                              </span>

                              {receipt.hasProof && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setProof({
                                      kind: 'payment',
                                      id: receipt.id,
                                      title: `Proof — ${pkr(receipt.amountPkr)}`,
                                      caption: `${client.name} · ${receipt.receivedOn}`,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-micro text-text-brand underline-offset-2 hover:underline"
                                >
                                  <Paperclip className="h-3 w-3" aria-hidden="true" />
                                  Proof
                                </button>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <PaymentDialog
        entry={paying}
        today={today}
        onClose={() => setPaying(null)}
        /* ⚠️ `router.refresh()` rather than local state. This page is a Server
           Component's data, and the monthly totals, the balance and the invoice
           rows all move when a payment is recorded — recomputing three of them
           in the browser is three chances to disagree with the database. */
        onChanged={() => router.refresh()}
      />

      <ProofViewer target={proof} onClose={() => setProof(null)} />
    </>
  );
}

function Figure({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'in' | 'due';
}) {
  /* ⚠️ The money tokens, not the chart hues. tokens.css records the
     measurement: the `-l` chart colours are FILLS and fail WCAG as text in
     light mode while passing in dark. */
  const colour =
    tone === 'in' ? 'var(--money-in)' : tone === 'due' ? 'var(--money-due)' : 'var(--text-primary)';

  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle px-3.5 py-3">
      <dt className="text-micro text-text-tertiary">{label}</dt>
      <dd className="tabular mt-0.5 text-h3 leading-none font-semibold" style={{ color: colour }}>
        {value}
      </dd>
      {caption && <p className="mt-1 text-micro text-text-tertiary">{caption}</p>}
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
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return <td style={style} className={cn('px-4 py-2.5', className)}>{children}</td>;
}
