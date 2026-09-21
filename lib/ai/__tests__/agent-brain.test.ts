import { describe, expect, it } from 'vitest';

import { buildAgentPrompt, validateDecision } from '../agent-brain';

/* ============================================================================
 * WHAT THE AGENT IS ALLOWED TO DO WITH THE MODEL'S ANSWER
 * ----------------------------------------------------------------------------
 * JSON mode guarantees JSON, not the shape asked for (`json-mode-is-not-a-schema`),
 * so every answer is checked. The rule: anything the code cannot trust becomes a
 * handover to a person, never a guess sent to a client.
 * ========================================================================= */

const DOCS = new Set(['doc-proposal', 'doc-quotation']);

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
    expect(validateDecision({ action: 'reply', reply: 'x', follow_up: { purpose: 'quotation', in_days: 40 } }, DOCS).followUp)
      .toEqual({ purpose: 'quotation', inDays: 7 });
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

  it('says so plainly when there is no knowledge, rather than leaving a gap', () => {
    expect(buildAgentPrompt({ ...brief, knowledge: [] })).toContain('(none)');
  });
});
