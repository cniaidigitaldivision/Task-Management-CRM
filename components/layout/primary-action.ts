import { ROLES, type Role } from '@/lib/domain/constants';

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

export type CreateKind = 'task' | 'project' | 'person';

export interface PrimaryAction {
  readonly kind: CreateKind;
  readonly label: string;
  /** Roles that may perform it. The dialogs and the server re-check; this only
   *  decides whether offering it would be a dead end. */
  readonly roles: readonly Role[];
}

/* `LEAD_UP` was here for the Dashboard entry. CHANGE-PLAN 7.1 opened that page to
   every role, so nothing needs the Coordinator-and-above set any more. */
const ADMIN_UP: readonly Role[] = ['super_admin', 'admin'];
/* ⚠️ EVERYONE MEANS EVERY ROLE, so it is READ OFF `ROLES` rather than typed
   out. It was a literal list of four until 2026-09-26, and the Executive — added
   the day before — was simply missing from it: the Tasks page opened for them,
   the matrix let them create and assign work, and the top bar still offered no
   button. Nothing failed; the control was just absent.

   A hand-written "everyone" is a list that goes stale the next time somebody
   adds a role, and nothing in the type system notices. This one cannot. Pages
   that a role may not reach are unaffected — /my-work and /calendar bounce an
   Executive in their layouts, so a button they never see costs nothing. */
const EVERYONE: readonly Role[] = ROLES;

export const PRIMARY_ACTIONS: Readonly<Record<string, PrimaryAction | null>> = {
  '/dashboard': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/my-work': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/tasks': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/calendar': { kind: 'task', label: 'New task', roles: EVERYONE },
  '/projects': { kind: 'project', label: 'New project', roles: ADMIN_UP },
  '/team': { kind: 'person', label: 'Add member', roles: ADMIN_UP },

  /* Explicitly nothing. Written out rather than left to the fallback so that the
     absence is a decision on the record, not an oversight. */
  '/workload': null,
  /* The page carries its own "Assign task" button, in the place the owner's
     reference puts it. A second one up here would be the same action twice. */
  '/performance': null,
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

export function primaryActionFor(pathname: string, role: Role): PrimaryAction | null {
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
