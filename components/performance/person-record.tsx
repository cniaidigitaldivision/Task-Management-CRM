'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Folder,
  Info,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  User,
  UserCog,
  Users,
} from 'lucide-react';

import { Caveat, CompareTab, QualityTab, WorkPanel } from '@/components/performance/performance-tabs';
import { FilterPill, Nothing, Panel, StatCard } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type {
  BucketRow,
  HistoryEntry,
  PersonStat,
  ProjectRow,
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
  const verified = p.person.reviewed;
  const unverified = Math.max(0, p.person.completed - verified);

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
          <Overview {...p} otRate={otRate} verified={verified} unverified={unverified} onTab={setTab} />
        )}

        {tab === 'tasks' && (
          <WorkPanel
            rows={p.work}
            total={p.workTotal}
            nowMs={p.nowMs}
            today={p.today}
            onOpenTask={p.onOpenTask}
            showAssignee={false}
            title={`Everything ${first(p.person.name)} is working on`}
            description="Open work first, then what closed in the period. Blocked and in-review come first."
          />
        )}

        {tab === 'activity' && <ActivityTab history={p.history} nowMs={p.nowMs} name={p.person.name} />}

        {tab === 'history' && (
          <CompareTab
            weekly={p.weekly}
            monthly={p.monthly}
            board={[p.person]}
            picked={new Set()}
            personName={p.person.name}
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
    verified: number;
    unverified: number;
    onTab: (t: RecordTab) => void;
  },
) {
  const { person, otRate, verified, unverified } = p;
  const pct = person.completed > 0 ? Math.round((verified / person.completed) * 100) : 0;

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
          label="Verified"
          value={num(verified)}
          /* ⚠️ NEVER "0%" WHEN THE COUNT IS NOT ZERO. 1 of 221 rounds to 0
             and read as "none", which is a different finding. */
          sub={
            verified === 0
              ? 'None went through review'
              : pct === 0
                ? `${verified} of ${person.completed} — under 1%`
                : `${pct}% of what they closed`
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

      <div className="grid items-start gap-[1.25rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel title="Completed work verification">
          <div className="border-t px-[1.22rem] py-[1.15rem]" style={{ borderColor: 'var(--pf-grid)' }}>
            {person.completed === 0 ? (
              <p className="text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
                Nothing was completed in this period, so there is nothing to verify.
              </p>
            ) : (
              <>
                <div
                  className="flex h-[1.6rem] w-full overflow-hidden rounded-[0.4rem]"
                  role="img"
                  aria-label={`${unverified} unverified, ${verified} verified`}
                >
                  {unverified > 0 && (
                    <span
                      className="grid place-items-center text-[0.78rem] font-semibold"
                      style={{
                        width: `${(unverified / person.completed) * 100}%`,
                        background: 'var(--pf-red-bg)',
                        color: 'var(--pf-red-ink)',
                      }}
                    >
                      {unverified}
                    </span>
                  )}
                  {verified > 0 && (
                    <span
                      className="grid place-items-center text-[0.78rem] font-semibold"
                      style={{
                        width: `${(verified / person.completed) * 100}%`,
                        background: 'var(--pf-green-bg)',
                        color: 'var(--pf-green)',
                      }}
                    >
                      {verified}
                    </span>
                  )}
                </div>
                <div className="mt-[0.8rem] flex flex-wrap items-center gap-x-[1.6rem] gap-y-[0.4rem] text-[0.86rem]">
                  <Legend colour="var(--pf-red)" label="Unverified" value={unverified} />
                  <Legend colour="var(--pf-green)" label="Verified" value={verified} />
                </div>
                {/* ⚠️ THE REFERENCE SAYS THIS AND IT MATTERS MOST HERE. On this
                    database 1,011 of 1,105 tasks were raised and closed by the
                    same person; a red bar must not read as an accusation. */}
                <p className="mt-[0.7rem] text-[0.82rem]" style={{ color: 'var(--pf-faint)' }}>
                  Unverified does not mean rejected — it means nobody else checked it. Review is
                  barely used across this division, so this is a fact about the process, not about
                  this person.
                </p>
              </>
            )}
          </div>
        </Panel>

        <AssessmentContext
          person={person}
          verified={verified}
          onViewCompleted={() => p.onTab('tasks')}
          onInspectOverdue={() => p.onTab('tasks')}
        />
      </div>

      <div className="grid items-start gap-[1.25rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          title="Work across projects"
          description={`Every project ${first(person.name)} has a task in.`}
        >
          {p.projects.length === 0 ? (
            <Nothing>No project has a task for them in this scope.</Nothing>
          ) : (
            <ProjectRows rows={p.projects} />
          )}
        </Panel>

        <AssignmentAccountability sources={p.sources} onView={() => p.onTab('tasks')} />
      </div>

      <RecentActivity history={p.history.slice(0, 8)} onAll={() => p.onTab('activity')} />
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
  verified,
  onViewCompleted,
  onInspectOverdue,
}: {
  person: PersonStat;
  verified: number;
  onViewCompleted: () => void;
  onInspectOverdue: () => void;
}) {
  /* ⚠️ STATED FROM THE FIGURES, NOT ASKED OF A MODEL. This strip is context, and
     it has to be right on first paint; the written assessment lives on the team
     page's Assessments tab, where it is explicitly a model's words. */
  const lines = [
    `${person.completed} ${person.completed === 1 ? 'task' : 'tasks'} marked complete; ${
      verified === 0 ? 'none independently verified' : `${verified} independently verified`
    }.`,
    person.overdue > 0
      ? `Investigate ${person.overdue} overdue ${person.overdue === 1 ? 'task' : 'tasks'} by cause and original commitment.`
      : 'Nothing of theirs is past its due date.',
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
            View {person.completed} completed
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
}: {
  sources: TaskSources;
  onView: () => void;
}) {
  const cards = [
    { icon: User, label: 'Self-created', value: sources.self, tone: 'var(--pf-blue-bg)', ink: 'var(--pf-blue)' },
    { icon: Users, label: 'Coordinator-assigned', value: sources.coordinator, tone: 'var(--pf-green-bg)', ink: 'var(--pf-green)' },
    { icon: UserCog, label: 'Admin-assigned', value: sources.admin, tone: 'var(--pf-violet-chip-bg)', ink: 'var(--pf-violet)' },
  ];
  const share = (n: number) => (sources.total > 0 ? Math.round((n / sources.total) * 100) : 0);

  return (
    <Panel title="Assignment accountability" description="Who put this work on them.">
      <div className="border-t px-[1.22rem] py-[1.15rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        {sources.total === 0 ? (
          <p className="text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
            No task in this scope, so there is nothing to attribute.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-[0.7rem]">
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

            {(sources.teammate > 0 || sources.unknown > 0) && (
              <p className="mt-[0.8rem] text-[0.82rem]" style={{ color: 'var(--pf-faint)' }}>
                {[
                  sources.teammate > 0 ? `${sources.teammate} raised by a teammate` : null,
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
              Read from who raised each task, against that person&rsquo;s rank today. A coordinator
              later promoted would make their older assignments read as admin-assigned.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ── Activity ────────────────────────────────────────────────────────────── */

const ACTIVITY_WORD: Record<string, string> = {
  created: 'Task created',
  done: 'Marked complete',
  in_review: 'Review requested',
  in_progress: 'Work started',
  revisions: 'Changes requested',
  blocked: 'Marked blocked',
  todo: 'Moved to not started',
  backlog: 'Moved to backlog',
  cancelled: 'Cancelled',
  updated: 'Task edited',
  attachment_added: 'File attached',
  attachment_removed: 'File removed',
  'task.handoff': 'Handed over',
  'task.placement_recorded': 'Placement recorded',
};

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ActivityTable({ history }: { history: readonly HistoryEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] table-fixed border-collapse">
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
          >
            <th className="w-[11.5rem] py-[0.72rem] pl-[1.22rem] text-left font-medium">Date &amp; time</th>
            <th className="w-[11rem] py-[0.72rem] text-left font-medium">Activity</th>
            <th className="py-[0.72rem] text-left font-medium">Details</th>
            <th className="w-[11rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Project</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr
              key={`${h.at}-${i}`}
              className="border-b last:border-0"
              style={{ borderColor: 'var(--pf-grid)', height: '3.1rem' }}
            >
              <td
                className="pl-[1.22rem] pr-[0.6rem] text-[0.84rem] tabular-nums"
                style={{ color: 'var(--pf-body)' }}
              >
                {stamp(h.at)}
              </td>
              <td className="pr-[0.6rem] text-[0.87rem]" style={{ color: 'var(--pf-ink)' }}>
                <span className="block truncate">{ACTIVITY_WORD[h.action] ?? h.action}</span>
              </td>
              <td
                className="pr-[0.6rem] text-[0.87rem]"
                style={{ color: 'var(--pf-body)' }}
                title={`${h.reference ?? ''} ${h.summary}`.trim()}
              >
                {/* ⚠️ THE REFERENCE IS ONLY PREFIXED WHEN THE SUMMARY LACKS IT.
                    The log already writes "moved CLI-2785 to Done", so adding
                    it in front printed the same code twice in one cell. */}
                <span className="block truncate">
                  {h.reference && !h.summary.includes(h.reference) ? `${h.reference} · ` : ''}
                  {h.summary}
                </span>
              </td>
              <td
                className="pr-[1.22rem] text-[0.84rem]"
                style={{ color: 'var(--pf-soft)' }}
                title={h.projectName ?? ''}
              >
                <span className="block truncate">{h.projectName ?? '—'}</span>
              </td>
            </tr>
          ))}
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

function ActivityTab({
  history,
  name,
}: {
  history: readonly HistoryEntry[];
  nowMs: number;
  name: string;
}) {
  return (
    <Panel
      title="Activity history"
      description={`Every action recorded against ${first(name)}'s work in this period.`}
    >
      {history.length === 0 ? (
        <Nothing>
          Nothing is recorded in this period. The log holds status changes, edits, attachments and
          handovers — widen the period above to see more.
        </Nothing>
      ) : (
        <>
          <ActivityTable history={history} />
          <Caveat>
            Showing the {history.length} most recent. The log records what happened and who did it;
            it does not record why, so a reason for a change has to be asked for.
          </Caveat>
        </>
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
