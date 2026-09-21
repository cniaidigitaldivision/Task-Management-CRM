import { describe, expect, it } from 'vitest';

import { DELIVERY_CHOICES, PURPOSE_CARDS, suggestedPlan } from '../crm-followup-plans';

/* ============================================================================
 * 234 · NO FOLLOW-UP WAITS FOR REVIEW
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"If I am scheduling any follow-up it means that I have
 * reviewed it and I am intentionally putting that follow-up. Don't put any
 * follow-up in the review furthermore."*
 *
 * The database half is 234's self-check (no function can write review_first,
 * nothing is waiting in it). This is the screen's half.
 * ========================================================================= */

describe('no follow-up waits for review', () => {
  it('the wizard offers Auto-send and Remind me, and no draft to review', () => {
    expect(DELIVERY_CHOICES.map((d) => d.key)).toEqual(['auto_send', 'remind_me']);
  });

  it('every suggested plan sends its messages itself unless told otherwise', () => {
    for (const card of PURPOSE_CARDS) {
      for (const step of suggestedPlan(card.key)) {
        expect(step.mode, `${card.key} · ${step.title}`).not.toBe('review_first');
        if (step.channel === 'whatsapp' || step.channel === 'email') {
          expect(step.mode, `${card.key} · ${step.title}`).toBe('auto_send');
        }
      }
    }
  });
});
