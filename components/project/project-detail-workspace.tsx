'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ListChecks,
  Loader2,
  MoreVertical,
  Trash2,
  Link2 as LinkIcon,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Upload,
  FileText,
  KeyRound,
  LayoutDashboard,
  Users,
} from 'lucide-react';

import type { CredentialRow } from '@/lib/db/queries/credentials';
import type { DocumentRow } from '@/lib/db/queries/documents';
import type { ActivityRow } from '@/lib/db/queries/types';
import type { ProjectMemberRow } from '@/lib/db/queries/projects';
import type { ProjectRow, TaskRow } from '@/lib/db/queries/types';
import { CONTENT_KIND_LABEL } from '@/lib/domain/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { ToggleGroup } from '@/components/ui/toolbar';
import { ComingSoon } from '@/components/ui/coming-soon';
import { cn } from '@/lib/utils';

import { deleteProjectAction } from '@/app/actions/projects';
import { PostingCalendar } from './posting-calendar';
import type { PackageDetail } from './contract-dialog';
import { TaskDialog } from '@/components/task/task-dialog';
import { UploadDialog } from '@/components/documents/upload-dialog';

import { ProjectCredentials } from './project-credentials';
import { ProjectFilesTab } from './project-files-tab';
import { ProjectTeamTab } from './project-team-tab';
import { ProjectDialog } from './project-dialog';
import { PlatformLinksDialog } from './platform-links-dialog';
import type { PlacementRow } from '@/lib/db/queries/placements';
import type { CalendarTask } from '@/lib/db/queries/search';
import { CalendarView } from '@/components/calendar/calendar-view';
import type { Role } from '@/lib/domain/constants';
import { canAssignTo } from '@/lib/domain/permissions';

import { DailyBoard } from './daily-board';
import { ProjectOverview } from './project-overview';
import { ProjectTasksTab } from './project-tasks-tab';
import { ReportMenu } from './report-menu';
import { PlatformStrip } from './project-delivery';
import { IncludesPills, KindPill, PackagePill, StatusPill } from './project-pills';

/* ============================================================================
 * ONE PROJECT, IN TABS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: *"switch here, see this, switch there, see this… We do not
 * have to scroll too much down to see anything."*
 *
 * ── THE OVERVIEW ANSWERS ONE QUESTION FIRST ──────────────────────────────────
 * "Are we delivering what we sold?" Everything else on this screen is reference.
 * So the progress against the agreed target is the first thing on the page, above
 * the package, above the fee, above the team — because it is the only part that
 * changes daily and the only part a CEO opens the page to see.
 *
 * ── THE VERDICT IS NOT COMPUTED HERE ─────────────────────────────────────────
 * `projectProgress` decides it, in lib/domain, tested to 19 cases. The three
 * rules it encodes are each counter-intuitive — the minimum is the promise, "up
 * to 75" cannot be missed, reels sit inside the total — and re-deriving any of
 * them in a component is how a bar and a report come to disagree.
 * ========================================================================= */

type Tab = 'overview' | 'content' | 'calendar' | 'tasks' | 'analytics' | 'team' | 'files' | 'access';

/* ── ⚠️ EIGHT TABS, FROM THE OWNER'S MOCKUP (2026-08-20) ──────────────────────
   Three are new (Calendar, Tasks, Analytics) and two were renamed: Credentials →
   Access and Documents → Files, matching the picture.

   The rename is only a label — the panels behind them are unchanged, and the tab KEYS
   changed with them so nothing reads a stale string. Worth stating because "Access"
   sounds like a permissions screen and is not: it is where a project's logins live,
   which is what the mockup means by it. */
const TABS: ReadonlyArray<{ key: Tab; label: string; icon: typeof Users }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'content', label: 'Content', icon: Share2 },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'files', label: 'Files', icon: FileText },
  { key: 'access', label: 'Access', icon: KeyRound },
];

/* ⚠️ The project-status meta that used to live here is gone — StatusPill in
   project-pills.tsx owns it now, so the list page and this page cannot drift
   apart on what colour "on hold" is. */

/** The secondary action buttons on the tab row. One string so the three of them
 *  cannot drift apart by a pixel. */
const ACTION =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-default px-2 py-1.5 text-caption font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary';

/** The label inside an action button. Hidden below `xl`, so a zoomed-in viewport gets
 *  four icons instead of four crowded buttons. `title` on the button keeps them
 *  identifiable when the text is gone — an icon-only control with no tooltip is a
 *  guessing game. */
const ACTION_LABEL = 'hidden xl:inline';

/* ⚠️ `TH`/`TD` lived here so the Tasks and Content tables lined up. Both are
   gone from this file — Tasks moved to `project-tasks-tab.tsx` with its own
   header style, and Content is a "coming soon" panel. The classes went with the
   Tasks table rather than being kept here for a caller that no longer exists. */

export function ProjectDetailWorkspace({
  project,
  members,
  tasks,
  credentials,
  documents,
  people,
  canManage,
  canDelete,
  canManageDocuments,
  canApproveDocuments,
  canGrantCredentials,
  canSeeFinance,
  placements,
  driveFolders,
  dailyLookbackFrom,
  calendarTasks,
  currentUser,
  monthStart,
  monthLabel,
  months,
  today,
  nowMs,
  activity,
  ownerAvatarUrl,
  publishedTodayPlatformIds,
  packageDetail,
}: {
  project: ProjectRow;
  members: readonly ProjectMemberRow[];
  tasks: readonly TaskRow[];
  credentials: readonly CredentialRow[];
  documents: readonly DocumentRow[];
  /** Every active person in the division, with rank and picture. `role` decides
   *  who a task may be assigned to; `avatarUrl` draws the Access tab's
   *  "who can see this" stack. */
  people: readonly { id: string; name: string; role: string; avatarUrl?: string | null }[];
  canManage: boolean;
  /** `project.soft_delete` — Admin and Super Admin. Deliberately its own prop:
   *  `canManage` is `project.edit`, which reaches the Coordinator, and deleting
   *  a client's whole record is not the same act as correcting its name. */
  canDelete: boolean;
  /** `document.manage` — Super Admin, Admin and Team Coordinator; Member denied.
   *  Whether the Files tab offers Rename and Delete per row. Deliberately its own
   *  prop rather than reusing `canManage`: they happen to cover the same roles
   *  today and are different permissions, and one of them will move first. */
  canManageDocuments: boolean;
  /** `document.approve` — the same set, asked as a different question: whether
   *  THIS person's upload skips the queue. The upload dialog needs it so its button
   *  can say what will actually happen instead of always "Send for approval". */
  canApproveDocuments: boolean;
  /** `credential.grant` — Admin and Super Admin only, unlike every other
   *  credential permission. Whether the Access tab's "who can see this" modal can
   *  add and remove named people. Migration 050. */
  canGrantCredentials: boolean;
  /** `project.view_finance` — Admin and above. The fee is ALSO stripped server-side
   *  before it reaches this component; see lib/view/project-finance.ts for why both. */
  canSeeFinance: boolean;
  /** Published links per platform, for the Today view. Fetched once on the page
   *  rather than per task — see `listPlacementsForProject`. */
  placements: readonly PlacementRow[];
  /** Every Drive folder this person can see. The Today view puts this project's
   *  own at the top and leaves the rest reachable, per the owner's instruction. */
  driveFolders: readonly {
    id: string;
    name: string;
    projectId: string | null;
    driveFolderId: string;
  }[];
  /** How far back the Today view looks for blank days. Resolved on the server so
   *  it agrees with the window the placements were fetched for. */
  dailyLookbackFrom: string;
  /** This project's tasks for the visible month, for the Calendar tab. */
  calendarTasks: readonly CalendarTask[];
  /** Who is looking. Needed so the Tasks tab can open the create form in place
   *  and so a Member can change the status of their own task from the list. */
  currentUser: { id: string; role: Role };
  /** 'YYYY-MM-01' and 'YYYY-MM-DD', from the server.
   *
   *  ⚠️ Passed in rather than read here. A component that reads the clock is not a
   *  pure render (React's compiler lint refuses it), and the server and the browser
   *  can disagree about the date across midnight or a timezone — which would put the
   *  month grid on the wrong month. Same rule as lib/now.ts. */
  monthStart: string;
  /** "August 2026" — formatted on the server for the same reason the dates are. */
  monthLabel: string;
  /** The months the progress card's selector offers, newest first. */
  months: readonly string[];
  today: string;
  /** Epoch milliseconds, read on the server. Feeds the Access tab's relative
   *  ages — see the prop's note on the page and lib/now.ts for why a component
   *  may not read this itself. */
  nowMs: number;
  /** This project's and its tasks' history, newest first. */
  activity: readonly ActivityRow[];
  /** The owner's uploaded picture, or null. */
  ownerAvatarUrl: string | null;
  /** Platform ids with a live placement today — feeds the Today KPI card. */
  publishedTodayPlatformIds: readonly string[];
  /** The chosen package's terms, for the contract dialog. Null on a custom deal. */
  packageDetail: PackageDetail | null;
}) {
  const [tab, setTab] = React.useState<Tab>('overview');
  const router = useRouter();

  /* ⚠️ The team-editing state that used to live here — `busy`, `note`, `adding`,
     `addingRole` and the `run` helper — moved with the Team tab into
     ./project-team-tab.tsx. Nothing else on this page used it. */

  /* The two dialogs this page can open. Owner, 2026-08-20 asked where a project is
     edited — the answer was "only the pencil on the projects list", which is not an
     answer, so the header menu opens them here. */
  const [editing, setEditing] = React.useState(false);
  const [editingPlatforms, setEditingPlatforms] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  /* ── The three header actions, all of which now stay on this page ──────────
     `creatingContent` opens a notice rather than a form: the feature does not
     exist, and a button that silently does nothing is worse than one that says
     why. See the Content tab, which says the same thing in the same words. */
  /* ── WHO A TASK RAISED HERE MAY GO TO ─────────────────────────────────────
     Project members, not the whole division: a task raised inside a project goes
     to somebody on it.

     ⚠️ And only those at or below this person's rank. Built from
     `project_members` rather than from `listAssignablePeople`, so it does NOT
     inherit the rank rule those queries carry and has to apply it here — an Admin
     who happens to be on the project would otherwise appear in a Coordinator's
     assignee control. Owner, 2026-08-23: *"the suggestion should also be very
     intelligent. It should know to whom he can assign it or to whom he could
     not."*

     ⚠️ HOISTED OUT OF THE TASKS TAB, 2026-08-24. The header's Add Task opens the
     same form, so it must offer the same people — a second inline `.map` was how
     one of the two would have quietly kept offering an Admin. */
  const assignablePeople = React.useMemo(
    () =>
      members
        .filter((m) => canAssignTo(currentUser.role, m.role as Role))
        .map((m) => ({ id: m.userId, name: m.fullName, roleTitle: m.projectRole })),
    [members, currentUser.role],
  );

  /* Which of the calendar tab's two grids is showing. 'rhythm' first: it is the
     one the tab is named after, and the one a manager opens the tab to check. */
  const [calendarView, setCalendarView] = React.useState<'rhythm' | 'work'>('rhythm');

  const [creatingContent, setCreatingContent] = React.useState(false);
  const [addingTask, setAddingTask] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  /* Deliverables only — a coordinator's admin task is real work but was never
     part of what the client was promised, so it does not belong in a list headed
     "content". */
  const deliverables = tasks.filter((t) => t.contentKind !== null);

  /* ⚠️ `monthActuals` USED TO BE HERE and is deliberately gone. It pre-computed
     done/missed/pending per date for `MonthRhythm`'s coloured squares. The posting
     calendar that replaced it counts from the same tasks and placements it already
     renders, so the day tints and the chips inside them cannot disagree — which
     they could when one came from a map built here and the other from the rows.
     Deleted rather than left: dead code with a plausible name is worse than none,
     because the next reader assumes something still uses it. */


  return (
    /* ⚠️ DENSITY PASS — owner, 2026-08-20: *"the zoom factor is set to 90… I want that
       view at 100. In short I want to compact everything in such a way that it will show
       the same view at 100."* Every gap on this page dropped one step. Nothing was
       removed and no font went below `text-micro`, because the ask was to fit more on
       the screen, not to say less. */
    <div className="space-y-2.5">
      {/* ---- Header ---- */}
      <div className="space-y-1.5">
        {/* ⚠️ The back link sits on the SAME line as the pills further down rather than
            owning a line of its own — see the note there. What is left here is nothing,
            so the title is the first thing on the page. */}

        {/* ── ⚠️ THE HEADER, REBUILT ────────────────────────────────────────────
            Owner, 2026-08-19: *"This UPI is totally out of place. Make them
            reorganized and redesign this whole thing."* and *"The pills you are
            using for active and starter are not looking good."*

            Was: an uppercase run of "Client · External · ABC Traders" over the name,
            with two hairline outline badges floated right. The eyebrow repeated what
            the pills said, the pills were invisible, and the platforms — the thing
            you actually want to see about a social project — were buried in a text
            list three cards down.

            Now: name, then one row of solid pills that each say a different thing,
            then the brand marks. Nothing is repeated. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <h1 className="text-h1 leading-tight text-text-primary">{project.name}</h1>
              <span className="tabular font-mono text-caption font-semibold text-text-tertiary">
                {project.code}
              </span>
            </div>

            {/* ⚠️ THE BACK LINK LIVES HERE NOW, not on a line of its own above the
                title. Owner, 2026-08-20, asking for the 90%-zoom view at 100%: a link
                with 22px of line box and a gap either side was the cheapest whole line on
                the page to reclaim, and it reads just as well at the head of the pill
                row — where the eye already goes for "what is this project". */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href="/projects"
                className="inline-flex items-center gap-1 rounded-md border border-border-default px-1.5 py-0.5 text-micro font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              >
                <ArrowLeft className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                All projects
              </Link>
              <StatusPill status={project.status} />
              <KindPill kind={project.clientKind} />
              <PackagePill name={project.packageName} />
              <IncludesPills
                website={project.packageIncludesWebsite}
                crm={project.packageIncludesCrm}
              />
              {project.clientName && (
                <span className="text-caption text-text-secondary">{project.clientName}</span>
              )}
            </div>
          </div>

          {/* ── ⚠️ THE PLATFORM STRIP, AND THE MENU BESIDE IT ──────────────────
              Owner, 2026-08-20: *"how the Facebook, Instagram, and TikTok icons are a
              little bit away from each other, not very congested… There is a humble
              button over there where you can maybe add it."*

              So: `gap-2` rather than the strip's default `gap-1`, and the ⋮ menu sits
              beside them. That menu is where a project is EDITED — the owner's other
              question was *"If I want to change any detail related to Daniyal
              Marketing, where can I do that?"* and until now the answer was "only from
              the pencil on the projects list", which is not an answer. */}
          <div className="flex shrink-0 items-center gap-2">
            <PlatformStrip platforms={project.platforms} size={24} gap="gap-2" />
            {canManage && (
              <ProjectMenu
                onEdit={() => setEditing(true)}
                onPlatforms={() => setEditingPlatforms(true)}
                /* `canManage` is `project.edit` — Coordinator and above. Deleting
                   is `project.soft_delete`, which stops at Admin, so it needs its
                   own prop rather than riding along. */
                onDelete={canDelete ? () => setDeleting(true) : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── ⚠️ TABS LEFT, ACTIONS RIGHT, ONE LINE ──────────────────────────────
          Owner, 2026-08-20: *"these buttons or tabs are on the left side. They are
          small, optimized, and very sleek. Create Content, Upload Assets, and Generate
          Report should be parallel on the right side… Right now these are upside
          down."*

          They were. The container already said `justify-between`, but the two groups
          together were wider than the row, so `flex-wrap` sent the buttons onto a
          second line UNDERNEATH the tabs — which reads as the buttons being on the
          left. Two fixes, both needed:

            · `flex-nowrap` on the row, so it can never stack again.
            · Both groups made genuinely smaller — `text-caption` tabs with tighter
              padding, `gap-0.5`, and the tab bar allowed to scroll on a narrow
              viewport rather than pushing the buttons off.

          The buttons keep their own `shrink-0` so a long tab list steals space from
          the tabs, never from the actions. */}
      {/* ⚠️ THE GAP IS `gap-x-6` AND THE TABS GET `pr-2`, BOTH DELIBERATE.
          Owner, 2026-08-20 at 100% zoom: *"the left button and the right button are
          very close to each other, with no space between them."* They were: the tab
          scroller is `flex-1`, so it expanded to fill every pixel up to the buttons and
          the last tab butted against the first button. A gap on the parent is what the
          scroller cannot eat.

          ⚠️ RESPONSIVE BY COLLAPSING LABELS, NOT BY WRAPPING. Owner: *"when I zoom in
          make them responsive. Don't make them overlap."* Zooming shrinks the effective
          viewport, so below `xl` the four action buttons drop their text and keep their
          icons — which frees roughly 260px in one step. `flex-nowrap` means the two
          groups can never stack, and flex layout cannot overlap, so the failure mode is
          the tab strip scrolling: recoverable, and visibly so. */}
      <div className="flex flex-nowrap items-end justify-between gap-x-6 border-b border-border-subtle">
      <nav
        role="tablist"
        aria-label="Project sections"
        className="chrome-scroll -mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-2 pb-0"
      >
        {TABS.map((entry) => {
          const active = entry.key === tab;
          const count =
            entry.key === 'content'
              ? deliverables.length
              : entry.key === 'tasks'
                ? tasks.length
                : entry.key === 'team'
                  ? members.length + 1 // + the owner, who is on the team but not a member row
                  : entry.key === 'access'
                    ? credentials.length
                    : entry.key === 'files'
                      ? documents.length
                      : null;

          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(entry.key)}
              /* Sleeker than before, per the owner: `text-caption` not `text-body-sm`,
                 px-2.5 not px-3.5, and an underline rather than a filled plate — a
                 tinted background on the active tab made eight of them look like eight
                 buttons rather than one bar. */
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-caption font-semibold',
                'transition-colors duration-[120ms] focus-visible:outline-none',
                active
                  ? 'border-[var(--accent-primary)] text-text-brand'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              <entry.icon className="h-[15px] w-[15px]" strokeWidth={2.25} aria-hidden="true" />
              {entry.label}
              {count !== null && count > 0 && (
                <span className="tabular text-micro text-text-tertiary">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

        {/* ⚠️ `shrink-0` — a long tab list must steal room from the tabs, never from
            the actions. That is what keeps them "parallel on the right side" instead
            of being pushed under. */}
        <div className="flex shrink-0 items-center gap-1.5 pb-1.5">
          {/* ── ⚠️ MODALS ON THIS PAGE, NOT LINKS TO ANOTHER ONE ─────────────
              Owner, 2026-08-24: *"when I click on the Add Task button, it will
              not bring me to the task page. It should show a task form popup
              here on the same page… I don't want to go somewhere else."*

              All three used to be `<Link href="/tasks?project=…">`. The note
              that replaced said the component lacked the shell's project and
              person lists — it does not: the server page already passes
              `people`, `currentUser` and the project, because the Tasks tab
              needed exactly the same three to open its own create form. So the
              form opens here, and it is still ONE form: the same `TaskDialog`
              and the same `UploadDialog` the dedicated pages use, with this
              project locked on both. No second copy to drift. */}
          <button
            type="button"
            onClick={() => setCreatingContent(true)}
            title="Plan content for this project"
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-caption font-semibold',
              'bg-[image:var(--gradient-brand)] text-text-on-brand shadow-[var(--shadow-brand-glow)]',
              'hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={ACTION_LABEL}>Create Content</span>
          </button>

          <button
            type="button"
            onClick={() => setAddingTask(true)}
            className={ACTION}
            title="Add a task to this project"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={ACTION_LABEL}>Add Task</span>
          </button>

          {/* ⚠️ Was `setTab('files')` — it changed tab and left the person to
              find the upload control themselves, on a tab that told them to go
              to /documents. It opens the form. */}
          <button
            type="button"
            onClick={() => setUploading(true)}
            className={ACTION}
            title="Upload an asset to this project"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <span className={ACTION_LABEL}>Upload Asset</span>
          </button>

          {/* ⚠️ THIS PROJECT'S REPORTS, NOT THE DIVISION'S. Owner, 2026-08-20:
              *"Generate Report is for reports related to this project."* It pointed at
              /monthly-report, which is the division-wide CEO report — the right report
              for the Reports page and the wrong one here. The menu below opens periods
              scoped to this project. */}
          {/* ⚠️ NOT FOR A MEMBER. Owner, 2026-08-22: *"on the NajuMula side, in
              the project detail, this Generate Report tab doesn't even display
              because they don't need that."*

              A client report is an Admin or Coordinator artefact — it is the
              thing sent outward. A Member seeing the control has one of two
              outcomes, and both are bad: they generate a client-facing document
              nobody asked them for, or they press it and are refused. Removing
              it is the third option. Reporting permissions on the server are
              unchanged; this is the control, not the boundary. */}
          {currentUser.role !== 'member' && (
            <ReportMenu projectId={project.id} projectName={project.name} today={today} />
          )}
        </div>
      </div>

      {/* ══ OVERVIEW ═══════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <ProjectOverview
          project={project}
          members={members}
          tasks={tasks}
          activity={activity}
          monthStart={monthStart}
          monthLabel={monthLabel}
          months={months}
          today={today}
          canSeeFinance={canSeeFinance}
          ownerAvatarUrl={ownerAvatarUrl}
          publishedTodayPlatformIds={publishedTodayPlatformIds}
          packageDetail={packageDetail}
          onAddContent={() => setTab('tasks')}
        />
      )}

      {/* ══ CONTENT & POSTS ════════════════════════════════════════════════════ */}
      {/* ══ CONTENT — HELD BACK ON PURPOSE ═══════════════════════════════════
          Owner, 2026-08-22: *"for the content we will say that it will be coming
          soon… because we are not going to implement any content over there."*

          What was here listed the same deliverables the Tasks tab and the daily
          board already show, in a third arrangement. The owner's objection is
          not that it was broken — it is that three views of one list is what
          makes the system feel heavy to a team who are social media managers
          rather than project managers.

          The old panel is directly below and still compiles; it is unreachable
          rather than deleted, so bringing it back is removing this block. */}
      {/* ══ CONTENT ════════════════════════════════════════════════════════════
          Not built. The planning surface the owner has in mind — a month of posts
          with captions, assets and approvals — is its own piece of work, and the
          `Create Content` button in the header opens the same notice. */}
      {tab === 'content' && (
        <ComingSoon
          icon={Share2}
          title="Content planning"
          description={
            <>
              A month of posts in one place — caption, asset and approval per slot, laid out
              against the agreed rhythm. It is not built yet, so nothing here would be true.
            </>
          }
          bullets={[
            'Plan a month of slots from the posting rhythm, then fill them.',
            'Caption and asset on the slot, so the post is assembled before the day.',
            'An approval step before anything is scheduled.',
            'Each slot becomes a task, so the board and this tab stay one truth.',
          ]}
          insteadOf={
            <>
              Until then the day&rsquo;s posts, their links and where the files live are all on the{' '}
              <button
                type="button"
                onClick={() => setTab('tasks')}
                className="font-semibold text-text-brand hover:underline"
              >
                Tasks
              </button>{' '}
              tab.
            </>
          }
        />
      )}

      {false && (
        <Card>
          <CardBody className="space-y-2.5 p-3.5">
            <p className="text-body-sm font-semibold text-text-primary">
              Deliverables
              <span className="ml-2 font-normal text-text-tertiary">
                {deliverables.length} with a content kind set
              </span>
            </p>

            {deliverables.length === 0 ? (
              <p className="text-caption text-text-secondary">
                No deliverables yet. A task counts here once its{' '}
                <span className="font-semibold text-text-primary">content kind</span> is set on the
                task form — that is what makes it measurable against the target.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {deliverables.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono text-micro text-text-tertiary">
                      {task.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                      {task.title}
                    </span>
                    {task.contentKind && (
                      <Badge token="accent-primary" size="sm" variant="outline">
                        {CONTENT_KIND_LABEL[task.contentKind]}
                      </Badge>
                    )}
                    {task.publishedOn ? (
                      <span className="text-micro text-text-tertiary">{task.publishedOn}</span>
                    ) : (
                      <span className="text-micro" style={{ color: 'var(--feedback-warning)' }}>
                        not published
                      </span>
                    )}
                    <span className="tabular text-micro text-text-tertiary">
                      {task.placementLiveCount}/{task.placementCount} live
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {/* ══ CALENDAR ═══════════════════════════════════════════════════════════
          ⚠️ TWO CALENDARS, SWITCHED — NOT TWO CALENDARS STACKED.
          Owner, 2026-08-24: *"is it possible that instead of scrolling down I
          should be able to switch tabs over here in this calendar tab? The
          posting month: then I switch to the Work Due This Month tab, in which
          the calendars will be switching."*

          They were rendered one under the other, so the second was below the
          fold on every laptop — which is why the first thing seen was an
          apparently empty month grid with the actual work hidden underneath it.
          Two grids of that height never coexist on one screen; they compete.

          They answer genuinely different questions and both are worth keeping:
          the RHYTHM (what the agreed cadence implies, coloured by what happened)
          and the WORK (tasks on the days they are due). So it is one control and
          one grid at a time. */}
      {tab === 'calendar' && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {calendarView === 'rhythm' ? 'The posting month' : 'Work due this month'}
            </CardTitle>
            <ToggleGroup
              label="Calendar view"
              value={calendarView}
              onChange={(next) => setCalendarView(next as 'rhythm' | 'work')}
              options={[
                { key: 'rhythm', label: 'Posting month' },
                { key: 'work', label: 'Work due' },
              ]}
            />
          </CardHeader>
          <CardBody className="p-3.5 pt-0">
            {calendarView === 'rhythm' ? (
              <>
                {/* ── ⚠️ REPLACES `MonthRhythm` FOR THIS VIEW ─────────────────
                    Owner, 2026-08-24, with a mockup: *"I want every posting month
                    to display everything like this"* — each day stacking its posts
                    as chips with the platform logo and the time.

                    `MonthRhythm` drew the agreed cadence as one tint per day. That
                    answered "are we keeping to the rhythm" and could not answer
                    "what went out on the 13th", which is what the mockup is about
                    and why the tab read as empty even with posts in it.

                    ⚠️ The cadence is still passed in, and still used: `monthPlan`
                    inside the grid marks a day the contract wanted and which has
                    nothing filed — the owner's *"some days with absent"*. Dropping
                    the plan would have made an ordinary quiet Tuesday and a missed
                    one look identical.

                    ⚠️ `monthActuals` is no longer needed here. The grid counts from
                    the tasks and placements it is already given, so the day tints
                    and the chips cannot disagree — which they could when one came
                    from a pre-computed map and the other from the rows. */}
                <PostingCalendar
                  tasks={calendarTasks}
                  placements={placements}
                  cadence={{
                    staticPostsPerDay: project.staticPostsPerDay,
                    reelsPerWeek: project.reelsPerWeek,
                    reelDays: project.reelDays as never,
                    postingDays: project.postingDays as never,
                  }}
                  monthStart={monthStart}
                  today={today}
                  months={months}
                  /* The month goes in the URL, so a month is a place you can send
                     somebody — the same reason the project is a route and not a
                     drawer, and the same query parameter the Overview's month
                     picker already writes. */
                  onMonth={(next) => router.push(`/projects/${project.id}?month=${next}`)}
                />
              </>
            ) : (
              /* The same `CalendarView` the Calendar page uses, scoped to this
                 project — so the two screens cannot drift, and paging to another
                 month stays inside the project. `canSeeOthers` is false because a
                 person filter would be a second way to ask a question this tab has
                 already answered by being a project. */
              <CalendarView
                initialTasks={calendarTasks}
                initialYear={Number(monthStart.slice(0, 4))}
                initialMonth={Number(monthStart.slice(5, 7))}
                todayIso={today}
                people={[]}
                currentUserId={currentUser.id}
                canSeeOthers={false}
                projectId={project.id}
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ══ TASKS ══════════════════════════════════════════════════════════════
          EVERY task, not only the deliverables the Content tab lists. A
          coordinator's admin work is real and belongs somewhere — it is simply not
          countable against a package target, which is why the two tabs differ. */}
      {/* ══ TASKS ═════════════════════════════════════════════════════════════
          Was five columns of raw database values with no filter of any kind —
          `status.replace(/_/g,' ')` printed the enum and `dueDate` printed an ISO
          string. Owner, 2026-08-22: *"it is just like a sheet you are showing
          me… I have to read it very carefully, like Google Sheets. I don't want
          that."* Moved to its own component; see the note there for what
          actually changed and why it is still a table. */}
      {tab === 'tasks' && (
        <ProjectTasksTab
          tasks={tasks}
          project={{ id: project.id, name: project.name, type: project.type, code: project.code }}
          today={today}
          currentUser={currentUser}
          /* See `assignablePeople` — members only, and rank-filtered. */
          people={assignablePeople}
          daily={
            <DailyBoard
              tasks={tasks}
              placements={placements}
              platforms={project.platforms}
              driveFolders={driveFolders}
              projectId={project.id}
              today={today}
              lookbackFrom={dailyLookbackFrom}
            />
          }
        />
      )}

      {/* ══ ANALYTICS ══════════════════════════════════════════════════════════
          ⚠️ DELIBERATELY NOT FAKED. The mockup shows the tab but not its contents, and
          the honest answer is that per-platform reach and engagement are not in this
          database — nothing reads Meta's or TikTok's APIs yet. Charts drawn from
          invented numbers on a page the owner forwards to a client is the one outcome
          worse than an empty tab, so this says what it needs and what it would take.

          What IS available is stated, because it is not nothing: the placement links
          per platform, which is the seed a real analytics tab would grow from. */}
      {/* ══ ANALYTICS ══════════════════════════════════════════════════════════
          ⚠️ NO PLACEHOLDER CHART HERE, EVER. Reach and engagement live inside
          Meta, TikTok and YouTube and this CRM does not read them — a
          demonstration chart on this tab is the one thing on the page somebody
          would screenshot and send to a client. */}
      {tab === 'analytics' && (
        <ComingSoon
          icon={BarChart3}
          title="Performance analytics"
          description={
            <>
              Reach, impressions and engagement live inside Meta, TikTok and YouTube. This CRM
              does not read them yet, so there is no figure here that would be true.
            </>
          }
          bullets={[
            'Reach and engagement per post, pulled from each platform’s insights API.',
            'Best day and best format, from this project’s own history.',
            'Month against month, so a dip is visible before a client mentions it.',
          ]}
          insteadOf={
            <>
              What the system does hold is every published post and its live link, which is what
              the{' '}
              <Link href="/monthly-report" className="font-semibold text-text-brand hover:underline">
                monthly report
              </Link>{' '}
              is built from. Connecting a platform&rsquo;s insights API is its own piece of
              work — say the word.
            </>
          }
        />
      )}

      {/* ══ TEAM ═══════════════════════════════════════════════════════════════
          Extracted to its own component on 2026-08-24 and rebuilt — see the note
          there for what was wrong with the list this replaced. */}
      {tab === 'team' && (
        <ProjectTeamTab
          projectId={project.id}
          ownerId={project.ownerId ?? null}
          members={members}
          people={people}
          canManage={canManage}
          currentUser={currentUser}
          onChanged={() => router.refresh()}
        />
      )}

      {/* ══ CREDENTIALS ════════════════════════════════════════════════════════ */}
      {tab === 'access' && (
        <ProjectCredentials
          credentials={credentials}
          projectId={project.id}
          projectName={project.name}
          /* ⚠️ Passed whole, not narrowed to `{id, name}` as it was. The panel's
             "who can see this" stack is built from `role` — access to a credential
             is rank since migration 047 — and it needs `avatarUrl` to be a row of
             faces rather than a row of initials. */
          people={people}
          canManage={canManage}
          canGrant={canGrantCredentials}
          nowMs={nowMs}
        />
      )}

      {/* ══ FILES ══════════════════════════════════════════════════════════════
          Extracted and rebuilt on 2026-08-24 — see the note in that component for
          what the list this replaces failed to offer. */}
      {tab === 'files' && (
        <ProjectFilesTab
          documents={documents}
          projectName={project.name}
          /* ⚠️ `document.manage`, NOT the page's `canManage` (`project.edit`).
             They differ for exactly the role this matters for: `project.edit` is
             Coordinator and above, and so is `document.manage` — but they are
             separate permissions and conflating them would silently move file
             deletion whenever either one is re-scoped. Owner, 2026-08-24: *"only
             in the admin and team coordinator access."* */
          canManage={canManageDocuments}
          nowMs={nowMs}
          onUpload={() => setUploading(true)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* ── The two dialogs the header menu opens ───────────────────────────────
          Owner, 2026-08-20: *"If I want to change any detail or anything related to
          Daniyal Marketing, where can I do that? Is there any place?"* Until now the
          only way in was the pencil on the projects LIST — you had to leave the page
          you were looking at to edit it. */}
      {editing && (
        <ProjectDialog
          open
          onClose={() => setEditing(false)}
          people={people.map((person) => ({ id: person.id, name: person.name }))}
          project={project}
          canSeeFinance={canSeeFinance}
        />
      )}

      {/* ── ⚠️ CREATE CONTENT SAYS SO, RATHER THAN QUIETLY DOING NOTHING ──────
          Owner, 2026-08-24: *"the Content tab, or this Create Content button, is
          coming soon. Right now we have not implemented this feature. When you
          click on this Create Content button, the modal pops up and shows that it
          will be a Coming Soon feature."*

          It used to navigate to /tasks?project=… — a primary, brand-coloured
          button whose label promised content planning and delivered the task
          board. The notice is the honest version, and it offers the two things
          that DO exist rather than being a dead end. */}
      <Dialog
        open={creatingContent}
        onClose={() => setCreatingContent(false)}
        size="sm"
        title="Content planning"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setCreatingContent(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setCreatingContent(false);
                setAddingTask(true);
              }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              Add a task instead
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-bold tracking-[0.08em] uppercase"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
              color: 'color-mix(in oklab, var(--accent-primary) 88%, var(--text-primary))',
            }}
          >
            <Sparkles className="size-3" strokeWidth={2.25} aria-hidden="true" />
            Coming soon
          </p>
          <p className="text-caption leading-relaxed text-text-secondary">
            A month of posts in one place &mdash; caption, asset and approval per slot, laid out
            against{' '}
            <span className="font-semibold text-text-primary">{project.name}</span>&rsquo;s agreed
            rhythm. It is not built yet, so nothing it showed would be true.
          </p>
          <p className="text-caption leading-relaxed text-text-secondary">
            Until it is, a post is an ordinary task with a content kind set &mdash; that is what
            makes it countable against the monthly target, and what the Content Pipeline on the
            Overview is built from.
          </p>
        </div>
      </Dialog>

      {/* ── ADD TASK AND UPLOAD, BOTH LOCKED TO THIS PROJECT ──────────────────
          `lockedProjectId` on both, so neither can file work against a different
          project than the page it was opened from. Same components the /tasks and
          /documents pages use. */}
      <TaskDialog
        open={addingTask}
        onClose={() => setAddingTask(false)}
        projects={[{ id: project.id, name: project.name, type: project.type, code: project.code }]}
        people={assignablePeople}
        currentUser={currentUser}
        lockedProjectId={project.id}
      />

      {uploading && (
        <UploadDialog
          projects={[{ id: project.id, name: project.name }]}
          /* ⚠️ Empty, deliberately — and now doubly so. The folder picker narrows
             to folders this person may file into, and that list is built on the
             Documents page from `listFolders` plus each folder's access level;
             passing an unfiltered list here would offer folders the server then
             refuses. With the destination locked to the bucket below, a Drive
             folder would be meaningless here anyway. */
          folders={[]}
          initialFolderId={null}
          lockedProjectId={project.id}
          lockedProjectName={project.name}
          /* ── ⚠️ THE PROJECT'S FILES GO IN THE BUCKET. NOT A DEFAULT — A LOCK ──
             Owner, 2026-08-24: *"in the File tab… the file which is uploaded over
             there will only be saved in the bucket, right? It will not be saved in
             Google Drive."*

             A pre-selected radio would still let somebody send a client's asset to
             Drive from a tab whose own footnote promises it does not. The choice
             exists on the Documents page, which is where choosing is the job. */
          lockedDestination="bucket"
          /* Irrelevant while the destination is locked to the bucket, and passed
             honestly rather than as `true`: if the lock is ever lifted here, a
             hardcoded `true` would offer a Drive radio that cannot work. */
          driveConnected={false}
          canApprove={canApproveDocuments}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            router.refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteProjectDialog
          project={{ id: project.id, name: project.name }}
          onClose={() => setDeleting(false)}
        />
      )}

      <PlatformLinksDialog
        open={editingPlatforms}
        onClose={() => setEditingPlatforms(false)}
        projectId={project.id}
        projectName={project.name}
        platforms={project.platforms.map((platform) => ({
          id: platform.id,
          name: platform.name,
          slug: platform.slug,
          pageUrl: platform.pageUrl,
          handle: platform.handle,
        }))}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * THE HEADER MENU
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-20: *"There is a humble button over there where you can maybe add
 * it. These three buttons should be above and parallel to the platform icons, where
 * we can edit any detail."*
 *
 * ── ⚠️ `<details>`, NOT A HAND-ROLLED POPOVER ─────────────────────────────────
 * Escape closes it, clicking the summary toggles it, and it is keyboard reachable —
 * all from the browser, with no state, no outside-click listener and no focus trap to
 * get wrong. The one thing it does not do natively is close when you click an item,
 * which is why each button closes the parent explicitly.
 * ------------------------------------------------------------------------- */
/**
 * Deleting a project, with the consequences counted before the button.
 *
 * ⚠️ THE NAME HAS TO BE TYPED. Owner request 2026-09-02, and this is the one
 * control in the product that destroys a client's whole record — tasks,
 * documents, unsent invoices — with no undo. A plain "are you sure" is a reflex;
 * typing the name is a decision. The same reason a bank asks you to re-key an
 * account number.
 */
function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: { id: string; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const matches = typed.trim() === project.name;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Delete ${project.name}?`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant="danger"
            size="md"
            disabled={!matches || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const result = await deleteProjectAction(project.id);
              setBusy(false);
              if (!result.ok) {
                setError(result.error ?? 'That project could not be deleted.');
                return;
              }
              /* Back to the list: the page we are on no longer exists. */
              router.push('/projects');
              router.refresh();
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Delete for ever
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {error}
          </p>
        )}

        <p className="text-body-sm text-text-secondary">
          Everything filed under this project goes with it — its tasks, its documents and any
          invoice that has not been sent. <strong className="text-text-primary">There is no
          undo.</strong>
        </p>

        <p className="text-body-sm text-text-secondary">
          An invoice already sent to the client will stop this: void it first, so your copy and
          theirs still agree.
        </p>

        <Field
          label={`Type “${project.name}” to confirm`}
          htmlFor="confirm-name"
          hint="Exactly as it is written above."
        >
          <Input
            id="confirm-name"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={project.name}
            autoComplete="off"
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ProjectMenu({
  onEdit,
  onPlatforms,
  onDelete,
}: {
  onEdit: () => void;
  onPlatforms: () => void;
  /** Absent for anybody below Admin — `project.soft_delete`. A destructive item
   *  that is present but refuses is worse than one that is not there. */
  onDelete?: () => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Edit this project"
        title="Edit this project"
        className={cn(
          'grid h-8 w-8 cursor-pointer place-items-center rounded-md text-text-secondary',
          'marker:content-none hover:bg-bg-hover hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreVertical className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div className="absolute right-0 z-20 mt-1 w-[13rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]">
        <button
          type="button"
          onClick={() => {
            close();
            onEdit();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        >
          <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Edit project details
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            onPlatforms();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        >
          <LinkIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Platform pages &amp; handles
        </button>

        {/* ⚠️ SEPARATED BY A RULE, AND LAST. Everything above changes a detail;
            this destroys the project and everything filed under it. The divider
            is not decoration — it is the pause between "edit" and "delete" that
            stops a misaimed click. */}
        {onDelete && (
          <>
            <div className="my-1 border-t border-border-subtle" />
            <button
              type="button"
              onClick={() => {
                close();
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption hover:bg-bg-hover"
              style={{ color: 'var(--feedback-error)' }}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              Delete this project
            </button>
          </>
        )}
      </div>
    </details>
  );
}

