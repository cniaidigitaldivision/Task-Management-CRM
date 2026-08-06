'use server';

import { hashPassword } from '@/lib/auth/hashing';
import { generateRecoveryCodes, hashRecoveryCode } from '@/lib/auth/tokens';
import { withAppRole } from '@/lib/db/client';
import { validatePassword } from '@/lib/domain/password-policy';

/* ============================================================================
 * ONE-TIME SUPER ADMIN SETUP — FR-140, ADR-009, doc 20 §9 step 5.1
 * ----------------------------------------------------------------------------
 * The system ships with nothing but this route, and it disables itself the
 * moment it succeeds.
 *
 * ── "SELF-DISABLING" IS STRUCTURAL, NOT A FLAG ───────────────────────────────
 * `users_single_super_admin_idx` (migration 001) permits exactly one
 * `super_admin` row to exist, ever. So a second run cannot succeed even if
 * someone reached the URL — the database refuses it. The availability check
 * exists only so the failure is a clear sentence rather than a unique-violation.
 *
 * That is the difference between a route that is disabled and a route that is
 * *impossible*, and it is why BR-028 is enforced by an index rather than by a
 * boolean somebody could flip back.
 * ========================================================================= */

export interface SetupState {
  readonly error?: string;
  readonly failures?: readonly string[];
  /** Shown EXACTLY once, on success. Never retrievable afterwards. */
  readonly recoveryCodes?: readonly string[];
  readonly email?: string;
  readonly fullName?: string;
}

export async function isSetupAvailable(): Promise<boolean> {
  const rows = await withAppRole((tx) => tx`select app.setup_is_available() as ok`);
  return rows[0].ok === true;
}

export async function completeSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const echo = { email, fullName };

  if (!(await isSetupAvailable())) {
    return {
      error:
        'Setup has already been completed. A second Super Admin can only be created through the sealed recovery procedure.',
    };
  }

  if (!fullName || !email) {
    return { error: 'Enter a name and an email address.', ...echo };
  }
  if (password !== confirm) {
    return { error: 'The two passwords do not match.', ...echo };
  }

  /* The Super Admin is held to 16 characters, not 12 (SA-2) — the crown-jewel
     account gets the longer minimum because it is the one worth attacking. */
  const check = validatePassword(password, { role: 'super_admin', fullName, email });
  if (!check.ok) {
    return {
      error: 'That password cannot be used yet.',
      failures: check.failures.map((f) => f.message),
      ...echo,
    };
  }

  /* ⚠️ `check.pending` names the two things the domain layer cannot do — the
     breach-corpus lookup and the reuse check. Neither applies here: there is no
     history to reuse on a brand-new account, and the breach check is a network
     call that arrives with the activation flow (5.3). Named rather than
     silently skipped, so nobody later assumes it ran. */

  const codes = generateRecoveryCodes(10);
  const passwordHash = await hashPassword(password);
  const codeHashes = codes.map(hashRecoveryCode);

  try {
    await withAppRole(
      (tx) => tx`
        select app.setup_super_admin(
          ${fullName}, ${email}, ${passwordHash}, ${codeHashes}
        )
      `,
    );
  } catch {
    // Generic: whatever went wrong, the page must not leak schema detail.
    return { error: 'Setup could not be completed. Check the server logs.', ...echo };
  }

  // The ONLY time these are ever visible. Hash-only in the database (SA-9).
  return { recoveryCodes: codes };
}
