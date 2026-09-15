'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';

import { attachUnitAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { CrmUnit } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CATALOGUE — what is for sale, and which one they want
 * ----------------------------------------------------------------------------
 * ── ⚠️ A SALESPERSON READS IT AND CANNOT CHANGE IT ─────────────────────────
 * Migration 150 is explicit: they may view the catalogue and may not edit it. A
 * price is the company's, not the seller's. So there is no price field here —
 * only the choice of WHICH unit a lead is asking about, which is the thing they
 * actually learnt on the call.
 *
 * ── ⚠️ SOLD UNITS ARE LISTED, NOT HIDDEN ───────────────────────────────────
 * A salesperson asked "what about B-201?" has to be able to say *that one is
 * gone*. Hiding it makes the catalogue disagree with the board on the wall, and
 * the reader concludes the system is out of date rather than that the plot is
 * sold. They are shown, marked, and not selectable.
 * ========================================================================= */

const money = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;

export function UnitPicker({
  leadId,
  leadName,
  units,
  attachedId,
  onClose,
}: {
  leadId: string;
  leadName: string;
  units: readonly CrmUnit[];
  attachedId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(attachedId);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    const result = await attachUnitAction(leadId, chosen);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    toast({
      tone: 'ok',
      text: chosen
        ? `${units.find((u) => u.id === chosen)?.label ?? 'The unit'} is now on ${leadName}.`
        : `Unit removed from ${leadName}.`,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-black/40" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose a unit for ${leadName}`}
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">Which unit are they asking about?</h2>
            <p className="mt-0.5 truncate text-caption text-text-secondary">
              {leadName} · {units.length} unit{units.length === 1 ? '' : 's'} in this project
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

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {units.length === 0 && (
            <p className="text-caption text-text-secondary">
              This project has no units in the catalogue yet. A manager adds them.
            </p>
          )}

          {units.map((u) => {
            const gone = u.status !== 'available';
            const on = chosen === u.id;
            return (
              <button
                key={u.id}
                type="button"
                /* ⚠️ A SOLD UNIT IS SHOWN AND NOT SELECTABLE. Quoting a plot that
                    is gone is worse than not finding it. */
                disabled={gone && !on}
                onClick={() => setChosen(on ? null : u.id)}
                aria-pressed={on}
                className={cn(
                  'flex w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  on
                    ? 'border-accent-primary bg-[color-mix(in_oklab,var(--accent-primary)_10%,transparent)]'
                    : 'border-border-subtle hover:border-border-default',
                  gone && !on && 'opacity-55',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {on && <Check className="size-4 shrink-0 text-accent-primary" aria-hidden="true" />}
                    <span className="truncate text-body-sm font-semibold text-text-primary">
                      {u.label}
                    </span>
                    {gone && (
                      <span className="shrink-0 rounded-full bg-bg-subtle px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
                        {u.status}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-text-secondary">
                    <span className="font-mono">{u.code}</span>
                    {u.isCorner && <span>Corner</span>}
                    {u.isParkFacing && <span>Park facing</span>}
                    {u.facing && <span>{u.facing} facing</span>}
                    {u.possessionMonths !== null && <span>{u.possessionMonths} mo possession</span>}
                    {/* ⚠️ SAID OUT LOUD WHEN SOMEBODY ELSE IS ON IT. Two
                        salespeople quoting one plot is the same collision the
                        duplicate check prevents on a lead, one step later. */}
                    {u.interested > 0 && (
                      <span className="text-gold-700">
                        {u.interested} lead{u.interested === 1 ? '' : 's'} interested
                      </span>
                    )}
                  </span>

                  {/* The plan, because "4,500,000" and "how do they pay it" are
                      two different questions and a client always asks both. */}
                  {on && u.stages.length > 0 && (
                    <span className="mt-2 block rounded-lg bg-bg-subtle px-2.5 py-2">
                      <span className="block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                        Payment plan
                      </span>
                      <span className="mt-1 block space-y-0.5">
                        {u.stages.map((s, i) => (
                          <span key={i} className="flex justify-between gap-3 text-caption">
                            <span className="min-w-0 truncate text-text-secondary">
                              {s.label}
                              {s.instalments ? ` · ${s.instalments} instalments` : ''}
                            </span>
                            <span className="shrink-0 tabular-nums text-text-primary">
                              {money(s.amount)}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                  )}
                </span>

                {u.basePrice !== null && (
                  <span className="shrink-0 text-body-sm font-semibold tabular-nums text-text-primary">
                    {money(u.basePrice)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
          <span className="text-caption text-text-tertiary">
            Prices are the company&rsquo;s — ask a manager to change one.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[2.4rem] rounded-xl px-3 text-body-sm font-medium text-text-secondary hover:bg-bg-subtle"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={cn(
                'min-h-[2.4rem] rounded-xl bg-accent-primary px-4 text-body-sm font-medium text-white transition-opacity',
                busy && 'opacity-40',
              )}
            >
              {busy ? 'Saving…' : chosen ? 'Attach this unit' : 'Remove the unit'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
