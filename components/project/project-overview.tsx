'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Plus,
  Target,
} from 'lucide-react';

import type { ProjectMemberRow } from '@/lib/db/queries/projects';
import type { ActivityRow, ProjectRow } from '@/lib/db/queries/types';
import {
  attention,
  deliveryCounts,
  pipeline,
  weekOf,
  type PipelineTask,
} from '@/lib/domain/content-pipeline';
import type { ContentKind } from '@/lib/domain/constants';
import { WEEKDAY_LABEL } from '@/lib/domain/cadence';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PROJECT OVERVIEW — built to the owner's mockup, 2026-08-20
 * ----------------------------------------------------------------------------
 * *"I want any project detail page exactly like this image… I want this same UI."*
 *
 * Five KPI cards, a progress card, a five-stage content pipeline, this week's
 * schedule, the package summary, who is accountable, what needs attention, and the
 * recent activity.
 *
 * ── ⚠️ EVERY FIGURE IS REAL, OR THE PANEL SAYS IT HAS NOTHING ─────────────────
 * The mockup is populated with plausible numbers — 22 target, 7 published, 4 in
 * review — and the temptation with a design like this is to hardcode something that
 * looks like the picture. Nothing here is hardcoded. Each panel is derived from the
 * project's own tasks by `lib/domain/content-pipeline.ts` (24 tests), and where the
 * division genuinely has no data the panel says so rather than showing a number that
 * would be a lie on a page somebody forwards to a client.
 *
 * That is why a fresh project looks emptier than the mockup. It is the same layout
 * with honest contents.
 *
 * ── THE STAGES ARE DERIVED, NOT STORED ───────────────────────────────────────
 * Ideas / Design / Review / Scheduled / Published are a VIEW over `tasks.status` and
 * `tasks.published_on`. No new column, so the board, the task drawer and every report
 * cannot disagree with this page. The reasoning is in that module's header — in
 * particular why a finished task with no publish date is NOT counted as published.
 * ========================================================================= */

/** Short labels for the chips, where the full one is too long for a column. */
const KIND_SHORT: Readonly<Record<ContentKind, string>> = {
  static: 'Post',
  reel: 'Reel',
  carousel: 'Carousel',
  story: 'Story',
  video: 'Video',
  website: 'Website',
  ad: 'Ad',
  report: 'Report',
  other: 'Other',
};

function money(pkr: number | null): string {
  if (pkr === null) return '—';
  /* Locale passed explicitly — an argless `toLocaleString()` renders differently on
     the server and in the browser and React reports it as a hydration mismatch. */
  return `PKR ${pkr.toLocaleString('en-PK')}`;
}

/**
 * "1 a day, 2 reels a week".
 *
 * ⚠️ Distinguishes null from 0: "no rhythm agreed" and "agreed to post nothing" are
 * different statements, and the second is a real thing a paused retainer says.
 */
function rhythmSentence(staticPerDay: number | null, reelsPerWeek: number | null): string {
  const parts: string[] = [];
  if (staticPerDay !== null) {
    parts.push(staticPerDay === 0 ? 'no daily posts' : `${staticPerDay} a day`);
  }
  if (reelsPerWeek !== null) {
    parts.push(
      reelsPerWeek === 0 ? 'no reels' : `${reelsPerWeek} reel${reelsPerWeek === 1 ? '' : 's'} a week`,
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing agreed';
}

export function ProjectOverview({
  project,
  members,
  tasks,
  activity,
  monthStart,
  monthLabel,
  today,
  canSeeFinance,
  onAddContent,
}: {
  project: ProjectRow;
  members: readonly ProjectMemberRow[];
  tasks: readonly PipelineTask[];
  activity: readonly ActivityRow[];
  monthStart: string;
  monthLabel: string;
  today: string;
  canSeeFinance: boolean;
  /** Opens the task dialog. Passed in so this component owns no dialog state. */
  onAddContent: () => void;
}) {
  const counts = deliveryCounts(tasks, project.assetsTargetMin, monthStart, today);
  const stages = pipeline(tasks, today);
  const week = weekOf(tasks, today, 6);
  const needsAttention = attention(tasks, today);

  const target = counts.target;
  const pct = (n: number) => (target && target > 0 ? Math.round((n / target) * 100) : null);

  /* Days left in the month — the mockup's "1 days remaining". Computed from the
     month's length rather than a fixed 30. */
  const monthDays = new Date(
    Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0),
  ).getUTCDate();
  const dayOfMonth = Number(today.slice(8, 10));
  const daysRemaining = Math.max(0, monthDays - dayOfMonth);

  const donePct = target && target > 0 ? Math.round((counts.published / target) * 100) : 0;
  /* "On track" compares progress through the target with progress through the month.
     Publishing 40% of the month's assets on the 20th is behind, not fine — which a
     bare percentage cannot tell you. */
  const monthPct = Math.round((dayOfMonth / monthDays) * 100);
  const onTrack = target === null || donePct >= monthPct - 10;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* ══ KPI ROW ═════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-9 lg:grid-cols-5">
        <Kpi
          icon={Target}
          token="accent-primary"
          label="Monthly Target"
          value={target ?? '—'}
          hint={target === null ? 'nothing agreed' : 'assets this month'}
        />
        <Kpi
          icon={CheckCircle2}
          token="feedback-success"
          label="Published"
          value={counts.published}
          hint={pct(counts.published) === null ? 'no target' : `${pct(counts.published)}% of target`}
        />
        <Kpi
          icon={Clock}
          token="feedback-warning"
          label="In Review"
          value={counts.inReview}
          hint={pct(counts.inReview) === null ? 'awaiting approval' : `${pct(counts.inReview)}% of target`}
        />
        <Kpi
          icon={CalendarClock}
          token="feedback-info"
          label="Scheduled"
          value={counts.scheduled}
          hint={pct(counts.scheduled) === null ? 'dated, not yet live' : `${pct(counts.scheduled)}% of target`}
        />
        <Kpi
          icon={FileText}
          token="accent-gold"
          label="Remaining"
          value={counts.remaining ?? '—'}
          hint={
            counts.remaining === null
              ? 'no target'
              : `${pct(counts.remaining)}% of target`
          }
        />
      </div>

      {/* ══ ATTENTION NEEDED ════════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Attention Needed</p>

          {needsAttention.length === 0 ? (
            /* ⚠️ Not a list of zeroes. A panel telling you to attend to nothing is
               worse than one that says there is nothing. */
            <p className="mt-2 flex items-center gap-1.5 text-caption text-text-secondary">
              <CheckCircle2
                className="h-4 w-4 shrink-0"
                strokeWidth={2.25}
                aria-hidden="true"
                style={{ color: 'var(--feedback-success)' }}
              />
              Nothing overdue or waiting.
            </p>
          ) : (
            <ul className="mt-1.5 divide-y divide-border-subtle">
              {needsAttention.map((item) => (
                <li key={item.key}>
                  <Link
                    href={`/tasks?project=${project.id}`}
                    className="group flex items-center gap-2.5 py-2 text-caption hover:text-text-primary"
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--${item.token}) var(--tint-medium), var(--bg-surface))`,
                        color: `var(--${item.token})`,
                      }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1 text-text-secondary">
                      <span className="font-semibold text-text-primary">{item.count}</span>{' '}
                      {item.label}
                    </span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ══ MONTH PROGRESS ══════════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-body-sm font-semibold text-text-primary">
              {monthLabel} Progress
            </p>
          </div>

          <div>
            <p className="flex items-baseline gap-1">
              <span className="tabular-nums text-display font-semibold text-text-primary">
                {counts.published}
              </span>
              {target !== null && (
                <span className="tabular-nums text-h3 text-text-tertiary">/ {target}</span>
              )}
            </p>
            <p className="text-caption text-text-secondary">assets published</p>
          </div>

          {target === null ? (
            <p className="text-micro text-text-tertiary">
              No monthly minimum agreed, so there is nothing to measure against.
            </p>
          ) : (
            <>
              <ProgressBar
                value={donePct}
                token={onTrack ? 'feedback-success' : 'feedback-warning'}
                size="lg"
                markerAt={monthPct}
                label={`${donePct}% of the monthly target`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption text-text-secondary">{donePct}% completed</span>
                <span className="flex items-center gap-2">
                  <span className="text-micro text-text-tertiary">
                    {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} left
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-micro font-semibold"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--${onTrack ? 'feedback-success' : 'feedback-warning'}) var(--tint-strong), var(--bg-surface))`,
                      color: `color-mix(in oklab, var(--${onTrack ? 'feedback-success' : 'feedback-warning'}) 84%, var(--text-primary))`,
                    }}
                    /* The marker on the bar is the month's own progress, so "behind"
                       has a visible reason rather than being an opinion. */
                    title={`${monthPct}% of the month has passed`}
                  >
                    {onTrack ? 'On track' : 'Behind'}
                  </span>
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* ══ CONTENT PIPELINE ════════════════════════════════════════════════ */}
      <Card className="lg:col-span-6">
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Content Pipeline</p>

          <div className="mt-2.5 overflow-x-auto">
            <div className="grid min-w-[36rem] grid-cols-5 gap-2">
              {stages.map((bucket) => (
                <div key={bucket.stage} className="min-w-0">
                  <div className="flex items-center justify-between gap-1 border-b border-border-subtle pb-1.5">
                    <span className="truncate text-micro font-semibold text-text-secondary">
                      {bucket.label}
                    </span>
                    <span
                      className="shrink-0 rounded px-1.5 text-micro font-semibold tabular-nums"
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--${bucket.token}) var(--tint-medium), var(--bg-surface))`,
                        color: `color-mix(in oklab, var(--${bucket.token}) 84%, var(--text-primary))`,
                      }}
                    >
                      {bucket.count}
                    </span>
                  </div>

                  <div className="mt-1.5 space-y-1.5">
                    {/* Two per column, then a count — the mockup's shape, and the
                        reason is sound: this is a health check, not a board. The
                        Tasks tab is where you work through them. */}
                    {bucket.tasks.slice(0, 2).map((task) => (
                      <div
                        key={task.id}
                        className="rounded-md border border-border-subtle bg-bg-surface p-1.5"
                        title={task.title}
                      >
                        <p className="truncate text-micro font-medium text-text-primary">
                          {task.title}
                        </p>
                        <p className="truncate text-micro text-text-tertiary">
                          {task.contentKind ? KIND_SHORT[task.contentKind] : '—'}
                        </p>
                      </div>
                    ))}

                    {bucket.count > 2 && (
                      <Link
                        href={`/tasks?project=${project.id}`}
                        className="block text-micro text-text-tertiary hover:text-text-brand hover:underline"
                      >
                        + {bucket.count - 2} more
                      </Link>
                    )}
                    {bucket.count === 0 && (
                      <p className="text-micro text-text-disabled">—</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ══ ACCOUNTABLE / TEAM ══════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Accountable / Team</p>

          <ul className="mt-2 space-y-2">
            {/* ⚠️ The owner FIRST, and labelled — owner, 2026-08-19: *"He is not the
                owner; he is assigned."* Accountability and assignment are different
                facts and this list keeps them apart. */}
            <li className="flex items-center gap-2.5">
              <Avatar name={project.ownerName ?? 'Unassigned'} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-caption font-semibold text-text-primary">
                    {project.ownerName ?? 'Nobody yet'}
                  </span>
                  <span
                    className="shrink-0 rounded px-1 text-micro font-bold"
                    style={{
                      backgroundColor:
                        'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
                      color: 'color-mix(in oklab, var(--accent-primary) 88%, var(--text-primary))',
                    }}
                    title="Accountable for this project"
                  >
                    OWNER
                  </span>
                </span>
                <span className="block truncate text-micro text-text-tertiary">
                  answers for this project
                </span>
              </span>
            </li>

            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2.5">
                <Avatar name={member.fullName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-medium text-text-primary">
                    {member.fullName}
                  </span>
                  <span className="block truncate text-micro text-text-tertiary">
                    {member.projectRole.replace(/_/g, ' ')}
                    {member.addedByName && ` · added by ${member.addedByName}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {members.length === 0 && (
            <p className="mt-2 text-micro text-text-secondary">
              Nobody else on it yet — add people in the Team tab.
            </p>
          )}
        </CardBody>
      </Card>

      {/* ══ THIS WEEK ═══════════════════════════════════════════════════════ */}
      <Card className="lg:col-span-6">
        <CardBody className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body-sm font-semibold text-text-primary">This Week</p>
            <Link
              href={`/calendar?project=${project.id}`}
              className="text-micro font-semibold text-text-brand hover:underline"
            >
              View calendar
            </Link>
          </div>

          <div className="mt-2.5 overflow-x-auto">
            <div className="grid min-w-[38rem] grid-cols-6 gap-1.5">
              {week.map((day) => {
                const isPostingDay = project.postingDays.includes(day.weekday);
                return (
                  <div key={day.date} className="min-w-0">
                    <div
                      className={cn(
                        'flex items-baseline justify-center gap-1 rounded-md py-1 text-micro font-semibold',
                        day.isToday ? 'text-text-primary' : 'text-text-secondary',
                      )}
                      style={
                        day.isToday
                          ? {
                              backgroundColor:
                                'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
                            }
                          : undefined
                      }
                    >
                      {WEEKDAY_LABEL[day.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7]}
                      <span className="tabular-nums">{Number(day.date.slice(8))}</span>
                    </div>

                    <div className="mt-1.5 space-y-1.5">
                      {day.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-md p-1.5"
                          title={task.title}
                          style={{
                            backgroundColor:
                              'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
                            boxShadow:
                              'inset 0 0 0 1px color-mix(in oklab, var(--accent-primary) 26%, transparent)',
                          }}
                        >
                          <p className="truncate text-micro font-semibold text-text-primary">
                            {task.contentKind ? KIND_SHORT[task.contentKind] : 'Task'}
                          </p>
                          <p className="truncate text-micro text-text-tertiary">
                            {task.dueTime ?? (task.publishedOn ? 'scheduled' : '')}
                          </p>
                        </div>
                      ))}

                      {/* ⚠️ An off day says so, rather than looking like a day
                          somebody forgot. Owner: *"mention that this is Sunday…
                          today is off, that's why no post today."* */}
                      {day.tasks.length === 0 && (
                        <p
                          className={cn(
                            'rounded-md py-1.5 text-center text-micro',
                            isPostingDay ? 'text-text-disabled' : 'text-text-tertiary',
                          )}
                          style={
                            isPostingDay
                              ? undefined
                              : {
                                  background:
                                    'repeating-linear-gradient(135deg, var(--bg-surface-sunken) 0 3px, transparent 3px 6px)',
                                }
                          }
                        >
                          {isPostingDay ? '—' : 'off'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onAddContent}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-default py-2 text-micro font-semibold text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            Add content
          </button>
        </CardBody>
      </Card>

      {/* ══ PACKAGE SUMMARY ═════════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Package Summary</p>

          <dl className="mt-2 space-y-2">
            <Line label="Package" value={project.packageName ?? 'Customized'} />
            {/* The rhythm in the words it was agreed in. Carried over from the card
                this panel replaced — the monthly figure alone does not tell you
                whether it is one a day or four a week. */}
            <Line
              label="Rhythm"
              value={rhythmSentence(project.staticPostsPerDay, project.reelsPerWeek)}
            />
            {/* ⚠️ Admin and above only. The value is ALSO stripped server-side before
                it reaches this component — not rendering is not the same as not
                sending, which a check of the real HTML proved. */}
            {canSeeFinance && <Line label="Monthly fee" value={money(project.monthlyFeePkr)} />}
            <Line
              label="Promised / month"
              value={project.assetsTargetMin === null ? '—' : String(project.assetsTargetMin)}
            />
            <Line
              label="Posting days"
              value={
                project.postingDays.length === 0
                  ? 'None'
                  : project.postingDays
                      .map((d) => WEEKDAY_LABEL[d as 1 | 2 | 3 | 4 | 5 | 6 | 7])
                      .join(' ')
              }
            />
            <Line label="Started on" value={project.startDate ?? '—'} />
          </dl>
        </CardBody>
      </Card>

      {/* ══ RECENT ACTIVITY ═════════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Recent Activity</p>

          {activity.length === 0 ? (
            <p className="mt-2 text-caption text-text-secondary">
              Nothing recorded yet. Every change to this project and its tasks appears here.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {activity.map((entry) => (
                <li key={entry.id} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-micro text-text-secondary">
                      {entry.actorName && (
                        <span className="font-semibold text-text-primary">
                          {entry.actorName}{' '}
                        </span>
                      )}
                      {entry.summary ?? entry.action.replace(/[._]/g, ' ')}
                    </span>
                    {/* ⚠️ The raw ISO date, not a "2 hours ago". A relative label needs
                        the clock, and a client component that reads the clock renders
                        differently on the server and in the browser — React reports
                        that as a hydration mismatch. lib/now.ts documents the rule. */}
                    <span className="block text-micro text-text-tertiary">
                      {entry.createdAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * A KPI CARD
 * ------------------------------------------------------------------------- */
function Kpi({
  icon: Icon,
  token,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  token: string;
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-3.5 shadow-sm">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, var(--${token}) 16%, transparent) 0%, transparent 70%)`,
        }}
      />
      <div className="relative flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-medium), var(--bg-surface))`,
            color: `var(--${token})`,
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-micro font-semibold text-text-secondary">
            {label}
          </span>
          <span className="block tabular-nums text-h2 font-semibold leading-tight text-text-primary">
            {value}
          </span>
        </span>
      </div>
      <p className="relative mt-1.5 truncate text-micro text-text-tertiary">{hint}</p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0">
      <dt className="shrink-0 text-micro text-text-tertiary">{label}</dt>
      <dd className="min-w-0 truncate text-right text-caption font-semibold text-text-primary">
        {value}
      </dd>
    </div>
  );
}
