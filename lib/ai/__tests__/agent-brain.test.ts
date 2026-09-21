import { describe, expect, it } from 'vitest';

import { buildAgentPrompt, validateDecision } from '../agent-brain';

/* ============================================================================
 * WHAT THE AGENT IS ALLOWED TO DO WITH THE MODEL'S ANSWER
 * ----------------------------------------------------------------------------
 * JSON mode guarantees JSON, not the shape asked for (`json-mode-is-not-a-schema`),
 * so every answer is checked. The rule: anything the code cannot trust becomes a
 * handover to a person, never a guess sent to a client.
 * ========================================================================= */

const DOCS = [
  { id: 'doc-proposal', kind: 'brochure' },
  { id: 'doc-quotation', kind: 'quotation' },
];

describe('validateDecision', () => {
  it('accepts a proper reply with a document and a follow-up', () => {
    const d = validateDecision({
      action: 'reply',
      reply: 'Here is our CRM proposal.',
      documents: ['doc-proposal'],
      follow_up: { purpose: 'proposal', in_days: 2 },
      product: 'crm',
      handover_reason: null,
    }, DOCS);
    expect(d).toMatchObject({
      action: 'reply',
      documentIds: ['doc-proposal'],
      followUp: { purpose: 'proposal', inDays: 2 },
      product: 'crm',
    });
  });

  it('⚠️ drops a document id it was never shown', () => {
    const d = validateDecision({ action: 'reply', reply: 'x', documents: ['doc-made-up', 'doc-quotation'] }, DOCS);
    expect(d.documentIds).toEqual(['doc-quotation']);
  });

  it('never sends more than two documents at once', () => {
    const d = validateDecision({ action: 'reply', reply: 'x', documents: ['doc-proposal', 'doc-quotation', 'doc-proposal'] }, DOCS);
    expect(d.documentIds).toHaveLength(2);
  });

  it('drops a follow-up of a kind it may not set, and clamps the days', () => {
    expect(validateDecision({ action: 'reply', reply: 'x', follow_up: { purpose: 'payment_received', in_days: 2 } }, DOCS).followUp).toBeNull();
    expect(validateDecision({ action: 'reply', reply: 'x', documents: ['doc-quotation'], follow_up: { purpose: 'quotation', in_days: 40 } }, DOCS).followUp)
      .toEqual({ purpose: 'quotation', inDays: 7 });
    expect(validateDecision({ action: 'reply', reply: 'x', follow_up: { purpose: 'missing_information', in_days: 0 } }, DOCS).followUp)
      .toEqual({ purpose: 'missing_information', inDays: 1 });
  });

  /* Dry run, 2026-09-21: "more detail about the CRM" came back with no file and
     a proposal follow-up — a reminder about a proposal nobody sent. */
  it('⚠️ never keeps a proposal or quotation follow-up without its document', () => {
    expect(validateDecision({ action: 'reply', reply: 'x', follow_up: { purpose: 'proposal', in_days: 2 } }, DOCS).followUp).toBeNull();
    expect(validateDecision({ action: 'reply', reply: 'x', follow_up: { purpose: 'quotation', in_days: 2 } }, DOCS).followUp).toBeNull();
  });

  it('⚠️ a document sent always carries its own follow-up — the kind decides which', () => {
    expect(validateDecision({ action: 'reply', reply: 'x', documents: ['doc-proposal'] }, DOCS).followUp)
      .toEqual({ purpose: 'proposal', inDays: 2 });
    expect(validateDecision({ action: 'reply', reply: 'x', documents: ['doc-quotation'], follow_up: { purpose: 'proposal', in_days: 5 } }, DOCS).followUp)
      .toEqual({ purpose: 'quotation', inDays: 2 });
    expect(validateDecision({ action: 'reply', reply: 'x', documents: ['doc-proposal'], follow_up: { purpose: 'proposal', in_days: 3 } }, DOCS).followUp)
      .toEqual({ purpose: 'proposal', inDays: 3 });
  });

  describe('⚠️ the product being talked about (233 shows the agent every product)', () => {
    const SHELF = [
      { id: 'crm-proposal', kind: 'brochure', product: 'crm' },
      { id: 'taskly-proposal', kind: 'brochure', product: 'taskly' },
      { id: 'company-profile', kind: 'other', product: 'any' },
    ];
    const send = (ids: string[], product: string | null, leadProduct: string | null) =>
      validateDecision({ action: 'reply', reply: 'x', documents: ids, product }, SHELF, { leadProduct }).documentIds;

    it('never sends a CRM proposal to a client talking about Taskly', () => {
      expect(send(['crm-proposal'], 'taskly', 'taskly')).toEqual([]);
      expect(send(['crm-proposal'], null, 'taskly')).toEqual([]);
    });

    it('follows the client when they ask about another product than the lead says', () => {
      expect(send(['crm-proposal'], 'crm', 'taskly')).toEqual(['crm-proposal']);
    });

    it('sends a document for all products to anyone, and nothing product-specific while the interest is unknown', () => {
      expect(send(['company-profile'], null, null)).toEqual(['company-profile']);
      expect(send(['crm-proposal'], null, null)).toEqual([]);
    });

    it('drops the follow-up with the document it would have been about', () => {
      expect(validateDecision({ action: 'reply', reply: 'x', documents: ['crm-proposal'], follow_up: { purpose: 'proposal', in_days: 2 }, product: 'taskly' }, SHELF).followUp)
        .toBeNull();
    });
  });

  describe('⚠️ the same file twice', () => {
    const SENT = [{ id: 'crm-proposal', kind: 'brochure', product: 'crm', alreadySent: true }];
    const again = (text: string) =>
      validateDecision({ action: 'reply', reply: 'x', documents: ['crm-proposal'], product: 'crm' }, SENT, { latestClientText: text }).documentIds;

    it('is not sent again unasked', () => {
      expect(again('ok, we are 12 people in sales')).toEqual([]);
    });

    it('is sent again when they did not get it or ask for it again — English and Roman Urdu', () => {
      for (const text of ['I did not receive it, can you send again?', 'didnt get the file', 'cannot open the pdf', 'proposal nahi mili', 'dobara bhej dein']) {
        expect(again(text), text).toEqual(['crm-proposal']);
      }
    });
  });

  it('sends one document once, however often the model names it', () => {
    expect(validateDecision({ action: 'reply', reply: 'x', documents: ['doc-proposal', 'doc-proposal'] }, DOCS).documentIds)
      .toEqual(['doc-proposal']);
  });

  it('⚠️ turns an empty reply into a handover, not silence', () => {
    expect(validateDecision({ action: 'reply', reply: '  ' }, DOCS)).toMatchObject({ action: 'handover' });
  });

  it('⚠️ turns something that is not an object into a handover', () => {
    expect(validateDecision(null, DOCS)).toMatchObject({ action: 'handover' });
    expect(validateDecision('hello', DOCS)).toMatchObject({ action: 'handover' });
  });

  it('keeps the model’s handover reason, and supplies one when it gives none', () => {
    expect(validateDecision({ action: 'handover', handover_reason: 'asked for a discount' }, DOCS).handoverReason)
      .toBe('asked for a discount');
    expect(validateDecision({ action: 'handover' }, DOCS).handoverReason).toMatch(/not sure/);
  });

  it('ignores a product we do not sell', () => {
    expect(validateDecision({ action: 'reply', reply: 'x', product: 'taskly-crm' }, DOCS).product).toBeNull();
  });
});

describe('buildAgentPrompt', () => {
  const brief = {
    business: 'CNI AI & Digital Division',
    product: 'crm',
    clientFirstName: 'Ayesha',
    stage: 'contacted',
    knowledge: [{ question: 'What is the CRM?', answer: 'A lead management system.' }],
    pilotRules: ['Always say sir or ma’am.'],
    documents: [{ id: 'doc-proposal', title: 'CRM Proposal', kind: 'brochure', product: 'crm' }],
    thread: [{ direction: 'inbound', kind: 'text', body: 'Tell me about the CRM', file: null, byAgent: false }],
  };

  it('fences the salesperson’s rules off as style, never facts', () => {
    const p = buildAgentPrompt(brief);
    expect(p).toContain('STYLE — how to write only. These are NOT facts');
    expect(p).toContain('Always say sir or ma’am.');
  });

  it('gives the knowledge and the documents by id', () => {
    const p = buildAgentPrompt(brief);
    expect(p).toContain('A: A lead management system.');
    expect(p).toContain('id=doc-proposal');
  });

  it('tags every answer with its product, and marks a file already sent', () => {
    const p = buildAgentPrompt({
      ...brief,
      knowledge: [
        { question: 'What is the CRM?', answer: 'Lead management.', product: 'crm' },
        { question: 'Can products merge?', answer: 'Yes.', product: 'any' },
      ],
      documents: [{ ...brief.documents[0], alreadySent: true }],
    });
    expect(p).toContain('1. [crm] Q: What is the CRM?');
    expect(p).toContain('2. [all products] Q: Can products merge?');
    expect(p).toContain('product=crm | ALREADY SENT');
  });

  it('says what a document is in words — "brochure" alone does not say proposal', () => {
    const p = buildAgentPrompt({ ...brief, documents: [...brief.documents, { id: 'doc-any', title: 'Company profile', kind: 'other', product: 'any' }] });
    expect(p).toContain('CRM Proposal | proposal / brochure | product=crm');
    expect(p).toContain('Company profile | other document | product=all products');
  });

  it('says so plainly when there is no knowledge, rather than leaving a gap', () => {
    expect(buildAgentPrompt({ ...brief, knowledge: [] })).toContain('(none)');
  });
});
