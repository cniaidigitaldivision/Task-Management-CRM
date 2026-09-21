import { describe, expect, it } from 'vitest';

import { type ApprovedTemplate, fillable, fillTemplates, templateForPurpose, templateVarsFor } from '../crm-template-for-purpose';

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
  it('⚠️ will not offer the five-blank appointment reminder from the wizard', () => {
    /* It needs name, kind, business, time and place. The booking flow fills all
       five itself; the wizard can fill two (TEMPLATE_FILL), and a template sent
       short of values is refused by Meta — exactly the 09:30 failure on
       2026-09-21. Offering it would be offering a refusal. */
    expect(templateForPurpose('appointment_reminder', REAL)).toBeNull();
  });

  it('picks an appointment reminder whose blanks the wizard can fill', () => {
    const fillableOne: ApprovedTemplate[] = [
      ...REAL,
      { name: 'visit_reminder_short', language: 'en_GB', status: 'APPROVED', variables: 2 },
    ];
    expect(templateForPurpose('appointment_reminder', fillableOne)).toMatchObject({
      name: 'visit_reminder_short',
      variables: 2,
    });
  });

  it('picks the quotation follow-up for a quotation chase', () => {
    expect(templateForPurpose('quotation', REAL)?.name).toBe('quotation_follow_up');
  });

  it('⚠️ will not chase a silent lead with a message about a quotation', () => {
    /* `quotation_follow_up` is the only thing in this account that looks like a
       nudge, and its approved text reads "regarding the quotation we shared with
       you". A lead who went quiet before any quotation existed would be sent a
       message about a document they never received.
       ⚠️ AND DROPPING IT FROM THE WORD LIST WAS NOT ENOUGH: the name CONTAINS
       "follow_up", so it kept matching and this test kept passing while the rule
       it describes was not in force. It takes an explicit exclusion. */
    expect(templateForPurpose('no_response', REAL)).toBeNull();
  });

  it('does pick a real check-in template when the account has one', () => {
    const better: ApprovedTemplate[] = [
      ...REAL,
      { name: 'lead_check_in', language: 'en_GB', status: 'APPROVED', variables: 2 },
    ];
    expect(templateForPurpose('no_response', better)?.name).toBe('lead_check_in');
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
      { name: 'appointment_confirmed', language: 'en_GB', status: 'APPROVED', variables: 2 },
      { name: 'appointment_reminder', language: 'en_GB', status: 'APPROVED', variables: 2 },
    ];
    expect(templateForPurpose('appointment_reminder', both)?.name).toBe('appointment_reminder');
  });

  it('matches a renamed template, because Meta renames them', () => {
    const renamed: ApprovedTemplate[] = [
      { name: 'cni_appointment_reminder_v2', language: 'en_GB', status: 'APPROVED', variables: 2 },
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
    expect(templateForPurpose('quotation', REAL)?.because).toBe('it follows up a quotation');
  });

  it('prefers the asked-for language when a template exists in several', () => {
    const two: ApprovedTemplate[] = [
      { name: 'quotation_follow_up', language: 'en_US', status: 'APPROVED', variables: 0 },
      { name: 'quotation_follow_up', language: 'en_GB', status: 'APPROVED', variables: 0 },
    ];
    expect(templateForPurpose('quotation', two)?.language).toBe('en_GB');
    expect(templateForPurpose('quotation', two, 'en_US')?.language).toBe('en_US');
  });

  /* ── ⚠️ The live account, 2026-09-21 ──────────────────────────────────
     Run against the real template list, the first version answered three
     purposes with a message about something else. These pin the honest answer:
     nothing fits, so the wizard says so instead of sending the wrong words. */

  it('⚠️ does not send a payment reminder as the appointment reminder', () => {
    /* Both names contain "reminder". The client would have read "your site
       visit is…" about an instalment. */
    expect(templateForPurpose('payment_reminder', REAL)).toBeNull();
  });

  it('⚠️ does not ask for missing details with the quotation follow-up', () => {
    /* The owner's own follow-up on 2026-09-21 was this purpose. The matcher
       offered quotation_follow_up — "regarding the quotation we shared" —
       because its name contains "follow_up". */
    expect(templateForPurpose('missing_information', REAL)).toBeNull();
  });

  it('⚠️ does not check in after a visit with the quotation follow-up', () => {
    expect(templateForPurpose('site_visit_checkin', REAL)).toBeNull();
  });

  it('still answers the purpose the account genuinely has a fillable template for', () => {
    /* quotation_follow_up has no blanks, so it works from the wizard today —
       the one thing that did, and must keep doing. */
    expect(templateForPurpose('quotation', REAL)).toMatchObject({ name: 'quotation_follow_up', variables: 0 });
  });
});

describe('fillTemplates', () => {
  const step = (over: Partial<{ channel: string; mode: string; template: { name: string; language: string } | null }> = {}) => ({
    channel: 'whatsapp',
    mode: 'auto_send',
    template: null as { name: string; language: string } | null,
    ...over,
  });

  it('fills a WhatsApp auto-send step that has none', () => {
    const out = fillTemplates([step()], 'quotation', REAL, new Set());
    expect(out[0].template).toEqual({ name: 'quotation_follow_up', language: 'en_GB', variables: 0 });
  });

  it('⚠️ never refills a step the person cleared on purpose', () => {
    const out = fillTemplates([step()], 'quotation', REAL, new Set([0]));
    expect(out[0].template).toBeNull();
  });

  it('leaves a chosen template, an email and a reminder-for-me alone', () => {
    const chosen = step({ template: { name: 'appointment_reminder', language: 'en_GB' } });
    const email = step({ channel: 'email' });
    const mine = step({ mode: 'review_first' });
    const out = fillTemplates([chosen, email, mine], 'quotation', REAL, new Set());
    expect(out[0].template?.name).toBe('appointment_reminder');
    expect(out[1].template).toBeNull();
    expect(out[2].template).toBeNull();
  });

  it('⚠️ returns the same array when nothing changes, so it can run during render', () => {
    /* It is applied on every render of the wizard. A new array each time would
       set state each time, and render for ever. */
    const steps = [step({ template: { name: 'quotation_follow_up', language: 'en_GB' } })];
    expect(fillTemplates(steps, 'quotation', REAL, new Set())).toBe(steps);
    const none = [step()];
    expect(fillTemplates(none, 'missing_information', REAL, new Set())).toBe(none);
  });
});

describe('templateVarsFor — which values fill the blanks', () => {
  it('names the client first, then the business, the greeting’s own shape', () => {
    expect(templateVarsFor(2)).toEqual(['lead_first_name', 'company']);
    expect(templateVarsFor(1)).toEqual(['lead_first_name']);
  });

  it('⚠️ a template with no blanks gets none, so it sends as it does today', () => {
    expect(templateVarsFor(0)).toEqual([]);
    expect(templateVarsFor(undefined)).toEqual([]);
  });

  it('never asks for more than it can fill', () => {
    expect(templateVarsFor(5)).toEqual(['lead_first_name', 'company']);
    expect(fillable({ variables: 5 })).toBe(false);
    expect(fillable({ variables: 2 })).toBe(true);
  });
});

describe('the templates the owner is about to create, 2026-09-21', () => {
  /* ⚠️ WRITTEN BEFORE THEY EXIST, ON PURPOSE. These are the exact names handed
     to the owner to submit to Meta together. A name that matches the wrong
     purpose is a client receiving the wrong message, so each is checked to land
     on its own purpose and on nobody else's. */
  const AFTER: ApprovedTemplate[] = [
    ...REAL.map((t) => ({ ...t, status: 'APPROVED' })),
    { name: 'lead_check_in', language: 'en_GB', status: 'APPROVED', variables: 2 },
    { name: 'lead_details_request', language: 'en_GB', status: 'APPROVED', variables: 2 },
    { name: 'payment_reminder', language: 'en_GB', status: 'APPROVED', variables: 2 },
    { name: 'after_visit_check_in', language: 'en_GB', status: 'APPROVED', variables: 2 },
  ];

  it.each([
    ['no_response', 'lead_check_in'],
    ['re_engage', 'lead_check_in'],
    ['missing_information', 'lead_details_request'],
    ['payment_reminder', 'payment_reminder'],
    ['site_visit_checkin', 'after_visit_check_in'],
    ['quotation', 'quotation_follow_up'],
    ['approved_offer', 'quotation_follow_up'],
  ])('%s → %s', (purpose, expected) => {
    expect(templateForPurpose(purpose, AFTER)?.name).toBe(expected);
  });

  it('⚠️ a silent lead is never "checked in after the visit"', () => {
    /* after_visit_check_in contains "check_in", which is a no_response word, and
       sorts before lead_check_in — so without an explicit exclusion a lead who
       never visited would be thanked for their time with us. */
    expect(templateForPurpose('no_response', AFTER)?.name).not.toBe('after_visit_check_in');
  });

  it('the booking-flow templates are still never offered from the wizard', () => {
    expect(templateForPurpose('appointment_reminder', AFTER)).toBeNull();
  });
});
