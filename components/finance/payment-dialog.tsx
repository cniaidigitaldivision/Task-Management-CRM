'use client';

import * as React from 'react';
import { Loader2, Paperclip, Trash2 } from 'lucide-react';

import {
  deletePaymentAction,
  listPaymentsAction,
  recordPaymentAction,
} from '@/app/actions/finance';
import { ProofField } from '@/components/finance/proof-field';
import { ProofViewer, type ProofTarget } from '@/components/finance/proof-viewer';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  PAYMENT_METHOD_LABEL,
  outstandingOf,
  overpaidOf,
  type LedgerRevenue,
  type PaymentMethod,
  type RevenuePayment,
} from '@/lib/domain/finance';
import { pkr } from '@/lib/domain/money';

/* ============================================================================
 * MONEY ARRIVING AGAINST AN INVOICE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"It's not possible that in some project they are giving
 * money in one go. Maybe they are giving two monies in pieces, two times or
 * three times, in one month. How can I manage that?"*
 *
 * ── ⚠️ THE RECEIPTS ARE LISTED HERE, NOT JUST THE FORM ─────────────────────
 * A dialog that only ADDS a payment cannot answer the question somebody opens
 * it with: how much is still owed, and what has already been counted. Both
 * halves are here, which is also what makes a mistaken entry recoverable —
 * removing the wrong instalment is one click, and the invoice repairs itself
 * because migration 074's trigger recomputes the total.
 *
 * ── ⚠️ THE AMOUNT DEFAULTS TO THE BALANCE, NOT TO THE INVOICE TOTAL ────────
 * The common case is a client clearing what is left. Prefilling the full
 * invoice on a part-paid bill invites the one mistake that is hard to spot
 * afterwards: recording 120,000 against an invoice already 50,000 paid, which
 * silently books a 50,000 overpayment.
 * ========================================================================= */

const METHODS: readonly PaymentMethod[] = [
  'bank_transfer',
  'cash',
  'cheque',
  'online',
  'other',
];

export function PaymentDialog({
  entry,
  today,
  onClose,
  onChanged,
}: {
  entry: LedgerRevenue | null;
  /** Resolved on the server, in Karachi — see `isoDateIn`. */
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = React.useState<
    { forId: string; rows: readonly RevenuePayment[] } | null
  >(null);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [proof, setProof] = React.useState<ProofTarget | null>(null);

  const formRef = React.useRef<HTMLFormElement>(null);
  const entryId = entry?.id ?? null;

  /* ⚠️ Stamped with the invoice it belongs to, so a slow reply for the row
     somebody opened first cannot paint over the row they opened second. */
  const load = React.useCallback(async (id: string) => {
    const result = await listPaymentsAction(id);
    if (result.ok) setPayments({ forId: id, rows: result.payments });
    else setError(result.error);
  }, []);

  React.useEffect(() => {
    if (entryId === null) return;
    let cancelled = false;
    void listPaymentsAction(entryId).then((result) => {
      if (cancelled) return;
      if (result.ok) setPayments({ forId: entryId, rows: result.payments });
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  if (entry === null) return null;

  const rows = payments !== null && payments.forId === entry.id ? payments.rows : null;
  const balance = outstandingOf(entry);
  const over = overpaidOf(entry);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    form.set('revenueId', entry.id);

    const result = await recordPaymentAction(form);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    /* ⚠️ Reset by hand rather than through React 19's form `action` prop. That
       resets AFTER the re-render this triggers, which wipes fields the person
       has not finished with — the trap `expense-drop-box.tsx` documents. */
    formRef.current?.reset();
    await load(entry.id);
    onChanged();
  };

  const remove = async (id: string) => {
    setRemoving(id);
    setError(null);
    const result = await deletePaymentAction(id);
    setRemoving(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load(entry.id);
    onChanged();
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={`Payments — ${entry.sourceName}`}
        description={
          entry.invoiceRef
            ? `${entry.invoiceRef} · earned ${entry.earnedOn}`
            : `Earned ${entry.earnedOn}`
        }
        size="md"
      >
        <div className="space-y-5">
          {/* ── Where this invoice stands ─────────────────────────────────
              Three figures, because "how much is left" is the question this
              dialog is opened to answer and doing the subtraction in your head
              off two numbers is how the wrong amount gets typed. */}
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Billed" value={pkr(entry.amountPkr)} />
            <Figure label="Received" value={pkr(entry.paidPkr)} tone="in" />
            <Figure
              label={over > 0 ? 'Overpaid' : 'Still owed'}
              value={pkr(over > 0 ? over : balance)}
              tone={over > 0 ? 'warn' : balance > 0 ? 'due' : 'in'}
            />
          </dl>

          {over > 0 && (
            <p className="text-caption" style={{ color: 'var(--money-due)' }}>
              This invoice has been paid {pkr(over)} more than it was billed for. Check the
              amounts, or raise a credit for the difference.
            </p>
          )}

          {/* ── What has already arrived ──────────────────────────────────── */}
          <section>
            <h3 className="text-caption font-semibold text-text-primary">
              Received so far
              {rows !== null && rows.length > 0 && (
                <span className="ml-1.5 font-normal text-text-tertiary">
                  · {rows.length} {rows.length === 1 ? 'payment' : 'payments'}
                </span>
              )}
            </h3>

            {rows === null ? (
              <p className="flex items-center gap-2 py-4 text-caption text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="py-4 text-caption text-text-tertiary">
                Nothing has been received against this invoice yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border-subtle rounded-[var(--radius-md)] border border-border-subtle">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-caption font-medium text-text-primary">
                        {pkr(row.amountPkr)}
                        <span className="ml-2 font-normal text-text-secondary">
                          {row.receivedOn}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-micro text-text-tertiary">
                        {PAYMENT_METHOD_LABEL[row.method]}
                        {row.reference ? ` · ${row.reference}` : ''}
                        {row.recordedBy ? ` · by ${row.recordedBy}` : ''}
                      </p>
                      {row.note && (
                        <p className="mt-0.5 truncate text-micro text-text-secondary">{row.note}</p>
                      )}
                    </div>

                    {row.hasProof && (
                      <button
                        type="button"
                        onClick={() =>
                          setProof({
                            kind: 'payment',
                            id: row.id,
                            title: `Proof — ${pkr(row.amountPkr)}`,
                            caption: `${entry.sourceName} · ${row.receivedOn}`,
                          })
                        }
                        title="Open the proof"
                        aria-label={`Open the proof for ${pkr(row.amountPkr)}`}
                        className="shrink-0 rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-bg-surface-sunken hover:text-text-brand"
                      >
                        <Paperclip className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={removing === row.id}
                      onClick={() => void remove(row.id)}
                      title="Remove this payment"
                      aria-label={`Remove the payment of ${pkr(row.amountPkr)}`}
                      className="shrink-0 rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-bg-surface-sunken disabled:opacity-40"
                      style={{ color: removing === row.id ? undefined : undefined }}
                    >
                      {removing === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Record another ────────────────────────────────────────────── */}
          <form ref={formRef} onSubmit={submit} className="space-y-4 border-t border-border-subtle pt-4">
            <h3 className="text-caption font-semibold text-text-primary">Record a payment</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Amount received"
                htmlFor="amountPkr"
                hint={balance > 0 ? `${pkr(balance)} still owed.` : 'This invoice is settled.'}
              >
                <Input
                  id="amountPkr"
                  name="amountPkr"
                  inputMode="decimal"
                  required
                  /* ⚠️ `key` on the default: React keeps an uncontrolled input's
                     value across re-renders, so the prefill would go stale the
                     moment a payment is recorded and the balance changes. */
                  key={`amount-${entry.paidPkr}`}
                  defaultValue={balance > 0 ? String(balance) : ''}
                  placeholder="50000"
                  autoComplete="off"
                />
              </Field>

              <Field label="Date received" htmlFor="receivedOn" hint="The day it landed.">
                <Input
                  id="receivedOn"
                  name="receivedOn"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="How it arrived" htmlFor="method">
                <Select id="method" name="method" size="md" defaultValue="bank_transfer">
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABEL[method]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Reference"
                htmlFor="reference"
                hint="Optional. The bank's transaction id."
              >
                <Input id="reference" name="reference" maxLength={80} autoComplete="off" />
              </Field>
            </div>

            {/* ⚠️ Required, and required again by the table. Owner, on expenses:
                *"It's not about trust, it's about accuracy."* Money claimed to
                have arrived deserves at least the same standard as money
                claimed to have been spent. */}
            <ProofField
              name="proof"
              label="Proof of payment"
              required
              hint="The bank message, transfer screenshot or receipt. Required."
            />

            <Field label="Note" htmlFor="note" hint="Optional.">
              <Textarea id="note" name="note" rows={2} maxLength={300} />
            </Field>

            {error !== null && (
              <p role="alert" className="text-caption" style={{ color: 'var(--feedback-error)' }}>
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Done
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Record payment
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      <ProofViewer target={proof} onClose={() => setProof(null)} />
    </>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'in' | 'due' | 'warn';
}) {
  /* ⚠️ The money tokens, not the chart hues. `styles/tokens.css` records the
     measurement: the `-l` chart colours are FILLS and fail WCAG as text in
     light mode while passing in dark — which is how a contrast failure ships
     unnoticed by anybody reviewing in dark. */
  const colour =
    tone === 'in'
      ? 'var(--money-in)'
      : tone === 'due'
        ? 'var(--money-due)'
        : tone === 'warn'
          ? 'var(--money-out)'
          : 'var(--text-primary)';

  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle px-3 py-2.5">
      <dt className="text-micro text-text-tertiary">{label}</dt>
      <dd className="tabular mt-0.5 text-body font-semibold" style={{ color: colour }}>
        {value}
      </dd>
    </div>
  );
}
