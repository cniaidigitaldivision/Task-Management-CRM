import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ============================================================================
 * CLEARING THE SESSION COOKIE MUST NOT BE ABLE TO BREAK A PAGE
 * ----------------------------------------------------------------------------
 * A regression test for a real fault, found 2026-08-12 by `npm run smoke`
 * reporting **HTTP 500 on eleven routes**.
 *
 * `requireUser()` clears a dead cookie before redirecting to the sign-in page.
 * But Next.js allows a cookie write only in a Server Action or a Route Handler,
 * so during a **page render** `cookies().delete()` throws:
 *
 *     Error: Cookies can only be modified in a Server Action or Route Handler
 *
 * Unhandled, that replaced the redirect with a 500 for anybody whose account was
 * in a non-active state — and CHANGE-PLAN 4.1 makes that state ordinary, because
 * forcing a password reset puts somebody in it deliberately. Somebody told to
 * reset their password would have met a server error on every page instead of
 * being told what to do.
 *
 * So the contract is: **clearing the cookie is best-effort, and its failure is
 * never allowed to propagate.** That is what these two tests hold in place. The
 * redirect is the part callers depend on; the cookie is housekeeping.
 * ========================================================================= */

const deleteMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: deleteMock,
  }),
}));

/* Not exercised here, but importing session.ts pulls it in. */
vi.mock('@/lib/db/queries/auth', () => ({ createSession: async () => 'unused' }));

describe('clearSessionCookie', () => {
  beforeEach(() => {
    deleteMock.mockReset();
    vi.resetModules();
  });

  it('reports true when the cookie really was removed', async () => {
    const { clearSessionCookie } = await import('../session');
    await expect(clearSessionCookie()).resolves.toBe(true);
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it('reports false instead of throwing when the context forbids the write', async () => {
    /* Exactly what Next.js raises during a Server Component render. If this test
       fails, every protected page 500s for a stale session instead of
       redirecting — the original bug, restored. */
    deleteMock.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });

    const { clearSessionCookie } = await import('../session');
    await expect(clearSessionCookie()).resolves.toBe(false);
  });
});
