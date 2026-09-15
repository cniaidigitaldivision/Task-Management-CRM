/* ============================================================================
 * THE OUTCOME RULES
 * ----------------------------------------------------------------------------
 * These are the owner's own rules from the Phase 1 spec, and they are the kind
 * that only break in production: each one is about a combination somebody
 * reaches on a Tuesday afternoon, not about a shape the type system can see.
 * ========================================================================= */
import { describe, expect, it } from 'vitest';

import { OUTCOMES, outcomeProblems, suggestStage } from '@/lib/domain/crm-outcomes';
import { STAGE_ORDER } from '@/lib/domain/crm-stages';

const base = {
  outcome: 'interested',
  stage: 'qualified',
  nextActionAt: '2026-09-20T10:00:00.000Z',
  nextAction: 'Call back',
  lostReason: null as string | null,
  contactConfirmed: false,
};

describe('every outcome has a word and a suggestion', () => {
  it('covers the owner\'s eight, and no invented ones', () => {
    expect([...OUTCOMES].sort()).toEqual(
      [
        'booking_confirmed',
        'call_later',
        'client_replied',
        'interested',
        'no_response',
        'not_interested',
        'site_visit_requested',
        'wrong_contact',
      ].sort(),
    );
  });

  it('only ever suggests a stage that exists', () => {
    for (const o of OUTCOMES) {
      for (const s of STAGE_ORDER) {
        expect(STAGE_ORDER).toContain(suggestStage(o, s));
      }
    }
  });
});

describe('the suggestion never goes backwards', () => {
  it('⚠️ leaves a lead in negotiation where it is when they say "interested"', () => {
    /* The bug this prevents: "interested" suggests `qualified`, which is BEHIND
       negotiation. Taking the suggestion would silently undo a stage somebody
       moved by hand, and the salesperson would find their lead demoted after
       recording good news. */
    expect(suggestStage('interested', 'negotiation')).toBe('negotiation');
    expect(suggestStage('client_replied', 'quotation_sent')).toBe('quotation_sent');
  });

  it('does advance a lead that is genuinely behind', () => {
    expect(suggestStage('interested', 'new')).toBe('qualified');
    expect(suggestStage('site_visit_requested', 'contacted')).toBe('visit_scheduled');
  });

  it('⚠️ but the two exits close from anywhere', () => {
    /* `won` and `lost` are not "further along", they are OUT — and "not
       interested" has to be able to close a lead at any point in the funnel. */
    expect(suggestStage('not_interested', 'negotiation')).toBe('lost');
    expect(suggestStage('not_interested', 'new')).toBe('lost');
    expect(suggestStage('booking_confirmed', 'contacted')).toBe('won');
  });
});

describe('what the form must refuse', () => {
  it('⚠️ "call later" with no time — the time IS the outcome', () => {
    const problems = outcomeProblems({ ...base, outcome: 'call_later', nextActionAt: null });
    expect(problems.some((p) => p.includes('call back'))).toBe(true);
  });

  it('⚠️ a lost lead with no reason', () => {
    const problems = outcomeProblems({
      ...base,
      outcome: 'not_interested',
      stage: 'lost',
      lostReason: null,
    });
    expect(problems.some((p) => p.includes('reason'))).toBe(true);
  });

  it('⚠️ "wrong contact" until the number has actually been checked', () => {
    /* A mistyped digit looks exactly like a wrong number, and closing the lead
       hides a real person who did ask to be contacted. */
    const problems = outcomeProblems({
      ...base,
      outcome: 'wrong_contact',
      stage: 'lost',
      lostReason: 'wrong_number',
      contactConfirmed: false,
    });
    expect(problems.some((p) => p.includes('checked'))).toBe(true);

    const ok = outcomeProblems({
      ...base,
      outcome: 'wrong_contact',
      stage: 'lost',
      lostReason: 'wrong_number',
      contactConfirmed: true,
    });
    expect(ok).toHaveLength(0);
  });

  it('⚠️ an open lead leaving the form with nothing planned', () => {
    /* The owner's own rule, and the one that keeps the desk honest: a lead with
       no next action is one that goes quiet. */
    const problems = outcomeProblems({ ...base, nextAction: '   ' });
    expect(problems.some((p) => p.includes('next action'))).toBe(true);
  });

  it('but a CLOSED lead needs no next action', () => {
    /* Requiring one on a won deal would put it back on somebody's "due today"
       every morning forever. */
    expect(
      outcomeProblems({
        ...base,
        outcome: 'booking_confirmed',
        stage: 'won',
        nextAction: '',
        nextActionAt: null,
      }),
    ).toHaveLength(0);
  });

  it('names the field rather than saying "invalid"', () => {
    /* Every problem is a sentence somebody can act on without guessing which
       control it is about. */
    for (const p of outcomeProblems({ ...base, outcome: 'call_later', nextActionAt: null })) {
      expect(p.length).toBeGreaterThan(20);
      expect(p).not.toMatch(/invalid|error/i);
    }
  });
});
