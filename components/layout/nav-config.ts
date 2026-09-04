import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  FolderKanban,
  Clock3,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  TrendingUp,
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
/* ⚠️ The only DOWNWARD rank in this file: everything else is "this rank and
   above", this is "this rank and no other". My Work exists because a Member has
   no other view of their own tasks; for a Coordinator it is a narrower copy of
   Tasks, which is why it stops here rather than reading `ALL`. */
const MEMBER_ONLY: readonly Role[] = ['member'];

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    /* Dashboard first, My Work under it — owner instruction, Session 17.
       A Member has no Dashboard at all (LEAD_UP), so for them the list still
       opens on My Work; the order only shows for a Coordinator and above. */
    items: [
      /* ⚠️ LEAD_UP is the DEFAULT, not the whole rule. Owner, 2026-08-26:
         *"this facility will only be provided to upper levels [...] later on
         maybe I can have a radio button for each member that I can switch on
         and off at my choice."*

         A row in `public.assistant_access` overrides that per person, so a
         switched-on Member may use the assistant and will NOT see this link —
         they reach it from the floating launcher, which asks the composed rule.
         Offering it here to everybody would advertise it to the majority who
         are switched off, and this list is cosmetic anyway (NFR-006): the real
         gate is `mayUseAssistant` in the route's own layout. */
      { label: 'AI Assistant', href: '/assistant', icon: Sparkles, roles: LEAD_UP },
      /* CHANGE-PLAN 7.1: open to a Member too, now that the page has a shape for
         them. It used to be LEAD_UP and they were redirected away. */
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ALL },
      /* ⚠️ MEMBER ONLY, since 2026-08-22. Owner, about the Coordinator's rail:
         *"Remove Today, workflow, and my work also. I don't need all these
         pages."*

         A Member has no other view of their own work, so this is their home. A
         Coordinator and above have Tasks, which shows the same rows plus
         everybody else's — so for them My Work was a narrower duplicate of a
         screen they already open, and one more thing in the rail to skip past. */
      { label: 'My Work', href: '/my-work', icon: ListChecks, roles: MEMBER_ONLY, badgeKey: 'myTasks' },
    ],
  },
  {
    label: 'Work',
    items: [
      /* ⚠️ THERE WAS A "TODAY" ITEM HERE AND IT WAS A MISTAKE.
         Built 2026-08-22 as its own page; removed the same day. Owner: *"I don't
         understand why you created this Today page separately… I want Today to be
         there and Today will display the tasks for that day."*

         The content was right and the placement was wrong. "What is happening
         today" is a VIEW OF THE TASK LIST, not a second place to look — putting
         it in the rail meant two screens answering one question, which is exactly
         the sprawl the owner keeps asking to remove. It now lives as the Today
         tab inside a project's Tasks, where the work already is. */
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
    items: [
      { label: 'Projects', href: '/projects', icon: FolderKanban, roles: ALL },
      /* ── ⚠️ ADDED 2026-09-04 — a SEPARATE PAGE, not a project tab ─────────
         Owner changed the plan explicitly: *"before I was saying data within the
         project… I don't want that to change anything inside of the project. I
         want to create a separate page inside, in a left sidebar below the
         project."* So it sits here, under Projects, and nothing inside
         app/(app)/projects/ was touched.

         LEAD_UP, on the owner's instruction: *"this only visible to admin,
         superadmin and team coordinator."* ⚠️ This file has never been a
         security boundary (NFR-006) — the real floor is requireRole() in
         app/(app)/studio/layout.tsx. Removing the item here would hide the link
         and grant nobody anything. */
      { label: 'Trend & Engagement Studio', href: '/studio', icon: TrendingUp, roles: LEAD_UP },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Team', href: '/team', icon: Users, roles: ADMIN_UP },
      { label: 'Reports', href: '/reports', icon: BarChart3, roles: LEAD_UP },
      /* ── ⚠️ 'MONTHLY REPORT' WAS TAKEN OUT OF THIS LIST ON 2026-08-29 ───────
         Owner: *"only the report page is all working, everything is working over
         there, so this monthly report page, remove it"* — of the item in the left
         sidebar. Two entries under one heading, both called some form of
         "report", is a choice somebody has to make before they can read either.

         ⚠️ THE ROUTE IS STILL THERE AND STILL WORKS. Only the link is gone, by
         the owner's instruction: `/monthly-report` still loads for Admin+, still
         has its own `requireRole('admin')` floor in layout AND page, and the
         project detail screen still links to it as the division-wide report. This
         file has never been a security boundary (NFR-006) and removing an item
         from it grants nobody anything — so nothing about who may read that page
         changed here. Putting the item back is one line.

         `FileBarChart` is no longer imported above for the same reason. */
      /* ⚠️ MOVED HERE FROM System, 2026-08-26, on owner instruction. Attendance
         is about the people, not about the machinery — it sits with Team and
         Reports, which are the other two screens read about who is doing what.

         ⚠️ OPEN TO EVERY ROLE, and it has to be: the page is where somebody sees
         their OWN record, and a Member who cannot open it cannot check whether
         the day they forgot to check out was fixed. This is the one item in this
         section offered below LEAD_UP. What differs by role is what the page
         CONTAINS — a Member's board is built from themselves alone, on the
         server — not whether the link is offered. Owner, 2026-08-25: *"Some
         things should be hidden from the team members"*, which is about the
         contents (NFR-006). */
      { label: 'Attendance', href: '/attendance', icon: Clock3, roles: ALL },
    ],
  },
  {
    label: 'System',
    items: [
      /* Open to every role: anybody may upload, and RLS decides what is on the
         page. Owner: 'every time a user or anybody comes, they should have a place
         where they can upload something.' */
      { label: 'Documents', href: '/documents', icon: FolderOpen, roles: ALL },
      /* ⚠️ MOVED HERE FROM Team, 2026-08-26, on owner instruction. The ledger is
         division machinery — it belongs with Vault and Settings rather than
         beside the screens about people.

         ⚠️ LEAD_UP, NOT ADMIN_UP, AND THAT IS DELIBERATE. Owner, 2026-08-26:
         *"the team coordinator can also add expenses. The list of expenses,
         their report, or their analysis should only be visible to the admin and
         the super admin."*

         So a Coordinator needs the LINK — they file from that page — and must
         not receive the ledger. Hiding the link would take away the one thing
         they were given. What they actually get is decided on the server in the
         route's own page.tsx, which returns a form and no figures; this list
         only decides whether the link is offered (NFR-006). */
      { label: 'Finance', href: '/finance', icon: Wallet, roles: LEAD_UP },
      /* Open to every role, like the calendar: row-level security decides what is
         in it (migration 023), so a Member sees only credentials issued to them —
         usually none. Hiding it by role would be a second, weaker copy of the
         real rule. */
      { label: 'Vault', href: '/vault', icon: KeyRound, roles: ALL },
      /* Handoff chains (doc 12 E-004, rule R4a). Open to every role, EDITABLE by
         Admin+ (owner, 2026-08-15). A chain creates work that lands in somebody's
         queue, and the person it lands on should be able to see why — a Member
         who finds a task they did not create can read the chain that made it.
         The write side is gated by the actions and by migration 026's policies. */
      /* ⚠️ ADMIN_UP since 2026-08-22, on the same instruction. Handoff chains are
         configured by an Admin and every action on the screen is already gated
         there — a Coordinator could open it and change nothing, which is a page
         that exists only to refuse. */
      { label: 'Workflow', href: '/workflow', icon: Workflow, roles: ADMIN_UP },
      { label: 'Settings', href: '/settings', icon: Settings, roles: ADMIN_UP },
      /* ADMIN_UP since 2026-08-22 — owner decision. Was SUPER_ONLY; the route
         guard, the permission matrix and migration 040 all moved with it. */
      { label: 'Security', href: '/security', icon: ShieldCheck, roles: ADMIN_UP },
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
