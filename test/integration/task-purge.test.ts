import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/lib/db/client';

/* ============================================================================
 * GATE — PURGING A TASK, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * Migration 019 added the DELETE policy `public.tasks` had been missing since
 * migration 013. Before it, a purge deleted **zero rows and raised nothing** —
 * RLS was enabled, no DELETE policy existed, and with RLS on a command with no
 * policy is refused for every row. The DELETE privilege was already granted to
 * `cni_app`, so it looked permitted while every row was refused.
 *
 * That is the second time this schema has hit that exact shape. Session 11:
 * *"the RLS delete policy being Super-Admin-only meant an Admin's Reset deleted
 * zero rows with no error."* It is worth a permanent test rather than a note,
 * because nothing else can catch it: the statement succeeds, the calling code
 * writes its audit entry, and the interface reports success.
 *
 * ── EVERY CASE RUNS INSIDE A TRANSACTION THAT IS ROLLED BACK ─────────────────
 * A purge is irreversible by definition, so nothing here is allowed to commit.
 * The final assertion in each block re-reads on a FRESH connection, so a
 * rollback that did not take fails the suite loudly instead of quietly
 * destroying seeded demo data.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

class Rollback extends Error {
  constructor() {
    super('deliberate rollback');
  }
}

/** Run as `userId` with the identity `withUser` sets, then ROLL BACK. */
async function rolledBack<T>(userId: string, fn: (tx: never) => Promise<T>): Promise<T> {
  let captured: T | undefined;
  let ran = false;
  try {
    await sql.begin(async (tx) => {
      await tx`
        select set_config('role', 'cni_app', true),
               set_config('app.user_id', ${userId}, true)
      `;
      captured = await fn(tx as never);
      ran = true;
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  expect(ran, 'the body should have run to completion before the rollback').toBe(true);
  return captured as T;
}

let superAdminId = '';
let adminId = '';
let memberId = '';
let taskId = '';
let taskReference = '';

beforeAll(async () => {
  const [sa] = await sql`select id from public.users where role = 'super_admin'`;
  const [admin] = await sql`select id from public.users where email = 'sana@cni-demo.com'`;
  const [member] = await sql`select id from public.users where email = 'yusra@cni-demo.com'`;
  if (!sa || !admin || !member) throw new Error('Run `npm run seed:demo` first.');

  superAdminId = sa.id as string;
  adminId = admin.id as string;
  memberId = member.id as string;

  /* A task that actually has children, so the cascade is exercised rather than
     assumed. Prefer one with comments; fall back to any open task. */
  const [withChildren] = await sql`
    select t.id, t.reference
      from public.tasks t
     where not t.is_deleted
       and (select count(*) from public.comments c where c.task_id = t.id) > 0
     limit 1
  `;
  const [any] = await sql`select id, reference from public.tasks where not is_deleted limit 1`;
  const chosen = withChildren ?? any;
  if (!chosen) throw new Error('No tasks in the database — run `npm run seed:demo`.');

  taskId = chosen.id as string;
  taskReference = chosen.reference as string;
});

afterAll(async () => {
  await sql.end({ timeout: 5 }).catch(() => {});
});

describe('migration 019 — the DELETE policy exists at all', () => {
  it('public.tasks has a delete policy, which it did not before', async () => {
    const rows = await sql`
      select polname, polcmd from pg_policy
       where polrelid = 'public.tasks'::regclass
       order by polname
    `;
    const commands = rows.map((row) => row.polcmd as string);
    /* 'd' is DELETE in pg_policy.polcmd. Its absence was the whole bug. */
    expect(commands).toContain('d');
    expect(rows.map((row) => row.polname)).toContain('tasks_delete');
  });

  it('row-level security is still ON — the policy is a grant, not a bypass', async () => {
    const [row] = await sql`
      select relrowsecurity from pg_class where oid = 'public.tasks'::regclass
    `;
    expect(row.relrowsecurity).toBe(true);
  });
});

describe('who may actually destroy a task', () => {
  it('the SUPER ADMIN can — this returned 0 rows before migration 019', async () => {
    const deleted = await rolledBack(superAdminId, async (tx) => {
      const rows = await (tx as unknown as typeof sql)`
        delete from public.tasks where id = ${taskId} returning id
      `;
      return rows.length;
    });
    expect(deleted).toBe(1);
  });

  it('an Admin cannot', async () => {
    const deleted = await rolledBack(adminId, async (tx) => {
      const rows = await (tx as unknown as typeof sql)`
        delete from public.tasks where id = ${taskId} returning id
      `;
      return rows.length;
    });
    expect(deleted).toBe(0);
  });

  it('a Member cannot', async () => {
    const deleted = await rolledBack(memberId, async (tx) => {
      const rows = await (tx as unknown as typeof sql)`
        delete from public.tasks where id = ${taskId} returning id
      `;
      return rows.length;
    });
    expect(deleted).toBe(0);
  });

  it('and the task is still there — every case above rolled back', async () => {
    const [row] = await sql`select reference from public.tasks where id = ${taskId}`;
    expect(row?.reference, 'THE ROLLBACK DID NOT TAKE — fix this now').toBe(taskReference);
  });
});

describe('what goes with it', () => {
  /* Referential actions are performed by the system and are NOT subject to
     row-level security, so the cascade completes regardless of whether the
     child tables have delete policies of their own. Worth proving rather than
     trusting, because the whole point of migration 019 is that an assumption
     about RLS and deletes was wrong once already. */
  it('comments, checklist items, dependencies and time entries all cascade', async () => {
    const counts = await rolledBack(superAdminId, async (tx) => {
      const t = tx as unknown as typeof sql;
      const before = await t`
        select
          (select count(*) from public.comments        where task_id = ${taskId}) as comments,
          (select count(*) from public.checklist_items where task_id = ${taskId}) as checklist,
          (select count(*) from public.time_entries    where task_id = ${taskId}) as times,
          (select count(*) from public.task_watchers   where task_id = ${taskId}) as watchers
      `;
      await t`delete from public.tasks where id = ${taskId}`;
      const after = await t`
        select
          (select count(*) from public.comments        where task_id = ${taskId}) as comments,
          (select count(*) from public.checklist_items where task_id = ${taskId}) as checklist,
          (select count(*) from public.time_entries    where task_id = ${taskId}) as times,
          (select count(*) from public.task_watchers   where task_id = ${taskId}) as watchers
      `;
      return { before: before[0], after: after[0] };
    });

    for (const key of ['comments', 'checklist', 'times', 'watchers'] as const) {
      expect(Number(counts.after[key]), `${key} should have cascaded to zero`).toBe(0);
    }
  });

  it('but the audit trail SURVIVES — it holds a snapshot, not a foreign key', async () => {
    /* `audit_log.entity_id` and `activity_log.entity_id` are plain uuids with
       no reference to `tasks`, deliberately since Step 6. A purge that erased
       its own record would be worthless. */
    const rows = await sql`
      select conname from pg_constraint
       where contype = 'f'
         and conrelid in ('public.audit_log'::regclass, 'public.activity_log'::regclass)
         and confrelid = 'public.tasks'::regclass
    `;
    expect(rows.length, 'the trail must not cascade with the task').toBe(0);
  });
});
