'use client';

import * as React from 'react';
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';

import { activateAccount, type ActivationState } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
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

      <Field
        label="Choose a password"
        htmlFor="password"
        hint={`At least ${minLengthFor(role)} characters. Four unrelated words is easier to remember and far harder to guess than a mangled one.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
        />
      </Field>

      <Field label="Type it again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Setting it up…' : 'Set my password and sign in'}
      </Button>

      <p className="text-micro text-text-tertiary">
        Nobody sent you a password and nobody has one. This is the only moment it is set, and only
        you will know it — the system stores a one-way fingerprint it cannot reverse.
      </p>
    </form>
  );
}
