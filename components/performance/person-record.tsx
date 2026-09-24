'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  Download,
  FilePlus2,
  Folder,
  Info,
  Paperclip,
  PauseCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Workflow,
  Sparkles,
  TriangleAlert,
  User,
  UserCog,
  Repeat,
  Users,
  XCircle,
} from 'lucide-react';

import { ActivityHistory } from '@/components/performance/activity-history';
import { PerformanceHistory } from '@/components/performance/performance-history';
import { dayWord } from '@/lib/view/activity';
import { Caveat, QualityTab } from '@/components/performance/performance-tabs';
import { TaskLedger } from '@/components/performance/task-ledger';
import { FilterPill, Nothing, Panel, StatCard } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type {
  Assessment,
  BucketRow,
  HistoryEntry,
  PeriodRow,
  PersonStat,
  ProjectRow,
  LedgerDetail,
  LedgerRow,
  QualitySummary,
  TaskSources,
  WorkloadRow,
  WorkRow,
} from '@/lib/db/queries/performance';
import { rate } from '@/lib/domain/performance';

/* ============================================================================
 * ONE PERSON'S RECORD — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"When I select any person specifically from the filter in the admin or super
 * admin dashboard, that person's performance will look exactly like this ...
 * Overview, Task, Activity History, Performance History, Review, Goals."*
 *
 * ── ⚠️ THIS IS A DIFFERENT SCREEN, NOT THE TEAM PAGE WITH ONE ROW ─────────
 * The team view answers "how is the division doing". This answers "how is this
 * person doing", and the owner drew it with its OWN six tabs. Reusing the
 * team's eight would have been less work and the wrong answer — Quality and
 * Workload are team questions; Reviews, Goals and Activity history are not.
 *
 * ── ⚠️ THE REFERENCE PRINTS "Not loaded" AND "Not recorded". WE DO NOT ────
 * *"In this image no data is displayed, right, but you will display all the
 * data according to our live database."* Every figure here is read. Where the
 * record genuinely holds nothing — Goals — the tab says so in words and says
 * what would be needed, rather than drawing an empty frame.
 *
 * ── ⚠️ AND IT IS ADMIN-SIDE ONLY ─────────────────────────────────────────
 * *"I'm only talking about the admin, super admin, and the team coordinator
 * dashboard."* A Member reading their own page gets the team layout scoped to
 * themselves, which is what they already had; this record is what a manager
 * opens ABOUT somebody. The server decides that, not this file.
 * ========================================================================= */

export type RecordTab = 'overview' | 'tasks' | 'activity' | 'history' | 'reviews' | 'goals';

const TABS: ReadonlyArray<{ key: RecordTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'activity', label: 'Activity history' },
  { key: 'history', label: 'Performance history' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'goals', label: 'Goals' },
];

const num = (n: number) => n.toLocaleString('en-GB');

export interface PersonRecordProps {
  readonly person: PersonStat;
  readonly workload: WorkloadRow | null;
  readonly projects: readonly ProjectRow[];
  readonly work: readonly WorkRow[];
  readonly workTotal: number;
  readonly history: readonly HistoryEntry[];
  readonly ledger: readonly LedgerRow[];
  readonly ledgerTotal: number;
  readonly ledgerSeed: { id: string; detail: LedgerDetail } | null;
  readonly viewer: { id: string; name: string };
  readonly periods: readonly PeriodRow[];
  readonly assessments: readonly Assessment[];
  readonly sources: TaskSources;
  readonly quality: QualitySummary;
  readonly weekly: readonly BucketRow[];
  readonly monthly: readonly BucketRow[];
  readonly rangeLabel: string;
  readonly today: string;
  readonly nowMs: number;
  readonly projectOptions: ReadonlyArray<{ id: string; name: string }>;
  readonly peopleOptions: ReadonlyArray<{ id: string; name: string }>;
  readonly presets: ReadonlyArray<{ value: string; label: string }>;
  readonly preset: string;
  readonly project: string;
  readonly onScope: (key: 'period' | 'project' | 'person', value: string) => void;
  readonly onBack: () => void;
  readonly onCompare: () => void;
  readonly onExport: () => void;
  readonly onOpenTask: (taskId: string) => void;
}

export function PersonRecord(p: PersonRecordProps) {
  const [tab, setTab] = React.useState<RecordTab>('overview');

  /* ⚠️ JUDGED, NOT COMPLETED. Only a task WITH a due date can be on time or
     late; dividing by everything closed silently penalises a person for work
     that never had a deadline. It also has to agree with the team Overview,
     which already uses this denominator — the same figure must not differ
     between the two screens. The reference writes "(26 of 54 completed)"; the
     wording here follows the arithmetic instead. */
  const otRate = rate(p.person.onTime, p.person.judged);

  /* ── ⚠️ THERE IS NO "VERIFIED" IN THIS SYSTEM ──────────────────────────
     Owner, 2026-09-24: *"There is no term you can say 'verified' ... you can
     say in the review how many tasks are in a review and how many tasks are
     done."* The word came from the reference image, not from the product, and
     it implied a check nobody performs. A task is DONE, or it is IN REVIEW
     because somebody asked for one. Those are the two words. */
  const inReview = p.person.awaitingReview;
  const done = p.person.completed;

  return (
    <div>
      <RecordHeader {...p} />

      {/* ── The six tabs ─────────────────────────────────────────────────── */}
      <div
        className="mt-[1.15rem] flex flex-wrap items-end gap-x-[2.2rem] border-b"
        style={{ borderColor: 'var(--pf-grid)' }}
        role="tablist"
        aria-label={`${p.person.name}'s record`}
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

      {/* ── The scope row ────────────────────────────────────────────────── */}
      <div className="mt-[1.1rem] flex flex-wrap items-center gap-[0.8rem]">
        <FilterPill
          icon={User}
          title="Person"
          label={p.person.name}
          value={p.person.id}
          options={p.peopleOptions.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => p.onScope('person', v)}
        />
        <FilterPill
          icon={Folder}
          title="Project"
          label={p.projectOptions.find((x) => x.id === p.project)?.name ?? 'All projects'}
          value={p.project}
          options={[
            { value: 'all', label: 'All projects' },
            ...p.projectOptions.map((x) => ({ value: x.id, label: x.name })),
          ]}
          onChange={(v) => p.onScope('project', v)}
        />
        <FilterPill
          icon={CalendarDays}
          title="Period"
          label={p.presets.find((x) => x.value === p.preset)?.label ?? 'This week'}
          value={p.preset}
          options={[...p.presets]}
          onChange={(v) => p.onScope('period', v)}
        />
        <span className="text-[0.84rem]" style={{ color: 'var(--pf-soft)' }}>
          {p.rangeLabel}
        </span>
      </div>

      <div className="mt-[1.1rem]">
        {tab === 'overview' && (
          <Overview {...p} otRate={otRate} inReview={inReview} done={done} onTab={setTab} />
        )}

        {tab === 'tasks' && (
          <TaskLedger
            rows={p.ledger}
            total={p.ledgerTotal}
            seed={p.ledgerSeed}
            today={p.today}
            personName={p.person.name}
            onExport={p.onExport}
          />
        )}

        {tab === 'activity' && (
          <ActivityHistory
            history={p.history}
            person={{ id: p.person.id, name: p.person.name }}
            rangeLabel={p.rangeLabel}
            onOpenTask={p.onOpenTask}
          />
        )}

        {tab === 'history' && (
          <PerformanceHistory
            person={{ id: p.person.id, name: p.person.name }}
            viewer={p.viewer}
            periods={p.periods}
            assessments={p.assessments}
            weekly={p.weekly}
            monthly={p.monthly}
            onTab={setTab}
          />
        )}

        {tab === 'reviews' && <QualityTab quality={p.quality} nowMs={p.nowMs} />}

        {tab === 'goals' && <GoalsTab name={p.person.name} />}
      </div>
    </div>
  );
}

const first = (name: string) => name.trim().split(/\s+/)[0];

/* ── The header ──────────────────────────────────────────────────────────── */

function RecordHeader({
  person,
  workload,
  onBack,
  onCompare,
  onExport,
}: PersonRecordProps) {
  const facts = [person.roleTitle, workload?.departmentName].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-start gap-x-[1.6rem] gap-y-[1rem]">
      <span className="flex min-w-0 items-center gap-[1rem]">
        <Avatar name={person.name} src={person.avatarUrl} size="xl" />
        <span className="min-w-0">
          <span
            className="block truncate text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em]"
            style={{ color: 'var(--pf-ink)' }}
          >
            {person.name}
          </span>
          <span className="mt-[0.2rem] block truncate text-[0.95rem]" style={{ color: 'var(--pf-soft)' }}>
            {[...facts, 'Individual record'].join('  ·  ')}
          </span>
        </span>
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-[0.7rem]">
        <HeadButton onClick={onBack} icon={ArrowLeft}>
          Back to team
        </HeadButton>
        <Link
          href={'/tasks' as Route}
          className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[1rem] py-[0.8rem] text-[0.86rem] font-semibold leading-none"
          style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-solid)' }}
        >
          <Plus className="size-[1.05rem]" aria-hidden="true" />
          Assign task
        </Link>
        <HeadButton onClick={onCompare} icon={BarChart3}>
          Compare
        </HeadButton>
        <HeadButton onClick={onExport} icon={Download}>
          Export full record
        </HeadButton>
      </div>
    </div>
  );
}

function HeadButton({
  onClick,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[0.5rem] whitespace-nowrap rounded-[0.7rem] border px-[1rem] py-[0.8rem] text-[0.86rem] font-semibold leading-none"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-field-line)',
        color: 'var(--pf-ink)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <Icon className="size-[1.05rem]" aria-hidden="true" />
      {children}
    </button>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview(
  p: PersonRecordProps & {
    otRate: ReturnType<typeof rate>;
    inReview: number;
    done: number;
    onTab: (t: RecordTab) => void;
  },
) {
  const { person, otRate, inReview, done } = p;
  const openNow = person.openNow;

  return (
    <div className="space-y-[1.25rem]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11.4rem,1fr))] gap-[0.7rem]">
        <StatCard
          label="Completed"
          value={num(person.completed)}
          sub={person.completed === 0 ? 'Nothing closed in this period' : 'Reached done in the period'}
          tone="green"
          icon={CheckCircle2}
        />
        <StatCard
          label="In review"
          value={num(inReview)}
          sub={
            inReview === 0
              ? 'Nothing is waiting on a review'
              : `Submitted and waiting on a reviewer`
          }
          tone="blue"
          icon={ShieldCheck}
        />
        <StatCard
          label="Completed on time"
          value={otRate.value === null ? '—' : `${otRate.value}%`}
          sub={
            otRate.value === null
              ? 'Nothing they closed had a deadline'
              : `${person.onTime} of ${person.judged} that had a deadline`
          }
          tone="amber"
          icon={Clock3}
        />
        <StatCard
          label="Open overdue"
          value={num(person.overdue)}
          sub={person.overdue === 0 ? 'Nothing is past its date' : 'Open and past the date'}
          tone="red"
          icon={TriangleAlert}
        />
      </div>

      {/* ⚠️ THE REFERENCE'S OWN CAVEAT, KEPT. On-time is computed only over
          tasks that HAD a deadline — unfinished work is not in it, and saying so
          stops the figure being read as a promise it does not make. */}
      <Caveat>
        Completed on time counts only tasks that had a due date. Work still open, and work closed
        without a deadline, is not in that percentage — see Open overdue for what is still owed.
      </Caveat>

      {/* ⚠️ items-stretch, NOT items-start. Owner, 2026-09-24: *"the assessment
          content should increase its height and be properly adjusted ... there
          is a white space over there."* With items-start each panel was only as
          tall as its own content, so the short one left a hole beside the long
          one. Stretching makes the row a row. */}
      <div className="grid items-stretch gap-[1.25rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel title="Done and in review" description="Where their work stands right now.">
          <div className="border-t px-[1.22rem] py-[1.15rem]" style={{ borderColor: 'var(--pf-grid)' }}>
            {done + openNow === 0 ? (
              <p className="text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
                They have no work in this period.
              </p>
            ) : (
              <>
                {/* Done, in review, and still open — the three states that
                    actually exist, in one bar. */}
                <ReviewBar done={done} inReview={inReview} open={Math.max(0, openNow - inReview)} />
                <div className="mt-[0.8rem] flex flex-wrap items-center gap-x-[1.6rem] gap-y-[0.4rem] text-[0.86rem]">
                  <Legend colour="var(--pf-green)" label="Done" value={done} />
                  <Legend colour="var(--pf-blue)" label="In review" value={inReview} />
                  <Legend colour="var(--pf-amber)" label="Still open" value={Math.max(0, openNow - inReview)} />
                </div>
                <p className="mt-[0.7rem] text-[0.82rem]" style={{ color: 'var(--pf-faint)' }}>
                  A task goes into review when somebody asks for one. The person who assigned it is
                  the one who reviews it — see the Reviews tab for who owes what.
                </p>
              </>
            )}
          </div>
        </Panel>

        <AssessmentContext
          person={person}
          inReview={inReview}
          onViewCompleted={() => p.onTab('tasks')}
          onInspectOverdue={() => p.onTab('tasks')}
        />
      </div>

      <div className="grid items-stretch gap-[1.25rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          title="Work across projects"
          description={`Every project ${first(person.name)} has a task in.`}
        >
          {p.projects.length === 0 ? (
            <Nothing>No project has a task for them in this scope.</Nothing>
          ) : (
            /* ⚠️ THE EIGHT BUSIEST, NOT ALL OF THEM. The table was the tallest
               thing on the page and every panel beside it had to match; the
               rest are on the Projects tab, and the line below says so. */
            <>
              <ProjectRows rows={p.projects.slice(0, 8)} />
              {p.projects.length > 8 && (
                <Caveat>
                  Showing the 8 busiest of {p.projects.length} projects they have a task in.
                </Caveat>
              )}
            </>
          )}
        </Panel>

        <AssignmentAccountability
          sources={p.sources}
          onView={() => p.onTab('tasks')}
          team={p.workload?.departmentName ?? null}
          role={person.roleTitle}
          openNow={person.openNow}
          overdue={person.overdue}
        />
      </div>

      <RecentActivity history={p.history.slice(0, 8)} onAll={() => p.onTab('activity')} />
    </div>
  );
}

/** Done / in review / still open, proportionally. */
function ReviewBar({ done, inReview, open }: { done: number; inReview: number; open: number }) {
  const total = done + inReview + open;
  if (total === 0) return null;
  const seg = [
    { n: done, bg: 'var(--pf-green-bg)', ink: 'var(--pf-green)' },
    { n: inReview, bg: 'var(--pf-blue-bg)', ink: 'var(--pf-blue)' },
    { n: open, bg: 'var(--pf-amber-bg)', ink: 'var(--pf-amber)' },
  ];
  return (
    <div
      className="flex h-[1.6rem] w-full overflow-hidden rounded-[0.4rem]"
      role="img"
      aria-label={`${done} done, ${inReview} in review, ${open} still open`}
    >
      {seg.map((x, i) =>
        x.n > 0 ? (
          <span
            key={i}
            className="grid place-items-center overflow-hidden text-[0.78rem] font-semibold"
            style={{ width: `${(x.n / total) * 100}%`, background: x.bg, color: x.ink }}
          >
            {x.n}
          </span>
        ) : null,
      )}
    </div>
  );
}

function Legend({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-[0.5rem]">
      <span className="size-[0.6rem] rounded-full" style={{ background: colour }} aria-hidden="true" />
      <span style={{ color: 'var(--pf-soft)' }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: 'var(--pf-ink)' }}>
        {num(value)}
      </span>
    </span>
  );
}

function ProjectRows({ rows }: { rows: readonly ProjectRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] table-fixed border-collapse">
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
          >
            <th className="py-[0.72rem] pl-[1.22rem] text-left font-medium">Project</th>
            <th className="w-[6rem] py-[0.72rem] text-center font-medium">Assigned</th>
            <th className="w-[6.6rem] py-[0.72rem] text-center font-medium">Completed</th>
            <th className="w-[5.8rem] py-[0.72rem] text-center font-medium">Pending</th>
            <th className="w-[7rem] py-[0.72rem] pr-[1.22rem] text-center font-medium">Open overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b last:border-0"
              style={{ borderColor: 'var(--pf-grid)', height: '3.1rem' }}
            >
              <td className="pl-[1.22rem] pr-[0.6rem] text-[0.87rem]" title={r.name}>
                <span className="block truncate font-medium" style={{ color: 'var(--pf-ink)' }}>
                  {r.name}
                </span>
              </td>
              <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                {num(r.assigned)}
              </td>
              <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                {num(r.completed)}
              </td>
              <td className="text-center text-[0.87rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                {num(r.openNow)}
              </td>
              <td
                className="pr-[1.22rem] text-center text-[0.87rem] tabular-nums"
                style={{ color: r.overdue > 0 ? 'var(--pf-red-ink)' : 'var(--pf-body)' }}
              >
                {num(r.overdue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── The AI strip ────────────────────────────────────────────────────────── */

function AssessmentContext({
  person,
  inReview,
  onViewCompleted,
  onInspectOverdue,
}: {
  person: PersonStat;
  inReview: number;
  onViewCompleted: () => void;
  onInspectOverdue: () => void;
}) {
  /* ⚠️ STATED FROM THE FIGURES, NOT ASKED OF A MODEL. This strip is context, and
     it has to be right on first paint; the written assessment lives on the team
     page's Assessments tab, where it is explicitly a model's words. */
  /* ⚠️ MORE LINES BECAUSE THERE IS MORE TO SAY, not to fill a box. Each one is
     a figure already on the page, restated as the thing a manager would act on;
     the panel was two sentences tall beside a nine-row table. */
  const lines = [
    `${person.completed} ${person.completed === 1 ? 'task' : 'tasks'} done; ${
      inReview === 0 ? 'nothing waiting on a review' : `${inReview} waiting on a review`
    }.`,
    person.overdue > 0
      ? `Investigate ${person.overdue} overdue ${person.overdue === 1 ? 'task' : 'tasks'} by cause and original commitment.`
      : 'Nothing of theirs is past its due date.',
    person.judged > 0
      ? `Of the work that carried a deadline, ${person.onTime} of ${person.judged} landed on time.`
      : 'None of their completed work carried a deadline, so timeliness cannot be judged.',
    person.openNow > 0
      ? `${person.openNow} still open, of which ${person.overdue} have already passed their date.`
      : 'They are carrying nothing open right now.',
  ];

  return (
    <aside
      className="overflow-hidden rounded-[0.95rem] border"
      style={{
        background: 'var(--pf-violet-card)',
        borderColor: 'var(--pf-violet-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <div className="flex items-start gap-[0.8rem] px-[1.22rem] pt-[1.15rem]">
        <span
          className="grid size-[1.9rem] shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--pf-violet-chip-bg)' }}
        >
          <Sparkles className="size-[1rem]" style={{ color: 'var(--pf-violet)' }} aria-hidden="true" />
        </span>
        <h2 className="text-[1.05rem] font-bold leading-[1.3]" style={{ color: 'var(--pf-ink)' }}>
          Assessment context
        </h2>
      </div>
      <div className="px-[1.22rem] pb-[1.22rem] pt-[0.6rem]">
        {lines.map((l) => (
          <p key={l} className="text-[0.88rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {l}
          </p>
        ))}
        <div className="mt-[0.9rem] flex flex-wrap gap-[0.6rem]">
          <button
            type="button"
            onClick={onViewCompleted}
            className="rounded-[0.62rem] px-[0.95rem] py-[0.65rem] text-[0.84rem] font-semibold leading-none"
            style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-solid)' }}
          >
            View {person.completed} done
          </button>
          <button
            type="button"
            onClick={onInspectOverdue}
            className="rounded-[0.62rem] border px-[0.95rem] py-[0.65rem] text-[0.84rem] font-semibold leading-none"
            style={{
              background: 'var(--pf-surface)',
              borderColor: 'var(--pf-field-line)',
              color: 'var(--pf-ink)',
            }}
          >
            Inspect {person.overdue} overdue
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ── Assignment accountability ───────────────────────────────────────────── */

function AssignmentAccountability({
  sources,
  onView,
  team,
  role,
  openNow,
  overdue,
}: {
  sources: TaskSources;
  onView: () => void;
  team: string | null;
  role: string | null;
  openNow: number;
  overdue: number;
}) {
  /* ⚠️ THREE BUCKETS, AND EVERY TASK IS IN EXACTLY ONE. The repeat count is
     stated underneath instead, because it overlaps all three — a task can be
     self-created AND repeat daily, and making "repeat" a fourth bucket stole
     the answer to "who assigned this". */
  const cards = [
    { icon: User, label: 'Self-created', value: sources.self, tone: 'var(--pf-blue-bg)', ink: 'var(--pf-blue)' },
    { icon: Users, label: 'Coordinator-assigned', value: sources.coordinator, tone: 'var(--pf-green-bg)', ink: 'var(--pf-green)' },
    { icon: UserCog, label: 'Admin-assigned', value: sources.admin, tone: 'var(--pf-violet-chip-bg)', ink: 'var(--pf-violet)' },
  ];
  const share = (n: number) => (sources.total > 0 ? Math.round((n / sources.total) * 100) : 0);

  return (
    <Panel title="Assignment accountability" description="Who put this work on them." className="flex flex-col">
      <div
        className="flex flex-1 flex-col border-t px-[1.22rem] py-[1.15rem]"
        style={{ borderColor: 'var(--pf-grid)' }}
      >
        {sources.total === 0 ? (
          <p className="text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
            No task in this scope, so there is nothing to attribute.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(8.4rem,1fr))] gap-[0.7rem]">
              {cards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-[0.8rem] border px-[0.9rem] py-[0.85rem]"
                  style={{
                    borderColor: 'var(--pf-line)',
                    background: 'var(--pf-surface)',
                    minHeight: '7.2rem',
                  }}
                >
                  <span className="flex items-center gap-[0.6rem]">
                    <span
                      className="grid size-[1.8rem] shrink-0 place-items-center rounded-full"
                      style={{ background: c.tone }}
                    >
                      <c.icon className="size-[0.95rem]" style={{ color: c.ink }} aria-hidden="true" />
                    </span>
                    {/* Wraps, never truncates: "Coordinator-assigned" is the
                        word the owner used and a cut one reads as a different
                        label. */}
                    <span
                      className="min-w-0 flex-1 text-[0.78rem] font-medium leading-[1.25]"
                      style={{ color: 'var(--pf-label)' }}
                    >
                      {c.label}
                    </span>
                  </span>
                  <span
                    className="mt-[0.5rem] block text-[1.4rem] font-bold leading-[1.15] tabular-nums"
                    style={{ color: 'var(--pf-ink)' }}
                  >
                    {num(c.value)}
                  </span>
                  <span className="block text-[0.76rem]" style={{ color: 'var(--pf-sub)' }}>
                    {share(c.value)}% of {num(sources.total)}
                  </span>
                </div>
              ))}
            </div>

            {sources.repeat > 0 && (
              <p
                className="mt-[0.8rem] flex items-start gap-[0.5rem] text-[0.82rem] leading-[1.45]"
                style={{ color: 'var(--pf-faint)' }}
              >
                <Repeat className="mt-[0.15rem] size-[0.95rem] shrink-0" aria-hidden="true" />
                {sources.repeat} of these {sources.total} come back on a repeat. That is how often
                the work returns, not who assigned it — they are counted above by whoever raised
                them.
              </p>
            )}

            {(sources.teammate > 0 || sources.unknown > 0) && (
              <p className="mt-[0.8rem] text-[0.82rem]" style={{ color: 'var(--pf-faint)' }}>
                {[
                  sources.teammate > 0
                    ? `${sources.teammate} raised by a team member, which the system does not allow — seeded demo data`
                    : null,
                  sources.unknown > 0 ? `${sources.unknown} with no recorded creator` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                .
              </p>
            )}

            <button
              type="button"
              onClick={onView}
              className="mt-[0.9rem] w-full rounded-[0.7rem] border px-[1rem] py-[0.7rem] text-[0.85rem] font-semibold leading-none"
              style={{
                background: 'var(--pf-surface)',
                borderColor: 'var(--pf-teal)',
                color: 'var(--pf-teal)',
              }}
            >
              View task sources
            </button>

            {/* ⚠️ RANK AT READ TIME — see the query's own note. */}
            <p className="mt-[0.7rem] text-[0.8rem] leading-[1.45]" style={{ color: 'var(--pf-faint)' }}>
              Read from who raised each task, against that person&rsquo;s rank today &mdash; a
              coordinator later promoted would make their older assignments read as admin-assigned.
            </p>

            {/* ⚠️ THE OWNER ASKED FOR THIS SPACE TO BE USED. The projects table
                beside this panel is long and this one is short, leaving a gap
                at the bottom: *"instead of a white space you can also add over
                here: which team it belongs to, like AI digital team."* */}
            {/* flex-1: the panel is stretched to match the projects table
                beside it, and this block takes the slack rather than leaving it
                empty at the bottom — the owner's second note. */}
            <TeamBelonging team={team} role={role} openNow={openNow} overdue={overdue} />
          </>
        )}
      </div>
    </Panel>
  );
}

/* ── Activity ────────────────────────────────────────────────────────────── */

/* ⚠️ EVERY ACTIVITY CARRIES ITS OWN ICON AND TONE — the owner asked for the
   icon, and the tone is what makes a column of them readable at a glance:
   green finished it, blue asked for a review, red stopped it. */
const ACTIVITY_LOOK: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; tone: string; bg: string }
> = {
  created: { label: 'Task created', icon: FilePlus2, tone: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)' },
  done: { label: 'Marked complete', icon: CheckCircle2, tone: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
  in_review: { label: 'Review requested', icon: Send, tone: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)' },
  in_progress: { label: 'Work started', icon: CircleDot, tone: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  revisions: { label: 'Changes requested', icon: RotateCcw, tone: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  blocked: { label: 'Marked blocked', icon: PauseCircle, tone: 'var(--pf-red-ink)', bg: 'var(--pf-red-bg)' },
  todo: { label: 'Moved to not started', icon: Circle, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  backlog: { label: 'Moved to backlog', icon: Circle, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  cancelled: { label: 'Cancelled', icon: XCircle, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  updated: { label: 'Task edited', icon: Pencil, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  attachment_added: { label: 'File attached', icon: Paperclip, tone: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
  attachment_removed: { label: 'File removed', icon: Paperclip, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  /* ⚠️ NOT "Handed over" — that invented a human action. Checked on the live
     database: all 256 of these carry the summary "Created by the Client
     retainer pipeline chain". `task.handoff` is the WORKFLOW creating the next
     task in a chain (doc 12, E-004), not a person passing work to a person. */
  'task.handoff': {
    label: 'Created by workflow',
    icon: Workflow,
    tone: 'var(--pf-violet)',
    bg: 'var(--pf-violet-chip-bg)',
  },
  'task.placement_recorded': { label: 'Placement recorded', icon: CheckCircle2, tone: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
};

const FALLBACK = { label: '', icon: Circle, tone: 'var(--pf-soft)', bg: 'var(--pf-strip)' };

/**
 * Who put this work on them.
 *
 * ⚠️ THE RANK IS NAMED, NOT JUST THE PERSON. Owner: *"Someone should mention
 * whether it's an admin, super admin, or team coordinator who assigned that
 * activity."* The rank is read today — the same caveat the accountability panel
 * carries.
 */
/**
 * "FREQ=DAILY;INTERVAL=1" as a word.
 *
 * ⚠️ THE RULE IS AN RFC-5545 STRING AND NOBODY SHOULD READ ONE. Owner,
 * 2026-09-24: *"mark it as a daily created rotation ... so we exactly know that
 * this task is created daily."*
 */
export function repeatWord(rule: string | null): string {
  if (!rule) return 'Repeating';
  const freq = /FREQ=([A-Z]+)/.exec(rule)?.[1];
  const every = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? '1');
  const base =
    freq === 'DAILY' ? 'Daily' : freq === 'WEEKLY' ? 'Weekly' : freq === 'MONTHLY' ? 'Monthly' : 'Repeating';
  if (every > 1) return `${base} (every ${every})`;
  return base;
}

/** The same thing in a full sentence, for the cell's tooltip. */
function sourceHelp(h: HistoryEntry): string {
  const who = h.sourceName ?? 'somebody';
  if (h.sourceKind === 'self')
    return `They raised this task themselves.${
      h.recurrenceRule ? ` It repeats ${repeatWord(h.recurrenceRule).toLowerCase()}.` : ''
    }`;
  if (h.sourceKind === 'admin') return `${who}, an admin, raised this task and assigned it to them.`;
  if (h.sourceKind === 'coordinator')
    return `${who}, a team coordinator, raised this task and assigned it to them.`;
  if (h.sourceKind === 'teammate')
    return `${who} raised this task and assigned it to them — but ${who} is a team member, and a team member cannot assign work in this system. This only appears on demo data seeded straight into the database.`;
  return 'No creator is recorded against this task.';
}

function sourceLabel(h: HistoryEntry): { text: string; tone: string } {
  /* ⚠️ SOURCE ANSWERS ONE QUESTION: WHO. The repeat is appended as a note,
     never in place of the name — the owner's correction, 2026-09-24. */
  const repeats = h.recurrenceRule ? ` · ${repeatWord(h.recurrenceRule).toLowerCase()}` : '';
  if (h.sourceKind === 'self')
    return { text: `Self-created${repeats}`, tone: 'var(--pf-soft)' };
  if (h.sourceKind === 'admin')
    return {
      text: `${h.sourceName ? `Admin · ${h.sourceName}` : 'Admin-assigned'}${repeats}`,
      tone: 'var(--pf-violet)',
    };
  if (h.sourceKind === 'coordinator')
    return {
      text: `${h.sourceName ? `Coordinator · ${h.sourceName}` : 'Coordinator-assigned'}${repeats}`,
      tone: 'var(--pf-green)',
    };
  /* ⚠️ THE CATEGORY IS GONE, NOT RENAMED. Owner: *"A team member has no
     right to assign tasks to anyone."* `tasks_insert` agrees and refuses it, so
     the only rows here are demo data written past RLS by the seed script. It
     prints the name with no rank word, and the tooltip says why it exists. */
  if (h.sourceKind === 'teammate')
    return {
      text: `${h.sourceName ?? 'Somebody'}${repeats}`,
      tone: 'var(--pf-soft)',
    };
  return { text: 'Not recorded', tone: 'var(--pf-mute)' };
}

/* ⚠️ dayWord, NOT month: 'short' — see `lib/view/activity.ts`. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return [
    dayWord(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })),
    d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  ].join(', ');
}

function ActivityTable({ history }: { history: readonly HistoryEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] table-fixed border-collapse">
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
          >
            <th className="w-[10.4rem] py-[0.72rem] pl-[1.22rem] text-left font-medium">Date &amp; time</th>
            <th className="w-[11.4rem] py-[0.72rem] text-left font-medium">Activity</th>
            <th className="py-[0.72rem] text-left font-medium">Details</th>
            <th className="w-[10rem] py-[0.72rem] text-left font-medium">Project</th>
            <th className="w-[11.4rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const look = ACTIVITY_LOOK[h.action] ?? { ...FALLBACK, label: h.action };
            const src = sourceLabel(h);
            /* The task's own title is the detail worth reading; the log's
               summary ("moved CLI-2785 to Done") repeats the row beside it. */
            const detail = h.title ?? h.summary;
            return (
              <tr
                key={`${h.at}-${i}`}
                className="border-b last:border-0"
                style={{ borderColor: 'var(--pf-grid)', height: '3.35rem' }}
              >
                <td
                  className="pl-[1.22rem] pr-[0.6rem] text-[0.82rem] tabular-nums"
                  style={{ color: 'var(--pf-body)' }}
                >
                  {stamp(h.at)}
                </td>
                <td className="pr-[0.6rem] text-[0.86rem]">
                  <span className="flex min-w-0 items-center gap-[0.55rem]">
                    <span
                      className="grid size-[1.55rem] shrink-0 place-items-center rounded-full"
                      style={{ background: look.bg }}
                    >
                      <look.icon className="size-[0.88rem]" style={{ color: look.tone }} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--pf-ink)' }}>
                      {look.label}
                    </span>
                  </span>
                </td>
                {/* ⚠️ THE DESCRIPTION IS THE SECOND LINE, NOT A TOOLTIP. Owner,
                    2026-09-24: *"add a detailed description of that task."* The
                    whole of it is still in `title` for the rows whose
                    description runs past the column. */}
                <td
                  className="pr-[0.6rem] text-[0.86rem]"
                  style={{ color: 'var(--pf-body)' }}
                  title={[h.reference, h.title, h.description, h.summary]
                    .filter(Boolean)
                    .join('\n\n')}
                >
                  <span className="block truncate font-medium" style={{ color: 'var(--pf-ink)' }}>
                    {detail}
                  </span>
                  <span className="block truncate text-[0.72rem]" style={{ color: 'var(--pf-mute)' }}>
                    {[h.reference, h.description?.replace(/\s+/g, ' ')].filter(Boolean).join(' · ')}
                  </span>
                </td>
                <td
                  className="pr-[0.6rem] text-[0.84rem]"
                  style={{ color: 'var(--pf-soft)' }}
                  title={h.projectName ?? ''}
                >
                  <span className="block truncate">{h.projectName ?? '—'}</span>
                </td>
                <td className="pr-[1.22rem] text-[0.84rem]" title={sourceHelp(h)}>
                  <span className="block truncate font-medium" style={{ color: src.tone }}>
                    {src.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentActivity({
  history,
  onAll,
}: {
  history: readonly HistoryEntry[];
  onAll: () => void;
}) {
  return (
    <Panel
      title="Recent activity"
      description="The last things recorded against their work."
      action={
        <button
          type="button"
          onClick={onAll}
          className="inline-flex items-center gap-[0.5rem] whitespace-nowrap rounded-[0.7rem] border px-[0.95rem] py-[0.65rem] text-[0.85rem] font-semibold leading-none"
          style={{
            background: 'var(--pf-surface)',
            borderColor: 'var(--pf-field-line)',
            color: 'var(--pf-ink)',
          }}
        >
          Open complete timeline
        </button>
      }
    >
      {history.length === 0 ? (
        <Nothing>Nothing is recorded against them in this period.</Nothing>
      ) : (
        <ActivityTable history={history} />
      )}
    </Panel>
  );
}

/* ── Goals ───────────────────────────────────────────────────────────────── */

/**
 * The one tab that cannot be derived.
 *
 * ⚠️ A GOAL IS AGREED, NOT COMPUTED. The reference draws baselines, targets,
 * due dates, evidence and a check-in history; every one of those is written by
 * two people in a conversation. Tasks cannot supply them. Drawing an empty
 * frame would suggest the feature exists and is broken; this says what it needs.
 */
function GoalsTab({ name }: { name: string }) {
  return (
    <Panel title="Goals & development" description={`Agreed with ${first(name)}, and reviewed against.`}>
      <div
        className="space-y-[0.75rem] border-t px-[1.22rem] py-[1.15rem] text-[0.88rem] leading-[1.5]"
        style={{ borderColor: 'var(--pf-grid)' }}
      >
        <p style={{ color: 'var(--pf-ink)' }}>
          Nothing is recorded, and this is the one part of the record that cannot be read from the
          work.
        </p>
        <p style={{ color: 'var(--pf-soft)' }}>
          A goal has a baseline, a target, a due date, the evidence that would settle it and a
          follow-up date — and all five are agreed between a person and their manager. Tasks cannot
          supply any of them, so this needs a table of its own.
        </p>
        <p className="flex items-start gap-[0.6rem]" style={{ color: 'var(--pf-faint)' }}>
          <Info className="mt-[0.15rem] size-[1rem] shrink-0" aria-hidden="true" />
          Say the word and it is one migration and one form: goal, baseline, target, due date,
          evidence, status, owner, and the dates it was agreed and last checked in.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Which team they belong to — and it fills the gap the owner pointed at.
 *
 * ⚠️ THE DEPARTMENT, NOT THE JOB TITLE. Migration 117 exists precisely because
 * `role_title` is free text with three spellings of "sales"; the department is
 * the structured field, and it is the one a rule can be written against. The
 * title is shown beside it as a label, which is all it is.
 */
function TeamBelonging({
  team,
  role,
  openNow,
  overdue,
}: {
  team: string | null;
  role: string | null;
  openNow: number;
  overdue: number;
}) {
  return (
    <div
      className="mt-[1rem] flex flex-1 flex-col rounded-[0.8rem] border px-[1rem] py-[0.9rem]"
      style={{ borderColor: 'var(--pf-line)', background: 'var(--pf-strip)' }}
    >
      <span className="flex items-center gap-[0.6rem]">
        <span
          className="grid size-[1.8rem] shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--pf-green-bg)' }}
        >
          <Users className="size-[0.95rem]" style={{ color: 'var(--pf-green)' }} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.76rem]" style={{ color: 'var(--pf-mute)' }}>
            Team
          </span>
          <span
            className="block truncate text-[0.95rem] font-semibold leading-[1.3]"
            style={{ color: 'var(--pf-ink)' }}
          >
            {team ?? 'No team on their record'}
          </span>
        </span>
      </span>
      <dl className="mt-[0.8rem] grid flex-1 content-start grid-cols-2 gap-x-[1rem] gap-y-[0.7rem] text-[0.82rem]">
        <Fact label="Role" value={role ?? '—'} />
        <Fact label="Open now" value={String(openNow)} />
        <Fact
          label="Overdue"
          value={String(overdue)}
          tone={overdue > 0 ? 'var(--pf-red-ink)' : undefined}
        />
        <Fact label="Reviews go to" value="Whoever assigned it" />
      </dl>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
        {label}
      </dt>
      <dd
        className="truncate font-semibold"
        style={{ color: tone ?? 'var(--pf-ink)' }}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
