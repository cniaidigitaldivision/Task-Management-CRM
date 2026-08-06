import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, Smartphone } from 'lucide-react';

import { beginMfaEnrolment, mfaStatus } from '@/app/actions/mfa';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { requireUser } from '@/lib/auth/current-user';
import { MFA_REQUIRED_ROLES, ROLE_LABEL } from '@/lib/domain/constants';

import { EnrolForm } from './enrol-form';

export const metadata: Metadata = { title: 'Set up two-factor authentication' };

/* Never cached. A new secret on every visit, and the answer to "is a factor
   already enrolled" changes the moment one is. */
export const dynamic = 'force-dynamic';

/* ============================================================================
 * TWO-FACTOR ENROLMENT — FR-145, FR-146, doc 16 §4
 * ----------------------------------------------------------------------------
 * This page was a placeholder describing a ceremony that did not exist, which
 * turned mandatory MFA into a dead end: the sign-in issues a session, redirects
 * a privileged account here to enrol, and here offered nothing to enrol with.
 * The owner ran the first-run setup, was sent here, and could not get into their
 * own system. It is the clearest reminder in this project that a screen which
 * *explains* a feature is not the feature.
 *
 * ── WHY THE SESSION EXISTS BEFORE THE SECOND FACTOR DOES ─────────────────────
 * Looks wrong at first glance and is not: there is no way to enrol without being
 * signed in, so the sign-in issues a session and sends the account straight here.
 * The password was still required to get this far. What that session must NOT do
 * is reach the rest of the application — closing that is the remaining piece,
 * noted at the foot of this file.
 * ========================================================================= */

export default async function MfaSetupPage() {
  const user = await requireUser();
  const status = await mfaStatus();

  /* Already enrolled and not asking to add another: there is nothing to do here,
     and leaving somebody on an enrolment screen they have finished is a dead end
     of a different kind. */
  if (status.hasVerifiedFactor) {
    redirect(user.role === 'member' ? '/my-work' : '/dashboard');
  }

  const enrolment = await beginMfaEnrolment();
  const mandatory = MFA_REQUIRED_ROLES.includes(user.role);

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={Smartphone} token="accent-primary" size="xl" />
          <div className="min-w-0">
            <h1 className="text-h2 text-text-primary">Set up two-factor authentication</h1>
            <p className="mt-1 text-caption text-text-secondary">
              {mandatory ? (
                <>
                  Required for {ROLE_LABEL[user.role]} accounts, and it cannot be switched off once
                  enrolled. A stolen password on its own then gets nobody in.
                </>
              ) : (
                <>
                  Optional for your role, and worth the two minutes. A stolen password on its own
                  then gets nobody in.
                </>
              )}
            </p>
            <p className="mt-1 text-micro text-text-tertiary">
              Enrolling for <span className="font-semibold text-text-secondary">{user.email}</span>
            </p>
          </div>
        </div>

        {user.role === 'super_admin' && (
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
              <span className="font-semibold text-text-primary">
                You are the owner of this system.
              </span>{' '}
              Nobody can reset your account for you, and once this factor is enrolled nobody can
              remove it — enforced by the database, not by hiding a button. Your recovery codes are
              the only way back in if the phone is lost, so keep them somewhere physical.
            </p>
          </div>
        )}

        <EnrolForm enrolment={enrolment} />

        {!mandatory && (
          <Link
            href="/my-work"
            className="inline-block text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            Skip for now
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

/* ============================================================================
 * HOW FR-145 IS ACTUALLY ENFORCED
 * ----------------------------------------------------------------------------
 * The sign-in redirects an unenrolled privileged account here, but a redirect is
 * only a suggestion — typing /dashboard walked straight past it, and "signed in
 * only as far as the enrolment screen" was a convention rather than a control.
 *
 * `requireEnrolledUser()` closes it, called by app/(app)/layout.tsx: any account
 * whose role mandates a factor and has none is sent back here from the boundary
 * itself. That check cannot live in `requireUser()`, because this page calls that
 * too and would redirect to itself forever.
 * ========================================================================= */
