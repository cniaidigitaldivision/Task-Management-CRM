'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { ProjectDialog } from '@/components/project/project-dialog';
import { TaskDialog } from '@/components/task/task-dialog';
import { InviteDialog } from '@/components/team/invite-dialog';
import { APP_NAME, ROLE_LABEL, type Role, type Theme } from '@/lib/domain/constants';
import { assignableRolesFor } from '@/lib/domain/permissions';
import type { NotificationRow } from '@/lib/db/queries/types';
import { cn } from '@/lib/utils';
import { ToastProvider } from '@/components/ui/toast';
import { LiveRefresh } from '@/components/layout/live-refresh';

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
  return EXTRA_TITLES[pathname] ?? { title: APP_NAME };
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
  '/monthly-report': null,
  '/settings': null,
  '/security': null,
  '/vault': null,
  '/documents': null,
  /* Nothing to create: attendance is recorded by the top bar's button, and a
     "New attendance" button would imply somebody types these by hand. */
  '/attendance': null,
  /* The thing this page makes is a QUESTION, and the box for it is the whole
     screen. A "New conversation" button in the top bar would duplicate the
     control the page opens on. */
  '/assistant': null,
  /* Nothing to create from the top bar. The thing this page makes is a CHAIN,
     and its own "Create" sits beside the name and type it needs — a generic
     button up here could not supply either. */
  '/workflow': null,
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
  checkInButton,
  launcher,
  children,
}: {
  user: ShellUser;
  notifications: readonly NotificationRow[];
  unreadCount: number;
  projects: readonly ShellProject[];
  people: readonly ShellPerson[];
  /** The running-timer chips, rendered by the layout. See Topbar. */
  timerBar?: React.ReactNode;
  /** The attendance pill, rendered by the layout. See Topbar. */
  checkInButton?: React.ReactNode;
  /**
   * A viewport-anchored control the layout supplies — today, the assistant
   * launcher.
   *
   * ── ⚠️ WHY THIS IS A PROP AND NOT JUST ANOTHER CHILD ───────────────────────
   * It was a second child at first, and that was wrong twice over:
   *
   *   1. `children` became a two-element array, and React asked for keys on
   *      both — the "Each child in a list should have a unique key" warning
   *      that pointed, confusingly, at Topbar.
   *   2. Worse and quieter: it landed inside `<main class="reveal-children">`,
   *      which animates a transform on every direct child. A transformed
   *      ancestor becomes the containing block for a `fixed` descendant, so a
   *      launcher pinned to the viewport was in fact pinned to `<main>` — close
   *      enough to look right and wrong the moment the page scrolls or the
   *      layout changes.
   *
   * Rendered below as a sibling of the layout column, outside every transform.
   */
  launcher?: React.ReactNode;
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
    /* ── ⚠️ THE NOTICE PROVIDER WRAPS EVERYTHING ─────────────────────────────
       Owner, 2026-09-03: *"I want a light notification to come in from the right
       bottom for some time to indicate that a new project has been created."*

       It has to sit ABOVE the three create dialogs below, because each of them
       unmounts the instant it succeeds — which is exactly when the notice
       appears. A notice owned by the dialog would be destroyed along with it,
       which is why this is a context and not a prop.

       ⚠️ AND THE COMMENT BELOW IS A JSX COMMENT, NOT A BARE ONE. Inside JSX a
       bare block comment is a TEXT CHILD: the first version of this left the
       rail note sitting between the provider and the div, which typechecked
       cleanly and would have printed the whole paragraph at the top of every
       page in the application.

    ── The rail PUSHES the content, it does not cover it ──────────────────
       Owner decision D7. The first version had the rail expand over the page, on
       the reasoning that pushing reflows the layout on mouse-over. The owner
       tried it and was clear: covering the content is worse — hiding part of the
       dashboard to reveal a menu defeats the point of the menu.

       So the content's left padding tracks the rail's width and animates with
       it, at the same 240ms. `--rail` is set here and read below.

       The `has-[aside:hover]` rule that used to widen this on hover is gone —
       see the note on `pinned` above. Width now depends on one thing only. */
    <ToastProvider>
    {/* ⚠️ Renders nothing. It keeps the open page current so a task assigned to
        somebody appears on their board without them refreshing — see the note
        in live-refresh.tsx. Mounted in the shell so it covers every page, and
        inside the provider so a future notice from it has somewhere to go. */}
    <LiveRefresh />
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

      {/* Where the rail toggle has lived, in order: a tab on the rail's outer
          edge overlapping the page (rejected 2026-08-13) → the rail's own brand
          block, where it overlapped the logo by ~9px once collapsed became the
          resting state → the top bar, below. Each move was the owner reporting
          the same complaint about a different surface, and the top bar is the
          first position where nothing can collide with it by construction. */}

      <div className="flex min-h-full flex-col pl-[var(--rail)] transition-[padding-left] duration-[240ms] ease-out">
        <Topbar
          title={title}
          subtitle={subtitle}
          onOpenNav={openNav}
          railOpen={pinned}
          onToggleRail={togglePin}
          /* Null on a page with nothing to create, and the Topbar renders no
             button at all rather than a disabled one — see 6.1. */
          primaryLabel={primary?.label ?? null}
          onPrimary={primary ? () => setCreating(primary.kind) : undefined}
          notifications={notifications}
          unreadCount={unreadCount}
          timerBar={timerBar}
          checkInButton={checkInButton}
        />
        {/* `page-ambience` lays two very faint brand gradients over the content
            surface, so the page is a lit plane rather than a flat slab. It is a
            token-driven utility (styles/tokens.css) so no colour appears here. */}
        {/* `reveal-children` staggers the page's own top-level blocks in on
            arrival. One class here rather than `<Reveal>` in thirteen pages: it
            adds no DOM, so a screen whose top level is a grid keeps its layout,
            and every route gains the motion — including the seven that were
            never part of the redesign. See the note beside the utility. */}
        {/* ── ⚠️ `overflow-x-clip`: THE PAGE NEVER SCROLLS SIDEWAYS ────────────
            Owner, 2026-08-18: *"is it bcz of the 2 bottom scrollers?"* — yes,
            partly, and the second one was the PAGE.

            The Tasks board bleeds full-width with `-mx-4 / sm:-mx-6` and scrolls
            horizontally inside itself, with its own bar hidden because
            FloatingScrollbar draws one at the bottom of the viewport. Nothing
            clipped that bleed, so on a narrow viewport the body overflowed and
            grew a SECOND horizontal bar directly beneath the first. Two bars for
            what looks like one scroller, which is what made the board feel
            unpredictable to drag in.

            `clip`, not `hidden`: `overflow-x: hidden` makes this element a scroll
            container, which breaks `position: sticky` on descendants — the column
            headers and the rail rely on it. `clip` cuts the overflow without
            creating one. */}
        <main
          key={pathname}
          /* ⚠️ `sm:py-7` → `sm:py-4`. Owner, 2026-08-20: *"compact everything in such a
             way that it will show the same view at 100 [zoom]."* Two of the biggest
             single wins on every page are the shell's own top and bottom padding, and 12px
             off each is 24px of content back for one line changed. The horizontal padding
             is untouched — width was never the complaint, and cards need their gutter. */
          className="page-ambience reveal-children flex-1 overflow-x-clip px-4 py-4 sm:px-6 sm:py-4"
        >
          {children}
        </main>
      </div>

      {/* ⚠️ OUTSIDE the layout column, and outside `reveal-children`. See the
          note on the `launcher` prop: anything `fixed` that sits inside a
          transformed ancestor is positioned against that ancestor instead of
          the viewport. */}
      {launcher}

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
        <ProjectDialog
          open
          onClose={() => setCreating(null)}
          people={people}
          /* Owner, 2026-08-19: the monthly fee is Admin-and-above only. The shell's
             "New project" action is already gated to ADMIN_UP by `PRIMARY_ACTIONS`,
             so this can only be an Admin — but it is asked rather than assumed,
             because the two gates are independent and one of them will move. */
          canSeeFinance={ADMIN_UP.includes(user.role)}
        />
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
          /* Pay is Admin+ — the same gate the finance panel uses above, and the
             same one `employee_compensation`'s RLS enforces in the database. */
          canSetPay={ADMIN_UP.includes(user.role)}
        />
      )}
    </div>
    </ToastProvider>
  );
}
