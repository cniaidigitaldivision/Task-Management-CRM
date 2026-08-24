'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { WEEKDAY_LABEL, monthPlan } from '@/lib/domain/cadence';
import { generateScheduleAction } from '@/app/actions/schedule';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { ContractDialog, type PackageDetail } from './contract-dialog';

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
  months,
  today,
  canSeeFinance,
  canGenerateSchedule,
  ownerAvatarUrl,
  publishedTodayPlatformIds,
  packageDetail,
  onAddContent,
}: {
  project: ProjectRow;
  members: readonly ProjectMemberRow[];
  tasks: readonly PipelineTask[];
  activity: readonly ActivityRow[];
  monthStart: string;
  monthLabel: string;
  /** The months the selector offers, newest first. */
  months: readonly string[];
  today: string;
  canSeeFinance: boolean;
  /** `task.create_for_other` — Coordinator and above. */
  canGenerateSchedule: boolean;
  /** The owner's uploaded picture, or null. */
  ownerAvatarUrl: string | null;
  /** Platform ids that got a live placement TODAY — migration 034's placements. */
  publishedTodayPlatformIds: readonly string[];
  /** The chosen package's own terms, for the contract dialog. Null when the project
   *  is on a customised arrangement rather than a listed package. */
  packageDetail: PackageDetail | null;
  /** Opens the task dialog. Passed in so this component owns no dialog state. */
  onAddContent: () => void;
}) {
  const counts = deliveryCounts(tasks, project.assetsTargetMin, monthStart, today);
  const stages = pipeline(tasks, today);
  const week = weekOf(tasks, today, 6);
  const needsAttention = attention(tasks, today);
  const [contractOpen, setContractOpen] = React.useState(false);

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
  /* Today's expectation comes from the same `monthPlan` the calendar draws, so the
     card and the grid can never disagree about whether today is a posting day. */
  const plan = React.useMemo(
    () =>
      monthPlan(
        {
          staticPostsPerDay: project.staticPostsPerDay,
          reelsPerWeek: project.reelsPerWeek,
          reelDays: project.reelDays as never,
          postingDays: project.postingDays as never,
        },
        monthStart,
      ),
    [project.staticPostsPerDay, project.reelsPerWeek, project.reelDays, project.postingDays, monthStart],
  );
  const todayPlan = plan.days.find((day) => day.date === today) ?? null;
  const expectedToday = todayPlan ? todayPlan.staticPosts + todayPlan.reels : 0;
  /* ⚠️ `?? false` and not `?? true`: when the selected month is not the month today
     falls in there is no plan row, and calling that an off day would grey out the card
     for a reason that has nothing to do with the project's rest days. */
  const isOffDay = todayPlan?.isOff ?? false;

  const monthPct = Math.round((dayOfMonth / monthDays) * 100);
  const onTrack = target === null || donePct >= monthPct - 10;

  return (
    /* ── ⚠️ DENSITY PASS — owner request 2026-08-20 ────────────────────────────
       *"The zoom factor is set to 90 right now… I want that view at 100. In short I want
       to compact everything in such a way that it will show the same view at 100."*

       Between 90% and 100% zoom roughly 100px of content height is lost, and it is found
       back one step at a time: the shell's padding and the topbar token (16px + 24px),
       the header block on the project page, this grid's gap, and every card's padding
       and the KPI tiles below.

       ⚠️ Nothing was DELETED and no type went below `text-micro`. A page that fits by
       saying less has not been compacted — it has been cut, and the owner asked for the
       same view, not a smaller one. */
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
      {/* ══ KPI ROW ═════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:col-span-9 lg:grid-cols-5">
        <Kpi
          icon={Target}
          token="kpi-target"
          label="Monthly Target"
          value={target ?? '—'}
          hint={target === null ? 'nothing agreed' : 'assets this month'}
        />
        {/* ── ⚠️ TODAY, NOT "PUBLISHED" ────────────────────────────────────────
            Owner, 2026-08-20: *"whether daily publishing on each platform or not
            should be displayed over here… the daily target card should be for daily
            publishing. Remove one card and adjust that daily summary."*

            The Published card went, because its figure was the same
            month-to-date number the progress card next to it already leads with —
            two cards for one fact. This one answers a question nothing else on the
            page could: did today's post actually go out, and where.

            The platform ticks come from `task_placements`, not from tasks: one asset
            cross-posted to three platforms is one task and three placements, and
            "which platforms got something" is the placement question. */}
        <DailyKpi
          expected={expectedToday}
          platforms={project.platforms}
          publishedPlatformIds={publishedTodayPlatformIds}
          isOffDay={isOffDay}
        />
        <Kpi
          icon={Clock}
          token="kpi-review"
          label="In Review"
          value={counts.inReview}
          hint={pct(counts.inReview) === null ? 'awaiting approval' : `${pct(counts.inReview)}% of target`}
        />
        <Kpi
          icon={CalendarClock}
          token="kpi-scheduled"
          label="Scheduled"
          value={counts.scheduled}
          hint={pct(counts.scheduled) === null ? 'dated, not yet live' : `${pct(counts.scheduled)}% of target`}
        />
        <Kpi
          icon={FileText}
          token="kpi-remaining"
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
        <CardBody className="p-3.5">
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
                    {/* ── ⚠️ A DIFFERENT ICON PER ROW ────────────────────────
                        Owner, 2026-08-20: *"Attention: orange icon, Warning: red icon,
                        Schedule: blue icon."* Every row used the same amber triangle,
                        so three different problems looked like one repeated. The icon
                        and the colour both come from the item now — overdue is a red
                        alert, approval an orange clock, scheduling a blue calendar. */}
                    <span
                      aria-hidden="true"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--${item.token}) var(--tint-medium), var(--bg-surface))`,
                        color: `var(--${item.token})`,
                      }}
                    >
                      {item.key === 'overdue' ? (
                        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                      ) : item.key === 'approval' ? (
                        <Clock className="h-3.5 w-3.5" strokeWidth={2.5} />
                      ) : (
                        <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.5} />
                      )}
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
        <CardBody className="space-y-2.5 p-3.5">
          {/* ── ⚠️ THE MONTH SELECTOR ───────────────────────────────────────────
              Owner, 2026-08-20: *"in the image at the reference I gave you, you can see
              there is a month dropdown but the one you created is not showing any
              month."*

              It reads "August Content Progress" with a "This Month" control beside it,
              as the mockup does. The control is a real `<select>` and it navigates —
              `?month=` on this page — rather than being a decorative chip. Server-side
              so the figures come back computed for that month; filtering client-side
              would need every month's tasks in the browser. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body-sm font-semibold text-text-primary">
              {monthLabel.split(' ')[0]} Content Progress
            </p>
            <MonthSelect months={months} value={monthStart} projectId={project.id} />
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
            <p className="text-caption text-text-secondary">assets completed</p>
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

          {/* ── ⚠️ THE CONTROL THAT MAKES THE RHYTHM REAL ─────────────────────
              Owner, 2026-08-22: *"daily tasks should be automatically created."*

              Everything above this line is a PLAN — `monthPlan()` computing what
              the agreed rhythm implies. Until this button existed, none of it
              ever became a task, which is why a project on a 22-asset package
              opened onto `Today 0/3` and a week of dashes.

              It sits inside the progress card on purpose: the figures it moves
              are the ones directly above it. Hidden from a Member, who cannot
              create work for anybody else. */}
          {canGenerateSchedule && target !== null && (
            <GenerateSchedule projectId={project.id} monthStart={monthStart} />
          )}
        </CardBody>
      </Card>

      {/* ══ CONTENT PIPELINE ════════════════════════════════════════════════ */}
      <Card className="lg:col-span-6">
        <CardBody className="p-3.5">
          <p className="text-body-sm font-semibold text-text-primary">Content Pipeline</p>

          {/* ⚠️ NO SCROLLER. Owner, 2026-08-20: *"in the Content Pipeline you have
              added a scrollbar. You don't need to add a scrollbar. Please optimize all
              the content within it."* It was `overflow-x-auto` over a `min-w-[36rem]`
              grid, so five columns in a 6-of-12 card always overflowed. The columns now
              size to the card and the cards inside them are tighter — `min-w-0` on each
              column is what lets them actually shrink rather than being held open by
              their own text. */}
          <div className="mt-2.5">
            <div className="grid grid-cols-5 gap-1.5">
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
                        className="rounded-md border border-border-subtle bg-bg-surface px-1.5 py-1"
                        title={task.title}
                      >
                        <p className="truncate text-micro font-medium leading-tight text-text-primary">
                          {task.title}
                        </p>
                        <p className="truncate text-micro leading-tight text-text-tertiary">
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
        <CardBody className="p-3.5">
          <p className="text-body-sm font-semibold text-text-primary">Accountable / Team</p>

          <ul className="mt-2 space-y-2">
            {/* ⚠️ The owner FIRST, and labelled — owner, 2026-08-19: *"He is not the
                owner; he is assigned."* Accountability and assignment are different
                facts and this list keeps them apart. */}
            <li className="flex items-center gap-2.5">
              {/* ⚠️ `src` as well as `name`. Owner, 2026-08-20: *"maybe the image is
                  not present but once present it should show the image with it."*
                  `Avatar` already falls back to initials, so passing the URL costs
                  nothing and the moment somebody uploads a picture it appears. */}
              <Avatar name={project.ownerName ?? 'Unassigned'} src={ownerAvatarUrl} size="sm" />
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
                <Avatar name={member.fullName} src={member.avatarUrl} size="sm" />
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
      <Card className="flex flex-col lg:col-span-5">
        {/* ⚠️ `flex-1` + `flex-col` on the body, and `mt-auto` on the button below.
            Owner, 2026-08-20: *"the Add Content button should stick to the bottom of
            the height."* Without this the button hugs the day grid and floats in the
            middle of a card that is as tall as the Package Summary beside it. */}
        <CardBody className="flex flex-1 flex-col p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body-sm font-semibold text-text-primary">This Week</p>
            <Link
              href={`/calendar?project=${project.id}`}
              className="text-micro font-semibold text-text-brand hover:underline"
            >
              View calendar
            </Link>
          </div>

          {/* ⚠️ NO SCROLLER HERE EITHER. Owner, 2026-08-20: *"in this week or calendar
              card you have again added a scrollbar. I don't want that scrollbar."*

              I removed it from the pipeline and left the identical mistake here —
              `overflow-x-auto` over a `min-w-[38rem]` grid inside a 5-of-12 card, which
              always overflows. Six columns now size to the card; `min-w-0` on each is
              what lets them shrink rather than being propped open by their own chips,
              and the chips lost their padding to suit. */}
          <div className="mt-2.5 shrink-0">
            <div className="grid grid-cols-6 gap-1">
              {week.map((day) => {
                const isPostingDay = project.postingDays.includes(day.weekday);
                return (
                  <div key={day.date} className="min-w-0">
                    <div
                      className={cn(
                        'flex items-baseline justify-center gap-0.5 rounded-md py-1 text-micro font-semibold',
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
                          className="rounded-md px-1 py-1"
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
            className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-default py-2 text-micro font-semibold text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            Add content
          </button>
        </CardBody>
      </Card>

      {/* ══ PACKAGE SUMMARY ═════════════════════════════════════════════════ */}
      <Card className="lg:col-span-3">
        <CardBody className="p-3.5">
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

          {/* ⚠️ Owner, 2026-08-20: *"the View Contract button should, on click, pop up
              and display the package main summary… even that button is not showing."*
              It was in the mockup and I had left it out entirely. It opens the full
              listed-vs-agreed comparison — see contract-dialog.tsx for why both
              columns are shown rather than one. */}
          <button
            type="button"
            onClick={() => setContractOpen(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-default py-2 text-micro font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
            View contract
          </button>
        </CardBody>
      </Card>

      <ContractDialog
        open={contractOpen}
        onClose={() => setContractOpen(false)}
        projectName={project.name}
        detail={packageDetail}
        agreed={{
          monthlyFeePkr: project.monthlyFeePkr,
          assetsTargetMin: project.assetsTargetMin,
          assetsTargetMax: project.assetsTargetMax,
          reelsTargetMin: project.reelsTargetMin,
          staticPostsPerDay: project.staticPostsPerDay,
          reelsPerWeek: project.reelsPerWeek,
          postingDays: project.postingDays,
          startDate: project.startDate,
        }}
        platforms={project.platforms}
        canSeeFinance={canSeeFinance}
      />

      {/* ══ RECENT ACTIVITY ═════════════════════════════════════════════════
          ⚠️ 4 of 12, not 3. Owner, 2026-08-20: *"the Activity tab has more width. Right
          now you have created it very small. It's not looking good."* An activity line
          is a sentence with a name in it and needed the room; This Week gave up a
          column because its six day-cells tolerate being narrower than prose does. */}
      <Card className="lg:col-span-4">
        <CardBody className="p-3.5">
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
 * TODAY, PER PLATFORM
 * ----------------------------------------------------------------------------
 * ⚠️ An OFF day is its own state, not zero-of-zero. Owner's standing rule: a Sunday
 * with nothing on it must say it is off, or it looks like a Sunday somebody forgot.
 * A card reading "0 / 0" on a rest day would be the same failure in a smaller box.
 * ------------------------------------------------------------------------- */
function DailyKpi({
  expected,
  platforms,
  publishedPlatformIds,
  isOffDay,
}: {
  expected: number;
  platforms: readonly { id: string; name: string; slug: string }[];
  publishedPlatformIds: readonly string[];
  isOffDay: boolean;
}) {
  const done = platforms.filter((platform) => publishedPlatformIds.includes(platform.id)).length;
  const token = isOffDay
    ? 'text-tertiary'
    : platforms.length > 0 && done >= platforms.length
      ? 'kpi-published'
      : 'kpi-review';

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-3 shadow-sm">
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-medium), var(--bg-surface))`,
            color: `var(--${token})`,
          }}
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-micro font-semibold text-text-secondary">Today</span>
          <span className="block tabular-nums text-h2 font-semibold leading-tight text-text-primary">
            {isOffDay ? '—' : `${done}/${platforms.length || '—'}`}
          </span>
        </span>
      </div>

      {/* One icon per platform: lit where something went out today, dimmed where it
          has not. This is the "whether daily publishing on each platform or not". */}
      <div className="relative mt-1 flex flex-wrap items-center gap-1">
        {isOffDay ? (
          <span className="text-micro text-text-tertiary">off day — nothing scheduled</span>
        ) : platforms.length === 0 ? (
          <span className="text-micro text-text-tertiary">no platforms chosen</span>
        ) : (
          <>
            {platforms.map((platform) => {
              const live = publishedPlatformIds.includes(platform.id);
              return (
                <span
                  key={platform.id}
                  title={
                    live
                      ? `${platform.name} — published today`
                      : `${platform.name} — nothing today`
                  }
                  className={cn(
                    'transition-opacity duration-150',
                    live ? 'opacity-100' : 'opacity-30 grayscale',
                  )}
                >
                  <PlatformIcon slug={platform.slug} size={16} />
                </span>
              );
            })}
            <span className="ml-1 text-micro text-text-tertiary">
              {expected > 0 ? `${expected} due` : 'nothing due'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * THE MONTH SELECTOR
 * ----------------------------------------------------------------------------
 * ⚠️ Navigates rather than filtering in the browser. The figures for a month are
 * computed from that month's tasks server-side, so changing the month has to be a
 * request — filtering client-side would need every month's tasks in the payload, and
 * the counts would silently be "whatever happens to be loaded".
 *
 * A plain `<select>` with an onChange push: no dropdown to build, keyboard and mobile
 * behaviour come from the platform, and the current month is in the URL so the view is
 * linkable.
 * ------------------------------------------------------------------------- */
function MonthSelect({
  months,
  value,
  projectId,
}: {
  months: readonly string[];
  value: string;
  projectId: string;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      aria-label="Which month to show"
      onChange={(event) => router.push(`/projects/${projectId}?month=${event.target.value}`)}
      className="rounded-lg border border-border-default bg-bg-surface px-2 py-1 text-micro font-semibold text-text-secondary hover:bg-bg-hover"
    >
      {months.map((month) => (
        <option key={month} value={month}>
          {monthName(month)}
        </option>
      ))}
    </select>
  );
}

/* ----------------------------------------------------------------------------
 * GENERATE SCHEDULE
 * ----------------------------------------------------------------------------
 * Turns the agreed rhythm into actual tasks for the rest of the selected month.
 *
 * ── ⚠️ SAFE TO PRESS TWICE, AND THE LABEL SHOULD NOT SUGGEST OTHERWISE ───────
 * `lib/domain/schedule.ts` tops each day up to what the rhythm asks for rather
 * than inserting a fresh set, so a second press adds nothing. That is why this
 * is an ordinary button with no confirmation step — a dialog asking "are you
 * sure?" would imply a risk that does not exist, and people learn to click
 * through those anyway.
 *
 * `useTransition` rather than a loading flag of its own: the action calls
 * `revalidatePath`, and the transition stays pending until the new figures have
 * actually arrived. A manual boolean would clear the moment the promise
 * resolved, leaving the button idle beside numbers that had not updated yet.
 * ------------------------------------------------------------------------- */
function GenerateSchedule({ projectId, monthStart }: { projectId: string; monthStart: string }) {
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          start(async () => {
            const result = await generateScheduleAction(projectId, monthStart);
            setMessage({
              ok: result.ok,
              /* `warning` carries the summary on success — the shared ActionResult
                 has no `message` field and inventing one would touch every action. */
              text: result.ok
                ? (result.warning ?? 'Schedule generated.')
                : (result.error ?? 'That did not work.'),
            });
          });
        }}
      >
        <CalendarClock className="size-4" aria-hidden="true" />
        {pending ? 'Generating…' : 'Generate schedule'}
      </Button>

      {message && (
        <span
          role="status"
          className={cn(
            'text-micro',
            message.ok ? 'text-text-secondary' : 'text-feedback-error',
          )}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** 'YYYY-MM-01' → 'August 2026'. Parsed by hand: `new Date('2026-08-01')` is UTC
 *  midnight, so local `getMonth()` returns July anywhere behind UTC. */
function monthName(monthStart: string): string {
  const index = Number(monthStart.slice(5, 7)) - 1;
  return index >= 0 && index < 12
    ? `${MONTH_NAMES[index]} ${monthStart.slice(0, 4)}`
    : monthStart;
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
    <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-3 shadow-sm">
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
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
      <p className="relative mt-1 truncate text-micro text-text-tertiary">{hint}</p>
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
