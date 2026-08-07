import type { Metadata } from 'next';
import Link from 'next/link';
import { LinkIcon, UserCheck } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { ROLE_LABEL } from '@/lib/domain/constants';

import { inspectToken } from './actions';
import { ActivateForm } from './activate-form';

export const metadata: Metadata = { title: 'Activate your account' };

/* A token's validity changes the instant it is used or re-issued; a cached page
   would offer a form that can only fail. */
export const dynamic = 'force-dynamic';

/* ============================================================================
 * ACTIVATION — the page an invited person lands on
 * ----------------------------------------------------------------------------
 * ── LOOKING IS NOT USING ─────────────────────────────────────────────────────
 * This renders by *inspecting* the token, never consuming it. Rendering must be
 * repeatable: people refresh, browsers restore tabs, and several mail clients
 * prefetch links to scan them. If arriving here spent the invitation, a scanner
 * could burn it before the human ever clicked.
 *
 * The token is spent in the action, once, when a password is actually set.
 * ========================================================================= */

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const found = await inspectToken(token ?? '');

  if (!found.valid || !found.role) {
    return (
      <Card className="shadow-lg">
        <CardBody className="space-y-4 p-6 text-center">
          <IconTile icon={LinkIcon} token="feedback-warning" size="xl" className="mx-auto" />
          <div className="space-y-1">
            <h1 className="text-h2 text-text-primary">This link is not usable</h1>
            <p className="text-caption text-text-secondary">
              It may have expired, already been used, or been replaced by a newer one. Ask whoever
              invited you to send another — it takes them a few seconds.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-block text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            Go to sign in
          </Link>
        </CardBody>
      </Card>
    );
  }

  const firstName = (found.fullName ?? '').split(' ')[0];

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={UserCheck} token="accent-primary" size="xl" />
          <div className="min-w-0">
            <h1 className="text-h2 text-text-primary">
              Welcome{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-1 text-caption text-text-secondary">
              Your account is set up as{' '}
              <span className="font-semibold text-text-primary">{ROLE_LABEL[found.role]}</span>.
              Choose a password and you are in.
            </p>
            <p className="mt-1 text-micro text-text-tertiary">{found.email}</p>
          </div>
        </div>

        <ActivateForm token={token ?? ''} role={found.role} />
      </CardBody>
    </Card>
  );
}
