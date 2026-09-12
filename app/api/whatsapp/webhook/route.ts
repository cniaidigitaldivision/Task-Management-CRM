import { createHmac, timingSafeEqual } from 'node:crypto';

/* ============================================================================
 * WHERE META POSTS WHATSAPP EVENTS — owner request 2026-09-10
 * ----------------------------------------------------------------------------
 * The Callback URL for app 1109373768423508 (`META_APP_ID`), WhatsApp Business
 * product. The URL to paste into Meta's "Configure Webhooks" box:
 *
 *   https://taskly.aidigitaldivision.com/api/whatsapp/webhook
 *
 * ── ⚠️ WHY THIS COULD NOT BE ONE OF THE CALLBACK URLS WE ALREADY HAVE ───────
 * `/api/drive/callback` is a Google OAuth *redirect* — it calls
 * `requireRole('admin')` on the first line, so Meta's unauthenticated
 * verification GET would be refused before it read a single parameter.
 * `/api/crm/lead-sync` and `/api/meta-sync` demand `CRON_SECRET` as a bearer
 * token, which Meta has no field to send. And `/api/attendance/device` speaks
 * Hikvision. None of them can perform the handshake below, so a webhook needs a
 * route of its own — one per product, which is also how Meta stores them.
 *
 * ── THE HANDSHAKE (GET), AND THE ONE DETAIL THAT FAILS SILENTLY ────────────
 * On "Verify and save" Meta calls GET once with `hub.mode=subscribe`,
 * `hub.verify_token` and `hub.challenge`. It expects the challenge echoed back
 * as the WHOLE body, 200, plain text.
 *
 *   ⚠️ NOT `Response.json(challenge)`. That sends `"1158201444"` — with the
 *      quotes — and Meta compares the body byte for byte, so the quotes make it
 *      a mismatch. The dashboard then says only "The callback URL or verify
 *      token couldn't be validated", which points at the token and not at the
 *      two characters actually responsible.
 *
 * ── THE EVENTS (POST) ───────────────────────────────────────────────────────
 * Signed with `X-Hub-Signature-256`: HMAC-SHA256 of the RAW body under the app
 * secret. The raw body matters — re-serialising the parsed JSON reorders keys
 * and rewrites number formatting, and the digest of that never matches.
 *
 * ⚠️ ACKNOWLEDGE FAST. Meta expects a 2xx quickly and retries on anything else
 * with an escalating back-off; a route that keeps failing gets its subscription
 * switched off. So this answers 200 as soon as the signature is proven, and any
 * work done with the payload must not hold that answer up.
 *
 * ── ⚠️ DISABLED, NEVER OPEN, WHEN UNCONFIGURED ──────────────────────────────
 * Missing `META_APP_SECRET` or `WHATSAPP_VERIFY_TOKEN` means refuse — the same
 * rule as `CRON_SECRET` elsewhere in this folder. An unauthenticated webhook is
 * a stranger's write path into the CRM.
 * ========================================================================= */

export const dynamic = 'force-dynamic';
/* Node, not Edge: `node:crypto` for the HMAC. */
export const runtime = 'nodejs';

/** A real WhatsApp event is a few kilobytes. Past this it is not Meta. */
const MAX_BODY_BYTES = 1024 * 1024;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Constant-time comparison of the received signature against ours.
 *
 * ⚠️ Length-checked first: `timingSafeEqual` THROWS on a length mismatch, and a
 * throw here would become a 500, which Meta reads as "retry" rather than as the
 * refusal it is.
 */
function signatureMatches(header: string, secret: string, rawBody: string): boolean {
  if (!header.startsWith('sha256=')) return false;

  const provided = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Meta's verification, and the only reason this route answers GET at all.
 * Pressing "Verify and save" in the app dashboard lands here.
 */
export async function GET(request: Request): Promise<Response> {
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  if (!expectedToken) {
    /* Deliberately not 200: verifying against an absent token would register a
       webhook that nothing can prove came from us. */
    return text('WHATSAPP_VERIFY_TOKEN is not configured. The webhook is disabled.', 503);
  }

  const params = new URL(request.url).searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  /* No hub parameters at all — somebody opened the URL in a browser to see
     whether it is up. Say so, and give nothing away. */
  if (!mode && !token && !challenge) {
    return text('WhatsApp webhook endpoint. Ready.', 200);
  }

  if (mode !== 'subscribe' || !challenge) return text('Bad request.', 400);

  /* Constant-time, via the same HMAC trick: the tokens are of unequal length
     when they differ, and comparing lengths first would leak that. */
  const a = createHmac('sha256', expectedToken).update(token ?? '').digest();
  const b = createHmac('sha256', expectedToken).update(expectedToken).digest();
  if (!timingSafeEqual(a, b)) return text('Verification token mismatch.', 403);

  /* ⚠️ The challenge alone, unquoted. See the header comment. */
  return text(challenge, 200);
}

/** An event: an inbound message, or a delivery/read status for one we sent. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.META_APP_SECRET ?? '';
  if (!secret) {
    return text('META_APP_SECRET is not configured. The webhook is disabled.', 503);
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return text('Payload too large.', 413);

  /* RAW, and read exactly once — the signature is over these bytes. */
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return text('Payload too large.', 413);

  const header = request.headers.get('x-hub-signature-256') ?? '';
  if (!signatureMatches(header, secret, rawBody)) {
    /* Not from Meta, or from a different app's secret. Either way it is refused
       and nothing is parsed — a forged payload must not reach the CRM. */
    return text('Signature mismatch.', 403);
  }

  /* ⚠️ Past this line the request is PROVEN to be Meta's, so every remaining
     failure is our problem and must still answer 200. A 500 here would make
     Meta redeliver a payload that will fail identically next time, and enough
     of those disable the subscription. */
  try {
    const payload: unknown = JSON.parse(rawBody);
    /* Logged rather than stored: the tables that will hold a WhatsApp
       conversation do not exist yet (Phase 4 — docs/crm/04-PHASES.md), and a
       route that pretends to save what it drops is worse than one that says so.
       This is what makes a delivered test event visible in the Vercel log. */
    console.info('[whatsapp-webhook] event', JSON.stringify(payload));
  } catch {
    console.error('[whatsapp-webhook] body was signed but is not JSON');
  }

  return text('EVENT_RECEIVED', 200);
}
