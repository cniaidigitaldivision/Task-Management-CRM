import { describe, expect, it } from 'vitest';

import { type ApprovedTemplate, templateForPurpose } from '../crm-template-for-purpose';

/* ============================================================================
 * THE TEMPLATE A FOLLOW-UP ALREADY IMPLIES
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20: *"most of the time… I forget to choose the template. When a
 * salesperson is busy with a lot of other things, how can he remember?"*
 *
 * Forgetting costs a step that sits in the queue and never sends, found days
 * later when the client has gone quiet.
 * ========================================================================= */

/** The account's real templates, read back from Graph on 2026-09-19. */
const REAL: ApprovedTemplate[] = [
  { name: 'appointment_reminder', language: 'en_GB', status: 'APPROVED', variables: 5 },
  { name: 'appointment_confirmed', language: 'en_GB', status: 'PENDING', variables: 5 },
  { name: 'lead_greeting_v2', language: 'en_GB', status: 'APPROVED', variables: 2 },
  { name: '_lead_greeting', language: 'en_GB', status: 'APPROVED', variables: 3 },
  { name: 'quotation_follow_up', language: 'en_GB', status: 'APPROVED', variables: 0 },
  { name: 'hello_world', language: 'en_US', status: 'APPROVED', variables: 0 },
];

describe('templateForPurpose', () => {
  it('picks the reminder for an appointment reminder', () => {
    expect(templateForPurpose('appointment_reminder', REAL)).toMatchObject({
      name: 'appointment_reminder',
      language: 'en_GB',
    });
  });

  it('picks the quotation follow-up for a quotation chase', () => {
    expect(templateForPurpose('quotation', REAL)?.name).toBe('quotation_follow_up');
  });

  it('picks something that re-opens a quiet conversation for no_response', () => {
    expect(templateForPurpose('no_response', REAL)?.name).toBe('quotation_follow_up');
  });

  it('⚠️ never offers a template Meta has not approved', () => {
    /* `appointment_confirmed` is the better name match for a confirmation and it
       is PENDING — offering it would hand back the same silent failure (132001)
       that migration 224 exists to survive. */
    const confirmations = REAL.filter((t) => t.name.includes('confirmed'));
    expect(confirmations[0].status).toBe('PENDING');
    expect(templateForPurpose('appointment_reminder', REAL)?.name).not.toBe('appointment_confirmed');
  });

  it('⚠️ prefers the template with the fewest blanks to fill', () => {
    /* An unfilled parameter is refused outright (#131008) and the whole message
       is dropped, so more variables is more risk, not more detail. */
    const two: ApprovedTemplate[] = [
      { name: 'quotation_follow_up_long', language: 'en_GB', status: 'APPROVED', variables: 4 },
      { name: 'quotation_follow_up', language: 'en_GB', status: 'APPROVED', variables: 0 },
    ];
    expect(templateForPurpose('quotation', two)?.name).toBe('quotation_follow_up');
  });

  it('⚠️ keeps a reminder from being answered by a confirmation', () => {
    /* Both names contain "appointment". The more specific word has to win, or a
       reminder goes out reading "your visit is confirmed for…". */
    const both: ApprovedTemplate[] = [
      { name: 'appointment_confirmed', language: 'en_GB', status: 'APPROVED', variables: 5 },
      { name: 'appointment_reminder', language: 'en_GB', status: 'APPROVED', variables: 5 },
    ];
    expect(templateForPurpose('appointment_reminder', both)?.name).toBe('appointment_reminder');
  });

  it('matches a renamed template, because Meta renames them', () => {
    const renamed: ApprovedTemplate[] = [
      { name: 'cni_appointment_reminder_v2', language: 'en_GB', status: 'APPROVED', variables: 5 },
    ];
    expect(templateForPurpose('appointment_reminder', renamed)?.name).toBe('cni_appointment_reminder_v2');
  });

  it('⚠️ returns null rather than attaching something about the wrong thing', () => {
    /* Nothing here chases a payment. Sending the greeting instead would be worse
       than sending nothing, because it reaches the client. */
    const thin: ApprovedTemplate[] = [
      { name: 'lead_greeting_v2', language: 'en_GB', status: 'APPROVED', variables: 2 },
    ];
    expect(templateForPurpose('payment_reminder', thin)).toBeNull();
  });

  it('returns null when the account has no approved template at all', () => {
    const none: ApprovedTemplate[] = [
      { name: 'appointment_reminder', language: 'en_GB', status: 'PENDING', variables: 5 },
    ];
    expect(templateForPurpose('appointment_reminder', none)).toBeNull();
    expect(templateForPurpose('no_response', [])).toBeNull();
  });

  it('says why it chose, so the wizard can show it', () => {
    expect(templateForPurpose('appointment_reminder', REAL)?.because)
      .toBe('it reminds them about a booked appointment');
  });

  it('prefers the asked-for language when a template exists in several', () => {
    const two: ApprovedTemplate[] = [
      { name: 'quotation_follow_up', language: 'en_US', status: 'APPROVED', variables: 0 },
      { name: 'quotation_follow_up', language: 'en_GB', status: 'APPROVED', variables: 0 },
    ];
    expect(templateForPurpose('quotation', two)?.language).toBe('en_GB');
    expect(templateForPurpose('quotation', two, 'en_US')?.language).toBe('en_US');
  });
});
