'use client';

import * as React from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { raiseQuotationAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import {
  needsApproval,
  netAmount,
  quotationProblems,
  toRupees,
} from '@/lib/domain/crm-quotations';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RAISE A QUOTATION
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE TOTAL IS SHOWN WHILE IT IS BEING TYPED ──────────────────────────
 * This form's whole job is to produce ONE number that a client will be told, and
 * that number is the sum of three others. Making somebody submit to find out
 * what they just quoted is how a wrong figure reaches a person's phone — so the
 * net is computed from the same function the server uses and shown as it moves.
 *
 * ── ⚠️ AND WHAT HAPPENS ON SAVE IS SAID BEFORE SAVING ──────────────────────
 * A quotation at list price goes out. One with a discount goes to a manager. The
 * difference matters to somebody standing in front of a client, and the form
 * says which it will be rather than letting them discover it from a toast.
 * ========================================================================= */

export function RaiseQuotation({
  leadId,
  leadName,
  propertyLabel,
  suggestedPrice,
  onClose,
}: {
  leadId: string;
  leadName: string;
  /** The unit this lead is asking about, if one is attached. */
  propertyLabel: string | null;
  /** That unit's list price, so nobody retypes it from memory. */
  suggestedPrice: number | null;
  onClose: () => void;
}) {
  const toast = useToast();

  const [basePrice, setBasePrice] = React.useState(
    suggestedPrice ? String(suggestedPrice) : '',
  );
  const [premiumCharges, setPremiumCharges] = React.useState('');
  const [requestedDiscount, setRequestedDiscount] = React.useState('');
  const [validUntil, setValidUntil] = React.useState('');
  const [terms, setTerms] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const problems = quotationProblems(
    { basePrice, premiumCharges, requestedDiscount, validUntil: validUntil || null, terms },
    today,
  );

  const base = toRupees(basePrice) ?? 0;
  const premium = premiumCharges.trim() ? (toRupees(premiumCharges) ?? 0) : 0;
  const discount = requestedDiscount.trim() ? (toRupees(requestedDiscount) ?? 0) : 0;
  const net = netAmount({
    basePrice: base,
    premiumCharges: premium,
    requestedDiscount: discount,
    approvedDiscount: 0,
    approved: false,
  });
  const forApproval = needsApproval(discount);
  const money = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;

  async function save(sendNow: boolean) {
    setBusy(true);
    const result = await raiseQuotationAction({
      leadId,
      basePrice,
      premiumCharges,
      requestedDiscount,
      validUntil: validUntil || null,
      terms,
      sendNow,
    });
    setBusy(false);

    if (!result.ok) {
      /* The panel stays open with everything typed — the owner's standing rule
         since the team forms: *"I don't need to enter it again and again."* */
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }

    toast({
      tone: 'ok',
      text:
        result.status === 'pending_approval'
          ? `${result.number} raised and sent for approval — a discount needs somebody else's yes.`
          : result.status === 'sent'
            ? `${result.number} sent to ${leadName}.`
            : `${result.number} saved as a draft.`,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-black/40" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Raise a quotation for ${leadName}`}
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">Raise a quotation</h2>
            <p className="mt-0.5 truncate text-caption text-text-secondary">
              {leadName}
              {propertyLabel && ` · ${propertyLabel}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Field label="Price (PKR)">
            <input
              type="text"
              inputMode="numeric"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="4,500,000"
              className={control}
            />
            {suggestedPrice !== null && base !== suggestedPrice && (
              <span className="mt-1 block text-caption text-text-secondary">
                The unit&rsquo;s list price is {money(suggestedPrice)}.
              </span>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Premium charges">
              <input
                type="text"
                inputMode="numeric"
                value={premiumCharges}
                onChange={(e) => setPremiumCharges(e.target.value)}
                placeholder="Corner, park facing…"
                className={control}
              />
            </Field>
            <Field label="Discount asked for">
              <input
                type="text"
                inputMode="numeric"
                value={requestedDiscount}
                onChange={(e) => setRequestedDiscount(e.target.value)}
                placeholder="0"
                className={control}
              />
            </Field>
          </div>

          {/* ⚠️ THE NUMBER THE CLIENT WILL BE TOLD, while it is being built. */}
          <div className="rounded-xl border border-border-subtle bg-bg-subtle px-3 py-2.5">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-caption text-text-secondary">The client pays</span>
              <span className="text-body font-semibold tabular-nums text-text-primary">
                {money(net)}
              </span>
            </p>
            {discount > 0 && (
              <p className="mt-0.5 text-caption text-text-tertiary">
                {money(base + premium)} less {money(discount)} discount
              </p>
            )}
          </div>

          <Field label="Valid until">
            <input
              type="date"
              value={validUntil}
              min={today}
              onChange={(e) => setValidUntil(e.target.value)}
              className={control}
            />
          </Field>

          <Field label="Terms">
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={3}
              placeholder="Payment plan, handover, what is included."
              className="w-full rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 text-body-sm text-text-primary"
            />
          </Field>

          {/* ⚠️ SAID BEFORE IT IS PRESSED, not discovered afterwards. */}
          <p
            className={cn(
              'rounded-xl border px-3 py-2.5 text-caption leading-relaxed',
              forApproval
                ? 'border-gold-700/40 bg-[color-mix(in_oklab,var(--gold-700)_8%,transparent)] text-text-primary'
                : 'border-border-subtle text-text-secondary',
            )}
          >
            {forApproval
              ? 'This asks for a discount, so it goes to the sales manager first. You cannot approve your own — and you will see it here once they decide.'
              : 'No discount, so this is yours to send. Nobody else has to agree to a list price.'}
          </p>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-feedback-error/40 bg-[color-mix(in_oklab,var(--feedback-error)_7%,transparent)] px-3 py-2">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-caption text-text-primary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-feedback-error" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[2.4rem] rounded-xl px-3 text-body-sm font-medium text-text-secondary hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={busy || problems.length > 0}
            className={cn(
              'min-h-[2.4rem] rounded-xl border border-border-default px-3 text-body-sm font-medium text-text-primary',
              (busy || problems.length > 0) && 'opacity-40',
            )}
          >
            Save as draft
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={busy || problems.length > 0}
            className={cn(
              'min-h-[2.4rem] rounded-xl bg-accent-primary px-4 text-body-sm font-medium text-white transition-opacity',
              (busy || problems.length > 0) && 'opacity-40',
            )}
          >
            {busy ? 'Saving…' : forApproval ? 'Send for approval' : 'Send to client'}
          </button>
        </div>
      </div>
    </div>
  );
}

const control =
  'min-h-[2.4rem] w-full rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
