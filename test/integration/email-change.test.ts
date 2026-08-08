import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withUser } from '@/lib/db/client';
import { changeOwnEmail } from '@/lib/db/queries/people';
import { validateEmailAddress } from '@/lib/domain/email-address';

/* ============================================================================
 * GATE — CHANGING YOUR SIGN-IN ADDRESS, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * REDESIGN-PLAN §2. Every assertion here is one the unit suite cannot make,
 * because every one of them is a claim about Postgres rather than about our own
 * code:
 *
 *   · the CTE in `changeOwnEmail` really does return the PRE-update address
 *     (this is the whole reason the alert can name what it replaced, and it is
 *     the one piece of the implementation that rests on snapshot semantics)
 *   · a collision surfaces as SQLSTATE 23505 and not as a silent no-op
 *   · `users_email_lowercase` and `users_email_shaped` reject exactly what
 *     `validateEmailAddress` promised to catch first
 *   · RLS confines the write to the actor's own row
 *   · migration 005's immutability trigger does NOT block the Super Admin
 *     changing their own address — the premise the whole phase rests on
 *
 * ── THE SUPER ADMIN TEST RUNS INSIDE A TRANSACTION THAT IS ROLLED BACK ───────
 * There is exactly one Super Admin row and it is the real one — BR-028 means a
 * disposable stand-in cannot be created. So that case is proven the same way
 * Step 5.1 was: do it for real, assert, then abort. The final assertion in that
 * block re-reads the address on a FRESH connection, so a rollback that did not
 * happen fails the suite loudly instead of quietly leaving somebody unable to
 * sign in.
 *
 * Requires the demo seed: npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';
const STAMP = 'email-change-test';

let memberId = '';
let otherId = '';
let memberEmail = '';
let otherEmail = '';

/** Thrown to abort a transaction on purpose. Nothing else may look like it. */
class Rollback extends Error {
  constructor() {
    super('deliberate rollback');
  }
}

/**
 * Run as `userId` with the same identity `withUser` sets, then ROLL BACK.
 *
 * Deliberately not built on `withUser` — that helper commits, which is the one
 * behaviour this needs to prevent.
 */
async function rolledBack<T>(userId: string, fn: (tx: never) => Promise<T>): Promise<T> {
  let captured: T | undefined;
  let got = false;

  try {
    await sql.begin(async (tx) => {
      await tx`
        select set_config('role', 'cni_app', true),
               set_config('app.user_id', ${userId}, true)
      `;
      captured = await fn(tx as never);
      got = true;
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  expect(got, 'the body should have run to completion before the rollback').toBe(true);
  return captured as T;
}

beforeAll(async () => {
  const rows = await sql`
    select id, email from public.users
     where email like ${'%@' + DOMAIN} and is_active and role = 'member'
     order by email
     limit 2
  `;
  if (rows.length < 2) {
    throw new Error('Run `npm run seed:demo` first — this needs two seeded members.');
  }
  memberId = rows[0].id as string;
  memberEmail = rows[0].email as string;
  otherId = rows[1].id as string;
  otherEmail = rows[1].email as string;
});

afterAll(async () => {
  /* Put the seeded member back, whatever happened above. */
  if (memberId && memberEmail) {
    await sql`update public.users set email = ${memberEmail} where id = ${memberId}`.catch(() => {});
  }
  await sql.end({ timeout: 5 }).catch(() => {});
});

function freshEmail(label: string): string {
  return `${STAMP}-${label}-${Date.now()}@${STAMP}.invalid`;
}

describe('changeOwnEmail — the happy path, and what it returns', () => {
  it('changes the address and hands back the one it replaced', async () => {
    const before = memberEmail;
    const next = freshEmail('happy');

    const result = await changeOwnEmail(memberId, next);

    /* THE assertion of this file. If the CTE were evaluated after the update,
       this would come back as `next` and the alert would name the new address
       as the one it replaced — telling somebody their address changed from the
       address it changed to. */
    expect(result).not.toBeNull();
    expect(result?.previousEmail).toBe(before);

    const [row] = await sql`select email from public.users where id = ${memberId}`;
    expect(row.email).toBe(next);

    /* Put it back for the tests below. */
    await sql`update public.users set email = ${before} where id = ${memberId}`;
  });

  it('is idempotent about case — the value stored is exactly what was passed', async () => {
    const next = freshEmail('case');
    const checked = validateEmailAddress(next.toUpperCase());
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    await changeOwnEmail(memberId, checked.email);
    const [row] = await sql`select email from public.users where id = ${memberId}`;
    expect(row.email).toBe(next.toLowerCase());

    await sql`update public.users set email = ${memberEmail} where id = ${memberId}`;
  });
});

describe('the database is what makes an address unique, not a lookup', () => {
  it('taking an address somebody else has raises 23505', async () => {
    let code: string | undefined;
    try {
      await changeOwnEmail(memberId, otherEmail);
    } catch (error) {
      code = (error as { code?: string }).code;
    }

    /* The action maps exactly this code to "another account already uses that
       address". Any other code and that branch is unreachable. */
    expect(code).toBe('23505');

    const [row] = await sql`select email from public.users where id = ${memberId}`;
    expect(row.email, 'a refused change must leave the address alone').toBe(memberEmail);
  });

  it('a Member cannot see whether an address is taken — which is why 23505 is the only signal', async () => {
    /* ADR-003, enforced by `users_select`. This is the reason changeOwnEmail
       does not pre-check: a select would answer "free" for every address in the
       system except their own. */
    const rows = await withUser(memberId, (tx) => tx`
      select id from public.users where email = ${otherEmail}
    `);
    expect(rows.length).toBe(0);
  });
});

describe('the constraints validateEmailAddress exists to keep away from people', () => {
  it('users_email_lowercase refuses a capitalised address', async () => {
    let code: string | undefined;
    try {
      await changeOwnEmail(memberId, 'Mixed.Case@example.com');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe('23514');
  });

  it('users_email_shaped refuses an address with no @', async () => {
    let code: string | undefined;
    try {
      await changeOwnEmail(memberId, 'not-an-address');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe('23514');
  });

  it('validateEmailAddress catches both first, so neither error can reach a person', () => {
    expect(validateEmailAddress('Mixed.Case@example.com')).toEqual({
      ok: true,
      email: 'mixed.case@example.com',
    });
    expect(validateEmailAddress('not-an-address').ok).toBe(false);
  });

  it('the address left in the row is still the seeded one', async () => {
    const [row] = await sql`select email from public.users where id = ${memberId}`;
    expect(row.email).toBe(memberEmail);
  });
});

describe('RLS confines the write to your own row', () => {
  it("a Member's update cannot reach anybody else's address", async () => {
    /* changeOwnEmail keys on the actor id and has no other id to tamper with.
       This goes lower, straight at the policy, with a hand-written statement
       that names somebody else — which is what an injected id would become. */
    const rows = await withUser(memberId, (tx) => tx`
      update public.users set email = ${freshEmail('nope')}
       where id = ${otherId}
      returning id
    `);

    expect(rows.length, 'users_update should match no row').toBe(0);

    const [row] = await sql`select email from public.users where id = ${otherId}`;
    expect(row.email).toBe(otherEmail);
  });
});

/* ==========================================================================
 * THE PREMISE OF THE WHOLE PHASE
 * ========================================================================== */

describe('migration 005 does not block the Super Admin changing their own address', () => {
  it('permits it — and the rollback leaves the real address untouched', async () => {
    const [sa] = await sql`select id, email from public.users where role = 'super_admin'`;
    if (!sa) {
      /* A database where setup has not been run. Nothing to prove, and
         inventing a Super Admin is impossible by BR-028. */
      expect.unreachable('no Super Admin row — run the /setup route first');
      return;
    }

    const superId = sa.id as string;
    const realEmail = sa.email as string;
    const probe = freshEmail('super-admin');

    const result = await rolledBack(superId, async (tx) => {
      const rows = await (tx as unknown as typeof sql)`
        with previous as (
          select id, email from public.users where id = ${superId}
        )
        update public.users u
           set email = ${probe}
          from previous p
         where u.id = p.id
        returning p.email as previous_email, u.email as new_email
      `;
      return rows[0];
    });

    /* The trigger blocks four things on this row and email is not among them
       (BR-027, FR-140, FR-156). If that ever changes, this fails and the whole
       feature has to be reconsidered rather than quietly half-working. */
    expect(result, 'the Super Admin row should have accepted the update').toBeTruthy();
    expect(result.previous_email).toBe(realEmail);
    expect(result.new_email).toBe(probe);

    /* The safety net. A fresh statement on a fresh transaction: if the rollback
       did not take, the Super Admin cannot sign in and this must scream. */
    const [after] = await sql`select email from public.users where role = 'super_admin'`;
    expect(after.email, 'THE ROLLBACK DID NOT TAKE — fix this now').toBe(realEmail);
  });

  it('still refuses the things it is supposed to refuse', async () => {
    const [sa] = await sql`select id from public.users where role = 'super_admin'`;
    if (!sa) return;
    const superId = sa.id as string;

    /* Self-deactivation, FR-156. Proven alongside the permitted change so this
       file shows the trigger is intact rather than merely absent. */
    let refused = false;
    try {
      await rolledBack(superId, async (tx) => {
        await (tx as unknown as typeof sql)`
          update public.users set is_active = false where id = ${superId}
        `;
      });
    } catch {
      refused = true;
    }
    expect(refused, 'FR-156: the Super Admin cannot deactivate themselves').toBe(true);
  });
});
