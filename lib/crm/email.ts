import 'server-only';

import { describeSender, fromAs, fromMailbox, sendEmail } from '@/lib/email/send';
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

/**
 * Who the letter is from, as the client reads it.
 *
 * ⚠️ THE BUSINESS, THE PERSON, AND A WAY TO REPLY. Owner, 2026-09-18: *"email
 * should be sender and the email template should be equal to or the same as the
 * login-purpose professional email template."* The login shell's footer says
 * *"if you were not expecting this, you may safely ignore this email"* — a
 * password-reset line that makes no sense on a quotation somebody asked for. So
 * this letter keeps the STRUCTURE of that template and fills its footer with the
 * one thing a client actually wants there: who wrote to them, and how to answer.
 */
export interface LetterFrom {
  readonly businessName: string;
  /** The project or city under the name — the login shell's division line. */
  readonly subtitle: string | null;
  readonly salespersonName: string;
  /** The address a reply reaches. Null when the mailer is not configured. */
  readonly replyTo: string | null;
  /** The business's WhatsApp number, if the project has one (179). */
  readonly phone: string | null;
}

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
  /** Who it is from, as the client reads it. */
  readonly from: LetterFrom;
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
  `;

  return {
    subject: `${title}${versionNote} — ${input.from.businessName}`,
    /* ⚠️ THE SIGN-OFF IS THE SHELL'S FOOTER, NOT THE LETTER'S LAST LINE. It
       prints the salesperson, the business and a way to reply; repeating the
       name here as well reads as a template arguing with itself. */
    html: crmShell(body, `${title} — ${input.amountLabel}`, input.from),
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
      input.from.salespersonName,
      input.from.businessName,
    ].join('\n'),
    /* ⚠️ NO ATTACHMENTS, AND THAT IS DELIBERATE. Taskly's shell inlines its own
       mark by content id; this letter carries no logo at all until the project's
       real letterhead is uploaded. An empty header beats the wrong company's. */
    attachments: [],
  };
}

/* ============================================================================
 * THE CRM'S OWN SHELL — the login template's frame, the business's identity
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"the email template should be equal to or the same as the
 * login-purpose professional email template."*
 *
 * So this is `shell()` from `lib/email/templates.ts`, part for part: the dark
 * header band with the name and a letterspaced line under it, the gold rule at
 * full bleed, the body at 15px/1.62 in 46px of side padding, a footer band
 * INSIDE the card, and a quiet line outside it.
 *
 * ⚠️ WHAT IT DOES NOT BORROW IS THE IDENTITY. Taskly's mark, wordmark, division
 * line and "you may safely ignore this email" belong on a letter from our tool to
 * a colleague. This one goes from a CLIENT'S BUSINESS to their customer — a
 * quotation from Chitral Royal Homes headed *"Taskly · AI & Digital Division"*
 * with a password-reset footer is what the first version of this file did, and it
 * is why the two shells are separate. The header carries the business name; the
 * footer carries the salesperson and a way to reply.
 *
 * ⚠️ AND THE MARK IS TEXT, NOT A PICTURE. `crm_project_settings.letterhead_path`
 * (171) is still NULL for all 18 projects, so there is no image that belongs to
 * the business. The login shell's mark is attached by content id and a client can
 * still fail to render it — which is why the product name is text there too. An
 * empty header beats the wrong company's logo.
 *
 * ⚠️ TABLES AND INLINE HEX, NO `var()`. Read in Outlook's Word renderer and
 * Gmail's clipped view, not in a browser — the same reason the login shell is
 * written this way, and the one place BR-025 is deliberately broken.
 * ========================================================================= */

const SANS = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
/* The same values as the login template's palette, because it is the same design. */
const BAND = '#0e2a2c';
const BAND_HEADING = '#ffffff';
const BAND_MUTED = '#9fb6b8';
const GOLD = '#d4a63c';
const BODY_INK = '#3f5157';
const MUTED = '#5b6f77';
const BORDER = '#dde7e8';
const PAGE = '#eef3f3';
const FOOT_BG = '#eef3f3';

function crmShell(body: string, preheader: string, from: LetterFrom): string {
  const subtitle = from.subtitle
    ? `<div style="margin-top:5px;font:400 12px/1.2 ${SANS};color:${BAND_MUTED};letter-spacing:.13em;text-transform:uppercase;">${esc(from.subtitle)}</div>`
    : '';

  /* ⚠️ THE FOOTER NAMES ONLY WHAT IS KNOWN. A "reply to" line with no address
     under it, or a phone row with no number, reads as a broken template. */
  const contact = [
    from.replyTo ? `<a href="mailto:${esc(from.replyTo)}" style="color:#1155cc;text-decoration:none;">${esc(from.replyTo)}</a>` : null,
    from.phone ? esc(from.phone) : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(from.businessName)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-font-smoothing:antialiased;">
  <!-- The inbox preview line: the first thing anybody reads, so it says
       something useful rather than repeating the subject. The zero-width run
       after it stops Gmail pulling the opening sentence in behind it. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <div style="display:none;max-height:0;overflow:hidden;">&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">

        <tr><td bgcolor="${BAND}" style="background:${BAND};padding:22px 34px;">
          <div style="font:700 24px/1.1 ${SANS};color:${BAND_HEADING};letter-spacing:-.01em;">${esc(from.businessName)}</div>
          ${subtitle}
        </td></tr>

        <tr><td bgcolor="${GOLD}" style="background:${GOLD};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:26px 46px 34px 46px;font:400 15px/1.62 ${SANS};color:${BODY_INK};">
          ${body}
        </td></tr>

        <tr><td bgcolor="${FOOT_BG}" style="background:${FOOT_BG};padding:18px 46px;border-top:1px solid ${BORDER};">
          <p style="margin:0;font:600 13px/1.5 ${SANS};color:${BODY_INK};">${esc(from.salespersonName)}</p>
          <p style="margin:2px 0 0 0;font:400 12px/1.5 ${SANS};color:${MUTED};">${esc(from.businessName)}</p>
          ${contact ? `<p style="margin:6px 0 0 0;font:400 12px/1.5 ${SANS};color:${MUTED};">${contact}</p>` : ''}
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;">
        <tr><td align="center" style="padding:16px 8px 0 8px;font:400 11px/1.5 ${SANS};color:${MUTED};">
          ${esc(from.businessName)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * The address a client's reply actually reaches.
 *
 * ⚠️ READ OFF THE MAILER, NEVER TYPED INTO A TEMPLATE. `describeSender` reports
 * what this environment is configured with; a footer printing an address that
 * bounces is worse than no footer at all.
 */
export function fromAddress(): string | null {
  return describeSender().configured ? fromMailbox() : null;
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
  /**
   * The business the client should see it from, and where a reply goes.
   *
   * ⚠️ THE INBOX LINE IS THE LETTERHEAD NOBODY READS PAST. Without this the
   * envelope says "Taskly" — our internal tool — on a quotation to somebody
   * else's customer, however carefully the letter inside is branded. The mailbox
   * stays the verified one; only the name in front of it changes (`fromAs`).
   */
  as?: { readonly businessName: string | null; readonly replyTo: string | null };
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
      ...(input.as?.businessName ? { from: fromAs(input.as.businessName) ?? undefined } : {}),
      ...(input.as?.replyTo ? { replyTo: input.as.replyTo } : {}),
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

/* ============================================================================
 * A FOLLOW-UP LETTER — the same shell, carrying whatever the plan wrote
 * ----------------------------------------------------------------------------
 * ⚠️ IT ADDS NOTHING OF ITS OWN. No "just checking in", no signature the
 * salesperson did not write, no offer. The body is what somebody typed into the
 * plan and reviewed on screen; this only wraps it so it arrives looking like the
 * business rather than like a form.
 *
 * ⚠️ AND IT WRITES NO GREETING EITHER. This took a `greetingName` it never used
 * — the body always carries its own "Assalam-o-Alaikum {{lead_first}}", whether a
 * plan filled the token or a person typed the line. Adding one here would have
 * put a second greeting above the one already written.
 *
 * ⚠️ AND IT KEEPS THE LINE BREAKS. A message written in a textarea and sent as
 * HTML with its newlines collapsed reads as one long paragraph — the commonest
 * way an email looks careless without anybody being able to say why.
 * ========================================================================= */
export function followUpEmail(input: {
  from: LetterFrom;
  subject: string;
  /** Plain text, as written. Escaped here; newlines become paragraphs. */
  body: string;
  /* ⚠️ `contentId` STAYS UNSET. These are documents the client downloads, not
     images the letter references — one given a content id is hidden from the
     attachment list by mail clients, so the email says "attached" and shows
     nothing (`lib/email/send.ts` carries the full account of that bug). */
  attachments?: ReadonlyArray<{ filename: string; content: string; contentType: string }>;
}): Email {
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((block) => para(esc(block).replace(/\n/g, '<br>')))
    .join('\n');

  return {
    subject: input.subject,
    html: crmShell(html, paragraphs[0]?.slice(0, 120) ?? input.subject, input.from),
    text: [...paragraphs, '', input.from.salespersonName, input.from.businessName].join('\n\n'),
    attachments: input.attachments ?? [],
  };
}
