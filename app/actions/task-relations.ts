'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { notify, record } from '@/lib/db/queries/feed';
import * as R from '@/lib/db/queries/task-relations';
import * as T from '@/lib/db/queries/tasks';
import { STATUS_META } from '@/lib/domain/constants';
import {
  canHaveSubtask,
  wouldCreateCycle,
  type DependencyType,
} from '@/lib/domain/dependencies';
import {
  buildDecisionContext,
  canDecideExtensions,
  formatMinutes,
  outcomeStatus,
  validateDecision,
  validateRequest,
} from '@/lib/domain/extensions';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * TASK RELATION ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * Dependencies, watchers, required skills and time extensions. Same contract as
 * app/actions/tasks.ts: authenticate → authorise → validate → domain → persist
 * → log, and no rule decided here.
 *
 * ── TWO GATES, NOT ONE, AND THEY ARE NOT REDUNDANT ───────────────────────────
 * Each action checks `can()` AND the database enforces an RLS policy. They
 * answer different questions. `can()` produces a sentence somebody can act on
 * ("a Coordinator sets the limit but does not extend it"); RLS guarantees that
 * a request which never reached this file still cannot write. Removing either
 * one leaves a real hole: without `can()` the user gets a raw permission error,
 * and without RLS the check is only as good as every future call site.
 * ========================================================================= */

export interface RelationResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly warning?: string;
  readonly note?: string;
}

const fail = (error: string): RelationResult => ({ ok: false, error });

function touch(): void {
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  revalidatePath('/dashboard');
}

/* ==========================================================================
 * DEPENDENCIES
 * ========================================================================== */

/**
 * `task_dependencies_write` is `sees_all_work()` — Coordinator and above.
 *
 * A Member cannot draw the graph even on their own task, which is deliberate:
 * a dependency changes when somebody else's work is expected to be finished, so
 * it is a planning act, not a personal one.
 */
function canEditGraph(role: string): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'team_coordinator';
}

export async function addDependencyAction(
  taskId: string,
  dependsOnTaskId: string,
  type: DependencyType = 'blocks',
): Promise<RelationResult> {
  const user = await requireUser();
  if (!canEditGraph(user.role)) {
    return fail('Coordinators and above set what a task waits on.');
  }
  if (taskId === dependsOnTaskId) return fail('A task cannot wait on itself.');

  const [task, blocker] = await Promise.all([
    T.getTask(user.id, taskId),
    T.getTask(user.id, dependsOnTaskId),
  ]);
  if (!task) return fail('That task no longer exists.');
  if (!blocker) return fail('That task no longer exists, or you cannot see it.');

  /* The cycle check reads the whole visible graph, because a loop can close
     through any path — A → B → C → A is the case that matters, and a check on
     immediate neighbours would miss it entirely. */
  const edges = await R.listAllDependencyEdges(user.id);
  const cycle = wouldCreateCycle(edges, taskId, dependsOnTaskId);
  if (cycle.wouldCycle) {
    return fail(
      `That would make a loop: ${blocker.reference} already waits on ${task.reference}, directly or through other tasks. Nothing in a loop can ever start.`,
    );
  }

  await R.addDependency(user.id, { taskId, dependsOnTaskId, type });

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'task',
      entityId: taskId,
      action: 'dependency_added',
      summary: `made ${task.reference} wait on ${blocker.reference}`,
      after: { dependsOn: blocker.reference, type },
    }),
  );

  touch();
  return {
    ok: true,
    note:
      type === 'blocks'
        ? `${task.reference} now waits on ${blocker.reference}.`
        : `Linked ${task.reference} to ${blocker.reference}.`,
  };
}

export async function removeDependencyAction(
  taskId: string,
  dependsOnTaskId: string,
): Promise<RelationResult> {
  const user = await requireUser();
  if (!canEditGraph(user.role)) return fail('Coordinators and above manage dependencies.');

  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  await R.removeDependency(user.id, taskId, dependsOnTaskId);

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'task',
      entityId: taskId,
      action: 'dependency_removed',
      summary: `removed a dependency from ${task.reference}`,
    }),
  );

  touch();
  return { ok: true, note: 'Removed.' };
}

/* ==========================================================================
 * WATCHERS
 * ========================================================================== */

/**
 * Follow a task you are not assigned.
 *
 * Anybody may add or remove THEMSELVES; a Coordinator and above may manage
 * anyone's — which matches `task_watchers_write` exactly. Adding somebody else
 * as a watcher is a small thing that has a real effect on their notifications,
 * so it is not something a peer can do to a peer.
 */
export async function setWatchingAction(
  taskId: string,
  watching: boolean,
  userId?: string,
): Promise<RelationResult> {
  const user = await requireUser();
  const target = userId ?? user.id;

  if (target !== user.id && !canEditGraph(user.role)) {
    return fail('You can follow a task yourself, but only a Coordinator can add somebody else.');
  }

  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  if (watching) await R.addWatcher(user.id, taskId, target);
  else await R.removeWatcher(user.id, taskId, target);

  /* Notifying somebody they have been added is the point — a watcher who does
     not know they are watching is just noise arriving later. Adding yourself
     needs no announcement. */
  if (watching && target !== user.id) {
    await withUser(user.id, (tx) =>
      notify(tx, user.id, {
        userId: target,
        kind: 'task_status_changed',
        title: `You are now following ${task.reference}`,
        body: task.title,
        linkTo: '/tasks',
        entityId: taskId,
      }),
    );
  }

  touch();
  return {
    ok: true,
    note: watching
      ? target === user.id
        ? 'Following. You will hear about comments and status changes.'
        : 'Added as a follower, and told.'
      : 'No longer following.',
  };
}

/* ==========================================================================
 * REQUIRED SKILLS — FR-055
 * ========================================================================== */

export async function setTaskSkillAction(
  taskId: string,
  skillId: string,
  weight: number,
): Promise<RelationResult> {
  const user = await requireUser();
  if (!canEditGraph(user.role)) {
    return fail('Coordinators and above set what a task needs.');
  }
  if (![1, 2, 3].includes(weight)) return fail('Pick nice to have, needed, or essential.');

  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  await R.setTaskSkill(user.id, taskId, skillId, weight);

  touch();
  return { ok: true, note: 'Saved. This is what the assignment suggestions read.' };
}

export async function removeTaskSkillAction(
  taskId: string,
  skillId: string,
): Promise<RelationResult> {
  const user = await requireUser();
  if (!canEditGraph(user.role)) return fail('Coordinators and above set what a task needs.');
  await R.removeTaskSkill(user.id, taskId, skillId);
  touch();
  return { ok: true };
}

/* ==========================================================================
 * SUBTASKS
 * ========================================================================== */

/**
 * A subtask is a task. It inherits the parent's project — moving a child to a
 * different project from its parent produces a parent whose progress is spread
 * across two projects, which no report can then reconcile.
 */
export async function addSubtaskAction(
  parentId: string,
  input: { title: string; assigneeId: string | null; effortPoints: number },
): Promise<RelationResult> {
  const user = await requireUser();

  const parent = await T.getTask(user.id, parentId);
  if (!parent) return fail('That task no longer exists.');

  const actor = { role: user.role, id: user.id };
  const isOwn = parent.assigneeId === user.id || parent.createdById === user.id;
  if (!can(actor, 'task.create_in_project', { isProjectMember: isOwn }) && !isOwn) {
    return fail('You cannot add work to this task.');
  }
  if (!input.title.trim()) return fail('Give the subtask a title.');

  const depth = await R.subtaskDepth(user.id, parentId);
  if (!canHaveSubtask(depth)) {
    return fail(
      'A subtask cannot have subtasks of its own. Use the checklist on this task for the smaller steps — it is the same idea without the cost of a task each.',
    );
  }

  /* A Member may create work for themselves and nobody else (doc 03 §3.3). */
  const assigneeId =
    input.assigneeId && input.assigneeId !== user.id
      ? can(actor, 'task.create_for_other')
        ? input.assigneeId
        : null
      : (input.assigneeId ?? null);

  if (input.assigneeId && input.assigneeId !== user.id && assigneeId === null) {
    return fail('You can only create work for yourself.');
  }

  const created = await T.createTask(user.id, {
    title: input.title,
    projectId: parent.projectId,
    parentTaskId: parentId,
    assigneeId,
    priority: parent.priority,
    effortPoints: input.effortPoints,
    otherDescription: parent.otherDescription ?? undefined,
    status: 'todo',
  });

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'task',
      entityId: created.id,
      action: 'created',
      summary: `added ${created.reference} under ${parent.reference}`,
    });
    if (assigneeId && assigneeId !== user.id) {
      await notify(tx, user.id, {
        userId: assigneeId,
        kind: 'task_assigned',
        title: `${created.reference} — ${created.title}`,
        body: `Part of ${parent.reference}`,
        linkTo: '/my-work',
        entityId: created.id,
      });
    }
  });

  touch();
  return { ok: true, note: `${created.reference} added.` };
}

/**
 * Detach a subtask from its parent. It becomes a task in its own right rather
 * than being deleted — the work still exists, it just is not part of that
 * container any more.
 */
export async function detachSubtaskAction(subtaskId: string): Promise<RelationResult> {
  const user = await requireUser();
  if (!canEditGraph(user.role)) return fail('Coordinators and above restructure work.');

  const task = await T.getTask(user.id, subtaskId);
  if (!task) return fail('That task no longer exists.');
  if (!task.parentTaskId) return fail('That task is not a subtask.');

  await withUser(user.id, async (tx) => {
    await tx`update public.tasks set parent_task_id = null where id = ${subtaskId}`;
    await record(tx, user.id, {
      entityType: 'task',
      entityId: subtaskId,
      action: 'updated',
      summary: `made ${task.reference} a task in its own right`,
    });
  });

  touch();
  return { ok: true, note: `${task.reference} is now a standalone task.` };
}

/* ==========================================================================
 * TIME EXTENSIONS — doc 17 §5
 * ========================================================================== */

export async function requestExtensionAction(
  taskId: string,
  requestedMinutes: unknown,
  reason: string,
): Promise<RelationResult> {
  const user = await requireUser();

  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  const pendingAlready = await R.hasPendingExtension(user.id, taskId);
  const check = validateRequest({
    requestedMinutes,
    reason,
    hasTimeLimit: task.timeLimitMinutes !== null,
    pendingAlready,
  });
  if (!check.ok) return fail(check.message);

  const minutes = Number(requestedMinutes);
  const requestId = await R.createExtensionRequest(user.id, {
    taskId,
    requestedMinutes: minutes,
    reason,
  });

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'task',
      entityId: taskId,
      action: 'extension_requested',
      summary: `asked for ${formatMinutes(minutes)} more on ${task.reference}`,
      after: { requestedMinutes: minutes, reason: reason.trim() },
    });

    /* Every Admin, because any one of them can decide and none of them is the
       designated approver. Notifying only one would make the queue depend on
       who happened to be picked. */
    const admins = await tx`
      select id from public.users
       where role in ('admin', 'super_admin') and is_active and id <> ${user.id}
    `;
    for (const row of admins) {
      await notify(tx, user.id, {
        userId: row.id as string,
        kind: 'time_extension_requested',
        title: `${task.reference} — ${formatMinutes(minutes)} more time requested`,
        body: reason.trim().slice(0, 140),
        linkTo: '/tasks',
        entityId: requestId,
      });
    }
  });

  touch();
  return {
    ok: true,
    note: 'Sent to the Admins. Keep working — nothing is locked while you wait.',
  };
}

export async function decideExtensionAction(
  requestId: string,
  decision: 'approve' | 'decline',
  input: { grantedMinutes?: unknown; note?: string } = {},
): Promise<RelationResult> {
  const user = await requireUser();

  /* BR-018 up front, before anything is read, so a Coordinator gets the rule
     rather than a lookup failure. */
  if (!canDecideExtensions(user.role)) {
    return fail(
      'Only an Admin can grant or decline extra time. A Coordinator sets the original limit but does not extend it (BR-018).',
    );
  }

  const pending = await R.listPendingExtensions(user.id);
  const request = pending.find((r) => r.id === requestId);
  if (!request) return fail('That request has already been decided, or no longer exists.');

  const granted =
    decision === 'approve'
      ? Number(input.grantedMinutes ?? request.requestedMinutes)
      : 0;

  const check = validateDecision({
    role: user.role,
    decision,
    requestedMinutes: request.requestedMinutes,
    grantedMinutes: granted,
    note: input.note ?? '',
    currentStatus: request.status,
  });
  if (!check.ok) return fail(check.message);

  const status = outcomeStatus(decision, request.requestedMinutes, granted);
  const applied = await R.decideExtension(user.id, {
    requestId,
    status,
    grantedMinutes: decision === 'approve' ? granted : null,
    note: input.note ?? null,
  });

  /* Null means another Admin decided it in the seconds since it was read. The
     outcome they wanted is already true, so this is not an error — but the
     minutes must not be applied twice, and they should be told whose decision
     stands. */
  if (!applied) return fail('Another Admin decided this one first. Their decision stands.');

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'task',
      entityId: request.taskId,
      action: `extension.${decision}`,
      before: { limitMinutes: request.taskLimitMinutes },
      after: {
        status,
        grantedMinutes: applied.appliedMinutes,
        requestedMinutes: request.requestedMinutes,
        note: input.note ?? null,
      },
    });

    await record(tx, user.id, {
      entityType: 'task',
      entityId: request.taskId,
      action: decision === 'approve' ? 'extension_granted' : 'extension_declined',
      summary:
        decision === 'approve'
          ? `granted ${formatMinutes(applied.appliedMinutes)} more on ${request.taskReference}`
          : `declined more time on ${request.taskReference}`,
    });

    await notify(tx, user.id, {
      userId: request.requestedById,
      kind: 'time_extension_decided',
      title:
        decision === 'approve'
          ? status === 'partially_approved'
            ? `${request.taskReference} — ${formatMinutes(applied.appliedMinutes)} granted of ${formatMinutes(request.requestedMinutes)} asked`
            : `${request.taskReference} — ${formatMinutes(applied.appliedMinutes)} granted`
          : `${request.taskReference} — more time declined`,
      body: input.note?.trim() || request.taskTitle,
      linkTo: '/my-work',
      entityId: request.taskId,
    });
  });

  touch();
  return {
    ok: true,
    note:
      decision === 'approve'
        ? `${formatMinutes(applied.appliedMinutes)} added to the limit. They have been told.`
        : 'Declined, with your reason. They have been told.',
  };
}

/** The decision screen's context block — doc 17 §5's "intelligent part". */
export async function extensionQueueAction(): Promise<{
  requests: Array<R.ExtensionRow & { context: ReturnType<typeof buildDecisionContext> }>;
  canDecide: boolean;
}> {
  const user = await requireUser();
  const requests = await R.listPendingExtensions(user.id);

  const today = new Date();
  const withContext = requests.map((request) => ({
    ...request,
    context: buildDecisionContext({
      consumedMinutes: request.taskSpentMinutes,
      limitMinutes: request.taskLimitMinutes ?? 0,
      priorExtensionsOnTask: request.priorDecidedOnTask,
      requesterUtilisationPct: null,
      daysToDue: request.taskDueDate
        ? Math.round(
            (Date.parse(`${request.taskDueDate}T00:00:00Z`) -
              Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
              86_400_000,
          )
        : null,
    }),
  }));

  return { requests: withContext, canDecide: canDecideExtensions(user.role) };
}

/* ==========================================================================
 * BULK ACTIONS
 * ========================================================================== */

export interface BulkResult extends RelationResult {
  readonly succeeded: number;
  readonly failed: number;
  /** One line per task that refused, so the reason is not lost in a count. */
  readonly refusals: readonly string[];
}

/**
 * Apply one change to several tasks.
 *
 * ── EACH TASK IS DECIDED SEPARATELY, AND THAT IS THE FEATURE ─────────────────
 * The obvious implementation checks the permission once and writes N rows. That
 * is wrong here: the same actor may legally move four of five selected tasks
 * and be refused on the fifth by BR-002, because they happen to be assigned to
 * it. Deciding once would either approve the illegal one or refuse the four
 * legal ones.
 *
 * ── AND IT IS NOT ONE TRANSACTION ────────────────────────────────────────────
 * Partial success is the honest outcome. Rolling back four legal changes
 * because a fifth was refused throws away work somebody meant to do, for the
 * sake of a tidiness nobody asked for. The result names exactly what refused
 * and why.
 */
export async function bulkChangeStatusAction(
  taskIds: readonly string[],
  to: string,
  reason?: string,
): Promise<BulkResult> {
  const { changeStatusAction } = await import('./tasks');

  const refusals: string[] = [];
  let succeeded = 0;

  for (const taskId of taskIds) {
    const result = await changeStatusAction(taskId, to as never, reason);
    if (result.ok) succeeded += 1;
    else refusals.push(result.error ?? 'Refused.');
  }

  /* Sequential rather than Promise.all: every one of these writes to
     `activity_log` and may write notifications, and firing twenty at once at a
     pooled connection to save a few hundred milliseconds on a rare action is a
     bad trade against the connection limit. */

  touch();
  return {
    ok: succeeded > 0,
    succeeded,
    failed: refusals.length,
    refusals: [...new Set(refusals)],
    error: succeeded === 0 ? (refusals[0] ?? 'Nothing changed.') : undefined,
    note:
      refusals.length === 0
        ? `${succeeded} ${succeeded === 1 ? 'task' : 'tasks'} moved to ${STATUS_META[to as keyof typeof STATUS_META]?.label ?? to}.`
        : `${succeeded} moved, ${refusals.length} refused.`,
  };
}

export async function bulkAssignAction(
  taskIds: readonly string[],
  assigneeId: string,
): Promise<BulkResult> {
  const { assignTaskAction } = await import('./tasks');

  const refusals: string[] = [];
  let succeeded = 0;

  for (const taskId of taskIds) {
    const result = await assignTaskAction(taskId, assigneeId);
    if (result.ok) succeeded += 1;
    else refusals.push(result.error ?? 'Refused.');
  }

  /* Sequential is REQUIRED here, not merely preferred. Each assignment changes
     the person's load, and the capacity gate reads that load. Run in parallel,
     five assignments would each be judged against the same starting figure and
     all five would pass a threshold that only one of them should have. */

  touch();
  return {
    ok: succeeded > 0,
    succeeded,
    failed: refusals.length,
    refusals: [...new Set(refusals)],
    error: succeeded === 0 ? (refusals[0] ?? 'Nothing changed.') : undefined,
    note:
      refusals.length === 0
        ? `${succeeded} ${succeeded === 1 ? 'task' : 'tasks'} reassigned.`
        : `${succeeded} reassigned, ${refusals.length} refused.`,
  };
}

export async function bulkWatchAction(
  taskIds: readonly string[],
  watching: boolean,
): Promise<BulkResult> {
  const user = await requireUser();
  let succeeded = 0;

  for (const taskId of taskIds) {
    if (watching) await R.addWatcher(user.id, taskId, user.id);
    else await R.removeWatcher(user.id, taskId, user.id);
    succeeded += 1;
  }

  touch();
  return {
    ok: true,
    succeeded,
    failed: 0,
    refusals: [],
    note: watching ? `Following ${succeeded}.` : `Stopped following ${succeeded}.`,
  };
}

/* ==========================================================================
 * PICKERS
 * ========================================================================== */

/**
 * What the relation panel's two pickers need: the active skills, and a task
 * search for the dependency box.
 *
 * One action rather than two because the panel opens both at once, and because
 * a dependency picker that fetches on every keystroke is a request per
 * character against a pooled connection. `query` is matched server-side so RLS
 * decides what can be linked — a task the actor cannot see must not be
 * offerable, or the picker becomes a way to enumerate work.
 */
export async function relationPickerAction(query: string): Promise<{
  skills: Array<{ id: string; label: string; category: string | null }>;
  tasks: Array<{ id: string; reference: string; title: string; status: string }>;
}> {
  const user = await requireUser();
  const term = query.trim();

  const [skills, tasks] = await Promise.all([
    (await import('@/lib/db/queries/people')).listSkills(user.id),
    term.length >= 2
      ? T.listTasks(user.id, { search: term, includeClosed: true, limit: 12 })
      : Promise.resolve([]),
  ]);

  return {
    skills: skills.map((s) => ({ id: s.id, label: s.label, category: s.category })),
    tasks: tasks.map((t) => ({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
    })),
  };
}

/**
 * Soft-delete several tasks at once.
 *
 * Owner, 2026-08-23: *"when I can select multiple checkboxes for multiple tasks,
 * a bar should appear at the bottom. There should also be a delete button where
 * I can delete multiple tasks at once. Now we can move multiple tasks or I can
 * change the status. In the same way I want to delete multiple tasks."*
 *
 * ── ⚠️ THIS IS NOT `purgeTasksAction`, AND THE DIFFERENCE MATTERS ────────────
 * Purge is permanent, Super Admin only, and demands re-authentication — it is
 * for a legal erasure, not for tidying up. This is the ordinary Delete that the
 * single-task menu already offers: the row stays, `is_deleted` goes true, and it
 * leaves every report and every audit trail intact.
 *
 * The bar now carries both, which is why they are named for what they do rather
 * than both being called "delete".
 *
 * ── EACH TASK IS DECIDED SEPARATELY ─────────────────────────────────────────
 * Same shape as `bulkChangeStatusAction` above and for the same reason. A Member
 * selecting six tasks may own three of them; deleting three and reporting the
 * other three as refused is more useful than refusing all six because one was
 * not theirs. `deleteTaskAction` applies `task.soft_delete` per row — which for
 * a Member is `self_created`, so work handed to them by a Coordinator is
 * refused by name.
 */
export async function bulkDeleteAction(taskIds: readonly string[]): Promise<BulkResult> {
  const { deleteTaskAction } = await import('./tasks');

  const refusals: string[] = [];
  let succeeded = 0;

  for (const taskId of taskIds) {
    const result = await deleteTaskAction(taskId);
    if (result.ok) succeeded += 1;
    else refusals.push(result.error ?? 'Refused.');
  }

  touch();
  return {
    ok: succeeded > 0,
    succeeded,
    failed: refusals.length,
    refusals: [...new Set(refusals)],
    error: succeeded === 0 ? (refusals[0] ?? 'Nothing was deleted.') : undefined,
    note:
      refusals.length === 0
        ? `${succeeded} ${succeeded === 1 ? 'task' : 'tasks'} deleted.`
        : `${succeeded} deleted, ${refusals.length} refused.`,
  };
}
