import {
  BarChart3,
  FileBarChart,
  CalendarClock,
  CalendarDays,
  FolderKanban,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';

import type { Route } from 'next';

import type { Role } from '@/lib/domain/constants';

/* ============================================================================
 * NAVIGATION
 * ----------------------------------------------------------------------------
 * Presentation config only. The authoritative permission model lives in
 * docs/03 and will be enforced server-side and by row-level security — hiding
 * a nav item is convenience, never security (NFR-006).
 *
 * `roles` mirrors doc 03 §4. A Team Member's sidebar deliberately contains
 * only four items: they cannot see other people's work at all (ADR-003).
 * ========================================================================= */

export interface NavItem {
  label: string;
  /** Typed against the real route tree — a link to a page that does not exist
   *  is a compile error, never a 404 someone finds in production. */
  href: Route;
  icon: typeof LayoutDashboard;
  roles: readonly Role[];
  /** Shown as a counter chip. Wired to real data from Phase 3. */
  badgeKey?: 'myTasks' | 'review' | 'overdue';
}

export interface NavSection {
  label: string | null;
  items: readonly NavItem[];
}

const ALL: readonly Role[] = ['super_admin', 'admin', 'team_coordinator', 'member'];
const LEAD_UP: readonly Role[] = ['super_admin', 'admin', 'team_coordinator'];
const ADMIN_UP: readonly Role[] = ['super_admin', 'admin'];
const SUPER_ONLY: readonly Role[] = ['super_admin'];

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    /* Dashboard first, My Work under it — owner instruction, Session 17.
       A Member has no Dashboard at all (LEAD_UP), so for them the list still
       opens on My Work; the order only shows for a Coordinator and above. */
    items: [
      /* CHANGE-PLAN 7.1: open to a Member too, now that the page has a shape for
         them. It used to be LEAD_UP and they were redirected away. */
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ALL },
      { label: 'My Work', href: '/my-work', icon: ListChecks, roles: ALL, badgeKey: 'myTasks' },
    ],
  },
  {
    label: 'Work',
    items: [
      { label: 'Tasks', href: '/tasks', icon: CalendarClock, roles: ALL },
      /* Open to everybody: RLS decides what is in it, so a Member sees their
         own due dates and a Coordinator sees the division's. */
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, roles: ALL },
      { label: 'Workload', href: '/workload', icon: Gauge, roles: LEAD_UP },
    ],
  },
  {
    /* CHANGE-PLAN 6.2, owner: *"Remove the projects from the Work thing… it
       should be another subheading."*
       Projects was under Work, which put it beside Tasks and Calendar as though it
       were another view of the same thing. It is not — a project is the container
       those views group BY, and treating it as a peer of Tasks is why it read as
       just another list. Its own heading says what it is.
       Decision 9: **regroup only.** No new screens and no Clients page, so this
       section holds one item today and is still the right shape — a heading with
       one thing under it is honest about the hierarchy, whereas folding it back in
       would restate the confusion. */
    label: 'Projects',
    items: [{ label: 'Projects', href: '/projects', icon: FolderKanban, roles: ALL }],
  },
  {
    label: 'Team',
    items: [
      { label: 'Team', href: '/team', icon: Users, roles: ADMIN_UP },
      { label: 'Reports', href: '/reports', icon: BarChart3, roles: LEAD_UP },
      /* The monthly board report. Admin+, one rank above the Reports screen above
         it, because it totals recurring fees across every client — the floor is
         enforced by `requireRole` in the route's own layout and page, and this
         list only decides whether the link is offered (NFR-006). */
      { label: 'Monthly report', href: '/monthly-report', icon: FileBarChart, roles: ADMIN_UP },
    ],
  },
  {
    label: 'System',
    items: [
      /* Open to every role, like the calendar: row-level security decides what is
         in it (migration 023), so a Member sees only credentials issued to them —
         usually none. Hiding it by role would be a second, weaker copy of the
         real rule. */
      /* Open to every role: anybody may upload, and RLS decides what is on the
         page. Owner: 'every time a user or anybody comes, they should have a place
         where they can upload something.' */
      { label: 'Documents', href: '/documents', icon: FolderOpen, roles: ALL },
      { label: 'Vault', href: '/vault', icon: KeyRound, roles: ALL },
      /* Handoff chains (doc 12 E-004, rule R4a). Open to every role, EDITABLE by
         Admin+ (owner, 2026-08-15). A chain creates work that lands in somebody's
         queue, and the person it lands on should be able to see why — a Member
         who finds a task they did not create can read the chain that made it.
         The write side is gated by the actions and by migration 026's policies. */
      { label: 'Workflow', href: '/workflow', icon: Workflow, roles: ALL },
      { label: 'Settings', href: '/settings', icon: Settings, roles: ADMIN_UP },
      { label: 'Security', href: '/security', icon: ShieldCheck, roles: SUPER_ONLY },
    ],
  },
];

export function sectionsForRole(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Every href a role is offered, for the "which item is current" rule. Flattened
 *  here so the rule itself stays free of the nav's React types — see
 *  `lib/view/nav-active.ts`. */
export function hrefsForRole(role: Role): string[] {
  return sectionsForRole(role).flatMap((section) => section.items.map((item) => item.href));
}
