import { beforeAll, describe, expect, it } from 'vitest';

import { sql, withAppRole, withUser } from '@/lib/db/client';
import { listActivity, listNotifications } from '@/lib/db/queries/feed';
import { listPeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { countTasksByStatus, getTask, listTasks } from '@/lib/db/queries/tasks';
import { teamUtilisation, teamWorkload } from '@/lib/db/queries/workload';
import { evaluateTransition } from '@/lib/domain/task-machine';

/* ============================================================================
 * GATE — THE WORK CORE, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * The unit suite proves the rules. This proves the *seam*: that row-level
 * security, the query layer and the domain rules agree when a real identity is
 * set on a real connection.
 *
 * Three sessions found three bugs that only a test crossing this seam could
 * find — RLS silently bypassed (C-18), the lockout never tripping (C-19), and a
 * timing oracle left open by a fake decoy hash. Every one of them read correctly
 * on the page. So the most important assertions here are the *negative* ones:
 * what a Member cannot see, and what nobody can do.
 *
 * Requires the demo seed:  npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';

interface Who {
  id: string;
  name: string;
  role: string;
}

const who: Record<string, Who> = {};

beforeAll(async () => {
  /* ⚠️ `sql` directly, not withUser/withAppRole — and that is the point.
     Every other query in this file goes through the identity contract. This one
     cannot: it is looking up *who the identities are*, and `withAppRole` sets no
     `app.user_id`, so RLS on `users` correctly returns nothing. Fail-closed
     working exactly as designed is why this bootstrap has to run as the owner. */
  const rows = await sql`
    select id, full_name, email, role from public.users
     where email like ${'%@' + DOMAIN} and is_active
  `;

  if (rows.length === 0) {
    throw new Error('Run `npm run seed:demo` first — these tests need the demo division.');
  }

  for (const row of rows) {
    const key = String(row.email).split('@')[0];
    who[key] = { id: row.id as string, name: row.full_name as string, role: row.role as string };
  }
});

describe('reference generation', () => {
  it('produces a sayable, prefixed reference per project type', async () => {
    const tasks = await listTasks(who.sana.id, { includeClosed: true });
    expect(tasks.length).toBeGreaterThan(20);

    for (const task of tasks) {
      // FR-113: the prefix identifies the kind of work, out loud.
      expect(task.reference).toMatch(/^(EVT|CLI|BIZ|PRM|OTH)-\d+$/);
      expect(task.reference.startsWith(task.projectCode)).toBe(true);
    }

    // FR-032: unique, always.
    const refs = tasks.map((t) => t.reference);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe('ADR-003 — member isolation, enforced by the database', () => {
  it('an Admin sees the whole board', async () => {
    const [adminTasks, adminPeople] = await Promise.all([
      listTasks(who.sana.id, { includeClosed: true }),
      listPeople(who.sana.id),
    ]);
    expect(adminTasks.length).toBeGreaterThan(20);
    expect(adminPeople.length).toBeGreaterThanOrEqual(7);
  });

  it('a Member sees ONLY tasks they are assigned or raised', async () => {
    const memberTasks = await listTasks(who.yusra.id, { includeClosed: true });
    expect(memberTasks.length).toBeGreaterThan(0);

    for (const task of memberTasks) {
      const mine = task.assigneeId === who.yusra.id || task.createdById === who.yusra.id;
      expect(mine, `${task.reference} is neither assigned to nor raised by the member`).toBe(true);
    }
  });

  it('a Member cannot see another member’s task even by id', async () => {
    const all = await listTasks(who.sana.id, { includeClosed: true });
    const someoneElses = all.find(
      (t) => t.assigneeId && t.assigneeId !== who.yusra.id && t.createdById !== who.yusra.id,
    );
    expect(someoneElses, 'the seed should contain a task belonging to somebody else').toBeTruthy();

    /* The important assertion in this file. Asking for a specific id is the
       attack an over-eager query author enables; RLS answers with nothing, so
       "does not exist" and "not yours" are indistinguishable. */
    const attempt = await getTask(who.yusra.id, someoneElses!.id);
    expect(attempt).toBeNull();
  });

  it('a Member cannot read another person’s notifications', async () => {
    const theirs = await listNotifications(who.yusra.id, 50);
    const rows = await withUser(
      who.yusra.id,
      (tx) => tx`select count(*) as n from public.notifications`,
    );
    // Whatever the member can count IS their own inbox — there is no wider view.
    expect(Number(rows[0].n)).toBe(theirs.length);
  });

  it('a Member’s status counts cover only their own work', async () => {
    const [memberCounts, memberTasks] = await Promise.all([
      countTasksByStatus(who.yusra.id),
      listTasks(who.yusra.id, { includeClosed: true }),
    ]);
    const total = memberCounts.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(memberTasks.length);
  });
});

describe('the capacity engine, on real rows', () => {
  it('computes utilisation from stored effort and derives nothing from a stored total', async () => {
    const { people } = await teamWorkload(who.sana.id);
    expect(people.length).toBeGreaterThanOrEqual(6);

    // The Super Admin is excluded so its 36 points do not inflate headroom.
    expect(people.some((p) => p.role === 'super_admin')).toBe(false);

    for (const person of people) {
      expect(person.workload.utilisationPct).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(person.workload.utilisationPct)).toBe(true);
      // doc 06 §3's bands must agree with the percentage they were derived from.
      if (person.workload.utilisationPct >= 100 && !person.workload.isFullyUnavailable) {
        expect(person.workload.band).toBe('over');
      }
    }

    const team = teamUtilisation(people);
    expect(team.capacityPoints).toBeGreaterThan(0);
  });

  it('the seed contains someone genuinely over capacity — an all-green demo proves nothing', async () => {
    const { people } = await teamWorkload(who.sana.id);
    const strained = people.filter((p) => p.workload.utilisationPct >= 85);
    expect(strained.length).toBeGreaterThan(0);
  });
});

describe('doc 05 §2 transitions, against real tasks', () => {
  it('BR-002 — the assignee cannot approve their own work, at any rank', async () => {
    const tasks = await listTasks(who.sana.id, { statuses: ['in_review'] });
    expect(tasks.length).toBeGreaterThan(0);
    const task = tasks[0];

    // As the assignee, whatever their rank.
    const asAssignee = evaluateTransition('in_review', 'done', {
      actorRole: 'admin',
      actorId: task.assigneeId!,
      assigneeId: task.assigneeId,
      createdById: task.createdById,
    });
    expect(asAssignee.ok).toBe(false);
    if (!asAssignee.ok) expect(asAssignee.code).toBe('own_work');

    // Even a Super Admin. This is the one rule privilege does not satisfy.
    const asSuperAdmin = evaluateTransition('in_review', 'done', {
      actorRole: 'super_admin',
      actorId: task.assigneeId!,
      assigneeId: task.assigneeId,
      createdById: task.createdById,
    });
    expect(asSuperAdmin.ok).toBe(false);

    // Somebody else with reviewer authority can.
    const asReviewer = evaluateTransition('in_review', 'done', {
      actorRole: 'admin',
      actorId: who.sana.id,
      assigneeId: task.assigneeId,
      createdById: task.createdById,
    });
    expect(asReviewer.ok).toBe(true);
  });

  it('a blocked task in the database always carries its reason (FR-043)', async () => {
    const blocked = await listTasks(who.sana.id, { statuses: ['blocked'] });
    expect(blocked.length).toBeGreaterThan(0);
    for (const task of blocked) {
      expect(task.blockedReason?.trim()).toBeTruthy();
    }
  });

  it('the database refuses a blocked task with no reason', async () => {
    const [task] = await listTasks(who.sana.id, { statuses: ['todo'] });
    await expect(
      withUser(who.sana.id, (tx) => tx`
        update public.tasks set status = 'blocked', blocked_reason = null where id = ${task.id}
      `),
    ).rejects.toThrow();
  });

  it('the database refuses an Other-project task with no explanation (BR-012)', async () => {
    const projects = await listProjects(who.sana.id);
    const other = projects.find((p) => p.type === 'other');
    expect(other).toBeTruthy();

    await expect(
      withUser(who.sana.id, (tx) => tx`
        insert into public.tasks
          (reference, title, project_id, created_by_id, status, priority, effort_points)
        values ('OTH-999999', 'Unexplained favour', ${other!.id}, ${who.sana.id},
                'todo', 'low', 1)
      `),
    ).rejects.toThrow();
  });

  it('done and completed_at cannot disagree', async () => {
    const [task] = await listTasks(who.sana.id, { statuses: ['todo'] });
    await expect(
      withUser(who.sana.id, (tx) => tx`
        update public.tasks set status = 'done', completed_at = null where id = ${task.id}
      `),
    ).rejects.toThrow();
  });
});

describe('append-only history', () => {
  /* ── TWO DIFFERENT MECHANISMS, AND THE DIFFERENCE MATTERS ──────────────────
     The first version of this test asserted that `cni_app` rewriting the feed
     would *throw*. It does not — and finding out why was worth the failure.

     `activity_log` has SELECT and INSERT policies and no UPDATE policy, so an
     UPDATE from `cni_app` matches zero rows: nothing is changed, nothing is
     raised. A row-level trigger cannot fire on a statement that reached no rows.
     Silent and safe, but not an exception.

     Which means RLS alone would leave the table editable by any role that
     bypasses it — and the table's owner does. That is what the trigger is for
     (doc 19 §6: "any role, including super_admin"), and it is the case a REVOKE
     provably cannot cover, because a REVOKE cannot bind a table owner.

     So both halves are asserted separately, against the role each one governs. */
  it('cni_app cannot rewrite the feed — RLS filters it to nothing', async () => {
    const feed = await listActivity(who.sana.id, 1);
    expect(feed.length).toBeGreaterThan(0);
    const before = feed[0].summary;

    await withUser(who.sana.id, (tx) => tx`
      update public.activity_log set summary = 'never happened' where id = ${feed[0].id}
    `);
    await withUser(who.sana.id, (tx) => tx`
      delete from public.activity_log where id = ${feed[0].id}
    `);

    const after = await listActivity(who.sana.id, 1);
    expect(after[0].id).toBe(feed[0].id);
    expect(after[0].summary).toBe(before);
  });

  it('the OWNER cannot rewrite the feed either — the trigger refuses', async () => {
    const feed = await listActivity(who.sana.id, 1);

    await expect(
      sql`update public.activity_log set summary = 'never happened' where id = ${feed[0].id}`,
    ).rejects.toThrow(/append-only/i);

    await expect(
      sql`delete from public.activity_log where id = ${feed[0].id}`,
    ).rejects.toThrow(/append-only/i);
  });

  it('references cannot be forged — cni_app has no path to the counter', async () => {
    await expect(
      withUser(who.sana.id, (tx) => tx`
        update public.reference_counters set last_value = 0 where code = 'EVT'
      `),
    ).rejects.toThrow();
  });
});

describe('BR-028 — one Super Admin, structurally', () => {
  it('a second super_admin row is impossible even for the owner role', async () => {
    await expect(
      withAppRole((tx) => tx`
        insert into public.users (full_name, email, role, account_state)
        values ('Impostor', 'impostor@cni-demo.com', 'super_admin', 'active')
      `),
    ).rejects.toThrow();
  });
});
