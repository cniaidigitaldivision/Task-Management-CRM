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
import {
  attachInvoiceReceipt,
  attachQuotationPdf,
  confirmBooking,
  createBooking,
  createInvoice,
  markInvoiceSent,
  readLeadRelatedItems,
  recordInvoicePayment,
  requestBookingVerification,
  type RelatedItems,
  type RelatedWrite,
} from '@/lib/db/queries/crm-related';
import { withUser } from '@/lib/db/client';
import { signedUploadUrl, signedUrl } from '@/lib/storage/bucket';

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

export async function relatedItemsAction(leadId: string): Promise<RelatedItems | null> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId)) return null;
  return readLeadRelatedItems(user.id, leadId);
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
