import { describe, expect, it } from 'vitest';

import { holdingLine, socialKind, socialReply } from '@/lib/domain/crm-agent-social';

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

/* ============================================================================
 * WHAT THE CLIENT IS TOLD WHEN A PERSON TAKES OVER — owner, 2026-09-21
 * ----------------------------------------------------------------------------
 * *"'For any change of appointment our team will contact you' — this type of
 * message must be sent to the client and then handed over to the same person."*
 * ========================================================================= */

describe('the holding line', () => {
  it('⚠️ promises to arrange it only when they asked to CHANGE it', () => {
    for (const reason of [
      'Client wants to change the time of an already booked appointment.',
      'wants to change or add to the office visit on Wednesday 23 September at 3:00 PM they already have',
      'Client wants to cancel an appointment.',
      'wants to reschedule the demo',
    ]) {
      expect(holdingLine(reason), reason).toBe(
        'Noted. For any change to your appointment, our team will contact you shortly to arrange it.',
      );
    }
  });

  it('⚠️ never answers a question about the time with a line about a change', () => {
    /* Owner, 2026-09-22, from the live thread: the client wrote *"Meri aj
       appointment kitny bjy ha?"* and *"Mujy time pta krna ha srf"*, and was
       told twice that we would contact them about a change. The assistant
       answers this itself now; if it ever cannot, the line must at least be
       about the time they asked for. */
    for (const reason of [
      'Client wants to confirm an appointment time.',
      'The client is asking for confirmation of a site visit appointment.',
      'asks what time the meeting is',
    ]) {
      const line = holdingLine(reason);
      expect(line, reason).not.toMatch(/for any change/i);
      expect(line, reason).toMatch(/exact time/);
    }
  });

  it('answers a request for a person by saying one is coming', () => {
    expect(holdingLine('asked to speak to a person')).toMatch(/passing you to my colleague/);
  });

  it('⚠️ a topic beats the word "salesperson" in the model’s reason', () => {
    /* Found by the Test agent drawer, 2026-09-22: a discount question got
       "I am passing you to my colleague" because the reason ended "which
       requires a salesperson to handle". */
    expect(holdingLine('Client is asking for a discount, which requires a salesperson to handle.'))
      .toMatch(/get back to you/);
    expect(holdingLine('Client is ready to buy now and needs a salesperson.')).not.toMatch(/passing you/);
  });

  it('never promises anything about price, only that somebody will come back', () => {
    const line = holdingLine('Client is asking for a discount.');
    expect(line).toMatch(/get back to you/);
    expect(line).not.toMatch(/\d/);
  });

  it('says what it could not read, when that is the reason', () => {
    expect(holdingLine('sent a voice note — the assistant cannot listen to it')).toMatch(/voice note/);
    expect(holdingLine('sent a photo — the assistant cannot see it')).toMatch(/look at this/);
  });

  it('always says something, whatever the reason was', () => {
    for (const reason of [null, '', 'the assistant was not sure how to answer', 'nothing is approved for the assistant to say yet']) {
      expect(holdingLine(reason).length, String(reason)).toBeGreaterThan(20);
    }
  });
});
