'use client';

import * as React from 'react';

import type { Role } from '@/lib/domain/constants';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/**
 * Application frame — fixed sidebar on desktop, drawer on mobile.
 *
 * `role` and `userName` are placeholders until the session exists (Phase 1
 * Step 4). The shape is already correct, so wiring the real session is a
 * substitution rather than a rewrite.
 */
export function AppShell({
  role,
  userName,
  title,
  subtitle,
  children,
}: {
  role: Role;
  userName: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);

  const closeNav = React.useCallback(() => setNavOpen(false), []);
  const openNav = React.useCallback(() => setNavOpen(true), []);

  // Escape closes the mobile drawer.
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="min-h-full bg-bg-base">
      <Sidebar role={role} userName={userName} open={navOpen} onClose={closeNav} />

      <div className="flex min-h-full flex-col lg:pl-[var(--sidebar-width)]">
        <Topbar title={title} subtitle={subtitle} onOpenNav={openNav} />
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
