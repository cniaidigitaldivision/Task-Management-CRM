/* ============================================================================
 * PASSWORD POLICY — FR-147, doc 16 §5
 * ----------------------------------------------------------------------------
 * ⛔ LAYER 2 (Domain). Pure and deterministic — no clock, no network, no hash.
 *
 * Aligned to NIST SP 800-63B, which is deliberately the opposite of what most
 * systems still do:
 *
 *   · length is the requirement, not composition
 *   · NO forced symbols/numbers — that rule is what produces `Password1!`
 *   · NO forced rotation — periodic expiry produces weaker, incrementing
 *     passwords; rotate on evidence of compromise instead
 *   · paste is allowed, because blocking it breaks password managers, which
 *     are a large net security gain
 *   · every candidate is checked against a breach corpus
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* HERE, AND WHY
 *
 * The breach check (Have I Been Pwned, k-anonymity) is network I/O and belongs
 * to layer 3 — this module cannot make a request and stay pure or testable.
 * Reuse-of-last-5 needs Argon2 verification against stored hashes, which is
 * also layer 3. Both are required by FR-147; both are enforced by the server
 * action that calls this. `PasswordCheck.pending` names them explicitly so a
 * caller cannot forget one and believe the password was fully validated.
 * ========================================================================= */

import { ORGANISATION_NAME, ORGANISATION_SHORT_NAME, SYSTEM_DEFAULTS, type Role } from './constants';

export const PASSWORD_MAX_LENGTH = 128;

export type PasswordFailureCode =
  | 'too_short'
  | 'too_long'
  | 'contains_name'
  | 'contains_email'
  | 'contains_organisation'
  | 'keyboard_pattern'
  | 'common_password'
  | 'repeated_characters'
  | 'sequential_characters'
  | 'whitespace_only';

export interface PasswordFailure {
  readonly code: PasswordFailureCode;
  /** Shown to the person choosing the password. Says how to fix it. */
  readonly message: string;
}

export interface PasswordContext {
  readonly role: Role;
  readonly fullName?: string;
  readonly email?: string;
}

export interface PasswordCheck {
  readonly ok: boolean;
  readonly failures: readonly PasswordFailure[];
  /** 0 unusable · 1 weak · 2 fair · 3 strong · 4 excellent. Guidance, not a gate. */
  readonly strength: 0 | 1 | 2 | 3 | 4;
  readonly minLength: number;
  /**
   * Checks this module cannot perform. The caller MUST run these before
   * accepting the password — see the note at the top of this file.
   */
  readonly pending: readonly ['breach_check', 'reuse_check'];
}

const PENDING = ['breach_check', 'reuse_check'] as const;

/**
 * The Super Admin needs 16 characters, everyone else 12. doc 16 §5 / SA-2 —
 * the crown-jewel account gets the longer minimum because it is the one worth
 * attacking.
 */
export function minLengthFor(role: Role): number {
  return role === 'super_admin'
    ? SYSTEM_DEFAULTS.superAdminPasswordMinLength
    : SYSTEM_DEFAULTS.passwordMinLength;
}

/* --------------------------------------------------------------------------
 * Blocklists
 * ------------------------------------------------------------------------
 * Small and deliberate. This is NOT a substitute for the breach corpus — that
 * is millions of entries and lives behind the k-anonymity API. These are the
 * candidates specific to this deployment that a generic corpus would miss, plus
 * the handful so common they are worth refusing before a network round trip.
 */

const COMMON_PASSWORDS: readonly string[] = [
  'password',
  'passw0rd',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'changeme',
  'secret',
  'default',
  'temporary',
  'pakistan',
  'karachi',
  'lahore',
  'islamabad',
];

const KEYBOARD_PATTERNS: readonly string[] = [
  'qwerty',
  'qwertz',
  'azerty',
  'asdf',
  'asdfgh',
  'zxcv',
  'zxcvbn',
  'poiuy',
  'lkjh',
  '1qaz',
  '2wsx',
  'qazwsx',
];

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

export function validatePassword(password: string, context: PasswordContext): PasswordCheck {
  const failures: PasswordFailure[] = [];
  const minLength = minLengthFor(context.role);
  const lower = password.toLowerCase();

  /* ---- Length. The only hard requirement NIST keeps. ---- */
  if (password.trim().length === 0) {
    failures.push({
      code: 'whitespace_only',
      message: 'Enter a password.',
    });
  } else if (password.length < minLength) {
    failures.push({
      code: 'too_short',
      message: `Use at least ${minLength} characters. A short phrase of three or four words is easier to remember and far harder to guess.`,
    });
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    failures.push({
      code: 'too_long',
      message: `Keep it under ${PASSWORD_MAX_LENGTH} characters.`,
    });
  }

  /* ---- Anything guessable from what an attacker already knows ---- */
  for (const part of nameParts(context.fullName)) {
    if (lower.includes(part)) {
      failures.push({
        code: 'contains_name',
        message: 'Do not use your own name — it is the first thing anyone would try.',
      });
      break;
    }
  }

  const emailLocal = context.email?.split('@')[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    failures.push({
      code: 'contains_email',
      message: 'Do not use your email address in your password.',
    });
  }

  for (const org of [ORGANISATION_SHORT_NAME, ...ORGANISATION_NAME.split(/\s+/)]) {
    const token = org.toLowerCase();
    if (token.length >= 3 && lower.includes(token)) {
      failures.push({
        code: 'contains_organisation',
        message: 'Do not use the company name — an attacker starts there.',
      });
      break;
    }
  }

  /* ---- Shapes that look complex and are not ---- */
  if (KEYBOARD_PATTERNS.some((pattern) => lower.includes(pattern))) {
    failures.push({
      code: 'keyboard_pattern',
      message: 'Avoid keyboard runs like “qwerty” or “asdfgh”. They are in every cracking list.',
    });
  }

  if (COMMON_PASSWORDS.some((common) => lower.includes(common))) {
    failures.push({
      code: 'common_password',
      message: 'This contains a very common password. Choose something unrelated to it.',
    });
  }

  if (/(.)\1{3,}/.test(password)) {
    failures.push({
      code: 'repeated_characters',
      message: 'Avoid four or more of the same character in a row.',
    });
  }

  if (hasLongRun(lower, 5)) {
    failures.push({
      code: 'sequential_characters',
      message: 'Avoid long sequences like “12345” or “abcde”.',
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    strength: estimateStrength(password, failures.length > 0),
    minLength,
    pending: PENDING,
  };
}

/* --------------------------------------------------------------------------
 * Strength
 * ------------------------------------------------------------------------
 * Guidance for the meter, never a gate — the gate is `ok` above. Deliberately
 * simple and deterministic: zxcvbn is the right tool for a live meter, but it
 * is a 400KB dictionary-driven library, which is neither pure nor something
 * layer 2 should depend on. The UI may run zxcvbn on top of this; the server
 * decides with `ok`.
 */
function estimateStrength(password: string, hasFailures: boolean): 0 | 1 | 2 | 3 | 4 {
  if (hasFailures || password.length === 0) return 0;

  // Length dominates, which is the whole point of the NIST guidance.
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (password.length >= 24) score += 1;

  // Variety is a small bonus, never a requirement.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes >= 3) score += 1;

  // A passphrase of several words beats a mangled single word.
  const words = password.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  if (words.length >= 3) score += 1;

  const unique = new Set(password).size;
  if (unique < Math.min(6, password.length)) score -= 1;

  return Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
}

export const STRENGTH_LABEL: Readonly<Record<0 | 1 | 2 | 3 | 4, string>> = {
  0: 'Not usable',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Excellent',
};

/* -------------------------------------------------------------------------- */

function nameParts(fullName: string | undefined): string[] {
  if (!fullName) return [];
  return fullName
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

/** True if `value` contains a run of `length` consecutive code points. */
function hasLongRun(value: string, length: number): boolean {
  if (value.length < length) return false;
  let ascending = 1;
  let descending = 1;

  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= length || descending >= length) return true;
  }
  return false;
}
