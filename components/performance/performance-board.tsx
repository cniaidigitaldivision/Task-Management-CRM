'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Sparkles,
  TriangleAlert,
  Trophy,
} from 'lucide-react';

import { performanceInsightAction } from '@/app/actions/performance';
import { PersonDrawer } from '@/components/performance/person-drawer';
import { Chip, Nothing, Panel, StatCard, tint, ink } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { AttentionRow, PersonStat } from '@/lib/db/queries/performance';
import type { Narrative } from '@/lib/ai/narrative';
import { attentionFor, rate, trend } from '@/lib/domain/performance';

/* ============================================================================
 * TEAM PERFORMANCE — the owner's design, 2026-09-23
 * ----------------------------------------------------------------------------
 * *"I want to know or see a single person's performance: his whole history,
 * what he has done today and yesterday, how his performance is going … every
 * chitta-batta."*
 *
 * ── ⚠️ THE REFERENCE SAYS "SAMPLE DATA". THIS PAGE NEVER WILL ─────────────
 * The image the owner sent carries a "Sample data" badge and figures to match.
 * Every figure here is read from the database, and where there is nothing to
 * read the screen says so — see `Figure` and `Nothing` in ./performance-ui.
 * A performance page that rounds a gap up to a number is the one kind of bug
 * that ends up in a conversation about somebody's job.
 *
 * ── RULE ZERO ──────────────────────────────────────────────────────────────
 * One query wave on the server. The period is in the URL because it decides
 * which rows are READ; everything else — the tab, the selection, the drawer —
 * is client state and answers in its own frame. The AI assessment is the one
 * thing that visibly waits, because it is a call to somebody else's computer,
 * and it says so.
 * ========================================================================= */

export type TabKey = 'overview' | 'people' | 'compare' | 'projects' | 'assessments' | 'reports';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'compare', label: 'Compare' },
  { key: 'projects', label: 'Projects & teams' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'reports', label: 'Reports' },
];

export function PerformanceBoard({
  board,
  attention,
  period,
  today,
  nowMs,
  previousCompleted,
  presets,
}: {
  board: readonly PersonStat[];
  attention: readonly AttentionRow[];
  period: { from: string; to: string; label: string; preset: string };
  today: string;
  nowMs: number;
  previousCompleted: number;
  presets: ReadonlyArray<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [, startPeriod] = React.useTransition();
  const [tab, setTab] = React.useState<TabKey>('overview');
  const [openPerson, setOpenPerson] = React.useState<PersonStat | null>(null);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());

  /* ── The four figures, totalled from the rows on screen ────────────────── */
  const totals = React.useMemo(() => {
    const completed = board.reduce((n, p) => n + p.completed, 0);
    const reviewed = board.reduce((n, p) => n + p.reviewed, 0);
    const onTime = board.reduce((n, p) => n + p.onTime, 0);
    const judged = board.reduce((n, p) => n + p.judged, 0);
    const overdue = board.reduce((n, p) => n + p.overdue, 0);
    const awaiting = board.reduce((n, p) => n + p.awaitingReview, 0);
    return { completed, reviewed, onTime, judged, overdue, awaiting };
  }, [board]);

  const otRate = rate(totals.onTime, totals.judged);
  const t = trend(totals.completed, previousCompleted);

  const setPeriod = (preset: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('period', preset);
    startPeriod(() => router.replace(`/performance?${params.toString()}` as Route, { scroll: false }));
  };

  const working = board.filter((p) => p.completed > 0 || p.openNow > 0);

  return (
    <div className="space-y-4">
      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-1 border-b border-border-subtle" role="tablist" aria-label="Performance views">
        {TABS.map((x) => {
          const on = tab === x.key;
          return (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(x.key)}
              className="-mb-px px-3.5 pb-2.5 pt-1 text-body-sm transition-colors"
              style={{
                color: on ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: on ? 600 : 400,
                borderBottomStyle: 'solid',
                borderBottomWidth: '2.5px',
                borderBottomColor: on ? 'var(--accent-primary)' : 'transparent',
              }}
            >
              {x.label}
            </button>
          );
        })}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Period"
          value={period.preset}
          onChange={(event) => setPeriod(event.target.value)}
          options={[...presets]}
          className="w-[11rem]"
        />
        <span className="text-caption text-text-secondary">{period.label}</span>
      </div>

      {tab === 'overview' && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <StatCard
                label="Completed"
                value={String(totals.completed)}
                /* ⚠️ The comparison is stated only when there is one. A period
                   after a week nobody worked has no percentage worth printing —
                   the "+1640%" this codebase already learned from. */
                sub={
                  t.changePct === null
                    ? `${totals.reviewed} reviewed · previous period: ${previousCompleted}`
                    : `${t.changePct >= 0 ? '+' : ''}${t.changePct}% on the previous period (${previousCompleted})`
                }
                tone="green"
                icon={CheckCircle2}
              />
              <StatCard
                label="On-time delivery"
                value={otRate.value === null ? '—' : `${otRate.value}%`}
                sub={
                  otRate.value === null
                    ? 'No completed task had a deadline'
                    : `${totals.onTime} of ${totals.judged} that had a deadline`
                }
                tone="blue"
                icon={Clock3}
              />
              <StatCard
                label="Awaiting review"
                value={String(totals.awaiting)}
                sub={totals.awaiting === 0 ? 'Nothing is waiting on a reviewer' : 'Open and submitted'}
                tone="amber"
                icon={FileText}
              />
              <StatCard
                label="Open overdue"
                value={String(totals.overdue)}
                sub={totals.overdue === 0 ? 'Nothing is past its date' : 'Past their due date now'}
                tone="red"
                icon={AlertCircle}
                alarm={totals.overdue > 0}
              />
            </div>

            <Panel
              title="Team performance"
              description="Select a person to inspect their work."
              action={
                picked.size > 1 ? (
                  <Chip tone="blue">{picked.size} selected</Chip>
                ) : undefined
              }
            >
              {working.length === 0 ? (
                <Nothing>
                  Nobody completed or is carrying work in this period. Widen the period above to see more.
                </Nothing>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem] border-collapse text-caption">
                    <thead>
                      <tr className="border-y border-border-subtle bg-bg-surface-sunken text-micro text-text-secondary">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-2 py-2 text-left font-medium">Person</th>
                        <th className="px-2 py-2 text-right font-medium">Completed</th>
                        <th className="px-2 py-2 text-right font-medium">Reviewed</th>
                        <th className="px-2 py-2 text-right font-medium">On time</th>
                        <th className="px-2 py-2 text-right font-medium">Overdue</th>
                        <th className="px-2 py-2 text-left font-medium">Next action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {working.map((p) => (
                        <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${p.name}`}
                              checked={picked.has(p.id)}
                              onChange={(e) =>
                                setPicked((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(p.id);
                                  else next.delete(p.id);
                                  return next;
                                })
                              }
                              className="size-3.5"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <Avatar name={p.name} src={p.avatarUrl} size="xs" />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-text-primary">{p.name}</span>
                                <span className="block truncate text-micro text-text-secondary">
                                  {p.roleTitle ?? p.role.replace('_', ' ')}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.completed}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-text-secondary">{p.reviewed}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {p.judged === 0 ? (
                              <span className="text-text-tertiary">—</span>
                            ) : (
                              `${p.onTime} of ${p.judged}`
                            )}
                          </td>
                          <td
                            className="px-2 py-2 text-right tabular-nums"
                            style={p.overdue > 0 ? { color: 'var(--feedback-error)' } : undefined}
                          >
                            {p.overdue}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setOpenPerson(p)}
                              className="inline-flex items-center gap-1 font-medium text-text-brand hover:underline"
                            >
                              View work <ArrowRight className="size-3.5" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <AttentionPanel rows={attention} nowMs={nowMs} today={today} />
          </div>

          <InsightPanel period={period} personId={null} />
        </div>
      )}

      {tab === 'people' && (
        <Panel title="People" description="Open anybody to see their whole record.">
          {board.length === 0 ? (
            <Nothing>Nobody is visible to you.</Nothing>
          ) : (
            <ul className="divide-y divide-border-subtle border-t border-border-subtle">
              {board.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpenPerson(p)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover"
                  >
                    <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-text-primary">{p.name}</span>
                      <span className="block truncate text-micro text-text-secondary">
                        {p.roleTitle ?? p.role.replace('_', ' ')}
                      </span>
                    </span>
                    <span className="hidden gap-4 text-caption text-text-secondary sm:flex">
                      <span>
                        <span className="tabular-nums text-text-primary">{p.completed}</span> completed
                      </span>
                      <span>
                        <span className="tabular-nums text-text-primary">{p.openNow}</span> open
                      </span>
                      {p.overdue > 0 && (
                        <span style={{ color: 'var(--feedback-error)' }}>
                          <span className="tabular-nums">{p.overdue}</span> overdue
                        </span>
                      )}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {(tab === 'compare' || tab === 'projects' || tab === 'assessments' || tab === 'reports') && (
        <ComingTab tab={tab} />
      )}

      <PersonDrawer
        person={openPerson}
        period={{ from: period.from, to: period.to }}
        today={today}
        onClose={() => setOpenPerson(null)}
      />
    </div>
  );
}

/* ── Work requiring attention ────────────────────────────────────────────── */

function AttentionPanel({
  rows,
  nowMs,
  today,
}: {
  rows: readonly AttentionRow[];
  nowMs: number;
  today: string;
}) {
  const withReason = rows
    .map((r) => ({ row: r, why: attentionFor(r, nowMs, today) }))
    .filter((x): x is { row: AttentionRow; why: NonNullable<ReturnType<typeof attentionFor>> } => x.why !== null);

  return (
    <Panel title="Work requiring attention" description="What is stuck, and the next step for each.">
      {withReason.length === 0 ? (
        <Nothing>Nothing is blocked, overdue, or waiting on a reviewer right now.</Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-caption">
            <thead>
              <tr className="border-y border-border-subtle bg-bg-surface-sunken text-micro text-text-secondary">
                <th className="px-3 py-2 text-left font-medium">Task</th>
                <th className="px-2 py-2 text-left font-medium">Owner</th>
                <th className="px-2 py-2 text-left font-medium">Issue</th>
                <th className="px-2 py-2 text-left font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {withReason.map(({ row, why }) => (
                <tr key={row.taskId} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-micro font-semibold text-text-brand">{row.reference}</span>
                      <span className="min-w-0 truncate text-text-primary">{row.title}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {row.assigneeName ? (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={row.assigneeName} src={row.assigneeAvatarUrl} size="xs" />
                        <span className="truncate">{row.assigneeName}</span>
                      </span>
                    ) : (
                      <span className="text-text-tertiary">Nobody</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className="inline-flex items-center gap-1.5"
                      style={{
                        color:
                          why.kind === 'blocked' || why.kind === 'overdue'
                            ? 'var(--feedback-error)'
                            : 'var(--feedback-warning)',
                      }}
                    >
                      {why.kind === 'blocked' || why.kind === 'overdue' ? (
                        <AlertCircle className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Clock3 className="size-3.5" aria-hidden="true" />
                      )}
                      {why.text}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-text-secondary">{why.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── The AI assessment ───────────────────────────────────────────────────── */

function InsightPanel({
  period,
  personId,
}: {
  period: { from: string; to: string };
  personId: string | null;
}) {
  const [state, setState] = React.useState<
    { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; narrative: Narrative } | { kind: 'failed'; error: string }
  >({ kind: 'idle' });

  const ask = async () => {
    setState({ kind: 'working' });
    const r = await performanceInsightAction({ from: period.from, to: period.to, personId });
    if (!r.ok || !r.narrative) {
      setState({ kind: 'failed', error: r.error ?? 'The assessment could not be produced.' });
      return;
    }
    setState({ kind: 'done', narrative: r.narrative });
  };

  return (
    <aside
      className="rounded-xl border p-4"
      style={{
        borderColor: 'color-mix(in oklab, var(--accent-primary) 28%, transparent)',
        background: tint('blue', 6),
      }}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0" style={{ color: ink('blue') }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-body-sm font-semibold text-text-primary">Taskly AI · Performance insights</h2>
          <p className="text-micro text-text-secondary">
            Written from the figures on this page. Nothing is decided automatically.
          </p>
        </div>
      </div>

      {state.kind === 'idle' && (
        <>
          <p className="mt-3 text-caption text-text-secondary">
            The assessment reads the same figures you can see — what was completed, what went through
            review, what is late — and says what it means and what to do next.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void ask()}>
            <Sparkles className="size-3.5" aria-hidden="true" /> Write the assessment
          </Button>
        </>
      )}

      {state.kind === 'working' && (
        <p className="mt-3 flex items-center gap-2 text-caption text-text-secondary">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Reading the period and writing it up…
        </p>
      )}

      {state.kind === 'failed' && (
        <>
          <p className="mt-3 text-caption text-feedback-error">{state.error}</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void ask()}>
            Try again
          </Button>
        </>
      )}

      {state.kind === 'done' && <NarrativeBody narrative={state.narrative} onAgain={() => void ask()} />}
    </aside>
  );
}

function NarrativeBody({ narrative, onAgain }: { narrative: Narrative; onAgain: () => void }) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-body-sm font-medium text-text-primary">{narrative.headline}</p>

      {narrative.summary.map((para, i) => (
        <p key={i} className="text-caption text-text-secondary">
          {para}
        </p>
      ))}

      <Section icon={Trophy} tone="green" title="Worth recognising" items={narrative.strengths} />
      <Section icon={TriangleAlert} tone="amber" title="Needs a decision" items={narrative.risks} />
      <Section icon={ArrowRight} tone="blue" title="What to do next" items={narrative.recommendations} />

      {/* ⚠️ THE ENFORCEMENT, SHOWN. `verifyFigures` reads the reply back against
          the fact sheet; a number that was not given to the model is reported
          here rather than trusted. On a page about somebody's work that warning
          matters more than the prose it sits under. */}
      {narrative.unverifiedFigures.length > 0 && (
        <p
          className="rounded-lg px-3 py-2 text-micro"
          style={{ background: tint('red', 10), color: ink('red') }}
        >
          These figures are not from this page and should be ignored:{' '}
          {narrative.unverifiedFigures.join(', ')}.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <span className="text-micro text-text-tertiary">Written by {narrative.model}</span>
        <Button size="sm" variant="ghost" onClick={onAgain}>
          Write it again
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  tone,
  title,
  items,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: 'green' | 'amber' | 'blue';
  title: string;
  items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: tint(tone, 10) }}>
      <p className="flex items-center gap-1.5 text-micro font-semibold" style={{ color: ink(tone) }}>
        <Icon className="size-3.5" aria-hidden="true" /> {title}
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="text-caption text-text-primary">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── The tabs whose design has not arrived yet ───────────────────────────── */

const WAITING: Record<string, { what: string; ready: string }> = {
  compare: {
    what: 'Person against person, and one person across projects.',
    ready: 'The figures behind it already exist — completed, reviewed, on time, overdue, per person and per project.',
  },
  projects: {
    what: 'Team against team, and a project’s whole delivery record.',
    ready: 'Every task already carries its project, so this is a grouping of what the Overview reads.',
  },
  assessments: {
    what: 'Self-review, manager evaluation, the employee’s response, agreed goals and follow-up dates.',
    ready:
      'Nothing is recorded for this yet — it needs a table of its own, because an assessment is written by people rather than derived from tasks.',
  },
  reports: {
    what: 'Configurable PDF and Excel reports, comparisons and saved templates.',
    ready: 'The existing Reports page already exports CSV, Excel and PDF, and is unchanged.',
  },
};

function ComingTab({ tab }: { tab: string }) {
  const x = WAITING[tab];
  return (
    <Panel title="Waiting on your design" description="Built when the reference image for this tab arrives.">
      <div className="space-y-2 px-4 pb-4 text-caption">
        <p className="text-text-primary">{x.what}</p>
        {/* ⚠️ SAYING WHICH PART IS DATA AND WHICH IS DESIGN. The owner said the
            other tabs' images are coming; what they cannot know from outside is
            that most of the data is already here and one of them genuinely is
            not. Saying so is the difference between "not built" and "cannot be
            built from what we record". */}
        <p className="text-text-secondary">{x.ready}</p>
      </div>
    </Panel>
  );
}
