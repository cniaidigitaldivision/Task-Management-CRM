import { describe, expect, it } from 'vitest';

import { toLeadPayload, type MetaLead } from '../lead-fields';

/* ============================================================================
 * MAPPING A META LEAD INTO A ROW
 * ----------------------------------------------------------------------------
 * The fixture below is the REAL field set from the Chitral form, read off the
 * live API on 2026-09-09 — question marks, ampersands, double underscores and
 * all. Inventing a tidy fixture here would test a shape Meta does not send.
 * ========================================================================= */

const REAL: MetaLead = {
  id: '1234567890',
  created_time: '2026-07-28T15:19:17+0000',
  field_data: [
    { name: 'country', values: ['Pakistan'] },
    { name: 'which__size_are_you_interested_in?_', values: ['5 Marla'] },
    { name: 'full_name', values: ['Muhammad Ashraf'] },
    { name: 'city', values: ['Islamabad'] },
    { name: 'are_you_looking_for_plots_&_villa_?', values: ['Plots'] },
    { name: 'phone_number', values: ['+923001234567'] },
  ],
};

describe('the real Chitral form', () => {
  const row = toLeadPayload(REAL, 'form-1')!;

  it('lifts the four fields the CRM acts on into columns', () => {
    expect(row.full_name).toBe('Muhammad Ashraf');
    expect(row.phone).toBe('+923001234567');
    expect(row.phone_e164).toBe('+923001234567');
    expect(row.city).toBe('Islamabad');
  });

  it('⚠️ keeps EVERY answer, including the ones with punctuation in the key', () => {
    /* These keys are whatever the advertiser typed into Meta. A column per
       question would need a migration per campaign — so they are kept whole,
       and nothing Meta sent is ever discarded. */
    expect(row.answers['which__size_are_you_interested_in?_']).toBe('5 Marla');
    expect(row.answers['are_you_looking_for_plots_&_villa_?']).toBe('Plots');
    expect(row.answers.country).toBe('Pakistan');
    expect(Object.keys(row.answers)).toHaveLength(6);
  });

  it('records when THEY submitted, not when we imported', () => {
    /* Importing a month of backlog must not make every lead look like it
       arrived today — ageing and response-time both measure from this. */
    expect(row.submitted_at).toBe('2026-07-28T15:19:17+0000');
  });

  it("carries Meta's id, which is what makes the import safe to re-run", () => {
    expect(row.external_id).toBe('1234567890');
    expect(row.form_meta_id).toBe('form-1');
  });
});

describe('the shapes other forms send', () => {
  it('composes a name from first and last when there is no full_name', () => {
    const row = toLeadPayload(
      {
        id: '2',
        created_time: '2026-09-01T00:00:00+0000',
        field_data: [
          { name: 'first_name', values: ['Zain'] },
          { name: 'last_name', values: ['Ul Abedin'] },
        ],
      },
      'form-2',
    )!;
    expect(row.full_name).toBe('Zain Ul Abedin');
  });

  it('finds a phone under a custom key like mobile_number', () => {
    const row = toLeadPayload(
      {
        id: '3',
        created_time: '2026-09-01T00:00:00+0000',
        field_data: [{ name: 'your_mobile_number', values: ['0300-1234567'] }],
      },
      'form-3',
    )!;
    expect(row.phone).toBe('0300-1234567');
    expect(row.phone_e164).toBe('+923001234567');
  });

  it('⚠️ prefers an exact key over one that merely contains it', () => {
    /* A field called `best_time_to_phone` must not become the phone number.
       Exact matches are tried first for exactly this. */
    const row = toLeadPayload(
      {
        id: '4',
        created_time: '2026-09-01T00:00:00+0000',
        field_data: [
          { name: 'best_time_to_phone', values: ['Evening'] },
          { name: 'phone_number', values: ['0300-9999999'] },
        ],
      },
      'form-4',
    )!;
    expect(row.phone).toBe('0300-9999999');
  });

  it('joins a multi-answer field rather than keeping only the first', () => {
    const row = toLeadPayload(
      {
        id: '5',
        created_time: '2026-09-01T00:00:00+0000',
        field_data: [{ name: 'interested_in', values: ['Plots', 'Villas'] }],
      },
      'form-5',
    )!;
    expect(row.answers.interested_in).toBe('Plots, Villas');
  });

  it('leaves phone_e164 null when the number cannot be parsed, keeping the raw', () => {
    const row = toLeadPayload(
      {
        id: '6',
        created_time: '2026-09-01T00:00:00+0000',
        field_data: [{ name: 'phone_number', values: ['call me on the landline'] }],
      },
      'form-6',
    )!;
    expect(row.phone).toBe('call me on the landline');
    expect(row.phone_e164).toBeNull();
  });

  it('survives a lead with no fields at all', () => {
    const row = toLeadPayload({ id: '7', created_time: '2026-09-01T00:00:00+0000' }, 'f')!;
    expect(row.full_name).toBeNull();
    expect(row.answers).toEqual({});
  });
});

describe('what it refuses', () => {
  it('⚠️ refuses a lead with no submission time', () => {
    /* Meta sends `created_time` on every real lead, so its absence means the
       response is wrong rather than the lead. A row stored with a null
       submitted_at breaks every ageing and response-time figure downstream, and
       it is not recoverable afterwards. */
    expect(toLeadPayload({ id: '8' } as never, 'f')).toBeNull();
  });

  it('refuses a lead with no id, because the id is the de-duplication key', () => {
    expect(toLeadPayload({ created_time: '2026-09-01T00:00:00+0000' } as never, 'f')).toBeNull();
  });
});
