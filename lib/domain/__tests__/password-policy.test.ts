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
 * PASSWORD POLICY — FR-147, doc 16 §5
 * ----------------------------------------------------------------------------
 * ⚠️ REWRITTEN 2026-08-23. This file used to assert the opposite of what it
 * asserts now, and the change was deliberate rather than a drift.
 *
 * It was NIST SP 800-63B: length as the only hard rule, and a `describe` block
 * literally titled "NIST says no composition rules — and there are none". The
 * owner asked for composition instead:
 *
 *   *"At least 12 characters is too many characters. Just the correct
 *   combination of a capital character, a small character, and any special
 *   character is fine. The length of the character is not compulsory."*
 *
 * So: 8 characters (12 for the Super Admin) plus a capital, a small letter and
 * a symbol. The one deviation from "not compulsory" is that the floor is 8 and
 * not zero — with composition required and no floor, "Aa!" passes everything.
 *
 * Everything that catches what an attacker already knows — the person's own
 * name, their email, the company name, keyboard runs, common passwords — is
 * untouched, because composition catches none of it and it is what actually
 * stops a guessable password.
 * ========================================================================= */

const MEMBER: PasswordContext = { role: 'member' };
const SUPER: PasswordContext = { role: 'super_admin' };

/** Clean against every rule in the module, composition included. */
const GOOD = 'Correct horse battery staple!';
const GOOD_LONG = 'Thunder Marmalade Quay 71!';
/** Exactly the member minimum, with all three required classes. */
const EXACTLY_MIN = 'Trumpt9!';

const codes = (password: string, context: PasswordContext = MEMBER): PasswordFailureCode[] =>
  validatePassword(password, context).failures.map((f) => f.code);

describe('length — the floor, lowered at the owner’s request', () => {
  it('8 characters for everyone, 12 for the Super Admin (SA-2)', () => {
    expect(minLengthFor('member')).toBe(8);
    expect(minLengthFor('team_coordinator')).toBe(8);
    expect(minLengthFor('admin')).toBe(8);
    expect(minLengthFor('super_admin')).toBe(12);
    expect(SYSTEM_DEFAULTS.passwordMinLength).toBe(8);
    expect(SYSTEM_DEFAULTS.superAdminPasswordMinLength).toBe(12);
  });

  it('rejects anything under the minimum', () => {
    expect(codes('Ab!x')).toContain('too_short');
    expect(codes('Trump9!')).toContain('too_short');
  });

  it('accepts exactly the minimum', () => {
    expect(EXACTLY_MIN.length).toBe(8);
    expect(validatePassword(EXACTLY_MIN, MEMBER).ok).toBe(true);
  });

  it('⚠️ still has a floor — "Aa!" is not a password', () => {
    /* The owner said length is not compulsory. It is 8 rather than 0 because a
       composition rule with no floor is decorative: three characters satisfy
       every other check in this module. Stated in the file header, asserted
       here so it cannot be quietly removed as a leftover. */
    expect(codes('Aa!')).toContain('too_short');
  });

  it('holds the Super Admin to the longer minimum', () => {
    const nine = 'Trumpet9!';
    expect(nine.length).toBe(9);
    expect(codes(nine, MEMBER)).not.toContain('too_short');
    expect(codes(nine, SUPER)).toContain('too_short');
    expect(codes(GOOD, SUPER)).not.toContain('too_short');
  });

  it('allows long passphrases up to 128 characters', () => {
    expect(codes('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toContain('too_long');
  });

  it('refuses an empty or whitespace-only entry', () => {
    expect(codes('')).toContain('whitespace_only');
    expect(codes('            ')).toContain('whitespace_only');
  });

  it('does not pile a composition complaint onto an empty box', () => {
    /* Nothing typed is one problem, not four. */
    expect(codes('')).not.toContain('composition');
  });
});

describe('composition — a capital, a small letter and a symbol', () => {
  it('accepts a password carrying all three', () => {
    const check = validatePassword(GOOD, MEMBER);
    expect(check.ok).toBe(true);
    expect(check.failures).toEqual([]);
  });

  it('rejects an all-lowercase passphrase, however long', () => {
    /* This exact password was the headline PASS case before 2026-08-23. It is
       28 characters and it now fails, which is the trade the owner chose. */
    expect(codes('correct horse battery staple')).toContain('composition');
  });

  it('rejects a missing capital', () => {
    expect(codes('trumpet9!')).toContain('composition');
  });

  it('rejects a missing small letter', () => {
    expect(codes('TRUMPET9!')).toContain('composition');
  });

  it('rejects a missing symbol', () => {
    expect(codes('Trumpet99')).toContain('composition');
  });

  it('counts anything that is not a letter or a digit as a symbol', () => {
    /* Wide on purpose — a policy that rejects the symbol on somebody's keyboard
       is a policy that gets worked around. A space counts. */
    for (const symbol of ['!', '@', '#', '_', '-', '.', ' ', '£', '€']) {
      expect(codes(`Trumpet9${symbol}`), symbol).not.toContain('composition');
    }
  });

  it('names only what is actually missing', () => {
    const missingSymbol = validatePassword('Trumpet99', MEMBER).failures.find(
      (f) => f.code === 'composition',
    );
    expect(missingSymbol?.message).toBe('Add a symbol.');

    const missingTwo = validatePassword('trumpet99', MEMBER).failures.find(
      (f) => f.code === 'composition',
    );
    expect(missingTwo?.message).toBe('Add a capital letter and a symbol.');
  });

  it('reports composition as ONE failure, not three', () => {
    /* The owner's complaint about this screen was that it is "stuffed with too
       much text". Three bullets for one typed word is that wall of text. */
    const failures = validatePassword('trumpet99', MEMBER).failures;
    expect(failures.filter((f) => f.code === 'composition')).toHaveLength(1);
  });
});

describe('nothing an attacker already knows', () => {
  it('rejects the person’s own name', () => {
    expect(
      codes('Kashif ahmed rides again!', { role: 'member', fullName: 'Kashif Ahmed' }),
    ).toContain('contains_name');
  });

  it('ignores initials and very short name fragments', () => {
    const check = validatePassword('Quality lantern gravel!', {
      role: 'member',
      fullName: 'A B',
    });
    expect(check.failures.map((f) => f.code)).not.toContain('contains_name');
  });

  it('rejects the local part of the email address', () => {
    expect(
      codes('Yusra.khan is my password!', { role: 'member', email: 'yusra.khan@cni.test' }),
    ).toContain('contains_email');
  });

  it('rejects the company name', () => {
    expect(codes('Crescent lantern gravel!')).toContain('contains_organisation');
    expect(codes('My cni password today!')).toContain('contains_organisation');
    expect(codes('Nova lantern gravel pit!')).toContain('contains_organisation');
  });
});

describe('shapes that look complex and are not', () => {
  it('rejects keyboard runs', () => {
    expect(codes('Qwertyuiop lantern!')).toContain('keyboard_pattern');
    expect(codes('My asdfgh gravel pit!')).toContain('keyboard_pattern');
    expect(codes('1qaz2wsx Gravel pit!')).toContain('keyboard_pattern');
  });

  it('rejects very common passwords, even embedded', () => {
    expect(codes('Mypassword is long!')).toContain('common_password');
    expect(codes('Letmein please now ok!')).toContain('common_password');
    expect(codes('Changeme gravel pit x!')).toContain('common_password');
  });

  it('⚠️ still catches Password1! — the thing composition rules produce', () => {
    /* The argument against the rule the owner asked for, kept as a live test.
       It satisfies capital, small letter and symbol perfectly, and it is the
       first entry in every cracking list. Composition did not stop it; the
       blocklist did. */
    const check = validatePassword('Password1!', MEMBER);
    expect(check.failures.map((f) => f.code)).not.toContain('composition');
    expect(check.failures.map((f) => f.code)).toContain('common_password');
    expect(check.ok).toBe(false);
  });

  it('rejects four or more repeated characters', () => {
    expect(codes('Gravelaaaa lantern!')).toContain('repeated_characters');
    expect(codes('Gravelaaa lantern!')).not.toContain('repeated_characters');
  });

  it('rejects long sequences, ascending or descending', () => {
    expect(codes('Gravel12345 lantern!')).toContain('sequential_characters');
    expect(codes('Gravelabcde lantern!')).toContain('sequential_characters');
    expect(codes('Graveledcba lantern!')).toContain('sequential_characters');
    expect(codes('Gravel1234 lantern!')).not.toContain('sequential_characters');
  });
});

describe('what this module cannot do, and says so — FR-147', () => {
  it('always names the checks the caller still owes', () => {
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
    const short = validatePassword(EXACTLY_MIN, MEMBER).strength;
    const long = validatePassword(GOOD, MEMBER).strength;
    expect(long).toBeGreaterThan(short);
  });

  it('rates a four-word passphrase at the top', () => {
    expect(validatePassword(GOOD, MEMBER).strength).toBe(4);
  });

  it('penalises a long password built from very few distinct characters', () => {
    const repetitive = validatePassword('Ab!ababababababab', MEMBER);
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

describe('every failure explains how to fix itself, briefly', () => {
  it('says something, ends a sentence, and never leaks the code name', () => {
    /* ⚠️ The old assertion here was `message.length > 20`, which quietly
       required every refusal to be a paragraph. That is the habit the owner
       objected to on this screen. What matters is that it is a real
       instruction, not that it is long — "Add a symbol." is a better message
       than anything 20 characters could buy. */
    const samples = ['short', 'qwertyuiop123', 'passwordpassword', 'aaaaaaaaaaaaaa', 'trumpet99'];
    for (const sample of samples) {
      for (const failure of validatePassword(sample, MEMBER).failures) {
        expect(failure.message.length).toBeGreaterThan(8);
        expect(failure.message.endsWith('.')).toBe(true);
        expect(failure.message).not.toBe(failure.code);
        expect(failure.message).not.toContain('_');
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
    expect(validatePassword('x', MEMBER).minLength).toBe(8);
    expect(validatePassword('x', SUPER).minLength).toBe(12);
  });
});
