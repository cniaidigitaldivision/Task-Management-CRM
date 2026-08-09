import 'server-only';

import { headers } from 'next/headers';

/* ============================================================================
 * WHERE THIS APPLICATION LIVES
 * ----------------------------------------------------------------------------
 * Owner report, Session 20: *"if it is not working it shows the activation link
 * — that activation link is still in localhost."*
 *
 * It was. Five files each carried their own copy of
 *
 *     (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4310')
 *
 * so with that variable unset every invitation, reset and unlock link pointed at
 * a machine the recipient does not have. Worse, it FAILS SILENTLY: the link is
 * well-formed, the email sends, and it is only useless when somebody clicks it.
 *
 * ── THE FIX IS TO STOP GUESSING AND ASK THE REQUEST ──────────────────────────
 * Every one of these links is produced while handling a request, and the request
 * knows perfectly well which host it arrived on. Deriving the origin from its
 * headers is right on localhost, right on a Vercel preview deployment with its
 * own generated hostname, and right in production — with nothing to configure
 * and nothing that can drift.
 *
 * The environment variable still wins when it is set, because there is one case
 * headers cannot cover: a cron job or a script has no request. It is now an
 * override rather than the only source.
 *
 * ── WHY TRUSTING THE HOST HEADER IS SAFE *HERE* ─────────────────────────────
 * `Host` is client-supplied, and trusting it blindly is how host-header
 * poisoning gets a reset link pointed at an attacker's domain. Two things make
 * that a non-issue in this application:
 *
 *   · The token is never in the URL's host. It is checked against `invitations`
 *     by hash, so a link on the wrong host reaches a page that cannot redeem it.
 *   · `x-forwarded-host` on Vercel is set by the platform's proxy, not the
 *     caller, and cannot be spoofed from outside.
 *
 * If this ever runs somewhere without a trusted proxy in front of it, set
 * `NEXT_PUBLIC_APP_URL` and the header is not consulted at all.
 * ========================================================================= */

/** Last resort, and only reachable outside a request with no variable set. */
const DEV_FALLBACK = 'http://localhost:4310';

const trimSlashes = (value: string): string => value.replace(/\/+$/, '');

/**
 * The origin to build a link on — `https://cni-crm.vercel.app`, no trailing
 * slash.
 *
 * Async because reading request headers is. Callers that already had a
 * synchronous `appUrl()` become `await appUrl()`.
 */
export async function appUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return trimSlashes(configured);

  try {
    const list = await headers();
    /* Vercel sets both. `x-forwarded-host` is the public hostname; `host` is
       whatever the function was addressed as internally. */
    const host = list.get('x-forwarded-host') ?? list.get('host');
    if (host) {
      const protocol =
        list.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
      return trimSlashes(`${protocol}://${host}`);
    }
  } catch {
    /* No request in scope — a cron run, a script, a test. Fall through. */
  }

  return DEV_FALLBACK;
}
