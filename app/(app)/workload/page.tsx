import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Gauge, TrendingUp, Users } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress';
import { requireRole } from '@/lib/auth/current-user';
import { listTasks } from '@/lib/db/queries/tasks';
import { teamUtilisation, teamWorkload } from '@/lib/db/queries/workload';
import {
  PRIORITY_WEIGHT,
  STATUS_META,
  WORKLOAD_BAND_META,
  type WorkloadBand,
} from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';
import { toTaskView } from '@/lib/view/task-view';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = { title: 'Workload' };

/* ============================================================================
 * WORKLOAD — doc 06, doc 10 §5
 * ----------------------------------------------------------------------------
 * The screen the whole capacity model exists to produce. It answers one
 * question — who is in trouble — and it is ordered busiest-first so the answer
 * is at the top rather than buried in an alphabetical list.
 *
 * ── WHY THE FORMULA IS PRINTED ON THE PAGE ───────────────────────────────────
 * A percentage nobody can reconstruct gets ignored the first time it disagrees
 * with somebody's gut. Showing "effort × priority × status weight" and each
 * person's own points means the number can be argued with — and a number that
 * can be argued with is a number that gets trusted.
 * ========================================================================= */

export default async function WorkloadPage() {
  // doc 03: workload.view_team is denied to a Member. Hiding the nav item is convenience, not security (NFR-006).
  const user = await requireRole('team_coordinator');
  const now = nowMs();

  const [{ window, people }, rows, settings] = await Promise.all([
    teamWorkload(user.id, now),
    listTasks(user.id, { includeClosed: false }),
    getSettings(),
  ]);

  const softPct = Number(settings.softThresholdPct);
  const hardPct = Number(settings.hardThresholdPct);

  const team = teamUtilisation(people);
  const tasks = rows.map((row) => toTaskView(row, now));

  const counts: Record<WorkloadBand, number> = {
    available: 0,
    healthy: 0,
    warning: 0,
    over: 0,
  };
  for (const person of people) counts[person.workload.band] += 1;

  const over = people.filter((p) => p.workload.band === 'over' && !p.workload.isFullyUnavailable);
  const unassigned = tasks.filter((t) => !t.assigneeId);

  /* doc 06 §5's rebalance idea, in its simplest honest form: the people with the
     most headroom, and what could move to them. Not an automated shuffle — a
     suggestion a human accepts, because reassigning somebody's work without
     asking is how a tool gets resented. */
  const headroom = [...people]
    .filter((p) => !p.workload.isFullyUnavailable && p.workload.utilisationPct < 60)
    .sort((a, b) => a.workload.utilisationPct - b.workload.utilisationPct)
    .slice(0, 3);

  const movable = over
    .flatMap((person) =>
      tasks
        .filter((t) => t.assigneeId === person.userId && (t.status === 'todo' || t.status === 'backlog'))
        .map((t) => ({ task: t, from: person.name })),
    )
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow={`Week of ${window.start} to ${window.end}`}
        title="Workload"
        description={
          <>
            The division is at{' '}
            <span className="tabular font-semibold text-text-primary">{team.utilisationPct}%</span>{' '}
            — <span className="tabular">{team.loadPoints}</span> of{' '}
            <span className="tabular">{team.capacityPoints}</span> points. Load is effort ×
            priority weight × status weight, summed over open work. Nothing here is stored; it is
            computed every time you look.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Gauge}
          token={
            team.utilisationPct >= 100
              ? 'load-over'
              : team.utilisationPct >= softPct
                ? 'load-warning'
                : 'load-healthy'
          }
          label="Division utilisation"
          value={`${team.utilisationPct}%`}
          hint={`${team.loadPoints} of ${team.capacityPoints} points`}
        />
        <StatCard
          icon={AlertTriangle}
          token={counts.over > 0 ? 'load-over' : 'load-healthy'}
          label="Over their limit"
          value={counts.over}
          hint={`Blocked from new work above ${hardPct}%`}
        />
        <StatCard
          icon={TrendingUp}
          token={counts.warning > 0 ? 'load-warning' : 'load-healthy'}
          label="Near their limit"
          value={counts.warning}
          hint={`${softPct}–${hardPct}% — warned, not blocked`}
        />
        <StatCard
          icon={Users}
          token="load-available"
          label="With headroom"
          value={counts.available}
          hint="Under 60% — preferred for new work"
        />
      </div>

      {/* ---- The band legend, as readable tiles ----
          Rebuilt in session 09 after the owner reported it unreadable: it had
          been three facts on one line, 6px apart, in 11px grey. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(WORKLOAD_BAND_META) as WorkloadBand[]).map((band) => {
          const meta = WORKLOAD_BAND_META[band];
          return (
            <div
              key={band}
              className="rounded-xl border border-border-subtle bg-bg-surface px-4 py-3"
              style={{ borderLeft: `3px solid var(--${meta.token})` }}
            >
              <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
                {meta.label}
              </p>
              <p className="tabular mt-0.5 text-h2 font-semibold" style={{ color: `var(--${meta.token})` }}>
                {counts[band]}
              </p>
              <p className="tabular text-micro text-text-tertiary">
                {meta.maxPct === null ? `${meta.minPct}%+` : `${meta.minPct}–${meta.maxPct - 1}%`}
              </p>
            </div>
          );
        })}
      </div>

      <PageSection
        step={1}
        title="Person by person"
        description="Busiest first. The concurrent-task count is the second guard — somebody at 40% capacity juggling twelve things is still in trouble (doc 06 §1)."
      >
        <Card>
          <ul className="divide-y divide-border-subtle">
            {people.map((person) => {
              const band = WORKLOAD_BAND_META[person.workload.band];
              const w = person.workload;
              return (
                <li key={person.userId} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar name={person.name} size="md" />

                    <div className="min-w-[10rem] flex-1">
                      <p className="text-body-sm font-semibold text-text-primary">{person.name}</p>
                      <p className="text-micro text-text-tertiary">{person.roleTitle ?? '—'}</p>
                    </div>

                    <div className="min-w-[12rem] flex-[2]">
                      <ProgressBar
                        value={Math.min(w.utilisationPct, 100)}
                        token={band.token}
                        size="lg"
                        label={`${person.name}: ${w.utilisationPct}% of capacity`}
                      />
                    </div>

                    <div className="w-28 shrink-0 text-right">
                      <p
                        className="tabular text-h2 font-semibold"
                        style={{ color: `var(--${band.token})` }}
                      >
                        {w.isFullyUnavailable ? '—' : `${w.utilisationPct}%`}
                      </p>
                      <p className="text-micro text-text-tertiary">
                        {w.isFullyUnavailable ? 'On leave' : band.label}
                      </p>
                    </div>
                  </div>

                  {/* The arithmetic, spelled out. This is what makes the figure
                      arguable rather than merely asserted. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-0 sm:pl-[3.25rem]">
                    <span className="tabular text-micro text-text-secondary">
                      <span className="font-semibold text-text-primary">{w.loadPoints}</span> of{' '}
                      {w.effectiveCapacityPoints} pts
                      {w.availabilityMultiplier < 1 && (
                        <span className="text-text-tertiary">
                          {' '}
                          (capacity reduced to {Math.round(w.availabilityMultiplier * 100)}% by leave)
                        </span>
                      )}
                    </span>
                    <span className="tabular text-micro text-text-secondary">
                      <span className="font-semibold text-text-primary">{w.openTaskCount}</span> open
                    </span>
                    <span
                      className="tabular text-micro"
                      style={{
                        color: w.atMaxConcurrent ? 'var(--load-warning)' : 'var(--text-secondary)',
                      }}
                    >
                      <span className="font-semibold">{w.activeTaskCount}</span> /{' '}
                      {w.maxConcurrentTasks} in flight
                      {w.atMaxConcurrent && ' — at their limit'}
                    </span>
                    {person.otherWorkPct > 0 && (
                      <Badge
                        token={person.otherWorkHigh ? 'load-warning' : 'project-other'}
                        size="sm"
                        variant="outline"
                      >
                        {person.otherWorkPct}% ad-hoc
                      </Badge>
                    )}
                    <Link
                      href={`/tasks?assignee=${person.userId}`}
                      className="ml-auto text-micro font-semibold text-text-brand hover:underline"
                    >
                      Their tasks
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </PageSection>

      {/* ---- Rebalance advisor (doc 06 §5) ---- */}
      {(over.length > 0 || unassigned.length > 0) && (
        <PageSection
          step={2}
          title="What to do about it"
          description="Suggestions, not actions. Moving somebody's work without asking them is how a tool like this gets resented."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardBody className="space-y-3 p-5">
                <div className="flex items-center gap-2.5">
                  <IconTile icon={AlertTriangle} token="load-over" size="md" />
                  <h3 className="text-caption font-semibold text-text-primary">
                    Could move off an overloaded person
                  </h3>
                </div>

                {movable.length === 0 ? (
                  <p className="text-caption text-text-secondary">
                    {over.length === 0
                      ? 'Nobody is over their limit.'
                      : 'Everything the overloaded people hold is already in flight — moving in-progress work usually costs more than it saves.'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {movable.map(({ task, from }) => (
                      <li key={task.id} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--${STATUS_META[task.status].token})` }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption text-text-primary">
                            <span className="tabular font-mono text-micro font-semibold text-text-brand">
                              {task.reference}
                            </span>{' '}
                            {task.title}
                          </p>
                          <p className="text-micro text-text-tertiary">
                            {from} · {task.effort} ({task.effortPoints} pts ×{' '}
                            {PRIORITY_WEIGHT[task.priority]} priority) · not started
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {headroom.length > 0 && (
                  <p className="border-t border-border-subtle pt-3 text-micro text-text-secondary">
                    Most headroom right now:{' '}
                    {headroom.map((p, i) => (
                      <span key={p.userId}>
                        {i > 0 && ', '}
                        <span className="font-semibold text-text-primary">{p.name}</span> (
                        {p.workload.utilisationPct}%)
                      </span>
                    ))}
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3 p-5">
                <div className="flex items-center gap-2.5">
                  <IconTile icon={Users} token="accent-primary" size="md" />
                  <h3 className="text-caption font-semibold text-text-primary">
                    Waiting for an owner
                  </h3>
                </div>

                {unassigned.length === 0 ? (
                  <p className="text-caption text-text-secondary">
                    Everything open has somebody on it.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {unassigned.slice(0, 6).map((task) => (
                      <li key={task.id} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--${STATUS_META[task.status].token})` }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption text-text-primary">
                            <span className="tabular font-mono text-micro font-semibold text-text-brand">
                              {task.reference}
                            </span>{' '}
                            {task.title}
                          </p>
                          <p className="text-micro text-text-tertiary">
                            {task.projectName} · {task.dueLabel}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </PageSection>
      )}
    </div>
  );
}
