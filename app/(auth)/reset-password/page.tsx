import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';

import { ResetForm } from './reset-form';
import { markLinkOpened } from '@/lib/db/queries/auth';
import { getSettings } from '@/lib/settings/current';

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
 *
 * ── `?t=` RECORDS THE OPEN, AND CHANGES NOTHING ELSE (CHANGE-PLAN 4.1) ────────
 * A reset an Admin forced carries a `trail_ref` so the Super Admin can see that
 * the link was actually opened. The result of that write is **deliberately
 * ignored**: if the outcome altered the page by so much as a word, this route
 * would become the enumeration oracle the paragraph above exists to prevent.
 * Same markup for a live token, a dead one and a fabricated one.
 *
 * It is a write during a GET, which is usually a smell. Here the request *is*
 * the event being recorded, and `app.auth_mark_link_opened` stamps only the
 * first one, so a reload, a prefetch or a mail client pre-fetching the URL
 * cannot inflate it or move the time.
 * ========================================================================= */

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; t?: string }>;
}) {
  const { code, t } = await searchParams;
  const initialCode = /^\d{6}$/.test(code ?? '') ? (code as string) : '';

  /* Shape-checked before it reaches the database so a junk query string is not a
     query at all. `markLinkOpened` also swallows its own failures — noting an
     open must never be the reason somebody cannot reset their password. */
  if (t && /^[A-Za-z0-9_-]{22,64}$/.test(t)) await markLinkOpened(t);

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

        <ResetForm
          initialCode={initialCode}
          ttlMinutes={Number((await getSettings()).recoveryCodeTtlMinutes)}
        />

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
