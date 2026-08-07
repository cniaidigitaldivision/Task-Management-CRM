import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';

import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Set a new password' };

export const dynamic = 'force-dynamic';

/* ============================================================================
 * RESET — the page the emailed link lands on
 * ----------------------------------------------------------------------------
 * The code arrives in the URL so the link works in one click; the address is
 * typed, because it is genuinely part of verifying the code (the two are hashed
 * together) and because a work address in a URL survives in browser history and
 * referrer headers long after the code has expired.
 *
 * Nothing is looked up here. The page renders the same form whatever the code
 * is, valid or not — checking on render would let anybody enumerate live codes
 * by watching which URLs produce a different page.
 * ========================================================================= */

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const initialCode = /^\d{6}$/.test(code ?? '') ? (code as string) : '';

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={KeyRound} token="accent-primary" size="xl" />
          <div className="min-w-0">
            <h1 className="text-h2 text-text-primary">Set a new password</h1>
            <p className="mt-1 text-caption text-text-secondary">
              Enter the address you sign in with and the code from your email.
            </p>
          </div>
        </div>

        <ResetForm initialCode={initialCode} />

        <Link
          href="/forgot-password"
          className="inline-block border-t border-border-subtle pt-4 text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
        >
          Send me another code
        </Link>
      </CardBody>
    </Card>
  );
}
