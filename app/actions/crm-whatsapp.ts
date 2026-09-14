'use server';

/* ============================================================================
 * REPLYING TO A LEAD ON WHATSAPP — Step 8
 * ----------------------------------------------------------------------------
 * ── ⚠️ THERE IS NO SHARED INBOX, AND THIS IS WHERE THAT IS ENFORCED ────────
 * Owner, 2026-09-13: *"The lead, which is attached to salesperson 1, will always
 * reply to him… This is not a good way: the lead is with one person and talking
 * to some other person."*
 *
 * Every path below reads the lead through `getCrmLead`, which is RLS-scoped. A
 * salesperson who does not own the lead gets null and is refused — not by a
 * check written here, but by the same policy that decides whether they can see
 * the lead at all. The manager and an Admin pass, because they manage the
 * project; that is the one deliberate exception and the owner confirmed it.
 *
 * ── ⚠️ AND THE MESSAGE IS RECORDED AS THE SENDER'S ─────────────────────────
 * `sent_by_id` is the acting user, and 138's policy refuses any other value. On
 * the phone app "who replied" is unknowable; that column is the entire reason
 * this feature exists rather than four people sharing a handset.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { sendMedia, sendText, whatsAppConfigFor } from '@/lib/crm/whatsapp';
import type { WhatsAppConfigResult } from '@/lib/crm/whatsapp';
import { withUser } from '@/lib/db/client';
import { crmLeadThread, getCrmLead } from '@/lib/db/queries/crm-leads';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';

export interface WhatsAppSendResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * ⚠️ THE REFUSAL NAMES THE FAULT IT ACTUALLY FOUND. Owner, 2026-09-13, holding a
 * project that was correctly set up: *"I'm trying to send a message. He is
 * saying that there is no number assigned to this project."* It was assigned.
 * Both faults used to print the project's sentence, so a missing deployment
 * variable sent the reader to fix something that was already right.
 */
function whyNotSendable(result: Extract<WhatsAppConfigResult, { ok: false }>, projectName: string): string {
  return result.why === 'no-token'
    ? 'This server has no WhatsApp connection configured — META_SYSTEM_USER_TOKEN is missing from the environment. '
      + `That is a deployment setting, not anything to fix on ${projectName}.`
    : `${projectName} has no WhatsApp number set up yet. An Admin adds it against the project.`;
}

/** 16 MB is WhatsApp's own ceiling for documents and video. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

async function recordOutbound(
  actorId: string,
  leadId: string,
  input: {
    wamid: string | null;
    kind: string;
    body: string | null;
    mediaId?: string | null;
    mime?: string | null;
    filename?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_messages
      (lead_id, wa_message_id, direction, kind, body, media_id, media_mime, media_filename,
       status, status_at, error_detail, sent_by_id, occurred_at)
    values (
      ${leadId}::uuid, ${input.wamid}, 'outbound',
      ${input.kind}::public.crm_message_kind, ${input.body},
      ${input.mediaId ?? null}, ${input.mime ?? null}, ${input.filename ?? null},
      ${input.error ? 'failed' : 'sent'}::public.crm_message_status, now(),
      ${input.error ?? null}, ${actorId}::uuid, now()
    )
    on conflict (wa_message_id) do nothing
  `);
}

export async function sendWhatsAppTextAction(
  leadId: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const user = await requireUser();

  const text = body.trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  /* WhatsApp's own limit. Refused here so the failure is a sentence rather than
     a rejection from Meta after the reader has pressed send. */
  if (text.length > 4096) return { ok: false, error: 'That is longer than WhatsApp allows (4096 characters).' };

  const found = await getCrmLead(user.id, leadId);
  if (!found) return { ok: false, error: 'That lead is not yours.' };
  const lead = found.lead;

  if (!lead.phoneE164) {
    return { ok: false, error: 'This lead has no usable number, so nothing can be sent.' };
  }

  const ready = await whatsAppConfigFor(user.id, lead.projectId);
  if (!ready.ok) return { ok: false, error: whyNotSendable(ready, lead.projectName) };

  const result = await sendText(ready.config, lead.phoneE164, text);

  /* ⚠️ RECORDED EITHER WAY. A refusal is part of the conversation — it is how
     somebody finds out the 24-hour window has closed, and a failure that leaves
     no trace looks like a message that was never written. */
  await recordOutbound(user.id, leadId, {
    wamid: result.wamid ?? null,
    kind: 'text',
    body: text,
    error: result.ok ? null : (result.error ?? 'refused'),
  });

  revalidatePath(`/leads/${leadId}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function sendWhatsAppFileAction(
  leadId: string,
  form: FormData,
): Promise<WhatsAppSendResult> {
  const user = await requireUser();

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file first.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'WhatsApp will not take a file over 16 MB.' };
  }

  const caption = String(form.get('caption') ?? '').trim() || null;

  const found = await getCrmLead(user.id, leadId);
  if (!found) return { ok: false, error: 'That lead is not yours.' };
  const lead = found.lead;

  if (!lead.phoneE164) {
    return { ok: false, error: 'This lead has no usable number, so nothing can be sent.' };
  }

  const ready = await whatsAppConfigFor(user.id, lead.projectId);
  if (!ready.ok) return { ok: false, error: whyNotSendable(ready, lead.projectName) };

  const data = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'application/octet-stream';
  const result = await sendMedia(
    ready.config,
    lead.phoneE164,
    { data, mime, filename: file.name },
    caption,
  );

  const kind = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'document';

  await recordOutbound(user.id, leadId, {
    wamid: result.wamid ?? null,
    kind,
    body: caption,
    mediaId: result.mediaId ?? null,
    mime,
    filename: file.name,
    error: result.ok ? null : (result.error ?? 'refused'),
  });

  revalidatePath(`/leads/${leadId}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/* ============================================================================
 * READING THE THREAD BACK, WHILE THE PANEL IS OPEN
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-13: *"Messaging messages are sending but when I reply back from
 * there, it is not receiving in a chat."* Two separate faults wore that one
 * sentence. Migration 142 fixed the first — the reply was being filed against a
 * sibling lead sharing the number. This is the second: nothing on the page ever
 * asked again, so a message that arrived after render stayed invisible until
 * somebody reloaded.
 *
 * ── ⚠️ THIS, NOT `router.refresh()` ────────────────────────────────────────
 * A refresh re-runs the whole lead page — the record, the roster, the cached AI
 * reading, the siblings — every few seconds, for one line of text. This reads
 * the thread and nothing else.
 *
 * ⚠️ AND IT IS RLS-SCOPED LIKE EVERYTHING ELSE. `crmLeadThread` runs under
 * `withUser`, and 138's policy delegates to the lead, so somebody polling a lead
 * that is not theirs gets an empty list rather than a refusal — the same answer
 * the page would have given them.
 * ========================================================================= */
export async function readWhatsAppThreadAction(leadId: string): Promise<readonly CrmMessage[]> {
  const user = await requireUser();
  return crmLeadThread(user.id, leadId);
}
