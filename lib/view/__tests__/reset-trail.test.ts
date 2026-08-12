import { describe, expect, it } from 'vitest';

import { describeEmailFailure, toResetTrailView } from '../reset-trail';
import type { ResetTrail } from '@/lib/db/queries/auth';

/* ============================================================================
 * RESET TRAIL VIEW — CHANGE-PLAN 4.1
 * ----------------------------------------------------------------------------
 * Two things are worth testing here and nothing else is: whether a link reads as
 * expired, and how a failed send is described. Both are decisions somebody acts
 * on — "did my colleague get the email, and do I need to do something?" — so
 * getting either wrong sends them down the wrong path.
 * ========================================================================= */

const base: ResetTrail = {
  id: 'aaaaaaaa-0000-0000-0000-000000000000',
  sentToEmail: 'someone@cni-demo.com',
  createdAt: new Date('2026-08-12T10:00:00Z'),
  expiresAt: new Date('2026-08-12T10:15:00Z'),
  consumedAt: null,
  invalidatedAt: null,
  linkOpenedAt: null,
  attemptCount: 0,
  emailState: null,
  emailDetail: null,
  emailSandbox: null,
  forcedByName: 'Farhan Aftab',
};

describe('toResetTrailView', () => {
  it('is not expired a minute before the expiry', () => {
    const view = toResetTrailView(base, new Date('2026-08-12T10:14:00Z').getTime());
    expect(view.expired).toBe(false);
  });

  it('IS expired exactly at the expiry, not a moment after', () => {
    /* The boundary is the whole point: `<=`, not `<`. A link that is live at the
       instant it expires is a link the database would already refuse, and the
       panel would be contradicting `auth_mark_link_opened`. */
    const view = toResetTrailView(base, new Date('2026-08-12T10:15:00Z').getTime());
    expect(view.expired).toBe(true);
  });

  it('turns every date into an ISO string and keeps nulls null', () => {
    const view = toResetTrailView(base, Date.parse('2026-08-12T10:01:00Z'));
    expect(view.sentAt).toBe('2026-08-12T10:00:00.000Z');
    expect(view.openedAt).toBeNull();
    expect(view.completedAt).toBeNull();
    expect(view.revokedAt).toBeNull();
  });

  it('carries the opened and completed moments through when they exist', () => {
    const view = toResetTrailView(
      {
        ...base,
        linkOpenedAt: new Date('2026-08-12T10:03:00Z'),
        consumedAt: new Date('2026-08-12T10:04:30Z'),
      },
      Date.parse('2026-08-12T10:05:00Z'),
    );
    expect(view.openedAt).toBe('2026-08-12T10:03:00.000Z');
    expect(view.completedAt).toBe('2026-08-12T10:04:30.000Z');
  });
});

describe('describeEmailFailure', () => {
  /* Verbatim from Resend, 2026-08-12. The sender's own comment claimed mail to a
     non-owner address is accepted with a 200 and silently dropped; it is not,
     and this is what actually comes back. */
  const sandbox403 =
    'Resend refused it (403). {"statusCode":403,"name":"validation_error","message":' +
    '"You can only send testing emails to your own email address (owner@example.com). ' +
    'To send emails to other recipients, please verify a domain at resend.com/domains, ' +
    'and change the `from` address to an email using this domain."}';

  it('recognises the unverified-domain refusal and says so without the JSON', () => {
    const { summary, isSandboxLimit } = describeEmailFailure(sandbox403);
    expect(isSandboxLimit).toBe(true);
    expect(summary).toContain('no sending domain has been verified');
    expect(summary).not.toContain('statusCode');
    expect(summary).not.toContain('{');
  });

  it('does NOT treat every 403 as the domain limit', () => {
    /* A revoked API key is also a 403 and is a completely different problem with
       a different fix. Describing it as "verify a domain" would send somebody to
       the wrong page, so the match needs the error name AND the phrase. */
    const revoked =
      'Resend refused it (403). {"statusCode":403,"name":"restricted_api_key",' +
      '"message":"This API key is restricted to only send emails"}';
    const { summary, isSandboxLimit } = describeEmailFailure(revoked);
    expect(isSandboxLimit).toBe(false);
    expect(summary).toContain('restricted to only send emails');
  });

  it('lifts the provider message out of an unrecognised blob', () => {
    const other = 'Resend refused it (422). {"statusCode":422,"message":"Invalid `to` field"}';
    expect(describeEmailFailure(other).summary).toBe('Resend refused it: Invalid `to` field');
  });

  it('falls back to the raw text rather than hiding an unparseable failure', () => {
    const raw = 'Could not reach Resend: socket hang up';
    expect(describeEmailFailure(raw).summary).toBe(raw);
  });

  it('handles no detail at all', () => {
    expect(describeEmailFailure(null).summary).toBe('The provider gave no reason.');
    expect(describeEmailFailure('   ').summary).toBe('The provider gave no reason.');
    expect(describeEmailFailure(null).isSandboxLimit).toBe(false);
  });
});
