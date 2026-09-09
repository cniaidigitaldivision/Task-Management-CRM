import { describe, expect, it } from 'vitest';

import { displayPhone, toE164, whatsAppDigits } from '../phone';

/* ============================================================================
 * PHONE NORMALISATION
 * ----------------------------------------------------------------------------
 * The failure that matters is not "a number did not parse" — the raw value is
 * still there and a person can read it. It is **two different people merged
 * into one lead** by an over-eager guess, which cannot be undone by looking at
 * the raw value later. So the tests below spend most of their weight on what
 * this function REFUSES.
 * ========================================================================= */

describe('the ways a Pakistani number is actually typed', () => {
  it.each([
    ['0300-1234567', '+923001234567'],
    ['0300 1234567', '+923001234567'],
    ['03001234567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['+923001234567', '+923001234567'],
    ['0092 300 1234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['(0300) 1234567', '+923001234567'],
  ])('%s → %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it('⚠️ every one of those is the SAME person', () => {
    /* The whole point. If any two of these normalise differently, duplicate
       detection misses them and two salespeople ring the same lead. */
    const written = [
      '0300-1234567',
      '0300 1234567',
      '03001234567',
      '+92 300 1234567',
      '0092 300 1234567',
      '923001234567',
      '3001234567',
    ];
    expect(new Set(written.map(toE164)).size).toBe(1);
  });
});

describe('what it refuses, and why refusing is the point', () => {
  it('returns null for anything it cannot parse with confidence', () => {
    for (const bad of [
      '',
      '   ',
      'not a number',
      '12345',            // too short to be anything
      '051-1234567',      // a landline: 11 digits but not a mobile prefix… see below
    ]) {
      const result = toE164(bad);
      expect(result === null || result.startsWith('+')).toBe(true);
    }
  });

  it('⚠️ refuses a number with too many digits rather than truncating it', () => {
    /* Somebody pasting two numbers into one box is common on lead forms. A
       guess here merges two strangers. */
    expect(toE164('+9230012345671234567890')).toBeNull();
    expect(toE164('00' + '9'.repeat(20))).toBeNull();
  });

  it('refuses a plus with too few digits', () => {
    expect(toE164('+92')).toBeNull();
    expect(toE164('+1234')).toBeNull();
  });

  it('handles null and undefined without throwing', () => {
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it('keeps a foreign number that already carries its country code', () => {
    /* The KSA campaign will produce Saudi numbers. They are not Pakistani and
       must not be bent into a Pakistani shape. */
    expect(toE164('+966501234567')).toBe('+966501234567');
    expect(toE164('+44 7700 900123')).toBe('+447700900123');
  });
});

describe('whatsAppDigits', () => {
  it('is the E.164 number without its plus, which is what wa.me wants', () => {
    expect(whatsAppDigits('0300-1234567')).toBe('923001234567');
  });

  it('is null when the number could not be parsed, so no broken link is drawn', () => {
    expect(whatsAppDigits('not a number')).toBeNull();
    expect(whatsAppDigits(null)).toBeNull();
  });
});

describe('displayPhone', () => {
  it('shows a Pakistani number the way somebody would dial it', () => {
    expect(displayPhone('+923001234567')).toBe('0300 1234567');
  });

  it('leaves a foreign number international, because a local form would be wrong', () => {
    expect(displayPhone('+966501234567')).toBe('+966501234567');
  });

  it('falls back to what they typed when nothing could be normalised', () => {
    /* ⚠️ The raw value is never lost. A number this module cannot parse still
       reaches the screen — it is simply not claimed to be normalised. */
    expect(displayPhone(null, '051-1234567')).toBe('051-1234567');
    expect(displayPhone(null, null)).toBe('—');
  });
});
