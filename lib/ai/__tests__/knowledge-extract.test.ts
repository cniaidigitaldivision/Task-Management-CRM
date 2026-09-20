import { describe, expect, it } from 'vitest';

import { type KnowledgeDraft, verifyQuotes } from '../knowledge-extract';

/* ============================================================================
 * AN ANSWER WHOSE QUOTE IS NOT IN THE DOCUMENT IS AN INVENTED ANSWER
 * ----------------------------------------------------------------------------
 * The fence around the agent is that every fact traces to something a person
 * approved. That fence is worthless if the sentence it rests on was written by
 * the model — so the quote is checked against the document rather than trusted.
 *
 * ⚠️ AND IT FORGIVES WHAT A PDF DOES TO TEXT, WHICH IS THE HARD PART. The same
 * sentence comes out of `readPdfText` with line breaks mid-clause, doubled
 * spaces and a hyphen where the line wrapped. A strict comparison would drop
 * every true answer and keep nothing.
 * ========================================================================= */

const DOC = [
  'CNI AI & DIGITAL SOLUTION — QUOTATION',
  'CRM & Lead Management: lead/customer database, sales pipeline, follow-ups,',
  'sales tracking and team reports.',
  'Estimated deployment: 2-3 weeks.',
  'Third-party WhatsApp/Meta messaging charges and usage-based AI/API charges,',
  'where applicable, are separate.',
].join(String.fromCharCode(10));

const draft = (sourceQuote: string): KnowledgeDraft => ({
  question: 'How long does deployment take?',
  answer: 'Two to three weeks.',
  sourceQuote,
});

describe('verifyQuotes', () => {
  it('keeps an answer whose quote really is in the document', () => {
    const { kept, dropped } = verifyQuotes([draft('Estimated deployment: 2-3 weeks.')], DOC);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('⚠️ keeps a quote the PDF broke across lines', () => {
    /* This is the normal case, not the edge case: the sentence spans a line
       break in the source and the model returns it as one line. */
    const { kept } = verifyQuotes(
      [draft('Third-party WhatsApp/Meta messaging charges and usage-based AI/API charges, where applicable, are separate.')],
      DOC,
    );
    expect(kept).toHaveLength(1);
  });

  it('forgives doubled spaces and different punctuation spacing', () => {
    const { kept } = verifyQuotes([draft('Estimated   deployment:  2 - 3 weeks')], DOC);
    expect(kept).toHaveLength(1);
  });

  it('⚠️ drops an answer the model invented a source for', () => {
    /* Plausible, in the document's own voice, and nowhere in the document. This
       is exactly the failure the fence exists to stop. */
    const { kept, dropped } = verifyQuotes(
      [draft('Deployment is completed within 5 working days, guaranteed.')],
      DOC,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('⚠️ drops a quote too short to prove anything', () => {
    /* "weeks" appears in the document and establishes nothing — a two-word quote
       would let almost any claim through. */
    const { kept } = verifyQuotes([draft('weeks')], DOC);
    expect(kept).toHaveLength(0);
  });

  it('drops an empty quote rather than matching everything', () => {
    /* flatten('') is '' and ''.includes('') is true — the one input that would
       silently pass every entry. */
    expect(verifyQuotes([draft('')], DOC).kept).toHaveLength(0);
  });

  it('sorts a mixed batch correctly', () => {
    const { kept, dropped } = verifyQuotes(
      [
        draft('Estimated deployment: 2-3 weeks.'),
        draft('We offer a 60-day money-back guarantee.'),
        draft('sales tracking and team reports'),
      ],
      DOC,
    );
    expect(kept).toHaveLength(2);
    expect(dropped.map((d) => d.sourceQuote)).toEqual(['We offer a 60-day money-back guarantee.']);
  });
});
