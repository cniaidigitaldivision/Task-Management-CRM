'use server';

/* ============================================================================
 * EMAIL FROM THE DRAWER — the composer's own actions
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"Make this email work. Right now email is not working…
 * email should be sender and the email template should be equal to the
 * login-purpose professional email template… make sure that there is a proper
 * email setup, like a subject and body, and we can select media also."*
 *
 * It was not working because it was never written: the composer's Send called a
 * function whose whole body was a toast saying *"email replies are not wired
 * yet"*. This is the wiring.
 *
 * ⚠️ THE SUBJECT AND BODY ARE THE PERSON'S; EVERYTHING ELSE IS THE SERVER'S.
 * Who it is from, which business it is headed with, which address a reply reaches
 * and who it is going to are all read from the lead under RLS. A composer that
 * posted its own "from" could put one client's business on another's letter.
 *
 * ⚠️ AND IT IS RECORDED ONLY ONCE IT HAS GONE. `crmRecordSentEmail` runs after
 * the provider accepts it — a row written first shows the client as told about a
 * price they never received, and the salesperson stops chasing.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { followUpEmail, fromAddress, sendLeadEmail } from '@/lib/crm/email';
import { crmLeadEmailContext, crmRecordSentEmail, type LeadEmailContext } from '@/lib/db/queries/crm-leads';
import { describeSender } from '@/lib/email/send';
import { displayPhone } from '@/lib/domain/phone';
import { downloadObject, removeObject, signedUploadUrl } from '@/lib/storage/bucket';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resend accepts 40 MB in total; this leaves room for the letter itself. */
const ATTACHMENT_MAX = 10 * 1024 * 1024;
const TOTAL_MAX = 20 * 1024 * 1024;
const MAX_FILES = 5;

export interface EmailComposerContext {
  readonly ok: boolean;
  readonly error?: string;
  /** The client's address, or null when the lead has none on record. */
  readonly to?: string | null;
  readonly toName?: string | null;
  /** The address this environment actually sends from. */
  readonly from?: string | null;
  readonly fromName?: string | null;
  readonly businessName?: string | null;
  /** A subject to start from: a reply to the last one, or the business's name. */
  readonly suggestedSubject?: string;
  /**
   * True while mail can only reach the Resend account's own address.
   *
   * ⚠️ SAID BEFORE SOMEBODY WRITES, not after the provider refuses. The sandbox
   * sender (`onboarding@resend.dev`) delivers to one address and refuses every
   * other with a 403 — discovering that at the end of a carefully written email
   * to a client is the worst moment to find out.
   */
  readonly sandbox?: boolean;
}

/**
 * What the composer shows before anybody types.
 *
 * ⚠️ IT NAMES THE MISSING PIECE RATHER THAN DISABLING SILENTLY. "No email
 * address on this lead" is an ordinary state — 640 of 641 leads arrived from a
 * Meta form that never asked for one — and the composer says so with the fix
 * beside it, rather than a dead Send button.
 */
export async function emailComposerContextAction(leadId: string): Promise<EmailComposerContext> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };

  const context = await crmLeadEmailContext(user.id, leadId);
  if (!context) return { ok: false, error: 'That lead could not be found.' };

  const mailer = describeSender();
  return {
    ok: true,
    to: context.to,
    toName: context.leadName,
    from: mailer.configured ? fromAddress() : null,
    fromName: user.fullName,
    businessName: context.businessName,
    suggestedSubject: suggestSubject(context),
    sandbox: mailer.configured && mailer.sandbox,
  };
}

/**
 * "Re: …" when there is a thread, the business's own line when there is not.
 *
 * ⚠️ NEVER "Re: Re: …". A client whose subject line grows a prefix every time is
 * reading a machine, not a salesperson.
 */
function suggestSubject(context: LeadEmailContext): string {
  const last = (context.lastSubject ?? '').trim();
  if (last) return /^re:/i.test(last) ? last : `Re: ${last}`;
  return context.businessName ? `${context.businessName} — following up` : 'Following up';
}

export interface EmailUploadSlot {
  readonly ok: boolean;
  readonly path?: string;
  readonly url?: string;
  readonly error?: string;
}

/**
 * Where an attachment goes before it is attached.
 *
 * ⚠️ THE BROWSER UPLOADS IT, NOT THIS SERVER — a server action refuses a body
 * over 4.5 MB, and a site plan passes that easily. The path is ours and always
 * begins with the lead's own folder, so a signed URL cannot be talked into
 * writing anywhere else.
 */
export async function prepareEmailAttachmentAction(
  leadId: string,
  filename: string,
  size: number,
): Promise<EmailUploadSlot> {
  await requireCrmAccess();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file looks empty.' };
  if (size > ATTACHMENT_MAX) return { ok: false, error: 'An attachment must be under 10 MB.' };

  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'attachment';
  const path = `crm-email/${leadId}/${crypto.randomUUID()}/${safe}`;
  const signed = await signedUploadUrl(path);
  if (!signed.ok) return { ok: false, error: signed.message };
  return { ok: true, path, url: signed.value };
}

export interface SendEmailResult {
  readonly ok: boolean;
  readonly error?: string;
  /** True when it went but could not be added to the conversation. */
  readonly unrecorded?: boolean;
}

export async function sendLeadEmailAction(input: {
  leadId: string;
  subject: string;
  body: string;
  attachments: ReadonlyArray<{ path: string; filename: string; mime: string }>;
}): Promise<SendEmailResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return { ok: false, error: 'Give the email a subject — an email without one is usually not opened.' };
  if (subject.length > 200) return { ok: false, error: 'Keep the subject under 200 characters.' };
  if (!body) return { ok: false, error: 'Write something in the email.' };
  if (body.length > 20_000) return { ok: false, error: 'That email is longer than 20,000 characters.' };
  if (input.attachments.length > MAX_FILES) {
    return { ok: false, error: `Attach at most ${MAX_FILES} files. Anything more belongs in a shared folder.` };
  }

  const context = await crmLeadEmailContext(user.id, input.leadId);
  if (!context) return { ok: false, error: 'That lead could not be found.' };
  const to = (context.to ?? '').trim();
  if (!to) {
    return {
      ok: false,
      error: `${context.leadName ?? 'This lead'} has no email address on record. Add one on the Overview tab and it can go by email.`,
    };
  }

  /* ⚠️ THE FILES ARE READ BACK FROM THE BUCKET, and only from this lead's own
     folder. The page sends a path; without the prefix check that path could name
     any object in the bucket, and the email would carry it to a client. */
  const files: Array<{ filename: string; content: string; contentType: string }> = [];
  let total = 0;
  for (const attachment of input.attachments) {
    if (!attachment.path.startsWith(`crm-email/${input.leadId}/`)) {
      return { ok: false, error: 'One of those files was not uploaded for this lead.' };
    }
    const file = await downloadObject(attachment.path);
    if (!file.ok) return { ok: false, error: file.message ?? 'An attachment could not be read back.' };
    total += file.value.data.byteLength;
    if (total > TOTAL_MAX) {
      return { ok: false, error: 'Those attachments come to more than 20 MB altogether — send fewer, or a link.' };
    }
    files.push({
      filename: attachment.filename.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'attachment',
      content: file.value.data.toString('base64'),
      contentType: attachment.mime || file.value.contentType,
    });
  }

  const email = followUpEmail({
    from: {
      /* ⚠️ THE CLIENT'S BUSINESS, read through the definer — see
         `crmLeadEmailContext`. Never the name the browser sent. */
      businessName: context.businessName ?? 'Our team',
      subtitle: context.subtitle,
      salespersonName: user.fullName,
      replyTo: fromAddress(),
      phone: context.phone ? displayPhone(context.phone) : null,
    },
    subject,
    body,
    attachments: files,
  });

  /* ⚠️ AND IT GOES OUT UNDER THE BUSINESS'S NAME, not Taskly's — the inbox line
     is the first thing the client reads. The mailbox stays the verified one. */
  const sent = await sendLeadEmail({
    to,
    email,
    as: { businessName: context.businessName, replyTo: user.email ?? null },
  });
  if (!sent.ok) return { ok: false, error: sent.error ?? 'The email could not be sent.' };

  /* ⚠️ THE THREAD KEEPS WHAT WAS WRITTEN, not the rendered HTML. The drawer shows
     the body as a message; a table-based letter pasted into a chat bubble is
     unreadable, and the HTML is reproducible from the text anyway. */
  const recorded = await crmRecordSentEmail(user.id, {
    leadId: input.leadId,
    subject,
    body: files.length > 0 ? `${body}\n\n(${files.length} attachment${files.length === 1 ? '' : 's'})` : body,
    messageId: sent.messageId ?? null,
  });

  revalidatePath('/my-leads');
  revalidatePath(`/leads/${input.leadId}`);

  /* ⚠️ A FAILURE TO RECORD IS NOT A FAILURE TO SEND. The client has it; saying
     otherwise would have somebody send it twice. */
  return recorded ? { ok: true } : { ok: true, unrecorded: true };
}

/** An attachment the person removed before sending does not stay in the bucket. */
export async function discardEmailAttachmentAction(leadId: string, path: string): Promise<{ ok: boolean }> {
  await requireCrmAccess();
  if (!UUID.test(leadId) || !path.startsWith(`crm-email/${leadId}/`)) return { ok: false };
  const gone = await removeObject(path);
  return { ok: gone.ok };
}
