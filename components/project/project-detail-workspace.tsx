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
  Sparkles,
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
import { ProjectCredentials } from './project-credentials';
import { ProjectOverview } from './project-overview';
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
  today,
  activity,
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
  today: string;
  /** This project's and its tasks' history, newest first. */
  activity: readonly ActivityRow[];
}) {
  const [tab, setTab] = React.useState<Tab>('overview');
  const router = useRouter();

  /* Team editing state. `busy` holds the id being changed so only that row's
     control shows a spinner, rather than the whole list freezing. */
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState('');
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
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <div className="space-y-2">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-caption text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
          All projects
        </Link>

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
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <h1 className="text-h1 text-text-primary">{project.name}</h1>
              <span className="tabular font-mono text-caption font-semibold text-text-tertiary">
                {project.code}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
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

          {/* Owner: *"The platform should display proper platform icons."* At 22px
              here rather than the card's 18 — this is the page about this project. */}
          <PlatformStrip platforms={project.platforms} size={22} />
        </div>
      </div>

      {/* ── Tabs, and the actions beside them ──────────────────────────────────
          The owner's mockup puts four buttons on the tab row: Create Content, Add
          Task, Upload Asset, Generate Report.

          ⚠️ Every one of them GOES somewhere real. A row that looks like the picture
          and does nothing is worse than four that work — so Create Content and Add
          Task open the task dialog, Upload Asset switches to the Files tab where the
          uploader lives, and Generate Report links to /monthly-report, which is
          already built. Nothing here is a placeholder. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border-subtle">
      <nav
        role="tablist"
        aria-label="Project sections"
        className="-mb-px flex flex-wrap items-center gap-1 pb-1"
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
              className={cn(
                'flex items-center gap-2 rounded-t-lg px-3.5 py-2 text-body-sm font-semibold',
                'transition-colors duration-[120ms] focus-visible:outline-none',
                active
                  ? 'bg-bg-selected text-text-brand'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              <entry.icon className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              {entry.label}
              {count !== null && count > 0 && (
                <span className="tabular text-micro text-text-tertiary">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

        <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
          {/* ⚠️ LINKS, not buttons that open a dialog here. `TaskDialog` needs the
              shell's project list, person list and current user — none of which this
              component has, and threading them in only to duplicate the New-task flow
              that /tasks already owns would be a second place for that form to drift.
              So these navigate to the task board filtered to this project, where the
              real control lives. One extra click, no duplicated form, no dead
              button. */}
          <Link
            href={`/tasks?project=${project.id}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-semibold',
              'bg-[image:var(--gradient-brand)] text-text-on-brand shadow-[var(--shadow-brand-glow)]',
              'hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
            )}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Create content
          </Link>

          <button
            type="button"
            onClick={() => setTab('files')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <Upload className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Upload asset
          </button>

          <Link
            href="/monthly-report"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <FileText className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Generate report
          </Link>

          {canManage && (
            <IconButton
              label="More project actions"
              icon={MoreVertical}
              size="sm"
              onClick={() => setTab('access')}
            />
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
          today={today}
          canSeeFinance={canSeeFinance}
          onAddContent={() => setTab('tasks')}
        />
      )}

      {/* ══ CONTENT & POSTS ════════════════════════════════════════════════════ */}
      {tab === 'content' && (
        <Card>
          <CardBody className="space-y-3 p-4">
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
          <CardBody className="p-4 pt-0">
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
          <CardBody className="space-y-3 p-4">
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
          <CardBody className="space-y-3 p-4">
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
    </div>
  );
}

