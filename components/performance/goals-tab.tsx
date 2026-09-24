'use client';

import * as React from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Target,
  Trophy,
} from 'lucide-react';

import {
  addCheckinAction,
  addGoalCommentAction,
  saveGoalAction,
  setGoalStatusAction,
  type GoalsPayload,
} from '@/app/actions/development';
import { FilterPill, Nothing, Panel } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type { Goal, GoalCheckin, GoalComment, GoalStatus } from '@/lib/db/queries/goals';
import { dayWord } from '@/lib/view/activity';

/* ============================================================================
 * GOALS & DEVELOPMENT — the owner's reference, 2026-09-25
 * ----------------------------------------------------------------------------
 * *"Agree expectations, track evidence and plan support."*
 *
 * ── ⚠️ "CURRENT" IS NEVER TYPED IN ────────────────────────────────────────
 * The reference shows a Current column beside Baseline and Target, which reads
 * as a third thing somebody maintains. It is not: it is the newest check-in
 * that carried a number. Letting it be edited directly would let the figure and
 * the history that is supposed to evidence it disagree, which is the one thing
 * this tab exists to prevent.
 *
 * ── ⚠️ "MARK ACHIEVED" IS EARNED, AND THE BUTTON SAYS WHY WHEN IT IS NOT ──
 * The reference footnotes the button: *"Can be marked achieved once target is
 * met and evidence is present."* Both halves are checked here, and a disabled
 * button that does not say which half is missing is a button people click
 * twice and then complain about.
 *
 * ── ⚠️ TWO CONTROLS FROM THE MOCK-UP ARE NOT DRAWN ────────────────────────
 *   "More filters"      — everything it would hold is already a pill.
 *   "Schedule check-in" — it is not a separate act. A check-in date is a field
 *                         ON the goal, so it is set where the goal is edited;
 *                         a second button writing the same column would let the
 *                         two disagree.
 * ========================================================================= */

const num = (n: number) => n.toLocaleString('en-GB');

/** "70%", "7/10", "6 tasks" — the unit decides which. */
function figure(value: number, unit: string, target?: number): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  if (unit === '%') return `${rounded}%`;
  if (unit === '/' && target !== undefined) return `${rounded}/${target}`;
  return unit ? `${num(rounded)} ${unit}` : num(rounded);
}

const STATUS_LOOK: Record<GoalStatus, { label: string; ink: string; bg: string; dot: string }> = {
  not_started: { label: 'Not started', ink: 'var(--pf-soft)', bg: 'var(--pf-strip)', dot: 'var(--pf-mute)' },
  in_progress: { label: 'In progress', ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)', dot: 'var(--pf-amber)' },
  achieved: { label: 'Achieved', ink: 'var(--pf-green)', bg: 'var(--pf-green-bg)', dot: 'var(--pf-green)' },
  archived: { label: 'Archived', ink: 'var(--pf-mute)', bg: 'var(--pf-strip)', dot: 'var(--pf-mute)' },
};

/* ── The tab ─────────────────────────────────────────────────────────────── */

export function GoalsTab({
  person,
  viewer,
  goals: seededGoals,
  checkins: seededCheckins,
  comments: seededComments,
  today,
}: {
  person: { id: string; name: string };
  viewer: { id: string; name: string };
  goals: readonly Goal[];
  checkins: readonly GoalCheckin[];
  comments: readonly GoalComment[];
  today: string;
}) {
  const [goals, setGoals] = React.useState(seededGoals);
  const [checkins, setCheckins] = React.useState(seededCheckins);
  const [comments, setComments] = React.useState(seededComments);
  const [status, setStatus] = React.useState<string>('open');
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Goal | 'new' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const canWrite = viewer.id !== person.id;
  const first = person.name.trim().split(/\s+/)[0];

  const absorb = (r: GoalsPayload) => {
    if (!r.ok) {
      setError(r.error ?? 'That could not be saved.');
      return false;
    }
    setError(null);
    if (r.goals) setGoals(r.goals);
    if (r.checkins) setCheckins(r.checkins);
    if (r.comments) setComments(r.comments);
    return true;
  };

  const shown = React.useMemo(
    () =>
      goals.filter((g) =>
        status === 'all'
          ? true
          : status === 'open'
            ? g.status === 'in_progress' || g.status === 'not_started'
            : g.status === status,
      ),
    [goals, status],
  );

  /* Derived, never synchronised — the first open goal is in hand until somebody
     picks another. */
  const picked = shown.find((g) => g.id === pickedId) ?? shown[0] ?? null;

  const active = goals.filter((g) => g.status === 'in_progress' || g.status === 'not_started');
  const awaiting = active.filter((g) => g.nextCheckinOn !== null && g.nextCheckinOn <= today);
  const quarter = quarterStart(today);
  const achieved = goals.filter((g) => g.status === 'achieved' && g.agreedOn >= quarter);

  return (
    <div className="space-y-[1.25rem]">
      {/* ── The filters ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-[0.7rem]">
        <FilterPill
          icon={Filter}
          title="Goal status"
          label={
            status === 'open'
              ? 'Open goals'
              : status === 'all'
                ? 'All goals'
                : STATUS_LOOK[status as GoalStatus].label
          }
          value={status}
          options={[
            { value: 'open', label: `Open goals (${num(active.length)})` },
            { value: 'all', label: `All goals (${num(goals.length)})` },
            ...(['in_progress', 'not_started', 'achieved', 'archived'] as const).map((s) => ({
              value: s,
              label: `${STATUS_LOOK[s].label} (${num(goals.filter((g) => g.status === s).length)})`,
            })),
          ]}
          onChange={setStatus}
        />

        {canWrite && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="ml-auto inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[1rem] py-[0.7rem] text-[0.86rem] font-semibold leading-none"
            style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
          >
            <Plus className="size-[1rem]" aria-hidden="true" />
            Add goal
          </button>
        )}
      </div>

      {error && (
        <p
          className="rounded-[0.7rem] px-[0.9rem] py-[0.7rem] text-[0.85rem]"
          style={{ background: 'var(--pf-red-bg)', color: 'var(--pf-red-ink)' }}
        >
          {error}
        </p>
      )}

      {/* ── The three counts ─────────────────────────────────────────────── */}
      <div className="grid gap-[1rem] sm:grid-cols-3">
        <Count
          icon={Target}
          label="Active goals"
          value={active.length}
          tone="var(--pf-blue)"
          bg="var(--pf-blue-bg)"
        />
        <Count
          icon={CalendarClock}
          label="Check-in due"
          value={awaiting.length}
          tone="var(--pf-amber)"
          bg="var(--pf-amber-bg)"
          hint={awaiting.length > 0 ? 'The date agreed has passed' : 'Nothing is overdue a check-in'}
        />
        <Count
          icon={Trophy}
          label="Achieved this quarter"
          value={achieved.length}
          tone="var(--pf-green)"
          bg="var(--pf-green-bg)"
        />
      </div>

      <div className="grid items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-[1.25rem]">
          <AgreedGoals goals={shown} picked={picked} onPick={(g) => setPickedId(g.id)} />
          {picked && (
            <CheckinHistory
              rows={checkins.filter((c) => c.goalId === picked.id)}
              goal={picked}
            />
          )}
          {picked && (
            <Conversation
              goal={picked}
              person={person}
              viewer={viewer}
              comments={comments.filter((c) => c.goalId === picked.id)}
              onSaved={absorb}
            />
          )}
        </div>

        {picked ? (
          <GoalDetail
            key={picked.id}
            goal={picked}
            person={person}
            canWrite={canWrite}
            checkins={checkins.filter((c) => c.goalId === picked.id)}
            onSaved={absorb}
            onEdit={() => setEditing(picked)}
          />
        ) : (
          <aside
            className="rounded-[0.95rem] border px-[1.22rem] py-[2.2rem] text-center"
            style={{
              background: 'var(--pf-surface)',
              borderColor: 'var(--pf-line)',
              boxShadow: 'var(--pf-shadow)',
            }}
          >
            <Target className="mx-auto size-[1.6rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
            <p className="mt-[0.7rem] text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
              {goals.length === 0
                ? `Nothing has been agreed with ${first} yet.`
                : 'No goal matches this filter.'}
            </p>
          </aside>
        )}
      </div>

      <p className="text-[0.82rem]" style={{ color: 'var(--pf-mute)' }}>
        {num(goals.filter((g) => g.status === 'archived').length)} archived ·{' '}
        {num(goals.filter((g) => g.status === 'achieved').length)} achieved · every target change is
        kept in the check-in history.
      </p>

      {editing && (
        <GoalDialog
          goal={editing === 'new' ? null : editing}
          person={person}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            if (absorb(r)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** The quarter this day falls in, as its first date. */
function quarterStart(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, '0')}-01`;
}

function Count({
  icon: Icon,
  label,
  value,
  tone,
  bg,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: number;
  tone: string;
  bg: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-[0.85rem] rounded-[0.95rem] border px-[1.1rem] py-[0.95rem]"
      style={{ background: bg, borderColor: 'var(--pf-line)' }}
    >
      <span
        className="grid size-[2.4rem] shrink-0 place-items-center rounded-full"
        style={{ background: 'var(--pf-surface)' }}
      >
        <Icon className="size-[1.15rem]" style={{ color: tone }} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.84rem]" style={{ color: 'var(--pf-soft)' }}>
          {label}
        </span>
        <span className="block text-[1.5rem] font-bold leading-[1.2]" style={{ color: 'var(--pf-ink)' }}>
          {num(value)}
        </span>
        {hint && (
          <span className="block text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

/* ── The table ───────────────────────────────────────────────────────────── */

function AgreedGoals({
  goals,
  picked,
  onPick,
}: {
  goals: readonly Goal[];
  picked: Goal | null;
  onPick: (g: Goal) => void;
}) {
  return (
    <Panel title="Agreed goals" description="What was agreed, and where it stands now.">
      {goals.length === 0 ? (
        <Nothing>
          No goal matches this filter. A goal is a baseline, a target and a date — set one above and
          it will appear here with its check-ins.
        </Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] table-fixed border-collapse">
            <thead>
              <tr
                className="whitespace-nowrap border-y text-[0.76rem]"
                style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
              >
                <th className="py-[0.72rem] pl-[1.22rem] text-left font-medium">Goal</th>
                <th className="w-[6rem] py-[0.72rem] text-right font-medium">Baseline</th>
                <th className="w-[6rem] py-[0.72rem] text-right font-medium">Target</th>
                <th className="w-[7rem] py-[0.72rem] text-right font-medium">Current</th>
                <th className="w-[9rem] py-[0.72rem] pl-[1.5rem] text-left font-medium">Due</th>
                <th className="w-[8.5rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => {
                const on = picked?.id === g.id;
                const look = STATUS_LOOK[g.status];
                const late = g.dueDate !== null && g.status !== 'achieved' && g.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <tr
                    key={g.id}
                    onClick={() => onPick(g)}
                    aria-selected={on}
                    className="cursor-pointer border-b last:border-0"
                    style={{
                      borderColor: 'var(--pf-grid)',
                      height: '3.1rem',
                      background: on ? 'var(--pf-mint)' : undefined,
                      boxShadow: on ? 'inset 3px 0 0 0 var(--pf-teal)' : undefined,
                    }}
                  >
                    <td className="pl-[1.22rem] pr-[0.6rem] text-[0.87rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                      <span className="block truncate" title={g.title}>
                        {g.title}
                      </span>
                    </td>
                    <td className="pr-[0.6rem] text-right text-[0.85rem] tabular-nums" style={{ color: 'var(--pf-soft)' }}>
                      {figure(g.baseline, g.unit, g.target)}
                    </td>
                    <td className="pr-[0.6rem] text-right text-[0.85rem] tabular-nums" style={{ color: 'var(--pf-soft)' }}>
                      {figure(g.target, g.unit, g.target)}
                    </td>
                    {/* ⚠️ THE ONLY BOLD FIGURE IN THE ROW, because it is the one
                        that moves. It is read from the newest check-in. */}
                    <td className="pr-[0.6rem] text-right text-[0.9rem] font-bold tabular-nums" style={{ color: 'var(--pf-ink)' }}>
                      {g.checkins === 0 ? (
                        <span className="font-normal" style={{ color: 'var(--pf-mute)' }}>
                          No check-in
                        </span>
                      ) : (
                        figure(g.current, g.unit, g.target)
                      )}
                    </td>
                    <td
                      className="pl-[1.5rem] pr-[0.6rem] text-[0.85rem]"
                      style={{ color: late ? 'var(--pf-red-ink)' : 'var(--pf-body)' }}
                    >
                      {g.dueDate ? dayWord(g.dueDate) : '—'}
                    </td>
                    <td className="pr-[1.22rem]">
                      <span
                        className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.65rem] py-[0.25rem] text-[0.77rem] font-semibold"
                        style={{ background: look.bg, color: look.ink }}
                      >
                        <span aria-hidden="true" className="size-[0.45rem] rounded-full" style={{ background: look.dot }} />
                        {look.label}
                      </span>
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

/* ── The check-in history ────────────────────────────────────────────────── */

function CheckinHistory({ rows, goal }: { rows: readonly GoalCheckin[]; goal: Goal }) {
  return (
    <Panel title="Check-in history" description={`Every report against “${goal.title}”.`}>
      {rows.length === 0 ? (
        <Nothing>
          Nothing has been reported against this goal yet. A check-in is a date, a sentence and —
          where there is one — a link to the work that proves it.
        </Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed border-collapse">
            <thead>
              <tr
                className="whitespace-nowrap border-y text-[0.76rem]"
                style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
              >
                <th className="w-[8rem] py-[0.72rem] pl-[1.22rem] text-left font-medium">Date</th>
                <th className="w-[9rem] py-[0.72rem] text-left font-medium">Updated by</th>
                <th className="py-[0.72rem] text-left font-medium">Progress note</th>
                <th className="w-[11rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'var(--pf-grid)' }}>
                  <td className="py-[0.7rem] pl-[1.22rem] pr-[0.6rem] text-[0.84rem]" style={{ color: 'var(--pf-body)' }}>
                    {dayWord(c.onDate)}
                  </td>
                  <td className="pr-[0.6rem] text-[0.84rem]" style={{ color: 'var(--pf-ink)' }}>
                    <span className="flex items-center gap-[0.4rem]">
                      <Avatar name={c.byName ?? 'Unknown'} size="xs" />
                      <span aria-hidden="true" className="truncate">
                        {c.byName ?? 'Not recorded'}
                      </span>
                    </span>
                  </td>
                  <td className="pr-[0.6rem] text-[0.84rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
                    {c.note}
                    {c.value !== null && (
                      <span className="ml-[0.4rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                        ({figure(c.value, goal.unit, goal.target)})
                      </span>
                    )}
                  </td>
                  <td className="pr-[1.22rem] text-[0.83rem]">
                    {c.evidenceUrl ? (
                      <a
                        href={c.evidenceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-[0.35rem] underline underline-offset-2"
                        style={{ color: 'var(--pf-link)' }}
                      >
                        <ExternalLink className="size-[0.85rem] shrink-0" aria-hidden="true" />
                        <span className="truncate">{c.evidenceLabel || 'Open'}</span>
                      </a>
                    ) : (
                      <span style={{ color: 'var(--pf-mute)' }}>None attached</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── The conversation ────────────────────────────────────────────────────── */

function Conversation({
  goal,
  person,
  viewer,
  comments,
  onSaved,
}: {
  goal: Goal;
  person: { id: string; name: string };
  viewer: { id: string; name: string };
  comments: readonly GoalComment[];
  onSaved: (r: GoalsPayload) => boolean;
}) {
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const mine = viewer.id === person.id;

  const send = () => {
    if (!body.trim()) return;
    setBusy(true);
    void addGoalCommentAction({
      goalId: goal.id,
      subjectId: person.id,
      body,
      parentId: null,
    }).then((r) => {
      setBusy(false);
      if (onSaved(r)) setBody('');
    });
  };

  return (
    <Panel
      title="Comments"
      description={mine ? 'Say what would help, and read the reply.' : `${person.name.split(' ')[0]}’s own words, and your reply.`}
    >
      <div className="border-t px-[1.22rem] py-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        {comments.length === 0 ? (
          <p className="text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
            Nothing has been said about this goal yet.
          </p>
        ) : (
          <ul className="space-y-[0.85rem]">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-[0.6rem]">
                <Avatar name={c.authorName ?? 'Unknown'} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-[0.5rem]">
                    <span aria-hidden="true" className="text-[0.84rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                      {c.authorName ?? 'Not recorded'}
                    </span>
                    <span className="text-[0.76rem]" style={{ color: 'var(--pf-mute)' }}>
                      {dayWord(c.at.slice(0, 10))}
                    </span>
                  </span>
                  <span className="mt-[0.15rem] block text-[0.85rem] leading-[1.55]" style={{ color: 'var(--pf-body)' }}>
                    {c.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-[0.9rem] flex flex-wrap items-end gap-[0.6rem]">
          <label className="min-w-[14rem] flex-1">
            <span className="sr-only">Add a comment</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder={mine ? 'What would help you hit this?' : `Reply to ${person.name.split(' ')[0]}…`}
              className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </label>
          <button
            type="button"
            onClick={send}
            disabled={busy || !body.trim()}
            className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] px-[1rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-50"
            style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
          >
            {busy && <Loader2 className="size-[0.9rem] animate-spin" aria-hidden="true" />}
            Post
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ── The goal in hand ────────────────────────────────────────────────────── */

function GoalDetail({
  goal,
  person,
  canWrite,
  checkins,
  onSaved,
  onEdit,
}: {
  goal: Goal;
  person: { id: string; name: string };
  canWrite: boolean;
  checkins: readonly GoalCheckin[];
  onSaved: (r: GoalsPayload) => boolean;
  onEdit: () => void;
}) {
  const [note, setNote] = React.useState('');
  const [value, setValue] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const look = STATUS_LOOK[goal.status];
  const metTarget = goal.current >= goal.target;
  const canAchieve = metTarget && goal.hasEvidence && goal.status !== 'achieved';

  const send = () => {
    if (!note.trim()) return;
    setBusy('checkin');
    const parsed = value.trim() === '' ? null : Number(value);
    void addCheckinAction({
      goalId: goal.id,
      subjectId: person.id,
      note,
      value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      evidenceLabel: label,
      evidenceUrl: url,
      onDate: null,
    }).then((r) => {
      setBusy(null);
      if (onSaved(r)) {
        setNote('');
        setValue('');
        setLabel('');
        setUrl('');
        setOpen(false);
      }
    });
  };

  const move = (status: GoalStatus) => {
    setBusy(status);
    void setGoalStatusAction(goal.id, status, person.id).then((r) => {
      setBusy(null);
      onSaved(r);
    });
  };

  return (
    <aside
      className="overflow-hidden rounded-[0.95rem] border"
      style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', boxShadow: 'var(--pf-shadow)' }}
    >
      <div className="flex items-start gap-[0.8rem] px-[1.22rem] pb-[0.6rem] pt-[1.15rem]">
        <h3 className="min-w-0 flex-1 text-[1.15rem] font-bold leading-[1.3]" style={{ color: 'var(--pf-ink)' }}>
          {goal.title}
        </h3>
        <span
          className="inline-flex shrink-0 items-center gap-[0.4rem] rounded-full px-[0.7rem] py-[0.3rem] text-[0.77rem] font-semibold"
          style={{ background: look.bg, color: look.ink }}
        >
          <span aria-hidden="true" className="size-[0.45rem] rounded-full" style={{ background: look.dot }} />
          {look.label}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-[0.5rem] px-[1.22rem] pb-[0.8rem]">
        <Box label="Owner">{person.name}</Box>
        <Box label="Set by">{goal.setByName ?? 'Not recorded'}</Box>
        <Box label="Agreed">{dayWord(goal.agreedOn)}</Box>
        <Box label="Baseline">{figure(goal.baseline, goal.unit, goal.target)}</Box>
        <Box label="Target">{figure(goal.target, goal.unit, goal.target)}</Box>
        <Box label="Current">
          {goal.checkins === 0 ? '—' : figure(goal.current, goal.unit, goal.target)}
        </Box>
        <Box label="Due">{goal.dueDate ? dayWord(goal.dueDate) : '—'}</Box>
        <Box label="Next check-in">{goal.nextCheckinOn ? dayWord(goal.nextCheckinOn) : '—'}</Box>
        <Box label="Check-ins">{num(goal.checkins)}</Box>
      </dl>

      {/* ── Progress, measured from the baseline ───────────────────────────── */}
      <div className="px-[1.22rem] pb-[0.9rem]">
        <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
          Progress
        </p>
        {goal.measure && (
          <p className="mb-[0.45rem] text-[0.83rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {goal.measure}
          </p>
        )}
        <div className="flex items-center gap-[0.7rem]">
          <span
            className="h-[0.6rem] min-w-0 flex-1 overflow-hidden rounded-full"
            style={{ background: 'var(--pf-strip)' }}
            role="img"
            aria-label={`${goal.progress}% of the way from the baseline to the target`}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${goal.progress}%`, background: metTarget ? 'var(--pf-green)' : 'var(--pf-teal)' }}
            />
          </span>
          <span className="shrink-0 text-[0.95rem] font-bold tabular-nums" style={{ color: 'var(--pf-ink)' }}>
            {goal.progress}%
          </span>
        </div>
        {/* ⚠️ THE BAR IS DISTANCE TRAVELLED, NOT THE RAW FIGURE. 70% against a
            60→80 goal is HALF done, and a bar showing 70 would flatter it. */}
        <p className="mt-[0.3rem] text-[0.75rem]" style={{ color: 'var(--pf-mute)' }}>
          {goal.checkins === 0
            ? 'No check-in yet, so this is the baseline.'
            : `${figure(goal.baseline, goal.unit, goal.target)} at the start, ${figure(goal.current, goal.unit, goal.target)} now, ${figure(goal.target, goal.unit, goal.target)} agreed.`}
        </p>
      </div>

      {goal.actions.length > 0 && (
        <div className="px-[1.22rem] pb-[0.9rem]">
          <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
            Agreed actions
          </p>
          <ul className="space-y-[0.28rem]">
            {goal.actions.map((a, i) => (
              <li key={i} className="flex gap-[0.5rem] text-[0.84rem]" style={{ color: 'var(--pf-body)' }}>
                <span aria-hidden="true" style={{ color: 'var(--pf-teal)' }}>
                  •
                </span>
                <span className="min-w-0 flex-1">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkins.some((c) => c.evidenceUrl) && (
        <div className="px-[1.22rem] pb-[0.9rem]">
          <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
            Evidence
          </p>
          <ul className="space-y-[0.25rem]">
            {checkins
              .filter((c) => c.evidenceUrl)
              .slice(0, 6)
              .map((c) => (
                <li key={c.id}>
                  <a
                    href={c.evidenceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-[0.35rem] text-[0.83rem] underline underline-offset-2"
                    style={{ color: 'var(--pf-link)' }}
                  >
                    <ExternalLink className="size-[0.8rem] shrink-0" aria-hidden="true" />
                    {c.evidenceLabel || c.evidenceUrl}
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* ── Adding a check-in ──────────────────────────────────────────────── */}
      <div className="border-t px-[1.22rem] py-[0.95rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        {open ? (
          <>
            <label className="block">
              <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                Progress note
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What has moved since the last check-in."
                className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none"
                style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
              />
            </label>
            <div className="mt-[0.5rem] grid gap-[0.5rem] sm:grid-cols-2">
              <Input
                label={`Where it stands${goal.unit ? ` (${goal.unit === '/' ? 'out of ' + goal.target : goal.unit})` : ''}`}
                value={value}
                onChange={setValue}
                placeholder={String(goal.current)}
                type="number"
              />
              <Input label="Evidence label" value={label} onChange={setLabel} placeholder="Reviewed task list" />
            </div>
            <div className="mt-[0.5rem]">
              <Input label="Evidence link" value={url} onChange={setUrl} placeholder="https://…" />
            </div>
            <div className="mt-[0.7rem] flex flex-wrap gap-[0.5rem]">
              <button
                type="button"
                onClick={send}
                disabled={busy === 'checkin' || !note.trim()}
                className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] px-[1rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-50"
                style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
              >
                {busy === 'checkin' && <Loader2 className="size-[0.9rem] animate-spin" aria-hidden="true" />}
                Save check-in
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[0.7rem] border px-[0.9rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none"
                style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-[0.5rem]">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] px-[1rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none"
              style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
            >
              <Plus className="size-[0.95rem]" aria-hidden="true" />
              Add check-in
            </button>

            {canWrite && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] border px-[0.9rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none"
                style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
              >
                <Pencil className="size-[0.9rem]" aria-hidden="true" />
                Edit goal
              </button>
            )}

            {canWrite && goal.status !== 'achieved' && (
              <button
                type="button"
                onClick={() => move('achieved')}
                disabled={!canAchieve || busy !== null}
                title={
                  canAchieve
                    ? 'Target met and evidence attached'
                    : !metTarget
                      ? 'The target has not been reached yet'
                      : 'No check-in carries a link, so there is nothing evidencing it'
                }
                className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] border px-[0.9rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-45"
                style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
              >
                <Trophy className="size-[0.9rem]" aria-hidden="true" />
                Mark achieved
              </button>
            )}

            {canWrite && goal.status !== 'archived' && (
              <button
                type="button"
                onClick={() => move('archived')}
                disabled={busy !== null}
                className="rounded-[0.7rem] border px-[0.9rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-50"
                style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-soft)' }}
              >
                Archive
              </button>
            )}
          </div>
        )}

        {/* ⚠️ A DISABLED BUTTON THAT SAYS WHICH HALF IS MISSING. The reference
            footnotes the rule; a button that is simply grey teaches nothing. */}
        {canWrite && goal.status !== 'achieved' && !canAchieve && !open && (
          <p className="mt-[0.55rem] text-[0.78rem]" style={{ color: 'var(--pf-mute)' }}>
            {!metTarget
              ? `Achieved once the target of ${figure(goal.target, goal.unit, goal.target)} is reached — it stands at ${goal.checkins === 0 ? 'no check-in' : figure(goal.current, goal.unit, goal.target)}.`
              : 'The target is met. Attach a link on a check-in and it can be marked achieved.'}
          </p>
        )}
      </div>
    </aside>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="min-w-0 rounded-[0.6rem] px-[0.6rem] py-[0.45rem]"
      style={{ background: 'var(--pf-strip)' }}
    >
      <p className="text-[0.72rem]" style={{ color: 'var(--pf-mute)' }}>
        {label}
      </p>
      <p className="truncate text-[0.85rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
        style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
      />
    </label>
  );
}

/* ── Setting or editing one ──────────────────────────────────────────────── */

function GoalDialog({
  goal,
  person,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  person: { id: string; name: string };
  onClose: () => void;
  onSaved: (r: GoalsPayload) => void;
}) {
  const [title, setTitle] = React.useState(goal?.title ?? '');
  const [measure, setMeasure] = React.useState(goal?.measure ?? '');
  const [baseline, setBaseline] = React.useState(String(goal?.baseline ?? 0));
  const [target, setTarget] = React.useState(String(goal?.target ?? 0));
  const [unit, setUnit] = React.useState(goal?.unit ?? '%');
  const [due, setDue] = React.useState(goal?.dueDate ?? '');
  const [next, setNext] = React.useState(goal?.nextCheckinOn ?? '');
  const [actions, setActions] = React.useState((goal?.actions ?? []).join('\n'));
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDialogElement>(null);

  /* ⚠️ THE NATIVE <dialog>, NOT A FIXED OVERLAY. `.perf-ui` runs a reveal
     animation that ends on `transform: none` with fill-mode both, leaving an
     identity matrix on an ancestor — and a transformed ancestor traps
     `position: fixed`. The export dialog on this page opened below the fold for
     exactly that reason and the owner reported it as "nothing appears". */
  React.useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const save = () => {
    setBusy(true);
    void saveGoalAction({
      subjectId: person.id,
      goalId: goal?.id ?? null,
      title,
      baseline: Number(baseline) || 0,
      target: Number(target) || 0,
      unit,
      measure,
      dueDate: due || null,
      nextCheckinOn: next || null,
      actions: actions.split('\n'),
      projectId: null,
    }).then((r) => {
      setBusy(false);
      onSaved(r);
    });
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="w-[min(40rem,92vw)] rounded-[0.95rem] border p-0 backdrop:bg-black/40"
      style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', color: 'var(--pf-ink)' }}
    >
      <div className="px-[1.4rem] pb-[0.8rem] pt-[1.3rem]">
        <h2 className="text-[1.2rem] font-bold" style={{ color: 'var(--pf-ink)' }}>
          {goal ? 'Edit the goal' : `A goal for ${person.name}`}
        </h2>
        <p className="mt-[0.15rem] text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
          A baseline, a target and a date. The current figure comes from check-ins, never from here.
        </p>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-[1.4rem] pb-[1rem]">
        <Input label="Goal" value={title} onChange={setTitle} placeholder="Improve first-pass acceptance" />
        <div className="mt-[0.6rem]">
          <Input
            label="What is being measured"
            value={measure}
            onChange={setMeasure}
            placeholder="Reviewed submissions accepted first pass"
          />
        </div>
        <div className="mt-[0.6rem] grid gap-[0.6rem] sm:grid-cols-3">
          <Input label="Baseline" value={baseline} onChange={setBaseline} type="number" />
          <Input label="Target" value={target} onChange={setTarget} type="number" />
          <label className="block">
            <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Unit
            </span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            >
              <option value="%">per cent</option>
              <option value="/">out of the target</option>
              <option value="tasks">tasks</option>
              <option value="">a plain number</option>
            </select>
          </label>
        </div>
        <div className="mt-[0.6rem] grid gap-[0.6rem] sm:grid-cols-2">
          <label className="block">
            <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Due
            </span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </label>
          <label className="block">
            <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Next check-in
            </span>
            <input
              type="date"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </label>
        </div>
        <label className="mt-[0.6rem] block">
          <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
            Agreed actions <span className="font-normal" style={{ color: 'var(--pf-mute)' }}>one per line</span>
          </span>
          <textarea
            value={actions}
            onChange={(e) => setActions(e.target.value)}
            rows={3}
            placeholder={'Use the checklist before submission\nSupport: weekly feedback from the coordinator'}
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </label>
      </div>

      <div
        className="flex flex-wrap justify-end gap-[0.5rem] border-t px-[1.4rem] py-[0.9rem]"
        style={{ borderColor: 'var(--pf-grid)' }}
      >
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-[0.7rem] border px-[1rem] py-[0.6rem] text-[0.85rem] font-semibold leading-none"
          style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !title.trim()}
          className="inline-flex items-center gap-[0.45rem] rounded-[0.7rem] px-[1.1rem] py-[0.6rem] text-[0.85rem] font-semibold leading-none disabled:opacity-50"
          style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
        >
          {busy ? <Loader2 className="size-[0.9rem] animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-[0.9rem]" aria-hidden="true" />}
          {goal ? 'Save the goal' : 'Agree the goal'}
        </button>
      </div>
    </dialog>
  );
}
