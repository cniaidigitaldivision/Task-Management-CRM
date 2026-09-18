'use server';

/* ============================================================================
 * RELATED ITEMS — what the dialog reads and writes
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, with five designs: *"when I click on Quotation, its preview
 * should also display… and let me upload any quotation here also."*
 *
 * ⚠️ EVERY WRITE IS THE PERSON'S. `withUser` inside the queries, so RLS decides
 * whose lead it is — and the two money rules (194, 195) are triggers, so a form
 * that forgot to hide a button still cannot move a figure Finance has not seen.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { describeSender } from '@/lib/email/send';
import {
  addPlotsFromSheet,
  attachBookingReceipt,
  attachInvoicePdf,
  attachInvoiceReceipt,
  attachQuotationPdf,
  confirmBooking,
  createBooking,
  createInvoice,
  createQuotationFromPdf,
  markInvoiceSent,
  readLeadRelatedItems,
  readPlotContext,
  recordInvoicePayment,
  requestBookingVerification,
  requestFromManager,
  rescheduleAppointment,
  type RelatedItems,
  type RelatedWrite,
} from '@/lib/db/queries/crm-related';
import { withUser } from '@/lib/db/client';
import { downloadObject, removeObject, signedUploadUrl, signedUrl } from '@/lib/storage/bucket';
import { readPdfLines } from '@/lib/crm/pdf-text';
import { extractQuotationFacts, missingFrom, readPdfText, type QuotationFacts } from '@/lib/crm/quotation-pdf';
import { parsePropertySheet, sheetProblem, type ParsedPlot } from '@/lib/domain/crm-property-sheet';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PKR, and nobody's booking is a hundred billion. */
const MAX_MONEY = 100_000_000_000;

function settle(result: RelatedWrite, leadId: string): RelatedWrite {
  if (result.ok) {
    revalidatePath('/my-leads');
    revalidatePath(`/leads/${leadId}`);
  }
  return result;
}

function money(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return null;
  return Math.round(n * 100) / 100;
}

/** The records, plus the address a client's email comes from — the preview prints it. */
export type RelatedBundle = RelatedItems & { readonly senderEmail: string | null };

export async function relatedItemsAction(leadId: string): Promise<RelatedBundle | null> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId)) return null;
  const items = await readLeadRelatedItems(user.id, leadId);
  /* ⚠️ THE REAL SENDING ADDRESS, never a placeholder. The owner's design prints
     one under the quotation; a made-up "sales@" would be the first thing a client
     replied to. */
  const from = describeSender();
  const match = /<([^>]+)>/.exec(from.from) ?? /([^\s<>]+@[^\s<>]+)/.exec(from.from);
  return { ...items, senderEmail: from.configured && match ? match[1] : null };
}

export async function createBookingAction(input: {
  leadId: string;
  quotationId: string | null;
  propertyId: string | null;
  amount: number;
  notes: string;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  const amount = money(input.amount);
  if (amount === null || amount <= 0) return { ok: false, error: 'Enter the booking amount.' };
  const notes = input.notes.trim().slice(0, 2000);
  return settle(
    await createBooking(user.id, {
      leadId: input.leadId,
      quotationId: input.quotationId && UUID.test(input.quotationId) ? input.quotationId : null,
      propertyId: input.propertyId && UUID.test(input.propertyId) ? input.propertyId : null,
      amount,
      notes: notes || null,
    }),
    input.leadId,
  );
}

export async function requestBookingVerificationAction(leadId: string, bookingId: string): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(bookingId)) return { ok: false, error: 'That booking could not be found.' };
  return settle(await requestBookingVerification(user.id, bookingId), leadId);
}

/** ⚠️ Finance only — the refusal comes from the database, not from this file. */
export async function confirmBookingAction(leadId: string, bookingId: string, verifiedAmount: number): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(bookingId)) return { ok: false, error: 'That booking could not be found.' };
  const amount = money(verifiedAmount);
  if (amount === null) return { ok: false, error: 'Enter the amount that was received.' };
  return settle(await confirmBooking(user.id, bookingId, amount), leadId);
}

export async function createInvoiceAction(input: {
  leadId: string;
  bookingId: string | null;
  description: string;
  amount: number;
  dueAt: string | null;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  const description = input.description.trim();
  if (!description) return { ok: false, error: 'Say what the invoice is for.' };
  const amount = money(input.amount);
  if (amount === null || amount <= 0) return { ok: false, error: 'Enter the amount.' };
  /* A date, or nothing — never a date that is not one. */
  const dueAt = input.dueAt && /^\d{4}-\d{2}-\d{2}$/.test(input.dueAt) ? input.dueAt : null;
  return settle(
    await createInvoice(user.id, {
      leadId: input.leadId,
      bookingId: input.bookingId && UUID.test(input.bookingId) ? input.bookingId : null,
      description: description.slice(0, 200),
      amount,
      dueAt,
    }),
    input.leadId,
  );
}

/** ⚠️ Finance only — 195's trigger. */
export async function recordInvoicePaymentAction(leadId: string, invoiceId: string, paidAmount: number): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(invoiceId)) return { ok: false, error: 'That invoice could not be found.' };
  const amount = money(paidAmount);
  if (amount === null) return { ok: false, error: 'Enter the amount received.' };
  return settle(await recordInvoicePayment(user.id, invoiceId, amount), leadId);
}

/* ── Uploading a quotation PDF ───────────────────────────────────────────── */

const PDF_MAX = 25 * 1024 * 1024;

export interface UploadSlot {
  readonly ok: boolean;
  readonly path?: string;
  readonly url?: string;
  readonly error?: string;
}

/**
 * Where to put the file.
 *
 * ⚠️ THE BROWSER UPLOADS IT, NOT THIS SERVER. A Vercel function refuses a body
 * over 4.5 MB and a quotation with a site plan in it passes that easily — the
 * same reason the chat's attachments go straight to Storage.
 *
 * ⚠️ AND THE PATH IS OURS, NOT THE CALLER'S. It always begins with the lead's
 * own folder, so a signed URL cannot be talked into writing somewhere else.
 */
export async function prepareQuotationPdfAction(leadId: string, filename: string, size: number): Promise<UploadSlot> {
  await requireCrmAccess();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file looks empty.' };
  if (size > PDF_MAX) return { ok: false, error: 'A quotation PDF must be under 25 MB.' };

  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'quotation.pdf';
  const path = `crm-quotations/${leadId}/${crypto.randomUUID()}/${safe}`;
  const signed = await signedUploadUrl(path);
  if (!signed.ok) return { ok: false, error: signed.message };
  return { ok: true, path, url: signed.value };
}

export async function attachQuotationPdfAction(input: {
  leadId: string;
  quotationId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.quotationId)) return { ok: false, error: 'That quotation could not be found.' };
  /* ⚠️ The path must be the one we handed out, under this lead's own folder. */
  if (!input.path.startsWith(`crm-quotations/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }
  return settle(
    await attachQuotationPdf(user.id, {
      quotationId: input.quotationId,
      path: input.path,
      title: input.title.trim().slice(0, 140) || 'Quotation',
      mime: input.mime || 'application/pdf',
      sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
    }),
    input.leadId,
  );
}

/* ── A quotation that arrives as a PDF ────────────────────────────────────────
 * Owner, 2026-09-17: *"that PDF will be automatically selected and we just put
 * the name of that PDF… read that PDF and get the quotation name… read the
 * property, Marla, block, or any property of the quotation which is mentioned in
 * that file. Read that plus its amount. If you don't get these things from the
 * quotation, you will show a message that the PDF is not showing this
 * information. You can't add them to an available quotation."*
 * ========================================================================= */

export interface PdfReading {
  readonly ok: boolean;
  /** Why it cannot be added — shown to the person, in their words. */
  readonly error?: string;
  readonly number?: string;
  readonly amount?: number;
  readonly unitHint?: string;
  readonly validUntil?: string | null;
}

/** "5 Marla · Block A · Plot A-101", from whatever the file actually said. */
function unitHintOf(facts: QuotationFacts): string {
  return [
    facts.marla !== null ? `${facts.marla} Marla` : null,
    facts.block ? `Block ${facts.block}` : null,
    facts.plot ? `Plot ${facts.plot}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Read the PDF the browser has just put in the bucket.
 *
 * ⚠️ THE SERVER READS IT, NOT THE BROWSER. The three facts end up on a client's
 * record; taking them from the page would mean trusting whatever the page chose
 * to send, and a quotation amount is not something to take on trust.
 *
 * ⚠️ AND A REFUSAL IS SPECIFIC. "The PDF is not showing this information" with
 * the missing fields named, so somebody knows whether to fix the document or
 * pick a different file. A scan gets its own sentence — no text layer at all is
 * a different problem from a quotation that omits its number.
 */
async function readUploadedQuotation(path: string): Promise<{ facts: QuotationFacts } | { error: string }> {
  const file = await downloadObject(path);
  if (!file.ok) return { error: file.message ?? 'That file could not be read back.' };

  let text: string;
  try {
    text = await readPdfText(new Uint8Array(file.value.data));
  } catch {
    return { error: 'That file could not be opened as a PDF. Please upload the quotation as a PDF.' };
  }

  const facts = extractQuotationFacts(text);
  if (facts.textLength < 20) {
    return {
      error:
        'This PDF has no readable text — it looks like a scan or a photograph. Upload the original PDF so the quotation number, property and amount can be read from it.',
    };
  }

  const missing = missingFrom(facts);
  if (missing.length > 0) {
    return {
      error: `This PDF is not showing ${missing.join(', ')}. It cannot be added to the available quotations until the document carries the quotation number, the property and the amount.`,
    };
  }
  return { facts };
}

/** What the picker shows before anybody presses Add. */
export async function readQuotationPdfAction(leadId: string, path: string): Promise<PdfReading> {
  await requireCrmAccess();
  if (!path.startsWith(`crm-quotations/${leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }
  const read = await readUploadedQuotation(path);
  if ('error' in read) return { ok: false, error: read.error };
  const { facts } = read;
  return {
    ok: true,
    number: facts.number ?? undefined,
    amount: facts.amount ?? undefined,
    unitHint: unitHintOf(facts),
    validUntil: facts.validUntil,
  };
}

/**
 * Add it to Available quotations.
 *
 * ⚠️ READ AGAIN HERE, not taken from the picker. The figures written to the row
 * are the ones this server found in the file — the same reason the reading above
 * happens on the server at all.
 */
export async function addQuotationFromPdfAction(input: {
  leadId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
}): Promise<RelatedWrite & { readonly number?: string; readonly matchedUnit?: string | null }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!input.path.startsWith(`crm-quotations/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }

  const read = await readUploadedQuotation(input.path);
  if ('error' in read) return { ok: false, error: read.error };
  const { facts } = read;
  if (!facts.number || facts.amount === null) {
    return { ok: false, error: 'This PDF is not showing a quotation number and an amount.' };
  }

  const written = await createQuotationFromPdf(user.id, {
    leadId: input.leadId,
    number: facts.number,
    amount: Math.round(facts.amount),
    validUntil: facts.validUntil,
    unitHint: unitHintOf(facts),
    plot: facts.plot,
    block: facts.block,
    marla: facts.marla,
    path: input.path,
    title: input.title.trim().slice(0, 140) || 'Quotation',
    mime: input.mime || 'application/pdf',
    sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
  });
  if (written.ok) {
    revalidatePath('/my-leads');
    revalidatePath(`/leads/${input.leadId}`);
  }
  return written;
}

/* -- A property sheet is many plots ------------------------------------------
 * Owner, 2026-09-17: *"when the property sheet is uploaded and it has multiple
 * plots and multiple data on it, then you will add each plot with you in this
 * way."*
 * ========================================================================= */

export interface SheetReading {
  readonly ok: boolean;
  readonly error?: string;
  readonly plots?: readonly ParsedPlot[];
  /** Codes the project already has, so the picker can mark them. */
  readonly existing?: readonly string[];
  /** False for a salesperson — 150 keeps the catalogue with the project manager. */
  readonly canAdd?: boolean;
}

export async function preparePropertySheetAction(leadId: string, filename: string, size: number): Promise<UploadSlot> {
  await requireCrmAccess();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file looks empty.' };
  if (size > PDF_MAX) return { ok: false, error: 'A property sheet must be under 25 MB.' };

  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'property-sheet.pdf';
  const path = `crm-property-sheets/${leadId}/${crypto.randomUUID()}/${safe}`;
  const signed = await signedUploadUrl(path);
  if (!signed.ok) return { ok: false, error: signed.message };
  return { ok: true, path, url: signed.value };
}

/**
 * Read the plots out of the sheet.
 *
 * ⚠️ LINES, NOT ONE BLOB OF TEXT. A price table joined with spaces makes every
 * row read as one plot with four prices — `lib/crm/pdf-text.ts` rebuilds the rows
 * from where the fragments sit on the page, and that is what this depends on.
 */
async function readSheet(path: string): Promise<{ plots: ParsedPlot[] } | { error: string }> {
  const file = await downloadObject(path);
  if (!file.ok) return { error: file.message ?? 'That file could not be read back.' };

  let lines: string[];
  try {
    lines = await readPdfLines(new Uint8Array(file.value.data), 20);
  } catch {
    return { error: 'That file could not be opened as a PDF. Please upload the sheet as a PDF.' };
  }

  const plots = parsePropertySheet(lines);
  const problem = sheetProblem(lines, plots);
  return problem ? { error: problem } : { plots };
}

export async function readPropertySheetAction(leadId: string, path: string): Promise<SheetReading> {
  const { user } = await requireCrmAccess();
  if (!path.startsWith(`crm-property-sheets/${leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }

  /* One wave: the file and the catalogue have nothing to say to each other. */
  const [read, context] = await Promise.all([readSheet(path), readPlotContext(user.id, leadId)]);
  if ('error' in read) return { ok: false, error: read.error };
  if (!context.ok) return { ok: false, error: 'That lead could not be found.' };

  return {
    ok: true,
    plots: read.plots,
    existing: context.existing,
    canAdd: context.canAdd,
  };
}

/**
 * Add the chosen plots.
 *
 * ⚠️ THE SHEET IS READ AGAIN HERE. What goes into the catalogue is what this
 * server found in the file; the page sends which codes to keep, never the prices.
 */
export async function addPlotsFromSheetAction(input: {
  leadId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
  codes: readonly string[];
}): Promise<RelatedWrite & { readonly added?: number; readonly skipped?: number }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!input.path.startsWith(`crm-property-sheets/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }

  const read = await readSheet(input.path);
  if ('error' in read) return { ok: false, error: read.error };

  const wanted = new Set(input.codes.map((c) => c.trim().toUpperCase()));
  const plots = read.plots.filter((pl) => wanted.has(pl.code.toUpperCase()));
  if (plots.length === 0) return { ok: false, error: 'None of those plots are in that sheet any more.' };

  const written = await addPlotsFromSheet(user.id, {
    leadId: input.leadId,
    path: input.path,
    title: input.title.trim().slice(0, 140) || 'Property sheet',
    mime: input.mime || 'application/pdf',
    sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
    plots: plots.map((pl) => ({
      code: pl.code,
      block: pl.block,
      sizeMarla: pl.sizeMarla,
      basePrice: pl.basePrice,
      category: pl.category,
    })),
  });
  if (written.ok) {
    revalidatePath('/my-leads');
    revalidatePath(`/leads/${input.leadId}`);
  }
  return written;
}

/** A sheet nobody added anything from does not stay in the bucket. */
export async function discardPropertySheetAction(leadId: string, path: string): Promise<{ ok: boolean }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId) || !path.startsWith(`crm-property-sheets/${leadId}/`)) return { ok: false };
  const rows = (await withUser(user.id, (tx) => tx`
    select 1 as one from public.crm_documents where storage_path = ${path} limit 1
  `)) as Array<{ one: number }>;
  if (rows.length > 0) return { ok: false };
  const gone = await removeObject(path);
  return { ok: gone.ok };
}

/**
 * Throw away a PDF the reading refused.
 *
 * ⚠️ ONLY A FILE NOTHING POINTS AT. The browser has already put the object in
 * the bucket by the time this server reads it; a rejected quotation would
 * otherwise sit there for ever, paid for and invisible. But a path that a
 * `crm_documents` row names is somebody's record, and this refuses to touch it.
 */
export async function discardQuotationPdfAction(leadId: string, path: string): Promise<{ ok: boolean }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId) || !path.startsWith(`crm-quotations/${leadId}/`)) return { ok: false };

  const rows = (await withUser(user.id, (tx) => tx`
    select 1 as one from public.crm_documents where storage_path = ${path} limit 1
  `)) as Array<{ one: number }>;
  if (rows.length > 0) return { ok: false };

  const gone = await removeObject(path);
  return { ok: gone.ok };
}

/**
 * A short-lived link to a quotation's PDF.
 *
 * ⚠️ THE PATH IS READ BACK UNDER RLS, never taken from the caller — handed one
 * directly this would sign anything in the bucket for anybody, which is the
 * lesson `crmDocumentLinkAction` already carries.
 */
export async function quotationPdfLinkAction(quotationId: string): Promise<{ url?: string; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(quotationId)) return { error: 'That quotation could not be opened.' };

  const rows = (await withUser(user.id, (tx) => tx`
    select pdf_path from public.crm_quotations where id = ${quotationId}::uuid
  `)) as Array<{ pdf_path: string | null }>;
  const path = rows[0]?.pdf_path;
  /* The same answer for "no PDF" and "not yours", so this cannot be used to
     find out which quotations exist. */
  if (!path) return { error: 'There is no PDF on that quotation yet.' };

  const link = await signedUrl(path);
  return link.ok ? { url: link.value } : { error: link.message ?? 'The link could not be made.' };
}

/* ── The salesperson's half of an invoice ────────────────────────────────── */

/** It went out. ⚠️ Not a payment — Finance still decides what has been received. */
export async function markInvoiceSentAction(leadId: string, invoiceId: string): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(invoiceId)) return { ok: false, error: 'That invoice could not be found.' };
  return settle(await markInvoiceSent(user.id, invoiceId), leadId);
}

/** Where the receipt goes. The browser uploads it, as with a quotation PDF. */
export async function prepareReceiptAction(leadId: string, filename: string, size: number): Promise<UploadSlot> {
  await requireCrmAccess();
  if (!UUID.test(leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file looks empty.' };
  if (size > PDF_MAX) return { ok: false, error: 'A receipt must be under 25 MB.' };

  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'receipt.pdf';
  const path = `crm-receipts/${leadId}/${crypto.randomUUID()}/${safe}`;
  const signed = await signedUploadUrl(path);
  if (!signed.ok) return { ok: false, error: signed.message };
  return { ok: true, path, url: signed.value };
}

export async function attachInvoiceReceiptAction(input: {
  leadId: string;
  invoiceId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.invoiceId)) return { ok: false, error: 'That invoice could not be found.' };
  if (!input.path.startsWith(`crm-receipts/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }
  return settle(
    await attachInvoiceReceipt(user.id, {
      invoiceId: input.invoiceId,
      path: input.path,
      title: input.title.trim().slice(0, 140) || 'Payment receipt',
      mime: input.mime || 'application/pdf',
      sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
    }),
    input.leadId,
  );
}

/**
 * A short-lived link to an invoice's receipt — what Finance opens before it
 * approves the payment.
 *
 * ⚠️ THE PATH IS READ BACK UNDER RLS, never taken from the caller.
 */
export async function invoiceReceiptLinkAction(invoiceId: string): Promise<{ url?: string; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(invoiceId)) return { error: 'That receipt could not be opened.' };

  const rows = (await withUser(user.id, (tx) => tx`
    select receipt_path from public.crm_invoices where id = ${invoiceId}::uuid
  `)) as Array<{ receipt_path: string | null }>;
  const path = rows[0]?.receipt_path;
  if (!path) return { error: 'There is no receipt on that invoice yet.' };

  const link = await signedUrl(path);
  return link.ok ? { url: link.value } : { error: link.message ?? 'The link could not be made.' };
}


/* ── Requests to the manager — 197 ───────────────────────────────────────── */

export async function requestFromManagerAction(input: {
  leadId: string;
  kind: 'quote' | 'invoice';
  subject: string;
  note: string;
}): Promise<RelatedWrite & { recipients?: number; queued?: number }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  const note = input.note.trim();
  if (!note) return { ok: false, error: 'Say what needs to change.' };
  const result = await requestFromManager(user.id, {
    leadId: input.leadId,
    kind: input.kind === 'invoice' ? 'invoice' : 'quote',
    subject: input.subject.trim().slice(0, 80) || (input.kind === 'invoice' ? 'Invoice' : 'Quotation'),
    note: note.slice(0, 1000),
  });
  if (result.ok) revalidatePath('/my-leads');
  return result;
}

/* ── Appointments ────────────────────────────────────────────────────────── */

export async function rescheduleAppointmentAction(
  leadId: string,
  appointmentId: string,
  scheduledAt: string,
): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(appointmentId)) return { ok: false, error: 'That appointment could not be found.' };
  const ms = Date.parse(scheduledAt);
  if (Number.isNaN(ms) || ms < Date.now() - 5 * 60_000) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(
    await rescheduleAppointment(user.id, { appointmentId, scheduledAt: new Date(ms).toISOString() }),
    leadId,
  );
}

/* ── A booking's payment evidence, and an invoice's own PDF ──────────────── */

export async function attachBookingReceiptAction(input: {
  leadId: string;
  bookingId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.bookingId)) return { ok: false, error: 'That booking could not be found.' };
  if (!input.path.startsWith(`crm-receipts/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }
  return settle(
    await attachBookingReceipt(user.id, {
      bookingId: input.bookingId,
      path: input.path,
      title: input.title.trim().slice(0, 140) || 'Payment evidence',
      mime: input.mime || 'application/pdf',
      sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
    }),
    input.leadId,
  );
}

export async function attachInvoicePdfAction(input: {
  leadId: string;
  invoiceId: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
}): Promise<RelatedWrite> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.invoiceId)) return { ok: false, error: 'That invoice could not be found.' };
  if (!input.path.startsWith(`crm-quotations/${input.leadId}/`)) {
    return { ok: false, error: 'That file was not uploaded for this lead.' };
  }
  return settle(
    await attachInvoicePdf(user.id, {
      invoiceId: input.invoiceId,
      path: input.path,
      title: input.title.trim().slice(0, 140) || 'Invoice',
      mime: input.mime || 'application/pdf',
      sizeBytes: Math.max(1, Math.round(input.sizeBytes)),
    }),
    input.leadId,
  );
}

/**
 * A short-lived link to any file this dialog attaches.
 *
 * ⚠️ THE PATH IS READ BACK UNDER RLS from the row it belongs to, never taken from
 * the caller — one function, four columns, the same rule for each.
 */
export async function relatedFileLinkAction(
  what: 'quotation_pdf' | 'invoice_pdf' | 'invoice_receipt' | 'booking_receipt',
  id: string,
): Promise<{ url?: string; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { error: 'That file could not be opened.' };
  const rows = (await withUser(user.id, (tx) =>
    what === 'quotation_pdf'
      ? tx`select pdf_path as path from public.crm_quotations where id = ${id}::uuid`
      : what === 'invoice_pdf'
        ? tx`select pdf_path as path from public.crm_invoices where id = ${id}::uuid`
        : what === 'invoice_receipt'
          ? tx`select receipt_path as path from public.crm_invoices where id = ${id}::uuid`
          : tx`select receipt_path as path from public.crm_bookings where id = ${id}::uuid`,
  )) as Array<{ path: string | null }>;
  const path = rows[0]?.path;
  if (!path) return { error: 'There is no file there yet.' };
  const link = await signedUrl(path);
  return link.ok ? { url: link.value } : { error: link.message ?? 'The link could not be made.' };
}
