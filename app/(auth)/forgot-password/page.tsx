import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Mail, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

export const metadata: Metadata = {
  title: 'Forgot password',
};

/* ============================================================================
 * FORGOT PASSWORD — FR-155, FR-155a, FR-155e, ADR-007, doc 16 §6
 * ----------------------------------------------------------------------------
 * Also the unlock path: a locked account is recovered through this same form,
 * because from the user's side "I can't get in" is one problem, not two
 * (registry C-17 gave the unlock its own token purpose behind the scenes).
 *
 * ── THE ONE RULE THIS SCREEN EXISTS TO ENFORCE ───────────────────────────────
 * FR-155e: the response is ALWAYS "if that email is registered, a code has been
 * sent" — identical whether or not the account exists, and returned in constant
 * time.
 *
 * A screen that says "no account with that email" is an account-enumeration
 * oracle: an attacker learns which of your seven people are real before
 * guessing a single password. It feels helpful and it is the single most common
 * way a recovery flow leaks its user list.
 *
 * The constant-time part is the server's job (Step 4 part 2) and is easy to get
 * wrong: returning early for an unknown address is measurably faster than
 * hashing a token for a known one, and that difference alone rebuilds the
 * oracle. The work happens either way.
 * ========================================================================= */

export default function ForgotPasswordPage() {
  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-h2 text-text-primary">Reset your password</h1>
          <p className="text-caption text-text-secondary">
            Enter your email and we will send a {SYSTEM_DEFAULTS.recoveryCodeTtlMinutes}-minute
            one-time code. This also unlocks an account that has been locked out.
          </p>
        </div>

        <form className="space-y-4" action="/forgot-password" method="post">
          <Field
            label="Email"
            htmlFor="email"
            hint="The address your account was created with."
          >
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

          <Button variant="primary" size="lg" className="w-full" disabled>
            <Mail className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            Send me a code
          </Button>
        </form>

        {/* The response the server will always give — shown here so the copy is
            reviewed as part of the design rather than written in a hurry later. */}
        <div className="rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5">
          <p className="text-micro text-text-secondary">
            <span className="font-semibold text-text-primary">
              Whatever you enter, the answer is the same:
            </span>{' '}
            “If that email is registered, a code has been sent.” We never confirm whether an
            account exists — that would tell an attacker who works here.
          </p>
        </div>

        {/* Super Admin and Admin need MFA after the code — FR-155b, SA-3. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-border-subtle px-3 py-2.5">
          <ShieldAlert
            className="mt-px h-4 w-4 shrink-0 text-text-tertiary"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-micro text-text-secondary">
            Administrators are asked for their authenticator code after the emailed one. A
            compromised mailbox alone must not be enough to take the account.
          </p>
        </div>

        <div className="border-t border-border-subtle pt-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
            Back to sign in
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
