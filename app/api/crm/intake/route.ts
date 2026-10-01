import { withAppRole } from '@/lib/db/client';
import { readIntakeFields } from '@/lib/domain/crm-intake-fields';
import { toE164 } from '@/lib/domain/phone';

/* ============================================================================
 * WHERE A WEBSITE FORM POSTS — owner request 2026-09-30
 * ----------------------------------------------------------------------------
 * *"Webform and inbound API: do it right now."*
 *
 * One endpoint, two callers:
 *
 *   A browser form   <form method="post" action="…/api/crm/intake?k=tkl_…">
 *   Another system   POST with `x-api-key` and a JSON body
 *
 * They are the same request in two encodings, and building two endpoints is how
 * the two come to disagree about what a lead is.
 *
 * ── ⚠️ THIS IS REACHABLE WITHOUT SIGNING IN, LIKE THE TERMINAL ────────────
 * `app/api/attendance/device/route.ts` is the only other one, and the reasoning
 * is the same: a website visitor has no account and cannot be given one. What
 * the key buys is exactly one thing — filing a lead on ONE project. It reads
 * nothing. Every use is counted on the key's own row and every lead records
 * which key filed it.
 *
 * ── ⚠️ THE KEY MAY TRAVEL IN THE QUERY STRING, AND THAT IS A CHOICE ───────
 * A header is better and `x-api-key` is accepted first. But a plain HTML form —
 * no JavaScript, which is what a small business's site actually has — cannot
 * set one. A header that cannot be set is not security, it is an endpoint that
 * never works. So `?k=` is accepted, with the consequences stated: the key is
 * per-project, write-only, rate-limited, revocable, and visible in the page
 * source anyway for any browser form.
 *
 * ── ⚠️ WHY A BAD PAYLOAD IS 400 BUT A BOT IS 200 ──────────────────────────
 * A developer wiring this up needs to be told what is wrong — no name, no way
 * to contact, key withdrawn — or they cannot fix it. A bot must be told
 * nothing: a honeypot hit and a blocked number both answer 200 `ignored`,
 * because telling a bot which trick was spotted is how it learns to stop using
 * it. `app.crm_intake_lead` makes that distinction, not this file.
 *
 * ── ⚠️ THE FUNCTION RETURNS REFUSALS, IT DOES NOT RAISE THEM ──────────────
 * So this maps `status` to a code rather than reading SQLSTATEs. The reason is
 * in 277's own header: a raise rolls the transaction back and takes the key's
 * `refused` counter with it, which drove the real endpoint to report "accepted
 * 3, refused 0" after three refusals.
 * ========================================================================= */

export const dynamic = 'force-dynamic';
/* Node, not Edge: `withAppRole` opens a Postgres connection. */
export const runtime = 'nodejs';

/** A real form post is well under this. Past it, it is not a form. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * ⚠️ CORS IS ANSWERED FROM THE KEY'S OWN ALLOW-LIST, and an empty list means
 * any origin. That is the honest default rather than a safe-looking one: a key
 * on a page nobody has told us about still has to work, or the first install
 * fails for a reason nobody on either side can see. Naming origins narrows it.
 *
 * ⚠️ AND A FORM POST NEEDS NO CORS AT ALL. A classic `<form>` navigates; the
 * browser never asks. These headers exist for `fetch` from a client's site.
 */
function corsHeaders(origin: string | null, allowed: readonly string[]): HeadersInit {
  const permitted = allowed.length === 0
    || (origin !== null && allowed.some((a) => a.toLowerCase() === origin.toLowerCase()));
  return {
    'Access-Control-Allow-Origin': permitted ? (origin ?? '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-api-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}

/**
 * ⚠️ A liveness check that needs no key and returns nothing about anybody.
 *
 * It exists to be opened in a browser by whoever is wiring up a form, so they
 * can answer the first question — can this site reach Taskly at all — without
 * having to get the key right at the same moment.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      service: 'crm-lead-intake',
      expects: 'POST',
      auth: 'x-api-key header, or ?k= in the query string',
      fields: {
        required: ['fullName', 'phone or email'],
        optional: ['city', 'enquiry', 'budget', 'source', 'sourceDetail', 'whatsappConsent'],
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function OPTIONS(request: Request): Promise<Response> {
  /* ⚠️ THE PREFLIGHT CANNOT LOOK THE KEY UP. A browser does not send
     `x-api-key` on an OPTIONS, and the query string may not carry it either —
     so this answers permissively and the POST itself enforces the allow-list.
     A preflight that refuses teaches the browser to cancel a request the real
     check might well have allowed. */
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), []),
  });
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const key = (request.headers.get('x-api-key') ?? url.searchParams.get('k') ?? '').trim();

  /* Where to send a browser after a plain form post. Only used for a form. */
  const redirectTo = url.searchParams.get('redirect');

  const answer = (status: number, body: Record<string, unknown>, allowed: readonly string[] = []) =>
    Response.json(body, { status, headers: corsHeaders(origin, allowed) });

  /* ⚠️ ONE PLACE DECIDES THE CODE. `bad_key` is 401 whether the key is unknown,
     withdrawn or absent — a caller does not need to be told which, and telling
     them turns this into an oracle for guessing keys. */
  const CODES: Readonly<Record<string, number>> = {
    bad_key: 401,
    rate_limited: 429,
    incomplete: 400,
  };

  if (!key) {
    return answer(401, { ok: false, error: 'No intake key.' });
  }

  /* ── read the body, in whichever encoding it came ────────────────────── */
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  let raw: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return answer(413, { ok: false, error: 'That request is too large to be a form.' });
    }
    if (type.includes('application/json')) {
      raw = JSON.parse(text || '{}') as Record<string, unknown>;
    } else {
      /* form-encoded, and also the fallback: a form posted with no
         content-type at all is still a form, and refusing it would fail the
         exact caller this endpoint exists for. */
      raw = Object.fromEntries(new URLSearchParams(text));
    }
  } catch {
    return answer(400, { ok: false, error: 'That body could not be read as JSON or as a form.' });
  }

  const fields = readIntakeFields(raw);

  /* ⚠️ NORMALISED HERE, BY THE PRODUCT'S OWN PARSER. `toE164` is the one phone
     parser in this codebase and it deliberately returns null rather than
     guessing — an Islamabad landline is ten digits and matches no mobile
     pattern. The raw value is sent regardless, so nothing is lost. */
  if (fields.phone && !fields.phoneE164) {
    const e164 = toE164(fields.phone);
    if (e164) fields.phoneE164 = e164;
  }

  try {
    const rows = await withAppRole((tx) => tx`
      select app.crm_intake_lead(${key}, ${tx.json(fields as never)}) as out
    `);
    const out = (rows as Array<Record<string, unknown>>)[0]?.out as
      { ok?: boolean; status?: string; id?: string; error?: string } | undefined;

    if (out?.ok === false) {
      const status = out.status ?? 'incomplete';
      return answer(CODES[status] ?? 400, {
        ok: false,
        status,
        error: out.error ?? 'That lead could not be filed.',
      });
    }

    /* ⚠️ A FORM GETS A REDIRECT, AN API GETS JSON. Answering a browser form
       with `{"ok":true}` leaves the visitor staring at raw JSON where a thank
       you page should be — which is what makes the difference between a working
       form and one somebody takes back off their site. */
    if (redirectTo && !type.includes('application/json')) {
      let destination: URL;
      try {
        destination = new URL(redirectTo);
      } catch {
        return answer(400, { ok: false, error: 'That redirect is not a URL.' });
      }
      /* ⚠️ http(s) ONLY. Without this, `?redirect=javascript:…` turns this
         endpoint into somebody else's cross-site scripting. */
      if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
        return answer(400, { ok: false, error: 'A redirect must be http or https.' });
      }
      destination.searchParams.set('lead', out?.status ?? 'created');
      return Response.redirect(destination.toString(), 303);
    }

    return answer(200, {
      ok: true,
      status: out?.status ?? 'created',
      ...(out?.id ? { id: out.id } : {}),
    });
  } catch (error) {
    const message = String((error as { message?: string } | null)?.message ?? '').trim();

    /* ⚠️ EVERY REFUSAL IS A RETURN, SO REACHING HERE IS OURS, NOT THEIRS. A
       throw from `crm_intake_lead` means the database refused something this
       code did — a type it could not cast, a constraint nobody expected — and
       answering 400 would blame the caller for it. */
    console.error('[crm-intake] unexpected', message);
    return answer(500, { ok: false, error: 'That lead could not be filed. This end has been told.' });
  }
}
