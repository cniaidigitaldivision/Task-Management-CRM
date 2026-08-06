import type { Metadata } from 'next';
import { QrCode, ShieldAlert } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { MFA_REQUIRED_ROLES, ROLE_LABEL } from '@/lib/domain/constants';

export const metadata: Metadata = {
  title: 'Set up two-factor authentication',
};

/* ============================================================================
 * MFA ENROLMENT — FR-145, FR-146, doc 16 §4
 * ----------------------------------------------------------------------------
 * Where sign-in sends a privileged account that has no verified factor yet.
 *
 * The verification half is built and proven: lib/auth/totp.ts is RFC 6238,
 * checked against the specification's own known-answer vectors. What is missing
 * is the enrolment ceremony — showing the QR code, confirming the first code,
 * issuing and forcing the download of ten recovery codes — which belongs with
 * Step 5's provisioning chain (doc 20 §9, 5.3), because activation and enrolment
 * are one flow for a new account rather than two.
 *
 * FR-146 is why this cannot be skipped later: once a Super Admin has a verified
 * factor, nothing can reduce them to zero — enforced by a database trigger
 * (migration 005), not by a check on this screen.
 * ========================================================================= */

export default function MfaSetupPage() {
  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={QrCode} token="accent-primary" size="lg" />
          <div className="space-y-1">
            <h1 className="text-h2 text-text-primary">Two-factor authentication</h1>
            <p className="text-caption text-text-secondary">
              Mandatory for {MFA_REQUIRED_ROLES.map((role) => ROLE_LABEL[role]).join(' and ')}{' '}
              accounts, and it cannot be turned off once enrolled.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border-subtle bg-bg-surface-sunken px-4 py-3.5">
          <p className="text-caption font-semibold text-text-primary">What happens here</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-caption text-text-secondary">
            <li>A QR code appears — scan it with Google Authenticator, Authy or 1Password.</li>
            <li>Enter the first six-digit code to prove the app is set up correctly.</li>
            <li>Ten recovery codes are issued. Print them; they are shown once.</li>
          </ol>
        </div>

        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor: 'var(--bg-gold-subtle)',
            border: '1px solid color-mix(in oklab, var(--accent-gold) 30%, transparent)',
          }}
        >
          <ShieldAlert
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--accent-gold)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-micro text-text-secondary">
            <span className="font-semibold text-text-primary">Enrolment arrives in Step 5.</span>{' '}
            Code <em>verification</em> is already built and proven against RFC 6238&rsquo;s own test
            vectors — what is missing is the QR-and-recovery-codes ceremony, which belongs with the
            activation flow because for a new account they are one journey, not two.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
