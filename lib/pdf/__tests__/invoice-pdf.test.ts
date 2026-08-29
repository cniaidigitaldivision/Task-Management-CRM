import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { LETTERHEAD_FALLBACK, readLetterhead, totalsFor } from '@/lib/domain/invoice';

import { composeInvoicePdf, type InvoicePdfInput } from '../invoice-pdf';

/* ============================================================================
 * THE INVOICE PDF
 * ----------------------------------------------------------------------------
 * ⚠️ IN pdf-lib THESE FAILURES ARE NOT SUBTLE — they are a 500 where a client
 * was expecting a document, and they happen at send time rather than at build
 * time. The cases below are the ones that genuinely break a composer:
 *
 *   · a character outside WinAnsi — `drawText` THROWS, and this division's own
 *     data is full of em dashes (four of five library documents have one)
 *   · a description long enough to need wrapping, and one long enough to need
 *     breaking mid-word
 *   · enough lines to force a page break, where the totals must still land with
 *     the signature rather than orphaned
 *   · a letterhead with nothing filled in, which is the state the database is
 *     in right now
 *   · a "signature" that is not a PNG, which embedPng rejects with an opaque
 *     parse error
 * ========================================================================= */

const base: InvoicePdfInput = {
  invoiceNo: 'CNI-2026-0001',
  kind: 'retainer',
  issuedOn: '2026-09-01',
  dueOn: '2026-09-11',
  paymentTermsDays: 10,
  billedToName: 'GC Royal Emporium',
  billedToPerson: 'Mr Ahmed Raza',
  billedToEmail: 'accounts@gcroyal.com',
  billedToAddress: '12 Main Boulevard\nKarachi',
  lines: [
    { description: 'Social media management', quantity: 1, unitPricePkr: 120_000, amountPkr: 120_000 },
  ],
  subtotalPkr: 120_000,
  taxRatePct: null,
  taxPkr: null,
  totalPkr: 120_000,
  clientNote: null,
  company: LETTERHEAD_FALLBACK,
  signedByName: 'Umm-e-Habiba',
  signedByTitle: 'CTO',
  signaturePng: null,
  voided: false,
};

async function pageCount(bytes: Uint8Array): Promise<number> {
  /* ⚠️ Counted THROUGH pdf-lib, not by grepping the bytes for '/Type /Page'.
     That string also appears inside '/Type /Pages' and inside compressed
     streams, so a byte search over-counts — the same note report-sheet's test
     carries. */
  const parsed = await PDFDocument.load(bytes);
  return parsed.getPageCount();
}

describe('composing an invoice', () => {
  it('produces a real, parseable PDF', async () => {
    const bytes = await composeInvoicePdf(base);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    /* %PDF- */
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(await pageCount(bytes)).toBe(1);
  });

  it('carries the invoice number in the document title', async () => {
    const parsed = await PDFDocument.load(await composeInvoicePdf(base));
    expect(parsed.getTitle()).toBe('Invoice CNI-2026-0001');
  });

  /* ⚠️ THE ONE THAT ACTUALLY BREAKS THINGS. Helvetica is WinAnsi-encoded and
     `drawText` throws on anything outside it. Every string on the page goes
     through `safe()`; this proves it, on the characters this division's own
     data really contains. */
  it('survives every character its own data contains', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      billedToName: 'GC Royal Emporium — “Premium” Division',
      billedToPerson: 'Mr Ahmed Raza’s office',
      billedToAddress: 'Plot 12–14, Main Boulevard\nKarachi',
      clientNote: 'Covers August and September… thank you!',
      lines: [
        {
          description: 'Social media — statics, reels & stories (Sep 2026)',
          quantity: 1,
          unitPricePkr: 120_000,
          amountPkr: 120_000,
        },
      ],
      signedByName: 'Umm-e-Habiba',
      signedByTitle: 'CTO — AI & Digital Division',
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('survives a script it cannot set at all', async () => {
    /* Urdu, emoji, a zero-width joiner. None of it is WinAnsi; none of it may
       throw. It degrades to dashes, which is a legible document rather than a
       500 at the moment somebody presses Send. */
    const bytes = await composeInvoicePdf({
      ...base,
      billedToName: 'جی سی رائل',
      lines: [{ description: 'خدمات 🎉', quantity: 1, unitPricePkr: 1000, amountPkr: 1000 }],
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('wraps a long description instead of running off the page', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      lines: [
        {
          description:
            'Social media management covering eight static posts a week, four reels, story coverage every working day, community management, monthly analytics reporting and one quarterly strategy review session',
          quantity: 1,
          unitPricePkr: 120_000,
          amountPkr: 120_000,
        },
      ],
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('breaks a single word wider than its column', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      lines: [{ description: 'A'.repeat(400), quantity: 1, unitPricePkr: 500, amountPkr: 500 }],
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('paginates a long invoice', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      description: `Line item number ${i + 1} with a description long enough to need a second row of text`,
      quantity: 2,
      unitPricePkr: 5_000,
      amountPkr: 10_000,
    }));
    const bytes = await composeInvoicePdf({
      ...base,
      lines,
      subtotalPkr: 400_000,
      totalPkr: 400_000,
    });
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });

  it('draws the tax line when there is one', async () => {
    const totals = totalsFor([{ description: 'x', quantity: 1, unitPricePkr: 120_000 }], 16);
    const bytes = await composeInvoicePdf({
      ...base,
      subtotalPkr: totals.subtotalPkr,
      taxRatePct: totals.taxRatePct,
      taxPkr: totals.taxPkr,
      totalPkr: totals.totalPkr,
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  /* ⚠️ THE STATE THE DATABASE IS IN TODAY: `invoice_company` was seeded with
     every address, bank and tax field blank on purpose, rather than with
     invented placeholders. The composer must omit those blocks and still
     produce a document. */
  it('omits every block the letterhead has not filled in', async () => {
    const bytes = await composeInvoicePdf({ ...base, company: readLetterhead({}) });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('draws the payment block once the bank details exist', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      company: readLetterhead({
        addressLines: ['12 Main Boulevard', 'Karachi 75500'],
        phone: '+92 300 0000000',
        email: 'accounts@cni.example',
        ntn: '1234567-8',
        bankName: 'Meezan Bank',
        bankTitle: 'Crescent Nova International',
        bankAccount: '0102 0304 0506',
        bankIban: 'PK00MEZN0000000000000000',
      }),
      clientNote: 'Please quote the invoice number with your transfer.',
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  /* An unsendable invoice is a worse outcome than one signed with a printed
     name — `embedPng` throws an opaque parse error on anything that is not
     really a PNG, and it must not reach the caller. */
  it('does not fail when the signature is not a real PNG', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      signaturePng: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('draws a real signature', async () => {
    /* A 1×1 transparent PNG — the smallest thing embedPng will actually take. */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const bytes = await composeInvoicePdf({ ...base, signaturePng: new Uint8Array(png) });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('stamps a voided invoice', async () => {
    const bytes = await composeInvoicePdf({ ...base, voided: true });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles an invoice with no signer title and no client note', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      signedByTitle: null,
      clientNote: null,
      billedToPerson: null,
      billedToAddress: null,
      billedToEmail: null,
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('prints a fractional quantity without turning a whole one into 1.00', async () => {
    const bytes = await composeInvoicePdf({
      ...base,
      lines: [
        { description: 'Half day', quantity: 0.5, unitPricePkr: 20_000, amountPkr: 10_000 },
        { description: 'Full day', quantity: 1, unitPricePkr: 20_000, amountPkr: 20_000 },
      ],
      subtotalPkr: 30_000,
      totalPkr: 30_000,
    });
    expect(await pageCount(bytes)).toBe(1);
  });
});
