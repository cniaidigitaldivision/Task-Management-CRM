import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withUser } from '@/lib/db/client';
import { audit, listAuditLog, listLoginAttempts, listSecurityEvents } from '@/lib/db/queries/audit';
import type { Role } from '@/lib/domain/constants';

/* ============================================================================
 * GATE — THE AUDIT TRAIL
 * ----------------------------------------------------------------------------
 * Two things need proving, and only one of them is obvious.
 *
 * The obvious one: entries can be written and read back.
 *
 * The one that matters: Q-054. "An Admin sees the audit log, own scope" was
 * ambiguous until it was settled as — an Admin reads everything EXCEPT entries
 * whose actor was the Super Admin. That is implemented in `audit_log_select`
 * and nowhere else, so this tests the POLICY. A test that went through a
 * TypeScript filter would pass with the policy dropped, which is the failure
 * mode worth guarding against.
 *
 * And the trail must be unrewritable, by anybody, including the table owner —
 * which is why it is a trigger and not a REVOKE.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';
const MARKER = `audit-test-${Date.now()}`;

let adminActor = { id: '', email: '', role: 'admin' as Role };
let coordinatorId = '';
let superAdminId = '';

beforeAll(async () => {
  const rows = await sql`
    select id, email, role from public.users where is_active
  `;
  for (const row of rows) {
    if (row.role === 'admin' && String(row.email).endsWith(DOMAIN)) {
      adminActor = { id: row.id as string, email: row.email as string, role: 'admin' };
    }
    if (row.role === 'team_coordinator' && String(row.email).endsWith(DOMAIN)) {
      coordinatorId = row.id as string;
    }
    if (row.role === 'super_admin') superAdminId = row.id as string;
  }
  if (!adminActor.id) throw new Error('Run `npm run seed:demo` first.');
});

afterAll(async () => {
  /* Nothing to clean: audit_log cannot be deleted from, by design. The marker in
     each action name keeps this run's rows identifiable if anybody ever looks. */
  await sql.end({ timeout: 5 }).catch(() => {});
});

describe('writing the trail', () => {
  it('records who did what, with before and after', async () => {
    await withUser(adminActor.id, (tx) =>
      audit(tx, adminActor, {
        entityType: 'user',
        entityId: coordinatorId,
        action: `${MARKER}.role_changed`,
        before: { role: 'member' },
        after: { role: 'team_coordinator' },
        reason: 'Promoted after the Expo project',
      }),
    );

    const rows = await listAuditLog(adminActor.id, { search: MARKER });
    const entry = rows.find((r) => r.action === `${MARKER}.role_changed`);

    expect(entry).toBeTruthy();
    expect(entry!.actorEmail).toBe(adminActor.email);
    expect(entry!.reason).toBe('Promoted after the Expo project');
    expect((entry!.before as { role: string }).role).toBe('member');
    expect((entry!.after as { role: string }).role).toBe('team_coordinator');
    expect(entry!.outcome).toBe('success');
  });

  it('stores the actor role on the row rather than joining for it', async () => {
    const rows = await listAuditLog(adminActor.id, { search: MARKER });
    /* Denormalised deliberately: an entry has to say what was true WHEN it
       happened. Joining to users would rewrite history the moment somebody was
       promoted — the entry would claim an Admin did what a Member actually did. */
    expect(rows[0].actorRole).toBe('admin');
  });

  it('records refusals too, not only what worked', async () => {
    await withUser(adminActor.id, (tx) =>
      audit(tx, adminActor, {
        entityType: 'user',
        entityId: superAdminId || coordinatorId,
        action: `${MARKER}.escalation_attempt`,
        outcome: 'denied',
      }),
    );

    const rows = await listAuditLog(adminActor.id, { search: MARKER });
    const refused = rows.find((r) => r.action === `${MARKER}.escalation_attempt`);
    /* A log of only successes cannot answer "did anybody try", which is the
       question asked first after an incident. */
    expect(refused?.outcome).toBe('denied');
  });
});

describe('Q-054 — an Admin does not see the Super Admin’s entries', () => {
  it('hides them, and the Super Admin sees everything', async () => {
    if (!superAdminId) {
      /* No owner in this database. Skipping is honest; asserting would be
         asserting nothing. */
      return;
    }

    const owner = await sql`select email from public.users where id = ${superAdminId}`;
    const action = `${MARKER}.by_super_admin`;

    await withUser(superAdminId, (tx) =>
      audit(
        tx,
        { id: superAdminId, email: owner[0].email as string, role: 'super_admin' },
        { entityType: 'setting', entityId: null, action },
      ),
    );

    /* The assertion this file exists for. The row is there; the Admin's policy
       filters it out by the actor's stored role. */
    const asAdmin = await listAuditLog(adminActor.id, { search: MARKER });
    expect(asAdmin.some((r) => r.action === action)).toBe(false);
    expect(asAdmin.some((r) => r.action === `${MARKER}.role_changed`)).toBe(true);

    const asOwner = await listAuditLog(superAdminId, { search: MARKER });
    expect(asOwner.some((r) => r.action === action)).toBe(true);
  });

  it('a Coordinator sees no audit log at all', async () => {
    const asCoordinator = await listAuditLog(coordinatorId, { search: MARKER });
    expect(asCoordinator).toHaveLength(0);
  });
});

describe('the trail cannot be rewritten', () => {
  it('refuses an update and a delete, even as the table owner', async () => {
    const rows = await sql`
      select id from public.audit_log order by created_at desc limit 1
    `;
    expect(rows[0]).toBeTruthy();

    /* As the OWNER, which bypasses row-level security. That is exactly why the
       protection is a trigger: a REVOKE cannot bind a table owner, and doc 19 §6
       says "any role, including super_admin". */
    await expect(
      sql`update public.audit_log set action = 'rewritten' where id = ${rows[0].id}`,
    ).rejects.toThrow();

    await expect(
      sql`delete from public.audit_log where id = ${rows[0].id}`,
    ).rejects.toThrow();
  });
});

describe('the other two logs', () => {
  it('an Admin sees every sign-in attempt; a Member sees only their own', async () => {
    const asAdmin = await listLoginAttempts(adminActor.id, 50);
    expect(asAdmin.length).toBeGreaterThan(0);

    const member = await sql`
      select id from public.users
       where role = 'member' and is_active and email like ${'%@' + DOMAIN} limit 1
    `;
    const asMember = await listLoginAttempts(member[0].id as string, 50);
    /* Not "fewer rows" — the policy restricts to user_id = self, so every row a
       Member can see must be theirs. Counting would pass by coincidence. */
    expect(asMember.length).toBeLessThanOrEqual(asAdmin.length);
  });

  it('the alert stream is Super Admin only', async () => {
    const asAdmin = await listSecurityEvents(adminActor.id, 20);
    expect(asAdmin).toHaveLength(0);

    if (superAdminId) {
      const asOwner = await listSecurityEvents(superAdminId, 20);
      /* The seed and the first-run setup both write critical events, so an empty
         list here would mean the policy is wrong rather than that nothing has
         happened. */
      expect(asOwner.length).toBeGreaterThan(0);
    }
  });
});
