'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  GitBranch,
  Link2,
  ListTree,
  Loader2,
  Plus,
  Repeat,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';

import {
  addDependencyAction,
  addSubtaskAction,
  decideExtensionAction,
  detachSubtaskAction,
  relationPickerAction,
  removeDependencyAction,
  removeTaskSkillAction,
  requestExtensionAction,
  setTaskSkillAction,
  setWatchingAction,
  type RelationResult,
} from '@/app/actions/task-relations';
import type { TaskDetailPayload } from '@/app/actions/tasks';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SKILL_WEIGHT_LABEL, STATUS_META } from '@/lib/domain/constants';
import { describeRecurrence, parseRecurrence } from '@/lib/domain/recurrence';
import { EXTENSION_STATUS_LABEL, formatMinutes } from '@/lib/domain/extensions';

/* ============================================================================
 * THE RELATIONS PANEL — Step 6
 * ----------------------------------------------------------------------------
 * Subtasks, dependencies, followers, required skills and extra time. Split out
 * of task-detail.tsx rather than added to it: that file was already 670 lines
 * and is mostly the status machine and the comment thread, which have nothing
 * to do with any of this.
 *
 * ── EVERY SECTION DISAPPEARS WHEN IT IS BOTH EMPTY AND UNAVAILABLE ───────────
 * A Member sees no dependency section at all, rather than a disabled one with
 * an explanatory tooltip — unless the task already has dependencies, in which
 * case they see them read-only, because what is holding their work up is
 * exactly the thing they most need to know. Showing somebody a control they can
 * never use is a small, repeated insult; hiding information they need is worse.
 * ========================================================================= */

type Section = { title: string; icon: typeof ListTree; children: React.ReactNode };

function Panel({ title, icon: Icon, action, children }: {
  title: string;
  icon: typeof ListTree;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-border-subtle bg-bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <Icon className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusDot({ status }: { status: string }) {
  const meta = STATUS_META[status as keyof typeof STATUS_META];
  if (!meta) return null;
  return (
    <span
      aria-hidden="true"
      title={meta.label}
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: `var(--${meta.token})` }}
    />
  );
}

export function TaskRelationsPanel({
  data,
  currentUserId,
  people,
  busy,
  run,
}: {
  data: TaskDetailPayload;
  currentUserId: string;
  people: readonly { id: string; name: string }[];
  busy: boolean;
  run: (fn: () => Promise<RelationResult>) => Promise<boolean>;
}) {
  const task = data.task;

  const [addingSubtask, setAddingSubtask] = React.useState(false);
  const [subtaskTitle, setSubtaskTitle] = React.useState('');
  const [subtaskAssignee, setSubtaskAssignee] = React.useState('');

  const [depQuery, setDepQuery] = React.useState('');
  const [picker, setPicker] = React.useState<{
    skills: Array<{ id: string; label: string; category: string | null }>;
    tasks: Array<{ id: string; reference: string; title: string; status: string }>;
  }>({ skills: [], tasks: [] });
  /* The last query the server has answered for. `searching` is DERIVED from
     the gap between this and what is typed, rather than being its own flag set
     at the top of the effect — a flag set in an effect body is the cascading
     render the compiler lint objects to, and deriving it also removes the
     possibility of the spinner and the results disagreeing. */
  const [answeredFor, setAnsweredFor] = React.useState('');

  const [skillId, setSkillId] = React.useState('');
  const [skillWeight, setSkillWeight] = React.useState('2');

  const [askingTime, setAskingTime] = React.useState(false);
  const [askMinutes, setAskMinutes] = React.useState('60');
  const [askReason, setAskReason] = React.useState('');

  const [decidingId, setDecidingId] = React.useState<string | null>(null);
  const [grantMinutes, setGrantMinutes] = React.useState('');
  const [decisionNote, setDecisionNote] = React.useState('');

  /* The skills list is small and static enough to fetch once when the panel
     first renders with a task; the task search re-runs as they type. Both come
     from one action, so opening the drawer costs one request, not two. */
  React.useEffect(() => {
    if (!task) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      relationPickerAction(depQuery)
        .then((result) => {
          if (cancelled) return;
          setPicker(result);
          setAnsweredFor(depQuery);
        })
        .catch(() => {
          if (cancelled) return;
          setAnsweredFor(depQuery);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [depQuery, task?.id, task]);

  if (!task) return null;

  const searching = depQuery.trim().length >= 2 && answeredFor !== depQuery;

  const pendingExtension = data.extensions.find((e) => e.status === 'pending');
  const decidedExtensions = data.extensions.filter((e) => e.status !== 'pending');
  const canAskForTime = task.assigneeId === currentUserId && task.timeLimitMinutes !== null;
  const alreadyLinked = new Set([
    task.id,
    ...data.dependencies.map((d) => d.dependsOnTaskId),
  ]);

  const repeat = task.recurrenceRule ? parseRecurrence(task.recurrenceRule) : null;

  return (
    <div className="space-y-3">
      {/* ── BR-008 · what is holding this up ─────────────────────────────── */}
      {data.blockedWarning && (
        <div
          className="flex items-start gap-2.5 rounded-xl px-3.5 py-3"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-warning) 32%, transparent)',
          }}
        >
          <AlertTriangle
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-warning)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-primary">{data.blockedWarning}</p>
        </div>
      )}

      {/* ── Repeats ───────────────────────────────────────────────────────── */}
      {repeat?.ok && (
        <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-bg-surface-sunken px-3.5 py-2.5">
          <Repeat className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          <p className="text-micro text-text-secondary">
            <span className="font-semibold text-text-primary">
              {describeRecurrence(repeat.rule)}.
            </span>{' '}
            The next one is created when this is marked done — not on a timer, so the series can
            never run ahead of the work.
          </p>
        </div>
      )}

      {/* ── Subtasks ──────────────────────────────────────────────────────── */}
      {(data.subtasks.length > 0 || !task.parentTaskId) && (
        <Panel
          title={
            data.subtasks.length > 0
              ? `Subtasks · ${data.subtasks.filter((s) => s.status === 'done').length} of ${data.subtasks.length} done`
              : 'Subtasks'
          }
          icon={ListTree}
          action={
            !task.parentTaskId && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setAddingSubtask((open) => !open)}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                Add
              </Button>
            )
          }
        >
          {data.subtasks.length === 0 && !addingSubtask && (
            <p className="text-micro text-text-tertiary">
              Break a large task into pieces so progress is visible and the load can be shared. For
              smaller steps, the checklist below costs nothing.
            </p>
          )}

          {data.subtasks.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {data.subtasks.map((sub) => (
                <li key={sub.id} className="flex items-center gap-2 py-1.5">
                  <StatusDot status={sub.status} />
                  <span className="tabular shrink-0 text-micro font-semibold text-text-brand">
                    {sub.reference}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                    {sub.title}
                  </span>
                  {sub.assigneeName && <Avatar name={sub.assigneeName} size="xs" />}
                  {data.canEditGraph && (
                    <IconButton
                      label={`Detach ${sub.reference}`}
                      icon={X}
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => detachSubtaskAction(sub.id))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {addingSubtask && (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-surface-sunken p-2.5">
              <Input
                value={subtaskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                placeholder="What is the piece of work?"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Select
                  size="md"
                  value={subtaskAssignee}
                  onChange={(event) => setSubtaskAssignee(event.target.value)}
                  className="min-w-[10rem] flex-1"
                >
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  size="md"
                  disabled={busy || !subtaskTitle.trim()}
                  onClick={async () => {
                    const ok = await run(() =>
                      addSubtaskAction(task.id, {
                        title: subtaskTitle,
                        assigneeId: subtaskAssignee || null,
                        /* Small by default. A subtask created at the parent's
                           size would double-count the parent's cost the moment
                           it is added. */
                        effortPoints: 2,
                      }),
                    );
                    if (ok) {
                      setSubtaskTitle('');
                      setSubtaskAssignee('');
                      setAddingSubtask(false);
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── Dependencies ──────────────────────────────────────────────────── */}
      {(data.dependencies.length > 0 || data.dependents.length > 0 || data.canEditGraph) && (
        <Panel title="Waiting on" icon={GitBranch}>
          {data.dependencies.length === 0 && (
            <p className="text-micro text-text-tertiary">Nothing. This can start whenever.</p>
          )}

          {data.dependencies.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {data.dependencies.map((dep) => (
                <li key={dep.dependsOnTaskId} className="flex items-center gap-2 py-1.5">
                  <StatusDot status={dep.status} />
                  <span className="tabular shrink-0 text-micro font-semibold text-text-brand">
                    {dep.reference}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                    {dep.title}
                  </span>
                  <span className="shrink-0 text-micro text-text-tertiary">
                    {STATUS_META[dep.status]?.label}
                  </span>
                  {data.canEditGraph && (
                    <IconButton
                      label={`Stop waiting on ${dep.reference}`}
                      icon={X}
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() => removeDependencyAction(task.id, dep.dependsOnTaskId))
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {data.canEditGraph && (
            <div className="space-y-1.5">
              <Input
                value={depQuery}
                onChange={(event) => setDepQuery(event.target.value)}
                placeholder="Search a task by reference or title…"
              />
              {searching && (
                <p className="flex items-center gap-1.5 text-micro text-text-tertiary">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Searching…
                </p>
              )}
              {picker.tasks.filter((t) => !alreadyLinked.has(t.id)).length > 0 && (
                <ul className="max-h-40 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border-subtle">
                  {picker.tasks
                    .filter((t) => !alreadyLinked.has(t.id))
                    .map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          disabled={busy}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg-hover disabled:opacity-50"
                          onClick={async () => {
                            const ok = await run(() =>
                              addDependencyAction(task.id, candidate.id, 'blocks'),
                            );
                            if (ok) setDepQuery('');
                          }}
                        >
                          <StatusDot status={candidate.status} />
                          <span className="tabular shrink-0 text-micro font-semibold text-text-brand">
                            {candidate.reference}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                            {candidate.title}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {data.dependents.length > 0 && (
            <div className="border-t border-border-subtle pt-2">
              <p className="mb-1 text-micro font-semibold text-text-secondary">
                <Link2 className="mr-1 inline h-3 w-3 align-[-1px]" strokeWidth={2} aria-hidden="true" />
                Waiting on this
              </p>
              <ul className="space-y-1">
                {data.dependents.map((dep) => (
                  <li key={dep.taskId} className="flex items-center gap-2">
                    <StatusDot status={dep.status} />
                    <span className="tabular shrink-0 text-micro font-semibold text-text-brand">
                      {dep.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
                      {dep.title}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-text-tertiary">
                Finishing this unblocks {data.dependents.length === 1 ? 'it' : 'them'}.
              </p>
            </div>
          )}
        </Panel>
      )}

      {/* ── Required skills (FR-055) ──────────────────────────────────────── */}
      {(data.skills.length > 0 || data.canEditGraph) && (
        <Panel title="Skills this needs" icon={Sparkles}>
          {data.skills.length === 0 && (
            <p className="text-micro text-text-tertiary">
              None set. Without these, an assignment suggestion has only availability and fairness
              to go on.
            </p>
          )}

          {data.skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {data.skills.map((skill) => (
                <li key={skill.skillId}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface-sunken py-0.5 pl-2.5 pr-1">
                    <span className="text-micro font-medium text-text-primary">{skill.label}</span>
                    <span className="text-micro text-text-tertiary">
                      {SKILL_WEIGHT_LABEL[skill.weight]}
                    </span>
                    {!skill.isActive && (
                      <span className="text-micro text-text-tertiary">· retired</span>
                    )}
                    {data.canEditGraph && (
                      <IconButton
                        label={`Remove ${skill.label}`}
                        icon={X}
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(() => removeTaskSkillAction(task.id, skill.skillId))}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {data.canEditGraph && (
            <div className="flex flex-wrap gap-2">
              <Select
                size="md"
                value={skillId}
                onChange={(event) => setSkillId(event.target.value)}
                className="min-w-[10rem] flex-1"
              >
                <option value="">Add a skill…</option>
                {picker.skills
                  .filter((s) => !data.skills.some((existing) => existing.skillId === s.id))
                  .map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.category ? `${skill.category} · ${skill.label}` : skill.label}
                    </option>
                  ))}
              </Select>
              <Select
                size="md"
                value={skillWeight}
                onChange={(event) => setSkillWeight(event.target.value)}
              >
                <option value="1">Nice to have</option>
                <option value="2">Needed</option>
                <option value="3">Essential</option>
              </Select>
              <Button
                variant="secondary"
                size="md"
                disabled={busy || !skillId}
                onClick={async () => {
                  const ok = await run(() =>
                    setTaskSkillAction(task.id, skillId, Number(skillWeight)),
                  );
                  if (ok) setSkillId('');
                }}
              >
                Add
              </Button>
            </div>
          )}
        </Panel>
      )}

      {/* ── Followers ─────────────────────────────────────────────────────── */}
      <Panel
        title={data.watchers.length > 0 ? `Followers · ${data.watchers.length}` : 'Followers'}
        icon={data.isWatching ? Bell : BellOff}
        action={
          <Button
            variant={data.isWatching ? 'secondary' : 'ghost'}
            size="sm"
            disabled={busy}
            onClick={() => void run(() => setWatchingAction(task.id, !data.isWatching))}
          >
            {data.isWatching ? 'Stop following' : 'Follow'}
          </Button>
        }
      >
        {data.watchers.length === 0 ? (
          <p className="text-micro text-text-tertiary">
            Following a task sends you its comments and status changes without putting it on your
            plate — it stays assigned to whoever has it.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {data.watchers.map((watcher) => (
              <li
                key={watcher.userId}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface-sunken py-0.5 pl-1 pr-2.5"
              >
                <Avatar name={watcher.fullName} size="xs" />
                <span className="text-micro text-text-primary">
                  {watcher.userId === currentUserId ? 'You' : watcher.fullName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Extra time (doc 17 §5) ────────────────────────────────────────── */}
      {(data.extensions.length > 0 || canAskForTime) && (
        <Panel
          title="Extra time"
          icon={Timer}
          action={
            canAskForTime &&
            !pendingExtension && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setAskingTime((open) => !open)}
              >
                Ask for more
              </Button>
            )
          }
        >
          {askingTime && !pendingExtension && (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-surface-sunken p-2.5">
              <div className="flex gap-2">
                <Select
                  size="md"
                  value={askMinutes}
                  onChange={(event) => setAskMinutes(event.target.value)}
                  className="w-40"
                >
                  {[15, 30, 60, 90, 120, 180, 240, 480].map((m) => (
                    <option key={m} value={m}>
                      {formatMinutes(m)}
                    </option>
                  ))}
                </Select>
              </div>
              <Textarea
                rows={2}
                value={askReason}
                onChange={(event) => setAskReason(event.target.value)}
                placeholder="What happened? The Admin deciding this was not there."
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAskingTime(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || askReason.trim().length < 10}
                  onClick={async () => {
                    const ok = await run(() =>
                      requestExtensionAction(task.id, Number(askMinutes), askReason),
                    );
                    if (ok) {
                      setAskReason('');
                      setAskingTime(false);
                    }
                  }}
                >
                  Send to the Admins
                </Button>
              </div>
            </div>
          )}

          {pendingExtension && (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-surface-sunken p-2.5">
              <p className="text-caption text-text-primary">
                <span className="font-semibold">
                  {pendingExtension.requestedByName ?? 'Somebody'} asked for{' '}
                  {formatMinutes(pendingExtension.requestedMinutes)} more.
                </span>
              </p>
              <p className="text-micro italic text-text-secondary">“{pendingExtension.reason}”</p>

              {data.canDecideExtensions ? (
                decidingId === pendingExtension.id ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="number"
                        min={5}
                        max={pendingExtension.requestedMinutes}
                        value={grantMinutes || String(pendingExtension.requestedMinutes)}
                        onChange={(event) => setGrantMinutes(event.target.value)}
                        className="w-28"
                      />
                      <span className="self-center text-micro text-text-tertiary">
                        minutes, of {formatMinutes(pendingExtension.requestedMinutes)} asked
                      </span>
                    </div>
                    <Textarea
                      rows={2}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                      placeholder="A note. Required if you decline."
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDecidingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || decisionNote.trim().length < 10}
                        onClick={async () => {
                          const ok = await run(() =>
                            decideExtensionAction(pendingExtension.id, 'decline', {
                              note: decisionNote,
                            }),
                          );
                          if (ok) setDecidingId(null);
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await run(() =>
                            decideExtensionAction(pendingExtension.id, 'approve', {
                              grantedMinutes: Number(
                                grantMinutes || pendingExtension.requestedMinutes,
                              ),
                              note: decisionNote,
                            }),
                          );
                          if (ok) setDecidingId(null);
                        }}
                      >
                        Grant
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* doc 17 §5 — the context, so the decision is not a rubber stamp. */}
                    <span className="text-micro text-text-tertiary">
                      Used {formatMinutes(pendingExtension.taskSpentMinutes)} of{' '}
                      {formatMinutes(pendingExtension.taskLimitMinutes ?? 0)}
                      {pendingExtension.priorDecidedOnTask > 0 && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--feedback-warning)' }}>
                            extension #{pendingExtension.priorDecidedOnTask + 1} — the estimate was
                            probably low, not the work slow
                          </span>
                        </>
                      )}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => {
                        setDecidingId(pendingExtension.id);
                        setGrantMinutes(String(pendingExtension.requestedMinutes));
                        setDecisionNote('');
                      }}
                    >
                      Decide
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-micro text-text-tertiary">
                  Waiting on an Admin. Keep working — nothing is locked while it sits here.
                </p>
              )}
            </div>
          )}

          {decidedExtensions.length > 0 && (
            <ul className="space-y-1.5">
              {decidedExtensions.map((request) => (
                <li key={request.id} className="text-micro text-text-secondary">
                  <Badge
                    token={
                      request.status === 'declined'
                        ? 'feedback-error'
                        : request.status === 'partially_approved'
                          ? 'feedback-warning'
                          : 'feedback-success'
                    }
                    size="sm"
                    variant="outline"
                  >
                    {EXTENSION_STATUS_LABEL[request.status]}
                  </Badge>{' '}
                  {request.grantedMinutes
                    ? `${formatMinutes(request.grantedMinutes)} of ${formatMinutes(request.requestedMinutes)}`
                    : formatMinutes(request.requestedMinutes)}
                  {request.decidedByName && <> · {request.decidedByName}</>}
                  {request.decisionNote && (
                    <span className="block italic text-text-tertiary">
                      “{request.decisionNote}”
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!canAskForTime && data.extensions.length === 0 && (
            <p className="text-micro text-text-tertiary">
              Only the person the task is assigned to can ask for more time, and only once a limit
              is set.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

export type { Section };
