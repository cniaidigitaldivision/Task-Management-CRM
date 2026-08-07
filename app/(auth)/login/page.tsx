import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardBody } from '@/components/ui/card';

import { LoginForm } from './login-form';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = {
  title: 'Sign in',
};

/* ============================================================================
 * SIGN IN — FR-001, doc 16 §3, §4
 * ----------------------------------------------------------------------------
 * A Server Component wrapping one client form. The form holds no rules; every
 * decision — lockout, constant-time failure, whether MFA is required — is made
 * by the server action in ./actions.ts, which in turn defers to lib/domain/.
 *
 * The whole flow is now live: identity lookup, Argon2id verification, the
 * 3-attempt lockout with its 30-minute auto-clear, TOTP, and a device-bound
 * session with role-scoped lifetimes.
 * ========================================================================= */

export default async function LoginPage() {
  const lockAfter = Number((await getSettings()).failedLoginsToLock);

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-h2 text-text-primary">Sign in</h1>
          <p className="text-caption text-text-secondary">
            Use the email address your administrator set your account up with.
          </p>
        </div>

        <LoginForm />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-subtle pt-4">
          <Link
            href="/forgot-password"
            className="text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            Forgot your password?
          </Link>
          <span className="text-micro text-text-tertiary">
            {lockAfter} failed attempts locks the account
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
