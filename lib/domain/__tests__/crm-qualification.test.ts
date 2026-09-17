import { describe, expect, it } from 'vitest';

import {
  BANT_QUESTIONS,
  bantQuestions,
  isQualified,
  qualificationGaps,
  qualificationStarted,
  suggestTemperature,
  type Bant,
} from '@/lib/domain/crm-qualification';

/* ============================================================================
 * THE GATE IN FRONT OF `qualified`, AND WHAT THE ANSWERS IMPLY
 * ----------------------------------------------------------------------------
 * Migration 167's trigger enforces the same rule in the database. These tests
 * are the form's copy of it — so somebody is told what is missing while they can
 * still fix it, rather than refused after filling a panel in.
 * ========================================================================= */

const NOTHING: Bant = { budgetBand: null, authority: null, purpose: null, timeline: null };
const FULL: Bant = {
  budgetBand: '4m_to_6m',
  authority: 'sole_decider',
  purpose: 'build_to_live',
  timeline: 'within_1_month',
};

describe('what the gate asks for', () => {
  it('names every missing answer, not just the first', () => {
    /* A form that reveals one problem at a time is a form somebody submits four
       times. Same stance as `outcomeProblems`. */
    expect(qualificationGaps(NOTHING)).toHaveLength(4);
  });

  it('opens once all four are recorded', () => {
    expect(qualificationGaps(FULL)).toEqual([]);
    expect(isQualified(FULL)).toBe(true);
  });

  it('⚠️ counts "not disclosed" and "unknown" as ANSWERED', () => {
    /* The gate refuses never having ASKED. A client who will not name a budget
       is a fact about the lead, not a reason to block the salesperson — and if
       the only way through were a real number, people would invent one. */
    const asked: Bant = {
      budgetBand: 'not_disclosed',
      authority: 'unknown',
      purpose: 'unknown',
      timeline: 'unknown',
    };

    expect(isQualified(asked)).toBe(true);
  });

  it('is still shut with three of four', () => {
    expect(isQualified({ ...FULL, authority: null })).toBe(false);
    expect(qualificationGaps({ ...FULL, authority: null })).toEqual(['Who decides?']);
  });

  it('tells "never started" apart from "part way"', () => {
    /* So the drawer says "Not qualified yet" on an untouched lead rather than
       the more alarming "1 of 4". */
    expect(qualificationStarted(NOTHING)).toBe(false);
    expect(qualificationStarted({ ...NOTHING, timeline: 'just_exploring' })).toBe(true);
  });
});

describe('the order the questions are asked in', () => {
  it('⚠️ opens with timeline and closes with authority', () => {
    /* Not the acronym's order, deliberately. Timeline is the least intrusive
       question and the strongest predictor — "just exploring" saves you the other
       three. Authority is the most intrusive and only works once there is
       rapport, which is why it is last despite saving the most deals. */
    expect(BANT_QUESTIONS[0].field).toBe('timeline');
    expect(BANT_QUESTIONS[BANT_QUESTIONS.length - 1].field).toBe('authority');
  });

  it('every question carries something to actually say out loud', () => {
    /* `ask` is the wording a salesperson can read to a client. A field label is
       not a question, and the gap between them is where scripts die. */
    for (const q of BANT_QUESTIONS) {
      expect(q.ask.length).toBeGreaterThan(20);
      expect(q.options.length).toBeGreaterThan(1);
    }
  });
});

describe('⚠️ which questions a lead is actually asked', () => {
  /* The owner caught this as a real fault: every demo lead arrives on an ERP,
     CRM or Taskly form and was being asked whether they wanted the plot for
     investment or to build a house on. */
  const property = bantQuestions('property');
  const service = bantQuestions('service');

  it('asks the same four axes either way — the gate does not move', () => {
    expect(service.map((q) => q.field)).toEqual(property.map((q) => q.field));
  });

  it('⚠️ offers software money to a service lead, not plot money', () => {
    const budget = service.find((q) => q.field === 'budgetBand')!;

    /* A CRM priced at 2 lakh offered "20-40 lakh · over a crore" has exactly one
       usable band, so every answer is the same answer. */
    expect(budget.options).toContain('svc_1l_to_3l');
    expect(budget.options).not.toContain('over_10m');
  });

  it('and plot money to a property lead', () => {
    const budget = property.find((q) => q.field === 'budgetBand')!;

    expect(budget.options).toContain('6m_to_10m');
    expect(budget.options).not.toContain('svc_under_50k');
  });

  it('⚠️ asks WHICH SERVICE rather than investment-or-build', () => {
    const need = service.find((q) => q.field === 'purpose')!;

    expect(need.options).toContain('svc_erp');
    expect(need.options).toContain('svc_whatsapp_automation');
    expect(need.options).not.toContain('build_to_live');
    expect(need.label.toLowerCase()).toContain('service');
  });

  it('changes the words, not only the values', () => {
    /* "Are you looking to buy soon" is wrong for somebody buying software. */
    const t = (qs: typeof property) => qs.find((q) => q.field === 'timeline')!.ask;
    expect(t(service)).not.toBe(t(property));
    expect(t(service).toLowerCase()).toContain('running');
  });

  it('⚠️ "decides with family" becomes "decides with partners" for a business', () => {
    const a = service.find((q) => q.field === 'authority')!;
    expect(a.labelOf('shares_decision')).toBe('Decides with partners');
    expect(BANT_QUESTIONS.find((q) => q.field === 'authority')!.labelOf('shares_decision'))
      .toBe('Decides with family');
  });

  it('⚠️ mixed falls back to property rather than guessing', () => {
    /* With no campaign and no attached item there is genuinely nothing to go on,
       and a wrong guess at least stays in the scale the catalogue is priced in. */
    expect(bantQuestions('mixed').find((q) => q.field === 'budgetBand')!.options)
      .toEqual(property.find((q) => q.field === 'budgetBand')!.options);
  });
});

describe('the temperature it suggests', () => {
  it('buying within a month, decides alone, budget stated → hot', () => {
    const { temperature, reasons } = suggestTemperature(FULL);

    expect(temperature).toBe('hot');
    expect(reasons.join(' ')).toContain('within a month');
  });

  it('⚠️ just exploring can never be hot, however good the rest looks', () => {
    /* Somebody with a crore who decides alone and is not buying this year is a
       fine lead — for next quarter. Hot means CLOSEABLE NOW, so it is capped, not
       zeroed: marking them cold is how a pipeline gets thrown away. */
    const browsing: Bant = { ...FULL, timeline: 'just_exploring', budgetBand: 'over_10m' };

    expect(suggestTemperature(browsing).temperature).toBe('warm');
  });

  it('and with weak signals alongside it, exploring does fall to cold', () => {
    expect(
      suggestTemperature({
        budgetBand: 'not_disclosed',
        authority: 'unknown',
        purpose: 'unknown',
        timeline: 'just_exploring',
      }).temperature,
    ).toBe('cold');
  });

  it('⚠️ somebody who cannot sign is never hot either', () => {
    /* Same cap, same reason: you cannot close with a person who has to go and
       ask. They are one introduction away from being hot, which is warm. */
    const proxy = suggestTemperature({ ...FULL, authority: 'not_the_decider' });

    expect(proxy.temperature).toBe('warm');
    expect(proxy.reasons.join(' ')).toContain('not the decision-maker');
  });

  it('⚠️ refusing to give a budget is neutral, never negative', () => {
    /* Plenty of serious buyers will not name a number to a stranger on WhatsApp.
       Scoring that as a negative would mark the cautious wealthy as cold — so
       somebody buying this month who decides alone stays HOT without it. The
       budget is a qualifier, not the qualifier. */
    const quiet = suggestTemperature({ ...FULL, budgetBand: 'not_disclosed' });

    expect(quiet.temperature).toBe('hot');
    expect(quiet.reasons.join(' ')).toContain('would not give a budget');
  });

  it('four recorded unknowns → cold, and says why in words', () => {
    const blank = suggestTemperature({
      budgetBand: 'not_disclosed',
      authority: 'unknown',
      purpose: 'unknown',
      timeline: 'unknown',
    });

    expect(blank.temperature).toBe('cold');
    /* ⚠️ Never a bare verdict with no reason — that reads as a judgement rather
       than as the absence of one. */
    expect(blank.reasons.length).toBeGreaterThan(0);
  });

  it('never returns an empty reason list, for any combination', () => {
    for (const q of BANT_QUESTIONS) {
      for (const option of q.options) {
        const { reasons } = suggestTemperature({ ...NOTHING, [q.field]: option } as Bant);
        expect(reasons.length).toBeGreaterThan(0);
      }
    }
  });

  it('⚠️ the explanation never contradicts the verdict', () => {
    /* THE BUG THIS TEST EXISTS FOR. Ranking reasons by weight alone hid the very
       signal that decided the answer: a lead capped down to warm for having no
       decision-maker was explained by three reasons that all argue for hot.
       Whenever a cap fires, the reason it fired must be visible. */
    for (const capped of [
      { ...FULL, authority: 'not_the_decider' },
      { ...FULL, timeline: 'just_exploring' },
    ] as Bant[]) {
      const { temperature, reasons } = suggestTemperature(capped);

      expect(temperature).toBe('warm');
      const why = reasons.join(' ');
      expect(why === '' ? '' : why).toMatch(/not the decision-maker|still just exploring/);
    }
  });

  it('caps the reasons at three, strongest first', () => {
    /* A reason list nobody reads is the same as no reason at all. */
    expect(suggestTemperature(FULL).reasons.length).toBeLessThanOrEqual(3);
  });
});
