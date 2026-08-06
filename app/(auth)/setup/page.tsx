import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';

import { isSetupAvailable } from './actions';
import { SetupForm } from './setup-form';

export const metadata: Metadata = {
  title: 'First-run setup',
};

/* Never cached: availability flips permanently the first time setup succeeds,
   and a cached "available" page would offer a form that can only ever fail. */
export const dynamic = 'force-dynamic';

/* ============================================================================
 * FIRST-RUN SETUP — FR-140, ADR-009, doc 20 §9 step 5.1
 * ----------------------------------------------------------------------------
 * ADR-009: the system ships with no team data at all. This route creates the
 * one Super Admin; that account then creates the Admin, who creates everyone
 * else (FR-141). There is no seeded roster and no public sign-up.
 *
 * The route closes itself permanently on success — and structurally, not by a
 * flag: `users_single_super_admin_idx` permits exactly one such row to exist,
 * ever, so a second attempt is refused by the database (BR-028).
 * ========================================================================= */

export default async function SetupPage() {
  const available = await isSetupAvailable();

  if (!available) {
    return (
      <Card className="shadow-lg">
        <CardBody className="space-y-4 p-6 text-center">
          <IconTile icon={Lock} token="accent-primary" size="xl" className="mx-auto" />
          <div className="space-y-1">
            <h1 className="text-h2 text-text-primary">Setup is closed</h1>
            <p className="text-caption text-text-secondary">
              The Super Admin account already exists, so this route has permanently disabled itself.
              A second Super Admin can only be created through the sealed recovery procedure.
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

  return (
    <Card className="shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-h2 text-text-primary">Set up the Super Admin</h1>
          <p className="text-caption text-text-secondary">
            This runs once. The account you create here owns the system, cannot be altered by anyone
            else, and creates the Admin who builds the rest of the team.
          </p>
        </div>

        <SetupForm />
      </CardBody>
    </Card>
  );
}
