'use client';

import * as React from 'react';
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';

import { activateAccount, type ActivationState } from './actions';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { minLengthFor } from '@/lib/domain/password-policy';
import type { Role } from '@/lib/domain/constants';

const EMPTY: ActivationState = {};

export function ActivateForm({ token, role }: { token: string; role: Role }) {
  const [state, formAction, pending] = React.useActionState(activateAccount, EMPTY);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div
          role="alert"
          className="space-y-1.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption font-semibold text-text-primary">{state.error}</p>
          </div>
          {state.failures && state.failures.length > 0 && (
            <ul className="list-disc space-y-1 pl-9">
              {state.failures.map((f) => (
                <li key={f} className="text-micro text-text-secondary">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ⚠️ ONE LINE, AND IT IS THE RULE — owner, 2026-08-23: *"It is stuffed
          with too much text."* The hint used to argue for passphrases, which is
          advice, not the requirement. A field label says what is required and
          stops. */}
      <Field
        label="Choose a password"
        htmlFor="password"
        hint={`At least ${minLengthFor(role)} characters, with a capital, a small letter and a symbol.`}
      >
        <PasswordInput id="password" name="password" autoComplete="new-password" required autoFocus />
      </Field>

      <Field label="Type it again" htmlFor="confirm">
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Setting it up…' : 'Set my password and sign in'}
      </Button>

      {/* Was three sentences explaining one-way hashing to somebody who is
          trying to get into their account. Reassurance, kept to a line. */}
      <p className="text-micro text-text-tertiary">
        Only you will ever know this password — it is never stored in a readable form.
      </p>
    </form>
  );
}
