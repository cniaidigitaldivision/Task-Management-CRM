'use client';

import * as React from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Loader2,
  Paperclip,
  Send,
  TrendingUp,
} from 'lucide-react';

import { personPerformanceAction } from '@/app/actions/performance';
import { Chip, Figure, Nothing, Panel } from '@/components/performance/performance-ui';
import { Drawer } from '@/components/ui/dialog';
import type { PersonDetail } from '@/lib/db/queries/performance';
import {
  dayAccount,
  deadlineMoves,
  isSlip,
  onTime,
  qualityOfWork,
  rate,
  trend,
  type Move,
} from '@/lib/domain/performance';

/* ============================================================================
 * ONE PERSON, IN FULL — the thing the owner asked for most plainly
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"I want to know or see a single person's performance: his
 * whole history, what he has done today and yesterday, how his performance is
 * going, what things they are doing … every chitta-batta."*
 *
 * ── ⚠️ EVERY FIGURE HERE IS DERIVED FROM ROWS, AND SAYS SO ────────────────
 * Where the evidence does not exist, the panel says what is missing rather than
 * drawing a zero. On a page about somebody's work the difference between "none"
 * and "not recorded" is the difference between a fair judgement and an unfair
 * one.
 * ========================================================================= */

export function PersonDrawer({
  person,
  period,
  today,
  onClose,
}: {
  person: { id: string; name: string; roleTitle: string | null; avatarUrl: string | null } | null;
  period: { from: string; to: string };
  today: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<PersonDetail | null>(null);
  const [previous, setPrevious] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);

  /* Cleared during render when the person changes — setting it in the effect
     body is the cascading render the lint rule exists to stop. */
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  if (person && loadedFor !== person.id) {
    setLoadedFor(person.id);
    setDetail(null);
    setError(null);
  }

  React.useEffect(() => {
    if (!person) return;
    let cancelled = false;
    void personPerformanceAction(person.id, period).then((r) => {
      if (cancelled) return;
      if (!r.ok) setError(r.error ?? 'That record could not be read.');
      else {
        setDetail(r.detail ?? null);
        setPrevious(r.previousCompleted ?? 0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [person, period]);

  if (!person) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={person.name}
      subtitle={person.roleTitle ?? undefined}
    >
      {!detail && !error && (
        <p className="flex items-center gap-2 px-1 py-6 text-caption text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading {person.name.split(' ')[0]}’s record…
        </p>
      )}
      {error && <p className="px-1 py-6 text-caption text-feedback-error">{error}</p>}
      {detail && <PersonBody detail={detail} previous={previous} today={today} name={person.name} />}
    </Drawer>
  );
}

function PersonBody({
  detail,
  previous,
  today,
  name,
}: {
  detail: PersonDetail;
  previous: number;
  today: string;
  name: string;
}) {
  const first = name.split(' ')[0];

  /* ── ⚠️ ONLY THE TASKS ON SCREEN, AND THAT IS NOT A DETAIL ───────────────
     `detail.moves` covers every task this person has ever held, because the
     quality rules need a task's WHOLE history to tell a first pass from a
     resubmission. Totalling it as-is put "1 of 215" under "went through review"
     on a panel whose next figure said "Completed 48" — two denominators from
     two different periods, side by side, on a page somebody is judged by.

     So the moves are narrowed to the tasks this period is actually showing. */
  const inPeriod = React.useMemo(() => new Set(detail.tasks.map((t) => t.id)), [detail.tasks]);
  const byTask = React.useMemo(() => {
    const m = new Map<string, Move[]>();
    for (const x of detail.moves) {
      if (!inPeriod.has(x.taskId)) continue;
      const list = m.get(x.taskId) ?? [];
      list.push(x);
      m.set(x.taskId, list);
    }
    return m;
  }, [detail.moves, inPeriod]);

  const quality = React.useMemo(() => qualityOfWork(byTask), [byTask]);
  const timing = React.useMemo(() => onTime(detail.tasks), [detail.tasks]);
  const moves = React.useMemo(
    () =>
      deadlineMoves(
        detail.history.map((h) => ({
          taskId: h.taskId ?? '',
          action: h.action,
          actorId: null,
          at: h.at,
          before: h.before,
          after: h.after,
        })),
      ),
    [detail.history],
  );
  const slips = moves.filter(isSlip).length;

  const dayTasks = detail.tasks.map((t) => ({
    dueDate: t.dueDate,
    status: t.status,
    completedOn: t.completedOn,
    createdOn: t.createdOn,
    assignedOn: null,
  }));
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const dToday = dayAccount(dayTasks, today);
  const dYesterday = dayAccount(dayTasks, yesterday);

  const completed = detail.tasks.filter((t) => t.status === 'done').length;
  const t = trend(completed, previous);
  const otRate = rate(timing.onTime, timing.judged);
  const firstPassRate = rate(quality.firstPass, quality.reviewed);

  return (
    <div className="space-y-3">
      {/* ── The day, and the day before it ───────────────────────────────── */}
      <Panel title="Today and yesterday" description="What was planned, what landed, what is left.">
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          {(
            [
              ['Today', dToday],
              ['Yesterday', dYesterday],
            ] as const
          ).map(([label, d]) => (
            <div key={label} className="rounded-lg border border-border-subtle px-3 py-2.5">
              <p className="text-micro font-semibold text-text-secondary">{label}</p>
              <dl className="mt-1.5 space-y-1 text-caption">
                <Row k="Planned" v={d.planned} />
                <Row k="Arrived that day" v={d.unexpected} />
                <Row k="Finished" v={d.completed} tone={d.completed > 0 ? 'green' : undefined} />
                <Row k="Still open" v={d.unfinished} tone={d.unfinished > 0 ? 'amber' : undefined} />
                <Row k="Carried over" v={d.carriedForward} tone={d.carriedForward > 0 ? 'red' : undefined} />
              </dl>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── How the work went ────────────────────────────────────────────── */}
      <Panel title="How the work went" description="Measured over the period on screen.">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 pb-4 text-caption sm:grid-cols-3">
          <Stat label="Completed" value={String(completed)} />
          <Stat
            label="On time"
            node={<Figure value={otRate.value} suffix="%" of={otRate.of} whenEmpty="No deadline to judge" />}
          />
          <Stat
            label="Change on last period"
            node={
              t.changePct === null ? (
                <span className="text-caption text-text-tertiary">Nothing to compare</span>
              ) : (
                <span className="tabular-nums" style={{ color: t.changePct >= 0 ? 'var(--feedback-success)' : 'var(--feedback-error)' }}>
                  {t.changePct >= 0 ? '+' : ''}
                  {t.changePct}%
                </span>
              )
            }
          />
          <Stat label="Went through review" value={`${quality.reviewed} of ${quality.completed}`} />
          <Stat
            label="Approved first time"
            node={
              <Figure
                value={firstPassRate.value}
                suffix="%"
                of={firstPassRate.of}
                whenEmpty="No review recorded"
              />
            }
          />
          <Stat label="Sent back / reopened" value={`${quality.sentBack} / ${quality.reopened}`} />
          <Stat label="Deadlines moved" value={`${moves.length}${slips ? ` · ${slips} later` : ''}`} />
          <Stat label="Days present" value={String(detail.daysPresent)} />
          <Stat label="Recorded actions" value={String(detail.history.length)} />
        </div>
        {quality.reviewed === 0 && (
          <Nothing>
            No task of {first}’s went through review in this period, so first-pass approval cannot be
            measured. Since 8 September the person doing the work may close it themselves — that is a
            choice, not a gap in their work.
          </Nothing>
        )}
      </Panel>

      {/* ── What they are actually carrying ──────────────────────────────── */}
      <Panel title="Their work" description="Open first, then what closed in the period.">
        {detail.tasks.length === 0 ? (
          <Nothing>No task in this period is assigned to {first}.</Nothing>
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {detail.tasks.slice(0, 40).map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="font-mono text-micro font-semibold text-text-brand">{task.reference}</span>
                <span className="min-w-0 flex-1 truncate text-caption text-text-primary">{task.title}</span>
                <span className="truncate text-micro text-text-secondary">{task.projectName}</span>
                {task.attachments > 0 && (
                  <span className="inline-flex items-center gap-1 text-micro text-text-tertiary">
                    <Paperclip className="size-3" aria-hidden="true" />
                    {task.attachments}
                  </span>
                )}
                {task.placements > 0 && (
                  <span className="inline-flex items-center gap-1 text-micro text-text-tertiary">
                    <Send className="size-3" aria-hidden="true" />
                    {task.placements}
                  </span>
                )}
                <StatusChip status={task.status} />
                <span className="w-20 shrink-0 text-right text-micro text-text-secondary">
                  {task.dueDate ?? 'No date'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {detail.tasks.length > 40 && (
          <Nothing>Showing the first 40 of {detail.tasks.length}.</Nothing>
        )}
      </Panel>

      {/* ── The history ──────────────────────────────────────────────────── */}
      <Panel
        title="Everything they did"
        description="Every recorded action, newest first — the evidence behind the figures above."
      >
        {detail.history.length === 0 ? (
          <Nothing>
            Nothing is recorded for {first} in this period. The log holds status changes, edits,
            attachments and published links from 6 August onwards.
          </Nothing>
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {detail.history.slice(0, 60).map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex items-start gap-2.5 px-4 py-2">
                <ActionIcon action={h.action} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption text-text-primary">{h.summary || h.action}</span>
                  <span className="block truncate text-micro text-text-secondary">
                    {h.projectName ?? '—'}
                    {dueChange(h.before, h.after)}
                  </span>
                </span>
                <span className="shrink-0 text-micro text-text-tertiary">{when(h.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.history.length > 60 && <Nothing>Showing the 60 most recent of {detail.history.length}.</Nothing>}
      </Panel>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: number; tone?: 'green' | 'amber' | 'red' }) {
  const colour =
    tone === 'green'
      ? 'var(--feedback-success)'
      : tone === 'amber'
        ? 'var(--feedback-warning)'
        : tone === 'red'
          ? 'var(--feedback-error)'
          : undefined;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-text-secondary">{k}</dt>
      <dd className="tabular-nums font-medium" style={colour ? { color: colour } : undefined}>
        {v}
      </dd>
    </div>
  );
}

function Stat({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-micro text-text-secondary">{label}</p>
      <p className="mt-0.5 text-body-sm font-semibold text-text-primary">{node ?? value}</p>
    </div>
  );
}

import type { Tone } from '@/components/performance/performance-ui';

const STATUS_TONE: Record<string, Tone> = {
  done: 'green',
  in_review: 'violet',
  in_progress: 'blue',
  blocked: 'red',
  todo: 'slate',
  backlog: 'slate',
  cancelled: 'slate',
  revisions: 'amber',
};

function StatusChip({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? 'slate'}>{status.replace('_', ' ')}</Chip>;
}

function ActionIcon({ action }: { action: string }) {
  const Icon =
    action === 'done'
      ? CheckCircle2
      : action === 'in_review'
        ? FileText
        : action === 'attachment_added'
          ? Paperclip
          : action === 'task.placement_recorded'
            ? Send
            : action === 'updated'
              ? CalendarClock
              : action === 'created'
                ? TrendingUp
                : action === 'in_progress'
                  ? Clock3
                  : History;
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />;
}

/** "moved the deadline from X to Y", when that is what the edit did. */
function dueChange(before: unknown, after: unknown): string {
  const a = pick(before);
  const b = pick(after);
  if (a === undefined || b === undefined || a === b) return '';
  return ` · deadline ${a ?? 'none'} → ${b ?? 'none'}`;
}

function pick(blob: unknown): string | null | undefined {
  if (!blob || typeof blob !== 'object') return undefined;
  const v = (blob as Record<string, unknown>).dueDate;
  if (v === undefined) return undefined;
  return v === null ? null : String(v);
}

/** Date and time, in the division's own reading. */
function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
