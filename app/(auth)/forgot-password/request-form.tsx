'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, MailCheck, Send } from 'lucide-react';

import { requestReset, type ResetRequestState } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const EMPTY: ResetRequestState = {};

/* The TTL comes in as a prop rather than being imported: it is an editable
   setting now (FR-057), and a Client Component cannot read the database. A
   number printed here that no longer matches what the action enforces is a
   support call. */
export function RequestForm({ ttlMinutes }: { ttlMinutes: number }) {
  const [state, formAction, pending] = React.useActionState(requestReset, EMPTY);

  /* ── The confirmation says nothing the request did not ─────────────────────
     No "we found your account", no "check the inbox for name@company.com" that
     is not the address they typed. The whole point of FR-155e is that this
     screen looks identical whether or not the account exists, and a confirmation
     that leaks it undoes the care taken in the action. */
  if (state.sent) {
    return (
      <div className="space-y-4">
        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
          }}
        >
          <MailCheck
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-success)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">
              If that address belongs to an account, a code is on its way.
            </span>{' '}
            It expires in {ttlMinutes} minutes. Check your spam folder
            if it does not appear.
          </p>
        </div>

        <Link
          href="/reset-password"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[image:var(--gradient-brand)] px-4 text-body font-semibold text-text-on-brand shadow-[var(--shadow-brand-glow)] focus-visible:outline-none"
        >
          I have the code — continue
        </Link>

        <p className="text-micro text-text-tertiary">
          The email also contains a link that takes you straight there.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
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

      <Field label="Your email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          defaultValue={state.email ?? ''}
          placeholder="you@company.com"
          required
          autoFocus
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        )}
        {pending ? 'Sending…' : 'Send me a code'}
      </Button>
    </form>
  );
}
