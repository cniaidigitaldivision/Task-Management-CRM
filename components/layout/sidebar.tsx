'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';

import { LogoSidebar } from '@/components/brand/logo';
import { Avatar } from '@/components/ui/avatar';
import { CountBadge } from '@/components/ui/badge';
import { ROLE_LABEL, type Role } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

import { sectionsForRole } from './nav-config';

/* ============================================================================
 * SIDEBAR
 * ----------------------------------------------------------------------------
 * The brand's strongest presence in the interface. Deep teal in dark theme,
 * clean white with a teal-tinted page beside it in light theme.
 *
 * The logo sits on a light plate (see components/brand/logo.tsx) because its
 * wordmark is dark teal and would vanish against the dark rail. The plate
 * adapts; the artwork never does.
 * ========================================================================= */

const BADGE_COUNTS: Record<string, { count: number; tone: 'neutral' | 'alert' }> = {
  myTasks: { count: 7, tone: 'neutral' },
  review: { count: 3, tone: 'neutral' },
  overdue: { count: 4, tone: 'alert' },
};

export function Sidebar({
  role,
  userName,
  open,
  onClose,
}: {
  role: Role;
  userName: string;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const sections = sectionsForRole(role);

  return (
    <>
      {/* Mobile scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-[var(--bg-scrim)] backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-width)] flex-col',
          'border-r transition-transform duration-200 ease-out',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border)',
        }}
      >
        {/* ---- Brand ---- */}
        <div
          className="flex items-center justify-between gap-2 border-b px-4 py-4"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <Link href="/dashboard" className="rounded-xl focus-visible:outline-none">
            <LogoSidebar />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-[var(--sidebar-item)] hover:bg-[var(--sidebar-item-hover-bg)] lg:hidden"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* ---- Navigation ---- */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {sections.map((section, index) => (
            <div key={section.label ?? `section-${index}`} className="space-y-1">
              {section.label && (
                <p
                  className="px-3 pb-1 text-micro font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'var(--sidebar-section-label)' }}
                >
                  {section.label}
                </p>
              )}

              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = item.badgeKey ? BADGE_COUNTS[item.badgeKey] : undefined;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2',
                      'text-body-sm font-medium transition-colors duration-[120ms]',
                      'focus-visible:outline-none',
                    )}
                    style={{
                      backgroundColor: isActive ? 'var(--sidebar-item-active-bg)' : undefined,
                      color: isActive
                        ? 'var(--sidebar-item-active-text)'
                        : 'var(--sidebar-item)',
                    }}
                  >
                    {/* Gold rail marks the active item. Chrome, not state —
                        it identifies where you are, it never warns. */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
                        style={{ backgroundColor: 'var(--accent-gold)' }}
                      />
                    )}
                    <Icon
                      className="h-[18px] w-[18px] shrink-0"
                      strokeWidth={isActive ? 2 : 1.75}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge && <CountBadge count={badge.count} tone={badge.tone} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ---- Current user ---- */}
        <div
          className="border-t px-3 py-3"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <Link
            href="/profile"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-[120ms] hover:bg-[var(--sidebar-item-hover-bg)] focus-visible:outline-none"
          >
            <Avatar name={userName} size="md" />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-body-sm font-medium"
                style={{ color: 'var(--sidebar-item-active-text)' }}
              >
                {userName}
              </span>
              <span
                className="block truncate text-micro"
                style={{ color: 'var(--sidebar-section-label)' }}
              >
                {ROLE_LABEL[role]}
              </span>
            </span>
          </Link>
        </div>
      </aside>
    </>
  );
}
