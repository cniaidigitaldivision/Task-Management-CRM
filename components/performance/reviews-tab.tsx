'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Square,
  SquareCheck,
} from 'lucide-react';

import {
  reviewDetailAction,
  reviewsAction,
  setRevisionDueAction,
  type ReviewsPayload,
} from '@/app/actions/development';
import {
  addChecklistItemAction,
  addCommentAction,
  changeStatusAction,
  toggleChecklistItemAction,
} from '@/app/actions/tasks';
import { FilterPill, Nothing, Panel } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type { ReviewCounts, ReviewDetail, ReviewRow } from '@/lib/db/queries/reviews';
import { dayWord } from '@/lib/view/activity';

/* ============================================================================
 * REVIEWS & FEEDBACK — the owner's reference, 2026-09-25
 * ----------------------------------------------------------------------------
 * *"Inspect submissions, record decisions and follow up on changes."*
 *
 * ── ⚠️ THE DECISIONS ARE THE PRODUCT'S OWN, NOT THIS PAGE'S ───────────────
 * Approve and Request changes call `changeStatusAction`, the same guarded
 * transition the board and the task drawer use. It is the thing that decides
 * whether a move is legal, writes the log entry with its reason and refuses a
 * reviewer who may not. A second path to the same change would be a second set
 * of rules to keep in step, and this one is already tested.
 *
 * ── ⚠️ "ACCEPTANCE CRITERIA" IS THE TASK CHECKLIST ────────────────────────
 * `checklist_items` already exists and is already shown in the task drawer.
 * The reference draws it as a reviewer's tick-list, so that is what it is here
 * — the same rows, ticked from the side that judges them. Measured before
 * building: 0 exist today, so the panel invites the reviewer to write them.
 *
 * ── ⚠️ FEEDBACK IS A COMMENT, BECAUSE THAT IS WHERE THE PERSON WILL LOOK ──
 * A reviewer's note stored privately against the review would never reach the
 * person who has to act on it. It goes on the task, in the thread they already
 * read, and the decision's reason goes in the log beside the status move.
 * ========================================================================= */

const num = (n: number) => n.toLocaleString('en-GB');

const size = (bytes: number | null): string => {
  if (bytes === null || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const STATUS_LOOK: Record<string, { label: string; ink: string; bg: string }> = {
  in_review: { label: 'Awaiting review', ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  revisions: { label: 'Changes requested', ink: 'var(--pf-red-ink)', bg: 'var(--pf-red-bg)' },
};

/** "3h", "2 days" — how long somebody has been waiting on a decision. */
function waited(from: string | null, nowMs: number): string {
  if (!from) return 'Not recorded';
  const hours = Math.max(0, Math.round((nowMs - Date.parse(from)) / 3_600_000));
  if (hours < 1) return 'Under an hour';
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
}

const REASONS = [
  'Correction',
  'Brand or style',
  'Missing evidence',
  'Scope changed',
  'Quality',
] as const;

/* ── The tab ─────────────────────────────────────────────────────────────── */

export function ReviewsTab({
  person,
  viewer,
  queue: seededQueue,
  counts: seededCounts,
  nowMs,
  onOpenTask,
}: {
  person: { id: string; name: string };
  viewer: { id: string; name: string };
  queue: readonly ReviewRow[];
  counts: ReviewCounts;
  nowMs: number;
  onOpenTask: (taskId: string) => void;
}) {
  const [queue, setQueue] = React.useState(seededQueue);
  const [counts, setCounts] = React.useState(seededCounts);
  const [state, setState] = React.useState<string>('all');
  const [project, setProject] = React.useState<string>('all');
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const first = person.name.trim().split(/\s+/)[0];

  const absorb = (r: ReviewsPayload) => {
    if (!r.ok) {
      setError(r.error ?? 'That could not be saved.');
      return false;
    }
    setError(null);
    if (r.queue) setQueue(r.queue);
    if (r.counts) setCounts(r.counts);
    return true;
  };

  const reload = () => reviewsAction(person.id).then(absorb);

  const projects = React.useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of queue) seen.set(r.projectName, (seen.get(r.projectName) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [queue]);

  const shown = React.useMemo(
    () =>
      queue.filter(
        (r) =>
          (state === 'all' || r.status === state) &&
          (project === 'all' || r.projectName === project),
      ),
    [queue, state, project],
  );

  /* Derived — the longest-waiting submission is in hand until somebody picks. */
  const picked = shown.find((r) => r.taskId === pickedId) ?? shown[0] ?? null;

  return (
    <div className="space-y-[1.25rem]">
      <div className="flex flex-wrap items-center gap-[0.7rem]">
        <FilterPill
          icon={Filter}
          title="Review state"
          label={state === 'all' ? 'Review state: All' : STATUS_LOOK[state].label}
          value={state}
          options={[
            { value: 'all', label: `All states (${num(queue.length)})` },
            {
              value: 'in_review',
              label: `Awaiting review (${num(queue.filter((r) => r.status === 'in_review').length)})`,
            },
            {
              value: 'revisions',
              label: `Changes requested (${num(queue.filter((r) => r.status === 'revisions').length)})`,
            },
          ]}
          onChange={setState}
        />
        <FilterPill
          icon={Filter}
          title="Project"
          label={project === 'all' ? 'Project: All' : project}
          value={project}
          options={[
            { value: 'all', label: 'Project: All' },
            ...projects.map(([name, n]) => ({ value: name, label: `${name} (${num(n)})` })),
          ]}
          onChange={setProject}
        />
      </div>

      {error && (
        <p
          className="rounded-[0.7rem] px-[0.9rem] py-[0.7rem] text-[0.85rem]"
          style={{ background: 'var(--pf-red-bg)', color: 'var(--pf-red-ink)' }}
        >
          {error}
        </p>
      )}

      <div className="grid gap-[1rem] sm:grid-cols-3">
        <Count
          icon={Clock3}
          label="Awaiting review"
          value={counts.awaiting}
          tone="var(--pf-amber)"
          bg="var(--pf-amber-bg)"
          hint={counts.awaiting === 0 ? 'Nothing is waiting on a decision' : undefined}
        />
        <Count
          icon={RotateCcw}
          label="Changes requested"
          value={counts.changesRequested}
          tone="var(--pf-red-ink)"
          bg="var(--pf-red-bg)"
        />
        {/* ⚠️ "APPROVED" MEANS SOMEBODY ELSE CLOSED IT. Counting everything they
            finished would report the person approving their own work. Both
            figures are shown so the gap is visible rather than implied. */}
        <Count
          icon={CheckCircle2}
          label="Approved this month"
          value={counts.approvedThisMonth}
          tone="var(--pf-green)"
          bg="var(--pf-green-bg)"
          hint={`of ${num(counts.doneThisMonth)} finished — the rest they closed themselves`}
        />
      </div>

      <div className="grid items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-[1.25rem]">
          <Panel
            title="Review queue"
            description={`What ${first} has handed over, longest wait first.`}
          >
            {shown.length === 0 ? (
              <Nothing>
                {queue.length === 0
                  ? `Nothing of ${first}'s is waiting on a review. Work arrives here when it is moved to Awaiting review, and leaves when somebody approves it or asks for changes.`
                  : 'No submission matches these filters.'}
              </Nothing>
            ) : (
              <div className="overflow-x-auto">
                {/* ⚠️ THE FIXED COLUMNS MUST LEAVE THE TASK ROOM. They totalled
                    43.5rem against a 46rem floor, so every title rendered as
                    "Visitin..." — the one column a reviewer actually reads. */}
                <table className="w-full min-w-[54rem] table-fixed border-collapse">
                  <thead>
                    <tr
                      className="whitespace-nowrap border-y text-[0.76rem]"
                      style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
                    >
                      <th className="py-[0.72rem] pl-[1.22rem] text-left font-medium">Task</th>
                      <th className="w-[9rem] py-[0.72rem] text-left font-medium">Project</th>
                      <th className="w-[8.5rem] py-[0.72rem] text-left font-medium">Reviewer</th>
                      <th className="w-[6.5rem] py-[0.72rem] text-left font-medium">Submitted</th>
                      <th className="w-[5rem] py-[0.72rem] text-left font-medium">Waiting</th>
                      <th className="w-[9rem] py-[0.72rem] pr-[1.22rem] text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const on = picked?.taskId === r.taskId;
                      const look = STATUS_LOOK[r.status];
                      return (
                        <tr
                          key={r.taskId}
                          onClick={() => setPickedId(r.taskId)}
                          aria-selected={on}
                          className="cursor-pointer border-b last:border-0"
                          style={{
                            borderColor: 'var(--pf-grid)',
                            height: '3.35rem',
                            background: on ? 'var(--pf-mint)' : undefined,
                            boxShadow: on ? 'inset 3px 0 0 0 var(--pf-teal)' : undefined,
                          }}
                        >
                          <td className="pl-[1.22rem] pr-[0.6rem]" title={r.title}>
                            <span className="block truncate text-[0.87rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                              {r.title}
                            </span>
                            <span className="block truncate text-[0.73rem]" style={{ color: 'var(--pf-mute)' }}>
                              {r.reference}
                              {r.attachments > 0 ? ` · ${num(r.attachments)} file${r.attachments === 1 ? '' : 's'}` : ''}
                            </span>
                          </td>
                          <td className="pr-[0.6rem] text-[0.84rem]" style={{ color: 'var(--pf-soft)' }} title={r.projectName}>
                            <span className="block truncate">{r.projectName}</span>
                          </td>
                          <td className="pr-[0.6rem] text-[0.84rem]" style={{ color: 'var(--pf-ink)' }}>
                            {r.reviewerName ? (
                              <span className="flex min-w-0 items-center gap-[0.4rem]">
                                <Avatar name={r.reviewerName} src={r.reviewerAvatar} size="xs" />
                                <span aria-hidden="true" className="truncate">
                                  {r.reviewerName}
                                </span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--pf-mute)' }}>Unassigned</span>
                            )}
                          </td>
                          <td className="pr-[0.6rem] text-[0.83rem]" style={{ color: 'var(--pf-body)' }}>
                            {r.submittedAt ? dayWord(r.submittedAt.slice(0, 10)) : '—'}
                          </td>
                          <td className="pr-[0.6rem] text-[0.83rem] tabular-nums" style={{ color: 'var(--pf-body)' }}>
                            {waited(r.submittedAt, nowMs)}
                          </td>
                          <td className="pr-[1.22rem]">
                            <span
                              className="inline-block rounded-full px-[0.65rem] py-[0.25rem] text-[0.76rem] font-semibold"
                              style={{ background: look.bg, color: look.ink }}
                            >
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

          {picked && <Conversation key={picked.taskId} row={picked} viewer={viewer} onChanged={reload} />}
        </div>

        {picked ? (
          <Decision
            key={picked.taskId}
            row={picked}
            onChanged={reload}
            onError={setError}
            onOpenTask={onOpenTask}
          />
        ) : (
          <aside
            className="rounded-[0.95rem] border px-[1.22rem] py-[2.2rem] text-center"
            style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', boxShadow: 'var(--pf-shadow)' }}
          >
            <CheckCircle2 className="mx-auto size-[1.6rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
            <p className="mt-[0.7rem] text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
              Nothing is waiting on a decision. Pick a submission on the left to read its evidence and
              judge it.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
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
      <span className="grid size-[2.4rem] shrink-0 place-items-center rounded-full" style={{ background: 'var(--pf-surface)' }}>
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
          <span className="block text-[0.74rem] leading-[1.3]" style={{ color: 'var(--pf-mute)' }}>
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

/* ── The conversation on one submission ──────────────────────────────────── */

/* ⚠️ `undefined` IS STILL READING, `null` IS A FAILED READ. One nullable
   variable cannot tell those apart, and the first version showed "Reading…"
   for ever when the action returned an error — a spinner that never ends is
   the worst way to report a failure, because nobody reports it. */
type Loaded = ReviewDetail | null | undefined;

function Conversation({
  row,
  viewer,
  onChanged,
}: {
  row: ReviewRow;
  viewer: { id: string; name: string };
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<Loaded>(undefined);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void reviewDetailAction(row.taskId).then((r) => {
      if (live) setDetail(r.ok && r.detail ? r.detail : null);
    });
    return () => {
      live = false;
    };
  }, [row.taskId]);

  const send = () => {
    if (!body.trim()) return;
    setBusy(true);
    void addCommentAction(row.taskId, body).then(async (r) => {
      setBusy(false);
      if (!r.ok) return;
      setBody('');
      const again = await reviewDetailAction(row.taskId);
      if (again.ok && again.detail) setDetail(again.detail);
      onChanged();
    });
  };

  return (
    <Panel title="Review conversation" description={`Everything said about “${row.title}”.`}>
      <div className="border-t px-[1.22rem] py-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        {detail === undefined ? (
          <p className="text-[0.85rem]" style={{ color: 'var(--pf-mute)' }}>
            Reading the thread…
          </p>
        ) : detail === null ? (
          <p className="text-[0.85rem]" style={{ color: 'var(--pf-red-ink)' }}>
            This thread could not be read. The decision below still works.
          </p>
        ) : detail.messages.length === 0 ? (
          <p className="text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
            Nothing has been said on this task yet. A note here is what the person actually reads.
          </p>
        ) : (
          <ul className="space-y-[0.85rem]">
            {detail.messages.map((m) => (
              <li key={m.id} className="flex gap-[0.6rem]">
                <Avatar name={m.authorName ?? 'Unknown'} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-[0.5rem]">
                    <span aria-hidden="true" className="text-[0.84rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                      {m.authorName ?? 'Not recorded'}
                      {m.authorId === viewer.id ? ' (you)' : ''}
                    </span>
                    <span className="text-[0.76rem]" style={{ color: 'var(--pf-mute)' }}>
                      {dayWord(m.at.slice(0, 10))}
                    </span>
                  </span>
                  <span className="mt-[0.15rem] block text-[0.85rem] leading-[1.55]" style={{ color: 'var(--pf-body)' }}>
                    {m.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-[0.9rem] flex flex-wrap items-end gap-[0.6rem]">
          <label className="min-w-[14rem] flex-1">
            <span className="sr-only">Add to the conversation</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="Add a note to the thread…"
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
            {busy ? <Loader2 className="size-[0.9rem] animate-spin" aria-hidden="true" /> : <Send className="size-[0.9rem]" aria-hidden="true" />}
            Post
          </button>
        </div>

        {detail != null && detail.history.length > 0 && (
          <>
            <p className="mt-[1.1rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
              Review history
            </p>
            <ul className="mt-[0.35rem] space-y-[0.3rem]">
              {detail.history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="text-[0.82rem]" style={{ color: 'var(--pf-body)' }}>
                  <span style={{ color: 'var(--pf-mute)' }}>{dayWord(h.at.slice(0, 10))}</span>{' '}
                  {h.actorName ?? 'Somebody'}{' '}
                  {h.action === 'in_review'
                    ? 'submitted it for review'
                    : h.action === 'revisions'
                      ? 'asked for changes'
                      : h.action === 'done'
                        ? 'approved it'
                        : 'cancelled it'}
                  {h.reason ? ` — “${h.reason}”` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ── The decision ────────────────────────────────────────────────────────── */

function Decision({
  row,
  onChanged,
  onError,
  onOpenTask,
}: {
  row: ReviewRow;
  onChanged: () => void;
  onError: (message: string | null) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [detail, setDetail] = React.useState<Loaded>(undefined);
  const [feedback, setFeedback] = React.useState('');
  const [reason, setReason] = React.useState<string>(REASONS[0]);
  const [due, setDue] = React.useState(row.dueDate ?? '');
  const [criterion, setCriterion] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await reviewDetailAction(row.taskId);
    setDetail(r.ok && r.detail ? r.detail : null);
  }, [row.taskId]);

  React.useEffect(() => {
    let live = true;
    void reviewDetailAction(row.taskId).then((r) => {
      if (live) setDetail(r.ok && r.detail ? r.detail : null);
    });
    return () => {
      live = false;
    };
  }, [row.taskId]);

  /* ⚠️ THE DECISION IS THE PRODUCT'S TRANSITION, NOT A LOCAL WRITE. Feedback is
     posted first so the note is on the task before its status moves — a person
     who opens it after the change should never find the move without the
     reason. */
  const decide = async (to: 'done' | 'revisions') => {
    const note = feedback.trim();
    if (to === 'revisions' && !note) {
      onError('Say what needs changing — the person only sees what you write here.');
      return;
    }
    setBusy(to);
    onError(null);

    if (note) await addCommentAction(row.taskId, note);
    if (to === 'revisions' && due && due !== row.dueDate) {
      await setRevisionDueAction(row.taskId, due);
    }

    const moved = await changeStatusAction(row.taskId, to, to === 'revisions' ? reason : undefined);
    setBusy(null);
    if (!moved.ok) {
      onError(moved.error ?? 'That decision could not be recorded.');
      return;
    }
    setFeedback('');
    onChanged();
  };

  const toggle = async (id: string, next: boolean) => {
    setBusy(id);
    await toggleChecklistItemAction(id, next);
    setBusy(null);
    await load();
  };

  const addCriterion = async () => {
    const text = criterion.trim();
    if (!text) return;
    setBusy('criterion');
    await addChecklistItemAction(row.taskId, text);
    setCriterion('');
    setBusy(null);
    await load();
    onChanged();
  };

  const met = detail?.criteria.filter((c) => c.done).length ?? 0;
  const total = detail?.criteria.length ?? 0;

  return (
    <aside
      className="overflow-hidden rounded-[0.95rem] border"
      style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', boxShadow: 'var(--pf-shadow)' }}
    >
      <div className="px-[1.22rem] pb-[0.7rem] pt-[1.15rem]">
        <p className="text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
          {row.reference}
        </p>
        <h3 className="text-[1.15rem] font-bold leading-[1.3]" style={{ color: 'var(--pf-ink)' }}>
          {row.title}
        </h3>
        {row.description && (
          <p className="mt-[0.4rem] text-[0.84rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {row.description}
          </p>
        )}

        <dl className="mt-[0.8rem] grid grid-cols-2 gap-[0.5rem]">
          <Box label="Submitted by">{row.submittedByName ?? 'Not recorded'}</Box>
          <Box label="Reviewer">{row.reviewerName ?? 'Unassigned'}</Box>
          <Box label="Project">{row.projectName}</Box>
          <Box label="Due">{row.dueDate ? dayWord(row.dueDate) : 'No date'}</Box>
        </dl>
      </div>

      {/* ── Evidence ───────────────────────────────────────────────────────── */}
      <div className="px-[1.22rem] pb-[0.8rem]">
        <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
          Evidence
        </p>
        {detail === undefined ? (
          <p className="text-[0.83rem]" style={{ color: 'var(--pf-mute)' }}>
            Reading…
          </p>
        ) : detail === null ? (
          <p className="text-[0.83rem]" style={{ color: 'var(--pf-red-ink)' }}>
            The evidence could not be read.
          </p>
        ) : detail.evidence.length === 0 ? (
          <p className="text-[0.83rem]" style={{ color: 'var(--pf-mute)' }}>
            Nothing is attached to this task.
          </p>
        ) : (
          <>
            <ul className="space-y-[0.3rem]">
              {detail.evidence.map((e) => (
                <li key={e.id} className="flex items-center gap-[0.45rem] text-[0.83rem]">
                  <Paperclip className="size-[0.85rem] shrink-0" style={{ color: 'var(--pf-green)' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--pf-body)' }} title={e.fileName}>
                    {e.fileName}
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--pf-mute)' }}>
                    {size(e.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
            {/* ⚠️ THE TASK OPENS; THE FILE DOES NOT HAVE ITS OWN URL. A task
                attachment lives in `attachments` with a storage path and no
                endpoint — `/api/drive/file` serves `documents`. An anchor here
                would have been a 404 dressed as a feature. */}
            <button
              type="button"
              onClick={() => onOpenTask(row.taskId)}
              className="mt-[0.4rem] inline-flex items-center gap-[0.35rem] text-[0.82rem] underline underline-offset-2"
              style={{ color: 'var(--pf-link)' }}
            >
              <ExternalLink className="size-[0.8rem]" aria-hidden="true" />
              Open the task to view {detail.evidence.length === 1 ? 'it' : 'them'}
            </button>
          </>
        )}
      </div>

      {/* ── Acceptance criteria ────────────────────────────────────────────── */}
      <div className="px-[1.22rem] pb-[0.8rem]">
        <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
          Acceptance criteria{total > 0 ? ` — ${num(met)} of ${num(total)}` : ''}
        </p>
        {detail === null && (
          <p className="mb-[0.4rem] text-[0.83rem]" style={{ color: 'var(--pf-red-ink)' }}>
            The criteria could not be read.
          </p>
        )}
        {detail != null && detail.criteria.length === 0 && (
          <p className="mb-[0.4rem] text-[0.83rem]" style={{ color: 'var(--pf-mute)' }}>
            None were set on this task. Write what it has to satisfy and it becomes the checklist the
            person sees on the task itself.
          </p>
        )}
        <ul className="space-y-[0.25rem]">
          {detail?.criteria.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c.id, !c.done)}
                disabled={busy === c.id}
                className="flex w-full items-start gap-[0.5rem] text-left text-[0.84rem] disabled:opacity-60"
                style={{ color: c.done ? 'var(--pf-soft)' : 'var(--pf-ink)' }}
              >
                {c.done ? (
                  <SquareCheck className="mt-[0.1rem] size-[1rem] shrink-0" style={{ color: 'var(--pf-green)' }} aria-hidden="true" />
                ) : (
                  <Square className="mt-[0.1rem] size-[1rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
                )}
                <span className={c.done ? 'line-through' : ''}>{c.text}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-[0.45rem] flex gap-[0.4rem]">
          <input
            value={criterion}
            onChange={(e) => setCriterion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addCriterion();
              }
            }}
            placeholder="Add a criterion…"
            className="min-w-0 flex-1 rounded-[0.55rem] border px-[0.6rem] py-[0.45rem] text-[0.82rem] outline-none"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
          <button
            type="button"
            onClick={addCriterion}
            disabled={busy === 'criterion' || !criterion.trim()}
            aria-label="Add this criterion"
            className="grid size-[2rem] shrink-0 place-items-center rounded-[0.55rem] border disabled:opacity-50"
            style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          >
            <Plus className="size-[0.95rem]" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── The decision ───────────────────────────────────────────────────── */}
      <div className="border-t px-[1.22rem] py-[0.95rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <label className="block">
          <span className="mb-[0.25rem] flex flex-wrap items-baseline gap-[0.4rem]">
            <span className="text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Feedback
            </span>
            <span className="text-[0.75rem]" style={{ color: 'var(--pf-mute)' }}>
              required when asking for changes
            </span>
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="Describe the changes needed, or confirm what was accepted."
            className="w-full resize-y rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] leading-[1.5] outline-none"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
          />
        </label>
        {/* ⚠️ IT SAYS WHERE THE NOTE GOES. A reviewer who believes this is
            private writes something different from one who knows it lands in
            the task's own thread. */}
        <p className="mt-[0.25rem] text-[0.75rem]" style={{ color: 'var(--pf-mute)' }}>
          Posted to the task’s conversation, where {row.submittedByName?.split(' ')[0] ?? 'they'} will read it.
        </p>

        <div className="mt-[0.6rem] grid gap-[0.5rem] sm:grid-cols-2">
          <label className="block">
            <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Reason
            </span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-[0.25rem] block text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
              Next revision due
            </span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-[0.6rem] border px-[0.7rem] py-[0.55rem] text-[0.84rem] outline-none"
              style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)', color: 'var(--pf-ink)' }}
            />
          </label>
        </div>

        <div className="mt-[0.9rem] grid gap-[0.5rem] sm:grid-cols-2">
          <button
            type="button"
            onClick={() => decide('done')}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-[0.45rem] rounded-[0.7rem] px-[1rem] py-[0.7rem] text-[0.85rem] font-semibold leading-none disabled:opacity-60"
            style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-teal)' }}
          >
            {busy === 'done' ? <Loader2 className="size-[0.95rem] animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-[0.95rem]" aria-hidden="true" />}
            Approve submission
          </button>
          <button
            type="button"
            onClick={() => decide('revisions')}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-[0.45rem] rounded-[0.7rem] border px-[1rem] py-[0.7rem] text-[0.85rem] font-semibold leading-none disabled:opacity-60"
            style={{ background: 'var(--pf-amber-bg)', borderColor: 'var(--pf-amber)', color: 'var(--pf-amber)' }}
          >
            {busy === 'revisions' ? <Loader2 className="size-[0.95rem] animate-spin" aria-hidden="true" /> : <RotateCcw className="size-[0.95rem]" aria-hidden="true" />}
            Request changes
          </button>
        </div>
      </div>
    </aside>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[0.6rem] px-[0.6rem] py-[0.45rem]" style={{ background: 'var(--pf-strip)' }}>
      <p className="text-[0.72rem]" style={{ color: 'var(--pf-mute)' }}>
        {label}
      </p>
      <p className="truncate text-[0.85rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </p>
    </div>
  );
}
