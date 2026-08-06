import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* Load .env.local before anything imports the client, which reads
 * process.env.DATABASE_URL at module scope. */
function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] ??= value;
    }
  } catch {
    /* handled by the skip below */
  }
}
loadEnvLocal();

const CONFIGURED = Boolean(process.env.DATABASE_URL && process.env.TOKEN_PEPPER);

/* ============================================================================
 * GATE 4 — "lockout, unlock and MFA all work end to end"  (doc 20 §9, step 4)
 * ----------------------------------------------------------------------------
 * The unit suite proves each rule in isolation (640 tests) and the SQL gate
 * proves each database function in isolation (32 assertions). Neither proves the
 * WIRING — that the server action composes them in the right order, against the
 * real schema, with the real Argon2 and the real RLS in the way.
 *
 * This drives the same sequence the sign-in action does, through the same query
 * layer, against the real database.
 *
 * ── CLEANUP ──────────────────────────────────────────────────────────────────
 * `users` rows cannot be deleted — BR-007, enforced by a trigger. So the
 * fixtures are removed through `withBreakGlass`, which is the documented escape
 * (doc 16 §6) and gets exercised here as a side benefit.
 *
 * That leaves `security_events` rows behind by design: they are append-only, and
 * a break-glass use that left no trace would defeat the point of the mechanism.
 * ========================================================================= */

const suite = CONFIGURED ? describe : describe.skip;

suite('Gate 4 — sign-in, lockout, unlock, MFA', () => {
  let sql: typeof import('@/lib/db/client').sql;
  let withBreakGlass: typeof import('@/lib/db/client').withBreakGlass;
  let q: typeof import('@/lib/db/queries/auth');
  let hashing: typeof import('@/lib/auth/hashing');
  let tokens: typeof import('@/lib/auth/tokens');
  let totp: typeof import('@/lib/auth/totp');
  let lockout: typeof import('@/lib/domain/lockout');

  const EMAIL = `verify.gate4.${Date.now()}@cni.test`;
  const PASSWORD = 'correct horse battery staple';
  const NEW_PASSWORD = 'lantern gravel windowsill quay';
  let userId = '';
  let totpSecret = '';

  beforeAll(async () => {
    ({ sql, withBreakGlass } = await import('@/lib/db/client'));
    q = await import('@/lib/db/queries/auth');
    hashing = await import('@/lib/auth/hashing');
    tokens = await import('@/lib/auth/tokens');
    totp = await import('@/lib/auth/totp');
    lockout = await import('@/lib/domain/lockout');

    // Fixture insert runs on the outer session (postgres), because creating a
    // user through cni_app would need an admin identity — correctly refused.
    const [row] = await sql`
      insert into public.users (full_name, email, role, account_state)
      values ('Verify Gate Four', ${EMAIL}, 'member', 'active')
      returning id
    `;
    userId = row.id as string;

    await q.setPassword(userId, await hashing.hashPassword(PASSWORD));
  });

  afterAll(async () => {
    if (userId) {
      await withBreakGlass('Integration test fixture cleanup for Gate 4 verification', async (tx) => {
        await tx`delete from public.sessions       where user_id = ${userId}`;
        await tx`delete from public.mfa_factors    where user_id = ${userId}`;
        await tx`delete from public.invitations    where user_id = ${userId}`;
        await tx`delete from public.login_attempts where user_id = ${userId}`;
        await tx`delete from public.auth_identities where user_id = ${userId}`;
        await tx`delete from public.users          where id = ${userId}`;
      });
    }
    await sql.end({ timeout: 5 });
  });

  /* ---- 1 · identity and password --------------------------------------- */

  it('finds the account and returns a real Argon2id hash', async () => {
    const identity = await q.findIdentity(EMAIL);
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(userId);
    expect(identity!.role).toBe('member');
    expect(identity!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(identity!.hasVerifiedMfa).toBe(false);
  });

  it('is case-insensitive on the address', async () => {
    expect(await q.findIdentity(EMAIL.toUpperCase())).not.toBeNull();
  });

  it('returns null for an unknown address rather than throwing — FR-155e', async () => {
    expect(await q.findIdentity(`nobody.${Date.now()}@cni.test`)).toBeNull();
  });

  it('verifies the right password and refuses the wrong one', async () => {
    const identity = await q.findIdentity(EMAIL);
    expect(await hashing.verifyPassword(identity!.passwordHash!, PASSWORD)).toBe(true);
    expect(await hashing.verifyPassword(identity!.passwordHash!, 'wrong password')).toBe(false);
  });

  it('does not want a rehash at the current parameters', async () => {
    const identity = await q.findIdentity(EMAIL);
    expect(hashing.needsRehash(identity!.passwordHash!)).toBe(false);
  });

  /* ---- 2 · the lockout, composed as the action composes it ------------- */

  it('locks the account after three recorded failures — FR-155a', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    for (let i = 0; i < 2; i += 1) {
      await q.recordAttempt({ email: EMAIL, userId, outcome: 'bad_password' });
    }

    let inputs = await q.getLockoutInputs(userId, since);
    let state = lockout.evaluateLockout(inputs.attempts, inputs.now, {
      clearedAt: inputs.clearedAt,
    });
    expect(state.isLocked).toBe(false);
    expect(state.attemptsRemaining).toBe(1);
    expect(state.warnBeforeLock).toBe(true);

    await q.recordAttempt({ email: EMAIL, userId, outcome: 'bad_password' });

    inputs = await q.getLockoutInputs(userId, since);
    state = lockout.evaluateLockout(inputs.attempts, inputs.now, { clearedAt: inputs.clearedAt });
    expect(state.isLocked).toBe(true);
    expect(state.attemptsRemaining).toBe(0);

    await q.setLock(userId, new Date(state.lockedAt!));
    const identity = await q.findIdentity(EMAIL);
    expect(identity!.accountState).toBe('locked');
    expect(identity!.lockedAt).not.toBeNull();
  });

  it('a further attempt while locked does NOT extend the lock — doc 16 §4', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const before = await q.getLockoutInputs(userId, since);
    const lockedAtBefore = lockout.evaluateLockout(before.attempts, before.now, {
      clearedAt: before.clearedAt,
    }).lockedAt;

    await q.recordAttempt({ email: EMAIL, userId, outcome: 'locked' });

    const after = await q.getLockoutInputs(userId, since);
    const lockedAtAfter = lockout.evaluateLockout(after.attempts, after.now, {
      clearedAt: after.clearedAt,
    }).lockedAt;

    // Anchored to the third FAILURE, so hammering a locked account cannot hold
    // a colleague out indefinitely.
    expect(lockedAtAfter).toBe(lockedAtBefore);
  });

  /* ---- 3 · unlock by emailed code — ADR-007, C-17 --------------------- */

  it('unlocks through an emailed code and a new password', async () => {
    const code = tokens.generateNumericCode();
    const codeHash = tokens.hashCode(code);

    await q.issueToken({
      userId,
      tokenHash: codeHash,
      purpose: 'account_unlock',
      sentToEmail: EMAIL,
      expiresAt: tokens.expiresInMinutes(Date.now(), 15),
    });

    // A wrong code must not consume the right one.
    const wrong = await q.consumeToken(tokens.hashCode('000000'), 'account_unlock');
    expect(wrong.status).toBe('not_found');

    const consumed = await q.consumeToken(codeHash, 'account_unlock');
    expect(consumed.status).toBe('ok');
    expect(consumed.userId).toBe(userId);

    // Single use.
    expect((await q.consumeToken(codeHash, 'account_unlock')).status).toBe('already_used');

    await q.setPassword(userId, await hashing.hashPassword(NEW_PASSWORD));

    const identity = await q.findIdentity(EMAIL);
    expect(identity!.accountState).toBe('active');
    expect(identity!.lockedAt).toBeNull();
    expect(await hashing.verifyPassword(identity!.passwordHash!, NEW_PASSWORD)).toBe(true);
    expect(await hashing.verifyPassword(identity!.passwordHash!, PASSWORD)).toBe(false);
  });

  it('the consumed unlock token is the clearedAt the rule needs', async () => {
    const inputs = await q.getLockoutInputs(userId, new Date(Date.now() - 60 * 60 * 1000));
    expect(inputs.clearedAt).not.toBeNull();

    // Every earlier failure is now spent, so the account is clean again.
    const state = lockout.evaluateLockout(inputs.attempts, inputs.now, {
      clearedAt: inputs.clearedAt,
    });
    expect(state.isLocked).toBe(false);
    expect(state.failures).toBe(0);
  });

  /* ---- 4 · MFA — FR-145 ------------------------------------------------ */

  it('offers only verified factors, and verifies a real TOTP code', async () => {
    totpSecret = totp.generateTotpSecret();

    await sql`
      insert into public.mfa_factors
        (user_id, type, secret_encrypted, friendly_name, is_primary, verified_at)
      values (${userId}, 'totp', ${totpSecret}, 'Integration authenticator', true, now())
    `;
    await sql`
      insert into public.mfa_factors
        (user_id, type, secret_encrypted, friendly_name, verified_at)
      values (${userId}, 'totp', ${totp.generateTotpSecret()}, 'Never verified', null)
    `;

    const factors = await q.getVerifiedFactors(userId);
    expect(factors).toHaveLength(1);
    expect(factors[0].isPrimary).toBe(true);

    const now = Date.now();
    const code = totp.generateTotp(factors[0].secretEncrypted!, now);
    expect(totp.verifyTotp(factors[0].secretEncrypted!, code, now)).toBe(true);
    expect(totp.verifyTotp(factors[0].secretEncrypted!, '000000', now)).toBe(false);

    const identity = await q.findIdentity(EMAIL);
    expect(identity!.hasVerifiedMfa).toBe(true);
  });

  it('a failed MFA code counts toward the lockout — FR-148', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const before = await q.getLockoutInputs(userId, since);
    const failuresBefore = lockout.evaluateLockout(before.attempts, before.now, {
      clearedAt: before.clearedAt,
    }).failures;

    await q.recordAttempt({ email: EMAIL, userId, outcome: 'bad_mfa' });

    const after = await q.getLockoutInputs(userId, since);
    expect(
      lockout.evaluateLockout(after.attempts, after.now, { clearedAt: after.clearedAt }).failures,
    ).toBe(failuresBefore + 1);
  });

  /* ---- 5 · sessions — FR-150 ------------------------------------------ */

  it('issues a session, then revokes every one on a password change — FR-155c', async () => {
    const token = tokens.generateToken();
    const sessionId = await q.createSession({
      userId,
      refreshTokenHash: tokens.hashToken(token),
      deviceFingerprint: tokens.deviceFingerprint('vitest', 'en'),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    });
    expect(sessionId).toBeTruthy();

    expect((await q.detectReuse(tokens.hashToken(token))).outcome).toBe('ok');

    await q.setPassword(userId, await hashing.hashPassword(NEW_PASSWORD));

    const [row] = await sql`
      select count(*)::int as n from public.sessions
      where user_id = ${userId} and revoked_at is null
    `;
    expect(row.n).toBe(0);
  });

  it('detects a replayed refresh token and kills the account’s sessions — FR-150', async () => {
    const first = tokens.generateToken();
    const firstId = await q.createSession({
      userId,
      refreshTokenHash: tokens.hashToken(first),
      deviceFingerprint: tokens.deviceFingerprint('vitest', 'en'),
      expiresAt: new Date(Date.now() + 3600_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    });

    // Rotate: revoke the old, issue the new.
    await sql`
      update public.sessions set revoked_at = now(), revoked_reason = 'rotated'
      where id = ${firstId}
    `;
    const second = tokens.generateToken();
    await q.createSession({
      userId,
      refreshTokenHash: tokens.hashToken(second),
      deviceFingerprint: tokens.deviceFingerprint('vitest', 'en'),
      expiresAt: new Date(Date.now() + 3600_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
      rotatedFrom: firstId,
    });

    // Replay the OLD token. That is theft.
    const replay = await q.detectReuse(tokens.hashToken(first));
    expect(replay.outcome).toBe('reuse_detected');

    const [live] = await sql`
      select count(*)::int as n from public.sessions
      where user_id = ${userId} and revoked_at is null
    `;
    expect(live.n).toBe(0);

    const [event] = await sql`
      select count(*)::int as n from public.security_events
      where user_id = ${userId} and event_type = 'refresh_token_reuse' and severity = 'critical'
    `;
    expect(event.n).toBeGreaterThanOrEqual(1);
  });
});

if (!CONFIGURED) {
  describe('Gate 4', () => {
    it.skip('skipped — .env.local needs DATABASE_URL and TOKEN_PEPPER', () => {});
  });
}
