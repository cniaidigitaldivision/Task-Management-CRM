'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { ProjectDialog } from '@/components/project/project-dialog';
import { TaskDialog } from '@/components/task/task-dialog';
import { InviteDialog } from '@/components/team/invite-dialog';
import { ROLE_LABEL, type Role, type Theme } from '@/lib/domain/constants';
import { assignableRolesFor } from '@/lib/domain/permissions';
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
  /** Their uploaded picture, shown in the rail. CHANGE-PLAN 2.3. */
  readonly avatarUrl: string | null;
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

/* ============================================================================
 * THE PRIMARY BUTTON FOLLOWS THE PAGE — CHANGE-PLAN 6.1
 * ----------------------------------------------------------------------------
 * Owner: *"When I'm in projects it should say New Project, not New Task."*
 *
 * ── WHY A TABLE RATHER THAN A CHAIN OF CONDITIONS ────────────────────────────
 * Because the interesting cases are the ones with NO create action. Reports,
 * Workload, Settings and Security have nothing to create, and a button that says
 * "New task" on the Settings screen is worse than no button: it invites somebody
 * to create a task while they are thinking about capacity thresholds, and the
 * task lands in whatever project happens to be first.
 *
 * A table makes "this page has no primary action" a stated fact rather than the
 * absence of a branch, and adding a page forces the question to be answered.
 * ========================================================================= */

type CreateKind = 'task' | 'project' | 'person';

interface PrimaryAction {
  readonly kind: CreateKind;
  readonly label: string;
  /** Roles that may perform it. The dialogs and the server re-check; this only
   *  decides whether offering it would be a dead end. */
  readonly roles: readonly Role[];
}

/* `LEAD_UP` was here for the Dashboard entry. CHANGE-PLAN 7.1 opened that page to
   every role, so nothing needs the Coordinator-and-above set any more. */
const ADMIN_UP: readonly Role[] = ['super_admin', 'admin'];
const EVERYONE: readonly Role[] = ['super_admin', 'admin', 'team_coordinator', 'member'];

const PRIMARY_ACTIONS: Readonly<Record<string, PrimaryAction | null>> = {
  '/dashboard': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/my-work': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/tasks': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/calendar': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/projects': { kind: 'project', label: 'New project', roles: ADMIN_UP },
  '/team': { kind: 'person', label: 'Add member', roles: ADMIN_UP },

  /* Explicitly nothing. Written out rather than left to the fallback so that the
     absence is a decision on the record, not an oversight. */
  '/workload': null,
  '/reports': null,
  '/settings': null,
  '/security': null,
  '/vault': null,
  '/profile': null,
  '/design-system': null,
};

function primaryActionFor(pathname: string, role: Role): PrimaryAction | null {
  /* Longest match first, so `/tasks/CNI-042` inherits `/tasks` rather than
     falling through to the default. */
  const key =
    Object.keys(PRIMARY_ACTIONS)
      .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  if (key === null) return null;
  const action = PRIMARY_ACTIONS[key];
  if (!action) return null;
  return action.roles.includes(role) ? action : null;
}

export function AppShell({
  user,
  notifications,
  unreadCount,
  projects,
  people,
  timerBar,
  children,
}: {
  user: ShellUser;
  notifications: readonly NotificationRow[];
  unreadCount: number;
  projects: readonly ShellProject[];
  people: readonly ShellPerson[];
  /** The running-timer chips, rendered by the layout. See Topbar. */
  timerBar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);

  /* ── THE RAIL OPENS ON A CLICK, NOT ON HOVER ─────────────────────────────
     Owner instruction, Session 17: *"when I hover on the sidebar it opens by
     itself, I don't want that functionality — I want it to open when I click
     the small button beside it."* This reverses owner decision D6 (Session 09),
     which asked for the opposite; D6 is marked as superseded rather than
     deleted, because the reasoning behind it is still the reason the collapsed
     state exists at all.

     The tab was already built for Phase 6 of the redesign. It is now the only
     way to open the rail, so this state is no longer a "pin" on top of hover —
     it IS the open/closed state, and it is still remembered across tabs. */
  const pinned = React.useSyncExternalStore(subscribePin, readPin, readPinOnServer);
  const togglePin = React.useCallback(() => writePin(!pinned), [pinned]);
  /* Which create dialog is open, or none. One piece of state rather than three
     booleans: two create dialogs open at once is not a state that should be
     representable, and three booleans make it representable. */
  const [creating, setCreating] = React.useState<CreateKind | null>(null);
  const pathname = usePathname();
  const { title, subtitle } = titleFor(pathname);
  const primary = primaryActionFor(pathname, user.role);

  /* Read by the keyboard handler, which is bound once.
     Written in an effect rather than during render: a ref assignment in the
     render body runs on every attempt including ones React throws away, so the
     value can end up describing a render that never committed. `react-hooks`
     refuses it, correctly. Syncing after commit is both safe and sufficient — the
     handler only ever reads it in response to a keypress, long after paint. */
  const primaryRef = React.useRef(primary);
  React.useEffect(() => {
    primaryRef.current = primary;
  }, [primary]);

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
      /* N opens whatever THIS page creates, so the shortcut follows the button
         (6.1). On a page with no create action it does nothing, rather than
         opening a task form somebody did not ask for.
         `primaryRef` rather than `primary` in the dependency list: re-binding a
         window listener on every navigation is avoidable work, and a stale
         closure here would silently open the wrong dialog. */
      if (!typing && event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey) {
        const action = primaryRef.current;
        if (!action) return;
        event.preventDefault();
        setCreating(action.kind);
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

       The `has-[aside:hover]` rule that used to widen this on hover is gone —
       see the note on `pinned` above. Width now depends on one thing only. */
    <div
      className={cn(
        'min-h-full bg-bg-base [--rail:0px]',
        pinned ? 'lg:[--rail:var(--sidebar-width)]' : 'lg:[--rail:var(--sidebar-width-collapsed)]',
      )}
    >
      <Sidebar
        role={user.role}
        userName={user.name}
        userAvatarUrl={user.avatarUrl}
        open={navOpen}
        onClose={closeNav}
        pinned={pinned}
      />

      {/* ── The pin tab ────────────────────────────────────────────────────
          It lives HERE and not inside the rail, because the rail is
          `overflow-hidden` — a tab sitting half outside it would simply be
          clipped away.

          `left: var(--rail)` puts its flat edge exactly on the rail's edge and
          means it travels with the rail, on the same 240ms. Desktop only: on
          mobile the rail is a drawer with its own close button.

          Since Session 17 this is the ONLY way to open the rail, so it is sized
          and lit to be found rather than discovered — it is a control now, not
          an affordance on top of hover. */}
      <button
        type="button"
        onClick={togglePin}
        aria-expanded={pinned}
        aria-controls="main-navigation"
        aria-label={pinned ? 'Collapse the navigation' : 'Open the navigation'}
        title={pinned ? 'Collapse to icons' : 'Open the navigation'}
        className={cn(
          'fixed top-1/2 z-[60] hidden -translate-y-1/2 items-center justify-center lg:flex',
          'h-16 w-6 rounded-r-full border border-l-0',
          'transition-[left,background-color,color] duration-[240ms] ease-out',
          'hover:brightness-125 focus-visible:outline-none focus-visible:brightness-125',
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
          /* Null on a page with nothing to create, and the Topbar renders no
             button at all rather than a disabled one — see 6.1. */
          primaryLabel={primary?.label ?? null}
          onPrimary={primary ? () => setCreating(primary.kind) : undefined}
          notifications={notifications}
          unreadCount={unreadCount}
          timerBar={timerBar}
        />
        {/* `page-ambience` lays two very faint brand gradients over the content
            surface, so the page is a lit plane rather than a flat slab. It is a
            token-driven utility (styles/tokens.css) so no colour appears here. */}
        <main className="page-ambience flex-1 px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>

      {/* All three creates live here rather than on their pages, so the topbar
          button and the N shortcut behave identically wherever you are. Each is
          MOUNTED on demand: leaving them mounted with `open` false would keep
          three forms' worth of state alive on every page, and a half-filled form
          would still be there on the way back. */}
      {creating === 'task' && (
        <TaskDialog
          open
          onClose={() => setCreating(null)}
          projects={projects}
          people={people}
          currentUser={{ id: user.id, role: user.role }}
        />
      )}

      {creating === 'project' && (
        <ProjectDialog open onClose={() => setCreating(null)} people={people} />
      )}

      {creating === 'person' && (
        <InviteDialog
          open
          onClose={() => setCreating(null)}
          /* A pure lookup, so it is computed here rather than awaited from a
             server action — see `assignableRolesFor` in lib/domain/permissions.ts.
             The database refuses an out-of-rank insert regardless (FR-141). */
          assignableRoles={assignableRolesFor(user.role)}
          actorRoleLabel={ROLE_LABEL[user.role]}
        />
      )}
    </div>
  );
}
