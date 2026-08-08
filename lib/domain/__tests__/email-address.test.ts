import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EMAIL_MAX_LENGTH,
  maskEmail,
  normaliseEmail,
  sameEmail,
  validateEmailAddress,
} from '../email-address';

/* ============================================================================
 * EMAIL ADDRESSES
 * ----------------------------------------------------------------------------
 * The last block matters most: it reads migration 001 off disk and checks the
 * TypeScript pattern against the SQL one. A test that only exercised the regex
 * against examples would pass happily while the two definitions drifted apart —
 * and the symptom of that drift is a check-constraint violation shown to a
 * person who mistyped their own address.
 * ========================================================================= */

describe('normalising', () => {
  it('trims and lower-cases, because the database requires both', () => {
    expect(normaliseEmail('  Habiba@Example.COM  ')).toBe('habiba@example.com');
  });

  it('leaves an already-normal address alone', () => {
    expect(normaliseEmail('a@b.co')).toBe('a@b.co');
  });

  it('sameEmail ignores case and surrounding space', () => {
    expect(sameEmail(' A@B.CO ', 'a@b.co')).toBe(true);
    expect(sameEmail('a@b.co', 'a@b.com')).toBe(false);
  });
});

describe('what is accepted', () => {
  const good = [
    'a@b.co',
    'habiba@axelytix.com',
    'first.last@sub.domain.co.uk',
    'name+tag@example.com',
    "o'brien@example.ie",
    'user_name-123@example-host.com',
  ];

  for (const email of good) {
    it(`accepts ${email}`, () => {
      const result = validateEmailAddress(email);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.email).toBe(email.toLowerCase());
    });
  }

  it('normalises on the way through, so the caller never has to', () => {
    const result = validateEmailAddress('  Habiba@Example.COM ');
    expect(result).toEqual({ ok: true, email: 'habiba@example.com' });
  });
});

describe('what is refused — the mistakes people actually make', () => {
  const bad: Array<[string, string]> = [
    ['', 'blank'],
    ['   ', 'whitespace only'],
    ['habiba', 'no @ at all'],
    ['habiba@', 'nothing after the @'],
    ['@example.com', 'nothing before the @'],
    ['habiba@example', 'no dot in the domain'],
    ['habiba@@example.com', 'two @ signs'],
    ['habiba@exa mple.com', 'a space in the domain'],
    ['hab iba@example.com', 'a space in the local part'],
    ['habiba@example.com,', 'a trailing comma — a pasted list'],
    ['habiba@example.com.', 'a trailing full stop — end of a sentence'],
    ['habiba@example.c', 'a one-letter top-level domain'],
    ['habiba@.com', 'a domain that starts with the dot'],
  ];

  for (const [email, why] of bad) {
    it(`refuses ${JSON.stringify(email)} — ${why}`, () => {
      expect(validateEmailAddress(email).ok).toBe(false);
    });
  }

  it('refuses anything past the RFC 5321 length cap', () => {
    const local = 'a'.repeat(EMAIL_MAX_LENGTH);
    const result = validateEmailAddress(`${local}@example.com`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(String(EMAIL_MAX_LENGTH));
  });

  it('every refusal is a sentence, never a pattern', () => {
    for (const [email] of bad) {
      const result = validateEmailAddress(email);
      if (result.ok) continue;
      expect(result.message).toMatch(/[.!]$/);
      expect(result.message).not.toContain('\\s');
      expect(result.message).not.toContain('^');
    }
  });
});

describe('masking, for the alert sent to the old address', () => {
  it('keeps the first and last of the local part, and the whole domain', () => {
    expect(maskEmail('habiba@axelytix.com')).toBe('h•••a@axelytix.com');
  });

  it('does not expose a two-character local part in full', () => {
    expect(maskEmail('ab@example.com')).toBe('a•••@example.com');
    expect(maskEmail('a@example.com')).toBe('a•••@example.com');
  });

  it('never returns anything recognisable when there is no @', () => {
    expect(maskEmail('not-an-address')).toBe('•••');
    expect(maskEmail('@example.com')).toBe('•••');
  });

  it('normalises first, so case cannot leak through the mask', () => {
    expect(maskEmail('  Habiba@Example.COM ')).toBe('h•••a@example.com');
  });
});

/* ==========================================================================
 * THE POINT OF THE WHOLE MODULE — one shape, two languages
 * ========================================================================== */

describe('the TypeScript pattern matches the database constraint', () => {
  const migration = readFileSync(
    join(process.cwd(), 'lib/db/migrations/001_identity_core.sql'),
    'utf8',
  );

  it('migration 001 still constrains users.email to the shape we transcribed', () => {
    /* If this fails, the constraint was edited. Edit lib/domain/email-address.ts
       to match in the same commit — that is the entire reason this test exists. */
    expect(migration).toContain(
      "check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')",
    );
  });

  it('migration 001 still requires the address to be stored lower-case', () => {
    expect(migration).toContain('check (email = lower(email))');
  });

  /* ── THE ONLY DIRECTION THAT MATTERS ──────────────────────────────────────
     Everything this module accepts, the constraint must also accept. Get that
     backwards and a saved address becomes a check-constraint violation in front
     of somebody who typed their own email. The reverse gap is deliberate and
     tested separately below. */
  it('never accepts an address the database would refuse', () => {
    /* [:space:] → \s is the only difference between the two dialects here. */
    const asPostgresWrote = new RegExp('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');

    const cases = [
      'a@b.co',
      'first.last@sub.domain.co.uk',
      'name+tag@example.com',
      "o'brien@example.ie",
      'user_name-123@example-host.com',
      '  Habiba@Example.COM ',
      'habiba',
      'habiba@',
      '@example.com',
      'habiba@example',
      'hab iba@example.com',
      'habiba@example.com,',
      'habiba@.com',
      '',
    ];

    for (const email of cases) {
      const mine = validateEmailAddress(email);
      if (!mine.ok) continue;
      expect(asPostgresWrote.test(mine.email), `${email} would violate users_email_shaped`).toBe(
        true,
      );
      /* And the value handed to the database satisfies users_email_lowercase. */
      expect(mine.email).toBe(mine.email.toLowerCase());
    }
  });

  it('is stricter than the constraint in exactly one way, and that is on purpose', () => {
    const asPostgresWrote = new RegExp('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');

    /* Each of these satisfies the SQL pattern and can still never receive mail.
       A sign-in identity that saves cleanly and silently swallows the recovery
       email is the failure this rule exists to prevent. */
    for (const email of ['habiba@example.com,', 'habiba@example.com.', 'habiba@example.c']) {
      expect(asPostgresWrote.test(email), `${email} should pass the SQL pattern`).toBe(true);
      expect(validateEmailAddress(email).ok, `${email} should be refused here`).toBe(false);
    }
  });
});
