import { describe, expect, it } from 'vitest';

import {
  activity,
  counts,
  coverage,
  gaps,
  healthByProduct,
  isKnowledgeGap,
  matches,
  NO_FILTERS,
  readiness,
  supportScore,
  supportTone,
  type DocumentLike,
  type EntryLike,
  type RunLike,
} from '@/lib/domain/crm-knowledge-health';

/* ============================================================================
 * THE NUMBERS ON THE AI KNOWLEDGE PAGE
 * ----------------------------------------------------------------------------
 * ⚠️ THE FIXTURE IS THE PROJECT'S REAL HISTORY — all eleven handovers and the
 * fifteen replies the demo project actually had on 2026-09-22, copied from
 * `crm_agent_runs`. A classifier tested only on sentences written to please it
 * is a classifier that passes and misfiles.
 * ========================================================================= */

const NOW = Date.parse('2026-09-22T10:00:00.000Z');

let n = 0;
const run = (action: string, reason: string | null, over: Partial<RunLike> = {}): RunLike => ({
  id: `r${(n += 1)}`,
  action,
  reason,
  createdAt: new Date(NOW - n * 60_000).toISOString(),
  leadId: 'lead-1',
  leadName: 'Umm e e Habiba',
  product: 'crm',
  question: null,
  ...over,
});

const REAL_HANDOVERS: Array<[string, boolean]> = [
  ['The client is asking for confirmation of a site visit appointment, which needs to be checked by a salesperson.', false],
  ['Client wants to confirm an appointment time.', false],
  ['Client wants digital marketing services, which is not covered by our products.', true],
  ['Client wants to discuss digital marketing services ASAP, which is not in our product line.', true],
  ['the assistant has sent 8 messages without a person — time for a salesperson', false],
  ['Client requests a conversation and specific role details not covered in KNOWLEDGE.', true],
  ['Client is asking about specific roles in CRM, which is not covered in the knowledge base.', true],
  ['Client is confused about CRM and may need detailed assistance.', false],
  ['Client wants to change the time of an already booked appointment.', false],
  ['Client wants to know something not specified yet.', false],
  ['Client may be ready to proceed or needs further personalized assistance.', false],
];

describe('which handovers are holes in the knowledge', () => {
  it('⚠️ agrees with every real handover this project has had', () => {
    for (const [reason, want] of REAL_HANDOVERS) {
      expect(isKnowledgeGap(run('handed_over', reason)), reason).toBe(want);
    }
  });

  it('⚠️ never counts a handover that is somebody’s job', () => {
    /* The fence working as the owner asked is not a gap in what we know, and
       counting it as one would push the team to approve answers about things
       they have decided a person must handle. */
    for (const reason of [
      'Client requested a phone call.',
      'Client is asking for a discount.',
      'Client wants to cancel an appointment.',
      'Client is asking for a decision on the quotation.',
      'Client is ready to buy now.',
    ]) {
      expect(isKnowledgeGap(run('handed_over', reason)), reason).toBe(false);
    }
  });

  it('a reply is never a gap, and neither is a handover with no reason', () => {
    expect(isKnowledgeGap(run('replied', null))).toBe(false);
    expect(isKnowledgeGap(run('handed_over', '  '))).toBe(false);
  });
});

describe('readiness', () => {
  const REAL = [
    ...Array.from({ length: 15 }, () => run('replied', null)),
    ...REAL_HANDOVERS.map(([reason]) => run('handed_over', reason)),
  ];

  it('⚠️ is measured, and matches what this project actually did', () => {
    /* 15 answered, 4 real gaps — 15/19. The other seven handovers were a
       person's job and are not counted either way. */
    const c = coverage(REAL);
    expect(c).toEqual({ answered: 15, gaps: 4, percent: 79 });
  });

  it('⚠️ is null when nothing has been asked, never a hopeful number', () => {
    expect(coverage([]).percent).toBeNull();
    expect(readiness(null)).toEqual({ label: 'Not asked yet', tone: 'grey' });
  });

  it('says in words what the number means', () => {
    expect(readiness(80).label).toBe('Ready');
    expect(readiness(60).label).toBe('Getting there');
    expect(readiness(20).label).toBe('Needs answers');
  });

  it('answers the same question per product', () => {
    const rows = [
      run('replied', null, { product: 'crm' }),
      run('handed_over', 'not covered in KNOWLEDGE', { product: 'crm' }),
      run('replied', null, { product: 'taskly' }),
    ];
    const health = healthByProduct(rows);
    expect(health.find((h) => h.product === 'crm')!.cover.percent).toBe(50);
    expect(health.find((h) => h.product === 'taskly')!.cover.percent).toBe(100);
    expect(health.find((h) => h.product === 'erp')!.cover.percent).toBeNull();
  });
});

describe('the gaps list', () => {
  it('⚠️ carries the client’s own words, not the model’s reason', () => {
    const rows = [
      run('handed_over', 'not covered in KNOWLEDGE', { question: 'How many roles will I have?' }),
      run('handed_over', 'Client asked about roles, which is not covered.', { question: 'How many roles will I have?' }),
    ];
    const list = gaps(rows);
    expect(list).toHaveLength(1);
    expect(list[0].question).toBe('How many roles will I have?');
    expect(list[0].asked).toBe(2);
  });

  it('falls back to the reason when the message is gone', () => {
    expect(gaps([run('handed_over', 'not covered by our products', { question: null })])[0].question)
      .toBe('not covered by our products');
  });

  it('is newest first', () => {
    const older = run('handed_over', 'not covered', { question: 'A?', createdAt: '2026-09-01T00:00:00.000Z' });
    const newer = run('handed_over', 'not covered', { question: 'B?', createdAt: '2026-09-20T00:00:00.000Z' });
    expect(gaps([older, newer]).map((g) => g.question)).toEqual(['B?', 'A?']);
  });
});

describe('how much of an answer the source supports', () => {
  it('⚠️ is null with no quote, never a zero that reads as a judgement', () => {
    expect(supportScore('Taskly is our task manager.', null)).toBeNull();
    expect(supportScore('Taskly is our task manager.', '   ')).toBeNull();
    expect(supportTone(null)).toBe('grey');
  });

  it('is high when the answer is drawn from the quote', () => {
    const quote = 'The CRM can trigger actions from record creation, updates and scheduled times.';
    const score = supportScore('The CRM can trigger actions from record creation.', quote);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(supportTone(score)).toBe('green');
  });

  it('is low when the answer says things the quote does not', () => {
    const score = supportScore('Deployment takes two weeks and includes free training forever.', 'The CRM stores leads.');
    expect(score).toBeLessThan(40);
    expect(supportTone(score)).toBe('red');
  });
});

describe('the five cards', () => {
  const entry = (over: Partial<EntryLike> & { id: string }): EntryLike => ({
    product: 'crm',
    question: 'What is Taskly?',
    answer: 'Taskly is our task and project management system.',
    sourceQuote: null,
    sourceTitle: 'CRM Proposal',
    status: 'approved',
    approvedByName: 'Sarah',
    approvedAt: '2026-09-22T05:00:00.000Z',
    expiresAt: null,
    createdAt: '2026-09-20T05:00:00.000Z',
    ...over,
  });
  const doc = (over: Partial<DocumentLike> & { id: string }): DocumentLike => ({
    title: 'CRM Proposal',
    mime: 'application/pdf',
    kind: 'brochure',
    product: 'crm',
    sizeBytes: 1024,
    createdAt: '2026-09-18T05:00:00.000Z',
    readAt: '2026-09-20T05:00:00.000Z',
    ...over,
  });

  it('counts what each card says it counts', () => {
    const c = counts(
      [entry({ id: '1' }), entry({ id: '2', status: 'draft' }), entry({ id: '3', status: 'rejected' })],
      [doc({ id: 'd1' }), doc({ id: 'd2', mime: 'image/png' })],
      [run('replied', null), run('handed_over', 'not covered in KNOWLEDGE', { question: 'Roles?' })],
      NOW,
    );
    expect(c.approved).toBe(1);
    expect(c.review).toBe(1);
    /* ⚠️ Sources are what the agent can READ. A PNG is not one. */
    expect(c.sources).toBe(1);
    expect(c.gaps).toBe(1);
    expect(c.readiness).toBe(50);
  });

  it('⚠️ an expired answer is not an approved one', () => {
    /* The agent's own door drops it, so counting it here would tell the team
       they are covered for something the agent will not say. */
    const c = counts([entry({ id: '1', expiresAt: '2026-09-01' })], [], [], NOW);
    expect(c.approved).toBe(0);
    expect(c.expired).toBe(1);
  });
});

describe('searching and filtering', () => {
  const e: EntryLike = {
    id: '1',
    product: 'crm',
    question: 'Can the CRM integrate with WhatsApp?',
    answer: 'Yes, the CRM can be integrated with WhatsApp.',
    sourceQuote: null,
    sourceTitle: 'CNI_AJ_Trading',
    status: 'approved',
    approvedByName: 'Sarah',
    approvedAt: null,
    expiresAt: null,
    createdAt: '2026-09-20T05:00:00.000Z',
  };

  it('searches the question, the answer and the source', () => {
    expect(matches(e, { ...NO_FILTERS, q: 'whatsapp' })).toBe(true);
    expect(matches(e, { ...NO_FILTERS, q: 'trading' })).toBe(true);
    expect(matches(e, { ...NO_FILTERS, q: 'invoice' })).toBe(false);
  });

  it('narrows by product and by source', () => {
    expect(matches(e, { ...NO_FILTERS, product: 'crm' })).toBe(true);
    expect(matches(e, { ...NO_FILTERS, product: 'erp' })).toBe(false);
    expect(matches(e, { ...NO_FILTERS, source: 'CNI_AJ_Trading' })).toBe(true);
    expect(matches(e, { ...NO_FILTERS, source: 'CRM Proposal' })).toBe(false);
  });
});

describe('the activity feed', () => {
  it('⚠️ is built from the rows themselves, and every line can be pointed at', () => {
    const feed = activity(
      [
        {
          id: 'e1', product: 'crm', question: 'What is Taskly?', answer: 'x', sourceQuote: null,
          sourceTitle: 'CRM Proposal', status: 'approved', approvedByName: 'Sarah',
          approvedAt: '2026-09-22T05:00:00.000Z', expiresAt: null, createdAt: '2026-09-20T05:00:00.000Z',
        },
      ],
      [
        {
          id: 'd1', title: 'CRM Proposal', mime: 'application/pdf', kind: 'brochure', product: 'crm',
          sizeBytes: 10, createdAt: '2026-09-18T05:00:00.000Z', readAt: '2026-09-19T05:00:00.000Z',
        },
      ],
      [run('handed_over', 'not covered in KNOWLEDGE', { question: 'Roles?', createdAt: '2026-09-21T05:00:00.000Z' })],
    );
    expect(feed.map((m) => m.kind)).toEqual(['approved', 'gap', 'read', 'uploaded']);
    expect(feed[0].who).toBe('Sarah');
  });
});
