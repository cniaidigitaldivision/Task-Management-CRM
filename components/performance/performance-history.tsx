'use client';

import * as React from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';

import {
  periodNoteAction,
  respondToAssessmentAction,
  saveAssessmentAction,
  setAssessmentStateAction,
} from '@/app/actions/performance';
import { Nothing, Panel } from '@/components/performance/performance-ui';
import type { PeriodNote } from '@/lib/ai/narrative';
import type { Assessment, BucketRow, PeriodRow } from '@/lib/db/queries/performance';
import { dayWord } from '@/lib/view/activity';

/* ============================================================================
 * PERFORMANCE HISTORY — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * Six panels: the chart, the written note beside it, the table of periods, the
 * assessment written about one period, the follow-up agreed in it, and who can
 * see it.
 *
 * ── ⚠️ "REVIEWED", NOT "VERIFIED" ─────────────────────────────────────────
 * The reference is labelled "Weekly delivery and verification" with a "Verified
 * (tasks)" series. The owner removed that word from this product on the same
 * day: *"There is no term you can say 'verified' ... you can say in the review
 * how many tasks are in a review and how many tasks are done. Definitely the
 * person who assigns the task will review that task."* So the series counts
 * tasks somebody OTHER than the doer closed or sent back, and it is called
 * Reviewed.
 *
 * ⚠️ AND IT WILL READ ZERO, WHICH IS THE POINT. Measured across 1,251 live
 * tasks: 61 were ever put into review, 0 were ever sent back. The chart says so
 * in words underneath rather than leaving a manager to wonder whether the bar
 * is missing or the number is.
 *
 * ── ⚠️ THE BOTTOM THREE PANELS ARE THE ONLY WRITTEN THING ON THIS PAGE ────
 * Everything else in /performance is derived from tasks and the log. An
 * assessment is two people's words, so migration 253 stores it, and the rule
 * the reference states in its own "Review visibility" card is enforced in the
 * database: a draft is invisible to its subject, a published review is theirs
 * to read and to answer, and nobody assesses themselves.
 * ========================================================================= */

type Grain = 'week' | 'month';

const num = (n: number) => n.toLocaleString('en-GB');

const periodLabel = (p: PeriodRow) =>
  p.bucket.includes('W') ? `W${p.bucket.split('W')[1]}` : (dayWord(`${p.bucket}-01`) ?? p.bucket);

const periodSpan = (p: PeriodRow) => `${dayWord(p.startsOn)} – ${dayWord(p.endsOn)}`;

const STATE_LOOK: Record<string, { label: string; ink: string; bg: string }> = {
  draft: { label: 'Draft', ink: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)' },
  reviewed: { label: 'Reviewed', ink: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
  published: { label: 'Published', ink: 'var(--pf-teal)', bg: 'var(--pf-mint)' },
};

const NOT_ASSESSED = { label: 'Not assessed', ink: 'var(--pf-soft)', bg: 'var(--pf-strip)' };

/* ── The tab ─────────────────────────────────────────────────────────────── */

export function PerformanceHistory({
  person,
  viewer,
  periods,
  assessments,
  onTab,
}: {
  person: { id: string; name: string };
  viewer: { id: string; name: string };
  periods: readonly PeriodRow[];
  assessments: readonly Assessment[];
  weekly: readonly BucketRow[];
  monthly: readonly BucketRow[];
  onTab: (tab: 'tasks' | 'activity') => void;
}) {
  const [grain, setGrain] = React.useState<Grain>('week');
  const [rows, setRows] = React.useState<readonly PeriodRow[]>(periods);
  const [records, setRecords] = React.useState<readonly Assessment[]>(assessments);
  const [pickedStart, setPickedStart] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const recordRef = React.useRef<HTMLDivElement>(null);

  /* ⚠️ THE CLICK HAS TO CHANGE SOMETHING THE READER CAN SEE. Owner, 2026-09-25:
     *"when I click on the Write option it's not working."* It was selecting the
     period correctly — and the three cards it fills sit below the fold on a
     table six rows long, so from the reader's chair nothing happened at all.
     Selecting and scrolling are one action, not two. */
  const pick = (row: PeriodRow) => {
    setPickedStart(row.startsOn);
    recordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ⚠️ THE SERVER'S ANSWER WINS WHEN IT ARRIVES, and until then the page keeps
     what it has. Blanking a table somebody is reading to show a spinner is the
     thing Rule Zero forbids most plainly. */
  const changeGrain = (next: Grain) => {
    if (next === grain) return;
    setGrain(next);
    setLoading(true);
    void import('@/app/actions/performance').then(({ performanceHistoryAction }) =>
      performanceHistoryAction(person.id, next).then((r) => {
        setLoading(false);
        if (r.ok && r.periods) {
          setRows(r.periods);
          setPickedStart(null);
        }
        if (r.ok && r.assessments) setRecords(r.assessments);
      }),
    );
  };

  /* Derived, never synchronised: the newest period is the one in hand until
     somebody picks another. */
  const picked = rows.find((r) => r.startsOn === pickedStart) ?? rows[rows.length - 1] ?? null;
  const record = picked
    ? (records.find((a) => a.periodStart === picked.startsOn && a.periodEnd === picked.endsOn) ??
      null)
    : null;

  /* ⚠️ AN ADMIN WHO PICKS THEMSELVES IS A SUBJECT, NOT A REVIEWER. */
  const isSelf = viewer.id === person.id;

  return (
    <div className="space-y-[1.25rem]">
      <div className="grid items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DeliveryChart rows={rows} grain={grain} onGrain={changeGrain} loading={loading} />
        <ChangeNote person={person} grain={grain} onTab={onTab} />
      </div>

      <PeriodTable
        rows={rows}
        picked={picked}
        records={records}
        onPick={pick}
      />

      {picked && (
        /* ⚠️ `key` ON EACH CARD, NOT JUST A COMMENT SAYING SO. Without it the
           form state is created once and never again: picking a second period
           left the first period's words sitting under the second period's
           heading, and an empty period looked as though the button had done
           nothing. The comment inside AssessmentCard claimed this was keyed
           before it was. */
        <div
          ref={recordRef}
          className="grid scroll-mt-[1.5rem] items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,0.8fr)]"
        >
          <AssessmentCard
            key={`a-${picked.startsOn}-${record?.id ?? 'new'}`}
            person={person}
            viewer={viewer}
            period={picked}
            record={record}
            isSelf={isSelf}
            onSaved={setRecords}
            onTab={onTab}
          />
          <FollowUpCard
            key={`f-${picked.startsOn}-${record?.id ?? 'new'}`}
            person={person}
            period={picked}
            record={record}
            isSelf={isSelf}
            onSaved={setRecords}
          />
          <VisibilityCard person={person} record={record} records={records} />
        </div>
      )}
    </div>
  );
}

/* ── 1 · The chart ───────────────────────────────────────────────────────── */

function DeliveryChart({
  rows,
  grain,
  onGrain,
  loading,
}: {
  rows: readonly PeriodRow[];
  grain: Grain;
  onGrain: (g: Grain) => void;
  loading: boolean;
}) {
  /* ⚠️ THE AXIS IS ROUNDED UP TO A READABLE STEP, not set to the tallest bar.
     A top gridline of 18 makes every other bar a fraction nobody can read off. */
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.completed, r.reviewed)));
  const step = peak <= 5 ? 1 : peak <= 25 ? 5 : peak <= 60 ? 10 : peak <= 150 ? 25 : 50;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => top - i * step);
  const everReviewed = rows.reduce((n, r) => n + r.reviewed, 0);

  return (
    <Panel
      title={`${grain === 'week' ? 'Weekly' : 'Monthly'} delivery and review`}
      description="Each period counts independently. Times are in PKT."
      action={
        <div className="flex items-center gap-[0.9rem]">
          <span className="hidden items-center gap-[0.75rem] sm:flex">
            <Key colour="var(--pf-teal)" label="Completed" />
            <Key colour="var(--pf-mint)" label="Reviewed" />
          </span>
          <span
            className="inline-flex rounded-[0.7rem] border p-[0.2rem]"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)' }}
          >
            {(['week', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGrain(g)}
                aria-pressed={grain === g}
                className="rounded-[0.5rem] px-[0.85rem] py-[0.45rem] text-[0.8rem] font-semibold capitalize leading-none"
                style={{
                  background: grain === g ? 'var(--pf-mint)' : 'transparent',
                  color: grain === g ? 'var(--pf-teal)' : 'var(--pf-soft)',
                }}
              >
                {g}
              </button>
            ))}
          </span>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Nothing>No period has been recorded for this person yet.</Nothing>
      ) : (
        <div
          className="border-t px-[1.22rem] pb-[1rem] pt-[1.1rem]"
          style={{ borderColor: 'var(--pf-grid)', opacity: loading ? 0.55 : 1 }}
          aria-busy={loading}
        >
          <div className="flex gap-[0.6rem]">
            {/* The axis */}
            <div
              className="flex w-[2.2rem] shrink-0 flex-col justify-between py-[0.45rem] text-right text-[0.72rem] tabular-nums"
              style={{ color: 'var(--pf-mute)', height: '13.5rem' }}
              aria-hidden="true"
            >
              {ticks.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <div
                className="relative flex items-end gap-[0.5rem]"
                style={{ height: '13.5rem' }}
                role="img"
                aria-label={`Tasks completed and reviewed in each ${grain}`}
              >
                {/* gridlines */}
                {ticks.map((t, i) => (
                  <span
                    key={t}
                    aria-hidden="true"
                    className="absolute left-0 right-0 h-px"
                    style={{
                      background: 'var(--pf-grid)',
                      top: `${(i / (ticks.length - 1)) * 100}%`,
                    }}
                  />
                ))}

                {rows.map((r) => (
                  /* ⚠️ h-full ON THE GROUP TOO. The row is `items-end`, so each
                     group is content-height by default — and the bar inside it
                     asks for a PERCENTAGE of its parent, which then resolved
                     against the height of a label. Every bar rendered as
                     nothing while the numbers above them were right. */
                  <span
                    key={r.bucket}
                    className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-[0.28rem]"
                  >
                    <Bar value={r.completed} top={top} colour="var(--pf-teal)" title={`${num(r.completed)} completed`} />
                    <Bar value={r.reviewed} top={top} colour="var(--pf-mint)" title={`${num(r.reviewed)} reviewed`} />
                  </span>
                ))}
              </div>

              <div className="mt-[0.45rem] flex gap-[0.5rem] border-t pt-[0.5rem]" style={{ borderColor: 'var(--pf-line)' }}>
                {rows.map((r) => (
                  <span key={r.bucket} className="min-w-0 flex-1 text-center">
                    <span className="block truncate text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                      {periodLabel(r)}
                    </span>
                    <span className="block truncate text-[0.7rem]" style={{ color: 'var(--pf-mute)' }}>
                      {periodSpan(r)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ⚠️ A ZERO SERIES EXPLAINS ITSELF. Otherwise the light bars read as
              a rendering fault rather than as the finding they are. */}
          {everReviewed === 0 && (
            <p className="mt-[0.9rem] text-[0.82rem] leading-[1.5]" style={{ color: 'var(--pf-soft)' }}>
              The Reviewed series is zero across every period. A task counts as reviewed when
              somebody other than the person doing it closed it or sent it back — on this record,
              nobody has. That is a fact about how work is being signed off, not about the work.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Bar({ value, top, colour, title }: { value: number; top: number; colour: string; title: string }) {
  const pct = top > 0 ? (value / top) * 100 : 0;
  return (
    <span className="relative flex h-full w-full max-w-[2.1rem] flex-col justify-end" title={title}>
      <span
        className="mb-[0.2rem] text-center text-[0.74rem] font-semibold tabular-nums"
        style={{ color: value > 0 ? 'var(--pf-ink)' : 'var(--pf-mute)' }}
      >
        {num(value)}
      </span>
      <span
        className="w-full rounded-t-[0.2rem]"
        style={{
          height: `${pct}%`,
          background: colour,
          /* A zero still draws a hairline, so the reader sees the bar is there
             and is zero, rather than seeing nothing at all. */
          minHeight: value === 0 ? '2px' : undefined,
          opacity: value === 0 ? 0.45 : 1,
        }}
      />
    </span>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[0.35rem] text-[0.78rem]" style={{ color: 'var(--pf-soft)' }}>
      <span aria-hidden="true" className="size-[0.6rem] rounded-[0.15rem]" style={{ background: colour }} />
      {label} (tasks)
    </span>
  );
}

/* ── 2 · What changed ────────────────────────────────────────────────────── */

function ChangeNote({
  person,
  grain,
  onTab,
}: {
  person: { id: string; name: string };
  grain: Grain;
  onTab: (tab: 'tasks' | 'activity') => void;
}) {
  const [state, setState] = React.useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'done'; note: PeriodNote } | { kind: 'failed'; error: string }
  >({ kind: 'idle' });

  const ask = () => {
    setState({ kind: 'asking' });
    void periodNoteAction(person.id, grain).then((r) =>
      setState(
        r.ok && r.note
          ? { kind: 'done', note: r.note }
          : { kind: 'failed', error: r.error ?? 'The note could not be written.' },
      ),
    );
  };

  return (
    <Panel
      title="What changed"
      description="Read from the periods beside it. Nothing in this system records why."
    >
      <div className="border-t px-[1.22rem] py-[1.05rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        {state.kind === 'done' ? (
          <>
            <p className="text-[0.95rem] font-bold leading-[1.4]" style={{ color: 'var(--pf-ink)' }}>
              {state.note.headline}
            </p>
            {state.note.changes.map((line, i) => (
              <p key={i} className="mt-[0.55rem] text-[0.86rem] leading-[1.55]" style={{ color: 'var(--pf-body)' }}>
                {line}
              </p>
            ))}
            {state.note.toCheck.length > 0 && (
              <>
                <p className="mt-[0.9rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
                  Worth checking — not stated as the cause
                </p>
                <ul className="mt-[0.3rem] space-y-[0.3rem]">
                  {state.note.toCheck.map((line, i) => (
                    <li key={i} className="flex gap-[0.5rem] text-[0.84rem]" style={{ color: 'var(--pf-body)' }}>
                      <span aria-hidden="true" style={{ color: 'var(--pf-amber)' }}>
                        •
                      </span>
                      <span className="min-w-0 flex-1">{line}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {state.note.unverifiedFigures.length > 0 && (
              <p className="mt-[0.8rem] text-[0.8rem]" style={{ color: 'var(--pf-amber)' }}>
                These figures are not in the periods the model was given, so do not rely on them:{' '}
                {state.note.unverifiedFigures.join(', ')}.
              </p>
            )}
            <p className="mt-[0.7rem] text-[0.76rem]" style={{ color: 'var(--pf-mute)' }}>
              Written by {state.note.model} from the figures above.
            </p>
          </>
        ) : (
          <p className="text-[0.86rem] leading-[1.55]" style={{ color: 'var(--pf-soft)' }}>
            {state.kind === 'failed'
              ? state.error
              : `A short note on what moved between these ${grain}s, written from the counts beside it. It will not offer a reason — the record does not hold one.`}
          </p>
        )}

        <button
          type="button"
          onClick={ask}
          disabled={state.kind === 'asking'}
          className="mt-[0.95rem] flex w-full items-center justify-center gap-[0.5rem] rounded-[0.75rem] px-[1rem] py-[0.7rem] text-[0.87rem] font-semibold leading-none disabled:opacity-60"
          style={{ background: 'var(--pf-violet)', color: 'var(--pf-on-solid)' }}
        >
          {state.kind === 'asking' ? (
            <Loader2 className="size-[1rem] animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-[1rem]" aria-hidden="true" />
          )}
          {state.kind === 'asking' ? 'Reading the periods…' : state.kind === 'done' ? 'Write it again' : 'Describe what changed'}
        </button>

        <div className="mt-[0.7rem] flex flex-wrap gap-[0.5rem]">
          <Secondary icon={FileText} onClick={() => onTab('tasks')}>
            View the work
          </Secondary>
          <Secondary icon={CalendarDays} onClick={() => onTab('activity')}>
            Inspect date changes
          </Secondary>
        </div>
      </div>
    </Panel>
  );
}

function Secondary({
  icon: Icon,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[0.45rem] rounded-[0.65rem] border px-[0.8rem] py-[0.55rem] text-[0.82rem] font-semibold leading-none"
      style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
    >
      <Icon className="size-[0.9rem]" aria-hidden="true" />
      {children}
    </button>
  );
}

/* ── 3 · The table ───────────────────────────────────────────────────────── */

function PeriodTable({
  rows,
  picked,
  records,
  onPick,
}: {
  rows: readonly PeriodRow[];
  picked: PeriodRow | null;
  records: readonly Assessment[];
  onPick: (row: PeriodRow) => void;
}) {
  return (
    <Panel
      title="Historical performance by period"
      description="Each period counts independently — these are not running totals."
    >
      {rows.length === 0 ? (
        <Nothing>No period has been recorded for this person yet.</Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] table-fixed border-collapse">
            <thead>
              <tr
                className="whitespace-nowrap border-y text-[0.76rem]"
                style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
              >
                <th className="w-[15rem] py-[0.72rem] pl-[1.22rem] text-left font-medium">Period</th>
                <th className="py-[0.72rem] text-right font-medium">Completed</th>
                <th className="py-[0.72rem] text-right font-medium">Reviewed</th>
                <th className="py-[0.72rem] text-right font-medium">On-time completed</th>
                <th className="py-[0.72rem] text-right font-medium">Overdue at cutoff</th>
                <th className="w-[9rem] py-[0.72rem] pl-[1.5rem] text-left font-medium">Assessment</th>
                <th className="w-[9.5rem] py-[0.72rem] pr-[1.22rem] text-right font-medium">Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = picked?.startsOn === r.startsOn;
                const state = records.find(
                  (a) => a.periodStart === r.startsOn && a.periodEnd === r.endsOn,
                )?.state;
                const look = state ? STATE_LOOK[state] : NOT_ASSESSED;
                return (
                  <tr
                    key={r.bucket}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, a')) return;
                      onPick(r);
                    }}
                    aria-selected={on}
                    className="cursor-pointer border-b last:border-0"
                    style={{
                      borderColor: 'var(--pf-grid)',
                      height: '3.1rem',
                      background: on ? 'var(--pf-mint)' : undefined,
                      boxShadow: on ? 'inset 3px 0 0 0 var(--pf-teal)' : undefined,
                    }}
                  >
                    <td className="pl-[1.22rem] pr-[0.6rem] text-[0.86rem]" style={{ color: 'var(--pf-ink)' }}>
                      <span className="font-semibold">{periodLabel(r)}</span>
                      <span className="ml-[0.4rem] text-[0.78rem]" style={{ color: 'var(--pf-mute)' }}>
                        {periodSpan(r)}
                      </span>
                    </td>
                    <td className="pr-[0.6rem] text-right text-[0.88rem] tabular-nums" style={{ color: 'var(--pf-ink)' }}>
                      {num(r.completed)}
                    </td>
                    <td
                      className="pr-[0.6rem] text-right text-[0.88rem] tabular-nums"
                      style={{ color: r.reviewed > 0 ? 'var(--pf-ink)' : 'var(--pf-mute)' }}
                    >
                      {num(r.reviewed)}
                    </td>
                    {/* ⚠️ "15 / 18", NOT "83%". The denominator is completed tasks
                        that HAD a due date; a bare percentage hides that a period
                        with two dated tasks is not comparable to one with fifty. */}
                    <td className="pr-[0.6rem] text-right text-[0.88rem] tabular-nums" style={{ color: 'var(--pf-ink)' }}>
                      {r.judged > 0 ? `${num(r.onTime)} / ${num(r.judged)}` : '—'}
                    </td>
                    <td
                      className="pr-[0.6rem] text-right text-[0.88rem] font-semibold tabular-nums"
                      style={{ color: r.overdueAtCutoff > 0 ? 'var(--pf-red-ink)' : 'var(--pf-mute)' }}
                    >
                      {num(r.overdueAtCutoff)}
                    </td>
                    <td className="pl-[1.5rem] pr-[0.6rem]">
                      <span
                        className="inline-block rounded-full px-[0.65rem] py-[0.25rem] text-[0.76rem] font-semibold"
                        style={{ background: look.bg, color: look.ink }}
                      >
                        {look.label}
                      </span>
                    </td>
                    <td className="pr-[1.22rem] text-right">
                      {/* ⚠️ A BUTTON THAT SAYS WHAT IT OPENS. Owner, 2026-09-25:
                          *"I don't know what Write is about ... there should be
                          a Record Write button, not clickable in the same way as
                          the Draft."* "Write" alone read as a column heading; the
                          status beside it is a chip and does nothing. This is the
                          only control in the row, and it is drawn like one. */}
                      <button
                        type="button"
                        onClick={() => onPick(r)}
                        className="inline-flex items-center gap-[0.4rem] rounded-[0.55rem] px-[0.75rem] py-[0.45rem] text-[0.79rem] font-semibold leading-none"
                        style={
                          state
                            ? {
                                background: 'var(--pf-surface)',
                                border: '1px solid var(--pf-field-line)',
                                color: 'var(--pf-ink)',
                              }
                            : { background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }
                        }
                      >
                        <FileText className="size-[0.85rem]" aria-hidden="true" />
                        {state ? 'Open record' : 'Write record'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── 4 · The assessment ──────────────────────────────────────────────────── */

function AssessmentCard({
  person,
  viewer,
  period,
  record,
  isSelf,
  onSaved,
  onTab,
}: {
  person: { id: string; name: string };
  viewer: { id: string; name: string };
  period: PeriodRow;
  record: Assessment | null;
  isSelf: boolean;
  onSaved: (rows: readonly Assessment[]) => void;
  onTab: (tab: 'tasks' | 'activity') => void;
}) {
  /* ⚠️ KEYED BY THE PERIOD, SO PICKING ANOTHER ROW RESETS THE FORM. Copying
     the record into state with an effect is the cascading render the lint rule
     refuses, and it would show one period's words over another's heading. */
  const [strengths, setStrengths] = React.useState(record?.strengths ?? '');
  const [improve, setImprove] = React.useState(record?.improvementAreas ?? '');
  const [response, setResponse] = React.useState(record?.employeeResponse ?? '');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const state = record?.state ?? null;
  const look = state ? STATE_LOOK[state] : NOT_ASSESSED;
  const canWrite = !isSelf;
  const canAnswer = isSelf && state === 'published';

  const run = (what: string, call: () => Promise<{ ok: boolean; error?: string; assessments?: readonly Assessment[] }>) => {
    setBusy(what);
    setError(null);
    void call().then((r) => {
      setBusy(null);
      if (!r.ok) {
        setError(r.error ?? 'That could not be saved.');
        return;
      }
      if (r.assessments) onSaved(r.assessments);
    });
  };

  const save = () =>
    run('save', () =>
      saveAssessmentAction({
        subjectId: person.id,
        periodKind: period.bucket.includes('W') ? 'week' : 'month',
        periodStart: period.startsOn,
        periodEnd: period.endsOn,
        strengths,
        improvementAreas: improve,
        goal: record?.goal ?? '',
        acceptance: record?.acceptance ?? [],
        baseline: record?.baseline ?? '',
        target: record?.target ?? '',
        reviewDate: record?.reviewDate ?? null,
        ownerId: record?.ownerId ?? null,
        support: record?.support ?? '',
      }),
    );

  return (
    <Panel
      title={`Assessment record — ${periodLabel(period)}`}
      description={periodSpan(period)}
      action={
        <span
          className="shrink-0 rounded-full px-[0.7rem] py-[0.3rem] text-[0.78rem] font-semibold"
          style={{ background: look.bg, color: look.ink }}
        >
          {look.label}
        </span>
      }
    >
      <div className="border-t px-[1.22rem] py-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <Row label="Reviewer">
          {record?.reviewerName ?? (canWrite ? `${viewer.name} — on saving` : 'Not assigned')}
        </Row>

        {isSelf && (
          <p
            className="mt-[0.6rem] flex gap-[0.5rem] rounded-[0.7rem] px-[0.8rem] py-[0.6rem] text-[0.82rem] leading-[1.45]"
            style={{ background: 'var(--pf-amber-bg)', color: 'var(--pf-amber)' }}
          >
            <TriangleAlert className="mt-[0.1rem] size-[0.95rem] shrink-0" aria-hidden="true" />
            <span>
              This is your own record, so you cannot write the assessment. Somebody who outranks you
              writes it; you may answer it once it is published.
            </span>
          </p>
        )}

        <Field label="Strengths" hint="Manager assessment">
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            readOnly={!canWrite}
            rows={3}
            placeholder={canWrite ? 'What went well in this period, specifically.' : 'Not written yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        <Field label="Improvement areas" hint="Manager assessment">
          <textarea
            value={improve}
            onChange={(e) => setImprove(e.target.value)}
            readOnly={!canWrite}
            rows={3}
            placeholder={canWrite ? 'What to change, and what that would look like.' : 'Not written yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        {/* ⚠️ THE SUBJECT'S BOX IS THEIRS. A manager sees it and cannot type in
            it — the database refuses the write, so the page should not pretend
            otherwise. */}
        <Field
          label="Employee response"
          hint={canAnswer ? 'Yours to write' : state === 'published' ? 'Theirs to write' : 'Available once published'}
        >
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            readOnly={!canAnswer}
            rows={2}
            placeholder={canAnswer ? 'Your reply to this review.' : 'Not answered yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        <p className="mt-[0.85rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
          Task evidence
        </p>
        <div className="mt-[0.35rem] flex flex-wrap gap-[0.9rem]">
          <Link onClick={() => onTab('tasks')}>
            The {num(period.completed)} task{period.completed === 1 ? '' : 's'} completed in{' '}
            {periodLabel(period)}
          </Link>
          <Link onClick={() => onTab('tasks')}>
            Overdue at cutoff ({num(period.overdueAtCutoff)})
          </Link>
        </div>

        {error && (
          <p className="mt-[0.8rem] text-[0.83rem]" style={{ color: 'var(--pf-red-ink)' }}>
            {error}
          </p>
        )}

        <div className="mt-[1rem] flex flex-wrap gap-[0.5rem]">
          {canWrite && (
            <>
              <Primary onClick={save} busy={busy === 'save'}>
                Save draft
              </Primary>
              {record && state !== 'reviewed' && (
                <Secondary
                  icon={CheckCircle2}
                  onClick={() => run('reviewed', () => setAssessmentStateAction(record.id, 'reviewed', person.id))}
                >
                  Mark reviewed
                </Secondary>
              )}
              {record && state !== 'published' && (
                <Secondary
                  icon={Eye}
                  onClick={() => run('publish', () => setAssessmentStateAction(record.id, 'published', person.id))}
                >
                  Publish to {person.name.split(' ')[0]}
                </Secondary>
              )}
              {record && state === 'published' && (
                <Secondary
                  icon={EyeOff}
                  onClick={() => run('unpublish', () => setAssessmentStateAction(record.id, 'reviewed', person.id))}
                >
                  Take back to private
                </Secondary>
              )}
            </>
          )}
          {canAnswer && record && (
            <Primary
              onClick={() => run('respond', () => respondToAssessmentAction(record.id, response, person.id))}
              busy={busy === 'respond'}
            >
              Save my response
            </Primary>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ── 5 · The follow-up ───────────────────────────────────────────────────── */

function FollowUpCard({
  person,
  period,
  record,
  isSelf,
  onSaved,
}: {
  person: { id: string; name: string };
  period: PeriodRow;
  record: Assessment | null;
  isSelf: boolean;
  onSaved: (rows: readonly Assessment[]) => void;
}) {
  const [goal, setGoal] = React.useState(record?.goal ?? '');
  const [acceptance, setAcceptance] = React.useState((record?.acceptance ?? []).join('\n'));
  const [baseline, setBaseline] = React.useState(record?.baseline ?? '');
  const [target, setTarget] = React.useState(record?.target ?? '');
  const [reviewDate, setReviewDate] = React.useState(record?.reviewDate ?? '');
  const [support, setSupport] = React.useState(record?.support ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canWrite = !isSelf;

  /* The baseline the period itself already proves, offered rather than typed. */
  const measured =
    period.judged > 0
      ? `${num(period.onTime)} of ${num(period.judged)} on time`
      : `${num(period.completed)} completed`;

  const save = () => {
    setBusy(true);
    setError(null);
    void saveAssessmentAction({
      subjectId: person.id,
      periodKind: period.bucket.includes('W') ? 'week' : 'month',
      periodStart: period.startsOn,
      periodEnd: period.endsOn,
      strengths: record?.strengths ?? '',
      improvementAreas: record?.improvementAreas ?? '',
      goal,
      acceptance: acceptance.split('\n'),
      baseline: baseline || measured,
      target,
      reviewDate: reviewDate || null,
      ownerId: person.id,
      support,
    }).then((r) => {
      setBusy(false);
      if (!r.ok) {
        setError(r.error ?? 'That could not be saved.');
        return;
      }
      if (r.assessments) onSaved(r.assessments);
    });
  };

  return (
    <Panel
      title="Agreed follow-up"
      description="What was agreed in this review, and how it will be judged."
      action={<Target className="size-[1.1rem] shrink-0" style={{ color: 'var(--pf-teal)' }} aria-hidden="true" />}
    >
      <div className="border-t px-[1.22rem] py-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <Field label="Goal">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            readOnly={!canWrite}
            rows={2}
            placeholder={canWrite ? 'One thing to improve, in a sentence.' : 'Nothing agreed yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        <Field label="Acceptance checklist" hint="One per line">
          <textarea
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            readOnly={!canWrite}
            rows={3}
            placeholder={canWrite ? 'Maintain at least 80% on-time completion' : 'Nothing agreed yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        <div className="mt-[0.75rem] grid gap-[0.6rem] sm:grid-cols-2">
          <Field label={`Baseline (${periodLabel(period)})`}>
            <input
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              readOnly={!canWrite}
              placeholder={measured}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none read-only:opacity-80"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </Field>
          <Field label="Target">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              readOnly={!canWrite}
              placeholder="≥ 90% on time"
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none read-only:opacity-80"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </Field>
          <Field label="Review date">
            <input
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
              readOnly={!canWrite}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none read-only:opacity-80"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </Field>
          <Field label="Owner">
            {/* ⚠️ NOT A DROPDOWN. The follow-up belongs to the person it is
                about; a picker here would only ever have one right answer. */}
            <p
              className="rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem]"
              style={{ background: 'var(--pf-strip)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            >
              {person.name}
            </p>
          </Field>
        </div>

        <Field label="Support" hint="What the reviewer will do">
          <textarea
            value={support}
            onChange={(e) => setSupport(e.target.value)}
            readOnly={!canWrite}
            rows={2}
            placeholder={canWrite ? 'Regular check-ins and early escalation of risks.' : 'Nothing agreed yet.'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none read-only:opacity-80"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </Field>

        {error && (
          <p className="mt-[0.8rem] text-[0.83rem]" style={{ color: 'var(--pf-red-ink)' }}>
            {error}
          </p>
        )}

        {canWrite && (
          <div className="mt-[1rem]">
            <Primary onClick={save} busy={busy}>
              Save the follow-up
            </Primary>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ── 6 · Who sees it ─────────────────────────────────────────────────────── */

function VisibilityCard({
  person,
  record,
  records,
}: {
  person: { id: string; name: string };
  record: Assessment | null;
  records: readonly Assessment[];
}) {
  const [showAll, setShowAll] = React.useState(false);
  const published = records.filter((a) => a.state === 'published');
  const live = record?.state === 'published';
  const first = person.name.split(' ')[0];

  return (
    <Panel
      title="Review visibility"
      description="The rule the database enforces, not a description of it."
      action={<Lock className="size-[1.05rem] shrink-0" style={{ color: 'var(--pf-teal)' }} aria-hidden="true" />}
    >
      <div className="border-t px-[1.22rem] py-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <State
          on={live}
          icon={Eye}
          title="Published — the employee sees it"
          body={`Visible to ${first}, who may write a response and may not change a word of the assessment.`}
          tone="var(--pf-green)"
          bg="var(--pf-green-bg)"
        />
        <State
          on={!live}
          icon={Lock}
          title="Private — admins and reviewers only"
          body={`${first} cannot see this record at all until it is published. The row is not hidden in the page; it is refused by the database.`}
          tone="var(--pf-soft)"
          bg="var(--pf-strip)"
        />

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-[0.9rem] w-full rounded-[0.7rem] border px-[0.9rem] py-[0.6rem] text-[0.83rem] font-semibold leading-none"
          style={{ background: 'var(--pf-mint)', borderColor: 'var(--pf-mint-line)', color: 'var(--pf-teal)' }}
        >
          {showAll ? 'Hide published reviews' : `Published reviews (${num(published.length)})`}
        </button>

        {showAll && (
          <ul className="mt-[0.6rem] space-y-[0.4rem]">
            {published.length === 0 && (
              <li className="text-[0.82rem]" style={{ color: 'var(--pf-mute)' }}>
                None has been published to {first} yet.
              </li>
            )}
            {published.map((a) => (
              <li key={a.id} className="text-[0.82rem]" style={{ color: 'var(--pf-body)' }}>
                {dayWord(a.periodStart)} – {dayWord(a.periodEnd)}
                <span style={{ color: 'var(--pf-mute)' }}>
                  {' · '}
                  {a.reviewerName ?? 'Reviewer not recorded'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-[0.9rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
          Last change to this record
        </p>
        <p className="text-[0.82rem]" style={{ color: 'var(--pf-soft)' }}>
          {record
            ? `${dayWord(record.updatedAt.slice(0, 10))}${record.publishedAt ? `, published ${dayWord(record.publishedAt.slice(0, 10))}` : ''}`
            : 'Nothing has been written for this period.'}
        </p>
      </div>
    </Panel>
  );
}

function State({
  on,
  icon: Icon,
  title,
  body,
  tone,
  bg,
}: {
  on: boolean;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  body: string;
  tone: string;
  bg: string;
}) {
  return (
    <div
      className="mb-[0.55rem] flex gap-[0.6rem] rounded-[0.7rem] px-[0.8rem] py-[0.7rem] last:mb-0"
      style={{ background: on ? bg : 'transparent', opacity: on ? 1 : 0.55 }}
    >
      <Icon className="mt-[0.1rem] size-[1rem] shrink-0" style={{ color: tone }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.84rem] font-semibold leading-[1.35]" style={{ color: 'var(--pf-ink)' }}>
          {title}
        </span>
        <span className="mt-[0.15rem] block text-[0.79rem] leading-[1.45]" style={{ color: 'var(--pf-soft)' }}>
          {body}
        </span>
      </span>
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-[0.8rem] text-[0.85rem]">
      <span className="w-[5.5rem] shrink-0" style={{ color: 'var(--pf-soft)' }}>
        {label}
      </span>
      <span className="min-w-0 flex-1" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </span>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-[0.75rem] block">
      <span className="mb-[0.3rem] flex flex-wrap items-baseline gap-[0.4rem]">
        <span className="text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
          {label}
        </span>
        {hint && (
          <span className="text-[0.75rem]" style={{ color: 'var(--pf-mute)' }}>
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-[0.83rem] underline underline-offset-2"
      style={{ color: 'var(--pf-link)' }}
    >
      {children}
    </button>
  );
}

function Primary({
  onClick,
  busy,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] px-[1rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-60"
      style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
    >
      {busy && <Loader2 className="size-[0.9rem] animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
