import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Download,
  Gauge,
  ListChecks,
  Sparkles,
  TimerReset,
  Users,
  Zap,
} from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { Badge, PriorityFlag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { FilterChip, PageHeader, PageSection } from '@/components/ui/page-header';
import {
  ProgressBar,
  ProgressRing,
  SegmentLegend,
  SegmentedBar,
  type Segment,
} from '@/components/ui/progress';
import {
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  PROJECT_TYPE_META,
  STATUS_META,
  SYSTEM_DEFAULTS,
  WORKLOAD_BAND_META,
} from '@/lib/domain/constants';
import {
  PREVIEW_ACTIVITY,
  PREVIEW_MEMBERS,
  PREVIEW_OPEN_STATUS_COUNTS,
  PREVIEW_STATUS_COUNTS,
  PREVIEW_TASKS,
  PREVIEW_TRENDS,
} from '@/lib/preview-data';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ADMIN DASHBOARD — doc 10 §7
 * ----------------------------------------------------------------------------
 * Data comes from lib/preview-data.ts so the interface can be reviewed before
 * the database is wired in. Every figure obeys the real rules — 36-point
 * capacity, weighted load, the real threshold bands — so this is an honest
 * preview rather than decoration.
 *
 * ── WHAT CHANGED, AND WHY (Session 08) ────────────────────────────────────
 * The first version opened with six identical small tiles and then four cards
 * that all looked the same. Nothing was more important than anything else, so
 * the eye had nowhere to land and the screen read as a spreadsheet.
 *
 * The order is now deliberate, and it follows how someone actually uses a
 * Monday morning dashboard:
 *
 *   1. WHERE DOES THE WORK STAND    one proportional bar, shape before numbers
 *   2. THE FOUR FIGURES THAT MATTER big numbers, each with its own trend
 *   3. WHAT NEEDS ME TODAY          the only actionable list on the page
 *   4. WHO IS OVERLOADED            capacity, with the rebalance suggestion
 *   5. DETAIL                       the full table and the activity feed
 * ========================================================================= */

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ---- Needs-attention row ------------------------------------------------ */

function AttentionRow({ task }: { task: (typeof PREVIEW_TASKS)[number] }) {
  const status = STATUS_META[task.status];
  const project = PROJECT_TYPE_META[task.projectType];
  const overLimitBy = task.timeSpentMinutes - task.timeLimitMinutes;

  // The stripe repeats the priority that the flag already states in words, so
  // it adds scannability without becoming the only carrier of meaning (FR-208).
  const stripe = `var(--${PRIORITY_TOKEN[task.priority]})`;

  return (
    <li className="group relative flex items-start gap-3 py-3 pr-4 pl-5 transition-colors duration-[140ms] hover:bg-bg-hover">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] opacity-70 transition-opacity duration-[140ms] group-hover:opacity-100"
        style={{ backgroundColor: stripe }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-micro font-semibold text-text-brand">
            {task.reference}
          </span>
          <span className="truncate text-body-sm font-medium text-text-primary">{task.title}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Badge token={status.token} size="sm">
            {status.label}
          </Badge>
          <PriorityFlag
            token={PRIORITY_TOKEN[task.priority]}
            label={PRIORITY_LABEL[task.priority]}
          />
          <span aria-hidden="true" className="text-micro text-text-disabled">
            ·
          </span>
          <span className="truncate text-micro text-text-tertiary">{task.projectName}</span>
          <Badge token={project.token} size="sm" variant="outline" dot={false}>
            {project.code}
          </Badge>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-micro font-semibold"
            style={{
              color: task.overdue ? 'var(--feedback-error)' : 'var(--text-tertiary)',
            }}
          >
            {task.dueLabel}
          </span>
          {overLimitBy > 0 && (
            <span
              className="inline-flex items-center gap-1 text-micro font-semibold"
              style={{ color: 'var(--feedback-warning)' }}
            >
              <TimerReset className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
              {formatDuration(overLimitBy)} over limit
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <Avatar name={task.assignee} size="sm" />
      </div>
    </li>
  );
}

/* ---- Workload row ------------------------------------------------------- */

function WorkloadRow(member: (typeof PREVIEW_MEMBERS)[number]) {
  const { name, roleTitle, loadPoints, capacityPoints, openTasks, band, otherWorkPct } = member;
  const pct = Math.round((loadPoints / capacityPoints) * 100);
  const meta = WORKLOAD_BAND_META[band];
  const overThreshold = otherWorkPct > SYSTEM_DEFAULTS.otherWorkWarningPct;

  return (
    <div className="group rounded-lg px-2 py-2.5 transition-colors duration-[140ms] hover:bg-bg-hover">
      <div className="flex items-center gap-2.5">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-medium text-text-primary">{name}</p>
          <p className="truncate text-micro text-text-tertiary">{roleTitle}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-h3 leading-none font-semibold text-text-primary">{pct}%</p>
          <p className="tabular text-micro text-text-tertiary">
            {loadPoints}/{capacityPoints} pts
          </p>
        </div>
      </div>

      <div className="mt-2 pl-[calc(2.25rem+0.625rem)]">
        <ProgressBar
          value={pct}
          token={meta.token}
          markerAt={SYSTEM_DEFAULTS.softThresholdPct}
          // lg, not sm. This bar is the answer to "how loaded is this person?",
          // which is the question the whole capacity model exists to answer — a
          // 6px sliver was the smallest element on screen carrying the most
          // important number on it.
          size="lg"
          label={`${name}: ${pct}% of capacity`}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge token={meta.token} size="sm" variant="outline">
            {meta.label}
          </Badge>
          <span className="text-micro text-text-tertiary">{openTasks} open</span>
          {overThreshold && (
            <span
              className="text-micro font-semibold"
              style={{ color: 'var(--feedback-warning)' }}
            >
              {otherWorkPct}% uncategorised
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Page --------------------------------------------------------------- */

export default function DashboardPage() {
  const teamAverage = Math.round(
    (PREVIEW_MEMBERS.reduce((sum, m) => sum + m.loadPoints / m.capacityPoints, 0) /
      PREVIEW_MEMBERS.length) *
      100,
  );
  const overLimit = PREVIEW_MEMBERS.filter((m) => m.band === 'over');
  const lightest = [...PREVIEW_MEMBERS].sort(
    (a, b) => a.loadPoints / a.capacityPoints - b.loadPoints / b.capacityPoints,
  )[0];

  // Open work only — a task that is done or cancelled cannot need attention.
  const attention = PREVIEW_TASKS.filter((t) => {
    const category = STATUS_META[t.status].category;
    if (category === 'done' || category === 'cancelled') return false;
    return t.overdue || t.status === 'blocked' || t.timeSpentMinutes > t.timeLimitMinutes;
  });

  // "In progress right now" means exactly that: the two statuses whose timer
  // runs (FR-174). Listing all eighteen tasks under that heading would be
  // a table with a title that lied.
  const activeNow = PREVIEW_TASKS.filter((t) => STATUS_META[t.status].timerRuns);

  const openTotal = PREVIEW_OPEN_STATUS_COUNTS.reduce((sum, s) => sum + s.count, 0);
  const doneCount = PREVIEW_STATUS_COUNTS.find((s) => s.status === 'done')?.count ?? 0;
  const overLimitTasks = PREVIEW_TASKS.filter(
    (t) => t.timeSpentMinutes > t.timeLimitMinutes,
  ).length;

  const segments: Segment[] = PREVIEW_OPEN_STATUS_COUNTS.map((s) => ({
    key: s.status,
    label: STATUS_META[s.status].label,
    value: s.count,
    token: STATUS_META[s.status].token,
  }));

  const teamBandToken =
    teamAverage >= SYSTEM_DEFAULTS.hardThresholdPct
      ? 'load-over'
      : teamAverage >= SYSTEM_DEFAULTS.softThresholdPct
        ? 'load-warning'
        : teamAverage >= 60
          ? 'load-healthy'
          : 'load-available';

  return (
    <AppShell
      role="admin"
      userName="Sana Minhas"
      title="Dashboard"
      subtitle="Thursday, 6 August 2026"
    >
      {/* space-y-8, not space-y-6. 32px between named sections is what separates
          "five ideas" from "one dense mass" — the owner's "everything is on top
          of each other" was literally a spacing problem. */}
      <div className="mx-auto max-w-[var(--content-max)] space-y-8">
        {/* ---- Page header ---- */}
        <PageHeader
          eyebrow="Admin dashboard · Week 32"
          title="Good morning, Sana"
          description={
            <>
              {openTotal} tasks open across {PREVIEW_MEMBERS.length} people.{' '}
              <span className="font-semibold text-text-primary">
                {attention.length} need a decision today
              </span>{' '}
              — one is blocked, one is two days late, and two are over their time limit.
            </>
          }
          actions={
            <>
              <FilterChip label="Period" value="Week 32" icon={CalendarRange} />
              <FilterChip label="Team" value="All 6" icon={Users} />
              <Button variant="secondary" size="md">
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Export
              </Button>
            </>
          }
        />

        {/* ---- 1 · THE FOUR FIGURES ----
            KPI cards go FIRST. Every professional CRM dashboard opens with a
            horizontal row of headline numbers, because the first question anyone
            asks is "are we all right?" and it should be answerable without
            reading anything. The status bar used to sit above these, which meant
            the page opened with a chart nobody had context for yet. */}
        <PageSection
          step={1}
          title="Where we stand"
          description="The four numbers that decide whether today needs intervention."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Open tasks"
              value={openTotal}
              token="status-todo"
              icon={ListChecks}
              trend={{ direction: 'up', text: '+2', good: false }}
              hint="vs last week"
              spark={PREVIEW_TRENDS.openTasks}
            />
            <StatCard
              label="Completed"
              value={doneCount}
              token="status-done"
              icon={CheckCircle2}
              trend={{ direction: 'up', text: '+3', good: true }}
              hint="this week"
              spark={PREVIEW_TRENDS.completed}
            />
            <StatCard
              label="Over time limit"
              value={overLimitTasks}
              token="load-warning"
              icon={TimerReset}
              trend={{ direction: 'up', text: '+1', good: false }}
              hint="needs an extension or a reason"
              spark={PREVIEW_TRENDS.overLimit}
            />
            <StatCard
              label="Team utilisation"
              value={teamAverage}
              unit="%"
              token={teamBandToken}
              icon={Gauge}
              trend={{ direction: 'up', text: '+6 pts', good: false }}
              hint={`${SYSTEM_DEFAULTS.softThresholdPct}% warns`}
              spark={PREVIEW_TRENDS.utilisation}
            />
          </div>
        </PageSection>

        {/* ---- 2 · THE ONE VISUALISATION ----
            "Add a chart only when a list stops answering the question." One
            proportional bar, with a legend that is now readable rather than a
            grey smear (see SegmentLegend). */}
        <PageSection
          step={2}
          title="How the open work breaks down"
          description={`${openTotal} tasks in flight · ${doneCount} completed this week.`}
          actions={
            <Button variant="secondary" size="sm">
              Open task list
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            </Button>
          }
        >
          <Card>
            <CardBody className="space-y-4 p-5">
              <SegmentedBar segments={segments} height="h-3" />
              <SegmentLegend segments={segments} />
            </CardBody>
          </Card>
        </PageSection>

        {/* ---- 3 + 4 · What needs me · Who is overloaded ----
            `items-start` matters here. Grid children stretch to the tallest row
            by default, and the workload card is much taller than the attention
            list — which left a slab of empty card below the list's footer. Each
            card is now its natural height. */}
        <PageSection
          step={3}
          title="What needs a decision today"
          description="The only list on this page that asks something of you, beside the capacity it has to fit into."
        >
        <div className="grid items-start gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardToolbar
              title="Needs attention"
              description="Work that will slip unless someone acts today"
            >
              <Badge token="feedback-error" size="sm" variant="soft">
                {attention.length} items
              </Badge>
            </CardToolbar>

            <ul className="divide-y divide-border-subtle">
              {attention.map((task) => (
                <AttentionRow key={task.reference} task={task} />
              ))}
            </ul>

            <CardFooter className="flex items-center justify-between">
              <span className="text-caption text-text-tertiary">
                Sorted by urgency, then by how late
              </span>
              <Button variant="ghost" size="sm">
                View all tasks
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>

          <Card className="xl:col-span-2">
            <CardToolbar title="Team workload" description="Weighted capacity points this week" />

            {/* Headline ring — one number that says whether the team is coping */}
            <CardBody className="flex items-center gap-4 pb-2">
              <ProgressRing
                value={teamAverage}
                token={teamBandToken}
                size={78}
                label={`Team average ${teamAverage}% of capacity`}
              >
                <span className="tabular text-h3 leading-none font-semibold text-text-primary">
                  {teamAverage}%
                </span>
                <span className="mt-0.5 text-micro text-text-tertiary">avg</span>
              </ProgressRing>

              <div className="min-w-0 space-y-1.5">
                <p className="text-caption text-text-secondary">
                  {SYSTEM_DEFAULTS.defaultWeeklyCapacity} pts per person per week ·{' '}
                  {SYSTEM_DEFAULTS.softThresholdPct}% warns, {SYSTEM_DEFAULTS.hardThresholdPct}%
                  blocks
                </p>
                <AvatarStack names={PREVIEW_MEMBERS.map((m) => m.name)} max={6} size="sm" />
              </div>
            </CardBody>

            <CardBody className="space-y-0.5 px-3 pt-1">
              {PREVIEW_MEMBERS.map((member) => (
                <WorkloadRow key={member.id} {...member} />
              ))}
            </CardBody>

            {overLimit.length > 0 && (
              <CardFooter>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--load-over)' }}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <p className="text-caption text-text-secondary">
                    <span className="font-semibold text-text-primary">
                      {overLimit[0].name} is over capacity
                    </span>{' '}
                    at {Math.round((overLimit[0].loadPoints / overLimit[0].capacityPoints) * 100)}%
                    on just {overLimit[0].openTasks} tasks — both are XL builds.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <Zap
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--accent-gold)' }}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <p className="text-caption text-text-secondary">
                    Move one subtask to{' '}
                    <span className="font-semibold text-text-primary">{lightest.name}</span> —
                    lightest on the team at{' '}
                    {Math.round((lightest.loadPoints / lightest.capacityPoints) * 100)}%.
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="w-full">
                  Review rebalance suggestions
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>

        </PageSection>
        {/* ---- 5 · Detail ---- */}
        <PageSection
          step={5}
          title="The detail, when you need it"
          description="Live work with time against limit, and what the team has just done."
        >
        <div className="grid items-start gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardToolbar title="Active work" description="In progress now, with time against limit" />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    {['Task', 'Assignee', 'Status', 'Time used', 'Due'].map((heading, i) => (
                      <th
                        key={heading}
                        scope="col"
                        className={cn(
                          'border-b border-border-subtle bg-bg-surface-sunken px-4 py-2',
                          'text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase',
                          i >= 3 ? 'text-right' : 'text-left',
                        )}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeNow.map((task) => {
                    const status = STATUS_META[task.status];
                    const project = PROJECT_TYPE_META[task.projectType];
                    const pct = Math.round((task.timeSpentMinutes / task.timeLimitMinutes) * 100);
                    const over = pct > 100;

                    return (
                      <tr
                        key={task.reference}
                        className="group transition-colors duration-[140ms] hover:bg-bg-hover"
                      >
                        <td className="border-b border-border-subtle px-4 py-3">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-micro font-semibold text-text-brand">
                              {task.reference}
                            </span>
                            <span className="max-w-[260px] truncate text-body-sm font-medium text-text-primary">
                              {task.title}
                            </span>
                          </div>
                          <Badge
                            token={project.token}
                            size="sm"
                            variant="outline"
                            className="mt-1.5"
                          >
                            {project.label}
                          </Badge>
                        </td>
                        <td className="border-b border-border-subtle px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={task.assignee} size="xs" />
                            <span className="truncate text-caption text-text-secondary">
                              {task.assignee.split(' ')[0]}
                            </span>
                          </div>
                        </td>
                        <td className="border-b border-border-subtle px-4 py-3">
                          <Badge token={status.token} size="sm">
                            {status.label}
                          </Badge>
                        </td>
                        <td className="border-b border-border-subtle px-4 py-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <span
                              className="tabular text-caption font-semibold"
                              style={{ color: over ? 'var(--load-over)' : 'var(--text-primary)' }}
                            >
                              {formatDuration(task.timeSpentMinutes)}
                              <span className="font-normal text-text-tertiary">
                                {' '}
                                / {formatDuration(task.timeLimitMinutes)}
                              </span>
                            </span>
                            <ProgressBar
                              value={pct}
                              token={over ? 'load-over' : 'status-progress'}
                              size="sm"
                              className="w-24"
                              label={`${task.reference}: ${pct}% of time limit`}
                            />
                          </div>
                        </td>
                        <td className="border-b border-border-subtle px-4 py-3 text-right">
                          <span
                            className="text-caption font-medium"
                            style={{
                              color: task.overdue
                                ? 'var(--feedback-error)'
                                : 'var(--text-secondary)',
                            }}
                          >
                            {task.dueLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardToolbar title="Recent activity" description="Live from Phase 3 onwards" />

            <CardBody className="px-3 py-2">
              {/* A connector line down the left turns five separate rows into
                  one timeline, which is what makes a feed readable. */}
              <ol className="relative space-y-0.5 before:absolute before:top-4 before:bottom-4 before:left-[1.4375rem] before:w-px before:bg-border-subtle">
                {PREVIEW_ACTIVITY.map((entry) => (
                  <li
                    key={entry.id}
                    className="relative flex items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-[140ms] hover:bg-bg-hover"
                  >
                    <Avatar name={entry.actor} size="xs" ring className="relative z-10" />
                    <p className="min-w-0 flex-1 text-caption text-text-secondary">
                      <span className="font-semibold text-text-primary">{entry.actor}</span>{' '}
                      {entry.action}{' '}
                      <span className="font-mono font-semibold text-text-brand">{entry.target}</span>
                    </p>
                    <span className="tabular shrink-0 text-micro text-text-tertiary">
                      {entry.when}
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>

            <CardFooter className="flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4 shrink-0"
                style={{ color: 'var(--feedback-success)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
              <p className="text-caption text-text-secondary">
                On-time rate{' '}
                <span className="tabular font-semibold text-text-primary">83%</span> this week
              </p>
            </CardFooter>
          </Card>
        </div>
        </PageSection>

        {/* ---- Footnote ----
            Moved here from the top. It is a caveat about the data, not a
            headline — and the strip directly under the page title is the most
            valuable real estate on the screen. */}
        <div
          className="flex items-start gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--accent-gold) 30%, transparent)',
            backgroundColor: 'var(--bg-gold-subtle)',
          }}
        >
          <IconTile icon={Sparkles} token="accent-gold" size="sm" />
          <p className="text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">Interface preview.</span> Figures are
            placeholder data that follows the real rules — 36-point weekly capacity, weighted load,
            the actual threshold bands. Live data arrives with the read queries in Step 6.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
