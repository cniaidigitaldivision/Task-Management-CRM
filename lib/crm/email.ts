import 'server-only';

import { sendEmail } from '@/lib/email/send';
import { esc, para, type Email } from '@/lib/email/templates';

/* ============================================================================
 * EMAIL TO A LEAD — the second channel
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"You didn't implement the email services… the proposal and
 * the quotation, each time sent by WhatsApp and also auto-sent by email."*
 *
 * ── ⚠️ WHY THIS FILE IS UNDER `lib/crm/` ───────────────────────────────────
 * `16-EXTRACTING-THE-CRM.md` rule 4: CRM code lives under a `crm` name. A lead's
 * quotation email is CRM work and travels with the module; the shell, the
 * paragraph helper and the escaper are the company's and stay in `lib/email/`.
 * Borrowing those three is the same arrangement the CRM already has with
 * `components/ui/*`.
 *
 * ── ⚠️ EMAIL DOES NOT HAVE A 24-HOUR WINDOW, AND THAT IS THE POINT ─────────
 * WhatsApp refuses free text outside it; email never does. So for the 44 leads in
 * the Gulf, the ones who never reply on WhatsApp, and every client who reads mail
 * at a desk, **email is the channel that always works** — which is exactly why
 * the owner noticed it was missing.
 *
 * ── ⚠️ IT DOES NOT USE TASKLY'S EMAIL SHELL, AND THE SCREENSHOT IS WHY ─────
 * Built first on `shell()` from `lib/email/templates`, rendered, and looked at.
 * A quotation from **Chitral Royal Homes** arrived headed *"Taskly · AI &
 * Digital Division"* and footed *"if you were not expecting this you may safely
 * ignore this email"* — our internal tool's branding, and a password-reset
 * footer, on a document carrying a price to somebody else's customer.
 *
 * Every other email this system sends is FROM Taskly TO a colleague. This one is
 * from a CLIENT'S BUSINESS to their customer, which is a different letter
 * entirely. So the shell below is the CRM's own, carries the business name, and
 * borrows only `esc` and `para` — which also means one less thing to unpick when
 * the module is lifted.
 *
 * ⚠️ AND IT IS STILL NOT THE LETTERHEAD THE OWNER ASKED FOR.
 * `crm_project_settings.letterhead_path` exists (171) and is NULL for all 18
 * projects. Until one is uploaded this prints the business NAME in plain type —
 * honest, and visibly not a letterhead, rather than a generated one pretending
 * to be the client's.
 *
 * ── ⚠️ AND IT IS STILL NOT A LICENCE TO SEND ───────────────────────────────
 * No consent column covers email yet, and a quotation is solicited by definition
 * — the client asked for a price. `sendQuotationEmail` is therefore only ever
 * called from an explicit action on a lead that HAS a quotation, never from the
 * sequence scheduler. A marketing email is a different decision and needs asking.
 * ========================================================================= */

export interface QuotationEmailInput {
  /** The client. Already trimmed; may be a company rather than a person. */
  readonly greetingName: string;
  readonly quotationNumber: string;
  readonly version: number;
  /** Already formatted — e.g. `PKR 4,500,000`. The server formats money. */
  readonly amountLabel: string;
  /** Already written out — e.g. `30 Sep 2026`, or null when open-ended. */
  readonly validUntilLabel: string | null;
  /** What is being quoted: a plot with its block, or a service with its scope. */
  readonly itemLabel: string | null;
  readonly itemDetail: string | null;
  /** Whose name signs it off. */
  readonly salespersonName: string;
  readonly businessName: string;
  /** The salesperson's own covering line, or null. */
  readonly note: string | null;
}

/**
 * The quotation, as an email.
 *
 * ⚠️ EVERY FIGURE ARRIVES PRE-FORMATTED. A template that formats money decides
 * what currency and what grouping, in a file nobody looks at, and then two
 * screens disagree with the email about the same price. Same stance as
 * `invoiceEmail`.
 */
export function quotationEmail(input: QuotationEmailInput): Email {
  const title = `Quotation ${input.quotationNumber}`;
  const versionNote = input.version > 1 ? ` (version ${input.version})` : '';

  const body = `
    <h1 style="margin:0 0 16px 0;font:700 21px/1.3 'Segoe UI',system-ui,sans-serif;color:#12222a;">
      ${esc(title)}${esc(versionNote)}
    </h1>
    ${para(`Dear ${esc(input.greetingName)},`)}
    ${para(
      input.note
        ? esc(input.note)
        : `Thank you for your interest. Please find our quotation below.`,
    )}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin:18px 0 20px 0;border:1px solid #f2ddb4;border-radius:7px;background:#f8edd9;">
      <tr><td style="padding:14px 18px;">
        ${
          input.itemLabel
            ? `<p style="margin:0 0 6px 0;font:600 15px/1.4 'Segoe UI',system-ui,sans-serif;color:#12222a;">${esc(input.itemLabel)}</p>`
            : ''
        }
        ${
          input.itemDetail
            ? `<p style="margin:0 0 10px 0;font:400 13px/1.5 'Segoe UI',system-ui,sans-serif;color:#5b6f77;">${esc(input.itemDetail)}</p>`
            : ''
        }
        <p style="margin:0;font:700 22px/1.15 'Segoe UI',system-ui,sans-serif;color:#0e5c63;">
          ${esc(input.amountLabel)}
        </p>
        ${
          /* ⚠️ THE VALIDITY LINE IS ABSENT WHEN THERE IS NO DATE, never "valid
             until —". A quotation with no stated expiry is open, and printing a
             dash invites the client to ask what it means. */
          input.validUntilLabel
            ? `<p style="margin:8px 0 0 0;font:400 13px/1.5 'Segoe UI',system-ui,sans-serif;color:#5b6f77;">Valid until ${esc(input.validUntilLabel)}</p>`
            : ''
        }
      </td></tr>
    </table>

    ${para(`Please let me know if you would like to discuss anything on it.`)}
    ${para(`${esc(input.salespersonName)}<br>${esc(input.businessName)}`)}
  `;

  return {
    subject: `${title}${versionNote} — ${input.businessName}`,
    html: crmShell(body, `${title} — ${input.amountLabel}`, input.businessName),
    /* ⚠️ ALWAYS A PLAIN-TEXT ALTERNATIVE. `sendEmail` documents why: a message
       without one scores worse with spam filters, and a quotation landing in
       junk is indistinguishable from one never sent. */
    text: [
      `${title}${versionNote}`,
      '',
      `Dear ${input.greetingName},`,
      '',
      input.note ?? 'Thank you for your interest. Please find our quotation below.',
      '',
      ...(input.itemLabel ? [input.itemLabel] : []),
      ...(input.itemDetail ? [input.itemDetail] : []),
      input.amountLabel,
      ...(input.validUntilLabel ? [`Valid until ${input.validUntilLabel}`] : []),
      '',
      'Please let me know if you would like to discuss anything on it.',
      '',
      input.salespersonName,
      input.businessName,
    ].join('\n'),
    /* ⚠️ NO ATTACHMENTS, AND THAT IS DELIBERATE. Taskly's shell inlines its own
       mark by content id; this letter carries no logo at all until the project's
       real letterhead is uploaded. An empty header beats the wrong company's. */
    attachments: [],
  };
}

/* ============================================================================
 * THE CRM'S OWN SHELL
 * ----------------------------------------------------------------------------
 * Deliberately plain: a rule, a name, the letter, a quiet footer. ⚠️ Tables and
 * inline styles rather than anything modern, because this is read in Outlook and
 * in Gmail's clipped view, not in a browser.
 * ========================================================================= */
const SANS = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function crmShell(body: string, preheader: string, businessName: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(businessName)}</title></head>
<body style="margin:0;padding:0;background:#f1f4f4;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f4f4;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="620" style="width:620px;max-width:100%;background:#ffffff;border:1px solid #e3e9e9;border-radius:8px;">
        <!-- ⚠️ THE BUSINESS, NOT TASKLY. The client never heard of our tool. -->
        <tr><td style="padding:22px 30px 0 30px;border-bottom:2px solid #0e5c63;">
          <p style="margin:0 0 14px 0;font:700 17px/1.3 ${SANS};color:#0e5c63;letter-spacing:.01em;">
            ${esc(businessName)}
          </p>
        </td></tr>
        <tr><td style="padding:26px 30px 28px 30px;">${body}</td></tr>
      </table>
      <p style="margin:14px 0 0 0;font:400 12px/1.5 ${SANS};color:#7b8b8f;">
        ${esc(businessName)}
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface LeadEmailResult {
  readonly ok: boolean;
  /** Resend's own id. ⚠️ Kept so "they say they never got it" has an answer. */
  readonly messageId?: string;
  readonly error?: string;
}

/**
 * Send it, and hand back what the caller must record.
 *
 * ⚠️ THIS DOES NOT WRITE TO THE DATABASE. The row belongs in `crm_lead_messages`
 * under the CALLER's session, so RLS decides whether they may write to that
 * lead — and this module has no session. A helper that wrote the thread itself
 * would need a definer, and a definer here would let any caller append to any
 * lead's conversation.
 */
export async function sendLeadEmail(input: {
  to: string;
  email: Email;
}): Promise<LeadEmailResult> {
  /* ⚠️ `sendEmail` RETURNS ITS FAILURE, IT DOES NOT THROW. Written first as a
     try/catch around it, which would have reported every failed send as a
     success — the mailer returns `{ sent: false, reason }` for a missing API
     key, a rejected address or a provider error, and none of those raise. The
     thread would then have carried "sent" against an email nobody received,
     which is the worst shape this bug could take: a salesperson believing the
     client has the price. */
  let result;
  try {
    result = await sendEmail({
      to: input.to,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
      attachments: input.email.attachments,
    });
  } catch (err) {
    /* Only a genuine throw lands here — a network fault, not a refusal. ⚠️ And
       the message is whatever actually failed, never a guessed cause. */
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'The email could not be sent.',
    };
  }

  if (!result.sent) {
    return {
      ok: false,
      /* ⚠️ "Not configured" and "the provider refused" are different faults with
         different owners, and they must not share a sentence — the same lesson
         the WhatsApp refusals learned on 2026-09-14. */
      error: result.configured
        ? result.reason
        : 'Email is not configured in this environment — no RESEND_API_KEY.',
    };
  }

  return { ok: true, messageId: result.id || undefined };
}
