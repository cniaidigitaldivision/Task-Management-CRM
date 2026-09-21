import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';

import { runAgentOnMessage } from '@/lib/crm/agent-runner';
import { fetchMedia, mediaReader } from '@/lib/crm/whatsapp';
import { uploadObject } from '@/lib/storage/bucket';

/* ⚠️ `withAppRole`, NOT `withUser` — there is no user here. This route is
   authenticated by Meta's signature, not by a login, so it writes through the
   SECURITY DEFINER functions in migration 138 exactly as the importer does. */
import { withAppRole } from '@/lib/db/client';

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
/* ⚠️ TIME FOR THE AI AGENT, which runs in `after()` once Meta has its 200: a few
   seconds for the rest of a burst, a model call, then the sends. Meta's own
   acknowledgement is not held up by any of it. */
export const maxDuration = 60;

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
    const payload = JSON.parse(rawBody) as WhatsAppPayload;
    await store(payload);
  } catch (error) {
    /* ⚠️ LOGGED AND SWALLOWED, DELIBERATELY. A message we failed to store is
       lost, which is bad — but answering anything other than 200 makes Meta
       redeliver a payload that will fail identically, and enough of those
       switch the subscription off, which loses every message after it too. */
    console.error('[whatsapp-webhook] could not store event:', error);
  }

  return text('EVENT_RECEIVED', 200);
}

/* ==========================================================================
 * WHAT META SENDS, AND WHAT WE KEEP OF IT
 * ========================================================================== */

interface WhatsAppPayload {
  readonly entry?: ReadonlyArray<{
    readonly changes?: ReadonlyArray<{
      readonly field?: string;
      readonly value?: {
        readonly messages?: ReadonlyArray<Record<string, unknown>>;
        readonly statuses?: ReadonlyArray<Record<string, unknown>>;
      };
    }>;
  }>;
}

/**
 * Walk the payload and record what it holds.
 *
 * ⚠️ META NESTS EVERYTHING THREE DEEP AND BATCHES IT. One webhook can carry
 * several entries, each with several changes, each with several messages. Code
 * that read `entry[0].changes[0].value.messages[0]` works in every test and
 * silently drops the second message of a busy minute.
 */
async function store(payload: WhatsAppPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const message of value.messages ?? []) await storeMessage(message);
      for (const status of value.statuses ?? []) await storeStatus(status);
    }
  }
}

/** The five media shapes, flattened to the four columns the table keeps. */
function readMedia(message: Record<string, unknown>, kind: string) {
  const media = message[kind] as Record<string, unknown> | undefined;
  if (!media) return { id: null, mime: null, filename: null, caption: null };
  return {
    id: (media.id as string | undefined) ?? null,
    mime: (media.mime_type as string | undefined) ?? null,
    filename: (media.filename as string | undefined) ?? null,
    caption: (media.caption as string | undefined) ?? null,
  };
}

async function storeMessage(message: Record<string, unknown>): Promise<void> {
  const wamid = message.id as string | undefined;
  const from = message.from as string | undefined;
  let kind = (message.type as string | undefined) ?? 'unknown';
  if (!wamid || !from) return;

  /* ⚠️ META SENDS THE NUMBER WITHOUT A PLUS — `923121531511`. Every lead is
     stored in E.164 WITH one, so matching the raw value finds nothing at all,
     on every message, for ever. The kind of bug that looks like "WhatsApp is
     not working" rather than like a missing character. */
  const e164 = from.startsWith('+') ? from : `+${from}`;

  /* ⚠️ A REACTION IS NOT A MESSAGE (184). It lands on the message it reacts to;
     storing it as a row would put an empty bubble in the thread every time a
     client tapped a heart. */
  if (kind === 'reaction') {
    const reaction = message.reaction as Record<string, unknown> | undefined;
    const at = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();
    await withAppRole((tx) => tx`
      select app.crm_record_inbound_reaction(
        ${e164}, ${(reaction?.message_id as string | undefined) ?? null},
        ${(reaction?.emoji as string | undefined) ?? ''}, ${at}::timestamptz)
    `);
    return;
  }

  /* The message the client swiped to reply to — drawn as a quote above theirs. */
  const replyTo = ((message.context as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;

  let body: string | null = null;
  let media = { id: null as string | null, mime: null as string | null, filename: null as string | null };

  if (kind === 'text') {
    body = ((message.text as Record<string, unknown> | undefined)?.body as string | undefined) ?? null;
  } else if (kind === 'button') {
    /* ⚠️ A TAP IS TEXT. Meta calls a template's quick reply `button`, which is
       not a value `crm_message_kind` has — so it was being stored as `unknown`,
       the kind reserved for things we could not read, next to a body we read
       perfectly well. It is the client's own words; it is stored as text. */
    body = ((message.button as Record<string, unknown> | undefined)?.text as string | undefined) ?? null;
    kind = 'text';
  } else {
    const found = readMedia(message, kind);
    /* A caption IS the message text when there is one — an image with
       "is this the 5 marla one?" under it reads as blank without this. */
    body = found.caption;
    media = { id: found.id, mime: found.mime, filename: found.filename };
  }

  /* Meta sends seconds; Postgres wants an instant. */
  const at = message.timestamp
    ? new Date(Number(message.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const voice = kind === 'audio'
    && (message.audio as Record<string, unknown> | undefined)?.voice === true;

  const stored = await withAppRole((tx) => tx`
    select app.crm_record_inbound_message(
      ${e164}, ${wamid}, ${kind}, ${body},
      ${media.id}, ${media.mime}, ${media.filename}, ${at}::timestamptz,
      ${replyTo}, ${voice}
    ) as id
  `);

  /* ⚠️ THE ATTACHMENT IS COPIED AFTER META HAS ITS 200. Webhook media ids expire
     after 7 days (Meta's reference, 2026) — the photo a client sent on Monday was
     gone the next Tuesday. Downloading inside the request would hold up the
     acknowledgement and invite Meta's retries; `after` runs once the answer is
     sent. If it fails, the media route copies it the first time somebody looks. */
  const messageId = (stored as Array<Record<string, unknown>>)[0]?.id as string | undefined;
  if (messageId && media.id) {
    const mediaId = media.id;
    const filename = media.filename;
    after(async () => {
      try {
        const reader = mediaReader();
        const file = reader ? await fetchMedia(reader, mediaId) : null;
        if (!file) return;
        const lead = await withAppRole((tx) => tx`
          select lead_id from public.crm_lead_messages where id = ${messageId}::uuid
        `);
        const leadId = (lead as Array<Record<string, unknown>>)[0]?.lead_id as string | undefined;
        if (!leadId) return;
        const ext = (file.mime.split('/')[1] ?? 'bin').split(';')[0].replace(/[^a-z0-9]/gi, '');
        const safe = (filename ?? `${kind}.${ext}`).replace(/[^\w.\-() ]+/g, '_').slice(-80);
        const path = `crm-whatsapp/${leadId}/${randomUUID()}/${safe}`;
        const put = await uploadObject({ path, body: new Uint8Array(file.data), contentType: file.mime });
        if (!put.ok) return;
        await withAppRole((tx) => tx`
          select app.crm_message_store_media(${messageId}::uuid, ${path}, ${file.data.length})
        `);
      } catch (error) {
        console.error('[whatsapp-webhook] could not keep an attachment:', error);
      }
    });
  }

  /* ⚠️ A REPLY CAN BE A DECISION, NOT JUST A MESSAGE. A quick reply on the
     appointment template arrives here like any other inbound, and until now
     nothing acted on it. Owner, 2026-09-19: *"When a client clicks Confirmed,
     it should automatically be confirmed in my system and a reminder message
     should be sent."* 222 confirms the appointment and queues a short warm
     acknowledgement; a request for a different time goes to the salesperson,
     because only they know what else is in the diary.

     ⚠️ NOT RESTRICTED TO TAPS. A client who types "confirmed" rather than
     tapping means the same thing, and 222 ignores anything it does not
     recognise — so this runs on every inbound and stays quiet on almost all
     of them.

     ⚠️ AND IT NEVER FAILS THE WEBHOOK. Meta retries a non-200 for hours; the
     message is already safely stored, so a confirmation that did not land is
     worth a line in the log, not a redelivery of everything behind it. */
  let answered: string | null = null;
  if (messageId && body) {
    try {
      const acted = (await withAppRole((tx) => tx`select app.crm_act_on_reply(${messageId}::uuid) as outcome`)) as unknown as Array<{ outcome: string | null }>;
      answered = acted[0]?.outcome ?? null;
    } catch (error) {
      console.error('[whatsapp-webhook] could not act on a reply:', error);
    }
  }

  /* ── THE AI AGENT, for a lead whose reply mode is "AI agent" ─────────────
     Owner, 2026-09-21: *"make them work… each and every thing should be fully
     functional with a proper sense of the working of an AI agent."*

     ⚠️ AFTER META HAS ITS 200, like the attachment copy above. The agent waits a
     few seconds for the rest of a burst, reads, thinks and sends — none of which
     may hold up the acknowledgement Meta retries on.

     ⚠️ NOT WHEN THE MESSAGE WAS ALREADY ANSWERED. A Confirm tap on an
     appointment is acknowledged by 222; the agent replying to it as well would
     be the client hearing two voices.

     ⚠️ AND IT RUNS FOR A VOICE NOTE OR A PHOTO TOO, with no text — that is
     exactly when it must hand over rather than stay silent. The runner itself
     decides whether this lead is on "AI agent"; for every other lead it returns
     at once and writes nothing. */
  if (messageId && !answered) {
    const id = messageId;
    after(async () => {
      try {
        await runAgentOnMessage(id);
      } catch (error) {
        console.error('[whatsapp-webhook] the AI agent could not run:', error);
      }
    });
  }

  /* ⚠️ NULL IS ORDINARY, NOT A FAILURE. Somebody messaging the business
     number who is not a lead — a supplier, a wrong number, a colleague — gets
     no row and no error. Logged without the message body, because that body is
     a stranger's words and a log is not the place for them. */
  if (!(stored as Array<Record<string, unknown>>)[0]?.id) {
    console.info('[whatsapp-webhook] message from a number matching no lead');
  }
}

async function storeStatus(status: Record<string, unknown>): Promise<void> {
  const wamid = status.id as string | undefined;
  const state = status.status as string | undefined;
  if (!wamid || !state) return;

  const errors = status.errors as ReadonlyArray<Record<string, unknown>> | undefined;
  const detail = errors?.[0]
    ? String(errors[0].title ?? errors[0].message ?? '').slice(0, 300)
    : null;

  const at = status.timestamp
    ? new Date(Number(status.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  await withAppRole((tx) => tx`
    select app.crm_record_message_status(${wamid}, ${state}, ${detail}, ${at}::timestamptz)
  `);
}
