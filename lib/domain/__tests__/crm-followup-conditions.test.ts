import { describe, expect, it } from 'vitest';

import {
  editFrom,
  isDefault,
  isUnchanged,
  liveChecks,
  shown,
  toggle,
  verdict,
  type FollowUpConditions,
} from '@/lib/domain/crm-followup-conditions';

/* ============================================================================
 * FOLLOW-UP CONDITIONS — owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"Right now it should be set to the default, according to the default setting
 * of follow-up, but if I want to change I can change it over here and it will
 * implement accordingly."*
 *
 * ⚠️ THE DEFAULTS THEMSELVES ARE NOT TESTED HERE — they live in
 * `app.crm_followup_default_conditions` and are checked by 247's own self-check,
 * because the SEND GATE reads them. What is tested here is the one thing this
 * layer decides: that "default" survives being looked at.
 * ========================================================================= */

const conds = (over: Partial<FollowUpConditions> = {}): FollowUpConditions => ({
  followUpId: 'fu-1',
  purpose: 'quotation',
  noReply: true,
  quoteValid: true,
  notBooked: true,
  noReplyDefault: true,
  quoteValidDefault: true,
  notBookedDefault: true,
  onReply: 'hold',
  onOptOut: 'stop_sales',
  onQuoteExpired: 'hold',
  maxAttempts: 8,
  retryGapMinutes: 10,
  attemptsSoFar: 0,
  okNoReply: true,
  okQuoteValid: true,
  okNotBooked: true,
  okLeadOpen: true,
  okConsent: true,
  quotationNumber: 'QT-1042',
  quotationStatus: 'approved',
  quoteValidUntil: '2026-09-30T00:00:00.000Z',
  leadStage: 'quotation_sent',
  bookedAt: null,
  ...over,
});

describe('opening the dialog', () => {
  it('⚠️ opens on "default", and does not pin the row to today’s default', () => {
    /* Copying the resolved value into the row would freeze it: a later change
       to the purpose default would reach every row except the ones somebody
       had merely LOOKED at. */
    const e = editFrom(conds());
    expect(e.noReply).toBeNull();
    expect(e.quoteValid).toBeNull();
    expect(e.notBooked).toBeNull();
    expect(isDefault(e, 'noReply')).toBe(true);
  });

  it('keeps a real override as an override', () => {
    const e = editFrom(conds({ noReply: false, noReplyDefault: true }));
    expect(e.noReply).toBe(false);
    expect(isDefault(e, 'noReply')).toBe(false);
  });

  it('shows the default value while it is still the default', () => {
    const c = conds({ notBooked: false, notBookedDefault: false });
    const e = editFrom(c);
    expect(shown(e, c, 'notBooked')).toBe(false);
  });
});

describe('moving a switch', () => {
  it('writes an explicit value, and clears it again when it matches the default', () => {
    const c = conds();
    let e = editFrom(c);
    e = toggle(e, c, 'noReply');
    expect(e.noReply).toBe(false);
    expect(isDefault(e, 'noReply')).toBe(false);

    e = toggle(e, c, 'noReply');
    expect(e.noReply).toBeNull();
    expect(isDefault(e, 'noReply')).toBe(true);
  });

  it('knows whether anything was actually changed', () => {
    const c = conds();
    const first = editFrom(c);
    expect(isUnchanged(first, editFrom(c))).toBe(true);
    expect(isUnchanged(first, toggle(first, c, 'quoteValid'))).toBe(false);
    expect(isUnchanged(first, { ...first, maxAttempts: 3 })).toBe(false);
  });
});

describe('the live column', () => {
  it('⚠️ never shows a tick for a check nobody is applying', () => {
    const checks = liveChecks(conds({ quoteValid: false, okQuoteValid: false }));
    const quote = checks.find((k) => k.label === 'Quotation valid')!;
    expect(quote.applied).toBe(false);
    /* Its `pass` may be anything; what matters is that the screen can tell
       "not applied" from "passes", and does not draw a tick either way. */
    const open = checks.find((k) => k.label === 'Lead still open')!;
    expect(open.applied).toBe(true);
  });

  it('says what is true, in the words a person would use', () => {
    const k = liveChecks(conds({ okNoReply: false }));
    expect(k[0].pass).toBe(false);
    expect(k[0].detail).toMatch(/waiting on us/);
    const booked = liveChecks(conds({ bookedAt: '2026-09-23T10:00:00.000Z' }))[2];
    expect(booked.detail).toMatch(/Already booked/);
  });

  it('names the quotation and when it runs out', () => {
    expect(liveChecks(conds())[1].detail).toMatch(/QT-1042 is approved \(until 30 Sep 2026\)/);
  });

  it('is honest when there is no quotation at all', () => {
    expect(liveChecks(conds({ quotationNumber: null, quotationStatus: null, quoteValidUntil: null }))[1].detail)
      .toMatch(/No quotation/);
  });
});

describe('the verdict', () => {
  it('says it will send when every check it is given passes', () => {
    expect(verdict(conds())).toEqual({ willSend: true, because: 'every check it is given passes' });
  });

  it('⚠️ names the checks that would stop it, not a number', () => {
    const v = verdict(conds({ okNoReply: false, bookedAt: '2026-09-23T10:00:00.000Z', okNotBooked: false }));
    expect(v.willSend).toBe(false);
    expect(v.because).toBe('no new reply and nothing booked yet would stop it');
  });

  it('ignores a failing check that is switched off', () => {
    expect(verdict(conds({ noReply: false, okNoReply: false })).willSend).toBe(true);
  });

  it('⚠️ counts the retries, because the gate does', () => {
    const v = verdict(conds({ attemptsSoFar: 8, maxAttempts: 8 }));
    expect(v.willSend).toBe(false);
    expect(v.because).toMatch(/attempted 8 times/);
  });

  it('an appointment reminder sends even though the visit is booked', () => {
    /* The purpose default that matters most: the reminder is ABOUT the booking
       (247's self-check asserts the SQL side of this). */
    const reminder = conds({
      purpose: 'appointment_reminder',
      noReply: false,
      quoteValid: false,
      notBooked: false,
      noReplyDefault: false,
      quoteValidDefault: false,
      notBookedDefault: false,
      okNoReply: false,
      okNotBooked: false,
      bookedAt: '2026-09-23T10:00:00.000Z',
    });
    expect(verdict(reminder).willSend).toBe(true);
  });
});
