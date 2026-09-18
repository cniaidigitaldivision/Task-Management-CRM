import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fromAs, fromMailbox } from '../send';

/* ============================================================================
 * WHO THE EMAIL APPEARS TO COME FROM
 * ----------------------------------------------------------------------------
 * ⚠️ THE DISPLAY NAME MOVES; THE MAILBOX NEVER DOES. Resend refuses a domain it
 * has not verified (a real 403 from this environment on 2026-09-18), and sending
 * as `sales@someone-elses-domain.com` is exactly what SPF exists to stop. So a
 * CRM letter goes out as `Chitral Royal Homes <the-verified-mailbox>` — the name
 * the client recognises, over the address we are allowed to send from.
 * ========================================================================= */

const ORIGINAL = process.env.EMAIL_FROM;

beforeEach(() => {
  process.env.EMAIL_FROM = 'Taskly <info@aidigitaldivision.com>';
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL;
});

describe('fromMailbox', () => {
  it('takes the address out of a named sender', () => {
    expect(fromMailbox()).toBe('info@aidigitaldivision.com');
  });

  it('handles a bare address', () => {
    process.env.EMAIL_FROM = 'info@aidigitaldivision.com';
    expect(fromMailbox()).toBe('info@aidigitaldivision.com');
  });
});

describe('fromAs', () => {
  it('keeps the verified mailbox and changes only the name', () => {
    expect(fromAs('Chitral Royal Homes')).toBe('Chitral Royal Homes <info@aidigitaldivision.com>');
  });

  it('⚠️ cannot be talked into another domain', () => {
    /* A project named after an address must not become the sender. */
    expect(fromAs('sales@rival.com')).toBe('sales@rival.com <info@aidigitaldivision.com>');
  });

  it('⚠️ strips what would break the header', () => {
    /* A quote, an angle bracket or a newline in a business name is a header
       injection — two addresses in one From, or an extra header entirely. */
    expect(fromAs('Ali "The Builder" <evil@x.com>')).toBe('Ali The Builder evil@x.com <info@aidigitaldivision.com>');
    expect(fromAs('Homes\r\nBcc: someone@else.com')).toBe('Homes Bcc: someone@else.com <info@aidigitaldivision.com>');
  });

  it('falls back to the bare mailbox rather than an empty name', () => {
    expect(fromAs('   ')).toBe('info@aidigitaldivision.com');
  });

  it('collapses runs of whitespace', () => {
    expect(fromAs('AI  &   Digital   Division')).toBe('AI & Digital Division <info@aidigitaldivision.com>');
  });
});
