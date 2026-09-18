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
  it('names a missing number', () => {
    expect(missingFrom(extractQuotationFacts('5 Marla Block A Total amount PKR 4,750,000')))
      .toEqual(['a quotation number']);
  });

  it('names a missing amount', () => {
    expect(missingFrom(extractQuotationFacts('Quotation No: QT-2051 Plot A-101 Block A 5 Marla')))
      .toEqual(['an amount']);
  });

  it('names a missing property', () => {
    expect(missingFrom(extractQuotationFacts('Quotation No: QT-2051 Total amount PKR 4,750,000')))
      .toEqual(['the property (Marla, block or plot)']);
  });

  it('names all three when the file is something else entirely', () => {
    expect(missingFrom(extractQuotationFacts('Dear Sir, thank you for your interest in our project.')))
      .toHaveLength(3);
  });

  it('accepts a property named by block alone', () => {
    expect(missingFrom(extractQuotationFacts('Quotation No: QT-7 Block D Total amount PKR 5,000,000'))).toEqual([]);
  });

  it('reports no readable text as a length of zero, for the scan message', () => {
    expect(extractQuotationFacts('').textLength).toBe(0);
  });
});
