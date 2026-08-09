'use server';

import { revalidatePath } from 'next/cache';

import { requireUser, stepUpIsFresh } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { notify, record } from '@/lib/db/queries/feed';
import { listAvailability } from '@/lib/db/queries/people';
import * as R from '@/lib/db/queries/task-relations';
import * as T from '@/lib/db/queries/tasks';
import {
  EFFORT_POINTS,
  PRIORITIES,
  STATUS_META,
  TASK_STATUSES,
  type EffortSize,
  type Priority,
  type TaskStatus,
} from '@/lib/domain/constants';
import {
  dependencyWarning,
  isSettled as isSettledStatus,
  parentCompletionWarning,
  rollUpSubtasks,
  unfinishedBlockers,
} from '@/lib/domain/dependencies';
import { canDecideExtensions } from '@/lib/domain/extensions';
import { PURGE_IS_AVAILABLE } from '@/lib/capabilities';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';
import {
  formatRecurrence,
  nextInstanceDates,
  parseRecurrence,
} from '@/lib/domain/recurrence';
import { evaluateTransition, taskLoad } from '@/lib/domain/task-machine';
import { computeWorkload, evaluateAssignment, weekWindow } from '@/lib/domain/workload';
import { getSettings } from '@/lib/settings/current';
import { describeStorage, removeObject } from '@/lib/storage/bucket';

/* ============================================================================
 * TASK ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * doc 20 §1: authenticate → authorise → validate → call domain → persist → log.
 * Every action here follows that order, and **decides nothing of its own**. The
 * rules come from three places and only three:
 *
 *   lib/domain/permissions.ts   may this role do this at all?      (79 × 4)
 *   lib/domain/task-machine.ts  is this status change legal?       (doc 05 §2)
 *   lib/domain/workload.ts      does capacity allow it?            (BR-003/4)
 *
 * ── WHY EVERY ACTION RE-READS THE TASK ───────────────────────────────────────
 * The client sends an id, never a state. A form that posted "this task is
 * currently In Review" would let anybody claim any starting state and walk
 * through a transition that was never legal from where the task actually is.
 * The row is fetched, and the fetch itself is the authorisation check — RLS
 * returns nothing for a task the actor cannot see, so "not found" and "not
 * yours" collapse into one answer, which is the answer that leaks least.
 *
 * ── WHY FAILURES RETURN INSTEAD OF THROWING ──────────────────────────────────
 * A refusal is information the person needs: "you cannot approve your own work"
 * is the whole point of BR-002. Throwing produces a generic error boundary and
 * teaches people the application is unreliable rather than that the rule exists.
 * ========================================================================= */

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Advisory text shown after a successful action — e.g. a capacity warning. */
  readonly warning?: string;
  readonly taskId?: string;
  readonly reference?: string;
  /** The caller must re-authenticate before this will be accepted (FR-149).
   *  Only `purgeTasksAction` raises it — nothing else here is irreversible. */
  readonly stepUpRequired?: boolean;
}

const fail = (error: string): ActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

/** Read before validation, so the permission check can distinguish
 *  `task.create_for_self` from `task.create_for_other` (doc 03 §3.3). */
function assigneeIdEarly(form: FormData): string | null {
  return optional(form, 'assigneeId');
}

/** Effort arrives as a size. Points are derived, never typed twice (doc 05 §5). */
function effortFrom(form: FormData): { size: EffortSize | null; points: number } | null {
  const size = str(form, 'effortSize') as EffortSize;
  if (size && size in EFFORT_POINTS) return { size, points: EFFORT_POINTS[size] };

  const raw = Number(str(form, 'effortPoints'));
  if (Number.isFinite(raw) && raw > 0) return { size: null, points: raw };
  return null;
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Refresh everything a task change can be visible on. */
function revalidateWork(): void {
  for (const path of ['/dashboard', '/tasks', '/my-work', '/projects', '/workload', '/reports']) {
    revalidatePath(path);
  }
}

/* ==========================================================================
 * CAPACITY — the shared gate
 * ========================================================================== */

/**
 * Would giving this person this task breach a threshold?
 *
 * Called before every assignment and before every effort or priority increase,
 * because all three change the same number. Doc 06 §3's distinction is the whole
 * point: the soft threshold warns and lets you proceed (BR-004); the hard one
 * blocks unless an Admin types a reason (BR-003), and a Coordinator cannot
 * override at all.
 */
async function capacityGate(
  actorId: string,
  actorRole: Parameters<typeof evaluateAssignment>[0]['actorRole'],
  assigneeId: string,
  incoming: { effortPoints: number; priority: Priority; status: TaskStatus },
  excludeTaskId?: string,
): Promise<{ blocked: string | null; needsOverride: boolean; warning: string | null; projectedPct: number }> {
  const window = weekWindow(Date.now());

  const [tasks, availability, person, settings] = await Promise.all([
    T.listOpenTasksForCapacity(actorId),
    listAvailability(actorId, window),
    withUser(actorId, (tx) => tx`
      select weekly_capacity_points, max_concurrent_tasks
        from public.users where id = ${assigneeId}
    `),
    getSettings(),
  ]);

  if (!person[0]) {
    return { blocked: 'That person cannot be given work.', needsOverride: false, warning: null, projectedPct: 0 };
  }

  const theirs = tasks.filter((t) => t.assigneeId === assigneeId);
  const current = computeWorkload({
    tasks: theirs.map((t) => ({
      effortPoints: t.effortPoints,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
    })),
    capacityPoints: Number(person[0].weekly_capacity_points),
    maxConcurrentTasks: Number(person[0].max_concurrent_tasks),
    availability: availability.filter((a) => a.userId === assigneeId),
    window,
  });

  /* When the task is already theirs, its current cost has to come out before the
     new cost goes in — otherwise editing a task from M to L appears to add the
     whole L on top of the M that is already counted, and every edit looks like
     it doubles the load. */
  const adjusted = excludeTaskId
    ? { ...current, loadPoints: Math.max(0, current.loadPoints - (await currentLoadOf(actorId, excludeTaskId))) }
    : current;

  /* The two thresholds are settings (FR-057). Read, not imported — this is the
     one place in the application that actually BLOCKS somebody, so it is the
     place where a saved value silently not applying would matter most. */
  const gate = evaluateAssignment({
    current: adjusted,
    incoming: { ...incoming, dueDate: null },
    actorRole,
    softThresholdPct: Number(settings.softThresholdPct),
    hardThresholdPct: Number(settings.hardThresholdPct),
  });

  return {
    blocked: gate.outcome === 'blocked' ? gate.message : null,
    needsOverride: gate.outcome === 'override_required',
    warning: gate.outcome === 'warn' ? gate.message : null,
    projectedPct: gate.projectedPct,
  };
}

async function currentLoadOf(actorId: string, taskId: string): Promise<number> {
  const task = await T.getTask(actorId, taskId);
  if (!task || !task.assigneeId) return 0;
  return taskLoad({ effortPoints: task.effortPoints, priority: task.priority, status: task.status });
}

/* ==========================================================================
 * READ — for the detail drawer
 * ========================================================================== */

export interface TaskDetailPayload {
  readonly task: Awaited<ReturnType<typeof T.getTask>>;
  readonly comments: Awaited<ReturnType<typeof T.getTaskComments>>;
  readonly checklist: Awaited<ReturnType<typeof T.getChecklist>>;
  /** Which columns this actor may drag this card to, right now. */
  readonly allowed: readonly TaskStatus[];

  /* ── Step 6 · the relations ────────────────────────────────────────────
     All fetched in the same round trip. The drawer opens on a click and a
     second, third and fourth request after it opens is exactly how a panel
     ends up rendering four separate spinners. */
  readonly subtasks: Awaited<ReturnType<typeof R.listSubtasks>>;
  readonly dependencies: Awaited<ReturnType<typeof R.listDependencies>>;
  readonly dependents: Awaited<ReturnType<typeof R.listDependents>>;
  readonly watchers: Awaited<ReturnType<typeof R.listWatchers>>;
  readonly skills: Awaited<ReturnType<typeof R.listTaskSkills>>;
  readonly extensions: Awaited<ReturnType<typeof R.listExtensionsForTask>>;
  readonly attachments: Awaited<ReturnType<typeof R.listAttachments>>;
  /** Whether file storage is set up, so the panel can say so rather than fail. */
  readonly storage: { configured: boolean; reason: string | null };
  /** Is the person reading this following it? */
  readonly isWatching: boolean;
  /** May they draw dependencies, set required skills, restructure? */
  readonly canEditGraph: boolean;
  /** BR-018 — may they decide an extension request? */
  readonly canDecideExtensions: boolean;
  /** What is holding this up right now, in one sentence (BR-008). */
  readonly blockedWarning: string | null;
}

/**
 * The drawer's data, in one round trip.
 *
 * A server action rather than a route: the drawer opens over the board and must
 * not navigate, and this way the payload is typed end to end instead of being a
 * JSON shape that both sides guess at. RLS means a task the actor cannot see
 * comes back as `null` — the drawer shows "no longer available" and never a
 * partial leak.
 */
export async function getTaskDetailAction(taskId: string): Promise<TaskDetailPayload> {
  const user = await requireUser();
  const task = await T.getTask(user.id, taskId);
  if (!task) {
    return {
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
  }

  const [
    comments,
    checklist,
    subtasks,
    dependencies,
    dependents,
    watchers,
    skills,
    extensions,
    attachments,
  ] = await Promise.all([
    T.getTaskComments(user.id, taskId),
    T.getChecklist(user.id, taskId),
    R.listSubtasks(user.id, taskId),
    R.listDependencies(user.id, taskId),
    R.listDependents(user.id, taskId),
    R.listWatchers(user.id, taskId),
    R.listTaskSkills(user.id, taskId),
    R.listExtensionsForTask(user.id, taskId),
    R.listAttachments(user.id, taskId),
  ]);

  const allowed = TASK_STATUSES.filter((to) => {
    if (to === task.status) return false;
    return evaluateTransition(task.status, to, {
      actorRole: user.role,
      actorId: user.id,
      assigneeId: task.assigneeId,
      createdById: task.createdById,
      reason: 'pending',
    }).ok;
  });

  /* Computed from the rows already fetched — no extra query, and the same
     sentence the status change will show if they start it anyway. */
  const blockers = dependencies
    .filter((d) => d.type === 'blocks' && !isSettledStatus(d.status))
    .map((d) => ({
      taskId: d.dependsOnTaskId,
      reference: d.reference,
      title: d.title,
      status: d.status,
    }));

  return {
    task,
    comments,
    checklist,
    allowed,
    subtasks,
    dependencies,
    dependents,
    watchers,
    skills,
    extensions,
    attachments,
    /* Reported rather than assumed: with no key the panel says so in plain
       words and the rest of the drawer is unaffected. */
    storage: (() => {
      const status = describeStorage();
      return { configured: status.configured, reason: status.reason };
    })(),
    isWatching: watchers.some((w) => w.userId === user.id),
    canEditGraph:
      user.role === 'super_admin' || user.role === 'admin' || user.role === 'team_coordinator',
    canDecideExtensions: canDecideExtensions(user.role),
    blockedWarning: dependencyWarning(blockers),
  };
}

/* ==========================================================================
 * CREATE
 * ========================================================================== */

export async function createTaskAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const wantsSelf = !assigneeIdEarly(form) || assigneeIdEarly(form) === user.id;
  if (!can({ role: user.role, id: user.id }, wantsSelf ? 'task.create_for_self' : 'task.create_for_other')) {
    return fail('You do not have permission to create tasks.');
  }

  const title = str(form, 'title');
  const projectId = str(form, 'projectId');
  const priority = str(form, 'priority');
  const effort = effortFrom(form);
  const assigneeId = optional(form, 'assigneeId');
  const status = str(form, 'status') || 'todo';
  const overrideReason = optional(form, 'overrideReason');

  if (!title) return fail('Give the task a title.');
  if (!projectId) return fail('Choose a project — every task belongs to one (BR-011).');
  if (!isPriority(priority)) return fail('Choose a priority.');
  if (!effort) return fail('Choose an effort estimate.');
  if (!isStatus(status)) return fail('That is not a valid status.');

  const repeat = recurrenceFrom(form);
  if (repeat.error) return fail(repeat.error);

  /* A member may only raise work for themselves. RLS enforces this too, but a
     clear sentence beats a policy violation the person cannot interpret. */
  if (user.role === 'member' && assigneeId && assigneeId !== user.id) {
    return fail('Members can only raise tasks for themselves. Ask a coordinator to reassign it.');
  }

  let warning: string | null = null;

  if (assigneeId) {
    const gate = await capacityGate(user.id, user.role, assigneeId, {
      effortPoints: effort.points,
      priority,
      status,
    });
    if (gate.blocked) return fail(gate.blocked);
    if (gate.needsOverride && !overrideReason) {
      return {
        ok: false,
        error: `${gate.projectedPct}% — this puts them over their limit. Type a reason to proceed; it will be logged (BR-003).`,
      };
    }
    warning = gate.warning;
  }

  try {
    const created = await T.createTask(user.id, {
      title,
      description: optional(form, 'description'),
      projectId,
      otherDescription: optional(form, 'otherDescription'),
      assigneeId,
      status,
      priority,
      effortSize: effort.size,
      effortPoints: effort.points,
      startDate: optional(form, 'startDate'),
      dueDate: optional(form, 'dueDate'),
      blockedReason: optional(form, 'blockedReason'),
      timeLimitMinutes: minutesFrom(form),
      assignmentOverrideReason: overrideReason,
      recurrenceRule: repeat.rule,
    });

    await withUser(user.id, async (tx) => {
      await record(tx, user.id, {
        entityType: 'task',
        entityId: created.id,
        action: 'created',
        summary: `created ${created.reference}`,
        after: { title, status, priority, assigneeId },
      });
      if (assigneeId) {
        await notify(tx, user.id, {
          userId: assigneeId,
          kind: 'task_assigned',
          title: `${created.reference} assigned to you`,
          body: title,
          linkTo: '/my-work',
          entityId: created.id,
        });
      }
    });

    revalidateWork();
    return { ok: true, taskId: created.id, reference: created.reference, warning: warning ?? undefined };
  } catch (error) {
    return fail(readableDbError(error));
  }
}

/**
 * The repeat rule from the form's three fields, or null for a one-off.
 *
 * Returns `{ error }` rather than throwing so the caller refuses with a
 * sentence. A rule that cannot be parsed must never be stored: the spawn on
 * completion is best-effort and silent, so a malformed rule would produce a
 * task that simply never repeats and never says why.
 */
function recurrenceFrom(form: FormData): { rule: string | null; error?: string } {
  const freq = str(form, 'repeatFreq');
  if (!freq || freq === 'none') return { rule: null };

  const interval = str(form, 'repeatInterval') || '1';
  const byDay = form.getAll('repeatByDay').map(String).filter(Boolean);

  const parts = [`FREQ=${freq.toUpperCase()}`, `INTERVAL=${interval}`];
  if (freq.toUpperCase() === 'WEEKLY' && byDay.length > 0) parts.push(`BYDAY=${byDay.join(',')}`);

  const parsed = parseRecurrence(parts.join(';'));
  if (!parsed.ok) return { rule: null, error: parsed.message };
  return { rule: formatRecurrence(parsed.rule) };
}

/** A time limit may be entered in hours (FR-171's default is 60 min per point). */
function minutesFrom(form: FormData): number | null {
  const hours = Number(str(form, 'timeLimitHours'));
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  const minutes = Number(str(form, 'timeLimitMinutes'));
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

/* ==========================================================================
 * EDIT
 * ========================================================================== */

export async function updateTaskAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const taskId = str(form, 'taskId');
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  const actor = { role: user.role, id: user.id };
  const resource = { assigneeId: task.assigneeId ?? undefined, createdById: task.createdById };
  if (!can(actor, 'task.edit_content', resource)) {
    return fail('You can only edit tasks assigned to you or raised by you.');
  }

  const priority = str(form, 'priority');
  const effort = effortFrom(form);
  if (!isPriority(priority)) return fail('Choose a priority.');
  if (!effort) return fail('Choose an effort estimate.');

  const repeat = recurrenceFrom(form);
  if (repeat.error) return fail(repeat.error);

  let warning: string | null = null;

  /* Raising effort or priority raises load, so it goes through the same gate as
     an assignment. Without this, the hard threshold would be trivially bypassed:
     assign a small task, then edit it to XL. */
  const costRises =
    effort.points > task.effortPoints ||
    taskLoad({ effortPoints: effort.points, priority, status: task.status }) >
      taskLoad({ effortPoints: task.effortPoints, priority: task.priority, status: task.status });

  if (task.assigneeId && costRises) {
    const gate = await capacityGate(
      user.id,
      user.role,
      task.assigneeId,
      { effortPoints: effort.points, priority, status: task.status },
      task.id,
    );
    if (gate.blocked) return fail(gate.blocked);
    if (gate.needsOverride && !optional(form, 'overrideReason')) {
      return fail(`${gate.projectedPct}% — that estimate puts them over the limit. A reason is required.`);
    }
    warning = gate.warning;
  }

  try {
    await T.updateTask(user.id, taskId, {
      title: str(form, 'title'),
      description: optional(form, 'description'),
      otherDescription: optional(form, 'otherDescription'),
      priority,
      effortSize: effort.size,
      effortPoints: effort.points,
      startDate: optional(form, 'startDate'),
      dueDate: optional(form, 'dueDate'),
      timeLimitMinutes: minutesFrom(form),
      recurrenceRule: repeat.rule,
    });

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'task',
        entityId: taskId,
        action: 'updated',
        summary: `updated ${task.reference}`,
        before: { priority: task.priority, effortPoints: task.effortPoints, dueDate: task.dueDate },
        after: { priority, effortPoints: effort.points, dueDate: optional(form, 'dueDate') },
      }),
    );

    revalidateWork();
    return { ok: true, taskId, warning: warning ?? undefined };
  } catch (error) {
    return fail(readableDbError(error));
  }
}

/* ==========================================================================
 * STATUS
 * ========================================================================== */

/**
 * The board's drag, the detail panel's dropdown and any bulk action all land
 * here. One judgement, three call sites — which is the reason the machine is a
 * separate module and not a switch inside a component.
 */
export async function changeStatusAction(
  taskId: string,
  to: TaskStatus,
  reason?: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');
  if (!isStatus(to)) return fail('That is not a valid status.');

  const verdict = evaluateTransition(task.status, to, {
    actorRole: user.role,
    actorId: user.id,
    assigneeId: task.assigneeId,
    createdById: task.createdById,
    reason,
  });

  if (!verdict.ok) return fail(verdict.message);

  /* ── BR-008 · unfinished blockers WARN, they do not refuse ─────────────────
     Computed before the write, because the answer changes the moment the write
     lands, and the person needs to be told about the state they were actually
     starting from. */
  let advisory: string | null = null;

  if (to === 'in_progress') {
    const [edges, blockers] = await Promise.all([
      R.listAllDependencyEdges(user.id),
      R.listDependencies(user.id, taskId),
    ]);
    const byId = new Map(
      blockers.map((b) => [
        b.dependsOnTaskId,
        { taskId: b.dependsOnTaskId, reference: b.reference, title: b.title, status: b.status },
      ]),
    );
    advisory = dependencyWarning(unfinishedBlockers(edges, taskId, byId));
  }

  /* Closing a parent does not close its children, and somebody who has not
     scrolled the subtask list will not know that until three tasks turn up
     orphaned next week. */
  if (to === 'done' && task.subtaskCount > 0) {
    const subtasks = await R.listSubtasks(user.id, taskId);
    advisory = parentCompletionWarning(rollUpSubtasks(subtasks)) ?? advisory;
  }

  try {
    await T.applyStatus(user.id, taskId, to, reason?.trim() || null);

    await withUser(user.id, async (tx) => {
      await record(tx, user.id, {
        entityType: 'task',
        entityId: taskId,
        action: to,
        summary: `moved ${task.reference} to ${STATUS_META[to].label}`,
        before: { status: task.status },
        after: { status: to, reason: reason ?? null },
      });

      /* Who needs to know depends on which way the work moved. Notifying
         everybody on every change is how a notification feed becomes wallpaper. */
      if (task.assigneeId && task.assigneeId !== user.id) {
        const kind =
          to === 'revisions' ? 'revisions_requested'
          : to === 'done' ? 'review_approved'
          : to === 'blocked' ? 'task_blocked'
          : 'task_status_changed';
        await notify(tx, user.id, {
          userId: task.assigneeId,
          kind,
          title: `${task.reference} — ${STATUS_META[to].label}`,
          body: reason?.trim() || task.title,
          linkTo: '/my-work',
          entityId: taskId,
        });
      }

      /* In Review needs a reviewer's attention, and the person who submitted it
         is by definition not that person (BR-002). */
      if (to === 'in_review') {
        const reviewers = await tx`
          select id from public.users
           where is_active and account_state = 'active'
             and role in ('admin', 'team_coordinator') and id <> ${user.id}
        `;
        for (const reviewer of reviewers) {
          await notify(tx, user.id, {
            userId: reviewer.id as string,
            kind: 'review_requested',
            title: `${task.reference} is ready for review`,
            body: task.title,
            linkTo: '/tasks',
            entityId: taskId,
          });
        }
      }
    });

    /* ── A repeating task creates its successor when it closes ──────────────
       Not on a schedule. Spawning here means the series can never outrun the
       person doing it: a weekly report three weeks late is ONE task three weeks
       old, which is the truth, rather than four tasks implying four separate
       pieces of work — and four tasks' worth of capacity load nobody owes. */
    let spawned: string | null = null;
    if (to === 'done') spawned = await spawnNextOccurrence(user.id, taskId);

    revalidateWork();
    return {
      ok: true,
      taskId,
      warning:
        spawned && advisory
          ? `${advisory} The next one in the series is ${spawned}.`
          : spawned
            ? `Next in the series created: ${spawned}.`
            : (advisory ?? undefined),
    };
  } catch (error) {
    return fail(readableDbError(error));
  }
}

/**
 * Create the next instance of a repeating task, if this one repeats.
 *
 * ── EVERYTHING HERE IS BEST-EFFORT, AND DELIBERATELY SO ──────────────────────
 * The task the person just completed IS completed. If the successor cannot be
 * created — a malformed rule, no date to anchor on, a database hiccup — that
 * must not undo their completion or show them an error about a task they did
 * not ask for. It returns null and the caller says nothing.
 */
async function spawnNextOccurrence(actorId: string, taskId: string): Promise<string | null> {
  try {
    const rows = await withUser(actorId, (tx) => tx`
      select recurrence_rule, title, description, project_id, other_description,
             assignee_id, priority, effort_size, effort_points,
             start_date, due_date, time_limit_minutes
        from public.tasks where id = ${taskId}
    `);

    const row = rows[0];
    if (!row?.recurrence_rule) return null;

    const parsed = parseRecurrence(row.recurrence_rule as string);
    if (!parsed.ok) return null;

    const asDate = (value: unknown) => (value ? String(value).slice(0, 10) : null);
    const dates = nextInstanceDates(parsed.rule, {
      startDate: asDate(row.start_date),
      dueDate: asDate(row.due_date),
    });
    if (!dates) return null;

    const created = await T.createTask(actorId, {
      title: row.title as string,
      description: (row.description as string | null) ?? undefined,
      projectId: row.project_id as string,
      otherDescription: (row.other_description as string | null) ?? undefined,
      /* Same person by default. A recurring task is usually somebody's standing
         responsibility, and reassigning it to nobody every period would make
         the series need re-planning each time. */
      assigneeId: (row.assignee_id as string | null) ?? undefined,
      priority: row.priority as Priority,
      effortSize: (row.effort_size as EffortSize | null) ?? undefined,
      effortPoints: Number(row.effort_points),
      startDate: dates.startDate ?? undefined,
      dueDate: dates.dueDate ?? undefined,
      timeLimitMinutes: (row.time_limit_minutes as number | null) ?? undefined,
      status: 'todo',
    });

    /* The rule travels with the new instance, or the series stops after one. */
    await withUser(actorId, (tx) => tx`
      update public.tasks set recurrence_rule = ${formatRecurrence(parsed.rule)}
       where id = ${created.id}
    `);

    return created.reference;
  } catch {
    return null;
  }
}

/* ==========================================================================
 * ASSIGN
 * ========================================================================== */

export async function assignTaskAction(
  taskId: string,
  assigneeId: string | null,
  overrideReason?: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  const actor = { role: user.role, id: user.id };
  if (!can(actor, 'task.assign', { assigneeId: task.assigneeId ?? undefined, createdById: task.createdById })) {
    return fail('Only a coordinator or above can hand work to someone else.');
  }

  let warning: string | null = null;

  if (assigneeId && assigneeId !== task.assigneeId) {
    const gate = await capacityGate(user.id, user.role, assigneeId, {
      effortPoints: task.effortPoints,
      priority: task.priority,
      status: task.status,
    });
    if (gate.blocked) return fail(gate.blocked);
    if (gate.needsOverride && !overrideReason?.trim()) {
      return fail(
        `${gate.projectedPct}% — that puts them over their limit. A written reason is required and will be logged (BR-003).`,
      );
    }
    warning = gate.warning;
  }

  try {
    await T.assignTask(user.id, taskId, assigneeId, overrideReason?.trim() || null);

    await withUser(user.id, async (tx) => {
      await record(tx, user.id, {
        entityType: 'task',
        entityId: taskId,
        action: 'reassigned',
        summary: assigneeId
          ? `reassigned ${task.reference}`
          : `unassigned ${task.reference}`,
        before: { assigneeId: task.assigneeId },
        after: { assigneeId, overrideReason: overrideReason ?? null },
      });

      if (assigneeId) {
        await notify(tx, user.id, {
          userId: assigneeId,
          kind: 'task_assigned',
          title: `${task.reference} assigned to you`,
          body: task.title,
          linkTo: '/my-work',
          entityId: taskId,
        });
      }

      /* ── BR-003: an override goes in the AUDIT trail, not just the feed ─────
         Deliberately overloading somebody past their limit is the single act
         this system asks for a written justification for. The reason is stored
         on the task so it is visible in context, and here so it is findable
         later — "who has been overriding capacity, and what did they say" is a
         question the feed cannot answer without scrolling through every task
         movement. Only written when an override actually happened. */
      if (overrideReason?.trim()) {
        await audit(tx, user, {
          entityType: 'task',
          entityId: taskId,
          action: 'task.capacity_override',
          reason: overrideReason.trim(),
          before: { assigneeId: task.assigneeId },
          after: { assigneeId, reference: task.reference, effortPoints: task.effortPoints },
        });
      }
      /* The person losing the task is told too. Work disappearing from your list
         without explanation is the single most common complaint about tools like
         this one. */
      if (task.assigneeId && task.assigneeId !== assigneeId) {
        await notify(tx, user.id, {
          userId: task.assigneeId,
          kind: 'task_reassigned',
          title: `${task.reference} was reassigned`,
          body: task.title,
          linkTo: '/tasks',
          entityId: taskId,
        });
      }
    });

    revalidateWork();
    return { ok: true, taskId, warning: warning ?? undefined };
  } catch (error) {
    return fail(readableDbError(error));
  }
}

/* ==========================================================================
 * DELETE · COMMENT · CHECKLIST · TIMER
 * ========================================================================== */

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const user = await requireUser();
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  if (!can({ role: user.role, id: user.id }, 'task.soft_delete', {
    assigneeId: task.assigneeId ?? undefined,
    createdById: task.createdById,
  })) {
    return fail('You do not have permission to delete this task.');
  }

  await T.softDeleteTask(user.id, taskId);
  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'task',
      entityId: taskId,
      action: 'deleted',
      summary: `deleted ${task.reference}`,
      before: { title: task.title, status: task.status },
    }),
  );
  revalidateWork();
  return { ok: true };
}

export async function addCommentAction(taskId: string, body: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!body.trim()) return fail('Write something first.');

  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  const commentId = await T.addComment(user.id, taskId, body);

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'comment',
      entityId: commentId,
      action: 'commented',
      summary: `commented on ${task.reference}`,
    });
    /* Both the assignee and the person who raised it are interested — and
       `notify()` drops the actor's own copy, so commenting on your own task
       does not notify you. */
    for (const target of new Set([task.assigneeId, task.createdById].filter(Boolean) as string[])) {
      await notify(tx, user.id, {
        userId: target,
        kind: 'task_comment',
        title: `New comment on ${task.reference}`,
        body: body.trim().slice(0, 140),
        linkTo: '/tasks',
        entityId: taskId,
      });
    }
  });

  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

export async function addChecklistItemAction(taskId: string, text: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!text.trim()) return fail('Write the step first.');
  await T.addChecklistItem(user.id, taskId, text);
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

export async function toggleChecklistItemAction(
  itemId: string,
  isDone: boolean,
): Promise<ActionResult> {
  const user = await requireUser();
  await T.setChecklistItemDone(user.id, itemId, isDone);
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

export async function deleteChecklistItemAction(itemId: string): Promise<ActionResult> {
  const user = await requireUser();
  await T.deleteChecklistItem(user.id, itemId);
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

/**
 * Start the clock. FR-174: the timer runs only in a status the work is actually
 * being done in, so starting it moves the task to In Progress when it is not
 * there yet — through the machine, so the move is still judged legally.
 */
export async function startTimerAction(taskId: string): Promise<ActionResult> {
  const user = await requireUser();
  const task = await T.getTask(user.id, taskId);
  if (!task) return fail('That task no longer exists.');

  if (task.assigneeId !== user.id && user.role === 'member') {
    return fail('You can only track time on your own tasks.');
  }

  if (!STATUS_META[task.status].timerRuns) {
    const moved = await changeStatusAction(taskId, 'in_progress');
    if (!moved.ok) {
      return fail(`The timer only runs on work in progress, and ${moved.error?.toLowerCase()}`);
    }
  }

  await T.startTimer(user.id, taskId);
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

export async function pauseTimerAction(taskId: string): Promise<ActionResult> {
  const user = await requireUser();
  await T.pauseTimer(user.id, taskId, 'manual');
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

export async function logTimeAction(
  taskId: string,
  minutes: number,
  reason: string,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!Number.isFinite(minutes) || minutes <= 0) return fail('Enter how many minutes to add.');
  /* BR-020: manual time always carries a reason and is always visibly flagged.
     A timer everyone quietly edits is worse than no timer at all. */
  if (!reason.trim()) return fail('Manual time needs a reason — it is flagged in the record.');

  await T.logManualTime(user.id, taskId, Math.round(minutes), reason);
  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'time',
      entityId: taskId,
      action: 'time_logged',
      summary: `logged ${Math.round(minutes)} minutes manually`,
      after: { minutes: Math.round(minutes), reason },
    }),
  );
  revalidatePath('/tasks');
  revalidatePath('/my-work');
  return { ok: true };
}

/* ==========================================================================
 * Turning a constraint violation into a sentence
 * ========================================================================== */

/**
 * The database enforces rules the UI also tries to. When it wins, the person
 * sees the reason rather than an error code — and the message names the rule so
 * it reads as intentional design rather than a fault.
 */
function readableDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('must say what the work is')) {
    return 'A task in an Other project has to say what the work actually is (BR-012).';
  }
  if (message.includes('tasks_blocked_needs_reason')) {
    return 'A blocked task needs a written reason (FR-043).';
  }
  if (message.includes('tasks_cancelled_needs_reason')) {
    return 'Cancelling needs a written reason (FR-043).';
  }
  if (message.includes('tasks_dates_ordered')) {
    return 'The due date cannot be before the start date.';
  }
  if (message.includes('tasks_effort_positive')) {
    return 'The effort estimate has to be greater than zero.';
  }
  if (message.includes('violates row-level security')) {
    return 'You do not have permission to change that.';
  }
  return 'That could not be saved. Nothing was changed.';
}

/* ==========================================================================
 * WHAT WOULD THIS DISTURB, AND THE PERMANENT DELETE
 * ========================================================================== */

/**
 * Read the blast radius of a cancel, delete or purge, for the dialog that asks.
 *
 * No permission check of its own, deliberately: every count and every reference
 * it returns comes from a `withUser` query, so row-level security has already
 * decided what this person may see. A Member's impact report cannot name a task
 * they are not entitled to know exists (ADR-003).
 */
export async function describeImpactAction(taskIds: string[]): Promise<T.TaskImpact[]> {
  const user = await requireUser();
  return T.describeImpact(user.id, taskIds);
}

/**
 * Destroy tasks permanently. Super Admin only, and only with a fresh step-up.
 *
 * ── WHY THIS EXISTS WHEN A SOFT DELETE ALREADY DOES ──────────────────────────
 * `task.purge` has been in doc 03 §3 since Step 3 with no implementation.
 * FR-095's soft delete is the right answer almost always — hidden, recoverable
 * for 30 days. Purge covers the one case it cannot: something that should never
 * have been recorded at all, carrying a client name or a note that must not sit
 * in the database for a month.
 *
 * ── THE ORDER MATTERS, AND IT IS THE ONLY ORDER THAT DOES NOT LITTER ─────────
 * Storage objects are removed BEFORE the rows. Postgres cascades every child
 * table for us, but it cannot reach into Supabase Storage — so deleting the
 * rows first would lose the only record of which objects to remove, leaving
 * files nobody can find and nobody can delete.
 *
 * Doing it this way risks the opposite: objects gone and the delete then
 * refused, leaving rows pointing at nothing. That is the better failure. A
 * broken download link is visible and fixable; an orphaned private object is
 * invisible and permanent.
 */
export async function purgeTasksAction(taskIds: string[]): Promise<ActionResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'task.purge')) {
    return fail('Only the Super Admin can permanently destroy a task. Delete keeps it for 30 days (FR-095).');
  }

  /* ⚠️ Refuse before doing any of the work, rather than deleting the storage
     objects and then finding the rows cannot go. `public.tasks` has RLS on and
     no DELETE policy, so the delete silently affects zero rows — measured, and
     the same trap Session 11 hit. Reporting "0 destroyed" as a success would be
     the worst outcome: the attachments would already be gone. */
  if (!PURGE_IS_AVAILABLE) {
    return fail(
      'Purge is not available yet. `public.tasks` has row-level security with no DELETE policy, so the database refuses every delete silently — a migration adding a Super-Admin-only `tasks_delete` policy is needed first, and migrations wait for your go-ahead. Use Delete, which hides it and keeps it recoverable for 30 days.',
    );
  }
  if (!stepUpIsFresh(user, nowMs())) {
    return { ok: false, error: 'Confirm it is you before destroying anything permanently.', stepUpRequired: true };
  }
  if (taskIds.length === 0) return fail('Nothing was selected.');

  /* Read what is about to be destroyed while it still exists — the audit entry
     has to name it, and afterwards there is nothing left to name. */
  const doomed = await T.describeImpact(user.id, taskIds);
  if (doomed.length === 0) return fail('Those tasks no longer exist.');

  const paths = await T.attachmentPathsFor(user.id, taskIds);
  for (const path of paths) {
    /* A failure here is logged by describeStorage's own result and does not
       stop the purge: an object we could not remove is litter, and refusing to
       destroy the row because of it would leave the task in place instead. */
    await removeObject(path).catch(() => null);
  }

  const purged = await T.purgeTasks(user.id, doomed.map((row) => row.taskId));

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'task',
      entityId: doomed.length === 1 ? doomed[0].taskId : null,
      action: 'task.purged',
      before: {
        tasks: doomed.map((row) => ({
          reference: row.reference,
          title: row.title,
          status: row.status,
          comments: row.commentCount,
          attachments: row.attachmentCount,
          minutesLogged: row.minutesLogged,
        })),
        attachmentObjects: paths.length,
      },
      after: { purged },
    }),
  );

  revalidateWork();
  return {
    ok: true,
    warning:
      purged === doomed.length
        ? undefined
        : `${purged} of ${doomed.length} were destroyed; the rest were refused by the database.`,
  };
}
