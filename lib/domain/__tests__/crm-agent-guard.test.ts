import { describe, expect, it } from 'vitest';

import { handoverBeforeModel } from '../crm-agent-guard';

/* ============================================================================
 * WHEN THE AGENT HANDS OVER WITHOUT ASKING ANY MODEL
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"If anything is in our voice and all that stuff, it will be
 * handed over and a red mark will appear."* These are the cases decided by rule,
 * so they are tested as rules.
 * ========================================================================= */

const text = (body: string, agentRunLength = 0) => ({ kind: 'text', body, voice: false, agentRunLength });

describe('handoverBeforeModel', () => {
  it('hands over a voice note, and says why', () => {
    expect(handoverBeforeModel({ kind: 'audio', body: null, voice: true, agentRunLength: 0 }))
      .toBe('sent a voice note — the assistant cannot listen to it');
  });

  it('⚠️ hands over a photo even with a caption — it never saw the photo', () => {
    expect(handoverBeforeModel({ kind: 'image', body: 'is this the one?', voice: false, agentRunLength: 0 }))
      .toMatch(/photo/);
  });

  it('hands over a document the client sent', () => {
    expect(handoverBeforeModel({ kind: 'document', body: null, voice: false, agentRunLength: 0 })).toMatch(/document/);
  });

  it.each([
    'Can you call me?',
    'please give me a call',
    'I want to talk to a person',
    'can I speak with your manager',
    'is there a real person there',
    'are you a bot?',
    'mujhe kisi insaan se baat karwa dein',
    'aap call karein please',
  ])('hands over "%s" — they asked for a person', (msg) => {
    expect(handoverBeforeModel(text(msg))).toBe('asked to speak to a person');
  });

  it.each([
    'Give me more detail about the CRM',
    'What does it cost?',
    'send me the proposal',
    'I run a clothing business with 12 staff',
    'CRM ki details bhej dein',
  ])('lets the model answer "%s"', (msg) => {
    expect(handoverBeforeModel(text(msg))).toBeNull();
  });

  it('⚠️ never stops a long conversation — that is the whole point of it', () => {
    /* ⚠️ NO CEILING ANY MORE (owner, 2026-09-22): the agent keeps the client
       engaged until a salesperson steps in. It only ever answers an inbound
       message, so a long run means the client wrote that many times. */
    expect(handoverBeforeModel(text('and what about reports?', 7))).toBeNull();
    expect(handoverBeforeModel(text('and what about reports?', 40))).toBeNull();
  });

  it('hands over an empty message rather than guessing at it', () => {
    expect(handoverBeforeModel(text('   '))).toBe('sent an empty message');
  });
});
