import { describe, expect, it } from 'vitest';

import { ROLES, SYSTEM_DEFAULTS } from '../constants';
import {
  PASSWORD_MAX_LENGTH,
  minLengthFor,
  validatePassword,
  type PasswordContext,
  type PasswordFailureCode,
} from '../password-policy';

/* ============================================================================
 * PASSWORD POLICY — FR-147, doc 16 §5 (NIST SP 800-63B)
 * ========================================================================= */

const MEMBER: PasswordContext = { role: 'member' };
const SUPER: PasswordContext = { role: 'super_admin' };

/** Long, unremarkable, and clean against every rule in the module. */
const GOOD = 'correct horse battery staple';
const GOOD_LONG = 'Thunder Marmalade Quay 71';

const codes = (password: string, context: PasswordContext = MEMBER): PasswordFailureCode[] =>
  validatePassword(password, context).failures.map((f) => f.code);

describe('length is the requirement — doc 16 §5', () => {
  it('12 characters for everyone, 16 for the Super Admin (SA-2)', () => {
    expect(minLengthFor('member')).toBe(12);
    expect(minLengthFor('team_coordinator')).toBe(12);
    expect(minLengthFor('admin')).toBe(12);
    expect(minLengthFor('super_admin')).toBe(16);
    expect(SYSTEM_DEFAULTS.passwordMinLength).toBe(12);
    expect(SYSTEM_DEFAULTS.superAdminPasswordMinLength).toBe(16);
  });

  it('rejects anything under the minimum', () => {
    expect(codes('shortpwd')).toContain('too_short');
    expect(codes('elevenchar')).toContain('too_short');
  });

  it('accepts exactly the minimum', () => {
    const exactly12 = 'jumpwidgets';
    expect(exactly12.length).toBe(11);
    expect(codes('jumpwidgets1')).not.toContain('too_short');
  });

  it('holds the Super Admin to the longer minimum', () => {
    const fourteen = 'plumthicketbay';
    expect(fourteen.length).toBe(14);
    expect(codes(fourteen, MEMBER)).not.toContain('too_short');
    expect(codes(fourteen, SUPER)).toContain('too_short');
    expect(codes(GOOD, SUPER)).not.toContain('too_short');
  });

  it('allows long passphrases up to 128 characters', () => {
    expect(codes('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toContain('too_long');
  });

  it('refuses an empty or whitespace-only entry', () => {
    expect(codes('')).toContain('whitespace_only');
    expect(codes('            ')).toContain('whitespace_only');
  });
});

describe('NIST says no composition rules — and there are none', () => {
  it('a long all-lowercase passphrase is accepted', () => {
    const check = validatePassword(GOOD, MEMBER);
    expect(check.ok).toBe(true);
    expect(check.failures).toEqual([]);
  });

  it('never demands a digit, a capital or a symbol', () => {
    const check = validatePassword('windowsill lantern gravel', MEMBER);
    expect(check.ok).toBe(true);
  });

  it('a mixed-case passphrase with punctuation is also fine', () => {
    expect(validatePassword(GOOD_LONG, MEMBER).ok).toBe(true);
  });
});

describe('nothing an attacker already knows', () => {
  it('rejects the person’s own name', () => {
    expect(
      codes('kashif ahmed rides again', { role: 'member', fullName: 'Kashif Ahmed' }),
    ).toContain('contains_name');
  });

  it('ignores initials and very short name fragments', () => {
    // "Ali" is 3 characters and would otherwise reject half the dictionary.
    const check = validatePassword('quality lantern gravel', {
      role: 'member',
      fullName: 'A B',
    });
    expect(check.failures.map((f) => f.code)).not.toContain('contains_name');
  });

  it('rejects the local part of the email address', () => {
    expect(
      codes('yusra.khan is my password', { role: 'member', email: 'yusra.khan@cni.test' }),
    ).toContain('contains_email');
  });

  it('rejects the company name', () => {
    expect(codes('crescent lantern gravel')).toContain('contains_organisation');
    expect(codes('my cni password today')).toContain('contains_organisation');
    expect(codes('nova lantern gravel pit')).toContain('contains_organisation');
  });
});

describe('shapes that look complex and are not', () => {
  it('rejects keyboard runs', () => {
    expect(codes('qwertyuiop lantern')).toContain('keyboard_pattern');
    expect(codes('my asdfgh gravel pit')).toContain('keyboard_pattern');
    expect(codes('1qaz2wsx gravel pit')).toContain('keyboard_pattern');
  });

  it('rejects very common passwords, even embedded', () => {
    expect(codes('mypassword is long')).toContain('common_password');
    expect(codes('letmein please now ok')).toContain('common_password');
    expect(codes('changeme gravel pit x')).toContain('common_password');
  });

  it('rejects four or more repeated characters', () => {
    expect(codes('gravelaaaa lantern')).toContain('repeated_characters');
    expect(codes('gravelaaa lantern')).not.toContain('repeated_characters');
  });

  it('rejects long sequences, ascending or descending', () => {
    expect(codes('gravel12345 lantern')).toContain('sequential_characters');
    expect(codes('gravelabcde lantern')).toContain('sequential_characters');
    expect(codes('graveledcba lantern')).toContain('sequential_characters');
    expect(codes('gravel1234 lantern')).not.toContain('sequential_characters');
  });
});

describe('what this module cannot do, and says so — FR-147', () => {
  it('always names the checks the caller still owes', () => {
    // The breach corpus is a network call and reuse needs Argon2 verification.
    // Both are required; neither can happen in a pure function.
    for (const password of [GOOD, 'short', '']) {
      expect(validatePassword(password, MEMBER).pending).toEqual(['breach_check', 'reuse_check']);
    }
  });

  it('a passing result is explicitly not a complete verdict', () => {
    const check = validatePassword(GOOD, MEMBER);
    expect(check.ok).toBe(true);
    expect(check.pending).toHaveLength(2);
  });
});

describe('strength guidance', () => {
  it('is zero whenever the password is rejected', () => {
    expect(validatePassword('short', MEMBER).strength).toBe(0);
    expect(validatePassword('', MEMBER).strength).toBe(0);
  });

  it('rewards length above everything else', () => {
    const short = validatePassword('jumpwidgets1', MEMBER).strength;
    const long = validatePassword(GOOD, MEMBER).strength;
    expect(long).toBeGreaterThan(short);
  });

  it('rates a four-word passphrase at the top', () => {
    expect(validatePassword(GOOD, MEMBER).strength).toBe(4);
  });

  it('penalises a long password built from very few distinct characters', () => {
    // 'abababab…' is long but trivially guessable.
    const repetitive = validatePassword('ababababababababab', MEMBER);
    expect(repetitive.strength).toBeLessThan(validatePassword(GOOD, MEMBER).strength);
  });

  it('never returns a value outside 0–4', () => {
    for (const password of ['', 'x', GOOD, GOOD_LONG, 'z'.repeat(120)]) {
      const { strength } = validatePassword(password, MEMBER);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(4);
    }
  });
});

describe('every failure explains how to fix itself', () => {
  it('no message is empty, and none merely restates the rule name', () => {
    const samples = ['short', 'qwertyuiop123', 'passwordpassword', 'aaaaaaaaaaaaaa'];
    for (const sample of samples) {
      for (const failure of validatePassword(sample, MEMBER).failures) {
        expect(failure.message.length).toBeGreaterThan(20);
        expect(failure.message).not.toBe(failure.code);
      }
    }
  });
});

describe('doc 20 §5 — determinism and purity', () => {
  it.each(ROLES)('is stable for %s', (role) => {
    const first = validatePassword(GOOD_LONG, { role, fullName: 'Sana Minhas' });
    for (let i = 0; i < 20; i += 1) {
      expect(validatePassword(GOOD_LONG, { role, fullName: 'Sana Minhas' })).toEqual(first);
    }
  });

  it('reports the minimum it applied, so the UI need not duplicate the rule', () => {
    expect(validatePassword('x', MEMBER).minLength).toBe(12);
    expect(validatePassword('x', SUPER).minLength).toBe(16);
  });
});
