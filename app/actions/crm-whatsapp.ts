'use server';

/* ============================================================================
 * REPLYING TO A LEAD ON WHATSAPP — Step 8, and the chat's menus (184)
 * ----------------------------------------------------------------------------
 * ── ⚠️ THERE IS NO SHARED INBOX, AND THIS IS WHERE THAT IS ENFORCED ────────
 * Owner, 2026-09-13: *"The lead, which is attached to salesperson 1, will always
 * reply to him… This is not a good way: the lead is with one person and talking
 * to some other person."*
 *
 * Every path below reads the lead or the message under the caller's own session,
 * so RLS decides. A salesperson who does not own the lead gets null and is
 * refused — not by a check written here, but by the same policy that decides
 * whether they can see the lead at all.
 *
 * ── ⚠️ AND THE MESSAGE IS RECORDED AS THE SENDER'S ─────────────────────────
 * `sent_by_id` is the acting user, and 138's policy refuses any other value.
 *
 * ── ⚠️ NO `revalidatePath('/my-leads')` ON A MENU ACTION ───────────────────
 * Revalidating the page a server action was called from re-renders the whole
 * page into the action's response. A reaction would then cost the lead list, the
 * counts and the diary. The chat draws the change itself and re-reads the thread.
 * ========================================================================= */

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { buildReplyBrief, suggestReply, type ReplySuggestion } from '@/lib/ai/reply-suggestion';
import { requireCrmAccess, requireUser } from '@/lib/auth/current-user';
import {
  fetchMedia,
  mediaReader,
  sendMedia,
  sendReaction,
  sendText,
  whatsAppConfigFor,
  whatsAppMediaType,
} from '@/lib/crm/whatsapp';
import type { WhatsAppConfigResult } from '@/lib/crm/whatsapp';
import { withUser } from '@/lib/db/client';
import { crmLeadThread, getCrmLead } from '@/lib/db/queries/crm-leads';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import {
  deleteSavedReply,
  forwardTargets,
  hideMessage,
  leadForSending,
  listSavedReplies,
  messageForAction,
  recordOutboundMessage,
  saveSavedReply,
  setOurReaction,
  setPinned,
  setStar,
  type ForwardTarget,
  type SavedReplies,
} from '@/lib/db/queries/crm-whatsapp';
import { downloadObject, signedUploadUrl, uploadObject } from '@/lib/storage/bucket';

export interface WhatsAppSendResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The thread as it now stands, so the chat replaces its copy in one step. */
  readonly thread?: readonly CrmMessage[];
}

export interface WhatsAppActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⚠️ THE REFUSAL NAMES THE FAULT IT ACTUALLY FOUND. Owner, 2026-09-13, holding a
 * project that was correctly set up: *"He is saying that there is no number
 * assigned to this project."* It was assigned. Both faults used to print the
 * project's sentence, so a missing deployment variable sent the reader to fix
 * something that was already right.
 */
function whyNotSendable(result: Extract<WhatsAppConfigResult, { ok: false }>, projectName: string): string {
  return result.why === 'no-token'
    ? 'This server has no WhatsApp connection configured — META_SYSTEM_USER_TOKEN is missing from the environment. '
      + `That is a deployment setting, not anything to fix on ${projectName}.`
    : `${projectName} has no WhatsApp number set up yet. An Admin adds it against the project.`;
}

/* ── Size rules — WhatsApp's own, except documents ────────────────────────
   Meta takes documents up to 100 MB. 25 MB is ours: the file passes through a
   function on its way to Meta, and a brochure is never that large. */
const LIMIT = { image: 5, video: 16, audio: 16, document: 25 } as const;
const MB = 1024 * 1024;

function limitFor(mime: string): { kind: keyof typeof LIMIT; bytes: number } {
  const kind = whatsAppMediaType(mime);
  return { kind, bytes: LIMIT[kind] * MB };
}

async function sendableLead(actorId: string, leadId: string) {
  if (!UUID.test(leadId)) return { ok: false as const, error: 'That lead could not be found.' };
  const lead = await leadForSending(actorId, leadId);
  if (!lead) return { ok: false as const, error: 'That lead is not yours.' };
  if (!lead.phoneE164) return { ok: false as const, error: 'This lead has no usable number, so nothing can be sent.' };
  const ready = await whatsAppConfigFor(actorId, lead.projectId);
  if (!ready.ok) return { ok: false as const, error: whyNotSendable(ready, lead.projectName) };
  return { ok: true as const, lead, config: ready.config, phone: lead.phoneE164 };
}

/* ════════════════════════════════════════════════════════════════════════════
 * THE 24-HOUR WINDOW, ENFORCED RATHER THAN DISPLAYED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, with two messages showing "Not delivered — Re-engagement
 * message": *"when I send this message while I have added this recipient number,
 * why is it showing me this error?"*
 *
 * Because WhatsApp refused it, and it was always going to. That lead has NEVER
 * written to us (`last_inbound` is null), so there is no service window open, and
 * outside one Meta delivers approved TEMPLATES only. Error 131047.
 *
 * ⚠️ THE SCREEN KNEW AND SENT ANYWAY. The composer showed "24-hour window closed"
 * in the same strip as the send button, and `disabledReason` covered only
 * "loading" and "no number" — so free text went to Meta, came back refused, and
 * landed in the thread as a failure the salesperson had to interpret. A rule that
 * is displayed but not enforced is a rule the product breaks on the user's behalf.
 *
 * ⚠️ AND IT IS DECIDED FROM OUR OWN RECORDS, NOT BY ASKING META. There is no API
 * for "is the window open"; the only truth is when they last wrote to us.
 * `whatsapp-test-number-lies` in the notes: the TEST number accepts free text 26
 * hours later, so discovering this by trying it on the sandbox reports success and
 * a real client's number then refuses.
 * ════════════════════════════════════════════════════════════════════════════ */

const WINDOW_MS = 24 * 3_600_000;

/** Null when free text may be sent; otherwise why it may not. */
async function windowRefusal(actorId: string, leadId: string): Promise<string | null> {
  const rows = (await withUser(actorId, (tx) => tx`
    select max(m.occurred_at) as last_inbound
      from public.crm_lead_messages m
     where m.lead_id = ${leadId}::uuid
       and m.channel = 'whatsapp'
       and m.direction = 'inbound'
  `)) as Array<{ last_inbound: string | null }>;

  const last = rows[0]?.last_inbound ? Date.parse(String(rows[0].last_inbound)) : null;
  if (last !== null && Date.now() - last < WINDOW_MS) return null;

  /* ⚠️ TWO DIFFERENT SITUATIONS, TWO DIFFERENT SENTENCES. "They have never
     written" and "they wrote, but three days ago" need different things from the
     salesperson, and one message for both leaves them guessing which they have. */
  return last === null
    ? 'This person has never messaged you on WhatsApp, so WhatsApp will not deliver a typed message. Send an approved template to open the conversation — once they reply, you can write freely for 24 hours.'
    : 'The 24-hour window closed, so WhatsApp will not deliver a typed message. Send an approved template — once they reply, you can write freely again for 24 hours.';
}

/** The wamid of the message being replied to — only from the same lead. */
async function replyWamid(actorId: string, leadId: string, replyToMessageId: string | null | undefined) {
  if (!replyToMessageId || !UUID.test(replyToMessageId)) return null;
  const m = await messageForAction(actorId, replyToMessageId);
  return m && m.leadId === leadId && !m.hidden ? m.waMessageId : null;
}

/* ════════════════════════════════════════════════════════════════════════════
 * TEXT
 * ════════════════════════════════════════════════════════════════════════════ */

export async function sendWhatsAppTextAction(
  leadId: string,
  body: string,
  replyToMessageId?: string | null,
): Promise<WhatsAppSendResult> {
  const user = await requireUser();

  const text = body.trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  if (text.length > 4096) return { ok: false, error: 'That is longer than WhatsApp allows (4096 characters).' };

  const ready = await sendableLead(user.id, leadId);
  if (!ready.ok) return { ok: false, error: ready.error };

  /* ⚠️ REFUSED HERE, BEFORE META AND BEFORE THE THREAD. A message recorded as
     failed is a message the salesperson believes they sent. */
  const closed = await windowRefusal(user.id, leadId);
  if (closed) return { ok: false, error: closed };

  const replyTo = await replyWamid(user.id, leadId, replyToMessageId);
  const result = await sendText(ready.config, ready.phone, text, replyTo);

  /* ⚠️ RECORDED EITHER WAY. A refusal is part of the conversation — it is how
     somebody finds out the 24-hour window has closed. */
  await recordOutboundMessage(user.id, {
    leadId,
    wamid: result.wamid ?? null,
    kind: 'text',
    body: text,
    replyToWamid: replyTo,
    error: result.ok ? null : (result.error ?? 'refused'),
  });

  revalidatePath(`/leads/${leadId}`);
  const thread = await crmLeadThread(user.id, leadId);
  return result.ok ? { ok: true, thread } : { ok: false, error: result.error, thread };
}

/* ════════════════════════════════════════════════════════════════════════════
 * FILES, PHOTOS, VIDEO, VOICE
 * ----------------------------------------------------------------------------
 * ⚠️ TWO STEPS, BECAUSE OF VERCEL, NOT BECAUSE OF WHATSAPP. A function refuses a
 * request body over 4.5 MB, so a video posted through a server action dies in
 * production. So: (1) the server hands the browser a one-path upload address,
 * (2) the browser puts the file into the private bucket, (3) the server reads it
 * from there and sends it to Meta. The stored copy is also the permanent one —
 * Meta forgets media ids after 30 days.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface UploadSlot {
  readonly path: string;
  readonly url: string;
}

export async function prepareWhatsAppUploadsAction(
  leadId: string,
  files: ReadonlyArray<{ name: string; size: number; mime: string }>,
): Promise<{ ok: boolean; error?: string; slots?: UploadSlot[] }> {
  const user = await requireUser();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: 'Choose a file first.' };
  if (files.length > 10) return { ok: false, error: 'Send up to 10 files at a time.' };

  const lead = await leadForSending(user.id, leadId);
  if (!lead) return { ok: false, error: 'That lead is not yours.' };

  for (const f of files) {
    const { kind, bytes } = limitFor(f.mime);
    if (!(f.size > 0)) return { ok: false, error: `${f.name} is empty.` };
    if (f.size > bytes) {
      return { ok: false, error: `${f.name} is ${(f.size / MB).toFixed(1)} MB — WhatsApp takes a ${kind} up to ${LIMIT[kind]} MB.` };
    }
  }

  const slots: UploadSlot[] = [];
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'file';
    const path = `crm-whatsapp/${leadId}/${randomUUID()}/${safe}`;
    const signed = await signedUploadUrl(path);
    if (!signed.ok) return { ok: false, error: signed.message };
    slots.push({ path, url: signed.value });
  }
  return { ok: true, slots };
}

export async function sendWhatsAppMediaAction(input: {
  leadId: string;
  path: string;
  filename: string;
  mime: string;
  size: number;
  caption: string | null;
  replyToMessageId: string | null;
  voice: boolean;
}): Promise<WhatsAppSendResult> {
  const user = await requireUser();

  /* ⚠️ THE PATH MUST BE ONE THIS LEAD'S UPLOAD ADDRESS WROTE. Otherwise any file
     in the bucket — another client's quotation — could be sent by naming it. */
  if (!UUID.test(input.leadId)
      || !input.path.startsWith(`crm-whatsapp/${input.leadId}/`)
      || input.path.includes('..')) {
    return { ok: false, error: 'That file could not be found.' };
  }
  const caption = input.caption?.trim().slice(0, 1024) || null;

  const ready = await sendableLead(user.id, input.leadId);
  if (!ready.ok) return { ok: false, error: ready.error };

  /* ⚠️ A PHOTO IS NOT AN EXCEPTION. The window governs everything that is not an
     approved template — a brochure sent into a closed one fails exactly as a
     typed line does, and costs an upload on the way. */
  const closedForMedia = await windowRefusal(user.id, input.leadId);
  if (closedForMedia) return { ok: false, error: closedForMedia };

  const stored = await downloadObject(input.path);
  if (!stored.ok) return { ok: false, error: `The file did not arrive in storage — ${stored.message}` };
  const { bytes } = limitFor(input.mime);
  if (stored.value.data.length > bytes) return { ok: false, error: 'That file is larger than WhatsApp allows.' };

  const mime = input.voice ? 'audio/ogg' : input.mime || 'application/octet-stream';
  const filename = input.filename.slice(-120) || 'file';
  const replyTo = await replyWamid(user.id, input.leadId, input.replyToMessageId);
  const result = await sendMedia(
    ready.config,
    ready.phone,
    { data: stored.value.data, mime, filename },
    caption,
    { replyTo, voice: input.voice },
  );

  await recordOutboundMessage(user.id, {
    leadId: input.leadId,
    wamid: result.wamid ?? null,
    kind: whatsAppMediaType(mime),
    body: caption,
    mediaId: result.mediaId ?? null,
    mediaPath: input.path,
    mediaMime: mime,
    mediaFilename: filename,
    mediaSize: stored.value.data.length,
    mediaVoice: input.voice,
    replyToWamid: replyTo,
    error: result.ok ? null : (result.error ?? 'refused'),
  });

  revalidatePath(`/leads/${input.leadId}`);
  const thread = await crmLeadThread(user.id, input.leadId);
  return result.ok ? { ok: true, thread } : { ok: false, error: result.error, thread };
}

/** The older docked chat's direct upload — small files only; kept working. */
export async function sendWhatsAppFileAction(leadId: string, form: FormData): Promise<WhatsAppSendResult> {
  await requireUser();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file first.' };
  const mime = file.type || 'application/octet-stream';
  const { kind, bytes } = limitFor(mime);
  if (file.size > bytes) return { ok: false, error: `WhatsApp takes a ${kind} up to ${LIMIT[kind]} MB.` };

  const safe = file.name.replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'file';
  const path = `crm-whatsapp/${leadId}/${randomUUID()}/${safe}`;
  const put = await uploadObject({ path, body: new Uint8Array(await file.arrayBuffer()), contentType: mime });
  if (!put.ok) return { ok: false, error: put.message };
  return sendWhatsAppMediaAction({
    leadId, path, filename: file.name, mime, size: file.size,
    caption: String(form.get('caption') ?? '') || null, replyToMessageId: null, voice: false,
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * THE MESSAGE MENU
 * ════════════════════════════════════════════════════════════════════════════ */

const EMOJI = /^\p{Extended_Pictographic}/u;

/**
 * React — WhatsApp's own reaction, on the client's phone too.
 *
 * ⚠️ SENT FIRST, SAVED SECOND. A reaction saved here that Meta refused would show
 * a heart the client never saw.
 */
export async function reactToMessageAction(messageId: string, emoji: string | null): Promise<WhatsAppActionResult> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  if (emoji !== null && (emoji.length > 16 || !EMOJI.test(emoji))) return { ok: false, error: 'That is not an emoji.' };

  const m = await messageForAction(user.id, messageId);
  if (!m || m.hidden) return { ok: false, error: 'That message could not be found.' };
  if (m.channel !== 'whatsapp') return { ok: false, error: 'Only WhatsApp messages take a reaction.' };
  if (!m.waMessageId) return { ok: false, error: 'This message never reached WhatsApp, so it cannot be reacted to.' };
  if (Date.now() - Date.parse(m.occurredAt) > 30 * 86_400_000) {
    return { ok: false, error: 'WhatsApp only allows reactions to messages from the last 30 days.' };
  }

  const ready = await sendableLead(user.id, m.leadId);
  if (!ready.ok) return { ok: false, error: ready.error };
  const sent = await sendReaction(ready.config, ready.phone, m.waMessageId, emoji);
  if (!sent.ok) return { ok: false, error: sent.error ?? 'WhatsApp refused the reaction.' };

  await setOurReaction(user.id, messageId, emoji);
  return { ok: true };
}

/** Pin — the CRM's, visible to everybody on the lead. WhatsApp has no pin API. */
export async function pinMessageAction(messageId: string, pinned: boolean): Promise<WhatsAppActionResult> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  return (await setPinned(user.id, messageId, pinned)) ? { ok: true } : { ok: false, error: 'That message could not be found.' };
}

/** Star — yours alone, as on the phone. */
export async function starMessageAction(messageId: string, starred: boolean): Promise<WhatsAppActionResult> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  return (await setStar(user.id, messageId, starred)) ? { ok: true } : { ok: false, error: 'That message could not be found.' };
}

/**
 * Delete in the CRM — hidden for the whole team, never removed from the client's phone.
 *
 * ⚠️ THE CLIENT KEEPS IT. WhatsApp's Cloud API has no way for a business to unsend
 * a message (checked against Meta's reference again on 2026-09-17, when the owner
 * asked for the Business app's "delete for everyone": the API's one message
 * operation is send; `revoke` exists only as a webhook for when the CLIENT deletes).
 * The screen says so before anybody confirms. The row is kept —
 * the thread shows who deleted it and when — because a message that vanished
 * without a trace from a client conversation is exactly what a manager would
 * need to ask about.
 */
export async function deleteMessageForMeAction(messageId: string): Promise<WhatsAppActionResult> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  return (await hideMessage(user.id, messageId)) ? { ok: true } : { ok: false, error: 'That message could not be found.' };
}

/* ── Forward ─────────────────────────────────────────────────────────────── */

export async function forwardTargetsAction(leadId: string, query: string): Promise<readonly ForwardTarget[]> {
  const user = await requireUser();
  if (!UUID.test(leadId)) return [];
  return forwardTargets(user.id, String(query ?? '').slice(0, 80), leadId);
}

/**
 * Forward to up to five other leads.
 *
 * ⚠️ RE-SENT, NOT RE-POINTED. Media ids are per phone number and a client's
 * inbound id cannot be sent at all, so the file's bytes are sent again — from our
 * stored copy, or from Meta while it still has it.
 */
export async function forwardMessageAction(
  messageId: string,
  leadIds: readonly string[],
): Promise<{ ok: boolean; error?: string; results?: Array<{ leadId: string; ok: boolean; error?: string }> }> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  const targets = [...new Set(leadIds)].filter((id) => UUID.test(id)).slice(0, 5);
  if (targets.length === 0) return { ok: false, error: 'Choose who to forward it to.' };

  const m = await messageForAction(user.id, messageId);
  if (!m || m.hidden) return { ok: false, error: 'That message could not be found.' };
  const hasMedia = Boolean(m.mediaPath || m.mediaId);
  if (!hasMedia && !m.body) return { ok: false, error: 'There is nothing in this message to forward.' };

  let file: { data: Buffer; mime: string; filename: string } | null = null;
  if (hasMedia) {
    if (m.mediaPath) {
      const got = await downloadObject(m.mediaPath);
      if (got.ok) file = { data: got.value.data, mime: m.mediaMime ?? got.value.contentType, filename: m.mediaFilename ?? 'file' };
    }
    if (!file && m.mediaId) {
      const reader = mediaReader();
      const got = reader ? await fetchMedia(reader, m.mediaId) : null;
      if (got) file = { data: got.data, mime: m.mediaMime ?? got.mime, filename: m.mediaFilename ?? 'file' };
    }
    if (!file) return { ok: false, error: 'WhatsApp no longer has this file, so it cannot be forwarded.' };
  }

  const results: Array<{ leadId: string; ok: boolean; error?: string }> = [];
  for (const target of targets) {
    const ready = await sendableLead(user.id, target);
    if (!ready.ok) {
      results.push({ leadId: target, ok: false, error: ready.error });
      continue;
    }
    /* ⚠️ PER TARGET. Forwarding to five people is five windows, not one — and
       the one that is shut must be named rather than silently failing. */
    const shut = await windowRefusal(user.id, target);
    if (shut) {
      results.push({ leadId: target, ok: false, error: shut });
      continue;
    }
    if (file) {
      const path = `crm-whatsapp/${target}/${randomUUID()}/${file.filename.replace(/[^\w.\-() ]+/g, '_').slice(-80)}`;
      const put = await uploadObject({ path, body: new Uint8Array(file.data), contentType: file.mime });
      const sent = await sendMedia(ready.config, ready.phone, file, m.body, { voice: m.mediaVoice });
      await recordOutboundMessage(user.id, {
        leadId: target, wamid: sent.wamid ?? null, kind: whatsAppMediaType(file.mime), body: m.body,
        mediaId: sent.mediaId ?? null, mediaPath: put.ok ? path : null, mediaMime: file.mime,
        mediaFilename: file.filename, mediaSize: file.data.length, mediaVoice: m.mediaVoice,
        forwarded: true, error: sent.ok ? null : (sent.error ?? 'refused'),
      });
      results.push({ leadId: target, ok: sent.ok, error: sent.ok ? undefined : sent.error });
    } else {
      const sent = await sendText(ready.config, ready.phone, m.body!);
      await recordOutboundMessage(user.id, {
        leadId: target, wamid: sent.wamid ?? null, kind: 'text', body: m.body,
        forwarded: true, error: sent.ok ? null : (sent.error ?? 'refused'),
      });
      results.push({ leadId: target, ok: sent.ok, error: sent.ok ? undefined : sent.error });
    }
    revalidatePath(`/leads/${target}`);
  }
  return { ok: results.some((r) => r.ok), results };
}

/* ── Ask AI ──────────────────────────────────────────────────────────────── */

export async function suggestReplyAction(
  messageId: string,
): Promise<{ ok: boolean; error?: string; suggestion?: ReplySuggestion }> {
  const user = await requireUser();
  if (!UUID.test(messageId)) return { ok: false, error: 'That message could not be found.' };
  const m = await messageForAction(user.id, messageId);
  if (!m || m.hidden) return { ok: false, error: 'That message could not be found.' };

  const [found, thread] = await Promise.all([getCrmLead(user.id, m.leadId), crmLeadThread(user.id, m.leadId)]);
  if (!found) return { ok: false, error: 'That lead is not yours.' };
  const upTo = thread.filter((t) => Date.parse(t.occurredAt) <= Date.parse(m.occurredAt) && !t.hiddenAt);
  try {
    const suggestion = await suggestReply(buildReplyBrief({
      leadName: found.lead.fullName,
      projectName: found.lead.projectName,
      stage: found.lead.stage,
      thread: upTo,
      target: m,
    }));
    return { ok: true, suggestion };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'AI could not draft a reply.' };
  }
}

/* ── Saved replies ───────────────────────────────────────────────────────── */

export async function savedRepliesAction(): Promise<SavedReplies> {
  const { user } = await requireCrmAccess();
  return listSavedReplies(user.id);
}

export async function saveSavedReplyAction(input: {
  id: string | null;
  scope: string;
  title: string;
  shortcut: string;
  body: string;
}): Promise<{ ok: boolean; error?: string; saved?: SavedReplies }> {
  const { user } = await requireCrmAccess();
  const title = input.title.trim();
  const body = input.body.trim();
  const shortcut = input.shortcut.trim().toLowerCase().replace(/^\//, '') || null;
  const scope = input.scope === 'team' ? 'team' : 'personal';
  if (input.id && !UUID.test(input.id)) return { ok: false, error: 'That reply could not be found.' };
  if (!title) return { ok: false, error: 'Give the reply a short name.' };
  if (title.length > 60) return { ok: false, error: 'Keep the name under 60 characters.' };
  if (!body) return { ok: false, error: 'Write the reply.' };
  if (body.length > 4096) return { ok: false, error: 'That is longer than WhatsApp allows (4096 characters).' };
  if (shortcut && !/^[a-z0-9-]{1,24}$/.test(shortcut)) {
    return { ok: false, error: 'A shortcut is letters, numbers and dashes — like greet.' };
  }
  try {
    const ok = await saveSavedReply(user.id, { id: input.id, scope, title, shortcut, body });
    if (!ok) return { ok: false, error: 'That reply could not be changed.' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') return { ok: false, error: 'Only a manager can save a reply for the whole team.' };
    throw error;
  }
  return { ok: true, saved: await listSavedReplies(user.id) };
}

export async function deleteSavedReplyAction(id: string): Promise<{ ok: boolean; error?: string; saved?: SavedReplies }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That reply could not be found.' };
  if (!(await deleteSavedReply(user.id, id))) return { ok: false, error: 'That reply could not be deleted.' };
  return { ok: true, saved: await listSavedReplies(user.id) };
}

/* ════════════════════════════════════════════════════════════════════════════
 * READING THE THREAD BACK, WHILE THE PANEL IS OPEN
 * ----------------------------------------------------------------------------
 * ⚠️ THIS, NOT `router.refresh()`. A refresh re-runs the whole page for one line
 * of text. RLS-scoped like everything else: somebody polling a lead that is not
 * theirs gets an empty list.
 * ════════════════════════════════════════════════════════════════════════════ */
export async function readWhatsAppThreadAction(leadId: string): Promise<readonly CrmMessage[]> {
  const user = await requireUser();
  if (!UUID.test(leadId)) return [];
  return crmLeadThread(user.id, leadId);
}
