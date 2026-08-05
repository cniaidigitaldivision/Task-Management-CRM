import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { Logo } from '@/components/brand/logo';
import { Card } from '@/components/ui/card';
import type { Role } from '@/lib/domain/constants';

/* ============================================================================
 * PHASE PLACEHOLDER
 * ----------------------------------------------------------------------------
 * Every navigation destination resolves to a real page from day one. A nav
 * item that 404s makes an application feel broken; one that explains what is
 * coming and when reads as deliberate.
 *
 * Each of these is replaced by the real screen in the phase named on it.
 * ========================================================================= */

export function PhasePlaceholder({
  icon: Icon,
  title,
  subtitle,
  phase,
  summary,
  features,
  docRef,
  role = 'admin',
  userName = 'Sana Minhas',
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  phase: string;
  summary: string;
  features: readonly string[];
  docRef: string;
  role?: Role;
  userName?: string;
}) {
  return (
    <AppShell role={role} userName={userName} title={title} subtitle={subtitle}>
      <div className="mx-auto max-w-3xl py-8">
        <Card className="overflow-hidden">
          {/* Brand band — the mark at low opacity, never altered, never cropped */}
          <div className="relative flex items-center justify-center overflow-hidden border-b border-border-subtle bg-bg-subtle px-6 py-10">
            <span aria-hidden="true" className="pointer-events-none absolute opacity-[0.07]">
              <Logo width={520} decorative />
            </span>
            <span
              className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border-brand"
              style={{ backgroundColor: 'var(--bg-brand-subtle)' }}
            >
              <Icon
                className="h-7 w-7"
                style={{ color: 'var(--accent-primary)' }}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </span>
          </div>

          <div className="space-y-6 px-6 py-8 text-center">
            <div className="space-y-2">
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-micro font-semibold uppercase tracking-[0.07em]"
                style={{
                  borderColor: 'var(--border-gold)',
                  backgroundColor: 'var(--bg-gold-subtle)',
                  color: 'var(--text-gold)',
                }}
              >
                {phase}
              </span>
              <h2 className="text-h1 text-text-primary">{title}</h2>
              <p className="mx-auto max-w-xl text-body-sm text-text-secondary">{summary}</p>
            </div>

            <ul className="mx-auto grid max-w-lg gap-2 text-left sm:grid-cols-2">
              {features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: 'var(--accent-gold)' }}
                  />
                  <span className="text-caption text-text-secondary">{feature}</span>
                </li>
              ))}
            </ul>

            <p className="text-micro text-text-tertiary">
              Specified in <span className="font-mono">{docRef}</span>
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Link
                href="/dashboard"
                className="text-body-sm font-medium text-text-brand hover:underline focus-visible:outline-none"
              >
                Back to dashboard
              </Link>
              <span aria-hidden="true" className="text-text-disabled">
                ·
              </span>
              <Link
                href="/design-system"
                className="text-body-sm text-text-secondary hover:text-text-primary focus-visible:outline-none"
              >
                Design system
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
