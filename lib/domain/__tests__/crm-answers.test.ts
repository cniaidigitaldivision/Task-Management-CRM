import { describe, expect, it } from 'vitest';

import { humaniseAnswer, humaniseFieldKey, orderedAnswers } from '../crm-answers';

/* ============================================================================
 * ⚠️ EVERY KEY IN THIS FILE IS A REAL ONE, read off the live Chitral table on
 * 2026-09-10. Invented keys would test the tidy cases — the ones that made this
 * module necessary are `which__size_are_you_interested_in?_` and
 * `are_you_looking_for_plots_&_villa_?`, and neither is what anybody would have
 * made up.
 *
 * No lead VALUES appear here beyond the two machine choice-values, for the
 * reason 01-VERIFIED-FACTS gives: a lead is a stranger's name and number.
 * ========================================================================= */

describe('humaniseFieldKey', () => {
  it('turns a real Meta key into the question that was asked', () => {
    expect(humaniseFieldKey('which__size_are_you_interested_in?_')).toBe(
      'Which size are you interested in?',
    );
  });

  it('keeps an ampersand and pulls the question mark back onto the sentence', () => {
    expect(humaniseFieldKey('are_you_looking_for_plots_&_villa_?')).toBe(
      'Are you looking for plots & villa?',
    );
  });

  it('handles the plain standard fields', () => {
    expect(humaniseFieldKey('full_name')).toBe('Full name');
    expect(humaniseFieldKey('phone_number')).toBe('Phone number');
    expect(humaniseFieldKey('city')).toBe('City');
  });

  it('is sentence case, not title case', () => {
    /* A question is a sentence somebody asked, and the advertiser's own
       capitalisation inside it is left alone. */
    expect(humaniseFieldKey('what_is_your_budget_in_PKR?')).toBe('What is your budget in PKR?');
  });

  it('falls back to the raw key rather than to a placeholder', () => {
    /* ⚠️ A key made only of separators would otherwise render as an empty
       heading with an answer under it, which reads as a lost question. */
    expect(humaniseFieldKey('___')).toBe('___');
    expect(humaniseFieldKey('')).toBe('');
  });
});

describe('humaniseAnswer', () => {
  it('opens up a machine choice value', () => {
    expect(humaniseAnswer('10_marla_(commercial)')).toBe('10 marla (commercial)');
  });

  it('leaves a phone number and free text exactly as submitted', () => {
    expect(humaniseAnswer('+923211912132')).toBe('+923211912132');
    expect(humaniseAnswer('plots')).toBe('plots');
  });

  it('does not capitalise — the answer is the lead speaking, not us', () => {
    expect(humaniseAnswer('plots')).not.toBe('Plots');
  });
});

describe('orderedAnswers', () => {
  /* The exact answer set of one real lead, keys only. */
  const lead = {
    city: 'Chitral',
    full_name: 'A Name',
    phone_number: '+920000000000',
    'are_you_looking_for_plots_&_villa_?': 'plots',
    'which__size_are_you_interested_in?_': '10_marla_(commercial)',
  };

  it('puts the qualifying questions first and the contact details last', () => {
    /* ⚠️ THE POINT OF THE MODULE. A salesperson opening this already has the
       name and number in the header; what they do not have is what the person
       actually asked for. */
    const keys = orderedAnswers(lead).map((a) => a.key);

    expect(keys).toEqual([
      'are_you_looking_for_plots_&_villa_?',
      'which__size_are_you_interested_in?_',
      'city',
      'full_name',
      'phone_number',
    ]);
  });

  it('marks which answers are already shown elsewhere on the record', () => {
    const rows = orderedAnswers(lead);
    const flagged = rows.filter((a) => a.alsoOnRecord).map((a) => a.key);

    expect(flagged).toEqual(['city', 'full_name', 'phone_number']);
  });

  it('recognises the custom contact keys advertisers invent', () => {
    /* The importer matches these by substring too — see lib/crm/lead-fields.ts. */
    const rows = orderedAnswers({ contact_number: '1', mobile: '2', what_size: '5 marla' });
    expect(rows.map((a) => a.key)).toEqual(['what_size', 'contact_number', 'mobile']);
  });

  it('carries the raw value alongside the tidied one', () => {
    const size = orderedAnswers(lead).find((a) => a.key === 'which__size_are_you_interested_in?_');

    expect(size?.raw).toBe('10_marla_(commercial)');
    expect(size?.answer).toBe('10 marla (commercial)');
    expect(size?.question).toBe('Which size are you interested in?');
  });

  it('drops a blank answer rather than printing an empty row under a question', () => {
    expect(orderedAnswers({ city: '', what_size: '   ', country: 'Pakistan' })).toHaveLength(1);
  });

  it('is stable — the same form always renders in the same order', () => {
    /* ⚠️ jsonb does not preserve the form's key order (see the module header),
       so the two objects below are the SAME lead as far as Postgres is
       concerned. The screen must not reshuffle between two reads of it. */
    const shuffled = {
      'which__size_are_you_interested_in?_': '10_marla_(commercial)',
      phone_number: '+920000000000',
      'are_you_looking_for_plots_&_villa_?': 'plots',
      full_name: 'A Name',
      city: 'Chitral',
    };

    expect(orderedAnswers(shuffled).map((a) => a.key)).toEqual(
      orderedAnswers(lead).map((a) => a.key),
    );
  });

  it('answers nothing for a lead with no answers at all', () => {
    expect(orderedAnswers({})).toEqual([]);
    expect(orderedAnswers(null)).toEqual([]);
    expect(orderedAnswers(undefined)).toEqual([]);
  });
});
