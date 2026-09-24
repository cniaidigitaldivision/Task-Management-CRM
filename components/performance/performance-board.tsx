'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Clock3,
  Download,
  FileText,
  Folder,
  Info,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  Trophy,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react';

import { exportTaskFormsAction, performanceInsightAction } from '@/app/actions/performance';
import { PersonDrawer } from '@/components/performance/person-drawer';
import {
  CompareTab,
  ProjectsTab,
  QualityTab,
  ReportsTab,
  WorkloadTab,
} from '@/components/performance/performance-tabs';
import { FilterPill, Nothing, Panel, StatCard } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import type {
  AttentionRow,
  BucketRow,
  FilterOptions,
  PersonStat,
  ProjectRow,
  QualitySummary,
  TeamRow,
  WorkloadRow,
} from '@/lib/db/queries/performance';
import type { Narrative } from '@/lib/ai/narrative';
import { attentionFor, rate } from '@/lib/domain/performance';

/* ============================================================================
 * TEAM PERFORMANCE — built to the owner's reference, 2026-09-23
 * ----------------------------------------------------------------------------
 * *"Hey first of all I want this performance page UI to be exactly the same as
 * you see in the screenshot."*
 *
 * ── HOW THIS WAS MATCHED, NOT EYEBALLED ───────────────────────────────────
 * The method in docs/crm/20-BUILDING-A-SCREEN-FROM-A-DESIGN.md. Fills are the
 * most common pixel of a flat region of the PNG, ink is the mean of a glyph's
 * darkest pixels, and the grid is read off the image's own rules. Lengths are a
 * REFERENCE pixel divided by the 0.9 `--ui-scale`, expressed in rem against a
 * 16px root, so 1rem = 14.4 reference pixels.
 *
 * ⚠️ TYPE SIZES ARE SOLVED FROM INK WIDTHS, NOT CAP HEIGHTS. Measuring the
 * height of a glyph came out 20-35% too large on every string here, and the
 * first build shipped with six clipped labels before the widths were checked.
 * Each size is `referenceInkWidth / 0.9 / (canvas width of the same string at
 * 1px in this app's own resolved font)`, which is exact rather than a ratio
 * guessed from a typeface's metrics.
 *
 * ── ⚠️ THE REFERENCE SAYS "SAMPLE DATA". THIS PAGE NEVER WILL ─────────────
 * Same pill, same place, same green dot — and it reads "Live data", because
 * every figure here is read from the database. Where nothing is recorded the
 * screen says so instead of drawing a zero. A performance page that rounds a
 * gap up to a number is the one bug that ends up in a conversation about
 * somebody's job.
 *
 * ── ⚠️ AND ITS LEFT RAIL IS NOT COPIED ────────────────────────────────────
 * The mock-up's sidebar lists items this app does not have. Layout comes from
 * the image, content from the schema (the standing rule). Rewriting real
 * navigation to match a picture would break every other page to flatter one.
 *
 * ── RULE ZERO ──────────────────────────────────────────────────────────────
 * The period, the team and the project decide which ROWS ARE READ, so they go
 * through the URL under `useTransition` — the old table stays on screen and
 * dims. The person filter, the tabs, the selection and the drawer are client
 * state and answer in their own frame. The AI panel is drawn in full from the
 * figures already on the page before any model is called; asking one adds
 * prose, and that call is the only thing here that visibly waits.
 * ========================================================================= */

export type TabKey =
  | 'overview'
  | 'people'
  | 'compare'
  | 'projects'
  | 'quality'
  | 'workload'
  | 'assessments'
  | 'reports';

/* The order and the wording are the owner's later reference images, which add
   Quality and Workload between "Projects & teams" and "Assessments". */
const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'compare', label: 'Compare' },
  { key: 'projects', label: 'Projects & teams' },
  { key: 'quality', label: 'Quality' },
  { key: 'workload', label: 'Workload' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'reports', label: 'Reports' },
];

export interface PerformanceScope {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly preset: string;
  readonly team: string;
  readonly project: string;
  readonly person: string;
}

type Flagged = ReadonlyArray<{
  row: AttentionRow;
  why: NonNullable<ReturnType<typeof attentionFor>>;
}>;

export function PerformanceBoard({
  board,
  attention,
  period,
  today,
  asOf,
  nowMs,
  presets,
  options,
  projects,
  teams,
  workload,
  quality,
  weekly,
  monthly,
  updatedAt,
  ownOnly,
}: {
  board: readonly PersonStat[];
  attention: readonly AttentionRow[];
  period: PerformanceScope;
  today: string;
  /** Today, written the way the reference writes it — the server's day, not the browser's. */
  asOf: string;
  nowMs: number;
  presets: ReadonlyArray<{ value: string; label: string }>;
  options: FilterOptions;
  projects: readonly ProjectRow[];
  teams: readonly TeamRow[];
  workload: readonly WorkloadRow[];
  quality: QualitySummary;
  weekly: readonly BucketRow[];
  monthly: readonly BucketRow[];
  /** A Member reads this page about themselves; the server has already scoped it. */
  ownOnly: boolean;
  /** The server's clock, formatted — so the pill is not the browser's idea of now. */
  updatedAt: string;
}) {
  const router = useRouter();
  const [pending, startScope] = React.useTransition();
  const [tab, setTab] = React.useState<TabKey>('overview');
  const [openPerson, setOpenPerson] = React.useState<PersonStat | null>(null);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = React.useState(false);

  /* ── ⚠️ THE PERSON IS THE URL'S, AND THE SCREEN DOES NOT WAIT FOR IT ──────
     It was client state while it only hid rows already drawn. It cannot be now:
     the owner asked that choosing somebody change every tab, and Projects,
     Quality and Workload need rows nobody has fetched yet.

     So it follows Rule Zero law 2 — the wish applies THIS frame and the URL
     catches up behind it. The table filters instantly; the per-person panels
     fill in when the read lands.

     ⚠️ A plain useState here would be a back-button bug: state does not
     rewind, so Back would drop the parameter while the page still believed the
     person was chosen. The URL stays authoritative and the wish is dropped the
     moment the two agree. */
  const urlPerson = period.person;
  const [wish, setWish] = React.useState<string | undefined>(undefined);
  if (wish !== undefined && wish === urlPerson) setWish(undefined);

  /* ⚠️ TWO VALUES, AND THE DIFFERENCE BETWEEN THEM IS HONESTY.

     `person` is the wish: it applies this frame and narrows the rows ALREADY ON
     THE PAGE — the team table and the attention list. That is free and true.

     `settled` is the one the server has answered for. Anything that needs rows
     nobody has fetched — the person header, and the per-project breakdown that
     replaces the team table — keys off this instead. Measured before it was
     split: picking somebody swapped the panel to "Where Abdul's work goes" and
     listed all 18 projects, because the only project rows in hand were the
     team's. A heading that names a person over somebody else's data is worse
     than a moment of the old view. */
  const person = wish ?? urlPerson;
  const settled = urlPerson;

  const working = React.useMemo(
    () => board.filter((p) => p.completed > 0 || p.openNow > 0),
    [board],
  );
  const rows = React.useMemo(
    () => (person === 'all' ? working : working.filter((p) => p.id === person)),
    [working, person],
  );

  /* ── The four figures, totalled from the rows on screen ────────────────── */
  const totals = React.useMemo(() => {
    const completed = rows.reduce((n, p) => n + p.completed, 0);
    const reviewed = rows.reduce((n, p) => n + p.reviewed, 0);
    const onTime = rows.reduce((n, p) => n + p.onTime, 0);
    const judged = rows.reduce((n, p) => n + p.judged, 0);
    const overdue = rows.reduce((n, p) => n + p.overdue, 0);
    const awaiting = rows.reduce((n, p) => n + p.awaitingReview, 0);
    return { completed, reviewed, onTime, judged, overdue, awaiting, unverified: completed - reviewed };
  }, [rows]);

  const otRate = rate(totals.onTime, totals.judged);

  const flagged: Flagged = React.useMemo(
    () =>
      attention
        .filter((r) => person === 'all' || r.assigneeId === person)
        .map((row) => ({ row, why: attentionFor(row, nowMs, today) }))
        .filter(
          (x): x is { row: AttentionRow; why: NonNullable<ReturnType<typeof attentionFor>> } =>
            x.why !== null,
        ),
    [attention, nowMs, today, person],
  );

  const setScope = (key: 'period' | 'team' | 'project', value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value === 'all' && key !== 'period') params.delete(key);
    else params.set(key, value);
    startScope(() =>
      router.replace(`/performance?${params.toString()}` as Route, { scroll: false }),
    );
  };

  /* The board is already narrowed to them when one is chosen, so this finds
     them; `workload` is only consulted for the pill's label, because it is the
     one list that still holds everybody. */
  const chosenPerson = settled === 'all' ? null : (board.find((p) => p.id === settled) ?? null);
  const chosenName =
    chosenPerson?.name ?? workload.find((w) => w.id === person)?.name ?? null;

  const setPerson = (value: string) => {
    setWish(value);
    const params = new URLSearchParams(window.location.search);
    if (value === 'all') params.delete('person');
    else params.set('person', value);
    startScope(() =>
      router.replace(`/performance?${params.toString()}` as Route, { scroll: false }),
    );
  };

  return (
    <div className="perf-ui mx-auto max-w-[var(--content-max)]">
      <Header
        rangeLabel={period.label}
        asOf={asOf}
        updatedAt={updatedAt}
        ownOnly={ownOnly}
        onExport={() => setExporting(true)}
      />

      {exporting && (
        <ExportDialog
          from={period.from}
          to={period.to}
          today={today}
          ownOnly={ownOnly}
          personName={chosenName}
          scope={{
            personId: person === 'all' ? null : person,
            departmentId: period.team === 'all' ? null : period.team,
            projectId: period.project === 'all' ? null : period.project,
          }}
          onClose={() => setExporting(false)}
        />
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div
        className="mt-[1.15rem] flex flex-wrap items-end gap-x-[2.5rem] border-b"
        style={{ borderColor: 'var(--pf-grid)' }}
        role="tablist"
        aria-label="Performance views"
      >
        {TABS.map((x) => {
          const on = tab === x.key;
          return (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(x.key)}
              className="-mb-px pb-[0.62rem] pt-[0.2rem] text-[0.96rem] leading-[1.4] transition-colors"
              style={{
                color: on ? 'var(--pf-teal)' : 'var(--pf-soft)',
                fontWeight: on ? 600 : 400,
                borderBottomStyle: 'solid',
                borderBottomWidth: '2.8px',
                borderBottomColor: on ? 'var(--pf-teal)' : 'transparent',
              }}
            >
              {x.label}
            </button>
          );
        })}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="mt-[1.1rem] flex flex-wrap items-center gap-[0.8rem]">
        <FilterPill
          icon={CalendarDays}
          title="Period"
          label={presets.find((p) => p.value === period.preset)?.label ?? 'This week'}
          value={period.preset}
          options={[...presets]}
          onChange={(v) => setScope('period', v)}
        />
        {!ownOnly && (
        <FilterPill
          icon={Users}
          title="Team"
          label={options.teams.find((x) => x.id === period.team)?.name ?? 'All teams'}
          value={period.team}
          options={[
            { value: 'all', label: 'All teams' },
            ...options.teams.map((x) => ({ value: x.id, label: x.name })),
          ]}
          onChange={(v) => setScope('team', v)}
        />
        )}
        <FilterPill
          icon={Folder}
          title="Project"
          label={options.projects.find((x) => x.id === period.project)?.name ?? 'All projects'}
          value={period.project}
          options={[
            { value: 'all', label: 'All projects' },
            ...options.projects.map((x) => ({ value: x.id, label: x.name })),
          ]}
          onChange={(v) => setScope('project', v)}
        />
        {/* ⚠️ HIDDEN, NOT DISABLED — and hiding it is not what enforces the
            rule. The server overwrites `personId` with the caller's own id for a
            Member before any read runs, so a hand-typed `?person=` is ignored.
            This only keeps the screen honest about what it offers. */}
        {!ownOnly && (
        <FilterPill
          icon={User}
          title="Person"
          label={chosenName ? `Person: ${chosenName}` : 'Person: All'}
          value={person}
          /* ⚠️ FROM `workload`, NOT `board`. Once a person is chosen the board
             read is narrowed to them, so building this list from it would leave
             the dropdown holding one name and no way back to anybody else.
             `workload` carries every active person in the team/project scope. */
          options={[
            { value: 'all', label: 'Person: All' },
            ...workload.map((w) => ({ value: w.id, label: w.name })),
          ]}
          onChange={setPerson}
        />
        )}
      </div>

      {chosenPerson && (
        <PersonHeader
          person={chosenPerson}
          workload={workload.find((w) => w.id === chosenPerson.id) ?? null}
          rangeLabel={period.label}
          /* ⚠️ A MEMBER HAS NO WHOLE TEAM TO GO BACK TO. Offering the button
             would be offering a door that opens onto the same room. */
          onClear={ownOnly ? null : () => setPerson('all')}
        />
      )}

      {/* ⚠️ THE OLD ROWS STAY, DIMMED. Never blank a table somebody is reading
          in order to wait for the same table with fewer rows in it. */}
      <div
        className="mt-[1.1rem] transition-opacity"
        style={{ opacity: pending ? 0.55 : 1 }}
        aria-busy={pending}
      >
        {/* ⚠️ SPLIT AT 1500px, NOT AT xl (1280). Between those two widths the
            main column is ~650px and four stat cards cannot sit in it without
            wrapping their labels — which is exactly what the owner saw. Below
            1500 the AI panel goes underneath at full width instead. */}
        {tab === 'overview' && (
          <div className="grid items-start gap-[1.3rem] min-[1500px]:grid-cols-[minmax(0,1.575fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-[1.25rem]">
              {/* auto-fit against a real minimum, so the four cards sit in one
                  row wherever one row fits and fall to two-up where it does not,
                  instead of shrinking until the text breaks. */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(11.4rem,1fr))] gap-[0.7rem]">
                <StatCard
                  label="Completed"
                  value={String(totals.completed)}
                  /* ⚠️ SHORT ENOUGH FOR THE REFERENCE'S CARD. Its own line
                     reads "18 verified · 6 unverified" and only fits because those
                     are one- and two-digit figures; ours reach three, so the same
                     fact is stated as a fraction rather than being cut off. */
                  sub={
                    totals.completed === 0
                      ? 'Nothing closed yet'
                      : `${totals.reviewed} of ${totals.completed} verified`
                  }
                  tone="green"
                  icon={Check}
                />
                <StatCard
                  label="On-time delivery"
                  /* ⚠️ "—", NOT "0%". Nothing in this period had a deadline, so
                     nothing missed one; 0% would report the opposite. */
                  value={otRate.value === null ? '—' : `${otRate.value}%`}
                  sub={
                    otRate.value === null
                      ? 'None had a deadline'
                      : `${totals.onTime} of ${totals.judged} due`
                  }
                  tone="blue"
                  icon={Clock3}
                />
                <StatCard
                  label="Awaiting review"
                  value={String(totals.awaiting)}
                  sub={
                    totals.awaiting === 0
                      ? 'The queue is clear'
                      : stalled(flagged) > 0
                        ? `${stalled(flagged)} waiting over 48h`
                        : 'All within 48 hours'
                  }
                  tone="amber"
                  icon={FileText}
                />
                <StatCard
                  label="Open overdue"
                  value={String(totals.overdue)}
                  sub={totals.overdue === 0 ? 'Nothing is late' : 'Check delay reasons'}
                  tone="red"
                  icon={AlertCircle}
                />
              </div>

              {/* ⚠️ A ONE-ROW "TEAM PERFORMANCE" TABLE IS NOT AN ANSWER. Once a
                  person is chosen the board read is narrowed to them, so this
                  table would be a single row repeating the four cards above it.
                  Their Overview shows where their work actually goes instead —
                  the owner's own words: *"his whole contribution in each
                  project"*. */}
              {chosenPerson ? (
                <ProjectsTab
                  projects={projects}
                  teams={teams}
                  /* null name = "your work", which is what a Member should read
                     on their own page. */
                  personName={ownOnly ? null : chosenPerson.name}
                  ownOnly={ownOnly}
                />
              ) : (
              <Panel
                title="Team performance"
                description="Select a person to inspect their work"
                action={
                  <button
                    type="button"
                    onClick={() => setTab('compare')}
                    disabled={picked.size < 2}
                    className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[0.9rem] py-[0.72rem] text-[0.78rem] font-semibold leading-none transition-opacity disabled:opacity-75"
                    style={{ background: 'var(--pf-mint)', color: 'var(--pf-mint-ink)' }}
                    title={
                      picked.size < 2
                        ? 'Tick two or more people to compare them'
                        : `Compare ${picked.size} people`
                    }
                  >
                    <BarChart3 className="size-[0.95rem]" aria-hidden="true" />
                    Compare selected{picked.size > 1 ? ` (${picked.size})` : ''}
                  </button>
                }
              >
                {rows.length === 0 ? (
                  <Nothing>
                    Nobody in this view completed or is carrying work in this period. Widen the
                    period, the team or the project above to see more.
                  </Nothing>
                ) : (
                  <PeopleTable
                    rows={rows}
                    picked={picked}
                    onPick={setPicked}
                    onOpen={setOpenPerson}
                    flagged={flagged}
                  />
                )}
              </Panel>
              )}

              <Panel title="Work requiring attention">
                {flagged.length === 0 ? (
                  <Nothing>Nothing is blocked, overdue, or waiting on a reviewer right now.</Nothing>
                ) : (
                  <AttentionTable rows={flagged} />
                )}
              </Panel>
            </div>

            <InsightPanel
              scope={{ from: period.from, to: period.to, personId: person === 'all' ? null : person }}
              totals={totals}
              best={bestDeliverer(rows)}
              stalledCount={stalled(flagged)}
              firstBlocker={flagged.find((f) => f.why.kind === 'blocked') ?? flagged[0] ?? null}
              onOpenPerson={setOpenPerson}
              anyone={rows[0] ?? board[0] ?? null}
            />
          </div>
        )}

        {tab === 'people' && (
          <Panel title="People" description="Open anybody to see their whole record">
            {board.length === 0 ? (
              <Nothing>Nobody is visible to you.</Nothing>
            ) : (
              <ul className="border-t" style={{ borderColor: 'var(--pf-grid)' }}>
                {board.map((p) => (
                  <li key={p.id} className="border-b last:border-0" style={{ borderColor: 'var(--pf-grid)' }}>
                    <button
                      type="button"
                      onClick={() => setOpenPerson(p)}
                      className="flex w-full items-center gap-[0.9rem] px-[1.1rem] py-[0.75rem] text-left"
                    >
                      <Avatar name={p.name} src={p.avatarUrl} size="md" />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[0.86rem] font-semibold leading-[1.3]"
                          style={{ color: 'var(--pf-ink)' }}
                        >
                          {p.name}
                        </span>
                        <span className="block truncate text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
                          {p.roleTitle ?? p.role.replace('_', ' ')}
                        </span>
                      </span>
                      <span
                        className="hidden gap-[1.4rem] text-[0.87rem] sm:flex"
                        style={{ color: 'var(--pf-soft)' }}
                      >
                        <span>
                          <span className="tabular-nums" style={{ color: 'var(--pf-ink)' }}>
                            {p.completed}
                          </span>{' '}
                          completed
                        </span>
                        <span>
                          <span className="tabular-nums" style={{ color: 'var(--pf-ink)' }}>
                            {p.openNow}
                          </span>{' '}
                          open
                        </span>
                        {p.overdue > 0 && (
                          <span style={{ color: 'var(--pf-red-ink)' }}>
                            <span className="tabular-nums">{p.overdue}</span> overdue
                          </span>
                        )}
                      </span>
                      <ArrowRight
                        className="size-[0.95rem] shrink-0"
                        style={{ color: 'var(--pf-mute)' }}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tab === 'compare' && (
          <CompareTab
            weekly={weekly}
            monthly={monthly}
            board={working}
            picked={picked}
            personName={ownOnly ? null : (chosenPerson?.name ?? null)}
          />
        )}

        {tab === 'projects' && (
          <ProjectsTab
            projects={projects}
            teams={teams}
            personName={ownOnly ? null : (chosenPerson?.name ?? null)}
            ownOnly={ownOnly}
          />
        )}

        {tab === 'quality' && <QualityTab quality={quality} nowMs={nowMs} />}

        {tab === 'workload' && <WorkloadTab rows={workload} />}

        {tab === 'assessments' && (
          <AssessmentsTab
            scope={{ from: period.from, to: period.to, personId: person === 'all' ? null : person }}
            totals={totals}
            best={bestDeliverer(rows)}
            stalledCount={stalled(flagged)}
            firstBlocker={flagged.find((f) => f.why.kind === 'blocked') ?? flagged[0] ?? null}
            onOpenPerson={setOpenPerson}
            anyone={rows[0] ?? board[0] ?? null}
            personName={chosenPerson?.name ?? null}
          />
        )}

        {tab === 'reports' && <ReportsTab board={rows} periodLabel={period.label} />}
      </div>

      <PersonDrawer
        person={openPerson}
        period={{ from: period.from, to: period.to }}
        today={today}
        onClose={() => setOpenPerson(null)}
      />
    </div>
  );
}

/* ── The page head: title, the two actions, and the date meta ─────────────── */

function Header({
  rangeLabel,
  asOf,
  updatedAt,
  ownOnly,
  onExport,
}: {
  rangeLabel: string;
  asOf: string;
  updatedAt: string;
  ownOnly: boolean;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-[2rem] gap-y-[0.9rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[1.1rem]">
          <h1
            className="text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em]"
            style={{ color: 'var(--pf-ink)' }}
          >
            {ownOnly ? 'My performance' : 'Performance overview'}
          </h1>
          <span
            className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.72rem] py-[0.36rem] text-[0.9rem] font-semibold leading-none"
            style={{ background: 'var(--pf-violet-head)', color: 'var(--pf-violet)' }}
          >
            <Sparkles className="size-[0.95rem]" aria-hidden="true" />
            AI assisted
          </span>
        </div>
        <p className="mt-[0.35rem] text-[1.07rem] leading-[1.35]" style={{ color: 'var(--pf-soft)' }}>
          {ownOnly
            ? 'Your work, your deadlines, and the evidence behind both.'
            : 'Understand the work. See the evidence. Decide the next step.'}
        </p>
      </div>

      {/* ⚠️ THESE GO WHERE THE WORK ALREADY IS. Task creation lives in one dialog
          on /tasks and the export lives on /reports, which the owner asked to
          leave alone — a second copy of either would be a second thing to keep
          in step with the first. */}
      <div className="ml-auto flex items-center gap-[0.85rem]">
        <Link
          href={'/tasks' as Route}
          className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[1.05rem] py-[0.85rem] text-[0.87rem] font-semibold leading-none"
          style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
        >
          <Plus className="size-[1.05rem]" aria-hidden="true" />
          Assign task
        </Link>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] border px-[1.05rem] py-[0.85rem] text-[0.87rem] font-semibold leading-none"
          style={{
            background: 'var(--pf-surface)',
            borderColor: 'var(--pf-field-line)',
            color: 'var(--pf-ink)',
            boxShadow: 'var(--pf-shadow)',
          }}
        >
          <Download className="size-[1.05rem]" aria-hidden="true" />
          Export task form
        </button>
      </div>

      <div className="ml-auto text-right">
        <p className="whitespace-nowrap text-[0.95rem] leading-[1.4]" style={{ color: 'var(--pf-soft)' }}>
          {rangeLabel} · As of {asOf}
        </p>
        {/* ⚠️ THE REFERENCE'S PILL SAYS "Sample data". SAME PILL, TRUE WORD. */}
        <span
          className="mt-[0.45rem] inline-flex whitespace-nowrap items-center gap-[0.4rem] rounded-full px-[0.7rem] py-[0.32rem] text-[0.79rem] leading-none"
          style={{ background: 'var(--pf-strip)', color: 'var(--pf-soft)' }}
        >
          <span
            className="size-[0.5rem] rounded-full"
            style={{ background: 'var(--pf-green)' }}
            aria-hidden="true"
          />
          Live data · Updated {updatedAt} PKT
        </span>
      </div>
    </div>
  );
}

/* ── The people table ────────────────────────────────────────────────────── */

function PeopleTable({
  rows,
  picked,
  onPick,
  onOpen,
  flagged,
}: {
  rows: readonly PersonStat[];
  picked: ReadonlySet<string>;
  onPick: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  onOpen: (p: PersonStat) => void;
  flagged: Flagged;
}) {
  const allOn = rows.length > 0 && rows.every((p) => picked.has(p.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] table-fixed border-collapse">
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{
              background: 'var(--pf-head)',
              borderColor: 'var(--pf-grid)',
              color: 'var(--pf-soft)',
            }}
          >
            <th className="w-[3.1rem] py-[0.72rem] pl-[1.22rem] text-left">
              <input
                type="checkbox"
                aria-label="Select everybody"
                checked={allOn}
                onChange={(e) => onPick(e.target.checked ? new Set(rows.map((p) => p.id)) : new Set())}
                className="size-[0.95rem] align-middle"
                style={{ accentColor: 'var(--pf-teal)' }}
              />
            </th>
            {/* ⚠️ PERSON IS THE FLEXIBLE COLUMN AND THE NUMERIC ONES ARE BUDGETED
                AGAINST THEIR HEADERS, not against the design's screenshot. Sized
                from the reference alone they totalled 692px of a 756px column and
                left Person 64px — every name and role truncated ("Graphic Desi…",
                "Social Media…"), which is what the owner photographed. A number
                column only ever holds "20 of 48"; the name is the part that has
                to be readable. */}
            <th className="py-[0.72rem] text-left font-medium">Person</th>
            <th className="w-[6.6rem] py-[0.72rem] text-center font-medium">Completed</th>
            {/* ⚠️ "Verified" IS THE REFERENCE'S WORD FOR `reviewed` — a second
                pair of eyes saw it on its way to done. The title attribute says
                so, because "verified" could be read as a stronger claim. */}
            <th
              className="w-[6.2rem] py-[0.72rem] text-center font-medium"
              title="Went through review on its way to done"
            >
              Verified
            </th>
            <th className="w-[6.4rem] py-[0.72rem] text-center font-medium">On time</th>
            <th className="w-[6.2rem] py-[0.72rem] text-center font-medium">Overdue</th>
            <th className="w-[11rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const mine = flagged.filter((f) => f.row.assigneeId === p.id);
            return (
              <tr
                key={p.id}
                className="border-b last:border-0"
                style={{ borderColor: 'var(--pf-grid)', height: '3.35rem' }}
              >
                <td className="pl-[1.22rem]">
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={picked.has(p.id)}
                    onChange={(e) =>
                      onPick((prev) => {
                        const set = new Set(prev);
                        if (e.target.checked) set.add(p.id);
                        else set.delete(p.id);
                        return set;
                      })
                    }
                    className="size-[0.95rem] align-middle"
                    style={{ accentColor: 'var(--pf-teal)' }}
                  />
                </td>
                <td>
                  <span className="flex min-w-0 items-center gap-[0.82rem]">
                    <Avatar name={p.name} src={p.avatarUrl} size="lg" />
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[0.86rem] font-semibold leading-[1.25]"
                        style={{ color: 'var(--pf-ink)' }}
                      >
                        {p.name}
                      </span>
                      <span
                        className="block truncate text-[0.74rem] leading-[1.35]"
                        style={{ color: 'var(--pf-mute)' }}
                      >
                        {p.roleTitle ?? p.role.replace('_', ' ')}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                  {p.completed}
                </td>
                <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                  {p.reviewed}
                </td>
                <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                  {/* ⚠️ "—", NOT "0 of 0". Nothing they finished had a deadline. */}
                  {p.judged === 0 ? (
                    <span style={{ color: 'var(--pf-mute)' }} title="Nothing they completed had a deadline">
                      —
                    </span>
                  ) : (
                    `${p.onTime} of ${p.judged}`
                  )}
                </td>
                <td
                  className="text-center text-[0.87rem] tabular-nums"
                  style={{ color: p.overdue > 0 ? 'var(--pf-red-ink)' : 'var(--pf-body)' }}
                >
                  {p.overdue}
                </td>
                <td className="pr-[1.22rem]">
                  <button
                    type="button"
                    onClick={() => onOpen(p)}
                    className="inline-flex items-center gap-[0.45rem] whitespace-nowrap text-[0.86rem] font-semibold hover:underline"
                    style={{ color: 'var(--pf-link)' }}
                  >
                    {nextActionFor(p, mine)}{' '}
                    <ArrowRight className="size-[0.95rem] shrink-0" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What this row's link says.
 *
 * ⚠️ READ FROM THEIR OWN FLAGGED WORK, not varied for looks. The reference
 * shows three different phrases down this column; here a row says "Resolve
 * blocker" because that person actually has a blocked task.
 */
function nextActionFor(p: PersonStat, mine: Flagged): string {
  if (mine.some((f) => f.why.kind === 'blocked')) return 'Resolve blocker';
  if (mine.some((f) => f.why.kind === 'awaiting_review')) return 'Review follow-ups';
  if (p.overdue > 0) return 'Review overdue';
  return 'View work';
}

/* ── Work requiring attention ────────────────────────────────────────────── */

function AttentionTable({ rows }: { rows: Flagged }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[38rem] table-fixed border-collapse">
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{
              background: 'var(--pf-head)',
              borderColor: 'var(--pf-grid)',
              color: 'var(--pf-soft)',
            }}
          >
            {/* Task is the flexible one here for the same reason — a task title
                is the thing somebody reads the row for. */}
            <th className="py-[0.72rem] pl-[1.22rem] text-left font-medium">Task</th>
            <th className="w-[10.5rem] py-[0.72rem] text-left font-medium">Owner</th>
            {/* ⚠️ WIDE ENOUGH FOR THE LONGEST STRING WE GENERATE. "Awaiting
                reviewer · 426h" needs 162px; the column carries that plus the
                icon, the gap and the padding. A BLOCKED REASON is free text a
                person typed and can be any length — that one truncates, and the
                whole of it is in the cell's title. */}
            <th className="w-[13.2rem] py-[0.72rem] text-left font-medium">Issue</th>
            <th className="w-[11rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, why }) => {
            const bad = why.kind === 'blocked' || why.kind === 'overdue';
            return (
              <tr
                key={row.taskId}
                className="border-b last:border-0"
                style={{ borderColor: 'var(--pf-grid)', height: '3.35rem' }}
              >
                <td className="pl-[1.22rem] pr-[1rem]">
                  <span className="flex min-w-0 items-center gap-[0.55rem] text-[0.87rem]">
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--pf-body)' }}>
                      {row.reference}
                    </span>
                    <span style={{ color: 'var(--pf-mute)' }}>·</span>
                    <span className="min-w-0 truncate" style={{ color: 'var(--pf-ink)' }} title={row.title}>
                      {row.title}
                    </span>
                  </span>
                </td>
                <td>
                  {row.assigneeName ? (
                    <span className="flex min-w-0 items-center gap-[0.68rem]">
                      <Avatar name={row.assigneeName} src={row.assigneeAvatarUrl} size="lg" />
                      <span className="truncate text-[0.87rem]" style={{ color: 'var(--pf-ink)' }}>
                        {row.assigneeName}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[0.87rem]" style={{ color: 'var(--pf-mute)' }}>
                      Nobody
                    </span>
                  )}
                </td>
                {/* ⚠️ THE BLOCKED REASON IS FREE TEXT SOMEBODY TYPED. It runs to a
                    sentence on real rows, so the cell truncates and keeps the whole
                    of it in `title` — without this one row made the table four
                    times its height and pushed every column out of shape. */}
                <td className="pr-[1rem]">
                  <span
                    className="flex min-w-0 items-center gap-[0.6rem] text-[0.87rem]"
                    style={{ color: 'var(--pf-ink)' }}
                    title={why.text}
                  >
                    {/* ⚠️ THE BLOCKED MARK IS FILLED, THE WAITING ONE IS NOT — that
                        is how the reference separates "somebody must act" from
                        "somebody is waiting", and it survives being read at a
                        glance down a column. `fill` paints only the outer circle;
                        the bar and the dot of the glyph are strokes, so they stay
                        the surface colour and read as white on red. */}
                    {bad ? (
                      <AlertCircle
                        className="size-[1.2rem] shrink-0"
                        style={{ color: 'var(--pf-red)' }}
                        fill="var(--pf-red)"
                        stroke="var(--pf-surface)"
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock3
                        className="size-[1.2rem] shrink-0"
                        style={{ color: 'var(--pf-amber)' }}
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{why.text}</span>
                  </span>
                </td>
                <td className="pr-[1.22rem]">
                  <Link
                    href={`/tasks?task=${row.taskId}` as Route}
                    className="inline-flex items-center gap-[0.45rem] whitespace-nowrap text-[0.86rem] font-semibold hover:underline"
                    style={{ color: 'var(--pf-link)' }}
                  >
                    {why.nextAction}{' '}
                    <ArrowRight className="size-[0.95rem] shrink-0" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── The AI panel ────────────────────────────────────────────────────────── */

interface Totals {
  readonly completed: number;
  readonly reviewed: number;
  readonly onTime: number;
  readonly judged: number;
  readonly overdue: number;
  readonly awaiting: number;
  readonly unverified: number;
}

function InsightPanel({
  scope,
  totals,
  best,
  stalledCount,
  firstBlocker,
  onOpenPerson,
  anyone,
}: {
  scope: { from: string; to: string; personId: string | null };
  totals: Totals;
  best: PersonStat | null;
  stalledCount: number;
  firstBlocker: Flagged[number] | null;
  onOpenPerson: (p: PersonStat) => void;
  anyone: PersonStat | null;
}) {
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'working'; question: string | null }
    | { kind: 'done'; narrative: Narrative; question: string | null }
    | { kind: 'failed'; error: string }
  >({ kind: 'idle' });
  const [draft, setDraft] = React.useState('');

  const ask = async (question: string | null) => {
    setState({ kind: 'working', question });
    const r = await performanceInsightAction({ ...scope, question });
    if (!r.ok || !r.narrative) {
      setState({ kind: 'failed', error: r.error ?? 'The assessment could not be produced.' });
      return;
    }
    setState({ kind: 'done', narrative: r.narrative, question });
  };

  const n = state.kind === 'done' ? state.narrative : null;

  /* ── ⚠️ THE FOUR BLOCKS ARE DRAWN BEFORE ANY MODEL IS CALLED ────────────
     Each is computed from the figures already on this page, so the panel is
     right on first paint and stays right when the AI key is missing or the call
     fails. Asking the model replaces the SENTENCE with its prose; it never
     supplies the figure. */
  const summary =
    n?.summary.join(' ') ??
    [
      `${totals.completed} ${totals.completed === 1 ? 'task' : 'tasks'} completed; ${totals.reviewed} verified.`,
      totals.overdue > 0 ? `${totals.overdue} remain overdue.` : 'Nothing is past its date.',
      totals.awaiting > 0
        ? `${totals.awaiting} ${totals.awaiting === 1 ? 'submission is' : 'submissions are'} waiting on a reviewer.`
        : 'No submission is waiting on a reviewer.',
    ].join(' ');

  const strength =
    n?.strengths[0] ??
    (best ? `${first(best.name)} delivered ${best.onTime} of ${best.judged} due tasks on time.` : null);

  const bottleneck =
    n?.risks[0] ??
    (stalledCount > 0
      ? `${stalledCount} ${stalledCount === 1 ? 'submission has' : 'submissions have'} waited over 48 hours. Assign a reviewer today.`
      : null);

  /* ⚠️ AN "EVIDENCE" LINK MUST POINT AT WHAT THE SENTENCE ABOVE IT IS ABOUT.
     When the model writes the block, its sentence may be about a different
     person or a different task than the derived one the link opens — measured
     on a live answer: the prose praised Rafay while the link opened Abdullah.
     So the link is shown only while the two still agree. */
  const strengthNamesBest = Boolean(best) && (!n || (n.strengths[0] ?? '').includes(first(best!.name)));
  const recommended =
    n?.recommendations[0] ??
    (firstBlocker
      ? `${firstBlocker.row.assigneeName ? `${first(firstBlocker.row.assigneeName)}’s` : 'An unassigned'} task ${firstBlocker.row.reference} is ${firstBlocker.why.text.toLowerCase()}. ${firstBlocker.why.nextAction}.`
      : null);

  return (
    <aside
      className="overflow-hidden rounded-[1.1rem] border"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-violet-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <div
        className="flex items-start gap-[0.95rem] px-[1.7rem] py-[1.05rem]"
        style={{ background: 'var(--pf-violet-head)' }}
      >
        <Sparkles
          className="mt-[0.15rem] size-[1.35rem] shrink-0"
          style={{ color: 'var(--pf-violet)' }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="text-[1.27rem] font-bold leading-[1.2]" style={{ color: 'var(--pf-violet)' }}>
            Taskly AI · Performance insights
          </h2>
          <p className="mt-[0.2rem] text-[0.95rem] leading-[1.3]" style={{ color: 'var(--pf-soft)' }}>
            Evidence-based suggestions · Manager decides
          </p>
        </div>
      </div>

      <div className="space-y-[0.55rem] p-[0.7rem]">
        <Insight icon={FileText} tone="plain" title="Assessment summary" body={summary}>
          {anyone && (
            <InsightLink onClick={() => onOpenPerson(anyone)}>
              View {totals.completed} {totals.completed === 1 ? 'task' : 'tasks'}
            </InsightLink>
          )}
        </Insight>

        {strength && (
          <Insight icon={Trophy} tone="mint" title="Strength worth recognising" body={strength}>
            {best && strengthNamesBest && (
              <InsightLink onClick={() => onOpenPerson(best)}>View delivery evidence</InsightLink>
            )}
          </Insight>
        )}

        {bottleneck && (
          <Insight
            icon={TriangleAlert}
            tone="amber"
            title="Review bottleneck"
            body={bottleneck}
            action={
              <Link
                href={'/tasks' as Route}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-[0.62rem] border px-[0.95rem] py-[0.7rem] text-[0.85rem] font-semibold leading-none"
                style={{
                  background: 'var(--pf-surface)',
                  borderColor: 'var(--pf-amber-line)',
                  color: 'var(--pf-ink)',
                }}
              >
                Review queue
              </Link>
            }
          />
        )}

        {recommended && (
          <Insight
            icon={Sparkles}
            tone="violet"
            title="Recommended next action"
            body={recommended}
            action={
              <div className="flex shrink-0 flex-col items-end gap-[0.5rem]">
                <Link
                  href={'/tasks' as Route}
                  className="inline-flex items-center whitespace-nowrap rounded-[0.62rem] px-[0.95rem] py-[0.72rem] text-[0.85rem] font-semibold leading-none"
                  style={{ background: 'var(--pf-violet-deep)', color: 'var(--pf-on-solid)' }}
                >
                  Prepare follow-up task
                </Link>
                {firstBlocker && (!n || recommended.includes(firstBlocker.row.reference)) && (
                  <Link
                    href={`/tasks?task=${firstBlocker.row.taskId}` as Route}
                    className="inline-flex items-center gap-[0.4rem] whitespace-nowrap text-[0.9rem] font-semibold hover:underline"
                    style={{ color: 'var(--pf-link)' }}
                  >
                    View evidence: {firstBlocker.row.reference}
                    <ArrowRight className="size-[0.95rem]" aria-hidden="true" />
                  </Link>
                )}
              </div>
            }
          />
        )}

        {state.kind === 'done' && state.question && n && (
          <Insight icon={Sparkles} tone="violet" title={state.question} body={n.headline} />
        )}

        {/* ⚠️ THE ENFORCEMENT, SHOWN. `verifyFigures` reads the model's reply
            back against the fact sheet; a number it was never given is reported
            here rather than trusted. On a page about somebody's work that
            warning matters more than the prose above it. */}
        {n && n.unverifiedFigures.length > 0 && (
          <p
            className="rounded-[0.7rem] px-[1rem] py-[0.75rem] text-[0.85rem]"
            style={{ background: 'var(--pf-red-bg)', color: 'var(--pf-red-ink)' }}
          >
            These figures are not from this page and should be ignored:{' '}
            {n.unverifiedFigures.join(', ')}.
          </p>
        )}

        {state.kind === 'failed' && (
          <p
            className="rounded-[0.7rem] px-[1rem] py-[0.75rem] text-[0.85rem]"
            style={{ background: 'var(--pf-red-bg)', color: 'var(--pf-red-ink)' }}
          >
            {state.error}
          </p>
        )}

        {/* ⚠️ THE GAP, NAMED. The reference's strip says quality assessment is
            incomplete; ours says it only when it is, and says which figure
            makes it so. */}
        <div
          className="flex items-start gap-[0.7rem] rounded-[0.7rem] px-[1rem] py-[0.85rem] text-[0.85rem] leading-[1.45]"
          style={{ background: 'var(--pf-strip)', color: 'var(--pf-faint)' }}
        >
          <Info className="mt-[0.1rem] size-[1.1rem] shrink-0" aria-hidden="true" />
          <span>
            {totals.unverified > 0
              ? `Quality assessment is incomplete: ${totals.unverified} completed ${totals.unverified === 1 ? 'task is' : 'tasks are'} unverified.`
              : 'Every completed task in this period went through review.'}
          </span>
        </div>

        <div className="px-[0.4rem] pt-[0.5rem]">
          <p className="text-[0.85rem] font-bold" style={{ color: 'var(--pf-ink)' }}>
            AI can help with
          </p>
          {/* ⚠️ ONE ROW. The reference fits all four across 493 of its 524
              available pixels, which only works at the measured 0.8rem — at
              0.93rem they wrapped and the panel grew a line. */}
          <div className="mt-[0.6rem] flex flex-wrap items-center gap-x-[1.5rem] gap-y-[0.6rem]">
            <HelpLink icon={BarChart3} onClick={() => void ask('Explain these results.')}>
              Explain results
            </HelpLink>
            <HelpLink icon={FileText} onClick={() => void ask('Summarise the work in this period.')}>
              Summarise work
            </HelpLink>
            <HelpLink icon={Search} onClick={() => void ask('What is blocking this team?')}>
              Find blockers
            </HelpLink>
            <HelpLink icon={ListChecks} onClick={() => void ask('What should we prioritise next?')}>
              Suggest priorities
            </HelpLink>
          </div>

          <form
            className="relative mt-[1.3rem]"
            onSubmit={(e) => {
              e.preventDefault();
              const q = draft.trim();
              if (!q) return;
              setDraft('');
              void ask(q);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about this performance…"
              aria-label="Ask about this performance"
              className="h-[3.3rem] w-full rounded-[0.8rem] border pl-[1.1rem] pr-[3.9rem] text-[0.91rem] outline-none"
              style={{
                background: 'var(--pf-field)',
                borderColor: 'var(--pf-field-line)',
                color: 'var(--pf-ink)',
              }}
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={state.kind === 'working' || draft.trim() === ''}
              className="absolute right-[0.5rem] top-1/2 grid size-[2.35rem] -translate-y-1/2 place-items-center rounded-[0.6rem] disabled:opacity-45"
              style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
            >
              {state.kind === 'working' ? (
                <Loader2 className="size-[1.05rem] animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-[1.05rem]" aria-hidden="true" />
              )}
            </button>
          </form>

          <div className="mt-[0.75rem] flex flex-wrap items-center gap-[0.6rem]">
            <AskChip onClick={() => void ask('Explain the biggest delay in this period.')}>
              Explain a delay
            </AskChip>
            <AskChip onClick={() => void ask('What should this team plan for tomorrow?')}>
              Plan tomorrow
            </AskChip>
          </div>

          <p className="mt-[0.6rem] text-right text-[0.74rem]" style={{ color: 'var(--pf-faint)' }}>
            {state.kind === 'working'
              ? 'Reading the period and writing it up…'
              : n
                ? `Written by ${n.model}. Suggestions need your review — no actions taken automatically.`
                : 'Suggestions need your review. No actions taken automatically.'}
          </p>
        </div>
      </div>
    </aside>
  );
}

const INSIGHT_TONE = {
  plain: {
    card: 'transparent',
    line: 'transparent',
    badge: 'var(--pf-violet-chip-bg)',
    icon: 'var(--pf-violet)',
    title: 'var(--pf-ink)',
    round: '0.9rem',
  },
  mint: {
    card: 'var(--pf-mint-card)',
    line: 'var(--pf-mint-line)',
    badge: 'var(--pf-green-bg)',
    icon: 'var(--pf-green)',
    title: 'var(--pf-ink)',
    round: '999px',
  },
  amber: {
    card: 'var(--pf-amber-card)',
    line: 'var(--pf-amber-line)',
    badge: 'var(--pf-amber-bg)',
    icon: 'var(--pf-amber)',
    title: 'var(--pf-ink)',
    round: '999px',
  },
  violet: {
    card: 'var(--pf-violet-card)',
    line: 'var(--pf-violet-line)',
    badge: 'var(--pf-violet-chip-bg)',
    icon: 'var(--pf-violet)',
    title: 'var(--pf-violet)',
    round: '999px',
  },
} as const;

function Insight({
  icon: Icon,
  tone,
  title,
  body,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: keyof typeof INSIGHT_TONE;
  title: string;
  body: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = INSIGHT_TONE[tone];
  return (
    <div
      /* ⚠️ WRAPS RATHER THAN SQUEEZING. The aside is 524px at the design width
         and 480px at the owner's; at 480 the button beside "Recommended next
         action" pushed that heading onto two lines. Allowing the row to wrap
         moves the button under the text instead, which keeps the heading whole
         at every width. */
      className="flex flex-wrap items-start gap-x-[1.2rem] gap-y-[0.7rem] rounded-[0.8rem] border px-[1.15rem] py-[0.88rem]"
      style={{ background: t.card, borderColor: t.line }}
    >
      <span
        className="grid size-[2.78rem] shrink-0 place-items-center"
        style={{ background: t.badge, borderRadius: t.round }}
      >
        <Icon className="size-[1.4rem]" style={{ color: t.icon }} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-[13rem]">
        <p className="text-[0.94rem] font-bold leading-[1.3]" style={{ color: t.title }}>
          {title}
        </p>
        {body && (
          <p className="mt-[0.25rem] text-[0.9rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {body}
          </p>
        )}
        {children}
      </div>
      {action}
    </div>
  );
}

function InsightLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-[0.55rem] inline-flex items-center gap-[0.45rem] text-[0.9rem] font-semibold hover:underline"
      style={{ color: 'var(--pf-link)' }}
    >
      {children} <ArrowRight className="size-[0.95rem]" aria-hidden="true" />
    </button>
  );
}

function HelpLink({
  icon: Icon,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[0.4rem] whitespace-nowrap text-[0.8rem] hover:underline"
      style={{ color: 'var(--pf-link)' }}
    >
      <Icon className="size-[0.95rem]" style={{ color: 'var(--pf-teal)' }} aria-hidden="true" />
      {children}
    </button>
  );
}

function AskChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[0.7rem] border px-[0.88rem] py-[0.62rem] text-[0.79rem] leading-none"
      style={{
        background: 'var(--pf-violet-chip-bg)',
        borderColor: 'var(--pf-violet-line)',
        color: 'var(--pf-violet-chip)',
      }}
    >
      {children}
    </button>
  );
}

/* ── Derived facts the AI panel states ───────────────────────────────────── */

const first = (name: string) => name.trim().split(/\s+/)[0];

/** The clearest on-time record in the period. Null when nothing was judged. */
function bestDeliverer(rows: readonly PersonStat[]): PersonStat | null {
  const judged = rows.filter((p) => p.judged > 0);
  if (judged.length === 0) return null;
  return [...judged].sort(
    (a, b) => b.onTime / b.judged - a.onTime / a.judged || b.judged - a.judged,
  )[0];
}

/** How many submissions have sat with a reviewer past the 48-hour threshold. */
function stalled(flagged: Flagged): number {
  return flagged.filter((f) => f.why.kind === 'awaiting_review').length;
}


/* ── The person header — the owner's second reference image ──────────────── */

/**
 * Who the page is about, when it is about one person.
 *
 * ⚠️ THE FACTS ON IT ARE THE ONES WE HOLD. The reference writes "Product
 * Designer | Design | Based in London"; this system records a free-text job
 * title and a department, and no location at all. It shows the two it has
 * rather than inventing the third — and the department is the structured one a
 * rule could be written against, not the title.
 */
function PersonHeader({
  person,
  workload,
  rangeLabel,
  onClear,
}: {
  person: PersonStat;
  workload: WorkloadRow | null;
  rangeLabel: string;
  onClear: (() => void) | null;
}) {
  const facts = [person.roleTitle, workload?.departmentName].filter(Boolean) as string[];
  return (
    <section
      className="mt-[1.1rem] flex flex-wrap items-center gap-x-[1.6rem] gap-y-[0.9rem] rounded-[0.95rem] border px-[1.22rem] py-[1rem]"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <span className="flex min-w-0 items-center gap-[0.9rem]">
        <Avatar name={person.name} src={person.avatarUrl} size="xl" />
        <span className="min-w-0">
          <span className="block truncate text-[1.25rem] font-bold leading-[1.25]" style={{ color: 'var(--pf-ink)' }}>
            {person.name}
          </span>
          <span className="block truncate text-[0.86rem]" style={{ color: 'var(--pf-soft)' }}>
            {facts.length > 0 ? facts.join('  |  ') : person.role.replace('_', ' ')}
          </span>
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-x-[1.6rem] gap-y-[0.6rem]">
        <HeaderFact label="Period" value={rangeLabel} />
        <HeaderFact label="Completed" value={String(person.completed)} />
        <HeaderFact label="Open now" value={String(person.openNow)} />
        <HeaderFact
          label="Overdue"
          value={String(person.overdue)}
          tone={person.overdue > 0 ? 'var(--pf-red-ink)' : undefined}
        />
      </span>

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto inline-flex items-center gap-[0.45rem] whitespace-nowrap rounded-[0.7rem] border px-[0.95rem] py-[0.65rem] text-[0.85rem] font-semibold leading-none"
          style={{
            background: 'var(--pf-surface)',
            borderColor: 'var(--pf-field-line)',
            color: 'var(--pf-ink)',
          }}
        >
          Back to the whole team
        </button>
      )}
    </section>
  );
}

function HeaderFact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="block">
      <span className="block text-[0.74rem] leading-[1.3]" style={{ color: 'var(--pf-mute)' }}>
        {label}
      </span>
      <span
        className="block text-[0.95rem] font-semibold tabular-nums leading-[1.3]"
        style={{ color: tone ?? 'var(--pf-ink)' }}
      >
        {value}
      </span>
    </span>
  );
}

/* ── Assessments ─────────────────────────────────────────────────────────── */

/**
 * The written assessment, full width.
 *
 * ⚠️ THIS IS THE SAME PANEL AS THE OVERVIEW'S, NOT A SECOND ONE. One place
 * builds the fact sheet and one place enforces `unverifiedFigures`; a second
 * copy would be a second thing to keep honest.
 *
 * ⚠️ AND A FORMAL ASSESSMENT IS NOT THIS. Self-review, a manager's evaluation,
 * the employee's response and agreed goals are written by people and this
 * system records none of them — that needs a table of its own. The tab says so
 * rather than letting an AI summary stand in for a review somebody signed.
 */
function AssessmentsTab({
  scope,
  totals,
  best,
  stalledCount,
  firstBlocker,
  onOpenPerson,
  anyone,
  personName,
}: {
  scope: { from: string; to: string; personId: string | null };
  totals: Totals;
  best: PersonStat | null;
  stalledCount: number;
  firstBlocker: Flagged[number] | null;
  onOpenPerson: (p: PersonStat) => void;
  anyone: PersonStat | null;
  personName: string | null;
}) {
  return (
    <div className="grid items-start gap-[1.3rem] min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <InsightPanel
        scope={scope}
        totals={totals}
        best={best}
        stalledCount={stalledCount}
        firstBlocker={firstBlocker}
        onOpenPerson={onOpenPerson}
        anyone={anyone}
      />
      <Panel
        title="Formal assessments"
        description={
          personName
            ? `Reviews recorded for ${personName.split(' ')[0]}.`
            : 'Reviews recorded against a person.'
        }
      >
        <div
          className="space-y-[0.7rem] border-t px-[1.22rem] py-[1.15rem] text-[0.88rem] leading-[1.5]"
          style={{ borderColor: 'var(--pf-grid)' }}
        >
          <p style={{ color: 'var(--pf-ink)' }}>
            Nothing is recorded yet, and this is the one part of the page that cannot be derived
            from the work.
          </p>
          <p style={{ color: 'var(--pf-soft)' }}>
            A self-review, a manager&rsquo;s evaluation, the employee&rsquo;s response, the goals
            agreed and the date they are revisited are all written by people. Tasks cannot supply
            them, so this needs a table of its own — and until it exists, the assessment beside this
            one is a reading of the record, not a review anybody has signed.
          </p>
          <p style={{ color: 'var(--pf-soft)' }}>
            Say the word and it is a migration and a form: version, period, status, the two written
            sides, agreed goals with baselines and targets, and a follow-up date.
          </p>
        </div>
      </Panel>
    </div>
  );
}


/* ── The task assignment form export — owner, 2026-09-24 ─────────────────── */

/**
 * Pick the days, get the office's own form.
 *
 * ⚠️ IT OPENS ON TODAY, NOT ON THE PAGE'S PERIOD. *"You just imagine that every
 * day every team member exports his task list from here and submits it to the
 * officer."* That is the daily case, so it is the default; the two date fields
 * are there because the owner also asked for *"a date calendar or a date range
 * there that we can select"*.
 *
 * ⚠️ AND IT IS A REAL DIALOG, NOT A NAVIGATION. Opening and closing it touches
 * no network (Rule Zero, law 1); only pressing Export does.
 *
 * ── ⚠️ IT USES THE APP'S `Dialog`, AND THE FIRST VERSION DID NOT ──────────
 * Hand-rolled as a `fixed inset-0` overlay it OPENED BELOW THE FOLD and the
 * owner reported "nothing appears". The cause is the trap CLAUDE.md already
 * names: the shell's `.reveal-children` animation ends on `transform: none`
 * with `fill-mode: both`, which computes to an identity matrix — and ANY
 * transform on an ancestor makes it the containing block for `position:
 * fixed`. So `inset-0` filled the 1540px page container, not the 712px
 * viewport, and centred the card at y≈832.
 *
 * `components/ui/dialog.tsx` is built on the native `<dialog>` element, which
 * the browser puts in the TOP LAYER — outside the containing block entirely.
 * That is why every other modal in this app was unaffected, and it is why this
 * one no longer hand-rolls its own.
 */
function ExportDialog({
  from,
  to,
  today,
  ownOnly,
  personName,
  scope,
  onClose,
}: {
  from: string;
  to: string;
  today: string;
  ownOnly: boolean;
  personName: string | null;
  scope: { personId: string | null; departmentId: string | null; projectId: string | null };
  onClose: () => void;
}) {
  const [start, setStart] = React.useState(today);
  const [end, setEnd] = React.useState(today);
  const [state, setState] = React.useState<
    { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; error: string }
  >({ kind: 'idle' });

  const run = async () => {
    setState({ kind: 'working' });
    const r = await exportTaskFormsAction({ from: start, to: end, ...scope });
    if (!r.ok || !r.base64) {
      setState({ kind: 'failed', error: r.error ?? 'The form could not be made.' });
      return;
    }
    /* A data: URL, so nothing has to be written to a server to be downloaded. */
    const a = document.createElement('a');
    a.href = `data:application/pdf;base64,${r.base64}`;
    a.download = r.fileName ?? 'task-assignment-form.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  };

  const days =
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  const bad = !Number.isFinite(days) || days < 1;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Task assignment form"
      description="One sheet per person per day, on the CNI Islamabad form, with the signature blocks left blank to sign by hand."
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-[0.6rem]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[0.7rem] px-[0.95rem] py-[0.7rem] text-[0.86rem] font-semibold leading-none"
            style={{ color: 'var(--pf-soft)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={bad || state.kind === 'working'}
            className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[1.05rem] py-[0.72rem] text-[0.86rem] font-semibold leading-none disabled:opacity-50"
            style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-solid)' }}
          >
            {state.kind === 'working' ? (
              <>
                <Loader2 className="size-[1rem] animate-spin" aria-hidden="true" /> Building…
              </>
            ) : (
              <>
                <Download className="size-[1rem]" aria-hidden="true" /> Export PDF
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="perf-ui">
        <div className="grid grid-cols-2 gap-[0.8rem]">
          {([
            ['From', start, setStart],
            ['To', end, setEnd],
          ] as const).map(([label, value, set]) => (
            <label key={label} className="block">
              <span className="block text-[0.76rem] font-medium" style={{ color: 'var(--pf-soft)' }}>
                {label}
              </span>
              <input
                type="date"
                value={value}
                max={today}
                onChange={(e) => set(e.target.value)}
                className="mt-[0.3rem] h-[2.6rem] w-full rounded-[0.6rem] border px-[0.7rem] text-[0.87rem] outline-none"
                style={{
                  background: 'var(--pf-field)',
                  borderColor: 'var(--pf-field-line)',
                  color: 'var(--pf-ink)',
                }}
              />
            </label>
          ))}
        </div>

        <div className="mt-[0.7rem] flex flex-wrap gap-[0.4rem]">
          {/* The two the owner actually described: today, and the page's period. */}
          <Chip onClick={() => { setStart(today); setEnd(today); }}>Today</Chip>
          <Chip onClick={() => { setStart(from); setEnd(to); }}>This period</Chip>
        </div>

        <p className="mt-[0.9rem] text-[0.82rem] leading-[1.45]" style={{ color: 'var(--pf-faint)' }}>
          {ownOnly
            ? 'Your own tasks only.'
            : personName
              ? `${personName} only.`
              : 'Everybody the filters are showing.'}{' '}
          {bad
            ? 'The To date is before the From date.'
            : `${days} day${days === 1 ? '' : 's'}. A day with no task is not printed.`}
        </p>

        {state.kind === 'failed' && (
          <p
            className="mt-[0.8rem] rounded-[0.6rem] px-[0.9rem] py-[0.65rem] text-[0.84rem]"
            style={{ background: 'var(--pf-red-bg)', color: 'var(--pf-red-ink)' }}
          >
            {state.error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[0.6rem] border px-[0.7rem] py-[0.45rem] text-[0.78rem] leading-none"
      style={{
        background: 'var(--pf-violet-chip-bg)',
        borderColor: 'var(--pf-violet-line)',
        color: 'var(--pf-violet-chip)',
      }}
    >
      {children}
    </button>
  );
}
