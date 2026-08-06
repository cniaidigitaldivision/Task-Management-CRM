import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { LogoGlow } from '@/components/brand/logo';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { PageHeader } from '@/components/ui/page-header';
import type { Role } from '@/lib/domain/constants';

/* ============================================================================
 * PHASE PLACEHOLDER
 * ----------------------------------------------------------------------------
 * Every navigation destination resolves to a real page from day one. A nav item
 * that 404s makes an application feel broken; one that explains what is coming,
 * when, and where it is specified reads as deliberate.
 *
 * Each of these is replaced by the real screen in the phase named on it.
 *
 * The logo appears once, large and glowing, behind the icon — the same gold aura
 * the rail uses, so an unfinished page still looks like part of the product
 * rather than a stub.
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
      <div className="mx-auto max-w-[var(--content-max)] space-y-6">
        <PageHeader eyebrow={phase} title={title} description={summary} />

        <div className="grid gap-4 lg:grid-cols-5">
          {/* ---- Brand panel ---- */}
          <Card className="overflow-hidden lg:col-span-2">
            <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-6 px-6 py-10">
              {/* The artwork at low opacity, never altered, never cropped */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.06]"
              >
                <LogoGlow width={460} size="lg" decorative />
              </span>

              <IconTile icon={Icon} token="accent-primary" size="xl" className="relative" />

              <div className="relative text-center">
                <p className="text-body font-semibold text-text-primary">{title}</p>
                <p className="mt-1 text-caption text-text-tertiary">
                  Specified in <span className="font-mono">{docRef}</span>
                </p>
              </div>
            </div>
          </Card>

          {/* ---- What lands here ---- */}
          <Card className="lg:col-span-3">
            <CardBody className="space-y-4">
              <div>
                <p className="text-micro font-semibold tracking-[0.08em] text-text-tertiary uppercase">
                  What lands on this screen
                </p>
                <p className="mt-1.5 text-caption text-text-secondary">
                  Already designed and specified — this is the build queue, not a wish list.
                </p>
              </div>

              <ul className="grid gap-2 sm:grid-cols-2">
                {features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{
                        backgroundColor:
                          'color-mix(in oklab, var(--accent-gold) var(--tint-strong), var(--bg-surface))',
                        color: 'var(--text-gold)',
                      }}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    <span className="text-caption text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-4">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-text-brand hover:underline focus-visible:outline-none"
                >
                  Back to dashboard
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                </Link>
                <Link
                  href="/design-system"
                  className="text-body-sm text-text-secondary hover:text-text-primary focus-visible:outline-none"
                >
                  Design system
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
