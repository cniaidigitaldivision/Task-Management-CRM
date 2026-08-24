import { afterAll, describe, expect, it } from 'vitest';

import { sql, withUser } from '@/lib/db/client';
import { createTask } from '@/lib/db/queries/tasks';

/* ============================================================================
 * A MEMBER CAN CREATE A TASK — regression guard, 2026-08-22
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHAT THIS EXISTS TO CATCH, AND WHY NO UNIT TEST COULD ─────────────────
 * `createTask` ended with `returning id` for months. That is the natural way to
 * write it and it is broken for exactly one class of caller.
 *
 * PostgreSQL applies the SELECT policy to the row an INSERT returns. The tasks
 * policy is `app.task_is_visible(id)`, which is STABLE and therefore reads the
 * calling query's snapshot — taken before the row existed. A Coordinator or
 * above short-circuits on rank inside that function and never queries the table,
 * so it passes. A Member has to find the row by id, cannot see it yet, and the
 * insert is refused with "new row violates row-level security policy".
 *
 * So the bug was invisible to every test and every hand-check run as an Admin,
 * and it made task creation impossible for the least privileged role — the one
 * least likely to be able to explain what happened. It surfaced only when the
 * schedule generator ran as a project owner who is a Member.
 *
 * A unit test cannot reach this: the failure lives in the interaction between
 * RETURNING, a STABLE policy function and MVCC snapshots. It needs a real
 * database and a real Member, which is what this is.
 *
 * ⚠️ If this fails with an RLS violation, someone has reinstated `returning` in
 * `createTask`. The fix is an id generated in Node and a separate read-back —
 * see the note there.
 * ========================================================================= */

const ready = Boolean(process.env.DATABASE_URL);
const made: string[] = [];

afterAll(async () => {
  /* Raw `sql`, because `tasks_delete` is Super Admin only and this is cleanup,
     not application behaviour. Nothing else in the suite should copy this. */
  if (made.length > 0) await sql`delete from public.tasks where id = any(${made})`;
});

describe.runIf(ready)('createTask, as each role that may create one', () => {
  it('lets a Member create an unassigned task in a project they can see', async () => {
    /* A Member sees a project only once they have work in it (BR-016), so the
       pair has to come from `project_members` — picking any active project would
       fail on visibility rather than on the bug this guards. */
    const people = await sql`
      select u.id, pm.project_id
        from public.users u
        join public.project_members pm on pm.user_id = u.id
        join public.projects p on p.id = pm.project_id
       where u.role = 'member'
         and u.is_active
         and p.status = 'active'
         and p.is_draft = false
       limit 1
    `;

    /* Skipped rather than failed on a database with no Member — the suite has to
       stay runnable against a fresh one. */
    if (people.length === 0) return;

    const memberId = people[0].id as string;
    const projectId = people[0].project_id as string;

    const task = await createTask(memberId, {
      title: 'Regression — a Member creating their own task',
      projectId,
      assigneeId: null,
      status: 'backlog',
      priority: 'medium',
      effortSize: 'S',
      effortPoints: 2,
    });

    made.push(task.id);

    expect(task.id).toBeTruthy();
    expect(task.reference).toMatch(/^[A-Z]{3}-\d+$/);

    /* And they can read it back afterwards, which is the other half of the
       contract — created_by_id is what `task_is_visible` matches on. */
    const seen = await withUser(memberId, (tx) => tx`
      select id from public.tasks where id = ${task.id}
    `);
    expect(seen).toHaveLength(1);
  });
});
