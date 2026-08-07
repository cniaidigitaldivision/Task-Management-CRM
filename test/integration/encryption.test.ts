import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isLegacyPlaintext, open, seal, selfTest } from '@/lib/auth/secret-box';
import { generateTotpSecret, generateTotp, verifyTotp } from '@/lib/auth/totp';
import { sql } from '@/lib/db/client';
import { getVerifiedFactors, resetMfaFor } from '@/lib/db/queries/auth';

/* ============================================================================
 * GATE — AUTHENTICATOR SECRETS ARE ENCRYPTED AT REST
 * ----------------------------------------------------------------------------
 * `mfa_factors.secret_encrypted` stored plaintext from the day the column was
 * created, despite the name. This proves it no longer does — and, more usefully,
 * proves the two things that could have gone wrong while fixing it:
 *
 *   1. a secret that seals but does not open, which locks somebody out of their
 *      own account permanently, recovery codes only;
 *   2. legacy plaintext rows being rejected instead of upgraded, which locks out
 *      everybody who enrolled before the change — including the owner.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

let adminId = '';
let memberId = '';

beforeAll(async () => {
  const rows = await sql`
    select id, role from public.users
     where email like ${'%@cni-demo.com'} and is_active
  `;
  for (const row of rows) {
    if (row.role === 'admin') adminId = row.id as string;
    if (row.role === 'member' && !memberId) memberId = row.id as string;
  }
  if (!adminId) throw new Error('Run `npm run seed:demo` first.');
});

afterAll(async () => {
  await sql.end({ timeout: 5 }).catch(() => {});
});

describe('the cipher itself', () => {
  it('round-trips', () => {
    expect(selfTest()).toBe(true);
  });

  it('produces different ciphertext each time for the same input', () => {
    const secret = generateTotpSecret();
    /* A fresh IV per seal. Identical ciphertext for identical input would leak
       that two accounts share a secret, and would make the store vulnerable to
       simple equality analysis. */
    expect(seal(secret)).not.toBe(seal(secret));
    expect(open(seal(secret))).toBe(secret);
  });

  it('refuses a tampered ciphertext instead of returning rubbish', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    /* Flip a character in the ciphertext. Under an unauthenticated mode this
       would decrypt to *something* and the failure would surface later as a
       mysteriously wrong code. GCM's tag makes it a clean, immediate error. */
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA'),
    ].join('.');

    expect(() => open(tampered)).toThrow(/could not be decrypted/i);
  });

  it('passes a legacy plaintext value straight through', () => {
    const legacy = 'JBSWY3DPEHPK3PXP';
    /* This is what stops encryption locking out everybody who enrolled before
       it — including the owner, whose account nobody else can reset. */
    expect(isLegacyPlaintext(legacy)).toBe(true);
    expect(open(legacy)).toBe(legacy);
    expect(isLegacyPlaintext(seal(legacy))).toBe(false);
  });
});

describe('what is actually stored in the database', () => {
  it('holds no plaintext TOTP secret', async () => {
    const rows = await sql`
      select secret_encrypted from public.mfa_factors
       where type = 'totp' and secret_encrypted is not null
    `;
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const stored = row.secret_encrypted as string;
      expect(stored.startsWith('v1.')).toBe(true);
      /* A base32 TOTP seed is 32 characters of A–Z2–7. If the stored value
         still looks like one, it is one. */
      expect(/^[A-Z2-7]{16,}$/.test(stored)).toBe(false);
    }
  });

  it('a stored secret still generates codes the verifier accepts', async () => {
    const factors = await getVerifiedFactors(adminId);
    const totp = factors.find((f) => f.type === 'totp' && f.secretEncrypted);
    expect(totp, 'the seeded Admin should have an enrolled authenticator').toBeTruthy();

    /* The assertion that matters. Encryption is worthless if it breaks sign-in,
       and the only proof is generating a code from the decrypted seed and having
       the real verifier accept it. */
    const now = Date.now();
    const code = generateTotp(totp!.secretEncrypted as string, now);
    expect(verifyTotp(totp!.secretEncrypted as string, code, now)).toBe(true);
  });
});

describe('FR-146 — resetting somebody’s authenticator', () => {
  it('an Admin cannot reset the Super Admin’s', async () => {
    const owner = await sql`select id from public.users where role = 'super_admin' limit 1`;
    if (!owner[0]) return;

    /* The point of the role. An Admin who could strip the owner's second factor
       could then force a password reset and take the account. */
    await expect(resetMfaFor(adminId, owner[0].id as string)).rejects.toThrow(/Super Admin/i);
  });

  it('a Member cannot reset anybody’s', async () => {
    await expect(resetMfaFor(memberId, adminId)).rejects.toThrow(/Admin/i);
  });

  it('an Admin CAN reset a Member’s — downward is the permitted direction', async () => {
    /* The positive case, and it has to be asserted properly. The first version
       of this test was `.resolves.toBeDefined().catch(() => undefined)`, which
       passes whatever happens — a test that cannot fail is worse than no test,
       because it reads as coverage.
       Returns the number of factors removed; a Member with none returns 0, and
       reaching that number at all is the proof the permission check passed. */
    await expect(resetMfaFor(adminId, memberId)).resolves.toBeTypeOf('number');
  });
});
