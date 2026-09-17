import { describe, expect, it } from 'vitest';

import { quotationEmail } from '@/lib/crm/email';

/* ============================================================================
 * THE QUOTATION, AS AN EMAIL
 * ----------------------------------------------------------------------------
 * ⚠️ THE STAKES ARE HIGHER THAN A NOTIFICATION. This message carries a PRICE to
 * somebody else's customer. A figure that renders wrong, an unescaped name that
 * breaks the layout, or a "valid until —" is a dispute, not a cosmetic bug.
 * ========================================================================= */

const BASE = {
  greetingName: 'Faisal Rehman',
  quotationNumber: 'QT-1042',
  version: 1,
  amountLabel: 'PKR 4,500,000',
  validUntilLabel: '30 Sep 2026',
  itemLabel: '5 Marla Residential plot',
  itemDetail: 'A-101, Block A',
  salespersonName: 'Sarah',
  businessName: 'Chitral Royal Homes',
  note: null,
};

describe('what the client actually receives', () => {
  it('carries the number, the price and the validity', () => {
    const e = quotationEmail(BASE);

    expect(e.subject).toContain('QT-1042');
    expect(e.html).toContain('PKR 4,500,000');
    expect(e.html).toContain('30 Sep 2026');
    expect(e.html).toContain('5 Marla Residential plot');
  });

  it('⚠️ says which business it is from, in the subject', () => {
    /* The client may be talking to three developers at once. A subject reading
       only "Quotation QT-1042" is one they cannot place. */
    expect(quotationEmail(BASE).subject).toContain('Chitral Royal Homes');
  });

  it('⚠️ never prints "valid until" with no date', () => {
    /* An open quotation is a real state. A dash invites the client to ask what
       it means, and the honest answer is that the line should not be there. */
    const open = quotationEmail({ ...BASE, validUntilLabel: null });

    expect(open.html).not.toContain('Valid until');
    expect(open.text).not.toContain('Valid until');
  });

  it('names the version only when there is more than one', () => {
    /* ⚠️ "QT-1042 (version 1)" tells a client there were others and invites the
       question. v2 onward says so, because by then they know. */
    expect(quotationEmail(BASE).subject).not.toContain('version');
    expect(quotationEmail({ ...BASE, version: 2 }).subject).toContain('version 2');
  });
});

describe('⚠️ whose letter this is', () => {
  /* THE BUG THE SCREENSHOT CAUGHT. Built first on Taskly's shared email shell,
     it arrived headed "Taskly · AI & Digital Division" with a footer reading
     "if you were not expecting this you may safely ignore this email" — our
     internal tool's branding, and a password-reset footer, on a document
     carrying a price to somebody else's customer. */
  it('is branded as the BUSINESS, never as Taskly', () => {
    const e = quotationEmail(BASE);

    expect(e.html).toContain('Chitral Royal Homes');
    expect(e.html).not.toContain('Taskly');
    expect(e.html).not.toContain('AI &amp; DIGITAL DIVISION');
  });

  it('carries no "you may safely ignore this" footer', () => {
    /* Right on a password reset. On a quotation it undermines the letter. */
    expect(quotationEmail(BASE).html.toLowerCase()).not.toContain('safely ignore');
  });

  it('⚠️ attaches nothing while there is no letterhead', () => {
    /* crm_project_settings.letterhead_path is NULL for all 18 projects. An empty
       header is honest; the wrong company's logo is not, and a generated one
       pretending to be the client's is worse. */
    expect(quotationEmail(BASE).attachments).toHaveLength(0);
    expect(quotationEmail(BASE).html).not.toContain('cid:');
  });
});

describe('the plain-text alternative', () => {
  it('⚠️ is never empty, and carries the same price', () => {
    /* `sendEmail` documents why: a message with no text part scores worse with
       spam filters, and a quotation in junk is indistinguishable from one never
       sent. */
    const e = quotationEmail(BASE);

    expect(e.text.length).toBeGreaterThan(80);
    expect(e.text).toContain('PKR 4,500,000');
    expect(e.text).toContain('QT-1042');
  });

  it('and does not leak markup into it', () => {
    expect(quotationEmail(BASE).text).not.toMatch(/<[a-z]/i);
  });
});

describe('a service quotation, not a plot', () => {
  it('prints the scope rather than a block', () => {
    const e = quotationEmail({
      ...BASE,
      itemLabel: 'CRM implementation',
      itemDetail: 'Setup, training, three months support.',
      amountLabel: 'PKR 200,000',
      businessName: 'AI & Digital Division',
    });

    expect(e.html).toContain('Setup, training, three months support.');
    expect(e.html).not.toContain('Block');
  });
});

describe('⚠️ escaping — the one that becomes a real bug', () => {
  it('a name with an ampersand does not break the markup', () => {
    /* "AI & Digital Division" is a real business name in this database, and a
       bare & is invalid HTML that some clients render as a stray entity. */
    const e = quotationEmail({ ...BASE, businessName: 'AI & Digital Division' });

    expect(e.html).toContain('AI &amp; Digital Division');
  });

  it('a hostile name cannot inject markup', () => {
    /* The name comes from whatever a stranger typed into a Meta form. */
    const e = quotationEmail({
      ...BASE,
      greetingName: '<script>alert(1)</script>',
    });

    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });

  it('and the salesperson note is escaped too', () => {
    const e = quotationEmail({ ...BASE, note: 'Discussed 5 < 10 marla options' });

    expect(e.html).toContain('5 &lt; 10 marla');
  });
});
