import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/current-user';
import { storeConnection } from '@/lib/db/queries/drive';
import { exchangeCode, forgetAccessToken, oauthConfig } from '@/lib/drive/oauth';

/* ============================================================================
 * GOOGLE SENDS THE PERSON BACK HERE
 * ----------------------------------------------------------------------------
 * Trades the one-time code for a refresh token, seals it, stores it, and returns
 * to Documents with a message. Admin+ — the same floor as starting the flow, so
 * a redirect cannot be replayed by somebody who is merely signed in.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function back(request: Request, status: string): Response {
  return NextResponse.redirect(new URL(`/documents?drive=${status}`, request.url));
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireRole('admin');

  const url = new URL(request.url);
  const store = await cookies();

  /* Consumed either way — a state that has been used, or refused, must not be
     replayable. */
  const expected = store.get('drive_oauth_state')?.value ?? null;
  store.delete('drive_oauth_state');

  /* Google reports a refusal here rather than by not calling back at all, so
     "the person clicked Cancel" arrives as an error parameter. */
  const denied = url.searchParams.get('error');
  if (denied) return back(request, denied === 'access_denied' ? 'cancelled' : 'failed');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return back(request, 'failed');

  if (!expected || !sameState(expected, state)) {
    /* Either the cookie expired, or this callback did not originate from a flow
       started here. Both are refusals; neither is worth distinguishing to a
       caller who might be an attacker. */
    return back(request, 'state_mismatch');
  }

  const config = oauthConfig();
  if (!config) return back(request, 'not_configured');

  const exchanged = await exchangeCode({ config, origin: url.origin, code });
  if (!exchanged.ok) return back(request, 'failed');

  await storeConnection({
    accountEmail: exchanged.value.email,
    refreshToken: exchanged.value.refreshToken,
    actorId: user.id,
  });

  /* A previous connection's access token may still be cached in this process and
     would now belong to the wrong account. */
  forgetAccessToken();

  return back(request, 'connected');
}
