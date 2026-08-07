import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateToken, hashToken } from '@/lib/auth/tokens';
import { sql, withAppRole, withUser } from '@/lib/db/client';
import { consumeToken, issueToken } from '@/lib/db/queries/auth';
import { createPerson, emailIsTaken, setPersonActive, setPersonRole } from '@/lib/db/queries/provisioning';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

/* ============================================================================
 * GATE — THE PROVISIONING CHAIN, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * FR-141 says Super Admin → Admin → Coordinator/Member. The server action checks
 * it, but the action is not the guarantee — `users_insert` is, and this proves
 * the policy rather than the branch above it. A test that only exercised the
 * action would pass with the policy dropped.
 *
 * The negative assertions are the point of this file: what an Admin CANNOT do,
 * and what nobody can do.
 *
 * Everything is cleaned up afterwards, except the one thing that cannot be —
 * a user row, because BR-007 forbids deleting one and a trigger enforces it.
 * Test accounts are therefore deactivated, which is exactly what the product
 * does with a real departure.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';
const STAMP = 'prov-test';

let adminId = '';
let coordinatorId = '';
let memberId = '';
const created: string[] = [];

beforeAll(async () => {
  const rows = await sql`
    select id, email, role from public.users
     where email like ${'%@' + DOMAIN} and is_active
  `;
  if (rows.length === 0) {
    throw new Error('Run `npm run seed:demo` first.');
  }
  for (const row of rows) {
    if (row.role === 'admin') adminId = row.id as string;
    if (row.role === 'team_coordinator') coordinatorId = row.id as string;
    if (row.role === 'member' && !memberId) memberId = row.id as string;
  }
  expect(adminId, 'the seed should contain an Admin').toBeTruthy();
});

afterAll(async () => {
  /* Deactivate rather than delete — the trigger refuses a delete, and that
     refusal is a feature being relied on elsewhere in this very suite. */
  if (created.length > 0) {
    await sql`
      update public.users
         set is_active = false, account_state = 'deactivated',
             email = 'retired-' || id::text || '@' || ${STAMP} || '.invalid'
       where id = any(${created}::uuid[])
    `.catch(() => {});
  }
  await sql.end({ timeout: 5 }).catch(() => {});
});

function freshEmail(label: string): string {
  return `${STAMP}-${label}-${Date.now()}@${STAMP}.invalid`;
}

describe('FR-141 — the provisioning chain is enforced by the database', () => {
  it('an Admin can create a Coordinator and a Member', async () => {
    for (const role of ['team_coordinator', 'member'] as const) {
      const id = await createPerson(adminId, {
        fullName: `Chain ${role}`,
        email: freshEmail(role),
        role,
        roleTitle: 'Test',
        weeklyCapacityPoints: SYSTEM_DEFAULTS.defaultWeeklyCapacity,
        maxConcurrentTasks: SYSTEM_DEFAULTS.defaultMaxConcurrentTasks,
      });
      created.push(id);
      expect(id).toBeTruthy();
    }
  });

  it('an Admin CANNOT create another Admin — the policy refuses it', async () => {
    await expect(
      createPerson(adminId, {
        fullName: 'Should not exist',
        email: freshEmail('admin'),
        role: 'admin',
        roleTitle: null,
        weeklyCapacityPoints: 36,
        maxConcurrentTasks: 5,
      }),
    ).rejects.toThrow();
  });

  it('a Coordinator cannot create anybody at all', async () => {
    await expect(
      createPerson(coordinatorId, {
        fullName: 'Should not exist',
        email: freshEmail('by-coordinator'),
        role: 'member',
        roleTitle: null,
        weeklyCapacityPoints: 36,
        maxConcurrentTasks: 5,
      }),
    ).rejects.toThrow();
  });

  it('a Member cannot create anybody either', async () => {
    await expect(
      createPerson(memberId, {
        fullName: 'Should not exist',
        email: freshEmail('by-member'),
        role: 'member',
        roleTitle: null,
        weeklyCapacityPoints: 36,
        maxConcurrentTasks: 5,
      }),
    ).rejects.toThrow();
  });

  it('nobody can create a second Super Admin, even as the owner role', async () => {
    await expect(
      withAppRole((tx) => tx`
        insert into public.users (full_name, email, role, account_state)
        values ('Second owner', ${freshEmail('super')}, 'super_admin', 'active')
      `),
    ).rejects.toThrow();
  });
});

describe('a new account has no credential until activation', () => {
  let personId = '';
  const email = freshEmail('activation');
  let token = '';

  it('is created pending, with no password identity', async () => {
    personId = await createPerson(adminId, {
      fullName: 'Activation Subject',
      email,
      role: 'member',
      roleTitle: 'Tester',
      weeklyCapacityPoints: 30,
      maxConcurrentTasks: 4,
    });
    created.push(personId);

    const rows = await sql`
      select u.account_state,
             (select count(*) from public.auth_identities a where a.user_id = u.id) as identities
        from public.users u where u.id = ${personId}
    `;
    expect(rows[0].account_state).toBe('pending_activation');
    /* The whole point of doc 16 §3: there is nothing to leak because nothing
       exists. No password, no temporary password, no identity row. */
    expect(Number(rows[0].identities)).toBe(0);
  });

  it('stores only the hash of the invitation token, never the token', async () => {
    token = generateToken();
    await issueToken({
      userId: personId,
      tokenHash: hashToken(token),
      purpose: 'activation',
      sentToEmail: email,
      expiresAt: new Date(Date.now() + 48 * 3600_000),
      createdBy: adminId,
    });

    const rows = await sql`
      select token_hash from public.invitations where user_id = ${personId}
    `;
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_hash).not.toBe(token);
    // Migration 001 makes this a database invariant, not a convention.
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the token works exactly once', async () => {
    const first = await consumeToken(hashToken(token), 'activation');
    expect(first.status).toBe('ok');
    expect(first.userId).toBe(personId);

    const second = await consumeToken(hashToken(token), 'activation');
    expect(second.status).not.toBe('ok');
  });

  it('re-issuing supersedes the previous link', async () => {
    const older = generateToken();
    await issueToken({
      userId: personId,
      tokenHash: hashToken(older),
      purpose: 'activation',
      sentToEmail: email,
      expiresAt: new Date(Date.now() + 48 * 3600_000),
      createdBy: adminId,
    });

    const newer = generateToken();
    await issueToken({
      userId: personId,
      tokenHash: hashToken(newer),
      purpose: 'activation',
      sentToEmail: email,
      expiresAt: new Date(Date.now() + 48 * 3600_000),
      createdBy: adminId,
    });

    /* Otherwise "single use" would be a lie the moment anybody clicked Resend —
       two live links into the same account. */
    const stale = await consumeToken(hashToken(older), 'activation');
    expect(stale.status).not.toBe('ok');

    const fresh = await consumeToken(hashToken(newer), 'activation');
    expect(fresh.status).toBe('ok');
  });
});

describe('the email address has to be unique', () => {
  it('a duplicate is caught before the insert, and refused by the index regardless', async () => {
    const email = freshEmail('dupe');
    const id = await createPerson(adminId, {
      fullName: 'First',
      email,
      role: 'member',
      roleTitle: null,
      weeklyCapacityPoints: 36,
      maxConcurrentTasks: 5,
    });
    created.push(id);

    expect(await emailIsTaken(adminId, email)).toBe(true);
    expect(await emailIsTaken(adminId, email.toUpperCase())).toBe(true);

    await expect(
      createPerson(adminId, {
        fullName: 'Second',
        email,
        role: 'member',
        roleTitle: null,
        weeklyCapacityPoints: 36,
        maxConcurrentTasks: 5,
      }),
    ).rejects.toThrow();
  });
});

describe('deactivation and role changes', () => {
  let personId = '';

  beforeAll(async () => {
    personId = await createPerson(adminId, {
      fullName: 'Lifecycle Subject',
      email: freshEmail('lifecycle'),
      role: 'member',
      roleTitle: null,
      weeklyCapacityPoints: 36,
      maxConcurrentTasks: 5,
    });
    created.push(personId);
  });

  it('an Admin can deactivate and restore', async () => {
    await setPersonActive(adminId, personId, false);
    let rows = await sql`select is_active, account_state from public.users where id = ${personId}`;
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].account_state).toBe('deactivated');

    await setPersonActive(adminId, personId, true);
    rows = await sql`select is_active from public.users where id = ${personId}`;
    expect(rows[0].is_active).toBe(true);
  });

  it('an Admin can promote a Member to Coordinator', async () => {
    await setPersonRole(adminId, personId, 'team_coordinator');
    const rows = await sql`select role from public.users where id = ${personId}`;
    expect(rows[0].role).toBe('team_coordinator');
  });

  it('the Super Admin row cannot be written by anybody else', async () => {
    const owner = await sql`select id from public.users where role = 'super_admin' limit 1`;
    if (!owner[0]) return; // no owner in this database; nothing to protect

    await expect(
      withUser(adminId, (tx) => tx`
        update public.users set full_name = 'Renamed by an admin' where id = ${owner[0].id}
      `.then((r) => {
        /* RLS filters it to zero rows rather than raising, so the assertion is
           that nothing changed — not that something threw. */
        return r;
      })),
    ).resolves.toBeDefined();

    const after = await sql`select full_name from public.users where id = ${owner[0].id}`;
    expect(after[0].full_name).not.toBe('Renamed by an admin');
  });

  it('a user row can never be deleted, by any role', async () => {
    await expect(
      sql`delete from public.users where id = ${personId}`,
    ).rejects.toThrow(/deactivated, never deleted|forbidden/i);
  });
});
