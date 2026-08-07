import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';

import { RequestForm } from './request-form';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = { title: 'Forgot your password' };

export const dynamic = 'force-dynamic';

/* ============================================================================
 * FORGOT PASSWORD — FR-155, ADR-007
 * ----------------------------------------------------------------------------
 * The page says the same thing whatever happens, because the action does. An
 * endpoint that distinguishes "no such account" from "code sent" is a staff
 * directory with a search box (FR-155e), and these are work addresses.
 *
 * It also handles the locked case without asking anybody to diagnose themselves.
 * Three failed sign-ins locks an account, and the person on the other end
 * usually does not know that is what happened — they just know it will not let
 * them in. Same form, and the action decides whether to send an unlock code or a
 * reset code.
 * ========================================================================= */

export default async function ForgotPasswordPage() {
  const settings = await getSettings();
  const ttlMinutes = Number(settings.recoveryCodeTtlMinutes);
  const lockAfter = Number(settings.failedLoginsToLock);
  const lockClearsAfter = Number(settings.accountLockAutoClearMinutes);

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={KeyRound} token="accent-primary" size="xl" />
          <div className="min-w-0">
            <h1 className="text-h2 text-text-primary">Can&rsquo;t get in?</h1>
            <p className="mt-1 text-caption text-text-secondary">
              Give us the address you sign in with and we will send a six-digit code. It lasts{' '}
              {ttlMinutes} minutes.
            </p>
          </div>
        </div>

        <RequestForm ttlMinutes={ttlMinutes} />

        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="text-micro text-text-tertiary">
            <span className="font-semibold text-text-secondary">If your account is locked</span> —
            after {lockAfter} failed attempts — the same form sends an
            unlock code instead, and your password stays as it is. The lock also clears itself after{' '}
            {lockClearsAfter} minutes.
          </p>
          <p className="text-micro text-text-tertiary">
            <span className="font-semibold text-text-secondary">If you have lost your phone</span>{' '}
            and your account needs an authenticator, use one of your printed recovery codes. If
            those are gone too, an Admin can help — unless you are the Super Admin, in which case
            the recovery codes are the only way back, by design.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-block text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
        >
          Back to sign in
        </Link>
      </CardBody>
    </Card>
  );
}
