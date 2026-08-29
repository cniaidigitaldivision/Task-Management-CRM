'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { audit } from '@/lib/db/queries/audit';
import { withUser } from '@/lib/db/client';
import * as I from '@/lib/db/queries/invoices';
import {
  INVOICE_KIND_META,
  checkInvoice,
  checkInvoiceNo,
  decodeSignature,
  dueDateFor,
  longDate,
  toInvoiceKind,
  totalsFor,
} from '@/lib/domain/invoice';
import { pkr } from '@/lib/domain/money';
import { can } from '@/lib/domain/permissions';
import { invoiceEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { invoicePdf } from '@/lib/pdf/invoice-document';
import { removeObject, uploadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * INVOICING — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"When someone invoices, only super admin and admin can generate an invoice.
 * When I create an invoice, its form should be a very intelligent and very smart
 * form… give me some signature pads where I can draw my signature. That
 * signature will be attached to the PDF of this invoice and will be sent to the
 * email address we have already taken."*
 *
 * ── ⚠️ THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ─────────────────────────
 * Creating:  validate → row + lines + NUMBER (one transaction) → compose the
 *            PDF → store it. Nothing is emailed.
 * Sending:   fetch → compose if missing → email with the PDF attached → record
 *            that it went, and to whom.
 *
 * That split is the owner's own choice — *"issue, preview, then send"* — and it
 * is also the only safe one. An email to a client cannot be recalled, so the
 * act that cannot be undone is a separate, deliberate press.
 *
 * ── ⚠️ WHY THE NUMBER IS CLAIMED BEFORE THE PDF IS DRAWN ───────────────────
 * The PDF prints the number, so it cannot be composed first. Composing it
 * afterwards means a failure there leaves an invoice with no document — which is
 * recoverable (the next preview or send composes it) and is much better than the
 * alternative: claiming a number, failing, and leaving a hole in the series that
 * looks like a deleted invoice to whoever audits it.
 *
 * ── ⚠️ WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
 * No editing. Migration 076 freezes a sent invoice at the database level and
 * there is no action to fight it: a wrong invoice is VOIDED, with a reason, and
 * a corrected one is issued with a new number. That was the owner's choice and
 * it is what keeps the client's copy and the ledger telling the same story.
 * ========================================================================= */

export interface InvoiceResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
  /** Set on a successful create, so the caller can open the preview. */
  readonly invoiceId?: string;
  readonly invoiceNo?: string;
  /** A non-fatal problem worth saying out loud — e.g. the PDF is pending. */
  readonly warning?: string;
}

const fail = (error: string): InvoiceResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** Karachi, like every other date in this product. See `karachi-not-utc`. */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

/* ==========================================================================
 * CREATE
 * ========================================================================== */

/**
 * Read the repeated line fields off the form.
 *
 * The dialogue posts `line-description-0`, `line-quantity-0`, `line-rate-0`,
 * and so on. ⚠️ INDEXED RATHER THAN `getAll`, because a removed line leaves a
 * gap and `getAll` would silently pair the wrong description with the wrong
 * rate — the kind of bug that produces a plausible invoice for the wrong money.
 */
function readLines(form: FormData): Array<{ description: string; quantity: number; unitPricePkr: number }> {
  const lines: Array<{ description: string; quantity: number; unitPricePkr: number }> = [];

  for (let index = 0; index < 100; index += 1) {
    const description = str(form, `line-description-${index}`);
    const rawQuantity = str(form, `line-quantity-${index}`);
    const rawRate = str(form, `line-rate-${index}`);

    /* Nothing posted at this index at all — the form never had this row. */
    if (!description && !rawQuantity && !rawRate) continue;
    /* A row somebody cleared out. Dropped rather than refused. */
    if (!description) continue;

    lines.push({
      description,
      quantity: Number(rawQuantity || '1'),
      unitPricePkr: Number(rawRate || '0'),
    });
  }

  return lines;
}

export async function createInvoiceAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'invoice.issue')) {
    return fail('Only an Admin can issue an invoice.');
  }

  const kind = toInvoiceKind(str(form, 'kind'));
  if (!kind) return fail('Choose what kind of invoice this is.');

  const projectId = str(form, 'projectId') || null;
  const billedToName = str(form, 'billedToName');
  const billedToEmail = str(form, 'billedToEmail');
  const billedToPerson = str(form, 'billedToPerson') || null;
  const billedToAddress = str(form, 'billedToAddress') || null;

  const issuedOn = str(form, 'issuedOn') || today();
  const termsDays = Number(str(form, 'paymentTermsDays') || '10');
  const dueOn = str(form, 'dueOn') || dueDateFor(issuedOn, termsDays);
  /* The accounting month. Defaults to the issue month — accrual accounting
     buckets on this, not on when the money arrives (lib/domain/finance.ts). */
  const earnedOn = str(form, 'earnedOn') || `${issuedOn.slice(0, 7)}-01`;

  const lines = readLines(form);

  /* ⚠️ Tax is OFF unless the box was ticked, matching the owner's choice. A
     posted rate with the box clear must not quietly apply — the checkbox is the
     decision, the number is only its size. */
  const taxOn = str(form, 'taxOn') === 'on';
  const taxRatePct = taxOn ? Number(str(form, 'taxRatePct') || '0') : null;

  /* ⚠️ THE SAME PURE FUNCTION THE DIALOGUE RAN. The client copy stops a
     pointless round trip; this one is the decision. */
  const check = checkInvoice({ billedToName, billedToEmail, lines, issuedOn, dueOn, taxRatePct });
  if (!check.ok) return fail(check.message);

  const override = str(form, 'invoiceNo') || null;
  if (override) {
    const shape = checkInvoiceNo(override);
    if (!shape.ok) return fail(shape.message);
  }

  const totals = totalsFor(lines, taxRatePct);
  const company = await I.companyLetterhead(user.id);
  const signer = await I.signerProfile(user.id);

  /* ── The signature ────────────────────────────────────────────────────────
     Owner chose both: a saved one stamped by default, and the option to draw a
     different one here. A drawn one is stored as its own object so the saved
     signature is not replaced by a one-off. */
  let signaturePath: string | null = signer.signaturePath;
  const drawn = str(form, 'signatureDataUrl');

  if (drawn) {
    const decoded = decodeSignature(drawn);
    if (!decoded.ok) return fail(decoded.message);

    const bytes = Buffer.from(decoded.base64, 'base64');
    /* ⚠️ THE MAGIC NUMBER IS CHECKED, not just the data: prefix. The prefix is
       a claim by the client; these eight bytes are what a PNG actually is. */
    if (!isPng(bytes)) return fail('That signature is not a PNG. Draw it again.');

    const path = `signatures/${user.id}/${crypto.randomUUID()}.png`;
    const stored = await uploadObject({ path, body: bytes, contentType: 'image/png' });
    if (!stored.ok) return fail(`The signature could not be saved: ${stored.message}`);
    signaturePath = path;
  }

  if (str(form, 'useSignature') === 'off') signaturePath = null;

  let created: { id: string; invoiceNo: string };
  try {
    created = await I.createInvoice(
      user.id,
      {
        kind,
        projectId,
        /* ⚠️ `client_name` only when there is no project, because migration
           064's `revenue_has_a_source` needs one or the other and the ledger
           joins on the project when it exists. Setting both would make
           `coalesce(p.name, r.client_name)` silently prefer a stale copy. */
        clientName: projectId ? null : billedToName,
        amountPkr: totals.totalPkr,
        subtotalPkr: totals.subtotalPkr,
        taxRatePct: totals.taxRatePct,
        taxPkr: totals.taxPkr,
        earnedOn,
        issuedOn,
        dueOn,
        billedToName,
        billedToPerson,
        billedToEmail,
        billedToAddress,
        clientNote: str(form, 'clientNote') || null,
        note: str(form, 'note') || null,
        signaturePath,
        signedByName: signer.fullName || user.email,
        signedByTitle: signer.roleTitle,
        lines,
        invoiceNoOverride: override,
      },
      company.invoicePrefix,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/revenue_invoice_no_key|duplicate key/i.test(message)) {
      return fail(`Invoice number ${override ?? ''} is already used. Choose another.`.trim());
    }
    console.error('[invoices] create failed', error);
    return fail('That invoice could not be created. Nothing was saved.');
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'finance',
      entityId: created.id,
      action: 'invoice.issued',
      after: {
        invoiceNo: created.invoiceNo,
        kind,
        billedToName,
        billedToEmail,
        totalPkr: totals.totalPkr,
        taxPkr: totals.taxPkr,
        dueOn,
      },
    }),
  ).catch(() => console.error('[invoices] audit write failed for an issued invoice'));

  /* ── The document, after the number exists ──────────────────────────────── */
  const pdf = await invoicePdf(user.id, created.id);
  /* ⚠️ A FAILED PDF IS NOT A FAILED ACTION. The invoice is real, numbered and in
     the ledger; only its document is missing, and the next preview builds it.
     Rolling the invoice back here would consume a number for nothing and leave
     a gap in the series that looks like a deleted invoice. */
  const warning = pdf.ok
    ? undefined
    : 'The invoice was created, but its PDF could not be drawn yet — open it to try again.';

  revalidatePath('/finance');

  return {
    ok: true,
    invoiceId: created.id,
    invoiceNo: created.invoiceNo,
    message: `Invoice ${created.invoiceNo} for ${pkr(totals.totalPkr)} is ready. Check it, then send it.`,
    warning,
  };
}

/** The eight bytes that make a file a PNG. A `data:` prefix is only a claim. */
function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

/* ==========================================================================
 * SEND
 * ========================================================================== */

export async function sendInvoiceAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'invoice.send')) return fail('Only an Admin can send an invoice.');

  const id = str(form, 'invoiceId');
  if (!id) return fail('No invoice was named.');

  const invoice = await I.getInvoice(user.id, id);
  if (!invoice) return fail('That invoice no longer exists.');

  if (invoice.voidedAt) {
    return fail(`Invoice ${invoice.invoiceNo} was voided and cannot be sent. Issue a new one.`);
  }

  /* An address may be typed here to override the stored one — a client who has
     changed their accounts inbox since the invoice was raised. */
  const to = str(form, 'to') || invoice.billedToEmail || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return fail('There is no valid email address to send this to.');
  }

  const company = await I.companyLetterhead(user.id);

  const pdf = await invoicePdf(user.id, id);
  if (!pdf.ok) return fail(`${pdf.message} Nothing was sent.`);

  const message = invoiceEmail({
    greetingName: invoice.billedToPerson || invoice.billedToName || invoice.sourceName,
    invoiceNo: invoice.invoiceNo,
    amountLabel: pkr(invoice.amountPkr),
    dueDateLabel: longDate(invoice.dueOn),
    issuedDateLabel: longDate(invoice.issuedOn),
    kindLabel: INVOICE_KIND_META[invoice.kind].label,
    forWhat: invoice.lines[0]?.description ?? 'services rendered',
    companyName: company.legalName,
    clientNote: invoice.clientNote,
    replyTo: company.email || null,
    /* ⚠️ Reads the count, not `sentAt`. An invoice sent once and then opened
       again has a `sentAt`; only a SECOND send is a reminder, and telling a
       client "this is a reminder" on their first copy is confusing. */
    isResend: invoice.sendCount > 0,
  });

  const outcome = await sendEmail({
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: [
      ...message.attachments,
      {
        /* Named for the client's filing, not for our bucket. */
        filename: `${invoice.invoiceNo}.pdf`,
        content: Buffer.from(pdf.bytes).toString('base64'),
        /* ⚠️ NO `contentId`. With one, mail clients treat it as inline content
           belonging to the body and hide it from the attachment list — so the
           message would say "attached" with no paperclip. See lib/email/send.ts. */
        contentType: 'application/pdf',
      },
    ],
  });

  if (!outcome.sent) {
    return fail(
      outcome.configured
        ? `The invoice could not be emailed: ${outcome.reason}`
        : 'Email is not configured, so nothing was sent. An Admin needs to set RESEND_API_KEY.',
    );
  }

  await I.markInvoiceSent(user.id, id, to);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'finance',
      entityId: id,
      action: 'invoice.sent',
      after: { invoiceNo: invoice.invoiceNo, to, sendNumber: invoice.sendCount + 1 },
    }),
  ).catch(() => console.error('[invoices] audit write failed for a sent invoice'));

  revalidatePath('/finance');

  return {
    ok: true,
    message:
      invoice.sendCount > 0
        ? `Invoice ${invoice.invoiceNo} was sent again to ${to}.`
        : `Invoice ${invoice.invoiceNo} is on its way to ${to}.`,
  };
}

/* ==========================================================================
 * VOID
 * ========================================================================== */

export async function voidInvoiceAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'invoice.void')) return fail('Only an Admin can void an invoice.');

  const id = str(form, 'invoiceId');
  const reason = str(form, 'reason');

  /* ⚠️ The reason is required HERE as well as by the constraint, so the person
     gets a sentence rather than a Postgres error. Migration 076 is what makes it
     impossible; this is what makes it explicable. */
  if (!reason) {
    return fail('Say why this invoice is being voided. Six months from now it is the only explanation there will be.');
  }
  if (reason.length > 500) return fail('That reason is too long — keep it under 500 characters.');

  const invoice = await I.getInvoice(user.id, id);
  if (!invoice) return fail('That invoice no longer exists.');
  if (invoice.voidedAt) return fail(`Invoice ${invoice.invoiceNo} is already void.`);

  const voided = await I.voidInvoice(user.id, id, reason);
  if (!voided) {
    /* The only way the guarded UPDATE matches nothing while the row exists. */
    return fail(
      `Invoice ${invoice.invoiceNo} has ${pkr(invoice.paidPkr)} recorded against it, so it cannot be voided. Money that arrived is refunded, not un-billed.`,
    );
  }

  /* ⚠️ The stored PDF is REMOVED, not kept. It is the unstamped document, and
     leaving it in the bucket means the next download hands somebody a
     clean-looking copy of an invoice that is no longer valid. The next preview
     composes a VOID-stamped one instead. The client's own copy is untouched,
     which is exactly why the void is recorded rather than pretended away. */
  const files = await I.invoiceFiles(user.id, id);
  if (files?.pdfPath) {
    await removeObject(files.pdfPath).catch(() => undefined);
    await I.setInvoicePdf(user.id, id, null).catch(() => undefined);
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'finance',
      entityId: id,
      action: 'invoice.voided',
      before: { invoiceNo: invoice.invoiceNo, totalPkr: invoice.amountPkr, sentAt: invoice.sentAt },
      reason,
    }),
  ).catch(() => console.error('[invoices] audit write failed for a voided invoice'));

  revalidatePath('/finance');

  return {
    ok: true,
    message: `Invoice ${invoice.invoiceNo} is void. Issue a corrected one — it will take the next number.`,
  };
}

/* ==========================================================================
 * THE SAVED SIGNATURE
 * ========================================================================== */

export async function saveSignatureAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();

  /* ⚠️ NO PERMISSION CHECK, DELIBERATELY, and it is not an oversight. This
     writes the caller's OWN signature and nothing else — `saveSignature` is
     hard-wired to `where id = actorId`. Gating it on `invoice.issue` would mean
     that widening who may sign later needs two changes instead of one, and
     there is nothing here to protect: a person's own signature is theirs. */
  const decoded = decodeSignature(str(form, 'signatureDataUrl'));
  if (!decoded.ok) return fail(decoded.message);

  const bytes = Buffer.from(decoded.base64, 'base64');
  if (!isPng(bytes)) return fail('That signature is not a PNG. Draw it again.');

  const previous = await I.signerProfile(user.id);

  const path = `signatures/${user.id}/${crypto.randomUUID()}.png`;
  const stored = await uploadObject({ path, body: bytes, contentType: 'image/png' });
  if (!stored.ok) return fail(`That signature could not be saved: ${stored.message}`);

  await I.saveSignature(user.id, path);

  /* ⚠️ The old object goes only AFTER the row points at the new one. That
     ordering leaves a brief orphan rather than a signature block with no
     picture — the same trade `uploadAvatar` documents. And only when it is
     genuinely replaced: an invoice already issued still points at its own copy,
     so a path in use by one of those must not be swept up here.

     ⚠️ Which is exactly why a per-invoice drawn signature is stored under its
     own uuid and never overwrites this one. */
  if (previous.signaturePath && previous.signaturePath !== path) {
    const stillUsed = await withUser(user.id, (tx) => tx`
      select 1 from public.revenue_entries
       where signature_path = ${previous.signaturePath} limit 1
    `);
    if ((stillUsed as unknown[]).length === 0) {
      await removeObject(previous.signaturePath).catch(() => undefined);
    }
  }

  revalidatePath('/settings');
  revalidatePath('/finance');

  return { ok: true, message: 'Your signature is saved. It will be stamped on invoices you issue.' };
}

export async function clearSignatureAction(): Promise<InvoiceResult> {
  const user = await requireUser();

  const path = await I.clearSignature(user.id);

  /* Same rule as above: never remove an object an issued invoice still draws. */
  if (path) {
    const stillUsed = await withUser(user.id, (tx) => tx`
      select 1 from public.revenue_entries where signature_path = ${path} limit 1
    `);
    if ((stillUsed as unknown[]).length === 0) {
      await removeObject(path).catch(() => undefined);
    }
  }

  revalidatePath('/settings');
  return { ok: true, message: 'Your signature has been removed. Invoices already issued keep theirs.' };
}

/* ==========================================================================
 * BILLING DETAILS AND THE LETTERHEAD
 * ========================================================================== */

export async function saveBillingProfileAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'invoice.issue')) return fail('Only an Admin can change billing details.');

  const projectId = str(form, 'projectId');
  if (!projectId) return fail('No project was named.');

  const email = str(form, 'billingEmail');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail(`“${email}” is not an email address.`);
  }

  const terms = Number(str(form, 'paymentTermsDays') || '10');
  if (!Number.isInteger(terms) || terms < 0 || terms > 180) {
    return fail('Payment terms have to be a whole number of days between 0 and 180.');
  }

  await I.saveBillingProfile(user.id, projectId, {
    billingName: str(form, 'billingName') || null,
    billingContact: str(form, 'billingContact') || null,
    billingEmail: email || null,
    billingPhone: str(form, 'billingPhone') || null,
    billingAddress: str(form, 'billingAddress') || null,
    paymentTermsDays: terms,
  });

  revalidatePath('/finance');
  revalidatePath('/projects');

  return { ok: true, message: 'Billing details saved. New invoices for this client will use them.' };
}

export async function saveLetterheadAction(
  _prev: InvoiceResult,
  form: FormData,
): Promise<InvoiceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'invoice.issue')) return fail('Only an Admin can change the invoice letterhead.');

  const rate = Number(str(form, 'defaultTaxRatePct') || '16');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return fail('The tax rate has to be between 0 and 100.');
  }

  const prefix = str(form, 'invoicePrefix') || 'CNI';
  if (!/^[A-Za-z0-9-]{1,10}$/.test(prefix)) {
    return fail('The invoice prefix can be up to 10 letters, digits or dashes.');
  }

  const existing = await I.companyLetterhead(user.id);

  await I.saveCompanyLetterhead(user.id, {
    ...existing,
    legalName: str(form, 'legalName') || existing.legalName,
    division: str(form, 'division'),
    /* One address line per line typed. Blank lines are dropped rather than
       printed as a gap in the letterhead. */
    addressLines: str(form, 'addressLines')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    phone: str(form, 'phone'),
    email: str(form, 'email'),
    website: str(form, 'website'),
    ntn: str(form, 'ntn'),
    strn: str(form, 'strn'),
    bankName: str(form, 'bankName'),
    bankTitle: str(form, 'bankTitle'),
    bankAccount: str(form, 'bankAccount'),
    bankIban: str(form, 'bankIban'),
    invoicePrefix: prefix.toUpperCase(),
    defaultTaxRatePct: rate,
    taxLabel: str(form, 'taxLabel') || 'GST',
    footerNote: str(form, 'footerNote'),
  });

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: null,
      action: 'invoice.letterhead_changed',
      after: { legalName: str(form, 'legalName'), invoicePrefix: prefix },
    }),
  ).catch(() => console.error('[invoices] audit write failed for a letterhead change'));

  revalidatePath('/finance');
  revalidatePath('/settings');

  /* ⚠️ Says what it does NOT change, because the natural assumption is wrong:
     an invoice already issued keeps the letterhead it was drawn with. That is
     the point of caching the PDF — see `ensureInvoicePdf`. */
  return {
    ok: true,
    message: 'Letterhead saved. Invoices already issued keep the details they were drawn with.',
  };
}
