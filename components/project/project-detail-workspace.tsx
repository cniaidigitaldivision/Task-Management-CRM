'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
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
import type { ProjectMemberRow } from '@/lib/db/queries/projects';
import type { ProjectRow, TaskRow } from '@/lib/db/queries/types';
import { CONTENT_KIND_LABEL } from '@/lib/domain/constants';
import { WEEKDAY_LABEL } from '@/lib/domain/cadence';
import {
  VERDICT_LABEL,
  VERDICT_TOKEN,
  projectProgress,
} from '@/lib/domain/project-progress';
import {
  addProjectMemberAction,
  removeProjectMemberAction,
} from '@/app/actions/projects';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { MonthRhythm } from './month-rhythm';
import { ProjectCredentials } from './project-credentials';
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

type Tab = 'overview' | 'content' | 'team' | 'credentials' | 'documents';

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: typeof Users }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'content', label: 'Content & posts', icon: Share2 },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'credentials', label: 'Credentials', icon: KeyRound },
  { key: 'documents', label: 'Documents', icon: FileText },
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

function money(pkr: number | null): string {
  if (pkr === null) return '—';
  /* Locale passed explicitly — an argless `toLocaleString()` formats differently on
     the server and in the browser and React reports it as a hydration mismatch. */
  return `PKR ${pkr.toLocaleString('en-PK')}`;
}

/**
 * "1 a day, 2 reels a week" — the commitment in the words somebody agreed it in.
 *
 * ⚠️ Distinguishes null from 0. "No rhythm agreed" and "agreed to post nothing" are
 * different statements, and the second one is a real thing a paused retainer might
 * say. The same rule the schema and every report follow.
 */
function rhythmSentence(staticPerDay: number | null, reelsPerWeek: number | null): string {
  const parts: string[] = [];
  if (staticPerDay !== null) {
    parts.push(staticPerDay === 0 ? 'no daily posts' : `${staticPerDay} a day`);
  }
  if (reelsPerWeek !== null) {
    parts.push(
      reelsPerWeek === 0
        ? 'no reels'
        : `${reelsPerWeek} reel${reelsPerWeek === 1 ? '' : 's'} a week`,
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing agreed';
}

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
  today,
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
  today: string;
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

  const progress = projectProgress({
    assetsPublished: project.assetsPublishedThisMonth,
    reelsPublished: project.reelsPublishedThisMonth,
    assetsTargetMin: project.assetsTargetMin,
    assetsTargetMax: project.assetsTargetMax,
    reelsTargetMin: project.reelsTargetMin,
  });

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

      {/* ---- Tabs ---- */}
      <nav
        role="tablist"
        aria-label="Project sections"
        className="flex flex-wrap items-center gap-1 border-b border-border-subtle pb-1"
      >
        {TABS.map((entry) => {
          const active = entry.key === tab;
          const count =
            entry.key === 'content'
              ? deliverables.length
              : entry.key === 'team'
                ? members.length
                : entry.key === 'credentials'
                  ? credentials.length
                  : entry.key === 'documents'
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

      {/* ══ OVERVIEW ═══════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* THE QUESTION THE PAGE EXISTS TO ANSWER, FIRST. */}
          <Card lit>
            <CardBody className="space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-body-sm font-semibold text-text-primary">This month</h2>
                <Badge token={VERDICT_TOKEN[progress.verdict]} size="sm" variant="outline">
                  {VERDICT_LABEL[progress.verdict]}
                </Badge>
              </div>

              <p className="text-caption text-text-secondary">{progress.summary}</p>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between text-micro">
                    <span className="text-text-secondary">Assets published</span>
                    <span className="tabular text-text-primary">
                      {project.assetsPublishedThisMonth}
                      {project.assetsTargetMin !== null && ` / ${project.assetsTargetMin}`}
                      {project.assetsTargetMax !== null &&
                        project.assetsTargetMax !== project.assetsTargetMin &&
                        ` (up to ${project.assetsTargetMax})`}
                    </span>
                  </div>
                  {/* ⚠️ A bar is only drawn when there is a target. A full bar
                      against no target would read as success; an empty one as
                      failure. Neither is true, so neither is shown. */}
                  {progress.assetsPercent !== null ? (
                    <ProgressBar
                      value={progress.assetsPercent}
                      token={VERDICT_TOKEN[progress.verdict]}
                    />
                  ) : (
                    <p className="text-micro text-text-tertiary">
                      No monthly minimum agreed, so there is nothing to measure against.
                    </p>
                  )}
                </div>

                {project.reelsTargetMin !== null && (
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between text-micro">
                      <span className="text-text-secondary">
                        Reels{' '}
                        <span className="text-text-tertiary">— counted inside the total</span>
                      </span>
                      <span className="tabular text-text-primary">
                        {project.reelsPublishedThisMonth} / {project.reelsTargetMin}
                      </span>
                    </div>
                    <ProgressBar
                      value={progress.reelsPercent ?? 0}
                      token={
                        progress.reelsRemaining > 0 ? 'feedback-warning' : 'feedback-success'
                      }
                    />
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* ── ⚠️ THE RHYTHM, AS A MONTH ────────────────────────────────────────
              Owner: *"This one, it's a monthly chart. This one is very interactive,
              very sleek and beautifully represented overall, graphically."* and
              *"make it empty, like a Sunday… mention that this is Sunday."*

              This replaced nothing — the old Overview had no picture of the month at
              all, which is why it read as a pile of labels. */}
          <Card>
            <CardHeader>
              <CardTitle>The month</CardTitle>
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

          {/* ── ⚠️ ACCOUNTABILITY: OWNER IS NOT "ASSIGNED TO" ────────────────────
              Owner, 2026-08-19: *"Who is the project owner? Who is on this project or
              assigned to Kashif Ahmad? He is not the owner; he is assigned, assigned
              by Kashif Ahmad or someone like that."*

              The old Overview had a single `Fact` labelled "Owner" showing
              `ownerName`, which is genuinely ambiguous — it could mean the person
              accountable for the project or the person the work landed on. They are
              different people and the distinction is the whole point of the Team tab.

              So this says ACCOUNTABLE, in words, and names the members separately
              underneath. The column is still `owner_id`; only the label changed. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Accountable</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 p-4 pt-0">
                <div className="flex items-center gap-2.5">
                  <Avatar name={project.ownerName ?? 'Unassigned'} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-text-primary">
                      {project.ownerName ?? 'Nobody yet'}
                    </p>
                    <p className="text-micro text-text-tertiary">
                      owns this project — answers for it
                    </p>
                  </div>
                </div>

                <div className="border-t border-border-subtle pt-2.5">
                  <p className="text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    Also working on it
                  </p>
                  {members.length === 0 ? (
                    <p className="mt-1 text-micro text-text-secondary">
                      Nobody else added. Use the Team tab.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {members.map((member) => (
                        <span
                          key={member.userId}
                          className="inline-flex items-center gap-1.5 rounded-full bg-bg-subtle py-0.5 pl-0.5 pr-2"
                          /* ⚠️ `projectRole` (Content, Design, Ads…), not `role` —
                             `role` is the person's SYSTEM role and would label a
                             designer "member" on a card about who does what here.

                             `addedByName` answers the owner's other question directly:
                             *"he is not the owner; he is assigned, assigned by Kashif
                             Ahmad."* Who put somebody on a project is a different fact
                             from who is accountable for it. */
                          title={
                            `${member.fullName} — ${PROJECT_ROLE_LABEL[member.projectRole] ?? member.projectRole}` +
                            (member.addedByName ? ` · added by ${member.addedByName}` : '')
                          }
                        >
                          <Avatar name={member.fullName} size="xs" />
                          <span className="text-micro font-medium text-text-secondary">
                            {member.fullName}
                          </span>
                          <span className="text-micro text-text-tertiary">
                            {PROJECT_ROLE_LABEL[member.projectRole] ?? member.projectRole}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* ---- What was sold ----
                ⚠️ The fee is gated on `project.view_finance`, and the value is also
                stripped server-side before it reaches this component — see
                lib/view/project-finance.ts. Two gates because not rendering a field
                is not the same as not sending it, which a check of the real HTML on
                /projects proved the hard way. */}
            <Card>
              <CardHeader>
                <CardTitle>What was sold</CardTitle>
              </CardHeader>
              <CardBody className="grid gap-x-5 gap-y-3 p-4 pt-0 sm:grid-cols-2">
                <Fact label="Package" value={project.packageName ?? 'Customized'} />
                {canSeeFinance && <Fact label="Monthly fee" value={money(project.monthlyFeePkr)} />}
                <Fact
                  label="Rhythm"
                  value={rhythmSentence(project.staticPostsPerDay, project.reelsPerWeek)}
                />
                <Fact
                  label="Promised a month"
                  value={
                    project.assetsTargetMin === null
                      ? 'Nothing agreed'
                      : `${project.assetsTargetMin} assets${
                          project.reelsTargetMin ? `, ${project.reelsTargetMin} reels` : ''
                        }`
                  }
                />
                <Fact label="Started" value={project.startDate ?? '—'} />
                <Fact
                  label="Posting days"
                  value={
                    project.postingDays.length === 0
                      ? 'None'
                      : project.postingDays
                          .map((d) => WEEKDAY_LABEL[d as 1 | 2 | 3 | 4 | 5 | 6 | 7])
                          .join(' ')
                  }
                />
              </CardBody>
            </Card>
          </div>

          {/* ⚠️ The description card is gone from here. Owner: *"Try to use less
              text. You are adding a lot of text. It's not text; it's a dashboard, a
              CRM."* A paragraph nobody edits, sitting under the figures, was the
              clearest example of that. It is still on the project and still editable
              in the dialog; it simply does not get a card of its own on the screen
              whose job is to show numbers. */}
        </div>
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
      {tab === 'credentials' && (
        <ProjectCredentials
          credentials={credentials}
          projectId={project.id}
          projectName={project.name}
          people={people.map((person) => ({ id: person.id, name: person.name }))}
          canManage={canManage}
        />
      )}

      {/* ══ DOCUMENTS ══════════════════════════════════════════════════════════ */}
      {tab === 'documents' && (
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
        {label}
      </p>
      <p className="text-body-sm text-text-primary">{value}</p>
    </div>
  );
}
