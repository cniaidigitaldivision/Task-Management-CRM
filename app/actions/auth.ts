'use server';

import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/current-user';
import { clearSessionCookie } from '@/lib/auth/session';
import { withAppRole } from '@/lib/db/client';

/* ============================================================================
 * SIGN OUT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-16: *"there is no option to do that"*. There was not. The
 * machinery all existed — `clearSessionCookie()` even carries a comment naming
 * "sign-out, which is a Server Action" as its caller — and nothing ever called
 * it. A signed-in person could not end their own session.
 *
 * That is a security gap rather than a missing button. Sessions last 7 days for
 * a Member (doc 16 §4), so on a shared or borrowed machine the only way out was
 * to wait a week or ask a Super Admin to revoke it from the Security screen.
 *
 * ── THE SERVER ROW IS REVOKED FIRST, THE COOKIE SECOND ───────────────────────
 * Deleting only the cookie would leave a LIVE session row: anybody holding a
 * copy of that token — the thing being signed out to protect against — could
 * still use it. Revoking the row is what actually ends the session;
 * `session_resolve` then answers `revoked` for every future request.
 *
 * The cookie is cleared as a courtesy so the browser stops presenting a token
 * that will never work again, and its failure is deliberately not fatal.
 *
 * ── withAppRole, NOT withUser ────────────────────────────────────────────────
 * `app.session_revoke` is one of the pre-auth definer functions (migration 014),
 * and this runs at the moment identity is being torn down. Asking RLS to
 * authorise the destruction of the very session that authorises it is the wrong
 * shape; the function scopes the write to one session id.
 * ========================================================================= */

export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();

  /* Already signed out — no row to revoke. Falls through to the redirect rather
     than erroring, so a double-click or a stale tab lands on /login instead of a
     crash. */
  if (user) {
    try {
      await withAppRole((tx) => tx`
        select app.session_revoke(${user.sessionId}, 'signed_out')
      `);
    } catch {
      /* The row could not be revoked. The cookie still goes and the redirect
         still happens: leaving somebody LOOKING signed in because the database
         hiccuped is the worse of the two failures. The session keeps its own
         expiry either way. */
    }
  }

  await clearSessionCookie();

  /* `redirect` throws, so nothing after it runs. Outside the try/catch above on
     purpose — catching it would swallow the navigation. */
  redirect('/login?reason=signed_out');
}
