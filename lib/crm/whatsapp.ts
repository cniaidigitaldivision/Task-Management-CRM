import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * SENDING A WHATSAPP MESSAGE — Step 8
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE NUMBER IS PER PROJECT, IN THE DATABASE ──────────────────────────
 * Owner, 2026-09-10: *"This WhatsApp business number will just work for the one
 * app… Chitral Royal Homes will have a different WhatsApp business number… The
 * lead belongs to the number that belongs to the project."*
 *
 * So there is NO `WHATSAPP_PHONE_NUMBER_ID` environment variable, and adding one
 * would quietly make every business share a number. The id is read from the
 * project the lead sits on, exactly the way the Facebook page mapping already
 * works in `meta_accounts`.
 *
 * ── ⚠️ AND THE 24-HOUR WINDOW IS META'S RULE, NOT A SETTING ────────────────
 * Free-form text is REFUSED outside 24 hours of the customer's last message —
 * refused by the API, not merely discouraged. The refusal is passed through in
 * the sender's own words rather than reworded, because "re-engagement required"
 * means something specific and a paraphrase would send somebody looking for a
 * bug that does not exist.
 * ========================================================================= */

const API = 'https://graph.facebook.com';

export interface WhatsAppConfig {
  readonly phoneNumberId: string;
  readonly token: string;
  readonly apiVersion: string;
}

/**
 * Why a project cannot send. ⚠️ TWO DIFFERENT FAULTS WITH TWO DIFFERENT OWNERS,
 * and they must never wear the same sentence.
 *
 * Owner, 2026-09-13: *"Also assign a whatsapp testing number to this demo
 * project. Right now I'm trying to send a message. He is saying that there is no
 * number assigned to this project."* The number WAS assigned — migration 139 set
 * it, Meta confirms it live (+1 555-660-8298, quality GREEN). The message was
 * naming a cause it had not checked.
 *
 * `whatsAppConfigFor` used to return a bare `null` for both "this project has no
 * number" and "this server has no token", and the caller printed the first one.
 * So a missing deployment variable sent the reader to the Projects screen to fix
 * something that was already correct.
 */
export type WhatsAppConfigResult =
  | { readonly ok: true; readonly config: WhatsAppConfig }
  /** The project genuinely has no number. The ordinary state for most projects. */
  | { readonly ok: false; readonly why: 'no-number' }
  /** `META_SYSTEM_USER_TOKEN` is missing from this environment. Nothing to do
   *  with the project, and no project can send until it is set. */
  | { readonly ok: false; readonly why: 'no-token' };

/** Whether this environment could send for ANY project. Cheap, and separate,
 *  so a screen can decline to draw a composer that cannot possibly work. */
export function whatsAppTokenPresent(): boolean {
  return Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim());
}

/**
 * The number a given project sends from.
 *
 * ⚠️ NEVER THROWS. Most projects will not have a number for a long time —
 * Chitral's is a different business with its own, and the client projects have
 * none at all — so "not set up" is the ordinary case and the screen says so.
 */
export async function whatsAppConfigFor(
  actorId: string,
  projectId: string,
): Promise<WhatsAppConfigResult> {
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  const apiVersion = process.env.META_API_VERSION?.trim() || 'v26.0';
  if (!token) return { ok: false, why: 'no-token' };

  /* ⚠️ `withUser` AND A DEFINER — migration 141, and it is the reason nothing
     could ever be sent. This used to run under `withAppRole`, which sets
     `role = cni_app` and no session. `cni_app` has no BYPASSRLS and does not own
     the table, so RLS still applied and `projects_select` evaluated for a user
     that did not exist: ZERO ROWS, for every project and every caller, always.
     The refusal then read "this project has no WhatsApp number set up yet" on a
     project whose number was set, live and GREEN at Meta.

     Setting the role and skipping the session narrows HARDER than `withUser`,
     not less. It is the same policies evaluated for nobody. */
  const rows = await withUser(actorId, (tx) => tx`
    select app.crm_project_wa_number(${projectId}::uuid) as phone_number_id
  `);
  const id = (rows as Array<Record<string, unknown>>)[0]?.phone_number_id;
  if (!id) return { ok: false, why: 'no-number' };

  return { ok: true, config: { phoneNumberId: String(id), token, apiVersion } };
}

export interface SendResult {
  readonly ok: boolean;
  readonly wamid?: string;
  /** ⚠️ KEPT FOR MEDIA, so the thread can show the picture again later. Without
   *  it an image we sent is a filename in the record forever — and "what did he
   *  actually send the client" is one of the questions this log exists for. */
  readonly mediaId?: string;
  readonly error?: string;
}

async function post(
  config: WhatsAppConfig,
  body: Record<string, unknown>,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(`${API}/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      /* ⚠️ Explicit. A salesperson is watching this one — undici's default of
         300s is longer than the page, the function and their patience. */
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: 'WhatsApp could not be reached. Try again in a moment.' };
  }

  const json = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; error_data?: { details?: string } };
  };

  if (!response.ok || json.error) {
    /* ⚠️ META'S OWN WORDS, not ours. `error_data.details` is the specific one —
       "re-engagement message" for a closed window, or which template is
       unapproved — and rewording it costs the reader the only sentence that
       says what to do next. */
    const detail = json.error?.error_data?.details ?? json.error?.message;
    return { ok: false, error: detail ?? `WhatsApp refused the message (${response.status}).` };
  }

  const wamid = json.messages?.[0]?.id;
  if (!wamid) return { ok: false, error: 'WhatsApp accepted the message but returned no id.' };
  return { ok: true, wamid };
}

/** Free text. ⚠️ Only inside the 24-hour window; Meta refuses it outside. */
export async function sendText(
  config: WhatsAppConfig,
  toE164: string,
  body: string,
): Promise<SendResult> {
  return post(config, {
    /* ⚠️ Meta wants the number WITHOUT the leading plus. Sending it with one is
       accepted and then delivers to nobody, which is the worst of both. */
    to: toE164.replace(/^\+/, ''),
    type: 'text',
    text: { body, preview_url: true },
  });
}

/* ============================================================================
 * TEMPLATES — the only thing that reaches somebody after 24 hours
 * ----------------------------------------------------------------------------
 * ⚠️ THIS WAS THE ACTUAL BLOCKER, AND IT WAS OURS. Phase G was recorded as
 * "blocked on Meta approving templates". That was wrong, and the owner caught
 * it: *"I can't test all these templates on a tester receptor. Why can't I do
 * that? Please give me an exact answer."*
 *
 * The exact answer, from Meta's own documentation:
 *   · templates are created BY US — WhatsApp Manager or the Message Templates
 *     API, up to 100 per hour on one account. Nobody has to be asked.
 *   · review is AUTOMATIC and takes up to 24 hours, usually minutes.
 *   · a test business account and number are created automatically, with
 *     relaxed limits and NO payment method needed to send templates.
 *   · `hello_world` is pre-approved and sendable today.
 *
 * So nothing external was blocking anything. What was missing was this file:
 * the module could send free text and media and had no way to send a template
 * at all.
 *
 * ── ⚠️ AND A SEQUENCE CANNOT BE BUILT ON FREE TEXT ─────────────────────────
 * Step one of a chase usually lands inside the 24-hour window and free text
 * works. Step two is three days later, and by then `sendText` is REFUSED by the
 * API — not discouraged, refused. A sequence engine that only knew how to send
 * text would work in testing and fail silently in the field on the second step,
 * which is the worst possible place to discover it.
 * ========================================================================= */

/**
 * One template's variables, in the order the template declares them.
 *
 * ⚠️ POSITIONAL, AND THAT IS META'S DESIGN, NOT A SHORTCUT. A template body is
 * written as `Hello {{1}}, your visit to {{2}} is confirmed`, and the API takes
 * an ordered list. Getting the order wrong sends a real person a real message
 * with the plot number where their name should be — so the caller passes a named
 * record and the ordering happens once, here, against the template's own
 * declared parameter list.
 */
export interface TemplateSend {
  /** The name as registered with Meta, e.g. `visit_reminder`. */
  readonly name: string;
  /** Meta's language code, e.g. `en` or `en_US`. Must match the registration. */
  readonly language: string;
  /** Body variables, in `{{1}}`, `{{2}}` … order. */
  readonly body?: readonly string[];
  /** Variables for a URL button, if the template declares one. */
  readonly buttonUrl?: readonly string[];
}

/**
 * Send an approved template.
 *
 * ⚠️ THE ONLY MESSAGE TYPE THAT WORKS OUTSIDE THE 24-HOUR WINDOW, which is what
 * every follow-up step past the first one is.
 *
 * ⚠️ AND META'S REFUSAL IS PASSED THROUGH IN ITS OWN WORDS. The two that will
 * actually happen are worth recognising when they appear in a log:
 *   · "Template name does not exist in the translation" — the name or the
 *     LANGUAGE is wrong, and the language is the one people get wrong.
 *   · "... is not approved" — it was created but has not passed review yet.
 * Rewording either costs the reader the only sentence that says what to do.
 */
export async function sendTemplate(
  config: WhatsAppConfig,
  toE164: string,
  template: TemplateSend,
): Promise<SendResult> {
  const components: Array<Record<string, unknown>> = [];

  if (template.body && template.body.length > 0) {
    components.push({
      type: 'body',
      parameters: template.body.map((text) => ({ type: 'text', text })),
    });
  }

  if (template.buttonUrl && template.buttonUrl.length > 0) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: template.buttonUrl.map((text) => ({ type: 'text', text })),
    });
  }

  return post(config, {
    /* ⚠️ No leading plus, same as `sendText`. With one, Meta accepts the call
       and delivers to nobody — the worst of both. */
    to: toE164.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

/**
 * What Meta currently holds for this account, with each template's status.
 *
 * ⚠️ READ FROM META, NEVER FROM OUR OWN LIST. A template can be approved,
 * rejected, paused for poor quality, or disabled after complaints — all of which
 * happen on Meta's side with no call to us. A local table of "our templates"
 * would go stale the first time one was paused, and the first anybody would know
 * is a sequence silently failing.
 *
 * Returns `null` when the call itself failed, which is different from an account
 * that genuinely has no templates — the caller must not draw "none approved"
 * over a network error.
 */
export async function listTemplates(
  wabaId: string,
  apiVersion: string,
): Promise<ReadonlyArray<{
  name: string;
  language: string;
  status: string;
  category: string;
}> | null> {
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!token) return null;

  try {
    const response = await fetch(
      `${API}/${apiVersion}/${wabaId}/message_templates?limit=200&fields=name,language,status,category`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) return null;

    const json = (await response.json()) as {
      data?: Array<{ name?: string; language?: string; status?: string; category?: string }>;
    };
    if (!json.data) return null;

    return json.data.map((t) => ({
      name: String(t.name ?? ''),
      language: String(t.language ?? ''),
      /* APPROVED · PENDING · REJECTED · PAUSED · DISABLED — Meta's own words. */
      status: String(t.status ?? 'UNKNOWN'),
      category: String(t.category ?? ''),
    }));
  } catch {
    return null;
  }
}

/**
 * Upload a file to Meta, then send it by id.
 *
 * ⚠️ TWO CALLS, AND THERE IS NO ONE-CALL VERSION. The Cloud API takes a media
 * id or a public URL — and our files are behind a login, so a URL Meta could
 * fetch would be a file anybody could fetch. Uploading is the private path.
 */
export async function sendMedia(
  config: WhatsAppConfig,
  toE164: string,
  file: { data: Buffer; mime: string; filename: string },
  caption: string | null,
): Promise<SendResult> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.mime);
  form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);

  let upload: Response;
  try {
    upload = await fetch(`${API}/${config.apiVersion}/${config.phoneNumberId}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, error: 'The file could not be uploaded to WhatsApp.' };
  }

  const uploaded = (await upload.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!upload.ok || !uploaded.id) {
    return {
      ok: false,
      error: uploaded.error?.message ?? `WhatsApp refused the file (${upload.status}).`,
    };
  }

  /* ⚠️ WHICH MESSAGE TYPE IS DECIDED BY THE MIME, not by the sender. An image
     sent as a document arrives as a file to download rather than a picture to
     look at, and a document sent as an image is refused outright. */
  const type = file.mime.startsWith('image/')
    ? 'image'
    : file.mime.startsWith('video/')
      ? 'video'
      : file.mime.startsWith('audio/')
        ? 'audio'
        : 'document';

  const media: Record<string, unknown> = { id: uploaded.id };
  if (caption && type !== 'audio') media.caption = caption;
  /* Only a document carries a filename; WhatsApp shows it under the icon. */
  if (type === 'document') media.filename = file.filename;

  const sent = await post(config, {
    to: toE164.replace(/^\+/, ''),
    type,
    [type]: media,
  });
  /* The upload id travels back with the result — it is what the media route
     re-fetches from, and it is not recoverable from the wamid. */
  return sent.ok ? { ...sent, mediaId: uploaded.id } : sent;
}

/**
 * Fetch an inbound attachment.
 *
 * ⚠️ TWO CALLS AGAIN: the id gives a URL, and the URL needs the bearer token —
 * it is not public. Fetching it without the header returns a 401 that looks
 * exactly like an expired file.
 */
export async function fetchMedia(
  config: WhatsAppConfig,
  mediaId: string,
): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const meta = await fetch(`${API}/${config.apiVersion}/${mediaId}`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) return null;

    const file = await fetch(info.url, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!file.ok) return null;

    return {
      data: Buffer.from(await file.arrayBuffer()),
      mime: info.mime_type ?? 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
