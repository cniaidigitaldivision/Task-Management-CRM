import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Sparkles,
  TimerReset,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
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
  PREVIEW_STATUS_COUNTS,
  PREVIEW_TASKS,
} from '@/lib/preview-data';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ADMIN DASHBOARD — doc 10 §7
 * ----------------------------------------------------------------------------
 * Data is from lib/preview-data.ts so the interface can be reviewed before the
 * database exists. Every figure obeys the real rules (36 pt capacity, weighted
 * load, the real threshold bands) so the screen is an honest preview rather
 * than decoration.
 * ========================================================================= */

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ---- Stat tile ---------------------------------------------------------- */

function Stat({
  label,
  value,
  token,
  hint,
  trend,
}: {
  label: string;
  value: number | string;
  token?: string;
  hint?: string;
  trend?: { direction: 'up' | 'down'; text: string; good: boolean };
}) {
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : TrendingDown;

  return (
    <Card interactive className="p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-micro font-semibold uppercase tracking-[0.07em] text-text-tertiary">
          {label}
        </span>
        {token && (
          <span
            aria-hidden="true"
            className="mt-1 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--${token})` }}
          />
        )}
      </div>
      <p className="tabular mt-3 text-[1.75rem] font-semibold leading-none text-text-primary">
        {value}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {trend && (
          <span
            className="inline-flex items-center gap-1 text-micro font-medium"
            style={{
              color: trend.good ? 'var(--feedback-success)' : 'var(--feedback-warning)',
            }}
          >
            <TrendIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            {trend.text}
          </span>
        )}
        {hint && <span className="text-micro text-text-tertiary">{hint}</span>}
      </div>
    </Card>
  );
}

/* ---- Workload row ------------------------------------------------------- */

function WorkloadRow({
  name,
  roleTitle,
  loadPoints,
  capacityPoints,
  openTasks,
  band,
  otherWorkPct,
}: (typeof PREVIEW_MEMBERS)[number]) {
  const pct = Math.round((loadPoints / capacityPoints) * 100);
  const meta = WORKLOAD_BAND_META[band];
  const overThreshold = otherWorkPct > SYSTEM_DEFAULTS.otherWorkWarningPct;

  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-[120ms] hover:bg-bg-hover">
      <Avatar name={name} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-body-sm font-medium text-text-primary">{name}</p>
          <p className="tabular shrink-0 text-caption text-text-secondary">
            {loadPoints} / {capacityPoints} pts
          </p>
        </div>

        <div className="mt-1.5 flex items-center gap-2.5">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(pct, 100)}%`,
                backgroundColor: `var(--${meta.token})`,
              }}
            />
          </span>
          <span className="tabular w-9 shrink-0 text-right text-caption font-medium text-text-primary">
            {pct}%
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-micro text-text-tertiary">{roleTitle}</span>
          <span aria-hidden="true" className="text-micro text-text-disabled">
            ·
          </span>
          <span className="text-micro text-text-tertiary">{openTasks} open</span>
          <Badge token={meta.token} size="sm" variant="outline">
            {meta.label}
          </Badge>
          {overThreshold && (
            <span
              className="text-micro font-medium"
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

  return (
    <AppShell
      role="admin"
      userName="Sana Minhas"
      title="Dashboard"
      subtitle="Thursday, 6 August 2026 · Week 32"
    >
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* ---- Preview notice ---- */}
        <div className="flex items-start gap-3 rounded-lg border border-border-gold bg-bg-gold-subtle px-4 py-3">
          <Sparkles
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: 'var(--accent-gold)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-secondary">
            <span className="font-medium text-text-primary">Interface preview.</span> Figures are
            placeholder data that follows the real rules — 36-point weekly capacity, weighted load,
            the actual threshold bands. Live data arrives once the database lands in Step 2.
          </p>
        </div>

        {/* ---- KPIs ---- */}
        <section aria-label="Key figures">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {PREVIEW_STATUS_COUNTS.map(({ status, count }) => {
              const meta = STATUS_META[status];
              return (
                <Stat
                  key={status}
                  label={meta.label}
                  value={count}
                  token={meta.token}
                  hint={status === 'done' ? 'this week' : undefined}
                  trend={
                    status === 'done'
                      ? { direction: 'up', text: '+3', good: true }
                      : status === 'blocked'
                        ? { direction: 'up', text: '+1', good: false }
                        : undefined
                  }
                />
              );
            })}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          {/* ---- Needs attention ---- */}
          <Card className="xl:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Needs attention</CardTitle>
                <p className="mt-0.5 text-caption text-text-secondary">
                  Work that will slip unless someone acts today
                </p>
              </div>
              <Badge token="feedback-error" size="sm">
                4 items
              </Badge>
            </CardHeader>

            <ul className="divide-y divide-border-subtle">
              {PREVIEW_TASKS.filter(
                (t) => t.overdue || t.status === 'blocked' || t.timeSpentMinutes > t.timeLimitMinutes,
              ).map((task) => {
                const status = STATUS_META[task.status];
                const project = PROJECT_TYPE_META[task.projectType];
                const overLimitBy = task.timeSpentMinutes - task.timeLimitMinutes;

                return (
                  <li
                    key={task.reference}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors duration-[120ms] hover:bg-bg-hover"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--${status.token})` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-caption text-text-brand">
                          {task.reference}
                        </span>
                        <span className="truncate text-body-sm font-medium text-text-primary">
                          {task.title}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge token={project.token} size="sm" variant="outline">
                          {task.projectName}
                        </Badge>
                        <Badge token={PRIORITY_TOKEN[task.priority]} size="sm">
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                        <span
                          className="text-micro font-medium"
                          style={{
                            color: task.overdue
                              ? 'var(--feedback-error)'
                              : 'var(--text-tertiary)',
                          }}
                        >
                          {task.dueLabel}
                        </span>
                        {overLimitBy > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-micro font-medium"
                            style={{ color: 'var(--feedback-warning)' }}
                          >
                            <TimerReset className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
                            {formatDuration(overLimitBy)} over limit
                          </span>
                        )}
                      </div>
                    </div>
                    <Avatar name={task.assignee} size="xs" className="mt-0.5" />
                  </li>
                );
              })}
            </ul>

            <CardFooter className="flex justify-end">
              <Button variant="ghost" size="sm">
                View all tasks
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>

          {/* ---- Team workload ---- */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Team workload</CardTitle>
                <p className="mt-0.5 text-caption text-text-secondary">
                  Team average {teamAverage}% · {SYSTEM_DEFAULTS.defaultWeeklyCapacity} pts/week
                </p>
              </div>
            </CardHeader>

            <CardBody className="space-y-0.5 px-3 py-3">
              {PREVIEW_MEMBERS.map((member) => (
                <WorkloadRow key={member.id} {...member} />
              ))}
            </CardBody>

            {overLimit.length > 0 && (
              <CardFooter className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--load-over)' }}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <p className="text-caption text-text-secondary">
                    <span className="font-medium text-text-primary">
                      {overLimit[0].name} is over capacity
                    </span>{' '}
                    at {Math.round((overLimit[0].loadPoints / overLimit[0].capacityPoints) * 100)}%
                    on just {overLimit[0].openTasks} tasks — both are XL builds.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <Sparkles
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--accent-gold)' }}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <p className="text-caption text-text-secondary">
                    Move one subtask to{' '}
                    <span className="font-medium text-text-primary">{lightest.name}</span> —
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

        {/* ---- Active work + activity ---- */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Active work</CardTitle>
                <p className="mt-0.5 text-caption text-text-secondary">
                  In progress right now, with time against limit
                </p>
              </div>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border-subtle">
                    {['Task', 'Assignee', 'Status', 'Time', 'Due'].map((heading, i) => (
                      <th
                        key={heading}
                        className={cn(
                          'px-5 py-2.5 text-micro font-semibold uppercase tracking-[0.07em] text-text-tertiary',
                          i === 0 ? 'text-left' : i > 2 ? 'text-right' : 'text-left',
                        )}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {PREVIEW_TASKS.map((task) => {
                    const status = STATUS_META[task.status];
                    const project = PROJECT_TYPE_META[task.projectType];
                    const pct = Math.round((task.timeSpentMinutes / task.timeLimitMinutes) * 100);
                    const over = pct > 100;

                    return (
                      <tr
                        key={task.reference}
                        className="transition-colors duration-[120ms] hover:bg-bg-hover"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-caption text-text-brand">
                              {task.reference}
                            </span>
                            <span className="max-w-[280px] truncate text-body-sm text-text-primary">
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
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={task.assignee} size="xs" />
                            <span className="truncate text-caption text-text-secondary">
                              {task.assignee.split(' ')[0]}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Badge token={status.token} size="sm">
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className="tabular text-caption font-medium"
                            style={{
                              color: over ? 'var(--load-over)' : 'var(--text-primary)',
                            }}
                          >
                            {formatDuration(task.timeSpentMinutes)}
                          </span>
                          <span className="tabular block text-micro text-text-tertiary">
                            of {formatDuration(task.timeLimitMinutes)} · {pct}%
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className="text-caption"
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

          {/* ---- Activity ---- */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent activity</CardTitle>
                <p className="mt-0.5 text-caption text-text-secondary">
                  Live from Phase 3 onwards
                </p>
              </div>
              <Clock className="h-4 w-4 text-text-tertiary" strokeWidth={1.75} aria-hidden="true" />
            </CardHeader>

            <CardBody className="space-y-0 px-3 py-2">
              {PREVIEW_ACTIVITY.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-[120ms] hover:bg-bg-hover"
                >
                  <Avatar name={entry.actor} size="xs" className="mt-0.5" />
                  <p className="min-w-0 flex-1 text-caption text-text-secondary">
                    <span className="font-medium text-text-primary">{entry.actor}</span>{' '}
                    {entry.action}{' '}
                    <span className="font-mono text-text-brand">{entry.target}</span>
                  </p>
                  <span className="shrink-0 text-micro text-text-tertiary">{entry.when}</span>
                </div>
              ))}
            </CardBody>

            <CardFooter className="flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4 shrink-0"
                style={{ color: 'var(--feedback-success)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
              <p className="text-caption text-text-secondary">
                On-time rate <span className="tabular font-medium text-text-primary">83%</span> this
                week
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
