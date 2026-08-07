'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { TaskDialog } from '@/components/task/task-dialog';
import type { Role, Theme } from '@/lib/domain/constants';
import type { NotificationRow } from '@/lib/db/queries/types';
import { cn } from '@/lib/utils';

import { NAV_SECTIONS } from './nav-config';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/* ============================================================================
 * THE RAIL PIN
 * ----------------------------------------------------------------------------
 * Its own localStorage key, not folded in with the theme — they are unrelated
 * preferences, and a shared blob means writing either can clobber the other.
 *
 * Read through `useSyncExternalStore` rather than an effect, matching
 * components/brand/theme-provider.tsx. localStorage genuinely IS an external
 * store: it can change in another tab, and reading it in an effect body is the
 * cascading render the compiler lint objects to.
 * ========================================================================= */

const RAIL_PIN_KEY = 'cni-rail-pinned';

const pinListeners = new Set<() => void>();

function subscribePin(onChange: () => void): () => void {
  pinListeners.add(onChange);
  /* Another tab pinning the rail should pin it here too — one person, one
     preference, however many windows they have open. */
  window.addEventListener('storage', onChange);
  return () => {
    pinListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readPin(): boolean {
  try {
    return window.localStorage.getItem(RAIL_PIN_KEY) === 'true';
  } catch {
    /* Private browsing can throw on localStorage. Unpinned is a fine answer. */
    return false;
  }
}

/* The server cannot know it. Unpinned matches the CSS-only default, so the
   first paint is never wrong for somebody who has not chosen. */
const readPinOnServer = (): boolean => false;

function writePin(next: boolean): void {
  try {
    window.localStorage.setItem(RAIL_PIN_KEY, String(next));
  } catch {
    /* Not persisting is survivable. Not toggling would not be. */
  }
  for (const listener of pinListeners) listener();
}

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

  /* The rail expands on hover, which is right for a glance and wrong for
     somebody working down the list — it collapses the moment the pointer
     leaves. The tab pins it open, and the choice is remembered. */
  const pinned = React.useSyncExternalStore(subscribePin, readPin, readPinOnServer);
  const togglePin = React.useCallback(() => writePin(!pinned), [pinned]);
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
      className={cn(
        'min-h-full bg-bg-base [--rail:0px]',
        pinned
          ? 'lg:[--rail:var(--sidebar-width)]'
          : 'lg:[--rail:var(--sidebar-width-collapsed)] lg:has-[aside:hover]:[--rail:var(--sidebar-width)]',
      )}
    >
      <Sidebar
        role={user.role}
        userName={user.name}
        open={navOpen}
        onClose={closeNav}
        pinned={pinned}
      />

      {/* ── The pin tab ────────────────────────────────────────────────────
          It lives HERE and not inside the rail, because the rail is
          `overflow-hidden` — a tab sitting half outside it would simply be
          clipped away.

          `left: var(--rail)` puts its flat edge exactly on the rail's edge and
          means it travels with the rail, on the same 240ms, whether that is a
          hover or a pin. Desktop only: on mobile the rail is a drawer with its
          own close button, and a pin has nothing to pin. */}
      <button
        type="button"
        onClick={togglePin}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin the navigation' : 'Keep the navigation open'}
        title={pinned ? 'Unpin — collapse to icons' : 'Keep open'}
        className={cn(
          'fixed top-1/2 z-[60] hidden -translate-y-1/2 items-center justify-center lg:flex',
          'h-14 w-[22px] rounded-r-full border border-l-0',
          'transition-[left,background-color,color] duration-[240ms] ease-out',
        )}
        style={{
          left: 'var(--rail)',
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border-strong)',
          color: 'var(--sidebar-item)',
          boxShadow: '2px 0 10px -4px rgb(0 0 0 / 0.5)',
        }}
      >
        <ChevronLeft
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-[240ms]',
            !pinned && 'rotate-180',
          )}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </button>

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
