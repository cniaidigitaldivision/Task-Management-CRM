'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';

import {
  addChecklistItemAction,
  addCommentAction,
  assignTaskAction,
  changeStatusAction,
  deleteChecklistItemAction,
  deleteTaskAction,
  getTaskDetailAction,
  pauseTimerAction,
  startTimerAction,
  toggleChecklistItemAction,
  type TaskDetailPayload,
} from '@/app/actions/tasks';
import type { ShellPerson, ShellProject } from '@/components/layout/app-shell';
import { AttachmentsPanel } from '@/components/task/attachments-panel';
import { RecommendPanel } from '@/components/task/recommend-panel';
import { TaskRelationsPanel } from '@/components/task/task-relations-panel';
import { Avatar } from '@/components/ui/avatar';
import { Badge, PriorityFlag } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import {
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  PROJECT_TYPE_META,
  STATUS_META,
  type Role,
  type TaskStatus,
} from '@/lib/domain/constants';
import { transitionNeedsReason } from '@/lib/domain/task-machine';
import { cn } from '@/lib/utils';

import { TaskDialog } from './task-dialog';

/* ============================================================================
 * TASK DETAIL — a drawer, not a page
 * ----------------------------------------------------------------------------
 * doc 10 §3. Opening a task from the board must not lose the board: its filters,
 * its scroll position and the column you were looking at are all context you
 * need the moment you close the task again. A route change discards all three.
 *
 * ── EVERYTHING HERE IS AN ACTION, AND EACH ONE CAN BE REFUSED ────────────────
 * Status, assignee, checklist, comment, timer, delete. Every one round-trips to
 * a server action that consults the same domain rules the board does, and every
 * refusal is displayed in words. That is the point: "you cannot approve your own
 * work" is a designed behaviour (BR-002), so the interface has to be able to say
 * it rather than merely disable a control and leave someone guessing.
 *
 * ── THE STATUS DROPDOWN ONLY OFFERS LEGAL MOVES ──────────────────────────────
 * `allowed` is computed on the server by running doc 05 §2's transition table for
 * this actor against this task. So the list is short and honest — a member
 * looking at their own In Review task sees no way to approve it, because there
 * genuinely is not one.
 * ========================================================================= */

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function when(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const EMPTY: TaskDetailPayload = {
  task: null,
  comments: [],
  checklist: [],
  allowed: [],
  subtasks: [],
  dependencies: [],
  dependents: [],
  watchers: [],
  skills: [],
  extensions: [],
  attachments: [],
  storage: { configured: false, reason: null },
  isWatching: false,
  canEditGraph: false,
  canDecideExtensions: false,
  blockedWarning: null,
};

export function TaskDetail({
  taskId,
  onClose,
  currentUser,
  people,
  projects,
  onChanged,
}: {
  taskId: string | null;
  onClose: () => void;
  currentUser: { id: string; name: string; role: Role };
  people: readonly ShellPerson[];
  projects: readonly ShellProject[];
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<TaskDetailPayload>(EMPTY);
  /* Which task the current payload belongs to. `loading` is DERIVED from this
     rather than being its own state — a loading flag set in an effect body is
     the cascading render the compiler lint objects to, and deriving it also
     removes the possibility of the flag and the data disagreeing. */
  const [loadedId, setLoadedId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState('');
  const [newItem, setNewItem] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [reasonFor, setReasonFor] = React.useState<TaskStatus | null>(null);
  const [reasonText, setReasonText] = React.useState('');

  /** Re-read after an action. Called from event handlers, never from an effect. */
  const load = React.useCallback(async () => {
    if (!taskId) return;
    setData(await getTaskDetailAction(taskId));
  }, [taskId]);

  /* Clearing on close is a state adjustment, not a synchronisation. In an effect
     it would render the previous task's contents once more on the way out, which
     reads as the drawer flashing the wrong task. */
  const [lastTaskId, setLastTaskId] = React.useState<string | null>(taskId);
  if (lastTaskId !== taskId) {
    setLastTaskId(taskId);
    if (!taskId) {
      setData(EMPTY);
      setError(null);
    }
  }

  /* ── The initial fetch ──────────────────────────────────────────────────────
     State is set inside the promise callback, not in the effect body. That is
     not a lint workaround — it is the distinction the rule is drawing: an effect
     body that sets state causes a cascading render, whereas a callback firing
     when an external system answers is exactly what effects are for.

     `cancelled` matters in practice. Open task A, then task B before A's request
     returns, and without it A's payload arrives last and the drawer shows the
     wrong task under the right title. */
  React.useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    getTaskDetailAction(taskId)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoadedId(taskId);
      })
      .catch(() => {
        if (cancelled) return;
        setError('The task could not be loaded.');
        setLoadedId(taskId);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  /** Run an action, show its refusal, and reload on success. */
  const run = React.useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>) => {
      setBusy(true);
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'That could not be saved.');
      else {
        await load();
        onChanged();
      }
      setBusy(false);
      return result.ok;
    },
    [load, onChanged],
  );

  const loading = taskId !== null && loadedId !== taskId;
  const task = loading ? null : data.task;
  const status = task ? STATUS_META[task.status] : null;
  const limit = task ? (task.timeLimitMinutes ?? 0) + task.extensionMinutesGranted : 0;
  const timePct = task && limit > 0 ? Math.round((task.timeSpentMinutes / limit) * 100) : 0;
  const canTrack = task ? task.assigneeId === currentUser.id || currentUser.role !== 'member' : false;

  return (
    <>
      <Drawer
        open={taskId !== null}
        onClose={onClose}
        title={task ? task.title : loading ? 'Loading…' : 'Task'}
        subtitle={
          task && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-caption font-semibold text-text-brand">
                {task.reference}
              </span>
              <Badge token={PROJECT_TYPE_META[task.projectType].token} size="sm" dot={false}>
                {task.projectName}
              </Badge>
              {status && (
                <Badge token={status.token} size="sm">
                  {status.label}
                </Badge>
              )}
              <PriorityFlag token={PRIORITY_TOKEN[task.priority]} label={PRIORITY_LABEL[task.priority]} />
            </div>
          )
        }
        footer={
          task && (
            <div className="space-y-2">
              <label className="block text-micro font-semibold text-text-secondary" htmlFor="new-comment">
                Add a comment
              </label>
              <div className="flex items-end gap-2">
                <Textarea
                  id="new-comment"
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="What is the latest?"
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="md"
                  disabled={!comment.trim() || busy}
                  onClick={async () => {
                    const ok = await run(() => addCommentAction(task.id, comment));
                    if (ok) setComment('');
                  }}
                >
                  <Send className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  Post
                </Button>
              </div>
            </div>
          )
        }
      >
        {loading && !task && (
          <div className="flex items-center gap-2 py-8 text-caption text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading the task…
          </div>
        )}

        {!loading && !task && (
          <p className="py-8 text-caption text-text-secondary">
            That task is no longer available to you.
          </p>
        )}

        {task && (
          <div className="space-y-5">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                  border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
                }}
              >
                <AlertTriangle
                  className="mt-px h-4 w-4 shrink-0"
                  style={{ color: 'var(--feedback-error)' }}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <p className="text-caption text-text-primary">{error}</p>
              </div>
            )}

            {/* ---- Status and assignee ---- */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-micro font-semibold text-text-secondary" htmlFor="detail-status">
                  Status
                </label>
                <Select
                  size="md"
                  id="detail-status"
                  value={task.status}
                  disabled={busy || data.allowed.length === 0}
                  onChange={(event) => {
                    const to = event.target.value as TaskStatus;
                    if (to === task.status) return;
                    if (transitionNeedsReason(task.status, to)) {
                      setReasonText('');
                      setReasonFor(to);
                      return;
                    }
                    void run(() => changeStatusAction(task.id, to));
                  }}
                >
                  <option value={task.status}>{STATUS_META[task.status].label} (current)</option>
                  {data.allowed.map((to) => (
                    <option key={to} value={to}>
                      → {STATUS_META[to].label}
                      {transitionNeedsReason(task.status, to) ? ' (needs a reason)' : ''}
                    </option>
                  ))}
                </Select>
                {data.allowed.length === 0 && (
                  <p className="text-micro text-text-tertiary">
                    There is no move you can make from here.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-micro font-semibold text-text-secondary" htmlFor="detail-assignee">
                  Assignee
                </label>
                <Select
                  size="md"
                  id="detail-assignee"
                  value={task.assigneeId ?? ''}
                  disabled={busy || currentUser.role === 'member'}
                  onChange={(event) =>
                    void run(() => assignTaskAction(task.id, event.target.value || null))
                  }
                >
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
                {currentUser.role === 'member' && (
                  <p className="text-micro text-text-tertiary">
                    Only a coordinator can reassign work.
                  </p>
                )}
              </div>
            </div>

            {/* ---- Who should take this (doc 07) ---- */}
            {currentUser.role !== 'member' && (
              <RecommendPanel
                taskId={task.id}
                currentAssigneeId={task.assigneeId}
                busy={busy}
                onPick={(userId) => void run(() => assignTaskAction(task.id, userId))}
              />
            )}

            {task.blockedReason && (
              <div
                className="rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor:
                    'color-mix(in oklab, var(--status-blocked) var(--tint-soft), var(--bg-surface))',
                  border: '1px solid color-mix(in oklab, var(--status-blocked) 32%, transparent)',
                }}
              >
                <p className="text-micro font-semibold text-text-secondary">Blocked because</p>
                <p className="text-caption text-text-primary">{task.blockedReason}</p>
              </div>
            )}

            {task.assignmentOverrideReason && (
              <div
                className="rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor: 'var(--bg-gold-subtle)',
                  border: '1px solid color-mix(in oklab, var(--accent-gold) 30%, transparent)',
                }}
              >
                <p className="text-micro font-semibold text-text-secondary">
                  Assigned over the capacity limit (BR-003)
                </p>
                <p className="text-caption text-text-primary">{task.assignmentOverrideReason}</p>
              </div>
            )}

            {task.otherDescription && (
              <div className="rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5">
                <p className="text-micro font-semibold text-text-secondary">What this work is</p>
                <p className="text-caption text-text-primary">{task.otherDescription}</p>
              </div>
            )}

            {/* ---- Facts ---- */}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Effort', `${task.effortSize ?? '—'} · ${task.effortPoints} pts`],
                ['Priority', PRIORITY_LABEL[task.priority]],
                ['Due', task.dueDate ?? 'No due date'],
                ['Raised by', task.createdByName ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border-subtle bg-bg-surface px-3 py-2">
                  <dt className="text-micro text-text-tertiary">{label}</dt>
                  <dd className="truncate text-caption font-semibold text-text-primary">{value}</dd>
                </div>
              ))}
            </dl>

            {/* ---- Time (doc 17) ---- */}
            <section className="space-y-2 rounded-xl border border-border-subtle bg-bg-surface p-3.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-caption font-semibold text-text-primary">
                  <Clock className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} aria-hidden="true" />
                  Time
                </h3>
                {canTrack && (
                  <div className="flex gap-1.5">
                    {task.timerState === 'running' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(() => pauseTimerAction(task.id))}
                      >
                        <Pause className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(() => startTimerAction(task.id))}
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        Start
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {limit > 0 ? (
                <>
                  <ProgressBar
                    value={Math.min(timePct, 100)}
                    token={timePct > 100 ? 'feedback-error' : timePct > 90 ? 'feedback-warning' : 'accent-primary'}
                    size="md"
                  />
                  <p className="text-micro text-text-secondary">
                    <span className="tabular font-semibold text-text-primary">
                      {duration(task.timeSpentMinutes)}
                    </span>{' '}
                    of {duration(limit)}
                    {task.extensionMinutesGranted > 0 && (
                      <> (includes {duration(task.extensionMinutesGranted)} granted)</>
                    )}
                    {timePct > 100 && (
                      <>
                        {' — '}
                        <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                          {timePct - 100}% over
                        </span>
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-micro text-text-tertiary">
                  {duration(task.timeSpentMinutes)} logged · no limit set
                </p>
              )}
              {task.timerState === 'running' && (
                <p className="text-micro font-semibold" style={{ color: 'var(--status-progress)' }}>
                  Timer running
                </p>
              )}
            </section>

            {task.description && (
              <section>
                <h3 className="mb-1.5 text-caption font-semibold text-text-primary">Detail</h3>
                <p className="text-caption whitespace-pre-wrap text-text-secondary">
                  {task.description}
                </p>
              </section>
            )}

            {/* ---- Subtasks, dependencies, followers, skills, extra time ---- */}
            <TaskRelationsPanel
              data={data}
              currentUserId={currentUser.id}
              people={people.map((person) => ({ id: person.id, name: person.name }))}
              busy={busy}
              run={run}
            />

            {/* ---- Files (FR-029) ---- */}
            <AttachmentsPanel
              taskId={task.id}
              attachments={data.attachments}
              currentUserId={currentUser.id}
              canManage={data.canEditGraph}
              storage={data.storage}
              busy={busy}
              onChanged={load}
            />

            {/* ---- Checklist (FR-027) ---- */}
            <section className="space-y-2">
              <h3 className="text-caption font-semibold text-text-primary">
                Checklist
                {data.checklist.length > 0 && (
                  <span className="ml-1.5 text-micro font-normal text-text-tertiary">
                    {data.checklist.filter((i) => i.isDone).length} of {data.checklist.length} done
                  </span>
                )}
              </h3>

              <ul className="space-y-1">
                {data.checklist.map((item) => (
                  <li key={item.id} className="group flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.isDone}
                      disabled={busy}
                      onChange={(event) =>
                        void run(() => toggleChecklistItemAction(item.id, event.target.checked))
                      }
                      className="h-4 w-4 shrink-0 rounded border-border-strong accent-[var(--accent-primary)]"
                      aria-label={item.text}
                    />
                    <span
                      className={cn(
                        'flex-1 text-caption',
                        item.isDone ? 'text-text-tertiary line-through' : 'text-text-primary',
                      )}
                    >
                      {item.text}
                    </span>
                    <IconButton
                      label={`Remove ${item.text}`}
                      icon={Trash2}
                      size="sm"
                      onClick={() => void run(() => deleteChecklistItemAction(item.id))}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </li>
                ))}
              </ul>

              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!newItem.trim()) return;
                  const ok = await run(() => addChecklistItemAction(task.id, newItem));
                  if (ok) setNewItem('');
                }}
                className="flex gap-2"
              >
                <input
                  value={newItem}
                  onChange={(event) => setNewItem(event.target.value)}
                  placeholder="Add a step…"
                  aria-label="Add a checklist step"
                  className="h-8 flex-1 rounded-md border border-border-default bg-bg-surface px-2.5 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-border-brand focus-visible:outline-none"
                />
                <Button type="submit" variant="ghost" size="sm" disabled={!newItem.trim() || busy}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Add
                </Button>
              </form>
            </section>

            {/* ---- Comments ---- */}
            <section className="space-y-2.5">
              <h3 className="text-caption font-semibold text-text-primary">
                Comments
                {data.comments.length > 0 && (
                  <span className="ml-1.5 text-micro font-normal text-text-tertiary">
                    {data.comments.length}
                  </span>
                )}
              </h3>

              {data.comments.length === 0 && (
                <p className="text-micro text-text-tertiary">
                  Nothing yet. Comments are how a blocked task gets unblocked.
                </p>
              )}

              <ul className="space-y-3">
                {data.comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar name={c.authorName ?? 'Unknown'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-micro">
                        <span className="font-semibold text-text-primary">{c.authorName}</span>
                        <span className="text-text-tertiary"> · {when(c.createdAt)}</span>
                      </p>
                      <p className="text-caption whitespace-pre-wrap text-text-secondary">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* ---- Destructive and edit, kept apart from everything else ---- */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Edit details
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(() => deleteTaskAction(task.id));
                  if (ok) onClose();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Delete
              </Button>
              <span className="ml-auto text-micro text-text-tertiary">
                Deleting is reversible for 30 days (FR-095)
              </span>
            </div>
          </div>
        )}
      </Drawer>

      {/* ---- Reason prompt, for a status change made from the drawer ---- */}
      <Drawer
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={reasonFor ? `Move to ${STATUS_META[reasonFor].label}` : 'Reason'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!reasonText.trim() || busy}
              onClick={async () => {
                if (!task || !reasonFor) return;
                const to = reasonFor;
                setReasonFor(null);
                await run(() => changeStatusAction(task.id, to, reasonText));
              }}
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Confirm
            </Button>
          </div>
        }
      >
        <p className="mb-2 text-caption text-text-secondary">
          A written reason is required (FR-043). It is shown on the card and kept in the record.
        </p>
        <Textarea
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
          rows={4}
          autoFocus
          aria-label="Reason"
        />
      </Drawer>

      {/* ---- Edit ---- */}
      {task && (
        <TaskDialog
          open={editing}
          onClose={() => {
            setEditing(false);
            void load();
          }}
          projects={projects}
          people={people}
          currentUser={{ id: currentUser.id, role: currentUser.role }}
          task={task}
        />
      )}
    </>
  );
}
