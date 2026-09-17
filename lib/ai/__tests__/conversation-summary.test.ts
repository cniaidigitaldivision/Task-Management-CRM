import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildConversationBrief,
  summariseConversation,
  summaryFingerprint,
  type SummaryMessage,
} from '@/lib/ai/conversation-summary';

const msg = (o: Partial<SummaryMessage>): SummaryMessage => ({
  direction: 'inbound',
  channel: 'whatsapp',
  subject: null,
  body: 'hello',
  mediaFilename: null,
  status: 'delivered',
  occurredAt: '2026-09-12T05:00:00.000Z',
  sentByName: null,
  ...o,
});

describe('buildConversationBrief', () => {
  it('marks each side, and never shows a message that failed to send', () => {
    const brief = buildConversationBrief({
      leadName: 'Faisal Rehman',
      projectName: 'Demo [demo]',
      stage: 'quotation_sent',
      notes: [],
      messages: [
        msg({ body: 'Can you explain the payment plan?' }),
        msg({ direction: 'outbound', sentByName: 'Sahad', body: 'Of course.' }),
        /* ⚠️ The client never saw this — a summary built on it would say we
           offered a discount we did not. */
        msg({ direction: 'outbound', body: 'Discount 10 lakh', status: 'failed' }),
      ],
    });
    expect(brief).toContain('CLIENT] Can you explain the payment plan?');
    expect(brief).toContain('US (Sahad)] Of course.');
    expect(brief).not.toContain('Discount 10 lakh');
  });

  it('keeps only the newest sixty messages and says how many it left out', () => {
    const messages = Array.from({ length: 75 }, (_, i) => msg({ body: `message ${i}` }));
    const brief = buildConversationBrief({
      leadName: null, projectName: 'P', stage: 'new', notes: [], messages,
    });
    expect(brief).toContain('(15 earlier messages not shown)');
    expect(brief).not.toContain('message 14]');
    expect(brief).toContain('message 74');
  });
});

describe('summaryFingerprint', () => {
  it('moves when a message or a note arrives', () => {
    const a = summaryFingerprint({ messageCount: 4, lastMessageId: 'x', noteCount: 0 });
    expect(summaryFingerprint({ messageCount: 5, lastMessageId: 'y', noteCount: 0 })).not.toBe(a);
    expect(summaryFingerprint({ messageCount: 4, lastMessageId: 'x', noteCount: 1 })).not.toBe(a);
  });
});

describe('summariseConversation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const answer = (content: unknown) =>
    vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    })));

  it('reads points whether the kind is a field or the key — gpt-4o has sent both', async () => {
    vi.stubEnv('CHATGPT_API_KEY', 'test');
    vi.stubGlobal('fetch', answer({
      overview: 'Wants the plot.',
      points: [
        { kind: 'agreed', text: 'Site visit on Sunday at 11 AM' },
        /* The shape the first live call actually returned. */
        { they_said: 'Budget is 40 lakh' },
        { kind: 'invented', text: 'dropped' },
        { kind: 'open', text: 42 },
      ],
    }));
    const s = await summariseConversation('brief');
    expect(s.points).toEqual([
      { kind: 'agreed', text: 'Site visit on Sunday at 11 AM' },
      { kind: 'they_said', text: 'Budget is 40 lakh' },
    ]);
  });

  it('holds each heading to five points', async () => {
    vi.stubEnv('CHATGPT_API_KEY', 'test');
    vi.stubGlobal('fetch', answer({
      overview: 'x',
      points: Array.from({ length: 8 }, (_, i) => ({ kind: 'we_said', text: `point ${i}` })),
    }));
    expect((await summariseConversation('brief')).points).toHaveLength(5);
  });

  it('says which thing is missing when there is no key, rather than returning nothing', async () => {
    vi.stubEnv('CHATGPT_API_KEY', '');
    await expect(summariseConversation('brief')).rejects.toThrow(/CHATGPT_API_KEY/);
  });
});
