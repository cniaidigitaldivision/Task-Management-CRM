import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/current-user';
import { authorizeUrl, oauthConfig } from '@/lib/drive/oauth';

/* ============================================================================
 * START THE GOOGLE CONSENT FLOW
 * ----------------------------------------------------------------------------
 * Admin+ only. Connecting Drive binds the whole division's document flow to one
 * Google account, and `requireRole` here is the same floor the callback and the
 * disconnect action use.
 *
 * ── THE STATE PARAMETER IS CSRF PROTECTION, NOT DECORATION ───────────────────
 * Without it, anybody could send an Admin a link to Google's consent screen
 * carrying THEIR client parameters and have the callback attach an attacker's
 * Drive to this CRM. A random value is minted here, put in a short-lived
 * httpOnly cookie, and compared on the way back; a callback whose state does not
 * match the cookie is refused.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  await requireRole('admin');

  const config = oauthConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL('/documents?drive=not_configured', request.url),
    );
  }

  const state = randomBytes(24).toString('base64url');

  const store = await cookies();
  store.set('drive_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    /* Ten minutes. Long enough to read a consent screen, short enough that a
       forgotten tab cannot authorise anything an hour later. */
    maxAge: 600,
  });

  /* The origin comes from the REQUEST, so the redirect_uri matches whichever
     host this is — localhost or the deployment — without a second environment
     variable to keep in step. Both are registered in Google Cloud. */
  const origin = new URL(request.url).origin;

  return NextResponse.redirect(authorizeUrl({ config, origin, state }));
}
