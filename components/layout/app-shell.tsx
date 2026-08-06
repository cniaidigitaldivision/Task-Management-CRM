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
    /* ── The rail PUSHES the content, it does not cover it ──────────────────
       Owner decision, Session 09. My first attempt had the rail expand over the
       page, on the reasoning that pushing reflows the layout on mouse-over. The
       owner tried it and was clear: covering the content is worse. Hiding part
       of the dashboard to reveal a menu defeats the point of the menu.

       So the content's left padding tracks the rail's width and animates with
       it, at the same 240ms — the page narrows and re-centres rather than
       disappearing under a panel.

       `--rail` is set here and read by the content below. `has-[aside:hover]`
       is what lets a SIBLING react to the rail being hovered; `group-hover`
       cannot do it, because hovering anywhere in the shell would trigger it. */
    <div
      className={
        'min-h-full bg-bg-base [--rail:0px] lg:[--rail:var(--sidebar-width-collapsed)] ' +
        'lg:has-[aside:hover]:[--rail:var(--sidebar-width)]'
      }
    >
      <Sidebar role={role} userName={userName} open={navOpen} onClose={closeNav} />

      <div className="flex min-h-full flex-col pl-[var(--rail)] transition-[padding-left] duration-[240ms] ease-out">
        <Topbar title={title} subtitle={subtitle} onOpenNav={openNav} />
        {/* `page-ambience` lays two very faint brand gradients over the content
            surface, so the page is a lit plane rather than a flat slab. It is a
            token-driven utility (styles/tokens.css) so no colour appears here. */}
        <main className="page-ambience flex-1 px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>
    </div>
  );
}
