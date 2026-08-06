import type { Metadata } from 'next';

import { LogoHero } from '@/components/brand/logo';
import { ORGANISATION_NAME } from '@/lib/domain/constants';

export const metadata: Metadata = {
  title: { default: 'Sign in', template: '%s · CNI CRM' },
};

/* ============================================================================
 * AUTH LAYOUT — doc 20 §3, doc 16 §3
 * ----------------------------------------------------------------------------
 * Every unauthenticated screen shares this frame: sign-in, activation, forgot
 * password, locked, MFA enrolment.
 *
 * It deliberately does NOT use the app shell. There is no navigation to show
 * before you are signed in, and a rail full of destinations you cannot reach is
 * worse than no rail at all.
 *
 * The mark sits at hero size in its gold aura. This is the one screen where the
 * brand is the whole composition rather than a corner of it — and, practically,
 * it is the screen that tells someone they are on the real CRM rather than a
 * convincing copy of it (threat T-2, doc 16 §1).
 * ========================================================================= */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-bg-base px-4 py-10">
      {/* Ambient brand light. Two soft gradients, no image, no layout cost. */}
      <div aria-hidden="true" className="page-ambience pointer-events-none absolute inset-0" />

      <main className="relative w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <LogoHero width={230} />
          <p className="text-caption text-text-tertiary">{ORGANISATION_NAME}</p>
        </div>

        {children}

        <p className="mt-6 text-center text-micro text-text-tertiary">
          Access is provisioned by an administrator. There is no public sign-up.
        </p>
      </main>
    </div>
  );
}
