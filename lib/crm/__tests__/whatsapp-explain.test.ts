import { describe, expect, it } from 'vitest';

import { explainWhatsAppRefusal } from '../whatsapp';

/* ============================================================================
 * WHAT A REFUSAL SHOULD TELL A SALESPERSON
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, holding a screenshot of two messages marked "Not delivered —
 * Re-engagement message": *"why is it showing me this error?"*
 *
 * Because that is Meta's label, and a label is not an instruction. It does not
 * say the client has to write first, or that a template is the way in.
 *
 * ⚠️ AND THE TABLE FAILS OPEN. An unrecognised detail is returned untouched — one
 * that swallowed the only sentence explaining a NEW failure would be worse than
 * having no table at all.
 * ========================================================================= */

describe('explainWhatsAppRefusal', () => {
  it('turns "Re-engagement message" into what to do about it', () => {
    const said = explainWhatsAppRefusal('Re-engagement message');
    expect(said).toMatch(/has not messaged you in the last 24 hours/);
    expect(said).toMatch(/approved template/);
  });

  it('catches the longer wording Meta also uses', () => {
    expect(
      explainWhatsAppRefusal(
        'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
      ),
    ).toMatch(/approved template/);
  });

  it('keeps a template fault and adds where to fix it', () => {
    const said = explainWhatsAppRefusal('template name (quotation_follow_up) does not exist in en_GB');
    expect(said).toContain('quotation_follow_up');
    expect(said).toMatch(/WhatsApp Manager/);
  });

  it('names an opt-in refusal plainly', () => {
    expect(explainWhatsAppRefusal('Recipient has not opted in')).toMatch(/has not opted in/);
  });

  it('⚠️ passes an unknown refusal through untouched', () => {
    const odd = 'Parameter format does not match format in the created template';
    expect(explainWhatsAppRefusal(odd)).toBe(odd);
  });

  it('leaves an absent detail absent', () => {
    expect(explainWhatsAppRefusal(undefined)).toBeUndefined();
  });
});
