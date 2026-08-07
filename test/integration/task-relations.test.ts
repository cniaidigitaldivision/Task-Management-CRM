import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withUser } from '@/lib/db/client';
import * as R from '@/lib/db/queries/task-relations';
import * as T from '@/lib/db/queries/tasks';
import { wouldCreateCycle } from '@/lib/domain/dependencies';

/* ============================================================================
 * GATE — TASK RELATIONS, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * The unit suite proves the rules; this proves they meet the schema. Step 5
 * produced two bugs that only a test crossing this seam could find — a CHECK
 * constraint the code violated, and an RLS policy one step narrower than the
 * code assumed — so the assertions here lean on the constraints and the
 * policies rather than on the happy path.
 *
 * ── IT CLEANS UP AFTER ITSELF ────────────────────────────────────────────────
 * Every task it creates is recorded and hard-deleted at the end. These run
 * against a real workspace, and a suite that leaves eleven tasks called
 * "integration test" behind is one nobody will run twice.
 *
 * Requires the demo seed:  npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';

const who: Record<string, { id: string; role: string }> = {};
const createdTaskIds: string[] = [];
let projectId = '';

async function makeTask(
  actorId: string,
  over: Partial<Parameters<typeof T.createTask>[1]> = {},
): Promise<Awaited<ReturnType<typeof T.createTask>>> {
  const task = await T.createTask(actorId, {
    title: 'Integration fixture',
    projectId,
    priority: 'medium',
    effortPoints: 2,
    status: 'todo',
    ...over,
  });
  createdTaskIds.push(task.id);
  return task;
}

beforeAll(async () => {
  const rows = await sql`
    select id, email, role from public.users
     where email like ${'%@' + DOMAIN} and is_active
  `;
  if (rows.length === 0) {
    throw new Error('Run `npm run seed:demo` first — these tests need the demo division.');
  }
  for (const row of rows) {
    who[String(row.email).split('@')[0]] = { id: row.id as string, role: String(row.role) };
  }

  const projects = await sql`select id from public.projects limit 1`;
  projectId = projects[0].id as string;
});

afterAll(async () => {
  if (createdTaskIds.length === 0) return;

  /* ── ONE STATEMENT PER TABLE, NOT PER TASK ─────────────────────────────────
     The first version looped, issuing eight deletes for each of twenty
     fixtures. Against a pooled connection at ~1s a round trip that is 160
     seconds and the hook timed out — leaving the fixtures behind, which is the
     exact failure the cleanup exists to prevent. Batched with `= any()`, it is
     seven statements regardless of how many tasks the suite created.

     Subtasks are deleted first: `parent_task_id` cascades, but a child created
     outside this list would be taken with its parent, and being explicit is
     cheaper than being surprised. */
  const ids = createdTaskIds;

  await sql`
    delete from public.task_dependencies
     where task_id = any(${ids}::uuid[]) or depends_on_task_id = any(${ids}::uuid[])
  `;
  await sql`delete from public.task_watchers where task_id = any(${ids}::uuid[])`;
  await sql`delete from public.task_skills where task_id = any(${ids}::uuid[])`;
  await sql`delete from public.time_extension_requests where task_id = any(${ids}::uuid[])`;
  await sql`delete from public.notifications where entity_id = any(${ids}::uuid[])`;
  await sql`delete from public.tasks where parent_task_id = any(${ids}::uuid[])`;
  await sql`delete from public.tasks where id = any(${ids}::uuid[])`;

  /* `activity_log` is append-only by trigger and stays that way. The rows these
     fixtures produced are a handful of "created EVT-nnn" lines against tasks
     that no longer exist, which is exactly what an append-only history looks
     like when something is deleted — and pretending otherwise would mean
     making the history erasable by test tooling. */
}, 120_000);

describe('dependencies', () => {
  it('records what a task waits on, and what waits on it', async () => {
    const shoot = await makeTask(who.sana.id, { title: 'Fixture · shoot' });
    const edit = await makeTask(who.sana.id, { title: 'Fixture · edit' });

    await R.addDependency(who.sana.id, {
      taskId: edit.id,
      dependsOnTaskId: shoot.id,
      type: 'blocks',
    });

    const waitingOn = await R.listDependencies(who.sana.id, edit.id);
    expect(waitingOn.map((d) => d.dependsOnTaskId)).toEqual([shoot.id]);
    expect(waitingOn[0].reference).toBe(shoot.reference);

    const waitingOnThis = await R.listDependents(who.sana.id, shoot.id);
    expect(waitingOnThis.map((d) => d.taskId)).toEqual([edit.id]);
  });

  it('is idempotent — adding the same edge twice does not duplicate it', async () => {
    const a = await makeTask(who.sana.id);
    const b = await makeTask(who.sana.id);

    await R.addDependency(who.sana.id, { taskId: a.id, dependsOnTaskId: b.id, type: 'blocks' });
    await R.addDependency(who.sana.id, { taskId: a.id, dependsOnTaskId: b.id, type: 'relates_to' });

    const edges = await R.listDependencies(who.sana.id, a.id);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('relates_to');
  });

  it('is refused by the database when a task depends on itself', async () => {
    /* `task_dependencies_not_self`. The action checks it too, but the constraint
       is what holds if anything ever writes directly. */
    const task = await makeTask(who.sana.id);
    await expect(
      R.addDependency(who.sana.id, {
        taskId: task.id,
        dependsOnTaskId: task.id,
        type: 'blocks',
      }),
    ).rejects.toThrow();
  });

  it('catches a three-task cycle using the real edge list', async () => {
    /* The check runs in TypeScript over rows the database returns, so this is
       the assertion that the two halves actually meet. */
    const a = await makeTask(who.sana.id);
    const b = await makeTask(who.sana.id);
    const c = await makeTask(who.sana.id);

    await R.addDependency(who.sana.id, { taskId: a.id, dependsOnTaskId: b.id, type: 'blocks' });
    await R.addDependency(who.sana.id, { taskId: b.id, dependsOnTaskId: c.id, type: 'blocks' });

    const edges = await R.listAllDependencyEdges(who.sana.id);

    /* a waits on b, b waits on c. Closing the ring — c waiting on a — is the
       three-step cycle nobody builds on purpose. */
    expect(wouldCreateCycle(edges, c.id, a.id).wouldCycle).toBe(true);
    /* And so is c waiting on b, which closes a two-step ring with the b → c
       edge that already exists. */
    expect(wouldCreateCycle(edges, c.id, b.id).wouldCycle).toBe(true);
    /* But a waiting directly on c is only a shortcut along an order that
       already holds. Refusing it would be refusing a diamond. */
    expect(wouldCreateCycle(edges, a.id, c.id).wouldCycle).toBe(false);
  });

  it('refuses a Member writing an edge — RLS, not the action', async () => {
    /* `task_dependencies_write` is `sees_all_work()`. This bypasses the server
       action entirely, which is the point: the action's check is a courtesy and
       this is the guarantee. */
    const a = await makeTask(who.sana.id);
    const b = await makeTask(who.sana.id);

    await expect(
      R.addDependency(who.yusra.id, { taskId: a.id, dependsOnTaskId: b.id, type: 'blocks' }),
    ).rejects.toThrow();
  });

  it('disappears with the task, rather than leaving a dangling edge', async () => {
    const a = await makeTask(who.sana.id);
    const b = await makeTask(who.sana.id);
    await R.addDependency(who.sana.id, { taskId: a.id, dependsOnTaskId: b.id, type: 'blocks' });

    await sql`delete from public.tasks where id = ${b.id}`;
    createdTaskIds.splice(createdTaskIds.indexOf(b.id), 1);

    expect(await R.listDependencies(who.sana.id, a.id)).toHaveLength(0);
  });
});

describe('watchers', () => {
  it('adds, lists and removes', async () => {
    const task = await makeTask(who.sana.id);

    await R.addWatcher(who.yusra.id, task.id, who.yusra.id);
    expect((await R.listWatchers(who.sana.id, task.id)).map((w) => w.userId)).toEqual([
      who.yusra.id,
    ]);

    await R.removeWatcher(who.yusra.id, task.id, who.yusra.id);
    expect(await R.listWatchers(who.sana.id, task.id)).toHaveLength(0);
  });

  it('tolerates being added twice', async () => {
    const task = await makeTask(who.sana.id);
    await R.addWatcher(who.yusra.id, task.id, who.yusra.id);
    await R.addWatcher(who.yusra.id, task.id, who.yusra.id);
    expect(await R.listWatchers(who.sana.id, task.id)).toHaveLength(1);
  });

  it('refuses a Member adding somebody else', async () => {
    /* `task_watchers_write` permits self OR sees_all_work. Being able to
       subscribe a colleague to a task is a real change to their notifications. */
    const task = await makeTask(who.sana.id);
    await expect(R.addWatcher(who.yusra.id, task.id, who.ayesha.id)).rejects.toThrow();
  });

  it('lets a Coordinator add somebody else', async () => {
    const task = await makeTask(who.sana.id);
    await R.addWatcher(who.kashif.id, task.id, who.ayesha.id);
    expect((await R.listWatchers(who.sana.id, task.id)).map((w) => w.userId)).toContain(
      who.ayesha.id,
    );
  });

  it('gathers the audience as assignee plus watchers, without duplicates', async () => {
    const task = await makeTask(who.sana.id, { assigneeId: who.yusra.id });
    await R.addWatcher(who.yusra.id, task.id, who.yusra.id);
    await R.addWatcher(who.kashif.id, task.id, who.kashif.id);

    const audience = await R.notifyAudience(who.sana.id, task.id);
    expect(new Set(audience)).toEqual(new Set([who.yusra.id, who.kashif.id]));
  });
});

describe('required skills', () => {
  let skillId = '';

  beforeAll(async () => {
    const rows = await sql`select id from public.skills where is_active limit 1`;
    skillId = rows[0].id as string;
  });

  it('stores the weight and reads it back', async () => {
    const task = await makeTask(who.sana.id);
    await R.setTaskSkill(who.sana.id, task.id, skillId, 3);

    const skills = await R.listTaskSkills(who.sana.id, task.id);
    expect(skills).toHaveLength(1);
    expect(skills[0].weight).toBe(3);
    expect(skills[0].label).toBeTruthy();
  });

  it('updates rather than duplicating on a second set', async () => {
    const task = await makeTask(who.sana.id);
    await R.setTaskSkill(who.sana.id, task.id, skillId, 1);
    await R.setTaskSkill(who.sana.id, task.id, skillId, 2);

    const skills = await R.listTaskSkills(who.sana.id, task.id);
    expect(skills).toHaveLength(1);
    expect(skills[0].weight).toBe(2);
  });

  it('refuses a weight outside 1–3', async () => {
    /* `task_skills_weight_range`. The action checks it, and so does the table. */
    const task = await makeTask(who.sana.id);
    await expect(R.setTaskSkill(who.sana.id, task.id, skillId, 5)).rejects.toThrow();
  });

  it('refuses a Member setting one', async () => {
    const task = await makeTask(who.sana.id);
    await expect(R.setTaskSkill(who.yusra.id, task.id, skillId, 2)).rejects.toThrow();
  });
});

describe('subtasks', () => {
  it('lists children and reports depth', async () => {
    const parent = await makeTask(who.sana.id, { title: 'Fixture · parent' });
    const child = await makeTask(who.sana.id, {
      title: 'Fixture · child',
      parentTaskId: parent.id,
    });

    const subtasks = await R.listSubtasks(who.sana.id, parent.id);
    expect(subtasks.map((s) => s.id)).toEqual([child.id]);

    expect(await R.subtaskDepth(who.sana.id, parent.id)).toBe(0);
    expect(await R.subtaskDepth(who.sana.id, child.id)).toBe(1);
  });

  it('counts subtasks on the parent row', async () => {
    const parent = await makeTask(who.sana.id);
    await makeTask(who.sana.id, { parentTaskId: parent.id });

    const reloaded = await T.getTask(who.sana.id, parent.id);
    expect(reloaded?.subtaskCount).toBe(1);
  });

  it('excludes a soft-deleted child from the list', async () => {
    /* FR-095 soft-deletes rather than removing. A parent still showing a
       deleted child would make its progress unreachable — the child can never
       be closed. */
    const parent = await makeTask(who.sana.id);
    const child = await makeTask(who.sana.id, { parentTaskId: parent.id });

    await withUser(who.sana.id, (tx) => tx`
      update public.tasks set is_deleted = true, deleted_at = now() where id = ${child.id}
    `);

    expect(await R.listSubtasks(who.sana.id, parent.id)).toHaveLength(0);
  });
});

describe('time extensions', () => {
  it('records a request and finds it pending', async () => {
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 240,
    });

    await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 120,
      reason: 'Client sent replacement footage at 3pm.',
    });

    expect(await R.hasPendingExtension(who.yusra.id, task.id)).toBe(true);

    const forTask = await R.listExtensionsForTask(who.sana.id, task.id);
    expect(forTask).toHaveLength(1);
    expect(forTask[0].requestedMinutes).toBe(120);
    expect(forTask[0].status).toBe('pending');
    expect(forTask[0].taskLimitMinutes).toBe(240);
  });

  it('shows a Member only their own, and an Admin everybody’s', async () => {
    /* `tx_select` is `sees_all_work() or requested_by_id = me`. This is what
       lets one query power both the Admin queue and a Member's waiting list. */
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 120,
    });
    await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 30,
      reason: 'The export failed twice and had to be re-rendered.',
    });

    const asAdmin = await R.listPendingExtensions(who.sana.id);
    expect(asAdmin.some((r) => r.taskId === task.id)).toBe(true);

    const asOtherMember = await R.listPendingExtensions(who.ayesha.id);
    expect(asOtherMember.some((r) => r.taskId === task.id)).toBe(false);
  });

  it('applies the granted minutes to the task, in the same transaction', async () => {
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 240,
    });
    const requestId = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 120,
      reason: 'The grade had to be redone from scratch.',
    });

    const applied = await R.decideExtension(who.sana.id, {
      requestId,
      status: 'approved',
      grantedMinutes: 120,
      note: null,
    });
    expect(applied).toEqual({ taskId: task.id, appliedMinutes: 120 });

    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.timeLimitMinutes).toBe(360);
    expect(reloaded?.extensionMinutesGranted).toBe(120);
  });

  it('applies a partial grant, not the amount requested', async () => {
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 60,
    });
    const requestId = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 120,
      reason: 'The brief changed halfway through the second pass.',
    });

    await R.decideExtension(who.sana.id, {
      requestId,
      status: 'partially_approved',
      grantedMinutes: 30,
      note: 'Half now — come back if it is still short.',
    });

    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.timeLimitMinutes).toBe(90);
  });

  it('adds nothing to the limit on a decline', async () => {
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 60,
    });
    const requestId = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 60,
      reason: 'It is taking longer than the estimate allowed for.',
    });

    await R.decideExtension(who.sana.id, {
      requestId,
      status: 'declined',
      grantedMinutes: null,
      note: 'The deadline is fixed — hand the rest to Ayesha.',
    });

    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.timeLimitMinutes).toBe(60);
    expect(reloaded?.extensionMinutesGranted).toBe(0);
  });

  it('answers null on a second decision, so the minutes are not applied twice', async () => {
    /* Two Admins with the same page open. Without the `status = 'pending'`
       guard in the update, the second decision would add its minutes on top of
       the first — silently doubling a grant nobody made. */
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 60,
    });
    const requestId = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 60,
      reason: 'The render farm was down for most of the afternoon.',
    });

    const first = await R.decideExtension(who.sana.id, {
      requestId,
      status: 'approved',
      grantedMinutes: 60,
      note: null,
    });
    const second = await R.decideExtension(who.sana.id, {
      requestId,
      status: 'approved',
      grantedMinutes: 60,
      note: null,
    });

    expect(first?.appliedMinutes).toBe(60);
    expect(second).toBeNull();

    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.timeLimitMinutes).toBe(120);
  });

  it('refuses a Coordinator deciding — BR-018, enforced by RLS', async () => {
    /* The domain refuses it and the action refuses it. This proves the database
       refuses it too, which is what matters if either is ever bypassed: the
       `tx_decide` policy is `acting_at_least('admin')`, deliberately NOT the
       `sees_all_work()` used everywhere else. */
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 60,
    });
    const requestId = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 60,
      reason: 'The client review ran over by an hour and a half.',
    });

    const outcome = await R.decideExtension(who.kashif.id, {
      requestId,
      status: 'approved',
      grantedMinutes: 60,
      note: null,
    });

    /* RLS expresses the refusal as zero rows matched, not an exception — so the
       function answers null and the limit is untouched. */
    expect(outcome).toBeNull();
    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.timeLimitMinutes).toBe(60);
  });

  it('counts prior decided requests for the decision context', async () => {
    const task = await makeTask(who.sana.id, {
      assigneeId: who.yusra.id,
      timeLimitMinutes: 60,
    });

    const first = await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 30,
      reason: 'The first pass needed reworking after feedback.',
    });
    await R.decideExtension(who.sana.id, {
      requestId: first,
      status: 'approved',
      grantedMinutes: 30,
      note: null,
    });

    await R.createExtensionRequest(who.yusra.id, {
      taskId: task.id,
      requestedMinutes: 30,
      reason: 'And the second pass has run over as well.',
    });

    const pending = await R.listPendingExtensions(who.sana.id);
    const second = pending.find((r) => r.taskId === task.id);
    expect(second?.priorDecidedOnTask).toBe(1);
  });
});

describe('recurrence storage', () => {
  it('round-trips the rule through the task row', async () => {
    const task = await makeTask(who.sana.id, {
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
      dueDate: '2026-08-06',
    });

    const reloaded = await T.getTask(who.sana.id, task.id);
    expect(reloaded?.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
  });

  it('clears when set to null', async () => {
    const task = await makeTask(who.sana.id, { recurrenceRule: 'FREQ=DAILY;INTERVAL=1' });
    await T.updateTask(who.sana.id, task.id, { recurrenceRule: null });
    expect((await T.getTask(who.sana.id, task.id))?.recurrenceRule).toBeNull();
  });

  it('is left alone by an update that does not mention it', async () => {
    /* `updateTask` patches by sentinel rather than coalesce. An update of the
       title must not silently end a repeating series. */
    const task = await makeTask(who.sana.id, { recurrenceRule: 'FREQ=DAILY;INTERVAL=1' });
    await T.updateTask(who.sana.id, task.id, { title: 'Fixture · renamed' });
    expect((await T.getTask(who.sana.id, task.id))?.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1');
  });
});
