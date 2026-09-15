'use client';

import * as React from 'react';
import { AlertTriangle, Stamp } from 'lucide-react';

import { decideQuotationAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { CrmApprovalRow } from '@/lib/db/queries/crm-leads';
import { toRupees } from '@/lib/domain/crm-quotations';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WAITING FOR A DECISION
 * ----------------------------------------------------------------------------
 * A discount cannot be approved by the person who asked for it, so somebody
 * else has to see it. Until now that meant a manager visiting each lead in turn
 * to find out whether one was waiting — which is the same as not knowing.
 *
 * ── ⚠️ IT DISAPPEARS WHEN THERE IS NOTHING WAITING ─────────────────────────
 * A permanently visible "0 pending" panel is a band of dead space at the top of
 * a working screen, and it teaches the eye to skip exactly the strip that
 * matters on the day something IS waiting. Same rule as Today's plan.
 *
 * ── ⚠️ AND A SALESPERSON NEVER SEES THIS, EVEN THEIR OWN REQUEST ───────────
 * `crmAwaitingApproval` excludes anything the reader prepared — not only
 * because the constraint would refuse it, but because an action somebody can
 * never take, offered every morning, is how a person learns to ignore a queue.
 * ========================================================================= */

export function ApprovalQueue({ rows }: { rows: readonly CrmApprovalRow[] }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [decided, setDecided] = React.useState<ReadonlySet<string>>(new Set());
  /** Which row has its "approve a different figure" box open. */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState('');

  const live = rows.filter((r) => !decided.has(r.id));
  if (live.length === 0) return null;

  const money = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;

  async function decide(
    row: CrmApprovalRow,
    decision: 'approved' | 'rejected',
    approvedDiscount: string,
    note: string,
  ) {
    setBusy(row.id);
    const result = await decideQuotationAction(
      row.id,
      row.leadId,
      decision,
      approvedDiscount,
      note,
    );
    setBusy(null);

    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    setDecided((prev) => new Set(prev).add(row.id));
    setEditing(null);
    toast({
      tone: 'ok',
      text:
        decision === 'approved'
          ? `${row.number} approved. ${row.preparedBy ?? 'They'} can send it now.`
          : `${row.number} rejected, with your reason on it.`,
    });
  }

  return (
    <section className="rounded-2xl border border-gold-700/40 bg-[color-mix(in_oklab,var(--gold-700)_6%,transparent)] px-4 py-3.5">
      <header className="flex items-center gap-2">
        <Stamp className="size-4 text-gold-700" aria-hidden="true" />
        <h2 className="text-body-sm font-semibold text-text-primary">Waiting for your decision</h2>
        <span className="text-caption text-text-tertiary">
          {live.length} quotation{live.length === 1 ? '' : 's'}
        </span>
      </header>

      <ul className="mt-3 space-y-2">
        {live.map((r) => {
          const full = r.basePrice + r.premiumCharges;
          const asked = r.requestedDiscount;
          /* The share of the price being given away — the figure a manager is
             actually deciding about, which "300,000" alone does not convey. */
          const pct = full > 0 ? (asked / full) * 100 : 0;
          const open = editing === r.id;

          return (
            <li key={r.id} className="rounded-xl border border-border-subtle bg-bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-body-sm text-text-primary">
                  <span className="font-semibold">{r.number}</span>
                  <span className="text-text-secondary"> · {r.leadName ?? 'a lead'}</span>
                  {r.preparedBy && (
                    <span className="text-text-tertiary"> · asked by {r.preparedBy}</span>
                  )}
                </p>
                <p className="shrink-0 text-body-sm font-semibold tabular-nums text-text-primary">
                  {money(r.netAmount)}
                </p>
              </div>

              {/* ⚠️ THE DISCOUNT IS THE DECISION, so it leads — not the total.
                  A manager approving "PKR 4,400,000" is approving a number they
                  would have to do arithmetic to understand. */}
              <p className="mt-0.5 text-caption text-text-secondary">
                {money(full)} less{' '}
                <span className="font-semibold text-gold-700">
                  {money(asked)} ({pct.toFixed(1)}%)
                </span>
              </p>

              {open ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={String(asked)}
                    aria-label={`Discount to approve for ${r.number}`}
                    className="min-h-[2.2rem] w-40 rounded-lg border border-border-subtle bg-bg-surface px-2.5 text-body-sm text-text-primary"
                  />
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => {
                      const n = toRupees(amount);
                      if (n === null) {
                        toast({ tone: 'warn', text: 'Enter the discount you are approving.' });
                        return;
                      }
                      if (n > full) {
                        toast({
                          tone: 'warn',
                          text: 'That is more than the price. Nothing can be sold for less than nothing.',
                        });
                        return;
                      }
                      void decide(r, 'approved', amount, `Approved ${money(n)} of ${money(asked)} asked.`);
                    }}
                    className="min-h-[2.2rem] rounded-lg bg-accent-primary px-3 text-caption font-medium text-white"
                  >
                    Approve this much
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="min-h-[2.2rem] rounded-lg px-2 text-caption text-text-secondary hover:bg-bg-subtle"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void decide(r, 'approved', String(asked), 'Approved as asked.')}
                    className={cn(
                      'min-h-[2.2rem] rounded-lg bg-accent-primary px-3 text-caption font-medium text-white',
                      busy === r.id && 'opacity-40',
                    )}
                  >
                    Approve {money(asked)}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => {
                      setEditing(r.id);
                      setAmount('');
                    }}
                    className="min-h-[2.2rem] rounded-lg border border-border-subtle px-3 text-caption font-medium text-text-primary hover:border-border-default"
                  >
                    Approve less
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => {
                      /* ⚠️ A REJECTION CARRIES A REASON, and the server refuses
                         one without. "Rejected" with nothing written is a message
                         the salesperson cannot act on — they either ask again
                         anyway, or quietly stop asking. */
                      const why = window.prompt(
                        `Why is ${r.number} refused? ${r.preparedBy ?? 'They'} will see this.`,
                      );
                      if (why && why.trim()) void decide(r, 'rejected', '0', why.trim());
                    }}
                    className="min-h-[2.2rem] rounded-lg px-3 text-caption font-medium text-feedback-error hover:bg-[color-mix(in_oklab,var(--feedback-error)_8%,transparent)]"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 flex items-start gap-1.5 text-caption leading-relaxed text-text-secondary">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-700" aria-hidden="true" />
        Your own requests never appear here — a discount cannot be approved by the person who
        asked for it.
      </p>
    </section>
  );
}
