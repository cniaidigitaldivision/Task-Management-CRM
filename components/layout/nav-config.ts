import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
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
    items: [
      { label: 'My Work', href: '/my-work', icon: ListChecks, roles: ALL, badgeKey: 'myTasks' },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: LEAD_UP },
    ],
  },
  {
    label: 'Work',
    items: [
      { label: 'Tasks', href: '/tasks', icon: CalendarClock, roles: ALL },
      { label: 'Projects', href: '/projects', icon: FolderKanban, roles: ALL },
      /* Open to everybody: RLS decides what is in it, so a Member sees their
         own due dates and a Coordinator sees the division's. */
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, roles: ALL },
      { label: 'Workload', href: '/workload', icon: Gauge, roles: LEAD_UP },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Team', href: '/team', icon: Users, roles: ADMIN_UP },
      { label: 'Reports', href: '/reports', icon: BarChart3, roles: LEAD_UP },
    ],
  },
  {
    label: 'System',
    items: [
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
