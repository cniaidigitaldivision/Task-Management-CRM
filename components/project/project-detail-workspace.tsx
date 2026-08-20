'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ListChecks,
  MoreVertical,
  Link2 as LinkIcon,
  Pencil,
  Plus,

  Upload,
  ExternalLink,
  FileText,
  Folder,
  KeyRound,
  LayoutDashboard,
  Share2,
  Trash2,
  UserPlus,
  Users,
  Loader2,
} from 'lucide-react';

import type { CredentialRow } from '@/lib/db/queries/credentials';
import type { DocumentRow } from '@/lib/db/queries/documents';
import type { ActivityRow } from '@/lib/db/queries/types';
import type { ProjectMemberRow } from '@/lib/db/queries/projects';
import type { ProjectRow, TaskRow } from '@/lib/db/queries/types';
import { CONTENT_KIND_LABEL } from '@/lib/domain/constants';
import {
  addProjectMemberAction,
  removeProjectMemberAction,
} from '@/app/actions/projects';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { MonthRhythm } from './month-rhythm';
import type { PackageDetail } from './contract-dialog';
import { ProjectCredentials } from './project-credentials';
import { ProjectDialog } from './project-dialog';
import { PlatformLinksDialog } from './platform-links-dialog';
import { ProjectOverview } from './project-overview';
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

const PROJECT_ROLE_LABEL: Record<string, string> = {
  manager: 'Manager',
  content: 'Content',
  design: 'Design',
  development: 'Development',
  ads: 'Ads',
  video: 'Video',
  other: 'Other',
};

/** The secondary action buttons on the tab row. One string so the three of them
 *  cannot drift apart by a pixel. */
const ACTION =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-default px-2 py-1.5 text-caption font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary';

/** The label inside an action button. Hidden below `xl`, so a zoomed-in viewport gets
 *  four icons instead of four crowded buttons. `title` on the button keeps them
 *  identifiable when the text is gone — an icon-only control with no tooltip is a
 *  guessing game. */
const ACTION_LABEL = 'hidden xl:inline';

/** Shared table cell classes, so the Tasks and Content tables line up. */
const TH =
  'px-3 py-2 text-left text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary';
const TD = 'px-3 py-2 align-top text-caption text-text-secondary';

export function ProjectDetailWorkspace({
  project,
  members,
  tasks,
  credentials,
  documents,
  people,
  canManage,
  canSeeFinance,
  monthStart,
  monthLabel,
  months,
  today,
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
  people: readonly { id: string; name: string; role: string }[];
  canManage: boolean;
  /** `project.view_finance` — Admin and above. The fee is ALSO stripped server-side
   *  before it reaches this component; see lib/view/project-finance.ts for why both. */
  canSeeFinance: boolean;
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

  /* Team editing state. `busy` holds the id being changed so only that row's
     control shows a spinner, rather than the whole list freezing. */
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState('');

  /* The two dialogs this page can open. Owner, 2026-08-20 asked where a project is
     edited — the answer was "only the pencil on the projects list", which is not an
     answer, so the header menu opens them here. */
  const [editing, setEditing] = React.useState(false);
  const [editingPlatforms, setEditingPlatforms] = React.useState(false);
  const [addingRole, setAddingRole] = React.useState('content');

  /** Run a member change, surface any refusal, and refresh the server data.
   *  `router.refresh()` rather than local state: membership changes VISIBILITY,
   *  so the whole page's data can legitimately differ afterwards. */
  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setNote(null);
    try {
      const result = await fn();
      if (!result.ok) setNote(result.error ?? 'That could not be saved.');
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  /* Deliverables only — a coordinator's admin task is real work but was never
     part of what the client was promised, so it does not belong in a list headed
     "content". */
  const deliverables = tasks.filter((t) => t.contentKind !== null);


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
          {/* ⚠️ LINKS, not buttons that open a dialog here. `TaskDialog` needs the
              shell's project list, person list and current user — none of which this
              component has, and threading them in only to duplicate the New-task flow
              that /tasks already owns would be a second place for that form to drift.
              So these navigate to the task board filtered to this project, where the
              real control lives. One extra click, no duplicated form, no dead
              button. */}
          <Link
            href={`/tasks?project=${project.id}`}
            title="Create content for this project"
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-caption font-semibold',
              'bg-[image:var(--gradient-brand)] text-text-on-brand shadow-[var(--shadow-brand-glow)]',
              'hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={ACTION_LABEL}>Create Content</span>
          </Link>

          {/* ⚠️ Owner, 2026-08-20: *"the Add Task button is missing."* It was in the
              mockup and I dropped it when I made these links instead of dialogs.
              Both this and Create Content go to the task board filtered to this
              project — the difference is that Create Content is the primary and this
              is not, which is what the mockup shows. */}
          <Link
            href={`/tasks?project=${project.id}`}
            className={ACTION}
            title="Add a task to this project"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={ACTION_LABEL}>Add Task</span>
          </Link>

          <button
            type="button"
            onClick={() => setTab('files')}
            className={ACTION}
            title="Upload an asset"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <span className={ACTION_LABEL}>Upload Asset</span>
          </button>

          {/* ⚠️ THIS PROJECT'S REPORTS, NOT THE DIVISION'S. Owner, 2026-08-20:
              *"Generate Report is for reports related to this project."* It pointed at
              /monthly-report, which is the division-wide CEO report — the right report
              for the Reports page and the wrong one here. The menu below opens periods
              scoped to this project. */}
          <ReportMenu projectId={project.id} projectName={project.name} today={today} />
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
      {tab === 'content' && (
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
          The month grid, on its own tab as the mockup has it. Same component the
          Overview used to embed — one renderer, so the two cannot disagree. */}
      {tab === 'calendar' && (
        <Card>
          <CardHeader>
            <CardTitle>The posting month</CardTitle>
          </CardHeader>
          <CardBody className="p-3.5 pt-0">
            <MonthRhythm
              cadence={{
                staticPostsPerDay: project.staticPostsPerDay,
                reelsPerWeek: project.reelsPerWeek,
                reelDays: project.reelDays as never,
                postingDays: project.postingDays as never,
              }}
              monthStart={monthStart}
              today={today}
            />
          </CardBody>
        </Card>
      )}

      {/* ══ TASKS ══════════════════════════════════════════════════════════════
          EVERY task, not only the deliverables the Content tab lists. A
          coordinator's admin work is real and belongs somewhere — it is simply not
          countable against a package target, which is why the two tabs differ. */}
      {tab === 'tasks' && (
        <Card>
          <CardBody className="p-0">
            {tasks.length === 0 ? (
              <p className="px-4 py-10 text-center text-caption text-text-secondary">
                No tasks in this project yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] border-collapse">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th scope="col" className={TH}>Reference</th>
                      <th scope="col" className={TH}>Task</th>
                      <th scope="col" className={TH}>Status</th>
                      <th scope="col" className={TH}>Assignee</th>
                      <th scope="col" className={TH}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id} className="border-b border-border-subtle last:border-0">
                        <td className={cn(TD, 'whitespace-nowrap font-mono text-micro')}>
                          {task.reference}
                        </td>
                        <td className={cn(TD, 'font-medium text-text-primary')}>{task.title}</td>
                        <td className={TD}>{task.status.replace(/_/g, ' ')}</td>
                        <td className={TD}>{task.assigneeName ?? '—'}</td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{task.dueDate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ══ ANALYTICS ══════════════════════════════════════════════════════════
          ⚠️ DELIBERATELY NOT FAKED. The mockup shows the tab but not its contents, and
          the honest answer is that per-platform reach and engagement are not in this
          database — nothing reads Meta's or TikTok's APIs yet. Charts drawn from
          invented numbers on a page the owner forwards to a client is the one outcome
          worse than an empty tab, so this says what it needs and what it would take.

          What IS available is stated, because it is not nothing: the placement links
          per platform, which is the seed a real analytics tab would grow from. */}
      {tab === 'analytics' && (
        <Card>
          <CardBody className="space-y-3 px-6 py-10 text-center">
            <BarChart3
              className="mx-auto h-6 w-6 text-text-tertiary"
              strokeWidth={1.9}
              aria-hidden="true"
            />
            <p className="text-body-sm font-semibold text-text-primary">
              Nothing to chart yet
            </p>
            <p className="mx-auto max-w-[40rem] text-caption text-text-secondary">
              Reach, impressions and engagement live inside Meta, TikTok and YouTube — this
              CRM does not read them yet, so there is nothing here that would be true. What it
              does hold is every published post and its live link, which is what the{' '}
              <Link href="/monthly-report" className="font-semibold text-text-brand hover:underline">
                monthly report
              </Link>{' '}
              is built from.
            </p>
            <p className="text-micro text-text-tertiary">
              Connecting a platform&rsquo;s insights API is its own piece of work — say the word.
            </p>
          </CardBody>
        </Card>
      )}

      {/* ══ TEAM ═══════════════════════════════════════════════════════════════ */}
      {tab === 'team' && (
        <Card>
          <CardBody className="space-y-2.5 p-3.5">
            <p className="text-body-sm font-semibold text-text-primary">Who is accountable</p>

            {/* ⚠️ Naming somebody here also GRANTS THEM SIGHT of the project —
                `app.project_is_visible` consults this table (migration 033). So
                the copy says so, because a control that silently changes access
                is one people use without realising what they did. */}
            <p className="text-micro text-text-tertiary">
              Anyone named here can see this project even before they hold a task on it, and is
              who a report names when it is late.
            </p>

            {members.length === 0 ? (
              <p className="text-caption text-text-secondary">
                Nobody named yet. Until somebody is, &ldquo;who is responsible for this
                project&rdquo; can only be guessed from who happens to hold a task on it.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                      {m.fullName}
                    </span>

                    {canManage ? (
                      <Select
                        aria-label={`${m.fullName}'s role on this project`}
                        value={m.projectRole}
                        disabled={busy !== null}
                        options={Object.entries(PROJECT_ROLE_LABEL).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                        onChange={(event) =>
                          void run(m.userId, () =>
                            addProjectMemberAction(project.id, m.userId, event.target.value),
                          )
                        }
                      />
                    ) : (
                      <Badge token="accent-primary" size="sm" variant="outline">
                        {PROJECT_ROLE_LABEL[m.projectRole] ?? m.projectRole}
                      </Badge>
                    )}

                    {m.addedByName && (
                      <span className="text-micro text-text-tertiary">
                        added by {m.addedByName}
                      </span>
                    )}

                    {canManage && (
                      <IconButton
                        variant="deleteGhost"
                        size="sm"
                        label={`Remove ${m.fullName} from this project`}
                        icon={Trash2}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(m.userId, () =>
                            removeProjectMemberAction(project.id, m.userId),
                          )
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
                <Field label="Add somebody" htmlFor="addMember" className="basis-56 grow">
                  <Select
                    id="addMember"
                    value={adding}
                    disabled={busy !== null}
                    options={[
                      { value: '', label: 'Choose a person…' },
                      /* Already-named people are excluded: changing their role is
                         what the row's own dropdown is for, and offering them
                         here would look like a way to add them twice. */
                      ...people
                        .filter((p) => !members.some((m) => m.userId === p.id))
                        .map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={(event) => setAdding(event.target.value)}
                  />
                </Field>

                <Field label="As" htmlFor="addMemberRole" className="basis-40">
                  <Select
                    id="addMemberRole"
                    value={addingRole}
                    disabled={busy !== null}
                    options={Object.entries(PROJECT_ROLE_LABEL).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    onChange={(event) => setAddingRole(event.target.value)}
                  />
                </Field>

                <Button
                  variant="secondary"
                  size="md"
                  disabled={busy !== null || !adding}
                  onClick={() => {
                    const id = adding;
                    setAdding('');
                    void run(id, () => addProjectMemberAction(project.id, id, addingRole));
                  }}
                >
                  {busy === adding && adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                  )}
                  Add
                </Button>
              </div>
            )}

            {note && (
              <p className="text-caption" style={{ color: 'var(--feedback-error)' }}>
                {note}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* ══ CREDENTIALS ════════════════════════════════════════════════════════ */}
      {tab === 'access' && (
        <ProjectCredentials
          credentials={credentials}
          projectId={project.id}
          projectName={project.name}
          people={people.map((person) => ({ id: person.id, name: person.name }))}
          canManage={canManage}
        />
      )}

      {/* ══ DOCUMENTS ══════════════════════════════════════════════════════════ */}
      {tab === 'files' && (
        <Card>
          <CardBody className="space-y-2.5 p-3.5">
            <p className="text-body-sm font-semibold text-text-primary">Documents</p>

            {documents.length === 0 ? (
              <p className="text-caption text-text-secondary">
                Nothing filed against this project yet. Uploads happen on{' '}
                <Link href="/documents" className="font-semibold text-text-brand hover:underline">
                  Documents
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Folder
                      className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                      {d.name}
                    </span>
                    <Badge
                      token={
                        d.state === 'approved'
                          ? 'feedback-success'
                          : d.state === 'rejected'
                            ? 'feedback-error'
                            : 'feedback-warning'
                      }
                      size="sm"
                      variant="outline"
                    >
                      {d.state === 'approved' ? 'In Drive' : d.state === 'rejected' ? 'Refused' : 'Waiting'}
                    </Badge>
                    {d.driveWebLink && (
                      <a
                        href={d.driveWebLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-micro font-semibold text-text-brand hover:underline"
                      >
                        Open
                        <ExternalLink className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
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
function ProjectMenu({
  onEdit,
  onPlatforms,
}: {
  onEdit: () => void;
  onPlatforms: () => void;
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
      </div>
    </details>
  );
}

