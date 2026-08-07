import type { Metadata } from 'next';
import { AlertTriangle, CheckCircle2, Clock, Gauge, ListChecks } from 'lucide-react';

import { TasksWorkspace } from '@/components/task/tasks-workspace';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { teamWorkload } from '@/lib/db/queries/workload';
import { WORKLOAD_BAND_META } from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = { title: 'My Work' };

/* ============================================================================
 * MY WORK — doc 10 §2
 * ----------------------------------------------------------------------------
 * The screen every member opens first, and the only one a member has that the
 * others do not: their own load, their own queue, nothing else on it.
 *
 * ── WHY IT REUSES THE TASKS WORKSPACE ────────────────────────────────────────
 * The list, the board, the filters, the drag-and-drop, the reason prompt and the
 * detail drawer are all the same behaviour with a narrower set of rows. A second
 * implementation would be the place the two versions diverged — and it is
 * always the less-used one that keeps the bug.
 *
 * The difference is above the workspace: your capacity, and what is late.
 * ========================================================================= */

export default async function MyWorkPage() {
  const user = await requireUser();
  const now = nowMs();

  const [rows, workload, people, projects] = await Promise.all([
    listTasks(user.id, { assigneeId: user.id, includeClosed: true }),
    teamWorkload(user.id, now),
    listAssignablepeople(user.id),
    listProjects(user.id),
  ]);

  const otherWarningPct = Number((await getSettings()).otherWorkWarningPct);

  const tasks = rows.map((row) => toTaskView(row, now));
  const mine = workload.people.find((p) => p.userId === user.id);
  const band = mine ? WORKLOAD_BAND_META[mine.workload.band] : null;

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const overdue = open.filter((t) => t.overdue);
  const inProgress = open.filter((t) => t.status === 'in_progress' || t.status === 'revisions');
  const waiting = open.filter((t) => t.status === 'in_review' || t.status === 'blocked');
  const overLimit = open.filter(
    (t) => t.timeLimitMinutes > 0 && t.timeSpentMinutes > t.timeLimitMinutes,
  );
  const doneRecently = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow={user.roleTitle ?? 'Your queue'}
        title={`Your work, ${user.fullName.split(' ')[0]}`}
        description={
          <>
            <span className="tabular font-semibold text-text-primary">{open.length}</span> open,{' '}
            <span className="tabular font-semibold text-text-primary">{inProgress.length}</span> in
            flight
            {overdue.length > 0 && (
              <>
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                  {overdue.length} late
                </span>
              </>
            )}
            . Start a timer from any task to track time against its limit.
          </>
        }
      />

      {/* ---- Your capacity, first: it is the number that decides what to say yes to ---- */}
      {mine && band && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
            <IconTile icon={Gauge} token={band.token} size="xl" />

            <div className="min-w-[12rem] flex-1">
              <p className="text-caption font-semibold text-text-secondary">This week</p>
              <p className="tabular text-h1 font-semibold" style={{ color: `var(--${band.token})` }}>
                {mine.workload.isFullyUnavailable ? 'On leave' : `${mine.workload.utilisationPct}%`}
              </p>
              <p className="text-caption text-text-secondary">
                {band.label} ·{' '}
                <span className="tabular">{mine.workload.loadPoints}</span> of{' '}
                <span className="tabular">{mine.workload.effectiveCapacityPoints}</span> points
                {mine.workload.availabilityMultiplier < 1 && (
                  <> (reduced by approved leave)</>
                )}
              </p>
            </div>

            <div className="min-w-[14rem] flex-1">
              <ProgressBar
                value={Math.min(mine.workload.utilisationPct, 100)}
                token={band.token}
                size="lg"
                label={`Your load: ${mine.workload.utilisationPct}% of capacity`}
              />
              <p className="mt-2 text-micro text-text-tertiary">
                {mine.workload.activeTaskCount} of {mine.workload.maxConcurrentTasks} concurrent
                tasks in flight
                {mine.workload.atMaxConcurrent && (
                  <span style={{ color: 'var(--load-warning)' }}>
                    {' '}
                    — at your limit. Volume may be fine; attention is not.
                  </span>
                )}
              </p>
              {mine.otherWorkHigh && (
                <p className="mt-1 text-micro" style={{ color: 'var(--load-warning)' }}>
                  {mine.otherWorkPct}% of your open work is ad-hoc, above the{' '}
                  {otherWarningPct}% line. Worth raising.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ListChecks} token="accent-primary" label="Open" value={open.length} />
        <StatCard
          icon={Clock}
          token="status-progress"
          label="In flight"
          value={inProgress.length}
          hint="In Progress or Revisions"
        />
        <StatCard
          icon={AlertTriangle}
          token={waiting.length > 0 ? 'load-warning' : 'load-healthy'}
          label="Waiting on someone"
          value={waiting.length}
          hint="In review or blocked"
        />
        <StatCard
          icon={CheckCircle2}
          token="feedback-success"
          label="Completed"
          value={doneRecently}
        />
      </div>

      {overLimit.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--feedback-error) 35%, transparent)',
            backgroundColor:
              'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
          }}
        >
          <IconTile icon={Clock} token="feedback-error" size="sm" />
          <p className="text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">
              {overLimit.length} {overLimit.length === 1 ? 'task is' : 'tasks are'} past the allowed
              time.
            </span>{' '}
            Open one and say what happened, or ask an Admin for an extension — the limit stays until
            somebody accounts for it (ADR-010).
          </p>
        </div>
      )}

      <PageSection
        step={1}
        title="Your queue"
        description="Drag a card to change its status. Anything you cannot do says why rather than going quiet."
      >
        <TasksWorkspace
          initialTasks={tasks}
          currentUser={{ id: user.id, name: user.fullName, role: user.role }}
          people={people.map((p) => ({ id: p.id, name: p.fullName, roleTitle: p.roleTitle }))}
          projects={projects.map((p) => ({ id: p.id, name: p.name, type: p.type, code: p.code }))}
        />
      </PageSection>
    </div>
  );
}
