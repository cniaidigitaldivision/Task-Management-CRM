import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlarmClock,
  CalendarDays,
  ClipboardList,
  HardDrive,
  ShieldCheck,
  Sparkles,
  Wallet,
  Workflow,
} from 'lucide-react';

import { BentoGrid, MetricTile, Tile } from '@/components/dashboard/bento';
import {
  ActivityFeed,
  AiInsights,
  AlertList,
  ProjectProgress,
  RoomBars,
  RoomRing,
  StatusBoard,
  type RoomAlert,
  type RoomSignal,
} from '@/components/dashboard/control-room';
import { LiveBadge } from '@/components/dashboard/live-badge';
import { ParticleField } from '@/components/dashboard/particle-field';
import { PulseWave } from '@/components/dashboard/pulse-wave';
import { RoomVideo } from '@/components/dashboard/room-video';
import { StageDirector } from '@/components/dashboard/stage-director';
import { TeamOrbit, type OrbitPerson } from '@/components/dashboard/team-orbit';
import { CountUp } from '@/components/ui/count-up';
import { requireUser } from '@/lib/auth/current-user';
import { listAttendance } from '@/lib/db/queries/attendance';
import {
  documentTally,
  documentsByDay,
  systemSignals,
  weeklyTaskShape,
} from '@/lib/db/queries/control-room';
import { connectionStatus } from '@/lib/db/queries/drive';
import { listActivity, listNotifications } from '@/lib/db/queries/feed';
import { platformSlugsByTask } from '@/lib/db/queries/placements';
import { listPeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { listPendingExtensions } from '@/lib/db/queries/task-relations';
import { weeklyTrend } from '@/lib/db/queries/trend';
import { teamUtilisation, teamWorkload } from '@/lib/db/queries/workload';
import { localDate, minutesLate } from '@/lib/domain/attendance';
import { PROJECT_TYPE_META, WORKLOAD_BAND_META } from '@/lib/domain/constants';
import { operationsAdvice, operationsScore } from '@/lib/domain/ops-score';
import { nowMs } from '@/lib/now';
import { getSettings } from '@/lib/settings/current';
import { delta, periodTotals } from '@/lib/view/dashboard-model';
import { toTaskView } from '@/lib/view/task-view';

export const metadata: Metadata = { title: 'Dashboard' };

/* ============================================================================
 * PULSE — the division's operating surface
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, after several passes against a supplied mockup: *"I don't
 * like dashboard designs at all… redesign this whole again with some new design
 * and animations and 3d views and moving particles and moving and live things…
 * come with total new and advanced designs."*
 *
 * So this is not the mockup, and not the control room that preceded it. The
 * design decisions, and what each is FOR:
 *
 *   · A BENTO GRID rather than three equal columns. Tiles are sized by how much
 *     a figure is worth looking at, so the page has a focal point instead of an
 *     even wall — and an asymmetric grid has no "short column" to leave empty,
 *     which is what produced the white space the owner objected to before.
 *
 *   · A LIVING BACKDROP. A constellation of drifting points that links up as
 *     they pass and reaches towards the cursor. It is the "moving particles"
 *     asked for, and it moves because it is simulated rather than looped.
 *
 *   · THE PULSE. The hero tile is the division's real weekly output drawn as a
 *     continuous trace with a bright dash running along it. Every vertex is a
 *     week that happened.
 *
 *   · THE CONSTELLATION. The team arranged around a core, each person's
 *     DISTANCE FROM THE CENTRE set by their own utilisation. A tight cluster
 *     means the team is at its limit; that is readable at a glance in a way a
 *     column of bars is not.
 *
 *   · DEPTH. Every tile leans towards the pointer and lights where it is. One
 *     listener for the whole grid — see components/dashboard/bento.tsx.
 *
 * ── ⚠️ WHAT DID NOT CHANGE, AND MUST NOT ────────────────────────────────────
 * Every figure is still read through `withUser`, so RLS decides what a reader
 * sees. Every colour is still a token, so the light/dark toggle governs the page
 * — the owner corrected an earlier build that forced its own palette and that
 * correction stands. And no panel here reports a number this product cannot
 * measure: where the mockup had revenue and uptime, this has delivery and
 * observable signals.
 * ========================================================================= */

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A week's Monday as a short label — `4 Aug`.
 *
 * ⚠️ Sliced from the ISO string, never parsed into a `Date`. The value arrives
 * as `YYYY-MM-DD` from a Postgres `date`, and reading it as a Date in a
 * timezone west of Greenwich labels the week a day before the Monday it starts
 * on — the same class of fault as the note atop lib/db/row-values.ts.
 */
function shortWeek(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '';
  return `${Number(isoDate.slice(8, 10))} ${MONTHS[Number(isoDate.slice(5, 7))] ?? ''}`.trim();
}

function clock(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = nowMs();
  /* The Karachi calendar date, from the timestamp this render already took —
     never a second clock read, so every panel agrees which day it is. */
  const today = localDate(now);

  /* ── ONE WAVE ──────────────────────────────────────────────────────────────
     Every one of these opens its own transaction against a database in another
     region, so what matters is not how many queries there are but how many
     times the page STOPS AND WAITS. Nothing here depends on anything else. */
  const [
    rows,
    workload,
    projects,
    activity,
    notifications,
    settings,
    extensions,
    trend,
    platformPairs,
    todayAttendance,
    docDays,
    shape,
    signals,
    drive,
    docs,
    people,
  ] = await Promise.all([
    listTasks(user.id, { includeClosed: true }),
    teamWorkload(user.id, now),
    listProjects(user.id),
    listActivity(user.id, 7),
    listNotifications(user.id, 5),
    getSettings(),
    listPendingExtensions(user.id),
    weeklyTrend(user.id, 8, now),
    platformSlugsByTask(user.id),
    listAttendance(user.id, { from: today, to: today }),
    documentsByDay(user.id),
    weeklyTaskShape(user.id, 8),
    systemSignals(user.id),
    connectionStatus(),
    documentTally(user.id),
    /* Only for the constellation's photos — see the note at `orbit`. */
    listPeople(user.id),
  ]);

  const tasks = rows.map((row) => toTaskView(row, now));
  const team = teamUtilisation(workload.people);

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const overdue = open.filter((t) => t.overdue);
  const blocked = open.filter((t) => t.status === 'blocked');
  const inProgress = open.filter((t) => t.status === 'in_progress');

  const softPct = Number(settings.softThresholdPct);
  const atRisk = workload.people.filter((p) => p.workload.utilisationPct >= softPct);
  const mine = workload.people.find((p) => p.userId === user.id) ?? null;
  const scope =
    user.role === 'super_admin' || user.role === 'admin' || user.role === 'team_coordinator';

  /* Equal-length halves, so the comparison cannot drift as history accumulates. */
  const completedPeriod = periodTotals(trend, 4, (w) => w.completed);
  const createdPeriod = periodTotals(trend, 4, (w) => w.created);
  const completedDelta = delta(completedPeriod.current, completedPeriod.previous, true);
  const createdDelta = delta(createdPeriod.current, createdPeriod.previous, false);

  /* ── Attendance ───────────────────────────────────────────────────────────
     ⚠️ The roster is the UNION of the workload list and today's attendance
     rows. They are different sets — somebody with no open work still checks in —
     and dividing one by the other once produced 120% with "not in yet: 0"
     beside it. */
  const checkedIn = new Set(
    todayAttendance.filter((r) => r.checkedInAt !== null).map((r) => r.userId),
  );
  const lateToday = new Set(
    todayAttendance.filter((r) => minutesLate(r.checkedInAt) !== null).map((r) => r.userId),
  );
  const roster = new Set<string>([
    ...workload.people.map((p) => p.userId),
    ...todayAttendance.map((r) => r.userId),
  ]);
  const headcount = scope ? roster.size : 1;
  const present = scope ? checkedIn.size : Math.min(1, checkedIn.size);
  const onTime = Math.max(0, present - lateToday.size);
  const notInYet = Math.max(0, headcount - present);
  const attendancePct = headcount > 0 ? Math.round((present / headcount) * 100) : 0;

  const publishedTotal = [...platformPairs.values()].reduce((sum, slugs) => sum + slugs.length, 0);
  const utilisation = scope ? team.utilisationPct : (mine?.workload.utilisationPct ?? 0);

  const ops = operationsScore({
    completed: completedPeriod.current,
    overdue: overdue.length,
    open: open.length,
    utilisationPct: utilisation,
    softThresholdPct: softPct,
    expectedToday: headcount,
    onTimeToday: onTime,
  });
  const advice = operationsAdvice({
    completed: completedPeriod.current,
    overdue: overdue.length,
    open: open.length,
    utilisationPct: utilisation,
    softThresholdPct: softPct,
    expectedToday: headcount,
    onTimeToday: onTime,
    atRisk: atRisk.length,
    blocked: blocked.length,
    pendingExtensions: extensions.length,
  });

  /* ⚠️ The photo comes from `people`, not from `workload`. `PersonWorkload`
     carries no `avatarUrl` — the workload query selects only what the load
     arithmetic needs — so the constellation would have drawn initials for
     everybody, which is the same bug the activity feed had. Joined here rather
     than by widening a query three other screens depend on. */
  const photos = new Map(people.map((p) => [p.id, p.avatarUrl]));
  const orbit: OrbitPerson[] = workload.people.slice(0, 7).map((person) => ({
    id: person.userId,
    name: person.name,
    avatarUrl: photos.get(person.userId) ?? null,
    utilisationPct: person.workload.utilisationPct,
    openTasks: person.workload.openTaskCount,
    token: WORKLOAD_BAND_META[person.workload.band].token,
  }));

  /* ── The status board — only what can be observed ─────────────────────────
     ⚠️ Finance reports "no ledger" rather than a green tick. A status light is
     read as a measurement, and this product has no finance tables at all — a
     green light wired to nothing is the most dangerous thing a board like this
     can contain. */
  const roomSignals: RoomSignal[] = [
    {
      label: 'Google Drive',
      state: drive.connected ? 'Connected' : drive.lastError ? 'Error' : 'Not connected',
      ok: drive.connected,
      icon: HardDrive,
    },
    { label: 'AI assistance', state: signals.activeChains > 0 ? 'Operational' : 'Idle', ok: true, icon: Sparkles },
    { label: 'Finance', state: 'No ledger', ok: false, icon: Wallet },
    { label: 'Task management', state: 'Operational', ok: true, icon: ClipboardList },
    { label: 'Calendar', state: open.length > 0 ? 'Operational' : 'Quiet', ok: true, icon: CalendarDays },
    {
      label: 'Security',
      state: signals.criticalEvents > 0 ? `${signals.criticalEvents} critical` : 'Clear · 24h',
      ok: signals.criticalEvents === 0,
      icon: ShieldCheck,
    },
  ];

  const alerts: RoomAlert[] = [
    ...(overdue.length > 0
      ? [
          {
            id: 'overdue',
            title: `${overdue.length} ${overdue.length === 1 ? 'task is' : 'tasks are'} overdue`,
            body: overdue[0].title,
            tone: 'bad' as const,
            href: '/tasks',
            icon: AlarmClock,
          },
        ]
      : []),
    ...(extensions.length > 0
      ? [
          {
            id: 'extensions',
            title: `${extensions.length} extension ${extensions.length === 1 ? 'request' : 'requests'} waiting`,
            body: 'Nothing is locked while a request waits.',
            tone: 'warn' as const,
            href: '/tasks',
            icon: Workflow,
          },
        ]
      : []),
    ...notifications.slice(0, 4).map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      tone: (note.isRead ? 'blue' : 'warn') as string,
      href: note.linkTo,
    })),
  ].slice(0, 5);

  const first = user.fullName.split(' ')[0];

  return (
    <div className="relative mx-auto max-w-[var(--content-max)] space-y-3" data-stage="waiting">
      {/* ── The room ──────────────────────────────────────────────────────────
          The owner's clip, behind the whole dashboard, LIGHT THEME ONLY. It sits
          a layer below the constellation so the particles read against it rather
          than competing with it. */}
      <RoomVideo />
      <StageDirector />

      {/* ── The living backdrop ───────────────────────────────────────────────
          Behind everything, inert to the pointer, and the only element on the
          page that is simulated rather than laid out. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-8 -top-8 -z-10 h-[46rem] overflow-hidden"
      >
        <span
          className="aurora"
          style={{
            top: '-4rem', left: '-6rem', width: '38rem', height: '26rem',
            background: 'color-mix(in oklab, var(--accent-primary) 20%, transparent)',
            '--ax': '58px', '--ay': '34px', '--at': '27s',
          } as React.CSSProperties}
        />
        <span
          className="aurora"
          style={{
            top: '8rem', right: '-8rem', width: '32rem', height: '24rem',
            background: 'color-mix(in oklab, var(--accent-gold) 15%, transparent)',
            '--ax': '-50px', '--ay': '-28px', '--at': '34s',
          } as React.CSSProperties}
        />
        <ParticleField />
      </div>

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
        <div className="min-w-0">
          <p className="text-micro font-semibold tracking-[0.14em] text-text-brand uppercase">
            AI &amp; Digital Division
          </p>
          <h2 className="mt-1 text-h1 tracking-tight text-text-primary">
            Good to see you, {first}
          </h2>
          <p className="mt-1.5 max-w-2xl text-body-sm text-text-secondary">
            <span className="tabular font-semibold text-text-primary">{open.length}</span> open
            {open.length === 1 ? ' task' : ' tasks'} across {projects.length}{' '}
            {projects.length === 1 ? 'project' : 'projects'}
            {overdue.length > 0 && (
              <>
                {', '}
                <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                  {overdue.length} already late
                </span>
              </>
            )}
            {atRisk.length > 0 && (
              <>
                {' — '}
                <span className="font-semibold" style={{ color: 'var(--load-warning)' }}>
                  {atRisk.length} {atRisk.length === 1 ? 'person is' : 'people are'} near their limit
                </span>
              </>
            )}
            .
          </p>
        </div>
        <LiveBadge />
      </header>

      {/* ══ THE BENTO ═══════════════════════════════════════════════════════
          Twelve columns; each tile states its own span. The entrance runs in
          source order via `index`, so the eye is led from the hero outwards. */}
      {/* ══ THE STAGE ═══════════════════════════════════════════════════════
          ── ⚠️ THE MIDDLE FOUR COLUMNS ARE DELIBERATELY EMPTY ────────────────
          Owner, 2026-08-26: *"there is a brain in the middle of the video. I
          want to move the cards left and right so that, in the center, that
          brain would be visible."*

          So this row is a corridor: tiles occupy columns 1–4 and 9–12, and
          nothing is placed in 5–8. The backdrop shows through the gap, and the
          video is sized so its brain lands exactly there — see the note on
          natural aspect in components/dashboard/room-video.tsx.

          ⚠️ The gap is made by explicit column PLACEMENT, not by an empty
          spacer tile. A spacer would be a real grid item: it would take the
          row's height, it would be announced to a screen reader as an empty
          region, and it would pick up the tile entrance animation. Placement
          leaves genuinely nothing there.

          Below `lg` the two stacks fall into normal flow one after the other —
          there is no room for a corridor on a narrow screen, and the video is
          simply a backdrop there. */}
      <BentoGrid className="lg:grid-cols-12">
        {/* ── Left of the brain ─────────────────────────────────────────── */}
        <div className="stage-left grid gap-3 sm:grid-cols-2 lg:col-span-4">
          <MetricTile
            index={0}
            label="Open tasks"
            value={<CountUp value={open.length} />}
            icon="tasks"
            tone="status-progress"
            series={shape.map((w) => w.open)}
            foot={
              <span className="text-micro text-text-tertiary">
                {open.reduce((s, t) => s + t.effortPoints, 0)} pts
              </span>
            }
          />
          <MetricTile
            index={1}
            label="In progress"
            value={<CountUp value={inProgress.length} />}
            icon="progress"
            tone="status-todo"
            foot={
              <span className="text-micro text-text-tertiary">
                {tasks.length > 0 ? Math.round((inProgress.length / tasks.length) * 100) : 0}% of all
              </span>
            }
          />
          <MetricTile
            index={2}
            label="Completed · 4w"
            value={<CountUp value={completedPeriod.current} />}
            icon="done"
            tone="status-done"
            series={trend.map((w) => w.completed)}
            delta={
              completedDelta.pct === 0
                ? undefined
                : { text: completedDelta.label, good: completedDelta.good }
            }
          />
          <MetricTile
            index={3}
            label="Overdue"
            value={<CountUp value={overdue.length} />}
            icon="overdue"
            tone={overdue.length > 0 ? 'feedback-error' : 'feedback-success'}
            series={shape.map((w) => w.overdue)}
            foot={
              <span className="text-micro text-text-tertiary">
                {overdue.length > 0 ? 'needs re-planning' : 'all on time'}
              </span>
            }
          />

          <Tile
            index={4}
            glow="accent-primary"
            eyebrow={scope ? `${workload.people.length} people` : 'Your week'}
            title="Team capacity"
            action={{ href: '/workload', label: 'Workload' }}
            className="sm:col-span-2"
            bodyClassName="flex flex-col justify-center"
          >
            <TeamOrbit people={orbit} corePct={utilisation} coreLabel="avg utilisation" />
            <p className="mt-1 text-center text-micro text-text-tertiary">
              Each arc is that person’s share of the work being carried.
            </p>
          </Tile>
        </div>

        {/* ── Right of the brain ────────────────────────────────────────────
            `lg:col-start-9` is what opens the corridor: without it this stack
            would sit straight after the left one, in columns 5–8. */}
        <div className="stage-right grid gap-3 lg:col-span-4 lg:col-start-9">
          <Tile
            index={5}
            glow="accent-gold"
            eyebrow="AI assistance"
            title="Operations score"
          >
            <AiInsights score={ops.score} headline={ops.headline} recommendations={advice} />
          </Tile>

          <Tile
            index={6}
            glow="feedback-success"
            eyebrow="Today"
            title="Attendance"
            action={{ href: '/attendance', label: 'Open' }}
            bodyClassName="flex flex-col justify-center"
          >
            <RoomRing
              slices={[
                { label: 'On time', value: onTime, tone: 'good' },
                { label: 'Late', value: lateToday.size, tone: 'warn' },
                { label: 'Not in yet', value: notInYet, tone: 'muted' },
              ]}
              centreValue={`${attendancePct}%`}
              centreLabel="in"
              size={104}
            />
          </Tile>
        </div>
      </BentoGrid>

      {/* ══ BELOW THE STAGE ═════════════════════════════════════════════════
          Full width again — the corridor exists only where the brain is. */}
      <BentoGrid className="lg:grid-cols-12">
        {/* ── The pulse ──────────────────────────────────────────────────── */}
        <Tile
          index={7}
          glow="accent-primary"
          eyebrow="Division pulse"
          title={`${completedPeriod.current} delivered in four weeks`}
          action={{ href: '/reports', label: 'Reports' }}
          className="lg:col-span-8"
        >
          <PulseWave
            points={trend.map((w) => w.completed)}
            labels={[
              shortWeek(trend[0]?.weekStart ?? ''),
              shortWeek(trend[trend.length - 1]?.weekStart ?? ''),
            ]}
            height={104}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-subtle pt-3">
            <Legend tone="accent-primary" label="Completed" value={completedPeriod.current} delta={completedDelta.label} good={completedDelta.good} />
            <Legend tone="accent-gold" label="Created" value={createdPeriod.current} delta={createdDelta.label} good={createdDelta.good} />
            <Legend tone="status-done" label="Published" value={publishedTotal} />
          </div>
        </Tile>

        {/* ── Reports ────────────────────────────────────────────────────── */}
        <Tile
          index={8}
          glow="status-review"
          eyebrow="Last 7 days"
          title="Reports &amp; documents"
          className="lg:col-span-4"
          bodyClassName="flex flex-col justify-center"
        >
          <RoomBars
            /* ⚠️ Stacked by STATE, so all three colours appear as soon as the
               register holds all three. See `documentsByDay`. */
            bars={docDays.map((d) => ({
              label: d.label,
              segments: [
                { tone: 'good', value: d.approved },
                { tone: 'warn', value: d.pending },
                { tone: 'bad', value: d.rejected },
              ],
            }))}
            height={84}
            legend={[
              { label: 'Approved', value: docs.approved, tone: 'good' },
              { label: 'Pending', value: docs.pending, tone: 'warn' },
              { label: 'Returned', value: docs.rejected, tone: 'bad' },
            ]}
            action={
              <Link
                href="/documents"
                className="flex h-8 items-center justify-center rounded-lg border border-border-default text-micro font-semibold text-text-brand transition-colors hover:bg-bg-hover"
              >
                Open the register
              </Link>
            }
          />
        </Tile>

        {/* ── Live feed ──────────────────────────────────────────────────── */}
        <Tile
          index={9}
          glow="status-todo"
          eyebrow="Live"
          title="Activity"
          action={{ href: '/tasks', label: 'All tasks' }}
          className="lg:col-span-3"
        >
          <ActivityFeed
            items={activity.map((entry) => ({
              id: entry.id,
              actorName: entry.actorName ?? 'System',
              avatarUrl: entry.actorAvatarUrl,
              summary: entry.summary ?? entry.action,
              at: clock(entry.createdAt, now),
            }))}
          />
        </Tile>

        {/* ── Projects ───────────────────────────────────────────────────── */}
        <Tile
          index={10}
          glow="status-progress"
          eyebrow="Progress"
          title="Projects"
          action={{ href: '/projects', label: 'All' }}
          className="lg:col-span-3"
        >
          <ProjectProgress
            projects={projects.slice(0, 5).map((project) => ({
              id: project.id,
              name: project.name,
              kind: PROJECT_TYPE_META[project.type].label,
              donePct:
                project.taskCount > 0
                  ? Math.round((project.doneTaskCount / project.taskCount) * 100)
                  : 0,
              open: project.openTaskCount,
            }))}
          />
        </Tile>

        {/* ── Systems and alerts ─────────────────────────────────────────── */}
        <Tile
          index={11}
          glow="feedback-success"
          eyebrow={signals.warningEvents > 0 ? `${signals.warningEvents} warnings` : 'All clear'}
          title="Systems"
          className="lg:col-span-3"
        >
          <StatusBoard signals={roomSignals} />
        </Tile>

        <Tile
          index={12}
          glow="feedback-warning"
          eyebrow="Needs you"
          title="Alerts"
          action={{ href: '/tasks', label: 'View' }}
          className="lg:col-span-3"
        >
          <AlertList alerts={alerts} />
        </Tile>
      </BentoGrid>

      {/* A quiet note, at the foot where a caveat belongs — not a headline. */}
      <p className="px-1 text-micro leading-relaxed text-text-tertiary">
        Figures cover the week of {workload.window.start} to {workload.window.end}, computed live
        from {open.length} open tasks. Capacity is {Number(settings.defaultWeeklyCapacity)} points a
        week per person by default — 75% of the 48 nominal hours, because attendance hours are not
        productive hours (ADR-004).{' '}
        <Link href="/reports" className="font-semibold text-text-brand hover:underline">
          Full reports
        </Link>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------- */

function Legend({
  tone,
  label,
  value,
  delta,
  good,
}: {
  tone: string;
  label: string;
  value: number;
  delta?: string;
  good?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 self-center rounded-full"
        style={{ backgroundColor: `var(--${tone})` }}
      />
      <span className="text-micro text-text-tertiary">{label}</span>
      <span className="tabular text-caption font-semibold text-text-primary">{value}</span>
      {delta && (
        <span
          className="text-micro font-semibold"
          style={{ color: `var(--${good ? 'feedback-success' : 'feedback-error'})` }}
        >
          {delta}
        </span>
      )}
    </span>
  );
}
