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
import { DonutChart, GaugeArc, TrendChart } from '@/components/ui/chart';
import { CountUp } from '@/components/ui/count-up';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { Reveal, RevealItem } from '@/components/ui/motion';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar, SegmentLegend, SegmentedBar, type Segment } from '@/components/ui/progress';
import { requireUser } from '@/lib/auth/current-user';
import { listActivity } from '@/lib/db/queries/feed';
import { listProjects } from '@/lib/db/queries/projects';
import { countTasksByStatus, listTasks } from '@/lib/db/queries/tasks';
import { weeklyTrend } from '@/lib/db/queries/trend';
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

/**
 * A week's Monday as a short axis label — `4 Aug`.
 *
 * The date arrives as `YYYY-MM-DD` from a Postgres `date`, so it is parsed as UTC
 * midnight and formatted in UTC. Letting `new Date('2026-08-10')` be read in a
 * server timezone west of Greenwich would label the week `9 Aug`, a day before the
 * Monday it starts on — the same class of fault as the note at the top of
 * lib/db/row-values.ts.
 */
const WEEK_LABEL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function shortWeek(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? isoDate : WEEK_LABEL.format(parsed);
}

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
  const [rows, statusCounts, workload, projects, activity, settings, extensions, trend] =
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
      /* Eight weeks of real history, for the trend chart and the sparkline. In the
         same wave, so it costs no extra wait. */
      weeklyTrend(user.id, 8, now),
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

  /* ── THE RING SHOWS THE SAME SET ITS CENTRE COUNTS ─────────────────────────
     `segments` is every status including Done and Cancelled, which is right for
     the bar under the trend chart — that section says "including closed work" and
     means it.

     The rail's ring cannot use the same list. Its centre reads "29 open tasks"
     while the slices summed to 38, so every percentage in the legend was a share
     of a different total from the number in the middle of it: Done at 16% of a
     figure the label said was open work. Caught in a screenshot, by adding up the
     legend.

     Filtered here rather than relabelling the centre, because "right now" is the
     question the rail answers and closed work is not part of it. The two shapes
     now disagree by design and each says which set it is showing. */
  const openSegments = segments.filter(
    (segment) => segment.key !== 'done' && segment.key !== 'cancelled',
  );

  const canDecide = canDecideExtensions(user.role);
  const softPct = Number(settings.softThresholdPct);
  const hardPct = Number(settings.hardThresholdPct);
  const weeklyCapacity = Number(settings.defaultWeeklyCapacity);

  const atRisk = workload.people.filter((p) => p.workload.utilisationPct >= softPct);

  /* The reader's own row. RLS gives a Member exactly one person here, but this is
     found by id rather than taken as `people[0]` — a Coordinator or Admin gets
     several, and "the first one" would silently be somebody else. */
  const mine = workload.people.find((p) => p.userId === user.id) ?? null;

  /* ── THE HISTORY, AND WHERE IT IS HONEST TO SHOW IT ────────────────────────
     `weeklyTrend` gives two true series: tasks created and tasks completed, per
     week, from `created_at` and `completed_at`. Migration 012 constrains
     `completed_at` and `status = 'done'` to agree, so a completion date is exactly
     as trustworthy as the status is.

     Only "Completed recently" gets a sparkline, and that is deliberate. A
     sparkline under a figure is read as that figure's own history, so it may only
     appear where the history is real:

       · Open tasks — NOT computable truthfully. It needs to know when each task
         stopped being open, and a cancelled one has no timestamp for that (there
         is `cancelled_reason` but no `cancelled_at`). Deriving it from created
         minus completed would draw a past that never happened.
       · Capacity — a live sum over open tasks that stores nothing (doc 20), so
         there is no yesterday to plot.
       · Over time limit — likewise, entirely a function of the current state.

     Three cards without a line and one with is the honest arrangement. A
     decorative line under a number nobody can reconstruct is worse than none. */
  const weekLabels = trend.map((week) => shortWeek(week.weekStart));
  const completedSeries = trend.map((week) => week.completed);
  const createdSeries = trend.map((week) => week.created);

  /* One utilisation figure and one token for it, chosen once. Both the KPI card
     and the rail's gauge read them, and computing the band twice is how the card
     ends up amber while the gauge beside it is still green. */
  const utilisationPct =
    scope === 'self' ? (mine?.workload.utilisationPct ?? 0) : team.utilisationPct;
  const loadToken =
    utilisationPct >= 100 ? 'load-over' : utilisationPct >= softPct ? 'load-warning' : 'load-healthy';

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

      {/* ── 1 · The four figures ─────────────────────────────────────────────
          `Reveal` numbers them so they land left to right rather than all at once,
          and each figure counts up as its own card arrives. */}
      <Reveal className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ListChecks}
          token="accent-primary"
          label="Open tasks"
          value={<CountUp value={open.length} />}
          hint={`${open.reduce((sum, t) => sum + t.effortPoints, 0)} effort points committed`}
        />
        <StatCard
          icon={CheckCircle2}
          token="feedback-success"
          label="Completed recently"
          value={<CountUp value={doneThisWeek} />}
          hint="Approved and closed in the last week"
          /* The one card whose history is real — see the note above. */
          spark={completedSeries}
        />
        {/* A Member sees their OWN capacity. The team figure would be their own
            number relabelled as the division's, which is worse than useless — it
            is a wrong impression built out of a right number.
            One card now rather than two: the branch was on the label and the
            source of the number, and the two copies had already drifted into
            computing the same band twice. */}
        <StatCard
          icon={Gauge}
          token={loadToken}
          label={
            scope === 'self'
              ? 'Your capacity'
              : scope === 'division'
                ? 'Division utilisation'
                : 'Your team’s utilisation'
          }
          value={<CountUp value={utilisationPct} />}
          unit="%"
          hint={
            scope === 'self'
              ? mine
                ? `${mine.workload.loadPoints} of ${mine.workload.effectiveCapacityPoints} points this week`
                : 'No capacity recorded yet'
              : `${team.loadPoints} of ${team.capacityPoints} points this week`
          }
        />
        <StatCard
          icon={TimerReset}
          token={overLimit.length > 0 ? 'feedback-error' : 'feedback-success'}
          label="Over time limit"
          value={<CountUp value={overLimit.length} />}
          hint={
            overLimit.length > 0
              ? 'Past the allowed time and still open'
              : 'Everything inside its limit'
          }
        />
      </Reveal>

      {/* ── 2 · MAIN COLUMN AND RIGHT RAIL ───────────────────────────────────
          Reference `9d5a6f36`: detail runs down the middle and a narrow rail on
          the right carries the at-a-glance shapes — a ring, a gauge, a feed.

          Two thirds and one third, not three equal columns. The middle column
          holds task titles and people's names, and at a third of the content width
          those wrap after four words. The rail holds nothing wider than a legend
          label, which is exactly why it can be narrow.

          Splits at `xl`, not `lg`: at 1024px a third is about 300px and the donut
          plus its legend does not fit beside itself there. Below that it stacks,
          rail last — the order it is written in, so there are no `order-` classes
          and nothing for a screen reader to disagree with. */}
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-8 xl:col-span-2">
          {/* ── Where the work stands ─────────────────────────────────────── */}
          <PageSection
            title="Where the work stands"
            description="Eight weeks of real history, then every task by status including closed work. The weights behind the capacity figures are on doc 05 §1 — Backlog counts at 25%, In Review at 50%."
          >
            <RevealItem index={4}>
              <Card className="grain panel-lit">
                <CardBody className="space-y-5 p-5">
                  {/* Two lines and no fill. Completed against created is the one
                      comparison that says whether the backlog is growing, and a
                      wash under either of them would claim one is the total. */}
                  <TrendChart
                    caption="Tasks created and completed, by week"
                    labels={weekLabels}
                    height={210}
                    fill={false}
                    series={[
                      { label: 'Completed', token: 'status-done', points: completedSeries },
                      { label: 'Created', token: 'accent-primary', points: createdSeries },
                    ]}
                  />

                  {segments.length > 0 ? (
                    <div className="space-y-4 border-t border-border-subtle pt-5">
                      <SegmentedBar segments={segments} height="h-3.5" />
                      <SegmentLegend segments={segments} />
                    </div>
                  ) : (
                    <p className="border-t border-border-subtle pt-5 text-caption text-text-secondary">
                      No tasks yet. Press <kbd className="font-mono">N</kbd> to create the first one.
                    </p>
                  )}
                </CardBody>
              </Card>
            </RevealItem>
          </PageSection>

          {/* ── 3 · Needs a decision ───────────────────────────────────────── */}
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

          {/* ── 5 · Detail ─────────────────────────────────────────────────────
              Recent activity has moved to the rail with the rest of the at-a-glance
              material, so this is projects alone at the full width of the column —
              which is what a row carrying a name, three chips and a progress bar
              needed all along. */}
          <PageSection step={4} title="Projects">
            <Card className="grain">
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
          </PageSection>
        </div>

        {/* ── THE RIGHT RAIL ─────────────────────────────────────────────────
            Shapes, not rows. Nothing here has to be read word by word: a ring for
            the mix, a gauge against a ceiling, and a feed of who did what. The
            reference puts exactly these three in the same place, and the reason it
            works is that none of them needs horizontal room.

            Deliberately not sticky. The rail is taller than a viewport once the
            feed holds eight entries, and a sticky element taller than the screen
            pins its own top off-screen — hiding the thing somebody scrolled to
            reach. */}
        <aside className="min-w-0 space-y-6" aria-label="At a glance">
          <RevealItem index={5}>
            <Card className="grain panel-lit">
              <CardToolbar title="The mix, right now" />
              <CardBody className="p-5">
                {openSegments.length > 0 ? (
                  <DonutChart
                    caption="Tasks by status"
                    centreLabel={open.length === 1 ? 'open task' : 'open tasks'}
                    centreValue={String(open.length)}
                    size={148}
                    slices={openSegments.map((segment) => ({
                      label: segment.label,
                      value: segment.value,
                      token: segment.token,
                    }))}
                  />
                ) : (
                  <p className="text-caption text-text-secondary">
                    Nothing to show until the first task exists.
                  </p>
                )}
              </CardBody>
            </Card>
          </RevealItem>

          <RevealItem index={6}>
            <Card className="grain panel-lit">
              <CardToolbar title={scope === 'self' ? 'Your week' : 'Capacity this week'} />
              <CardBody className="grid place-items-center p-5">
                {/* Points against points, not the percentage. The percentage is
                    already on the card above, and a gauge reading "82 of 100" when
                    the truth is "29.5 of 36 points" invites somebody to plan
                    against a number that does not exist. */}
                <GaugeArc
                  value={scope === 'self' ? (mine?.workload.loadPoints ?? 0) : team.loadPoints}
                  max={
                    scope === 'self'
                      ? (mine?.workload.effectiveCapacityPoints ?? weeklyCapacity)
                      : team.capacityPoints
                  }
                  label={`${utilisationPct}% of capacity`}
                  hint={
                    scope === 'self'
                      ? 'effort points, this week'
                      : `${workload.people.length} ${workload.people.length === 1 ? 'person' : 'people'}, this week`
                  }
                  token={loadToken}
                  format="decimal"
                />
              </CardBody>
            </Card>
          </RevealItem>

          <RevealItem index={7}>
            <Card className="grain">
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
                      <p className="text-micro text-text-tertiary">
                        {relative(entry.createdAt, now)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </RevealItem>
        </aside>
      </div>

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
