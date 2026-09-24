import type { Metadata } from 'next';

import { PerformanceBoard } from '@/components/performance/performance-board';
import { requireUser } from '@/lib/auth/current-user';
import {
  assignmentSources,
  bucketTrend,
  performanceBoard,
  performanceFilterOptions,
  assessmentsFor,
  periodHistory,
  personDetail,
  taskLedger,
  taskLedgerDetail,
  projectContribution,
  qualitySummary,
  teamContribution,
  workInScope,
  workNeedingAttention,
  workloadRows,
} from '@/lib/db/queries/performance';
import { isoDateIn, nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Performance overview' };

/* ============================================================================
 * TEAM PERFORMANCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"I want to create a team performance page where I can see
 * … a single person's performance: his whole history, what he has done today
 * and yesterday, how his performance is going … every chitta-batta."* And, of
 * the reference image: *"I want this performance page UI to be exactly the same
 * as you see in the screenshot."*
 *
 * ── ⚠️ THE EXISTING REPORTS PAGE IS UNTOUCHED ────────────────────────────
 * *"For right now I don't want to change the export of the report page."* So
 * `/reports` and its CSV / Excel / PDF exports are exactly as they were; this is
 * a new screen beside it, and the header's "Export report" button links to it
 * rather than growing a second exporter to keep in step with the first.
 *
 * ── ⚠️ NO INVENTED FIGURES, AND THAT IS NOT A STYLE CHOICE HERE ──────────
 * The reference carries a "Sample data" badge. This page keeps the badge and
 * changes the word: every figure is read from `tasks`, `activity_log`,
 * `attendance_days` and `attachments`, and where nothing is recorded the screen
 * says so instead of drawing a zero. A number nobody can trace, on a page read
 * as a judgement about a named person, is the worst bug this screen could ship.
 *
 * ── WHO SEES WHAT — owner, 2026-09-23 ───────────────────────────────────
 * *"I want the admin to be able to view this page or view this performance, and
 * all the other team members can view their own performance only."*
 *
 * So rank no longer decides whether the page OPENS, only how wide it is:
 *
 *   super_admin / admin / team_coordinator → the whole team, filterable
 *   member                                 → locked to themselves
 *
 * ⚠️ THE LOCK IS APPLIED ON THE SERVER, NOT BY HIDING A DROPDOWN. `personId`
 * is overwritten with the caller's own id for a Member before any read runs, so
 * a hand-typed `?person=<somebody-else>` is ignored rather than obeyed. The UI
 * also hides the team and person pills, but that is a courtesy, not the rule.
 *
 * ⚠️ AND RLS IS STILL THE FLOOR UNDER THAT. `users_select` shows a Member one
 * row — their own — and `tasks_select` narrows the rest (ADR-003), so even if
 * this file forgot the override they would not read another person's figures.
 * Two independent answers to the same question, which is the pattern migrations
 * 117 and 252 already use.
 * ========================================================================= */

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_30', label: 'Last 30 days' },
] as const;

type Preset = (typeof PRESETS)[number]['value'];

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    team?: string;
    project?: string;
    person?: string;
  }>;
}) {
  /* ⚠️ ONE WAVE — Rule Zero, law 4. */
  const [user, params] = await Promise.all([requireUser(), searchParams]);

  /* A Member reads this page about themselves and nobody else. */
  const ownOnly = user.role === 'member';

  const today = isoDateIn();
  const preset: Preset = (PRESETS.find((p) => p.value === params.period)?.value ??
    'this_week') as Preset;
  const period = resolvePeriod(preset, today);

  /* ⚠️ THE FILTERS ARE VALIDATED AS UUIDs BEFORE THEY REACH A QUERY. A junk
     `?team=` would otherwise reach Postgres as a cast and fail the whole page
     with 22P02 — the filter belongs to the URL, so anybody can type into it. */
  const team = uuidOr(params.team);
  const project = uuidOr(params.project);
  /* ⚠️ THE PERSON IS PART OF THE SCOPE, NOT A CLIENT-SIDE ROW FILTER.
     Owner: *"If someone is clicked specifically then his whole history, his
     whole performance, his whole contribution in each project ... will be
     displayed."* Tabs that need per-person rows cannot be answered from what is
     already drawn, so it travels in the URL with the other two. The table still
     narrows in its own frame — the board applies the choice optimistically
     while this read catches up (Rule Zero, law 2). */
  /* ⚠️ THE OVERRIDE, AND IT IGNORES THE URL RATHER THAN TRUSTING IT. */
  const person = ownOnly ? user.id : uuidOr(params.person);
  const filters = {
    departmentId: ownOnly ? null : team,
    projectId: project,
    personId: person,
  };
  const scoped = { ...period, today };

  /* ⚠️ ONE WAVE, AND EVERY TAB'S DATA IN IT — Rule Zero laws 1 and 4. The
     tabs are client state, so switching one must not touch the network; that is
     only true if what they need is already here. Each read is bounded by the
     period and the scope, so this is seven small statements, not seven scans. */
  const [
    board,
    attention,
    options,
    projects,
    teams,
    workload,
    quality,
    weekly,
    monthly,
    work,
    sources,
    detail,
    ledger,
    periods,
    assessments,
  ] = await Promise.all([
      performanceBoard(user.id, scoped, filters),
      workNeedingAttention(user.id, today, filters),
      performanceFilterOptions(user.id),
      projectContribution(user.id, scoped, filters),
      teamContribution(user.id, scoped, filters),
      workloadRows(user.id, scoped, filters),
      qualitySummary(user.id, scoped, filters),
      bucketTrend(user.id, 'week', filters),
      bucketTrend(user.id, 'month', filters),
      /* ⚠️ THE ACTUAL TASKS. Everything above this line is a count; this is
         the work. Owner, 2026-09-24: *"The task exactly what he is doing is not
         showing."* */
      workInScope(user.id, scoped, filters),
      /* ⚠️ THE INDIVIDUAL RECORD'S OWN TWO READS, AND ONLY WHEN ONE IS OPEN.
         Owner, 2026-09-24: the admin-side person view. `personDetail` is the
         whole activity log for them and `assignmentSources` is who put the work
         on them; neither means anything for the team view, so neither is paid
         for there. */
      person ? assignmentSources(user.id, scoped, filters) : Promise.resolve(null),
      person ? personDetail(user.id, person, period) : Promise.resolve(null),
      /* The ledger is the person record's Tasks tab; the team view never draws
         it, so it is not paid for there. */
      person ? taskLedger(user.id, scoped, filters) : Promise.resolve(null),
      /* ⚠️ THE PERFORMANCE HISTORY TAB'S TWO READS. `periodHistory` generates
         its own periods rather than reading the page's, because the tab is a
         HISTORY — it shows the last six weeks whatever window the filter is
         set to. */
      person ? periodHistory(user.id, person, 'week', today) : Promise.resolve(null),
      person ? assessmentsFor(user.id, person) : Promise.resolve(null),
    ]);

  /* ⚠️ THE ROW THAT OPENS BY DEFAULT COSTS NO ROUND TRIP. The ledger opens on
     its first row, and fetching that row's timeline from the browser made the
     owner wait ~2s on every page load for something the server could have put
     in the same wave. A second wave, but a cheap one: it needs the ledger's
     answer to know which row is first. */
  const firstLedgerRow = ledger?.rows[0] ?? null;
  const firstDetail = firstLedgerRow
    ? await taskLedgerDetail(user.id, firstLedgerRow.taskId).catch(() => null)
    : null;

  return (
    <PerformanceBoard
      board={board}
      attention={attention}
      period={{
        ...period,
        preset,
        label: labelFor(period),
        team: ownOnly ? 'all' : (team ?? 'all'),
        project: project ?? 'all',
        person: person ?? 'all',
      }}
      ownOnly={ownOnly}
      /* ⚠️ WHO IS ASKING, not just what they may see. The Performance history
         tab refuses to let somebody write an assessment about themselves, and
         it can only refuse if it knows who they are. */
      viewer={{ id: user.id, name: user.fullName }}
      periods={periods ?? []}
      assessments={assessments ?? []}
      today={today}
      asOf={dayLabel(today)}
      /* The server's clock, so "waiting 52 hours" is not computed against a
         browser that may be on another day. */
      nowMs={nowMs()}
      presets={[...PRESETS]}
      options={options}
      projects={projects}
      teams={teams}
      workload={workload}
      quality={quality}
      weekly={weekly}
      monthly={monthly}
      work={work.rows}
      workTotal={work.total}
      sources={sources}
      history={detail?.history ?? []}
      ledger={ledger?.rows ?? []}
      ledgerTotal={ledger?.total ?? 0}
      ledgerSeed={
        firstLedgerRow && firstDetail ? { id: firstLedgerRow.taskId, detail: firstDetail } : null
      }
      updatedAt={new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(nowMs()))}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOr(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/**
 * The period, in the division's own days.
 *
 * ⚠️ KARACHI, NOT UTC. `today` arrives from `isoDateIn()`, which is the
 * division's date — for five hours every evening the server's date is already
 * tomorrow, and a week computed from that would report Monday's work as
 * Tuesday's.
 */
function resolvePeriod(preset: Preset, today: string): { from: string; to: string } {
  const day = (iso: string, delta: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

  if (preset === 'today') return { from: today, to: today };
  if (preset === 'last_30') return { from: day(today, -29), to: today };

  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  /* Monday-first: the division's week, and the one the reports already use. */
  const mondayOffset = dow === 0 ? -6 : 1 - dow;

  if (preset === 'this_week') return { from: day(today, mondayOffset), to: today };
  if (preset === 'last_week') {
    const lastMonday = day(today, mondayOffset - 7);
    return { from: lastMonday, to: day(lastMonday, 6) };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** "23 Sep" — the right-hand half of the reference's date line. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "21 – 23 Sep 2026", the way the reference writes it.
 *
 * ⚠️ SPELLED OUT RATHER THAN LEFT TO `toLocaleDateString`. en-GB gives
 * "Sept" for this one month, which is four characters where every other month
 * is three; en-US fixes the abbreviation and puts the month first. Neither is
 * the format on the design, so the three parts are assembled here.
 */
function labelFor(period: { from: string; to: string }): string {
  const parts = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
  };
  const a = parts(period.from);
  const b = parts(period.to);
  if (period.from === period.to) return `${b.day} ${b.month} ${b.year}`;
  const left = a.month === b.month && a.year === b.year ? `${a.day}` : `${a.day} ${a.month}`;
  return `${left} – ${b.day} ${b.month} ${b.year}`;
}
