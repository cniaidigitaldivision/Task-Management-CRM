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
 * and the same form re-renders showing only the code box.
 *
 * That is deliberate: a separate "enter your code" page would need somewhere to
 * park the half-authenticated state between requests, and every option there is
 * worse — a cookie holding a partial session, or a token in the URL. Keeping it
 * in one request means there is no intermediate state to protect.
 *
 * ── ⚠️ THE CREDENTIALS ARE HELD IN COMPONENT STATE, AND THEY HAD TO BE ───────
 * This comment used to say "the email and password stay in the form", and they
 * did not. Email survived because it was re-rendered with `defaultValue` from
 * the server; the PASSWORD came back as an empty input, because a password field
 * cannot be repopulated from a server round trip and nothing was holding it.
 *
 * So the second stage asked for the password again, next to the code. Owner,
 * 2026-08-23: *"even if he already entered the password he has to enter the
 * password again for the authenticator app code… This is not logical."* He is
 * right, and it is worse than illogical — a person who has just proved the
 * password now types it a second time on a screen that appeared after they were
 * told it was accepted, which is exactly the shape of a phishing prompt.
 *
 * Both fields are now controlled React state. On the code step they are posted
 * as hidden inputs and the visible form is the six digits and nothing else. The
 * values live in one tab's memory for the seconds between the two submits, and
 * are never written anywhere. */

const INITIAL: SignInState = {};

export function LoginForm() {
  const [state, formAction, pending] = React.useActionState(signIn, INITIAL);
  const codeRef = React.useRef<HTMLInputElement>(null);

  /* Controlled, so the pair survives the round trip that reveals the code box.
     Seeded from the server's echo of the email on a retry. */
  const [email, setEmail] = React.useState(state.email ?? '');
  const [password, setPassword] = React.useState('');

  const onCodeStep = Boolean(state.mfaRequired);

  // Move the cursor to the code box the moment it appears, so the second stage
  // does not need a click before typing.
  React.useEffect(() => {
    if (state.mfaRequired) codeRef.current?.focus();
  }, [state.mfaRequired]);

  /* ⚠️ No effect syncing `state.email` back into local state. The server echoes
     the address on a retry, but this component never unmounts between the two
     submits — the local value IS what was posted, so adopting the echo would be
     one render to arrive at the string already held. */

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

      {onCodeStep ? (
        /* ⚠️ Posted, not shown. The person has already given both of these and
           been told they were accepted; asking again is the phishing shape. */
        <>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
        </>
      ) : (
        <>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
        </>
      )}

      {/* ---- Stage two ---- */}
      {onCodeStep && (
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
              {/* Naming the account is what makes the hidden password legible:
                  without it the screen would ask for a code with no indication
                  of whom it is signing in. */}
              {email && (
                <>
                  {' '}
                  Signing in as <span className="font-semibold text-text-primary">{email}</span>.
                </>
              )}
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

      {/* type="submit" is REQUIRED: Button defaults to type="button" (see
          components/ui/button.tsx), so without this the form silently never
          submits — which is exactly what happened here until it was caught in a
          browser. */}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {onCodeStep ? (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        ) : (
          <LogIn className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Checking…' : onCodeStep ? 'Verify and sign in' : 'Sign in'}
      </Button>

      {/* ⚠️ A real link, not a button that clears local state. `state` comes from
          `useActionState` and only the server can change it, so a client-side
          "back" would leave `mfaRequired` true and bounce straight to the code
          box again. Reloading /login is the only honest way out — and it is the
          right one anyway: somebody who typed the wrong address wants a clean
          form, not the old one with the password still in memory. */}
      {onCodeStep && (
        <p className="text-center text-micro text-text-secondary">
          <a href="/login" className="font-semibold text-text-brand hover:underline">
            Use a different account
          </a>
        </p>
      )}
    </form>
  );
}
