'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, KeyRound, LogIn, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

import { signIn, type SignInState } from './actions';

/* ============================================================================
 * SIGN-IN FORM
 * ----------------------------------------------------------------------------
 * The only client component in the auth flow. It holds no rules — every
 * decision is made by the server action, and this renders whatever came back.
 *
 * ── THE TWO-STAGE SHAPE ──────────────────────────────────────────────────────
 * When MFA is required the action returns `mfaRequired` rather than redirecting,
 * and the same form re-renders with the code field revealed. The email and
 * password stay in the form and are resubmitted with the code.
 *
 * That is deliberate: a separate "enter your code" page would need somewhere to
 * park the half-authenticated state between requests, and every option there is
 * worse — a cookie holding a partial session, or a token in the URL. Keeping it
 * in one request means there is no intermediate state to protect.
 * ========================================================================= */

const INITIAL: SignInState = {};

export function LoginForm() {
  const [state, formAction, pending] = React.useActionState(signIn, INITIAL);
  const codeRef = React.useRef<HTMLInputElement>(null);

  // Move the cursor to the code box the moment it appears, so the second stage
  // does not need a click before typing.
  React.useEffect(() => {
    if (state.mfaRequired) codeRef.current?.focus();
  }, [state.mfaRequired]);

  return (
    <form action={formAction} className="space-y-4">
      {/* ---- Errors ---- */}
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
          <div className="space-y-1">
            <p
              className="text-caption font-semibold"
              style={{ color: 'color-mix(in oklab, var(--feedback-error) 76%, var(--text-primary))' }}
            >
              {state.error}
            </p>
            {state.locked && (
              <p className="text-micro text-text-secondary">
                {state.unlockInMinutes
                  ? `It unlocks on its own in ${state.unlockInMinutes} minute${state.unlockInMinutes === 1 ? '' : 's'}, or you can unlock it now by email.`
                  : 'You can unlock it now by email.'}{' '}
                <Link href="/forgot-password" className="font-semibold text-text-brand hover:underline">
                  Send an unlock code
                </Link>
              </p>
            )}
          </div>
        </div>
      )}

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@company.com"
          defaultValue={state.email ?? ''}
          readOnly={state.mfaRequired}
          required
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          // doc 16 §5 — long passphrases allowed, paste allowed, no maxLength.
          autoComplete="current-password"
          placeholder="Your password"
          required
        />
      </Field>

      {/* ---- Stage two ---- */}
      {state.mfaRequired && (
        <div
          className="space-y-3 rounded-lg border px-3 py-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--accent-primary) 30%, transparent)',
            backgroundColor: 'var(--bg-brand-subtle)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <ShieldCheck
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--accent-primary)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-micro text-text-secondary">
              <span className="font-semibold text-text-primary">One more step.</span> Enter the
              six-digit code from your authenticator app.
            </p>
          </div>

          <Field label="Authenticator code" htmlFor="totp">
            <Input
              ref={codeRef}
              id="totp"
              name="totp"
              // `one-time-code` lets iOS and Android offer the code from the
              // notification, which is the difference between one tap and
              // switching apps to read six digits.
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              className="tabular text-center text-body tracking-[0.4em]"
              required
            />
          </Field>
        </div>
      )}

      <Button variant="primary" size="lg" className="w-full" disabled={pending}>
        {state.mfaRequired ? (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        ) : (
          <LogIn className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Checking…' : state.mfaRequired ? 'Verify and sign in' : 'Sign in'}
      </Button>
    </form>
  );
}
