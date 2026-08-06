'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, KeyRound, Printer, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { minLengthFor } from '@/lib/domain/password-policy';

import { completeSetup, type SetupState } from './actions';

const INITIAL: SetupState = {};

export function SetupForm() {
  const [state, formAction, pending] = React.useActionState(completeSetup, INITIAL);

  /* ---- Success: the recovery codes, shown exactly once ------------------ */
  if (state.recoveryCodes) {
    return (
      <div className="space-y-5">
        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
          }}
        >
          <ShieldCheck
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-success)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">Your account is ready.</span> Setup is
            now permanently closed.
          </p>
        </div>

        <div>
          <h2 className="text-h3 text-text-primary">Your ten recovery codes</h2>
          <p className="mt-1 text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">
              This is the only time these are ever shown.
            </span>{' '}
            Only their hashes are stored, so nobody — including this system — can show them to you
            again. Print them and keep them somewhere physical, not on the device you sign in with.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-2">
          {state.recoveryCodes.map((code) => (
            <li
              key={code}
              className="tabular rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2 text-center font-mono text-body-sm font-semibold tracking-wider text-text-primary"
            >
              {code}
            </li>
          ))}
        </ul>

        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor: 'var(--bg-gold-subtle)',
            border: '1px solid color-mix(in oklab, var(--accent-gold) 30%, transparent)',
          }}
        >
          <AlertTriangle
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--accent-gold)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-micro text-text-secondary">
            Each code works once. They are what get you back in if you lose both your password and
            your phone — the Super Admin cannot be reset by anybody else, which is the point of the
            role and also the risk it creates.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Print these codes
          </Button>
          <Link
            href="/login"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[image:var(--gradient-brand)] px-3.5 text-body-sm font-semibold text-text-on-brand shadow-[var(--shadow-brand-glow)] focus-visible:outline-none"
          >
            I have saved them — sign in
          </Link>
        </div>
      </div>
    );
  }

  /* ---- The form -------------------------------------------------------- */
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
          <p
            className="text-caption font-semibold"
            style={{ color: 'color-mix(in oklab, var(--feedback-error) 76%, var(--text-primary))' }}
          >
            {state.error}
          </p>
          {state.failures && state.failures.length > 0 && (
            <ul className="list-disc space-y-1 pl-4">
              {state.failures.map((f) => (
                <li key={f} className="text-micro text-text-secondary">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Field label="Your full name" htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={state.fullName ?? ''} required />
      </Field>

      <Field label="Your email" htmlFor="email" hint="This becomes the Super Admin sign-in address.">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          defaultValue={state.email ?? ''}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={`At least ${minLengthFor('super_admin')} characters. A phrase of four unrelated words is easier to remember and far harder to guess than a mangled word.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <Field label="Confirm password" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <Button variant="primary" size="lg" className="w-full" disabled={pending}>
        <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        {pending ? 'Creating your account…' : 'Create the Super Admin account'}
      </Button>
    </form>
  );
}
