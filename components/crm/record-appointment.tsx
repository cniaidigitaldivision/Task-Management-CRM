'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, X } from 'lucide-react';

import { closeAppointmentAction } from '@/app/actions/crm-leads';
import { formatWhen } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RECORDING AN APPOINTMENT AS DONE — what happened, and is the client interested
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"when appointment Done auto stage change and auto
 * feedback followup should send — but only client interested then."*
 *
 * So "done" asks one more thing, and it is required: is the client interested?
 * Interested → a feedback message is scheduled (237). Not interested → nothing
 * is sent. Either way the stage moves to Visited, because the visit happened.
 * ========================================================================= */

export function InterestChoice({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const options: ReadonlyArray<[boolean, string]> = [
    [true, 'Client is interested'],
    [false, 'Not interested'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map(([v, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'rounded-full border px-2.5 py-1 text-caption font-medium transition-colors',
            value === v
              ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
              : 'border-border-default text-text-secondary hover:text-text-primary',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** What the next step will be, said before Record is pressed. */
export function interestNote(interested: boolean | null): string {
  if (interested === true) return 'A feedback message will be sent to the client in about two hours.';
  if (interested === false) return 'No feedback message will be sent.';
  return 'Choose one — it decides whether a feedback message goes to the client.';
}

export interface RecordableAppointment {
  readonly id: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly kind: string;
  readonly scheduledAt: string;
}

/** The same questions as a popup — for Today's plan, which has no room inline. */
export function RecordAppointmentDialog({
  appointment,
  onClose,
  onRecorded,
  initialNote = '',
  initialInterested = null,
  editing = false,
}: {
  appointment: RecordableAppointment;
  onClose: () => void;
  onRecorded: (id: string, interested: boolean, note: string) => void;
  /** 241 · "Edit outcome" on a completed appointment opens on what was recorded. */
  initialNote?: string;
  initialInterested?: boolean | null;
  editing?: boolean;
}) {
  const toast = useToast();
  const [note, setNote] = React.useState(initialNote);
  const [interested, setInterested] = React.useState<boolean | null>(initialInterested);
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

  const record = async () => {
    if (!note.trim() || interested === null) return;
    setBusy(true);
    const result = await closeAppointmentAction(appointment.id, appointment.leadId, 'completed', note.trim(), interested);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    toast({
      tone: 'ok',
      text: editing
        ? interested && initialInterested !== true
          ? 'Updated — a feedback message is scheduled.'
          : 'Updated.'
        : interested
          ? 'Recorded — a feedback message is scheduled.'
          : 'Recorded.',
    });
    onRecorded(appointment.id, interested, note.trim());
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={() => !busy && onClose()} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record the ${what} with ${who}`}
        className="relative w-full max-w-md rounded-2xl border border-border-subtle bg-bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-primary/10">
            <CheckCircle2 className="size-4 text-accent-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">
              {editing ? `Edit the outcome of the ${what} with ${who}` : `What happened at the ${what} with ${who}?`}
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

        <textarea
          autoFocus
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="They came with their brother, liked A-101, asked about the payment plan."
          className="mt-4 w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
        <div className="mt-3">
          <InterestChoice value={interested} onChange={setInterested} />
          <p className="mt-1.5 text-caption text-text-secondary">{interestNote(interested)}</p>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy || !note.trim() || interested === null}
            onClick={() => void record()}
            className="rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Saving…' : editing ? 'Save' : 'Record it'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
