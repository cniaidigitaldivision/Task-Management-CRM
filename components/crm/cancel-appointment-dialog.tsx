'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

import { closeAppointmentAction } from '@/app/actions/crm-leads';
import { formatWhen } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CANCEL AN APPOINTMENT — asked, with a reason, before anything is written
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21, after one stray click on "No-show" took a visit out of
 * Needs recording with no way back:
 *
 *   *"'Not shown' is not a scenario or shouldn't be a scenario… There should be
 *   a cancel button with a popup with the confirmation… Done is the reason.
 *   Record them. It's done or it cancels. Put them in the reason to cancel."*
 *
 * So an appointment ends one of two ways: it happened (recorded with a note) or
 * it was cancelled (here, with a reason). "The client did not come" is one of
 * the reasons, not a button of its own.
 *
 * ⚠️ NOTHING IS WRITTEN UNTIL THE SECOND BUTTON. The reason is required — "why
 * did this visit not happen" is the question a manager asks a week later.
 *
 * ⚠️ AND THE CLIENT IS NOT MESSAGED. A reminder still waiting for this
 * appointment is cancelled with it (235), so a called-off visit never produces
 * "a reminder that your visit is tomorrow".
 *
 * ⚠️ PORTALLED TO <body>. A fixed overlay inside a `space-y-*` list becomes its
 * first child and shifts every row under it (CLAUDE.md, layout traps).
 * ========================================================================= */

const REASONS = [
  'The client did not come',
  'The client asked to move it',
  'The client is no longer interested',
  'We had to call it off',
] as const;

export interface CancellableAppointment {
  readonly id: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly kind: string;
  readonly scheduledAt: string;
}

export function CancelAppointmentDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: CancellableAppointment;
  onClose: () => void;
  onCancelled: (id: string) => void;
}) {
  const toast = useToast();
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const what = appointmentKindLabel(appointment.kind).toLowerCase();
  const who = appointment.leadName ?? 'this lead';

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  const confirm = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    const result = await closeAppointmentAction(appointment.id, appointment.leadId, 'cancelled', reason.trim());
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    toast({ tone: 'ok', text: `Cancelled — ${who} was not messaged.` });
    onCancelled(appointment.id);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Keep it" onClick={() => !busy && onClose()} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cancel the ${what} with ${who}`}
        className="relative w-full max-w-md rounded-2xl border border-border-subtle bg-bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-feedback-error/10">
            <AlertTriangle className="size-4 text-feedback-error" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">
              Cancel the {what} with {who}?
            </h2>
            <p className="mt-0.5 text-caption text-text-secondary">{formatWhen(appointment.scheduledAt)}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !busy && onClose()}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-4 text-caption font-medium text-text-secondary">Why? (required)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={cn(
                'rounded-full border px-2.5 py-1 text-caption font-medium transition-colors',
                reason === r
                  ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                  : 'border-border-default text-text-secondary hover:text-text-primary',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Or write it in your own words."
          className="mt-2 w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
        <p className="mt-1 text-caption text-text-secondary">
          The client is not messaged, and any reminder still waiting for this {what} is cancelled.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => void confirm()}
            className="rounded-xl bg-feedback-error px-3.5 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Cancelling…' : `Cancel the ${what}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
