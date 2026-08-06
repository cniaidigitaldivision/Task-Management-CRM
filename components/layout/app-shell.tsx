'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { TaskDialog } from '@/components/task/task-dialog';
import type { Role, Theme } from '@/lib/domain/constants';
import type { NotificationRow } from '@/lib/db/queries/types';

import { NAV_SECTIONS } from './nav-config';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export interface ShellUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly roleTitle: string | null;
  readonly theme: Theme;
}

export interface ShellProject {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly code: string;
}

export interface ShellPerson {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string | null;
}

/* ============================================================================
 * APPLICATION FRAME
 * ----------------------------------------------------------------------------
 * Rendered once by app/(app)/layout.tsx, not by each page. That change removed
 * the same three props being threaded through eleven files, and means a page
 * added tomorrow gets the rail, the top bar, the create dialog and the auth
 * guard without doing anything.
 *
 * The title comes from the route rather than from a prop, for the same reason:
 * the sidebar already knows what each destination is called, so a page passing
 * its own title was a second place for the same string to live — and the two
 * drifted apart on three screens before this was consolidated.
 * ========================================================================= */

const EXTRA_TITLES: Record<string, { title: string; subtitle?: string }> = {
  '/profile': { title: 'Your profile', subtitle: 'Details, appearance and security' },
  '/design-system': { title: 'Design system' },
};

function titleFor(pathname: string): { title: string; subtitle?: string } {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return { title: item.label, subtitle: section.label ?? undefined };
      }
    }
  }
  return EXTRA_TITLES[pathname] ?? { title: 'CNI CRM' };
}

export function AppShell({
  user,
  notifications,
  unreadCount,
  projects,
  people,
  children,
}: {
  user: ShellUser;
  notifications: readonly NotificationRow[];
  unreadCount: number;
  projects: readonly ShellProject[];
  people: readonly ShellPerson[];
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const pathname = usePathname();
  const { title, subtitle } = titleFor(pathname);

  const closeNav = React.useCallback(() => setNavOpen(false), []);
  const openNav = React.useCallback(() => setNavOpen(true), []);

  // Escape closes the mobile drawer. The dialogs handle their own Escape.
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  /* ⌘K / Ctrl+K focuses search, and N opens the create dialog — but only when
     the person is not already typing, or "n" would be impossible to type into
     any field on the page. */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        return;
      }
      if (!typing && event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setCreateOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    /* ── The rail PUSHES the content, it does not cover it ──────────────────
       Owner decision D7. The first version had the rail expand over the page, on
       the reasoning that pushing reflows the layout on mouse-over. The owner
       tried it and was clear: covering the content is worse — hiding part of the
       dashboard to reveal a menu defeats the point of the menu.

       So the content's left padding tracks the rail's width and animates with
       it, at the same 240ms. `--rail` is set here and read below.
       `has-[aside:hover]` is what lets a SIBLING react to the rail being
       hovered; `group-hover` cannot, because hovering anywhere in the shell
       would trigger it. */
    <div
      className={
        'min-h-full bg-bg-base [--rail:0px] lg:[--rail:var(--sidebar-width-collapsed)] ' +
        'lg:has-[aside:hover]:[--rail:var(--sidebar-width)]'
      }
    >
      <Sidebar role={user.role} userName={user.name} open={navOpen} onClose={closeNav} />

      <div className="flex min-h-full flex-col pl-[var(--rail)] transition-[padding-left] duration-[240ms] ease-out">
        <Topbar
          title={title}
          subtitle={subtitle}
          onOpenNav={openNav}
          onNewTask={() => setCreateOpen(true)}
          notifications={notifications}
          unreadCount={unreadCount}
        />
        {/* `page-ambience` lays two very faint brand gradients over the content
            surface, so the page is a lit plane rather than a flat slab. It is a
            token-driven utility (styles/tokens.css) so no colour appears here. */}
        <main className="page-ambience flex-1 px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>

      <TaskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={projects}
        people={people}
        currentUser={{ id: user.id, role: user.role }}
      />
    </div>
  );
}
