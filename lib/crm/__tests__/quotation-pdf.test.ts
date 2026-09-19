import { describe, expect, it } from 'vitest';

import { extractQuotationFacts, missingFrom } from '../quotation-pdf';

/* ============================================================================
 * ⚠️ THESE LINES ARE WHAT PDFJS ACTUALLY RETURNED.
 * ----------------------------------------------------------------------------
 * A quotation was written with pdf-lib in the layout a real one uses — the
 * number top right, the price in a right-hand column — put through
 * `readPdfLines`, and this is the output, verbatim. Fixtures invented by hand
 * would prove the regexes against my own idea of a PDF; these prove them against
 * the reader.
 *
 * Note the shape it produces: "Base price PKR 4,500,000" — a label on the left
 * and a figure four columns away become ONE line, which is exactly why the
 * labelled-total rule has to beat "the biggest number on the page".
 * ========================================================================= */
const REAL = [
  'CNI Gardens Islamabad QUOTATION',
  'Quotation No: QT-2051',
  'Date: 18 September 2026',
  'Client: Hamza Tariq',
  'Property: Plot A-101, Block A, 5 Marla',
  'Base price PKR 4,500,000',
  'Development charges PKR 250,000',
  'Total amount PKR 4,750,000',
  'Valid until 30 Oct 2026',
  'Monthly instalment option available at PKR 79,166 for 60 months',
].join('\n');

describe('extractQuotationFacts, on a real PDF', () => {
  it('reads the number, the property and the total', () => {
    const facts = extractQuotationFacts(REAL);
    expect(missingFrom(facts)).toEqual([]);
    expect(facts).toMatchObject({
      number: 'QT-2051',
      amount: 4_750_000,
      marla: 5,
      block: 'A',
      plot: 'A-101',
    });
  });

  it('keeps the expiry the document prints, not the UTC day before it', () => {
    /* ⚠️ Karachi is +05:00, so a date parsed as local midnight and printed with
       `toISOString()` comes back as the previous day. This is that regression. */
    expect(extractQuotationFacts(REAL).validUntil).toBe('2026-10-30');
  });

  it('takes the labelled total over the largest figure on the page', () => {
    const facts = extractQuotationFacts(
      [
        'Quotation No: QT-9001',
        'Property: Plot B-4, Block B, 10 Marla',
        'Total amount PKR 3,000,000',
        'Payment plan: 60 monthly instalments of PKR 9,999,999',
      ].join('\n'),
    );
    expect(facts.amount).toBe(3_000_000);
  });

  it('falls back to the largest money figure when nothing is labelled', () => {
    const facts = extractQuotationFacts('Quotation No: QT-9002 5 Marla Block C PKR 1,200,000 PKR 400,000');
    expect(facts.amount).toBe(1_200_000);
  });
});

describe('missingFrom — the owner’s refusal', () => {
  /* The rule the owner wrote on 2026-09-17 was: number, property, amount, or it
     is refused. Two of those three moved on 2026-09-19, and each for a document
     that actually exists. */

  it('refuses a document that does not state a price', () => {
    expect(missingFrom(extractQuotationFacts('Quotation No: QT-2051 Plot A-101 Block A 5 Marla')))
      .toEqual(['a price']);
  });

  it('still demands the property of a document that IS selling land', () => {
    /* It says "plot", so it is selling land — and then never says WHICH plot,
       which is exactly the hole the owner's rule was written to catch. */
    const facts = extractQuotationFacts('Quotation No: QT-2051 for a residential plot. Total amount PKR 4,750,000');
    expect(facts.quotesProperty).toBe(true);
    expect(missingFrom(facts)).toEqual(['the property (Marla, block or plot)']);
  });

  it('does NOT demand a property of a quotation that sells software', () => {
    /* ⚠️ THE OWNER'S OWN CNI_AJ_Trading_Quotation.pdf. It quotes a CRM package
       to a towel manufacturer; it will never carry a Marla or a plot, and
       `crm_quotations.property_id` has always been nullable. Demanding one made
       a real quotation, already sent to a real client, impossible to file. */
    const facts = extractQuotationFacts(
      [
        'QUOTATION AI & DIGITAL SOLUTION',
        'Client: Abdul Hadi Company: AJ Trading SDN.BHD. Currency: PKR',
        'CRM & Lead Management PKR 85,000',
        'SPECIAL PACKAGE PRICE Total solution value PKR 255,000',
        'Special discount (30%) - PKR 76,500',
        'FINAL QUOTED PRICE PKR 178,500',
      ].join(String.fromCharCode(10)),
    );
    expect(facts.quotesProperty).toBe(false);
    expect(missingFrom(facts)).toEqual([]);
  });

  it('⚠️ takes the FINAL price, not the biggest figure on a discounted page', () => {
    /* The same document. The old rule read 255,000 — the pre-discount "solution
       value" — and would have written a price 43% above the one quoted onto a
       client's record as fact. */
    const facts = extractQuotationFacts(
      [
        'SPECIAL PACKAGE PRICE Total solution value PKR 255,000',
        'Special discount (30%) - PKR 76,500',
        'FINAL QUOTED PRICE PKR 178,500',
      ].join(String.fromCharCode(10)),
    );
    expect(facts.amount).toBe(178_500);
    expect(facts.discounted).toBe(true);
  });

  it('refuses to guess when a discounted page names no total at all', () => {
    /* ⚠️ THE FALLBACK IS NOT MERELY UNRELIABLE HERE, IT IS RELIABLY WRONG: the
       largest figure on a page that subtracts something is the figure BEFORE the
       subtraction, every time. */
    const facts = extractQuotationFacts('Package PKR 255,000 Special discount (30%) - PKR 76,500');
    expect(facts.amount).toBeNull();
    expect(missingFrom(facts)).toEqual(['a price']);
  });

  it('a letter that is not a quotation at all is still refused', () => {
    expect(missingFrom(extractQuotationFacts('Dear Sir, thank you for your interest in our project.')))
      .toEqual(['a price']);
  });

  it('accepts a property named by block alone', () => {
    expect(missingFrom(extractQuotationFacts('Quotation No: QT-7 Block D Total amount PKR 5,000,000'))).toEqual([]);
  });

  it('reports no readable text as a length of zero, for the scan message', () => {
    expect(extractQuotationFacts('').textLength).toBe(0);
  });
});
