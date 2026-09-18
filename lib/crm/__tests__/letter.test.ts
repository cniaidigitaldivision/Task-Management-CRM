import { describe, expect, it } from 'vitest';

import { followUpEmail, quotationEmail, type LetterFrom } from '@/lib/crm/email';

/* ============================================================================
 * THE LETTER THE CLIENT RECEIVES
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"the email template should be equal to or the same as the
 * login-purpose professional email template."*
 *
 * So the shell is `shell()` from `lib/email/templates.ts` part for part — header
 * band, gold rule, 46px body, footer band inside the card — with ONE difference
 * that these tests exist to hold: the identity is the client's business, never
 * Taskly's. The first version of this file used the login shell directly and a
 * Chitral quotation went out headed "Taskly · AI & Digital Division" with a
 * password-reset footer under it.
 * ========================================================================= */

const FROM: LetterFrom = {
  businessName: 'Chitral Royal Homes',
  subtitle: 'Islamabad',
  salespersonName: 'Sarah',
  replyTo: 'sales@crescentnovainternational.com',
  phone: '+92 300 123 8726',
};

const letter = (over: Partial<Parameters<typeof followUpEmail>[0]> = {}) =>
  followUpEmail({
    from: FROM,
    subject: 'Your 5 Marla plot in Block A',
    body: 'Assalam-o-Alaikum Faisal.\n\nThe plot we discussed is still available.\nShall I hold it for you?',
    ...over,
  });

describe('the frame', () => {
  it('heads the letter with the business, not with Taskly', () => {
    const html = letter().html;
    expect(html).toContain('Chitral Royal Homes');
    expect(html).not.toContain('Taskly');
    /* ⚠️ The login shell's footer line is a password-reset sentence. */
    expect(html).not.toContain('you may safely ignore this email');
  });

  it('carries the login template’s own structure', () => {
    const html = letter().html;
    expect(html).toContain('#0e2a2c'); /* the header band */
    expect(html).toContain('#d4a63c'); /* the gold rule */
    expect(html).toContain('max-width:620px');
    expect(html).toContain('padding:26px 46px 34px 46px');
  });

  it('prints the letterspaced line under the name when there is one', () => {
    expect(letter().html).toContain('letter-spacing:.13em');
    expect(letter().html).toContain('Islamabad');
    /* ⚠️ And omits the element entirely when there is not — an empty uppercase
       strip under the name looks like a broken template. */
    const plain = followUpEmail({
      from: { ...FROM, subtitle: null },
      subject: 's',
      body: 'b',
    }).html;
    expect(plain).not.toContain('letter-spacing:.13em');
  });

  it('signs off in the footer, once', () => {
    const html = letter().html;
    expect(html.match(/Sarah/g)).toHaveLength(1);
    expect(html).toContain('sales@crescentnovainternational.com');
    expect(html).toContain('+92 300 123 8726');
  });

  it('omits a contact row it has nothing to put in', () => {
    const html = followUpEmail({
      from: { ...FROM, replyTo: null, phone: null },
      subject: 's',
      body: 'b',
    }).html;
    expect(html).not.toContain('mailto:');
  });
});

describe('the body', () => {
  it('keeps paragraphs apart and line breaks inside them', () => {
    const html = letter().html;
    expect(html).toContain('Assalam-o-Alaikum Faisal.');
    /* A blank line starts a new <p>; a single newline is a <br>. */
    expect(html).toContain('<br>');
    expect((html.match(/<p /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('escapes what somebody typed', () => {
    const html = letter({ body: 'Price is <b>4,500,000</b> & final' }).html;
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp; final');
  });

  it('always carries a plain-text alternative', () => {
    const e = letter();
    expect(e.text).toContain('The plot we discussed is still available.');
    expect(e.text).toContain('Sarah');
    expect(e.text).toContain('Chitral Royal Homes');
  });

  it('passes attachments through untouched', () => {
    const e = letter({
      attachments: [{ filename: 'QT-1042.pdf', content: 'AAA', contentType: 'application/pdf' }],
    });
    expect(e.attachments).toEqual([
      { filename: 'QT-1042.pdf', content: 'AAA', contentType: 'application/pdf' },
    ]);
  });
});

describe('the quotation letter shares the frame', () => {
  it('is headed and footed the same way', () => {
    const e = quotationEmail({
      greetingName: 'Faisal Rehman',
      quotationNumber: 'QT-1042',
      version: 1,
      amountLabel: 'PKR 4,500,000',
      validUntilLabel: '30 Sep 2026',
      itemLabel: '5 Marla Residential plot',
      itemDetail: 'A-101, Block A',
      from: FROM,
      note: null,
    });
    expect(e.subject).toContain('Chitral Royal Homes');
    expect(e.html).toContain('#0e2a2c');
    expect(e.html).toContain('sales@crescentnovainternational.com');
    expect(e.html).not.toContain('Taskly');
  });
});

/* ============================================================================
 * THE HEADER, THE HEADING AND THE FOOT — 2026-09-19
 * ----------------------------------------------------------------------------
 * Owner, on a letter that went out headed `Demo — Product Enquiries [demo]`:
 * *"It should have a proper project name, a proper header, and a proper footer,
 * like a professional email. It is just like you are putting random things over
 * there."*
 * ========================================================================= */

describe('a letter that reads as written', () => {
  it('opens with its subject as a heading', () => {
    const html = letter().html;
    expect(html).toContain('Your 5 Marla plot in Block A</h1>');
  });

  it('signs off with the person, what they do, and the business', () => {
    const html = letter().html;
    expect(html).toContain('Sarah');
    /* The default when nobody has set a role. The stored `role_title` values are
       "SalesMan" and "sale person" — internal shorthand, not for a client. */
    expect(html).toContain('Sales');
    expect(html).toContain('sales@crescentnovainternational.com');
    expect(html).toContain('+92 300 123 8726');
  });

  it('says why the letter arrived, without a password-reset disclaimer', () => {
    const html = letter().html;
    expect(html).toContain('You are receiving this because you enquired with us.');
    expect(html).not.toContain('safely ignore');
  });

  it('puts the same signature in the plain-text part', () => {
    const text = letter().text;
    expect(text).toContain('Sarah');
    expect(text).toContain('Sales · Chitral Royal Homes');
    expect(text).toContain('sales@crescentnovainternational.com');
    /* ⚠️ And the paragraphs keep their blank lines — a text alternative run
       together is what a spam filter reads once the HTML is stripped. */
    expect(text).toContain('Assalam-o-Alaikum Faisal.\n\nThe plot we discussed');
  });

  it('prints a role when the caller has a real one', () => {
    const html = letter({ from: { ...FROM, role: 'Sales Manager' } }).html;
    expect(html).toContain('Sales Manager');
  });

  it('never prints an internal tag, because the name is cleaned upstream', () => {
    /* `clientFacingName` is what strips it — see lib/domain/crm-brand.ts. This
       holds the contract at the boundary: whatever it is handed, it prints. */
    const html = letter({ from: { ...FROM, businessName: 'CNI AI & Digital Division' } }).html;
    expect(html).toContain('CNI AI &amp; Digital Division');
    expect(html).not.toContain('[demo]');
  });
});
