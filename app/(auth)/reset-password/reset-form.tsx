'use client';

import * as React from 'react';
import { AlertTriangle, KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import { completeReset, type ResetState } from '../forgot-password/actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

/* ============================================================================
 * USE THE CODE
 * ----------------------------------------------------------------------------
 * ── THE EMAIL IS ASKED FOR, NOT CARRIED IN THE LINK ──────────────────────────
 * The link in the email holds the six-digit code and nothing else. Two reasons:
 * a work address in a URL ends up in browser history, in a referrer header and
 * in anybody's shoulder view, and the code is hashed together with the account
 * it belongs to (see hashScopedCode) — so the address is genuinely needed to
 * verify it, rather than being decoration.
 *
 * The trade is one extra field. Worth it.
 *
 * ── THE SECOND-FACTOR FIELD APPEARS ONLY WHEN THE SERVER ASKS ────────────────
 * Privileged accounts must clear MFA after the emailed code (FR-155b), and the
 * page cannot know the role before the address is known — asking everybody up
 * front would both confuse most people and quietly reveal who is privileged.
 * ========================================================================= */

const EMPTY: ResetState = {};

export function ResetForm({ initialCode }: { initialCode: string }) {
  const [state, formAction, pending] = React.useActionState(completeReset, EMPTY);
  const mfaRef = React.useRef<HTMLInputElement>(null);

  /* When the server comes back asking for the authenticator, put the cursor in
     it. Otherwise the page looks unchanged apart from a field that appeared
     somewhere below the fold. */
  React.useEffect(() => {
    if (state.needsMfa) mfaRef.current?.focus();
  }, [state.needsMfa]);

  return (
    <form action={formAction} className="space-y-4">
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

      <Field label="Your email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          defaultValue={state.email ?? ''}
          required
          autoFocus={!initialCode}
        />
      </Field>

      <Field
        label="The six-digit code"
        htmlFor="code"
        hint={`From the email. It lasts ${SYSTEM_DEFAULTS.recoveryCodeTtlMinutes} minutes and works once.`}
      >
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          defaultValue={state.code ?? initialCode}
          className="tabular text-center font-mono text-h3 tracking-[0.3em]"
          required
          autoFocus={Boolean(initialCode)}
        />
      </Field>

      {state.needsMfa && (
        <div
          className="space-y-3 rounded-lg px-3 py-3"
          style={{
            backgroundColor: 'var(--bg-gold-subtle)',
            border: '1px solid color-mix(in oklab, var(--accent-gold) 30%, transparent)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <ShieldCheck
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--accent-gold)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-micro text-text-secondary">
              Your role needs the authenticator as well as the emailed code. A mailbox on its own
              must not be enough to take over a privileged account (FR-155b).
            </p>
          </div>

          <Field label="Code from your authenticator" htmlFor="totp">
            <Input
              ref={mfaRef}
              id="totp"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="tabular text-center font-mono text-h3 tracking-[0.3em]"
              required
            />
          </Field>
        </div>
      )}

      <div className="border-t border-border-subtle pt-4">
        <Field
          label="New password"
          htmlFor="password"
          hint="Four unrelated words beats a mangled one — easier to remember, far harder to guess."
        >
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
      </div>

      <Field label="Type it again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Checking…' : 'Set my new password'}
      </Button>

      <p className="text-micro text-text-tertiary">
        Changing your password signs you out on every other device (FR-155c). If somebody else had
        got in, this is what removes them.
      </p>
    </form>
  );
}
