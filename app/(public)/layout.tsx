import type { Metadata } from 'next';
import Link from 'next/link';

import { LogoHero } from '@/components/brand/logo';
import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';

/* ============================================================================
 * THE PUBLIC DOCUMENT SHELL — 2026-09-03
 * ----------------------------------------------------------------------------
 * Terms, privacy and data deletion. Created because Meta App Review requires all
 * three as reachable URLs, and three fields on the app's settings page were
 * pointing at facebook.com — which a reviewer reads as a placeholder and refuses.
 *
 * ── ⚠️ THESE PAGES MUST WORK LOGGED OUT ─────────────────────────────────────
 * That is the whole point of them. A Meta reviewer opens each URL in a clean
 * browser with no session, and a redirect to /login is a failed review.
 *
 * This is why they sit in `(public)` rather than anywhere under `(app)`. There is
 * no middleware in this project — authentication is enforced by `requireUser()`
 * and `requireRole()` inside each `(app)` layout — so a route group outside it
 * has no guard by construction. Nothing here may import from `(app)`, and nothing
 * here may call `requireUser()`, or these pages stop being reachable in exactly
 * the way that fails the review.
 *
 * ── ROBOTS: INDEXABLE, UNLIKE THE REST OF THE APPLICATION ────────────────────
 * `app/layout.tsx` sets `robots: { index: false }` for the whole product, which
 * is right for an internal tool. It is wrong for a published policy: these three
 * documents are the public, quotable statement of how the division handles data,
 * and a privacy policy nobody may index is a strange artefact. Overridden here,
 * and only here.
 * ========================================================================= */

export const metadata: Metadata = {
  title: { default: 'Policies', template: `%s · ${APP_NAME}` },
  robots: { index: true, follow: true },
};

const PAGES = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/data-deletion', label: 'Deleting your data' },
] as const;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh/var(--ui-scale))] flex-col bg-bg-surface">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex w-full max-w-[52rem] flex-col items-center gap-3 px-5 py-8 text-center">
          <LogoHero width={190} />
          <p className="text-gold-gradient text-caption font-semibold uppercase tracking-[0.12em]">
            {ORGANISATION_NAME}
          </p>
        </div>
      </header>

      {/* ~68rem would be too wide to read comfortably; this holds running text
          near the 65–75 character measure that long-form prose wants. */}
      <main className="mx-auto w-full max-w-[46rem] flex-1 px-5 py-10">{children}</main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-4 px-5 py-8">
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="text-caption text-text-secondary underline-offset-4 hover:text-text-brand hover:underline"
              >
                {page.label}
              </Link>
            ))}
          </nav>
          <p className="text-center text-micro text-text-tertiary">
            {APP_NAME} is an internal system operated by {ORGANISATION_NAME} —{' '}
            {DIVISION_NAME}. Access is provisioned by an administrator; there is no public
            sign-up.
          </p>
        </div>
      </footer>
    </div>
  );
}
