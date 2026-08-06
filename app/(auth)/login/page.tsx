import type { Metadata } from 'next';
import Link from 'next/link';
import { LogIn, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

export const metadata: Metadata = {
  title: 'Sign in',
};

/* ============================================================================
 * SIGN IN — FR-001, doc 16 §3, §4
 * ----------------------------------------------------------------------------
 * The form and its states. The server action lands with the query layer in
 * Step 4 part 2 — this cannot authenticate anybody yet, and the notice at the
 * bottom says so rather than letting the button look live.
 *
 * ── WHAT IS ALREADY CORRECT HERE, AND WHY IT MATTERS ─────────────────────────
 *
 * FR-155e — the error copy is generic and identical whether or not the account
 * exists. Every variant of "no account with that email" is free reconnaissance:
 * it turns a password guess into an account enumeration. The only message this
 * screen will ever show for a failure is "Invalid email or password", produced
 * by `failureMessage()` in lib/domain/lockout.ts, which has tests asserting it
 * never names a user, an address, or whether either exists.
 *
 * FR-148 — the second failure warns before the third locks. That warning is
 * also safe to show for an address that was never registered, which is why it
 * is phrased about the attempt rather than about the account.
 *
 * doc 16 §5 — `autoComplete="current-password"` and no `maxLength`. Password
 * managers are a net security gain and blocking paste or truncating input
 * breaks them, so neither happens.
 * ========================================================================= */

export default function LoginPage() {
  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-h2 text-text-primary">Sign in</h1>
          <p className="text-caption text-text-secondary">
            Use the email address your administrator set your account up with.
          </p>
        </div>

        <form className="space-y-4" action="/login" method="post">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@company.com"
              required
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              // Long passphrases must be allowed and paste must work — doc 16 §5.
              autoComplete="current-password"
              placeholder="Your password"
              required
            />
          </Field>

          <Button variant="primary" size="lg" className="w-full" disabled>
            <LogIn className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            Sign in
          </Button>
        </form>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <Link
            href="/forgot-password"
            className="text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            Forgot your password?
          </Link>
          <span className="text-micro text-text-tertiary">
            {SYSTEM_DEFAULTS.failedLoginsToLock} failed attempts locks the account
          </span>
        </div>

        {/* ---- Honest about what this is ---- */}
        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor: 'var(--bg-gold-subtle)',
            border: '1px solid color-mix(in oklab, var(--accent-gold) 30%, transparent)',
          }}
        >
          <ShieldCheck
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--accent-gold)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-micro text-text-secondary">
            <span className="font-semibold text-text-primary">Not wired up yet.</span> The rules
            behind this screen are built and tested — Argon2id, the 3-attempt lockout, device-bound
            sessions — but the query layer arrives with <code>.env.local</code>. Submitting does
            nothing.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
