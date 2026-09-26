import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock3,
  FolderKanban,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Radio,
  Repeat,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
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
  /**
   * A capability that opens this item WHATEVER the rank — migration 124.
   *
   * ⚠️ THIS EXISTS BECAUSE RANK CANNOT EXPRESS THE CRM. The people whose whole
   * job is the lead desk are `member`, the bottom of the ladder. `roles` is a
   * ladder and this is not, so the two are ORed rather than one being bent into
   * the other.
   *
   * ⚠️ AND IT IS A CAPABILITY, NOT A DEPARTMENT LIST. It was
   * `departments: ['sales']` until 2026-09-10, which stopped being right the
   * moment the division's own product leads routed to AI & Digital instead. A
   * static list would have had to grow every time a project was re-routed, and
   * would have been wrong in between. The server already computes the answer —
   * `crmIsOpenTo()` — so the nav asks for it rather than re-deriving it.
   */
  requires?: 'crm' | 'crmReports';
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

/* ── ⚠️ THE EXECUTIVE IS DELIBERATELY ABSENT FROM `ALL` ────────────────────
   `ALL` means "everybody who does the work", and it stayed at four roles when
   the Executive was added. That makes the sidebar FAIL CLOSED: a page nobody
   has thought about yet is hidden from them, and showing it is a visible edit
   to one line rather than something that happened by default.

   Owner, 2026-09-25, page by page. Hidden: Tasks, Repeating tasks, Calendar,
   My leads, My to-dos, Finance ("right now hide it ... later on when I am sure
   I will tell you"), Vault ("definitely hide it"), Composer ("it didn't
   complete"), Settings, Security. Shown read-only: everything below. */
const EXEC: Role = 'executive';
const ALL_EXEC: readonly Role[] = [...ALL, EXEC];
const LEAD_EXEC: readonly Role[] = [...LEAD_UP, EXEC];
const ADMIN_EXEC: readonly Role[] = [...ADMIN_UP, EXEC];

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
      { label: 'AI Assistant', href: '/assistant', icon: Sparkles, roles: LEAD_EXEC },
      /* CHANGE-PLAN 7.1: open to a Member too, now that the page has a shape for
         them. It used to be LEAD_UP and they were redirected away. */
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ALL_EXEC },
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
      /* ⚠️ THE EXECUTIVE WAS ADDED BACK ON 2026-09-26. Hidden on the 25th
         (*"any one person's task on the task page doesn't make any sense"*),
         then restored when the owner gave them task work: *"The task page and
         these things will now be allowed for the executive."* */
      { label: 'Tasks', href: '/tasks', icon: CalendarClock, roles: ALL_EXEC },
      /* ── ⚠️ ONE PLACE THAT ANSWERS "WHAT KEEPS COMING BACK?" ──────────────
         Owner, 2026-09-22: *"Can you please exactly tell me where Najmulah, in
         his dashboard, will go to turn off this repeating task or where he can
         see which tasks are repeating?"*

         It is deliberately its own entry rather than a tab inside Tasks. A
         repeat with no open copy — which was true of all nine of Najamullah's
         that day — appears on no board at all, so a view that lives inside the
         board could not have shown it. Open to everybody: the read returns only
         the repeats that person raised, is assigned, or may see. */
      { label: 'Repeating tasks', href: '/repeats', icon: Repeat, roles: ALL },
      /* Open to everybody: RLS decides what is in it, so a Member sees their
         own due dates and a Coordinator sees the division's. */
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, roles: ALL },
      { label: 'Workload', href: '/workload', icon: Gauge, roles: LEAD_EXEC },
      /* ── ⚠️ ITS OWN ENTRY, BESIDE REPORTS RATHER THAN INSIDE IT ───────────
         Owner, 2026-09-23: *"I want to create a team performance page … I want
         to know or see a single person's performance."*

         Reports produces a DOCUMENT for a period; this answers "how is this
         person doing" and is read on screen. Folding one into the other would
         make the export controls part of a question nobody asked while reading
         it — and the owner was explicit that the report page's export is to be
         left alone for now.

         ⚠️ ALL, NOT LEAD_UP — owner, 2026-09-23: *"I want the admin to be able
         to view this page ... and all the other team members can view their own
         performance only."* A Member opens the same page locked to themselves:
         the page forces the person filter to their own id and hides the team and
         person pills, and RLS independently shows them nothing else. The rank no
         longer decides WHETHER the page opens, only HOW WIDE it is. */
      { label: 'Performance', href: '/performance', icon: BarChart3, roles: ALL_EXEC },
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
      { label: 'Projects', href: '/projects', icon: FolderKanban, roles: ALL_EXEC },
      /* ── ⚠️ ADDED 2026-09-04 — a SEPARATE PAGE, not a project tab ─────────
         Owner changed the plan explicitly: *"before I was saying data within the
         project… I don't want that to change anything inside of the project. I
         want to create a separate page inside, in a left sidebar below the
         project."* So it sits here, under Projects, and nothing inside
         app/(app)/projects/ was touched.

         LEAD_UP, on the owner's instruction: *"this only visible to admin,
         superadmin and team coordinator."*, then narrowed to ADMIN_UP on
         2026-09-05 before merging. ⚠️ This file has never been a security
         boundary (NFR-006) — the real floor is requireRole() in
         app/(app)/studio/layout.tsx. Changing it here alone would hide the link
         and grant nobody anything, which is why both were changed. */
      { label: 'Trend & Engagement Studio', href: '/studio', icon: TrendingUp, roles: ADMIN_EXEC },
    ],
  },
  {
    /* ── ⚠️ ITS OWN HEADING, NOT UNDER PROJECTS — owner, 2026-09-09 ─────────
       *"In the left sidebar in that branch I will start working… for all leads
       management. Leads are coming from the campaigns."*

       The Studio sits under Projects because it reads ONE project's figures. A
       lead does not start life belonging to a project — it arrives from a
       campaign and is assigned afterwards — so filing it there would put the
       answer before the question. Its own heading leaves room for the campaign
       and source screens that follow.

       ⚠️ ADMIN_UP **plus whoever the leads route to** — owner, 2026-09-10:
       *"the system should be smart enough to know which campaign these leads are
       coming from and which project they are from. Who will lead or deal with
       these leads?"* Chitral routes to Sales, the division's own ERP and CRM
       leads route to AI & Digital. It was Sales alone for one day; see
       migration 124.

       ⚠️ And this file is not the floor. `app/(app)/leads/layout.tsx` and
       migration 118 are (NFR-006); removing the link here would hide the page
       and grant nobody anything. All three are set together, deliberately. */
    label: 'Growth',
    items: [
      {
        label: 'Campaign & Lead Desk',
        href: '/leads',
        icon: Radio,
        roles: ADMIN_EXEC,
        /* ⚠️ The people whose entire job is this screen are `member`. Without
           this they would have no link to it. */
        requires: 'crm',
      },
      {
        /* ⚠️ `requires: 'crm'`, NOT `crmReports` — this is the one screen in the
           Growth section that belongs to a SALESPERSON rather than to whoever
           manages them. Everything on it is filtered to the caller's own leads
           (migration 136), so it discloses nothing they could not already read
           off the desk; it simply answers "what is mine today" without their
           having to build the filter themselves. */
        label: 'My leads',
        href: '/my-leads',
        icon: ClipboardList,
        roles: ADMIN_UP,
        requires: 'crm',
      },
      {
        /* ⚠️ THE SALESPERSON'S OWN INBOX. Owner, 2026-09-18, with a design:
           *"in the salesperson's conversation page… like WhatsApp on an app like
           that."* Every thread they own, ordered by who spoke last — the desk is
           for working a lead, this is for answering one.

           `requires: 'crm'` like My leads: it lists only the caller's own
           conversations (the query carries `owner_id = app.current_user_id()`
           and RLS narrows it again), so it discloses nothing the desk does not. */
        label: 'Conversations',
        href: '/conversations',
        icon: MessagesSquare,
        roles: ADMIN_EXEC,
        requires: 'crm',
      },
      {
        /* ⚠️ A RAIL ENTRY ONLY BECAUSE ITS SCREEN DOES SOMETHING — the standing
           rule in `14-SALES-WORKSPACE-PHASES.md`, and the reason the other five
           rail entries the owner listed are still absent. A nav that leads to
           "coming soon" teaches people to stop clicking the nav.

           ⚠️ `requires: 'crm'`, like My leads: this is the salesperson's own
           diary, narrowed to their own rows by 152's policies and by the query's
           own owner clause. It discloses nothing a manager could not read off
           the desk, and it is not the manager's screen. */
        label: 'Appointments',
        href: '/appointments',
        icon: CalendarClock,
        roles: ADMIN_EXEC,
        requires: 'crm',
      },
      {
        /* ⚠️ WHAT IS OWED TODAY, and the one screen where a follow-up can be
           read before it goes out. Owner, 2026-09-22, with a design: *"I want
           each and every thing to be working properly, sensibly, and logically,
           with each and every thing wired up."*

           It sits beside Appointments rather than inside My leads because a
           follow-up is owed on a clock, not on a lead — the question it answers
           is "what must I send now", across every lead at once.

           `requires: 'crm'`, and the query carries
           `f.assigned_to_id = app.current_user_id()`: this is the caller's own
           queue, narrowed again by 152's policies. */
        label: 'Follow-ups',
        href: '/follow-ups',
        icon: Send,
        roles: ADMIN_EXEC,
        requires: 'crm',
      },
      {
        /* ⚠️ THE SALES TEAM'S OWN LIST, and deliberately NOT merged into the
           existing task board. Owner: *"I want a separate thing for the sales
           team with the name to-dos where sales-related to-dos will just be
           displayed."* Taskly's tasks are assigned work with an author; these are
           derived from lead state and have no author at all — one screen showing
           both would need a column explaining which kind each row was. */
        label: 'My to-dos',
        href: '/todos',
        icon: ListChecks,
        roles: ADMIN_UP,
        requires: 'crm',
      },
      {
        /* ⚠️ A RAIL ENTRY BECAUSE ITS SCREEN DOES SOMETHING — the standing rule.
           This one is the fence around the AI agent: the agent may state a fact
           only if it is approved here, and everything else it hands to a person.
           Owner, 2026-09-20: *"give me some chatbot or something like that where
           I can guide, instruct, or give knowledge to my AI agent."*

           `requires: 'crm'` like the desk: it reads a project's own documents and
           answers, and it discloses nothing a salesperson cannot already read. */
        /* Renamed to the owner's own title for the page, 2026-09-22. */
        label: 'AI Knowledge',
        href: '/knowledge',
        icon: BookOpen,
        roles: ADMIN_EXEC,
        requires: 'crm',
      },
      {
        /* ⚠️ ITS OWN ITEM, BESIDE THE DESK. The owner's reference names them
           together — "Clients & Leads" — and they are genuinely two screens: the
           desk is scoped to one project and sorted by what is owed; this lists
           PEOPLE across every project, because a client has no project of their
           own (migration 111). Same audience, same capability. */
        label: 'Clients',
        href: '/clients',
        icon: UserCheck,
        roles: ADMIN_EXEC,
        requires: 'crm',
      },
      {
        /* ⚠️ ABOVE "Lead reports", AND THE PAIR IS THE POINT. This is live and
           computed on read; that one is FROZEN by design, because a report is a
           statement made on a date. A manager wanting "what is wrong this
           morning" and one wanting "what did we say in September" are asking
           different questions, and one screen answering both would be correct
           and out of date. Same audience, same capability. */
        label: 'Live overview',
        href: '/lead-overview',
        icon: Activity,
        roles: ADMIN_EXEC,
        requires: 'crmReports',
      },
      {
        /* ⚠️ NOT UNDER `/reports`, and the reason is a floor rather than a
           preference: that page requires `team_coordinator` and above, and the
           sales manager is `member` (ADR-012). A nested layout cannot widen a
           parent's floor, so `/reports/leads` would have blocked exactly the
           person these reports are for. */
        label: 'Lead reports',
        href: '/lead-reports',
        icon: BarChart3,
        roles: ADMIN_EXEC,
        /* ⚠️ `crmReports`, NOT `crm` — the desk is the whole sales team's, these
           reports are the manager's. A salesperson who followed this link would
           be redirected by the layout anyway; the link is removed so they are
           not offered a door that shuts in their face. */
        requires: 'crmReports',
      },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Team', href: '/team', icon: Users, roles: ADMIN_EXEC },
      { label: 'Reports', href: '/reports', icon: BarChart3, roles: LEAD_EXEC },
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
      { label: 'Attendance', href: '/attendance', icon: Clock3, roles: ALL_EXEC },
    ],
  },
  {
    label: 'System',
    items: [
      /* Open to every role: anybody may upload, and RLS decides what is on the
         page. Owner: 'every time a user or anybody comes, they should have a place
         where they can upload something.' */
      { label: 'Documents', href: '/documents', icon: FolderOpen, roles: ALL_EXEC },
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
      { label: 'Workflow', href: '/workflow', icon: Workflow, roles: ADMIN_EXEC },
      { label: 'Settings', href: '/settings', icon: Settings, roles: ADMIN_UP },
      /* ADMIN_UP since 2026-08-22 — owner decision. Was SUPER_ONLY; the route
         guard, the permission matrix and migration 040 all moved with it. */
      { label: 'Security', href: '/security', icon: ShieldCheck, roles: ADMIN_UP },
    ],
  },
  {
    label: 'Social',
    items: [
      { label: 'Composer', href: '/composer', icon: Sparkles, roles: ALL },
    ],
  },
];

/** What the viewer can reach beyond their rank. */
export interface NavCapabilities {
  /** `crmIsOpenTo()` — see `lib/auth/current-user.ts`. */
  readonly crm?: boolean;
  /** ⚠️ NARROWER THAN `crm`. `crmReportsOpenTo()` — the lead reports name and
   *  compare people, so they are the department MANAGER's and an Admin's, never
   *  a salesperson's. Owner, 2026-09-12. */
  readonly crmReports?: boolean;
}

/**
 * What this person is offered.
 *
 * ⚠️ `can` IS OPTIONAL AND DEFAULTS TO NOTHING, so every existing caller keeps
 * the rank-only behaviour it had. A capability only ever ADDS an item — it can
 * never take one away, because a rule that could remove things would make "why
 * has my sidebar changed?" a support question.
 */
/**
 * May a CAPABILITY add a page this role's own list leaves out?
 *
 * ⚠️ NO, FOR THE EXECUTIVE, AND THAT IS THE WHOLE OF IT. `requires` exists so a
 * salesperson — whose app role is `member`, the bottom of the ladder — still
 * gets a link to the desk that is their entire job. It adds items the role list
 * does not mention, which is right for everybody whose list is a rank.
 *
 * The Executive's list is not a rank. It was decided page by page with the
 * owner on 2026-09-25, and "not on the list" means "the owner said no". Opening
 * the Lead Desk to them set `crm` true and quietly handed back My leads and My
 * to-dos — two pages that had been closed on purpose. Found in a walkthrough,
 * because `hrefsForRole()` with no capabilities still said they were hidden.
 */
function grantsByCapability(role: Role): boolean {
  return role !== 'executive';
}

export function sectionsForRole(role: Role, can: NavCapabilities = {}): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.roles.includes(role) || (grantsByCapability(role) && item.requires ? can[item.requires] === true : false),
    ),
  })).filter((section) => section.items.length > 0);
}

/** Every href a role is offered, for the "which item is current" rule. Flattened
 *  here so the rule itself stays free of the nav's React types — see
 *  `lib/view/nav-active.ts`. */
export function hrefsForRole(role: Role, can: NavCapabilities = {}): string[] {
  return sectionsForRole(role, can).flatMap((section) => section.items.map((item) => item.href));
}
