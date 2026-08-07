'use server';

import { revalidatePath } from 'next/cache';
import { renderSVG } from 'uqr';

import { requireUser } from '@/lib/auth/current-user';
import { generateRecoveryCodes, hashRecoveryCode } from '@/lib/auth/tokens';
import { seal } from '@/lib/auth/secret-box';
import { generateTotpSecret, totpUri, verifyTotp } from '@/lib/auth/totp';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { resetMfaFor } from '@/lib/db/queries/auth';
import { getPerson } from '@/lib/db/queries/people';
import { ORGANISATION_SHORT_NAME, SYSTEM_DEFAULTS } from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * MFA ENROLMENT — FR-145, doc 16 §4
 * ----------------------------------------------------------------------------
 * The ceremony that was missing. Verification has existed since Step 4 and is
 * proven against RFC 6238's own test vectors; what did not exist was any way to
 * *enrol*, so an Admin or Super Admin was required to present a factor they had
 * never been given a chance to create. That locked the owner out of their own
 * system — found the hard way, by the owner, immediately after running setup.
 *
 * ── THE SECRET IS NOT SAVED UNTIL A CODE PROVES IT ───────────────────────────
 * `begin()` mints a secret and returns it with a QR code. It writes NOTHING.
 * `confirm()` takes the secret back with a six-digit code, checks the code
 * against it, and only then stores the factor — verified in the same statement.
 *
 * That ordering is the whole design. Storing an unverified factor first is the
 * obvious implementation and it is a lockout waiting to happen: somebody scans a
 * blurry QR, the app records a secret nobody's phone actually holds, and now the
 * account demands codes that can never be produced. A factor is either proven or
 * it does not exist.
 *
 * ── WHY THE SECRET TRAVELS THROUGH THE BROWSER ───────────────────────────────
 * Between those two calls the secret lives in a form field. That is not ideal,
 * and it is the price of not writing an unproven factor. It is bounded: the
 * secret is worthless without the password (the session already required it),
 * it never touches the database until proven, and any secret that is abandoned
 * is simply never stored. The alternative — a server-side pending record — is
 * an unverified factor by another name, plus expiry logic to get wrong.
 *
 * ── THE SECRET IS ENCRYPTED BEFORE IT IS STORED ──────────────────────────────
 * `seal()` is AES-256-GCM under MFA_ENCRYPTION_KEY (lib/auth/secret-box.ts).
 * Until this existed the column held plaintext despite its name, and database
 * access alone was enough to generate a valid second factor for any enrolled
 * account — which undid most of the point of requiring one.
 * ========================================================================= */

export interface MfaBeginResult {
  readonly secret: string;
  readonly uri: string;
  /** An inline SVG. Rendered on the server so no QR library reaches the client. */
  readonly qrSvg: string;
  /** The secret in groups of four, for typing into an app by hand. */
  readonly readableSecret: string;
}

export interface MfaConfirmResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Issued only when an account had none. Shown once, never again. */
  readonly recoveryCodes?: readonly string[];
}

/** Groups of four. A 32-character run of base32 is unreadable and mistyped. */
function readable(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Start enrolment: mint a secret, and render the QR for it.
 *
 * Nothing is written. Called again on every page load, so refreshing the screen
 * mid-enrolment produces a *different* secret — which is why the form carries the
 * one being confirmed rather than the server assuming its latest.
 */
export async function beginMfaEnrolment(): Promise<MfaBeginResult> {
  const user = await requireUser();

  const secret = generateTotpSecret();
  const uri = totpUri({
    secret,
    accountName: user.email,
    issuer: `${ORGANISATION_SHORT_NAME} CRM`,
  });

  return {
    secret,
    uri,
    /* `border: 1` rather than the conventional 4-module quiet zone: the SVG sits
       on a padded white card that already provides the contrast a scanner needs,
       and four modules of internal margin makes the code visibly smaller for no
       benefit. */
    qrSvg: renderSVG(uri, { border: 1 }),
    readableSecret: readable(secret),
  };
}

/**
 * Finish enrolment: prove the code, then store the factor.
 *
 * The factor is written with `verified_at` already set, in one statement, because
 * a row that exists unverified is the lockout described in the header.
 */
export async function confirmMfaEnrolment(
  _prev: MfaConfirmResult,
  form: FormData,
): Promise<MfaConfirmResult> {
  const user = await requireUser();

  const secret = String(form.get('secret') ?? '').trim();
  const code = String(form.get('code') ?? '')
    .replace(/\s/g, '')
    .trim();
  const label = String(form.get('label') ?? '').trim() || 'Authenticator app';

  if (!secret) {
    return { ok: false, error: 'That enrolment expired. Reload the page and scan the new code.' };
  }
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Enter the six digits your authenticator app is showing.' };
  }

  /* The same verifier the sign-in uses — one implementation, and it already
     allows one time step either side for clock drift between phone and server. */
  if (!verifyTotp(secret, code, nowMs())) {
    return {
      ok: false,
      error:
        'That code was not accepted. Check you entered the current one — they change every 30 seconds — and that the app has the right account.',
    };
  }

  try {
    const codes = await withUser(user.id, async (tx) => {
      /* Any earlier unverified attempt is cleared. There should not be one — this
         only ever writes verified factors — but an interrupted enrolment from a
         previous build could leave one, and the sign-in treats *any* factor as
         a demand for a code. */
      await tx`
        delete from public.mfa_factors
         where user_id = ${user.id} and type = 'totp' and verified_at is null
      `;

      await tx`
        insert into public.mfa_factors
          (user_id, type, secret_encrypted, friendly_name, is_primary, verified_at)
        values (
          ${user.id}, 'totp', ${seal(secret)}, ${label.slice(0, 80)},
          not exists (
            select 1 from public.mfa_factors
             where user_id = ${user.id} and verified_at is not null
          ),
          now()
        )
      `;

      /* Recovery codes are what get somebody back in when the phone is gone, and
         nobody else can reset a Super Admin (FR-140). The setup route already
         issued ten; only mint a set if the account genuinely has none, so
         enrolling a second device does not silently invalidate the printed sheet
         somebody is relying on. */
      const existing = await tx`
        select count(*) as n from public.recovery_codes
         where user_id = ${user.id} and used_at is null
      `;
      if (Number(existing[0].n) > 0) return null;

      const fresh = generateRecoveryCodes(SYSTEM_DEFAULTS.recoveryCodeCount);
      await tx`
        insert into public.recovery_codes (user_id, code_hash)
        select ${user.id}, h from unnest(${fresh.map(hashRecoveryCode)}::text[]) as h
      `;
      return fresh;
    });

    revalidatePath('/', 'layout');
    return { ok: true, recoveryCodes: codes ?? undefined };
  } catch {
    return { ok: false, error: 'The authenticator could not be saved. Nothing was changed.' };
  }
}

/** What the screen needs to know before it decides what to show. */
export async function mfaStatus(): Promise<{
  hasVerifiedFactor: boolean;
  unusedRecoveryCodes: number;
}> {
  const user = await requireUser();

  const rows = await withUser(user.id, (tx) => tx`
    select
      (select count(*) from public.mfa_factors
        where user_id = ${user.id} and verified_at is not null) as factors,
      (select count(*) from public.recovery_codes
        where user_id = ${user.id} and used_at is null) as codes
  `);

  return {
    hasVerifiedFactor: Number(rows[0].factors) > 0,
    unusedRecoveryCodes: Number(rows[0].codes),
  };
}

/* ==========================================================================
 * ADMIN AND SELF-SERVICE RECOVERY — doc 03 §3.1, FR-146, SA-9
 * ========================================================================== */

/**
 * Clear somebody's authenticators so they can enrol again — the answer to "I
 * lost my phone and my recovery codes".
 *
 * The rank rules live in `app.mfa_reset_for` rather than here, because they are
 * the same rules the database must enforce anyway: an Admin only downward, and
 * the Super Admin's factor removable by nobody else at all (FR-146). Checking
 * here as well would be a second implementation; this catches the refusal and
 * turns it into a sentence.
 */
export async function resetMfaForAction(targetId: string): Promise<MfaConfirmResult> {
  const user = await requireUser();

  const target = await getPerson(user.id, targetId);
  if (!target) return { ok: false, error: 'That person is no longer available.' };

  try {
    const removed = await resetMfaFor(user.id, targetId);

    await withUser(user.id, async (tx) => {
      await audit(tx, user, {
        entityType: 'user',
        entityId: targetId,
        action: 'user.mfa_reset',
        after: { email: target.email, factorsRemoved: removed },
      });
    });

    /* Their sessions stay. Resetting the second factor does not mean the
       password is compromised, and signing somebody out of work in progress
       because they lost a phone is a punishment rather than a protection. The
       next sign-in will require enrolment. */
    revalidatePath('/team');
    revalidatePath('/security');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      error: message.includes('Super Admin')
        ? 'The Super Admin’s authenticator cannot be reset by anybody else. Their recovery codes are the way back in (FR-146).'
        : message.includes('below your own rank')
          ? 'You can only manage people below your own rank.'
          : 'That reset was refused.',
    };
  }
}

/**
 * Issue a fresh set of recovery codes for yourself, invalidating the old ones.
 *
 * ── WHY THE OLD SET IS DESTROYED IN THE SAME TRANSACTION ─────────────────────
 * Two live sets means a printed sheet somebody threw away last year still opens
 * the account. The whole value of regenerating is that the previous codes stop
 * working, so it happens atomically — never "issue new, then clean up old",
 * which leaves both valid if the second half fails.
 */
export async function regenerateRecoveryCodesAction(): Promise<MfaConfirmResult> {
  const user = await requireUser();

  try {
    const codes = generateRecoveryCodes(SYSTEM_DEFAULTS.recoveryCodeCount);

    await withUser(user.id, async (tx) => {
      await tx`delete from public.recovery_codes where user_id = ${user.id}`;
      await tx`
        insert into public.recovery_codes (user_id, code_hash)
        select ${user.id}, h from unnest(${codes.map(hashRecoveryCode)}::text[]) as h
      `;
      await audit(tx, user, {
        entityType: 'user',
        entityId: user.id,
        action: 'user.recovery_codes_regenerated',
        after: { count: codes.length },
      });
    });

    revalidatePath('/profile');
    return { ok: true, recoveryCodes: codes };
  } catch {
    return { ok: false, error: 'New codes could not be issued. The old ones still work.' };
  }
}
