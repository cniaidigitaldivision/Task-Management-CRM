import { describe, expect, it } from 'vitest';

import { nextSteps, type NextStepInput } from '@/lib/domain/crm-next-step';

const base: NextStepInput = {
  stage: 'contacted',
  lastDirection: 'outbound',
  planned: false,
  qualificationGaps: 0,
  hasQuotation: false,
};

const keys = (over: Partial<NextStepInput>) => nextSteps({ ...base, ...over }).map((s) => s.key);

describe('the owner’s case — Umm e e Habiba, 19 Sep', () => {
  it('suggests following up on the quotation, and asking the questions', () => {
    /* Quotation sent from the chat, nothing scheduled, no BANT recorded. */
    expect(keys({ stage: 'quotation_sent', qualificationGaps: 4 })).toEqual(['follow_quotation', 'qualify']);
  });

  it('says why, in words', () => {
    const [first] = nextSteps({ ...base, stage: 'quotation_sent' });
    expect(first.why).toContain('quotation went out');
  });
});

describe('a client waiting always comes first', () => {
  it('puts reply above everything, even with a plan in place', () => {
    expect(keys({ lastDirection: 'inbound', planned: true })[0]).toBe('reply');
  });

  it('still suggests the stage’s follow-up beside it when nothing is planned', () => {
    expect(keys({ stage: 'quotation_sent', lastDirection: 'inbound' })).toEqual(['reply', 'follow_quotation']);
  });
});

describe('it never suggests what is already planned', () => {
  it('drops the follow-up when one is scheduled', () => {
    expect(keys({ stage: 'quotation_sent', planned: true })).toEqual([]);
  });

  it('keeps the non-follow-up suggestions', () => {
    expect(keys({ stage: 'quotation_sent', planned: true, qualificationGaps: 2 })).toEqual(['qualify']);
  });
});

describe('each stage gets its own next step', () => {
  it.each([
    ['proposal_pending', 'follow_proposal'],
    ['visit_scheduled', 'remind_visit'],
    ['visited', 'after_visit'],
    ['negotiation', 'close'],
    ['nurture', 're_engage'],
  ])('%s -> %s', (stage, key) => {
    expect(keys({ stage })[0]).toBe(key);
  });

  it('asks for the first message when nobody has written', () => {
    expect(keys({ stage: 'new', lastDirection: null })).toEqual(['first_message']);
  });

  it('suggests a chase when we wrote last', () => {
    expect(keys({ stage: 'contacted' })).toEqual(['chase']);
  });

  it('suggests a quotation for a qualified lead without one', () => {
    expect(keys({ stage: 'qualified', planned: true })).toEqual(['quotation']);
    expect(keys({ stage: 'qualified', planned: true, hasQuotation: true })).toEqual([]);
  });
});

describe('limits', () => {
  it('never shows more than two', () => {
    expect(nextSteps({ ...base, stage: 'quotation_sent', lastDirection: 'inbound', qualificationGaps: 4 })).toHaveLength(2);
  });

  it('says nothing about a closed lead', () => {
    expect(keys({ stage: 'won', lastDirection: 'inbound' })).toEqual([]);
    expect(keys({ stage: 'lost' })).toEqual([]);
  });

  it('does not ask qualifying questions of somebody nobody has spoken to', () => {
    expect(keys({ stage: 'new', lastDirection: null, qualificationGaps: 4 })).toEqual(['first_message']);
  });
});
