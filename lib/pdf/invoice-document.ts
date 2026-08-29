import 'server-only';

import * as I from '@/lib/db/queries/invoices';
import { signedUrl, uploadObject } from '@/lib/storage/bucket';

import { composeInvoicePdf } from './invoice-pdf';

/* ============================================================================
 * GETTING AN INVOICE'S DOCUMENT — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS IS NOT IN `app/actions/invoices.ts` ────────────────────────
 * It started there and had to move. A `'use server'` file may only export async
 * functions, and EVERY export it has becomes a server action reachable by POST
 * from the browser. `/api/invoice/[id]` needs these bytes, so importing them
 * from the actions file would mean publishing an RPC endpoint whose only purpose
 * was to be called by our own route — a wider surface for no gain.
 *
 * A plain `server-only` module is importable by both the actions and the route,
 * and is reachable from neither the browser nor a client bundle.
 * ========================================================================= */

/**
 * Fetch a stored object's bytes.
 *
 * ⚠️ Server-side only, through a two-minute signed URL that never reaches the
 * browser — the same arrangement `/api/library/[id]` uses and for the same
 * reason: a signed URL handed to a client is a bearer token in a query string
 * that outlives the session.
 */
export async function readObject(path: string): Promise<Uint8Array | null> {
  const signed = await signedUrl(path);
  if (!signed.ok) return null;
  try {
    const response = await fetch(signed.value);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Where an invoice's PDF lives. The number is in the path so the object is
 *  recognisable when browsing the bucket; the id keeps it unique. */
export const pdfPathFor = (id: string, invoiceNo: string) =>
  `finance/invoices/${invoiceNo.replace(/[^A-Za-z0-9-]/g, '-')}-${id.slice(0, 8)}.pdf`;

export type PdfOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly invoiceNo: string }
  | { readonly ok: false; readonly message: string; readonly missing: boolean };

/**
 * The invoice's PDF bytes, composing and storing them if they do not exist yet.
 *
 * ⚠️ COMPOSED FROM THE STORED ROW, NEVER FROM THE FORM. Everything the document
 * prints — the totals, the billed-to snapshot, the signer's name — is read back
 * out of the database. So the PDF cannot say something the ledger does not, even
 * if a bug let the two diverge on the way in, and regenerating it in two years
 * produces the same document.
 *
 * ⚠️ AND IT IS CACHED, so a sent invoice keeps the exact bytes the client was
 * given. Re-composing on every view would silently restamp it with today's
 * letterhead — a corrected address, a new bank account — and the copy on file
 * would stop matching the copy in their inbox. That is the whole reason there is
 * a stored object at all rather than composing on demand every time.
 */
export async function invoicePdf(userId: string, invoiceId: string): Promise<PdfOutcome> {
  const invoice = await I.getInvoice(userId, invoiceId);
  if (!invoice) return { ok: false, message: 'That invoice does not exist.', missing: true };

  const company = await I.companyLetterhead(userId);
  const profiles = await I.listBillingProfiles(userId);
  const termsDays =
    profiles.find((p) => p.projectId === invoice.projectId)?.paymentTermsDays ?? 10;

  const files = await I.invoiceFiles(userId, invoiceId);

  if (files?.pdfPath) {
    const cached = await readObject(files.pdfPath);
    if (cached) return { ok: true, bytes: cached, invoiceNo: invoice.invoiceNo };
    /* The row points at an object that is gone. Fall through and rebuild rather
       than refusing — a missing file is not a reason a client cannot be sent
       their invoice. */
  }

  let signaturePng: Uint8Array | null = null;
  if (files?.signaturePath) signaturePng = await readObject(files.signaturePath);

  let bytes: Uint8Array;
  try {
    bytes = await composeInvoicePdf({
      invoiceNo: invoice.invoiceNo,
      kind: invoice.kind,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      paymentTermsDays: termsDays,
      billedToName: invoice.billedToName ?? invoice.sourceName,
      billedToPerson: invoice.billedToPerson,
      billedToEmail: invoice.billedToEmail,
      billedToAddress: invoice.billedToAddress,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPricePkr: line.unitPricePkr,
        amountPkr: line.amountPkr,
      })),
      /* ⚠️ `subtotal_pkr` is null on a row the plain income form wrote. Falling
         back to the total is right: with no breakdown there is no tax line, and
         subtotal == total by definition. */
      subtotalPkr: invoice.subtotalPkr ?? invoice.amountPkr,
      taxRatePct: invoice.taxRatePct,
      taxPkr: invoice.taxPkr,
      totalPkr: invoice.amountPkr,
      clientNote: invoice.clientNote,
      company,
      signedByName: invoice.signedByName ?? company.legalName,
      signedByTitle: invoice.signedByTitle,
      signaturePng,
      voided: invoice.voidedAt !== null,
    });
  } catch (error) {
    /* pdf-lib's failures are opaque parse errors several layers from their
       cause, so they are named here rather than surfaced as a blank 500. */
    console.error('[invoices] PDF composition failed', error);
    return { ok: false, message: 'The invoice document could not be drawn.', missing: false };
  }

  /* ⚠️ A VOIDED INVOICE'S REBUILD IS NOT CACHED. It carries a VOID stamp, and
     writing it to the stored path would overwrite the unstamped document the
     client was actually sent — destroying the only copy of what they received. */
  if (!invoice.voidedAt) {
    const path = pdfPathFor(invoice.id, invoice.invoiceNo);
    const stored = await uploadObject({ path, body: bytes, contentType: 'application/pdf' });
    if (stored.ok) {
      await I.setInvoicePdf(userId, invoice.id, path).catch(() =>
        console.error('[invoices] the PDF was stored but the row was not updated'),
      );
    }
    /* A storage failure is not fatal: the bytes are in hand and can be shown or
       sent right now, and the next view composes them again. */
  }

  return { ok: true, bytes, invoiceNo: invoice.invoiceNo };
}
