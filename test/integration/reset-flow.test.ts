import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyPassword } from '@/lib/auth/hashing';
import {
  expiresInMinutes,
  generateNumericCode,
  hashScopedCode,
} from '@/lib/auth/tokens';
import { sql } from '@/lib/db/client';
import {
  consumeToken,
  deviceIsKnown,
  findIdentity,
  issueToken,
  registerTokenAttempt,
  setPassword,
} from '@/lib/db/queries/auth';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

/* ============================================================================
 * GATE — PASSWORD RESET AND UNLOCK
 * ----------------------------------------------------------------------------
 * The unit suite proves the lockout rule and the SQL gate proves each function.
 * This proves the CHAIN: that a six-digit code issued for one person cannot be
 * used by another, that it dies after one use, and that resetting a password
 * genuinely revokes every session.
 *
 * The scoping test is the one worth having. With an unscoped code hash, guessing
 * ANY live code in the system resets SOMEBODY's password — the attacker never
 * has to know whose. That is a six-digit space shared across the whole team
 * rather than per account, and it is the kind of mistake that reviews well and
 * fails badly.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';

let alice = { id: '', email: '' };
let bob = { id: '', email: '' };

beforeAll(async () => {
  const rows = await sql`
    select id, email from public.users
     where email like ${'%@' + DOMAIN} and is_active and role = 'member'
     order by email limit 2
  `;
  if (rows.length < 2) throw new Error('Run `npm run seed:demo` first.');
  alice = { id: rows[0].id as string, email: rows[0].email as string };
  bob = { id: rows[1].id as string, email: rows[1].email as string };
});

afterAll(async () => {
  await sql`
    update public.invitations set invalidated_at = now()
     where user_id in (${alice.id}, ${bob.id}) and consumed_at is null
  `.catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
});

async function issueCodeFor(person: { id: string; email: string }, purpose: 'password_reset' | 'account_unlock') {
  const code = generateNumericCode(6);
  await issueToken({
    userId: person.id,
    tokenHash: hashScopedCode(purpose, person.email, code),
    purpose,
    sentToEmail: person.email,
    expiresAt: expiresInMinutes(Date.now(), SYSTEM_DEFAULTS.recoveryCodeTtlMinutes),
    createdBy: null,
  });
  return code;
}

describe('a reset code belongs to one account', () => {
  it("Bob cannot use Alice's code, even holding the digits", async () => {
    const code = await issueCodeFor(alice, 'password_reset');

    /* The whole attack this prevents: knowing a valid code but not whose it is.
       Hashed with the account, the same six digits produce a different digest
       for Bob, and the lookup finds nothing. */
    const asBob = await consumeToken(hashScopedCode('password_reset', bob.email, code), 'password_reset');
    expect(asBob.status).not.toBe('ok');

    const asAlice = await consumeToken(hashScopedCode('password_reset', alice.email, code), 'password_reset');
    expect(asAlice.status).toBe('ok');
    expect(asAlice.userId).toBe(alice.id);
  });

  it('a reset code cannot be presented as an unlock code', async () => {
    const code = await issueCodeFor(alice, 'password_reset');

    /* Different consequences — an unlock keeps the password, a reset replaces
       it — so the purpose is part of the hash and part of the lookup. */
    const wrongPurpose = await consumeToken(
      hashScopedCode('account_unlock', alice.email, code),
      'account_unlock',
    );
    expect(wrongPurpose.status).not.toBe('ok');
  });

  it('two people can hold the same six digits without colliding', async () => {
    /* invitations.token_hash is globally unique. An unscoped hash would make
       this insert fail roughly one time in a million — rare enough to reach
       production, frequent enough to happen there.

       ⚠️ The digits must be fresh on every run. A hard-coded value passed the
       first time and then failed for the rest of the day on the unique index,
       because a *consumed* invitation still occupies its hash. A test that only
       passes against a clean database is a test that will be ignored. */
    const shared = generateNumericCode(6);
    for (const person of [alice, bob]) {
      await issueToken({
        userId: person.id,
        tokenHash: hashScopedCode('password_reset', person.email, shared),
        purpose: 'password_reset',
        sentToEmail: person.email,
        expiresAt: expiresInMinutes(Date.now(), 15),
        createdBy: null,
      });
    }

    const forAlice = await consumeToken(hashScopedCode('password_reset', alice.email, shared), 'password_reset');
    const forBob = await consumeToken(hashScopedCode('password_reset', bob.email, shared), 'password_reset');
    expect(forAlice.userId).toBe(alice.id);
    expect(forBob.userId).toBe(bob.id);
  });
});

describe('a code works once, and not after it is replaced', () => {
  it('the second use is refused', async () => {
    const code = await issueCodeFor(alice, 'password_reset');
    const hash = hashScopedCode('password_reset', alice.email, code);

    expect((await consumeToken(hash, 'password_reset')).status).toBe('ok');
    expect((await consumeToken(hash, 'password_reset')).status).not.toBe('ok');
  });

  it('asking for a new code kills the previous one', async () => {
    const older = await issueCodeFor(alice, 'password_reset');
    const newer = await issueCodeFor(alice, 'password_reset');

    const stale = await consumeToken(hashScopedCode('password_reset', alice.email, older), 'password_reset');
    expect(stale.status).not.toBe('ok');

    const fresh = await consumeToken(hashScopedCode('password_reset', alice.email, newer), 'password_reset');
    expect(fresh.status).toBe('ok');
  });

  it('wrong guesses burn the code before the space can be walked', async () => {
    const code = await issueCodeFor(alice, 'password_reset');
    const hash = hashScopedCode('password_reset', alice.email, code);

    /* Six digits is only defensible because of this. Without an attempt cap a
       million tries is an afternoon. */
    for (let i = 0; i < SYSTEM_DEFAULTS.recoveryCodeMaxAttempts + 1; i += 1) {
      await registerTokenAttempt(hash);
    }

    const afterBurning = await consumeToken(hash, 'password_reset');
    expect(afterBurning.status).not.toBe('ok');
  });
});

describe('FR-155c — a reset ends every session', () => {
  it('revokes sessions that existed before the password changed', async () => {
    /* A fresh hash per run, for the same reason as above: refresh_token_hash is
       uniquely indexed, and revoked rows keep their hash. */
    const fakeTokenHash = createHash('sha256')
      .update(`reset-flow-test:${Date.now()}:${Math.random()}`)
      .digest('hex');

    const before = await sql`
      insert into public.sessions
        (user_id, refresh_token_hash, device_fingerprint, expires_at, absolute_expires_at)
      values (
        ${alice.id}, ${fakeTokenHash}, 'reset-test-device',
        now() + interval '1 hour', now() + interval '2 hours'
      )
      returning id
    `;

    const identity = await findIdentity(alice.email);
    expect(identity).toBeTruthy();
    const originalHash = identity!.passwordHash;

    /* app.auth_set_password revokes everything in the same statement — because a
       reset prompted by a suspected compromise is worthless if the intruder's
       session survives it. */
    await setPassword(alice.id, originalHash!);

    const after = await sql`select revoked_at from public.sessions where id = ${before[0].id}`;
    expect(after[0].revoked_at).not.toBeNull();
  });

  it('the stored hash still verifies the original password afterwards', async () => {
    /* Guards the test above: it re-set the SAME hash, so the demo password must
       still work. If this fails, that test corrupted the seeded account rather
       than exercising revocation. */
    const identity = await findIdentity(alice.email);
    expect(await verifyPassword(identity!.passwordHash!, 'Marigold-Harbour-92')).toBe(true);
  });
});

describe('FR-151 — new-device detection', () => {
  it('recognises a fingerprint the account has used, and not one it has not', async () => {
    expect(await deviceIsKnown(alice.id, 'reset-test-device')).toBe(true);
    expect(await deviceIsKnown(alice.id, 'a-device-never-seen-before')).toBe(false);
    /* Per account, not global — Bob using his own laptop is a new device for
       Alice, and an alert that ignored that would be meaningless. */
    expect(await deviceIsKnown(bob.id, 'reset-test-device')).toBe(false);
  });
});
