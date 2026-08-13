import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Gauge,
  ListChecks,
  TimerReset,
} from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge, PriorityFlag } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar, SegmentLegend, SegmentedBar, type Segment } from '@/components/ui/progress';
import { requireUser } from '@/lib/auth/current-user';
import { listActivity } from '@/lib/db/queries/feed';
import { listProjects } from '@/lib/db/queries/projects';
import { countTasksByStatus, listTasks } from '@/lib/db/queries/tasks';
import { teamUtilisation, teamWorkload } from '@/lib/db/queries/workload';
import {
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  PROJECT_TYPE_META,
  STATUS_META,
  WORKLOAD_BAND_META,
} from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';
import { listPendingExtensions } from '@/lib/db/queries/task-relations';
import { canDecideExtensions, formatMinutes } from '@/lib/domain/extensions';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = { title: 'Dashboard' };

/* ============================================================================
 * DASHBOARD — doc 10 §7
 * ----------------------------------------------------------------------------
 * Every figure on this page is read from the database and computed by
 * `lib/domain/workload.ts`. Nothing is stored: utilisation is a sum over open
 * tasks, taken fresh (doc 20 — "workload stores nothing").
 *
 * ── THE READING ORDER IS THE DESIGN ──────────────────────────────────────────
 * Researched against Salesforce, Domo and monday.com in session 09, and the
 * consistent pattern was the opposite of what had been built here first:
 *
 *   1. four figures that fit in a glance
 *   2. one primary visualisation — where the work stands
 *   3. what needs a decision today
 *   4. who is overloaded
 *   5. detail, last
 *
 * The earlier version opened with a chart nobody had context for and then five
 * identical-weight blocks 16px apart, which read as a spreadsheet. Sections are
 * numbered and spaced 32px so the eye has somewhere to land.
 * ========================================================================= */

function relative(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* ============================================================================
 * SCOPE — CHANGE-PLAN 7.1
 * ----------------------------------------------------------------------------
 * Owner: *"The dashboard should be narrower or broader according to the role
 * level."*
 *
 *   division  Super Admin, Admin      everything
 *   team      Team Coordinator        their people and projects, approvals
 *   self      Team Member             themselves only, no other person's data
 *
 * ── THIS CHANGES THE SHAPE, NOT THE SECURITY ─────────────────────────────────
 * Row-level security already stopped a Member reading anybody else's row. What it
 * could not do is stop the page ASKING — so a Member previously got a dashboard
 * built around "who is carrying what", correctly returning a team of one, with a
 * division utilisation figure computed from themselves. Every number was right and
 * the page was answering a question they cannot ask.
 *
 * So this is presentation, and the comments below say which sections exist for
 * whom. The queries are unchanged and still scoped by RLS: if this switch were
 * wrong in the generous direction, the page would render an empty section rather
 * than somebody else's data.
 * ========================================================================= */

type Scope = 'division' | 'team' | 'self';

function scopeFor(role: string): Scope {
  if (role === 'super_admin' || role === 'admin') return 'division';
  if (role === 'team_coordinator') return 'team';
  return 'self';
}

export default async function DashboardPage() {
  /* Open to every role now (7.1). A Member gets the narrow shape rather than the
     redirect they used to get — /my-work is their task list, which is a different
     thing from a summary of where they stand. */
  const user = await requireUser();
  const scope = scopeFor(user.role);
  const now = nowMs();

  /* ── ONE WAVE, NOT THREE ───────────────────────────────────────────────────
     Every one of these opens its own transaction against a database in another
     region, so what matters is not how many queries there are but how many
     times the page STOPS AND WAITS. This used to be three waits — this list,
     then getSettings(), then listPendingExtensions() — which is three times the
     network latency for no reason: none of them depends on the others.

     Anything that needs a previous result still has to wait. Nothing here does. */
  const [rows, statusCounts, workload, projects, activity, settings, extensions] =
    await Promise.all([
      listTasks(user.id, { includeClosed: true }),
      countTasksByStatus(user.id),
      teamWorkload(user.id, now),
      listProjects(user.id),
      listActivity(user.id, 8),
      getSettings(),
      /* RLS decides the scope of this list, not the query: `tx_select` shows an
         Admin every pending request and everybody else only their own, so the
         same call renders the Admin queue and a Member's "still waiting" line. */
      listPendingExtensions(user.id),
    ]);

  const tasks = rows.map((row) => toTaskView(row, now));
  const team = teamUtilisation(workload.people);

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const overdue = open.filter((t) => t.overdue);
  const inReview = open.filter((t) => t.status === 'in_review');
  const blocked = open.filter((t) => t.status === 'blocked');
  const overLimit = open.filter(
    (t) => t.timeLimitMinutes > 0 && t.timeSpentMinutes > t.timeLimitMinutes,
  );
  const doneThisWeek = tasks.filter(
    (t) => t.status === 'done' && t.dueLabel.startsWith('Completed'),
  ).length;

  /* Needs a decision today, in the order a lead would triage it: blocked work is
     stopped and costing money, an overdue item is already late, and a review is
     someone waiting on you. Capped at eight — a list of everything is not a list
     of priorities. */
  const needsAttention = [...blocked, ...overdue, ...inReview]
    .filter((task, index, list) => list.findIndex((t) => t.id === task.id) === index)
    .slice(0, 8);

  const segments: Segment[] = statusCounts
    .filter((entry) => entry.count > 0)
    .sort((a, b) => STATUS_META[a.status].sortOrder - STATUS_META[b.status].sortOrder)
    .map((entry) => ({
      key: entry.status,
      label: STATUS_META[entry.status].label,
      value: entry.count,
      token: STATUS_META[entry.status].token,
    }));

  const canDecide = canDecideExtensions(user.role);
  const softPct = Number(settings.softThresholdPct);
  const hardPct = Number(settings.hardThresholdPct);
  const weeklyCapacity = Number(settings.defaultWeeklyCapacity);

  const atRisk = workload.people.filter((p) => p.workload.utilisationPct >= softPct);

  /* The reader's own row. RLS gives a Member exactly one person here, but this is
     found by id rather than taken as `people[0]` — a Coordinator or Admin gets
     several, and "the first one" would silently be somebody else. */
  const mine = workload.people.find((p) => p.userId === user.id) ?? null;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="AI & Digital Division"
        title={`Good to see you, ${user.fullName.split(' ')[0]}`}
        description={
          scope === 'self' ? (
            /* A Member's own summary. No division figure and no "people are at
               their limit" — there is nobody else in it, so a team sentence would
               be describing them in the third person. */
            <>
              <span className="tabular font-semibold text-text-primary">{open.length}</span> open{' '}
              {open.length === 1 ? 'task' : 'tasks'}
              {overdue.length > 0 && (
                <>
                  {', '}
                  <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                    {overdue.length} already late
                  </span>
                </>
              )}
              . You are at{' '}
              <span className="tabular font-semibold text-text-primary">
                {mine?.workload.utilisationPct ?? 0}%
              </span>{' '}
              of your capacity this week.
            </>
          ) : (
            <>
              <span className="tabular font-semibold text-text-primary">{open.length}</span> open
              tasks across {projects.length} projects.{' '}
              {scope === 'division' ? 'The division is' : 'Your people are'} at{' '}
              <span className="tabular font-semibold text-text-primary">
                {team.utilisationPct}%
              </span>{' '}
              of capacity this week
              {atRisk.length > 0 && (
                <>
                  {' — '}
                  <span className="font-semibold" style={{ color: 'var(--load-warning)' }}>
                    {atRisk.length} {atRisk.length === 1 ? 'person is' : 'people are'} at or near
                    their limit
                  </span>
                </>
              )}
              .
            </>
          )
        }
      />

      {/* ── 1 · The four figures ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ListChecks}
          token="accent-primary"
          label="Open tasks"
          value={open.length}
          hint={`${open.reduce((sum, t) => sum + t.effortPoints, 0)} effort points committed`}
        />
        <StatCard
          icon={CheckCircle2}
          token="feedback-success"
          label="Completed recently"
          value={doneThisWeek}
          hint="Approved and closed in the last week"
        />
        {/* A Member sees their OWN capacity. The team figure would be their own
            number relabelled as the division's, which is worse than useless — it
            is a wrong impression built out of a right number. */}
        {scope === 'self' ? (
          <StatCard
            icon={Gauge}
            token={
              (mine?.workload.utilisationPct ?? 0) >= 100
                ? 'load-over'
                : (mine?.workload.utilisationPct ?? 0) >= softPct
                  ? 'load-warning'
                  : 'load-healthy'
            }
            label="Your capacity"
            value={`${mine?.workload.utilisationPct ?? 0}%`}
            hint={
              mine
                ? `${mine.workload.loadPoints} of ${mine.workload.effectiveCapacityPoints} points this week`
                : 'No capacity recorded yet'
            }
          />
        ) : (
          <StatCard
            icon={Gauge}
            token={
              team.utilisationPct >= 100
                ? 'load-over'
                : team.utilisationPct >= softPct
                  ? 'load-warning'
                  : 'load-healthy'
            }
            label={scope === 'division' ? 'Division utilisation' : 'Your team’s utilisation'}
            value={`${team.utilisationPct}%`}
            hint={`${team.loadPoints} of ${team.capacityPoints} points this week`}
          />
        )}
        <StatCard
          icon={TimerReset}
          token={overLimit.length > 0 ? 'feedback-error' : 'feedback-success'}
          label="Over time limit"
          value={overLimit.length}
          hint={
            overLimit.length > 0
              ? 'Past the allowed time and still open'
              : 'Everything inside its limit'
          }
        />
      </div>

      {/* ── 2 · Where the work stands ────────────────────────────────────── */}
      <PageSection
        title="Where the work stands"
        description="Every task by status, including closed work. The weights behind the capacity figures are on doc 05 §1 — Backlog counts at 25%, In Review at 50%."
      >
        <Card>
          <CardBody className="space-y-4 p-5">
            {segments.length > 0 ? (
              <>
                <SegmentedBar segments={segments} height="h-3.5" />
                <SegmentLegend segments={segments} />
              </>
            ) : (
              <p className="text-caption text-text-secondary">
                No tasks yet. Press <kbd className="font-mono">N</kbd> to create the first one.
              </p>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* ── 3 · Needs a decision ─────────────────────────────────────────── */}
      <PageSection
        title="Needs a decision today"
        description="Blocked first — that work is stopped. Then overdue, then anything waiting on a review."
        actions={
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-caption font-semibold text-text-brand hover:underline"
          >
            All tasks
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <Card>
          {needsAttention.length === 0 ? (
            <CardBody className="flex items-center gap-3 p-5">
              <IconTile icon={CheckCircle2} token="feedback-success" size="lg" />
              <div>
                <p className="text-body-sm font-semibold text-text-primary">Nothing is stuck.</p>
                <p className="text-caption text-text-secondary">
                  No blocked work, nothing overdue, no reviews waiting.
                </p>
              </div>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {needsAttention.map((task) => {
                const status = STATUS_META[task.status];
                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks?q=${encodeURIComponent(task.reference)}`}
                      className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-bg-hover focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--${status.token})` }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="tabular font-mono text-micro font-semibold text-text-brand">
                            {task.reference}
                          </span>
                          <span className="text-body-sm font-medium text-text-primary">
                            {task.title}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge token={status.token} size="sm">
                            {status.label}
                          </Badge>
                          <PriorityFlag
                            token={PRIORITY_TOKEN[task.priority]}
                            label={PRIORITY_LABEL[task.priority]}
                          />
                          <Badge
                            token={PROJECT_TYPE_META[task.projectType].token}
                            size="sm"
                            variant="outline"
                          >
                            {task.projectName}
                          </Badge>
                          {task.blockedReason && (
                            <span
                              className="truncate text-micro"
                              style={{ color: 'var(--status-blocked)' }}
                            >
                              {task.blockedReason}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <span
                          className="text-caption font-medium whitespace-nowrap"
                          style={{
                            color: task.overdue ? 'var(--feedback-error)' : 'var(--text-tertiary)',
                          }}
                        >
                          {task.dueLabel}
                        </span>
                        <Avatar name={task.assignee} src={task.assigneeAvatarUrl} size="xs" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageSection>

      {/* ── Pending extension requests · FR-190 ──────────────────────────── */}
      {extensions.length > 0 && (
        <PageSection
          step={0}
          title={`Waiting on you · ${extensions.length} ${extensions.length === 1 ? 'request' : 'requests'} for more time`}
          description="A request sits here until somebody decides. Nothing is locked while it waits — doc 17 §4 chose that deliberately, because a hard stop just moves the work off the books."
        >
          <Card>
            <ul className="divide-y divide-border-subtle">
              {extensions.map((request) => (
                <li key={request.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
                  <div className="min-w-[14rem] flex-1">
                    <p className="text-caption text-text-primary">
                      <span className="tabular font-semibold text-text-brand">
                        {request.taskReference}
                      </span>{' '}
                      — {request.requestedByName ?? 'Somebody'} asked for{' '}
                      <span className="font-semibold">
                        {formatMinutes(request.requestedMinutes)}
                      </span>{' '}
                      more
                    </p>
                    <p className="truncate text-micro italic text-text-secondary">
                      “{request.reason}”
                    </p>
                    <p className="text-micro text-text-tertiary">
                      Used {formatMinutes(request.taskSpentMinutes)} of{' '}
                      {formatMinutes(request.taskLimitMinutes ?? 0)}
                      {request.priorDecidedOnTask > 0 && (
                        <span style={{ color: 'var(--feedback-warning)' }}>
                          {' · '}extension #{request.priorDecidedOnTask + 1} — the estimate was
                          probably low, not the work slow
                        </span>
                      )}
                    </p>
                  </div>
                  <Link
                    href={{ pathname: '/tasks', query: { task: request.taskId } }}
                    className="shrink-0 self-center text-caption font-semibold text-text-brand hover:underline"
                  >
                    {canDecide ? 'Decide' : 'Open'}
                    <ArrowRight className="ml-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </PageSection>
      )}

      {/* ── 4 · Who is carrying what ───────────────────────────────────────
          Other people, by definition. A Member's version listed one person —
          themselves — under a heading asking who is carrying the load, which is a
          question about a team. Hidden rather than reduced: the honest narrow
          version of this section is no section. */}
      {scope !== 'self' && (
      <PageSection
        title="Who is carrying what"
        description={`Load is effort × priority × status weight, against ${weeklyCapacity} points a week. Over ${hardPct}% a new assignment is blocked unless an Admin overrides it in writing.`}
        actions={
          <Link
            href="/workload"
            className="inline-flex items-center gap-1 text-caption font-semibold text-text-brand hover:underline"
          >
            Workload detail
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <Card>
          <ul className="divide-y divide-border-subtle">
            {workload.people.map((person) => {
              const band = WORKLOAD_BAND_META[person.workload.band];
              return (
                <li key={person.userId} className="flex items-center gap-4 px-5 py-3.5">
                  <Avatar name={person.name} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-semibold text-text-primary">
                      {person.name}
                    </p>
                    <p className="truncate text-micro text-text-tertiary">
                      {person.roleTitle ?? '—'} ·{' '}
                      <span className="tabular">{person.workload.openTaskCount}</span> open
                      {person.workload.atMaxConcurrent && (
                        <span style={{ color: 'var(--load-warning)' }}>
                          {' '}
                          · at their concurrent limit
                        </span>
                      )}
                      {person.otherWorkHigh && (
                        <span style={{ color: 'var(--load-warning)' }}>
                          {' '}
                          · {person.otherWorkPct}% ad-hoc
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="w-32 shrink-0 sm:w-48">
                    <ProgressBar
                      value={Math.min(person.workload.utilisationPct, 100)}
                      token={band.token}
                      size="lg"
                      label={`${person.name}: ${person.workload.utilisationPct}% of capacity`}
                    />
                  </div>

                  <div className="w-24 shrink-0 text-right">
                    <p
                      className="tabular text-h3 font-semibold"
                      style={{ color: `var(--${band.token})` }}
                    >
                      {person.workload.isFullyUnavailable ? '—' : `${person.workload.utilisationPct}%`}
                    </p>
                    <p className="text-micro text-text-tertiary">
                      {person.workload.isFullyUnavailable ? 'On leave' : band.label}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </PageSection>
      )}

      {/* ── 5 · Detail ───────────────────────────────────────────────────── */}
      <PageSection step={4} title="Projects and recent activity">
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardToolbar title="Active projects">
              <Link
                href="/projects"
                className="text-micro font-semibold text-text-brand hover:underline"
              >
                All projects
              </Link>
            </CardToolbar>
            <ul className="divide-y divide-border-subtle">
              {projects.slice(0, 6).map((project) => {
                const meta = PROJECT_TYPE_META[project.type];
                const donePct =
                  project.taskCount > 0
                    ? Math.round((project.doneTaskCount / project.taskCount) * 100)
                    : 0;
                return (
                  <li key={project.id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-medium text-text-primary">
                          {project.name}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge token={meta.token} size="sm">
                            {meta.label}
                          </Badge>
                          <span className="tabular text-micro text-text-tertiary">
                            {project.openTaskCount} open · {project.effortPoints} pts
                          </span>
                          {project.overdueTaskCount > 0 && (
                            <span
                              className="text-micro font-semibold"
                              style={{ color: 'var(--feedback-error)' }}
                            >
                              {project.overdueTaskCount} late
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-24 shrink-0 text-right">
                        <p className="tabular text-caption font-semibold text-text-primary">
                          {donePct}%
                        </p>
                        <ProgressBar
                          value={donePct}
                          token="accent-primary"
                          size="sm"
                          label={`${project.name}: ${donePct}% complete`}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="lg:col-span-2">
            <CardToolbar title="Recent activity" />
            <ul className="divide-y divide-border-subtle">
              {activity.length === 0 && (
                <li className="px-5 py-6 text-caption text-text-tertiary">
                  Nothing yet. Every status change, assignment and comment lands here.
                </li>
              )}
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2.5 px-5 py-2.5">
                  <Avatar name={entry.actorName ?? 'System'} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-caption text-text-secondary">
                      <span className="font-semibold text-text-primary">
                        {entry.actorName ?? 'System'}
                      </span>{' '}
                      {entry.summary ?? entry.action}
                    </p>
                    <p className="text-micro text-text-tertiary">{relative(entry.createdAt, now)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </PageSection>

      {/* A quiet note, at the foot where a caveat belongs — not a headline. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-bg-surface-sunken px-4 py-3">
        <Clock className="mt-px h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
        <p className="text-micro text-text-tertiary">
          Figures cover the week of {workload.window.start} to {workload.window.end}, computed live
          from {open.length} open tasks. Capacity is {weeklyCapacity} points a
          week per person by default — 75% of the 48 nominal hours, because attendance hours are not
          productive hours (ADR-004).
        </p>
      </div>
    </div>
  );
}
