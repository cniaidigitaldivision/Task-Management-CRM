'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';

import { completeStepUp, type StepUpState } from '@/app/actions/step-up';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

/* ============================================================================
 * STEP-UP CHALLENGE — FR-149
 * ----------------------------------------------------------------------------
 * Appears when an action is sensitive enough to want proof that the person at
 * the keyboard is still the account holder, rather than that somebody was an
 * hour ago.
 *
 * ── IT EXPLAINS ITSELF, BECAUSE IT LOOKS LIKE A PHISHING PROMPT ──────────────
 * An application that is already signed in suddenly asking for a password is
 * exactly what a fake overlay does. If people cannot tell the two apart, the
 * good habit — refusing to type a password into an unexpected box — is the one
 * that gets trained out of them. So it names the specific action that triggered
 * it and says why, which a generic overlay cannot convincingly do.
 *
 * ── THE ACTION IS RETRIED, NOT LOST ──────────────────────────────────────────
 * On success the caller's original intent runs. Making somebody re-find the
 * setting they were changing turns a security control into an annoyance, and an
 * annoying control is one people route around.
 * ========================================================================= */

const EMPTY: StepUpState = {};

export function StepUpDialog({
  open,
  onClose,
  onConfirmed,
  actionLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Runs once the challenge is passed — the thing they were trying to do. */
  onConfirmed: () => void;
  /** What triggered this, in plain words. */
  actionLabel: string;
}) {
  const [state, formAction, pending] = React.useActionState(completeStepUp, EMPTY);
  const totpRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state.ok) onConfirmed();
  }, [state.ok, onConfirmed]);

  React.useEffect(() => {
    if (state.needsTotp) totpRef.current?.focus();
  }, [state.needsTotp]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Confirm it is you"
      description={`${actionLabel} — this one asks again even though you are signed in.`}
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="step-up-form" variant="primary" size="md" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            )}
            {pending ? 'Checking…' : 'Confirm'}
          </Button>
        </>
      }
    >
      <form id="step-up-form" action={formAction} className="space-y-4">
        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{state.error}</p>
          </div>
        )}

        <p className="text-caption text-text-secondary">
          A session lasts hours. An unlocked laptop or a tab left open in a shared office presents a
          perfectly valid one — so the things that are hard to undo ask for something only you know.
        </p>

        <Field label="Your password" htmlFor="step-up-password">
          <Input
            id="step-up-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus={!state.needsTotp}
          />
        </Field>

        {state.needsTotp && (
          <Field
            label="Code from your authenticator"
            htmlFor="step-up-totp"
            hint="Your role is asked for both. For a privileged account the password may be the part somebody already has."
          >
            <Input
              ref={totpRef}
              id="step-up-totp"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="tabular text-center font-mono text-h3 tracking-[0.3em]"
              required
            />
          </Field>
        )}

        <p className="text-micro text-text-tertiary">
          Confirming lasts ten minutes on this device only, then it lapses. Failed attempts are
          recorded in the audit trail.
        </p>
      </form>
    </Dialog>
  );
}
