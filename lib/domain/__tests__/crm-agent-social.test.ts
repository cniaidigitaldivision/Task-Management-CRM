import { describe, expect, it } from 'vitest';

import { socialKind, socialReply } from '@/lib/domain/crm-agent-social';

/* ============================================================================
 * THE AGENT TALKS LIKE A PERSON — owner, 2026-09-21
 * ----------------------------------------------------------------------------
 * The real messages that were handed over: "i want to know 1 thing" and
 * "ammm no thats it thankyou". Neither is a question a person would pass on.
 * ========================================================================= */

describe('what counts as social', () => {
  it('⚠️ the two messages that were handed over on 21 September', () => {
    expect(socialKind('i want to know 1 thing')).toBe('opener');
    expect(socialKind('ammm no thats it thankyou')).toBe('thanks');
    expect(socialKind('alright thanku')).toBe('thanks');
  });

  it('openers, in English and Roman Urdu', () => {
    for (const t of ['Hey I want to know one more thing.', 'one more question', 'can I ask something?', 'are you there?', 'mujhe ek baat poochni hai', 'kuch poochna hai']) {
      expect(socialKind(t), t).toBe('opener');
    }
  });

  it('greetings', () => {
    for (const t of ['hi', 'Hello!', 'AoA', 'Assalam o alaikum', 'good morning', 'hey there']) {
      expect(socialKind(t), t).toBe('greeting');
    }
  });

  it('thanks, wrap-ups, emoji and stickers', () => {
    for (const t of ['thank you so much', 'ok great', 'Shukriya', 'theek hai', 'JazakAllah khair', '👍', '🙏😊', 'ok thanks bye']) {
      expect(socialKind(t), t).toBe('thanks');
    }
    expect(socialKind(null, 'sticker')).toBe('thanks');
  });

  /* Live, 2026-09-21: a bare "?" was answered "You're welcome! 😊" — twice. */
  it('⚠️ punctuation alone is somebody wondering where we are, not a thank-you', () => {
    for (const t of ['?', '??', '...']) expect(socialKind(t), t).toBe('opener');
    expect(socialReply('opener', '?')).toBe('I’m here — how can I help?');
  });

  it('⚠️ a request that merely contains a social word is NOT social', () => {
    for (const t of ['ok send me the quotation', 'thanks, what is the price?', 'hi, do you have a CRM demo?', 'I want to know the price of the CRM', 'ok but can you call me', 'yes']) {
      expect(socialKind(t), t).toBeNull();
    }
  });

  it('a photo or a voice note is never social', () => {
    expect(socialKind('thanks', 'image')).toBeNull();
    expect(socialKind(null, 'audio')).toBeNull();
  });
});

describe('what a person would say back', () => {
  it('invites them to go on', () => {
    expect(socialReply('opener', 'i want to know 1 thing')).toBe('Sure, what would you like to know?');
    expect(socialReply('opener', 'mujhe ek baat poochni hai')).toMatch(/^Ji zaroor/);
  });

  it('returns the salam', () => {
    expect(socialReply('greeting', 'AoA')).toMatch(/^Wa alaikum assalam!/);
    expect(socialReply('greeting', 'hello')).toBe('Hello! How can I help you today?');
  });

  it('answers a thank-you warmly, with a smiley', () => {
    expect(socialReply('thanks', 'thank you')).toContain('😊');
    expect(socialReply('thanks', 'shukriya')).toMatch(/shukriya/i);
  });
});
