import 'server-only';

import { followUpEmail, sendLeadEmail } from '@/lib/crm/email';
import { sendTemplate, sendText, type WhatsAppConfig } from '@/lib/crm/whatsapp';
import { withAppRole } from '@/lib/db/client';
import { fillTokens } from '@/lib/domain/crm-followup-plans';
import { downloadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * THE SENDER — what makes a scheduled follow-up actually go
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, reading a review screen that said a person presses send:
 *
 *   *"I am on that the follow-up will be sent at the respective time
 *   automatically. If I have to log in and send the follow-up… what is the
 *   purpose of the follow-up then, and the automation of follow-ups then?"*
 *
 * Right. 170 queues; this delivers. `app.crm_advance_sequences` decides WHAT is
 * due, `app.crm_followups_to_send` hands over only what may still go out, and
 * this module talks to Meta and to Resend.
 *
 * ── ⚠️ THE DATABASE DECIDES, NOT THIS FILE ─────────────────────────────────
 * Every rule that could reach a client wrongly — the client replied, the lead
 * closed, they said no, the quotation died, a visit is booked, the 24-hour
 * window, business hours, one chase a day — is answered in SQL, at the moment
 * of sending, by the same functions the screen describes. This module may
 * refuse, and may report a failure. It may not decide that something is safe.
 *
 * ── ⚠️ AND IT WRITES THE MESSAGE INTO THE THREAD ───────────────────────────
 * A machine's message is still the business's message. If the conversation did
 * not show it, the next person to open the chat would send the same thing again.
 *
 * ── ⚠️ ONE SEND PER ROW, SETTLED IMMEDIATELY ───────────────────────────────
 * The row leaves the queue the moment it is settled (`status <> 'due'`), so a
 * second run that overlaps the first cannot send it twice. The settle is
 * conditional on `status = 'due'` in SQL — not on this loop being alone.
 * ========================================================================= */

export interface SendReport {
  readonly followUpId: string;
  readonly leadName: string;
  readonly channel: string;
  readonly outcome: 'sent' | 'failed';
  readonly detail: string;
}

interface QueueRow {
  follow_up_id: string;
  lead_id: string;
  project_id: string;
  lead_sequence_id: string | null;
  owner_id: string | null;
  channel: string;
  title: string;
  body: string | null;
  subject: string | null;
  lead_name: string | null;
  to_phone: string | null;
  to_email: string | null;
  template_name: string | null;
  template_language: string;
  document_ids: string[] | null;
  window_open: boolean;
  wa_phone_number_id: string | null;
  sender_name: string;
  project_name: string;
}

interface Tokens {
  lead_first: string;
  lead_name: string;
  owner_first: string;
  owner_name: string;
  company: string;
  project: string;
  quotation: string;
  visit_when: string;
}

/** Resend's whole-message ceiling is 40 MB; this stays comfortably inside it. */
const ATTACHMENT_BUDGET = 12 * 1024 * 1024;

export async function runDueFollowUps(limit = 25): Promise<SendReport[]> {
  /* ⚠️ THE ENGINE FIRST. Two clocks — pg_cron every 15 minutes and this route on
     its own timetable — would otherwise make a step wait for both. */
  const rows = (await withAppRole(async (tx) => {
    await tx`select app.crm_advance_sequences()`;
    return tx`select * from app.crm_followups_to_send(${limit})`;
  })) as unknown as QueueRow[];

  if (rows.length === 0) return [];

  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  const apiVersion = process.env.META_API_VERSION?.trim() || 'v26.0';

  const reports: SendReport[] = [];
  for (const row of rows) {
    const report = await sendOne(row, token, apiVersion);
    reports.push(report);
  }
  return reports;
}

async function sendOne(row: QueueRow, token: string | undefined, apiVersion: string): Promise<SendReport> {
  const name = row.lead_name ?? 'this lead';
  const done = async (messageId: string | null, error: string | null, body: string, subject: string | null) => {
    /* ⚠️⚠️ SETTLING IS ITS OWN TRANSACTION, AND IT COMES FIRST. Written as one
       transaction that settled the row and wrote the thread together, and the
       first real send proved why that is wrong: a constraint on the thread row
       rolled back the settle, the message had already gone, the step was still
       `due` — and the next run would have sent the same letter again, every
       fifteen minutes, for ever. Nothing that happens after a message has left
       may un-send it. (190 fixed the constraint; this fixed the shape.) */
    const settled = (await withAppRole((tx) => tx`
      select app.crm_followup_sent(${row.follow_up_id}::uuid, ${messageId}, ${error}) as ok
    `)) as unknown as Array<{ ok: boolean }>;

    /* The thread, only when it went, and only when THIS call settled the row —
       a second runner that lost the race must not write a second message. */
    if (settled[0]?.ok && !error) {
      try {
        await withAppRole((tx) => tx`
          select app.crm_record_sequence_message(
            ${row.follow_up_id}::uuid, ${messageId}, ${body}, ${subject})
        `);
      } catch {
        /* The client has it; the thread does not. Worth neither a retry nor a
           failure on the step — the send is the fact that matters. */
      }
    }
    return {
      followUpId: row.follow_up_id,
      leadName: name,
      channel: row.channel,
      outcome: error ? ('failed' as const) : ('sent' as const),
      detail: error ?? (messageId ?? 'sent'),
    };
  };

  let tokens: Tokens | null = null;
  try {
    const t = (await withAppRole((tx) => tx`
      select * from app.crm_followup_tokens(${row.follow_up_id}::uuid)
    `)) as unknown as Tokens[];
    tokens = t[0] ?? null;
  } catch {
    tokens = null;
  }
  if (!tokens) {
    /* The row stopped being due between the queue and here — another runner, or
       somebody completing it by hand. Nothing to report and nothing to settle. */
    return { followUpId: row.follow_up_id, leadName: name, channel: row.channel, outcome: 'failed', detail: 'no longer due' };
  }

  const values: Record<string, string> = {
    lead_first_name: tokens.lead_first,
    lead_name: tokens.lead_name,
    my_first_name: tokens.owner_first,
    my_name: tokens.owner_name,
    company: tokens.company,
    project: tokens.project,
    quotation_number: tokens.quotation,
    visit_when: tokens.visit_when,
  };
  const body = fillTokens((row.body ?? '').trim(), values);
  const subject = fillTokens((row.subject ?? row.title).trim(), values);

  if (!body) return done(null, 'The step had no message written.', '', null);

  /* ── WhatsApp ──────────────────────────────────────────────────────────── */
  if (row.channel === 'whatsapp') {
    if (!token) return done(null, 'META_SYSTEM_USER_TOKEN is not set, so nothing could be sent.', body, null);
    if (!row.wa_phone_number_id || !row.to_phone) {
      return done(null, 'This project has no WhatsApp number, or the lead has no phone.', body, null);
    }
    const config: WhatsAppConfig = { phoneNumberId: row.wa_phone_number_id, token, apiVersion };

    /* ⚠️ INSIDE THE WINDOW, FREE TEXT. OUTSIDE IT, ONLY AN APPROVED TEMPLATE —
       and `crm_followups_to_send` has already refused the third case, so a step
       with neither never reaches here. */
    const result = row.window_open
      ? await sendText(config, row.to_phone, body)
      : await sendTemplate(config, row.to_phone, {
          name: row.template_name as string,
          language: row.template_language,
          /* ⚠️ NO PARAMETERS. A template with variables needs them in Meta's own
             order and nothing in the plan records that order yet; Meta refuses
             the send and the refusal is written on the step, which is the
             honest outcome until templates carry their variables. */
        });

    return done(result.wamid ?? null, result.ok ? null : (result.error ?? 'WhatsApp refused the message.'), body, null);
  }

  /* ── Email ─────────────────────────────────────────────────────────────── */
  if (row.channel === 'email') {
    if (!row.to_email) return done(null, 'This lead has no email address.', body, subject);

    const files = await attachmentsFor(row.follow_up_id);
    const email = followUpEmail({
      businessName: tokens.company,
      greetingName: tokens.lead_first,
      subject,
      body,
      salespersonName: tokens.owner_name || tokens.company,
      attachments: files,
    });
    const result = await sendLeadEmail({ to: row.to_email, email });
    return done(result.messageId ?? null, result.ok ? null : (result.error ?? 'The email was refused.'), body, subject);
  }

  return done(null, `A ${row.channel} step cannot be sent by the system.`, body, subject);
}

/**
 * The files an email step carries.
 *
 * ⚠️ FAILING TO READ ONE DOES NOT STOP THE MESSAGE. A brochure that could not be
 * fetched is worth less than the letter it was attached to — the letter goes,
 * and the missing file shows in the outcome rather than swallowing the send.
 */
async function attachmentsFor(followUpId: string): Promise<ReadonlyArray<{ filename: string; content: string; contentType: string }>> {
  let rows: Array<{ storage_path: string; mime: string; title: string; size_bytes: string | number }> = [];
  try {
    rows = (await withAppRole((tx) => tx`
      select * from app.crm_followup_attachments(${followUpId}::uuid)
    `)) as unknown as typeof rows;
  } catch {
    return [];
  }

  const out: Array<{ filename: string; content: string; contentType: string }> = [];
  let budget = ATTACHMENT_BUDGET;
  for (const row of rows) {
    const size = Number(row.size_bytes) || 0;
    if (size > budget) continue;
    const file = await downloadObject(row.storage_path);
    if (!file.ok) continue;
    const bytes = Buffer.from(file.value.data);
    budget -= bytes.byteLength;
    out.push({
      filename: fileName(row.title, row.storage_path),
      content: bytes.toString('base64'),
      contentType: row.mime,
    });
  }
  return out;
}

/** A name a client can recognise, keeping the stored file's extension. */
function fileName(title: string, path: string): string {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) || 'attachment';
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}
