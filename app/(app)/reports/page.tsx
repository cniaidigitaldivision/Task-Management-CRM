import type { Metadata } from 'next';
import { CheckCircle2, Clock, Package, Target, TimerOff } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { StatCard } from '@/components/ui/metric';
import { ExportButton } from '@/components/ui/export-button';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar, SegmentLegend, SegmentedBar, type Segment } from '@/components/ui/progress';
import { requireRole } from '@/lib/auth/current-user';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { teamWorkload } from '@/lib/db/queries/workload';
import {
  PROJECT_TYPE_META,
  STATUS_META,
  type ProjectType,
} from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';

export const metadata: Metadata = { title: 'Reports' };

/* ============================================================================
 * REPORTS — doc 10 §8
 * ----------------------------------------------------------------------------
 * Four questions a division lead actually has to answer, and nothing else:
 *
 *   Are we delivering on time?          on-time completion rate
 *   Are our estimates any good?         time spent against time allowed
 *   Where is the effort going?          by project type
 *   Who is carrying the delivery?       completions per person
 *
 * ── WHY NO CHARTS BEYOND THE ONE ─────────────────────────────────────────────
 * The rule adopted in session 09 after researching Salesforce, Domo and
 * monday.com: add a chart only when a list stops answering the question. Four
 * numbers and two lists answer these four questions completely. A dashboard of
 * decorative graphs is how reports stop being read.
 *
 * Every figure is computed on the request from rows the viewer is allowed to see
 * — so a Coordinator's report covers the division and a Member's covers
 * themselves, from the same code.
 * ========================================================================= */

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default async function ReportsPage() {
  // Division reporting is a lead view. Hiding the nav item is convenience, not security (NFR-006).
  const user = await requireRole('team_coordinator');
  const now = nowMs();

  const [rows, projects, { people }] = await Promise.all([
    listTasks(user.id, { includeClosed: true }),
    listProjects(user.id, { includeArchived: true }),
    teamWorkload(user.id, now),
  ]);

  const tasks = rows.map((row) => toTaskView(row, now));
  const done = tasks.filter((t) => t.status === 'done');
  const cancelled = tasks.filter((t) => t.status === 'cancelled');
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  /* On time means completed on or before the due date. A task with no due date
     cannot be late, so it is excluded from the denominator rather than counted as
     a success — including it would inflate the rate every time somebody forgot to
     set a date, which is exactly backwards. */
  const datedDone = done.filter((t) => t.dueDate);
  const onTime = datedDone.filter((t) => !t.dueLabel.includes('late')).length;
  const onTimePct = pct(onTime, datedDone.length);

  /* Estimate quality: of the finished work that had a time limit, how much came
     in inside it. This is the number that tells you whether the estimates are
     worth anything, and it is the one most teams never look at. */
  const limited = done.filter((t) => t.timeLimitMinutes > 0);
  const insideLimit = limited.filter((t) => t.timeSpentMinutes <= t.timeLimitMinutes).length;
  const estimatePct = pct(insideLimit, limited.length);

  const totalSpent = done.reduce((sum, t) => sum + t.timeSpentMinutes, 0);
  const totalAllowed = limited.reduce((sum, t) => sum + t.timeLimitMinutes, 0);

  const overLimitOpen = open.filter(
    (t) => t.timeLimitMinutes > 0 && t.timeSpentMinutes > t.timeLimitMinutes,
  );

  /* Effort by project type — where the division's capacity actually goes, as
     opposed to where anybody thinks it goes. */
  const byType = new Map<ProjectType, number>();
  for (const task of open) {
    byType.set(task.projectType, (byType.get(task.projectType) ?? 0) + task.effortPoints);
  }
  const typeSegments: Segment[] = [...byType.entries()]
    .filter(([, points]) => points > 0)
    .sort((a, b) => PROJECT_TYPE_META[a[0]].shedPriority - PROJECT_TYPE_META[b[0]].shedPriority)
    .map(([type, points]) => ({
      key: type,
      label: PROJECT_TYPE_META[type].label,
      value: points,
      token: PROJECT_TYPE_META[type].token,
    }));

  /* Completions per person, and their revision load. A high revision count is
     not a criticism — it usually means the brief was thin. */
  const perPerson = people
    .map((person) => {
      const theirs = tasks.filter((t) => t.assigneeId === person.userId);
      const theirDone = theirs.filter((t) => t.status === 'done');
      const theirDated = theirDone.filter((t) => t.dueDate);
      const theirOnTime = theirDated.filter((t) => !t.dueLabel.includes('late')).length;
      return {
        ...person,
        completed: theirDone.length,
        onTimePct: pct(theirOnTime, theirDated.length),
        dated: theirDated.length,
        inRevision: theirs.filter((t) => t.status === 'revisions').length,
        minutes: theirDone.reduce((sum, t) => sum + t.timeSpentMinutes, 0),
      };
    })
    .sort((a, b) => b.completed - a.completed);

  const statusSegments: Segment[] = (Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>)
    .map((status) => ({
      key: status,
      label: STATUS_META[status].label,
      value: tasks.filter((t) => t.status === status).length,
      token: STATUS_META[status].token,
    }))
    .filter((segment) => segment.value > 0);

  const hours = (minutes: number) => `${Math.round(minutes / 60)}h`;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="Live, computed on this request"
        title="Reports"
        description={
          <>
            <span className="tabular font-semibold text-text-primary">{done.length}</span> completed,{' '}
            <span className="tabular font-semibold text-text-primary">{open.length}</span> open,{' '}
            <span className="tabular">{cancelled.length}</span> cancelled. Nothing here is a stored
            aggregate — every figure is derived from the rows you are allowed to see, so it cannot
            drift out of date.
          </>
        }
        actions={<ExportButton kind="tasks" label="Export tasks" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Target}
          token={onTimePct >= 80 ? 'feedback-success' : onTimePct >= 60 ? 'load-warning' : 'feedback-error'}
          label="On time"
          value={datedDone.length > 0 ? `${onTimePct}%` : '—'}
          hint={
            datedDone.length > 0
              ? `${onTime} of ${datedDone.length} completed by their due date`
              : 'No completed work carried a due date'
          }
        />
        <StatCard
          icon={Clock}
          token={estimatePct >= 75 ? 'feedback-success' : estimatePct >= 50 ? 'load-warning' : 'feedback-error'}
          label="Inside the estimate"
          value={limited.length > 0 ? `${estimatePct}%` : '—'}
          hint={
            limited.length > 0
              ? `${insideLimit} of ${limited.length} finished within their time limit`
              : 'No completed work had a time limit set'
          }
        />
        <StatCard
          icon={CheckCircle2}
          token="accent-primary"
          label="Time delivered"
          value={hours(totalSpent)}
          hint={totalAllowed > 0 ? `against ${hours(totalAllowed)} allowed` : 'across all completed work'}
        />
        <StatCard
          icon={TimerOff}
          token={overLimitOpen.length > 0 ? 'feedback-error' : 'feedback-success'}
          label="Open and over limit"
          value={overLimitOpen.length}
          hint={
            overLimitOpen.length > 0
              ? 'Needs an extension or an explanation (ADR-010)'
              : 'Nothing open has run past its limit'
          }
        />
      </div>

      <PageSection
        step={1}
        title="Where the effort is going"
        description="Open effort points by project type, ordered the way work gets shed when somebody is overloaded — client work is protected first, ad-hoc favours go first (FR-118)."
      >
        <Card>
          <CardBody className="space-y-4 p-5">
            {typeSegments.length > 0 ? (
              <>
                <SegmentedBar segments={typeSegments} height="h-3.5" />
                <SegmentLegend segments={typeSegments} />
              </>
            ) : (
              <p className="text-caption text-text-secondary">No open work to break down yet.</p>
            )}
          </CardBody>
        </Card>
      </PageSection>

      <PageSection step={2} title="Delivery by person and by project">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardToolbar title="Completions per person" />
            <ul className="divide-y divide-border-subtle">
              {perPerson.length === 0 && (
                <li className="px-5 py-6 text-caption text-text-tertiary">Nothing completed yet.</li>
              )}
              {perPerson.map((person) => (
                <li key={person.userId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={person.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption font-semibold text-text-primary">
                      {person.name}
                    </p>
                    <p className="tabular text-micro text-text-tertiary">
                      {hours(person.minutes)} delivered
                      {person.inRevision > 0 && (
                        <> · {person.inRevision} in revision</>
                      )}
                    </p>
                  </div>
                  {person.dated > 0 && (
                    <div className="w-20 shrink-0">
                      <ProgressBar
                        value={person.onTimePct}
                        token={
                          person.onTimePct >= 80
                            ? 'feedback-success'
                            : person.onTimePct >= 60
                              ? 'load-warning'
                              : 'feedback-error'
                        }
                        size="sm"
                        label={`${person.name}: ${person.onTimePct}% on time`}
                      />
                      <p className="tabular mt-1 text-right text-micro text-text-tertiary">
                        {person.onTimePct}% on time
                      </p>
                    </div>
                  )}
                  <p className="tabular w-10 shrink-0 text-right text-h3 font-semibold text-text-primary">
                    {person.completed}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardToolbar title="Project completion" />
            <ul className="divide-y divide-border-subtle">
              {projects
                .filter((p) => p.taskCount > 0)
                .sort((a, b) => b.taskCount - a.taskCount)
                .map((project) => {
                  const donePct = pct(project.doneTaskCount, project.taskCount);
                  return (
                    <li key={project.id} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption font-medium text-text-primary">
                            {project.name}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <Badge token={PROJECT_TYPE_META[project.type].token} size="sm">
                              {PROJECT_TYPE_META[project.type].label}
                            </Badge>
                            <span className="tabular text-micro text-text-tertiary">
                              {project.doneTaskCount}/{project.taskCount}
                            </span>
                          </div>
                        </div>
                        <div className="w-24 shrink-0">
                          <ProgressBar
                            value={donePct}
                            token="accent-primary"
                            size="sm"
                            label={`${project.name}: ${donePct}% complete`}
                          />
                          <p className="tabular mt-1 text-right text-micro font-semibold text-text-primary">
                            {donePct}%
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Card>
        </div>
      </PageSection>

      <PageSection
        step={3}
        title="Everything, by status"
        description="Including closed work, so the shape of what has been delivered is visible next to what is still moving."
      >
        <Card>
          <CardBody className="space-y-4 p-5">
            <SegmentedBar segments={statusSegments} height="h-3.5" />
            <SegmentLegend segments={statusSegments} />
          </CardBody>
        </Card>
      </PageSection>

      <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-bg-surface-sunken px-4 py-3">
        <Package className="mt-px h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
        <p className="text-micro text-text-tertiary">
          On-time excludes work with no due date — counting it as a success would inflate the rate
          every time somebody forgot to set one. CSV export and the scheduled digest are Phase 5
          (FR-090, FR-091).
        </p>
      </div>
    </div>
  );
}
