'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { hashPassword } from '@/lib/auth/hashing';
import { issueSession, type RequestFacts } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { withAppRole } from '@/lib/db/client';
import { consumeToken, setPassword } from '@/lib/db/queries/auth';
import { sendEmail } from '@/lib/email/send';
import { welcomeEmail } from '@/lib/email/templates';
import { MFA_REQUIRED_ROLES, ROLE_LABEL, type Role } from '@/lib/domain/constants';
import { validatePassword } from '@/lib/domain/password-policy';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * ACTIVATION — FR-142, FR-143, doc 16 §3
 * ----------------------------------------------------------------------------
 * The other end of the invitation. Somebody arrives with a link, chooses a
 * password, and the account becomes usable.
 *
 * ── EVERY REFUSAL IS THE SAME SENTENCE ───────────────────────────────────────
 * Expired, already used, superseded by a re-send, burned by too many attempts,
 * never existed — all one message. The distinctions are real and the caller does
 * not get them: "already used" tells somebody holding a stolen link that the
 * account exists and was activated, and "not found" versus "expired" tells them
 * whether they are guessing in the right space. The person who legitimately needs
 * a working link asks for another one, which costs them nothing.
 *
 * ── THE TOKEN IS BURNED BEFORE THE PASSWORD IS SET, NOT AFTER ────────────────
 * `auth_consume_token` marks it used and returns the user in one statement. If
 * the password write then failed, the link is spent and they need a new one —
 * mildly annoying. The other order allows the same link to be replayed while a
 * slow write is in flight. Annoying beats replayable.
 * ========================================================================= */

export interface ActivationState {
  readonly error?: string;
  readonly failures?: readonly string[];
  readonly fullName?: string;
}

const GENERIC =
  'That link is not usable. It may have expired, already been used, or been replaced by a newer one. Ask whoever invited you to send another.';

async function requestFacts(): Promise<RequestFacts> {
  const list = await headers();
  return {
    userAgent: list.get('user-agent'),
    acceptLanguage: list.get('accept-language'),
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ipCountry: list.get('x-vercel-ip-country'),
    ipAsn: list.get('x-vercel-ip-asn'),
  };
}

/**
 * Look the token up without spending it, so the page can greet the person by
 * name and apply the right password rules for their role.
 *
 * Reads `invitations` directly through the app role rather than through
 * `auth_consume_token`, because consuming on a page *render* would burn the link
 * on a refresh — or on a mail client that prefetches URLs, which several do.
 */
export async function inspectToken(token: string): Promise<{
  valid: boolean;
  fullName?: string;
  email?: string;
  role?: Role;
} > {
  if (!token || token.length < 20) return { valid: false };

  /* ── ⚠️ THROUGH A DEFINER FUNCTION, NOT A DIRECT SELECT — migration 044 ────
     This was a direct join across `invitations` and `users`, and it could never
     return a row. `withAppRole` sets `role = cni_app` and deliberately no
     `app.user_id`, because the reader here IS an anonymous stranger holding a
     link. Both tables have RLS written in terms of the current user, so with no
     identity both return nothing — the query was right, the token was right,
     and the row was invisible.

     An empty result is indistinguishable from an expired token in this
     function's shape, so it surfaced as "This link is not usable" with no error
     anywhere. Nobody had ever successfully activated an account through this
     page, in any environment.

     Measured: the old query returns 0 rows anonymously and 1 row identified. */
  const rows = await withAppRole((tx) => tx`
    select full_name, email, role
      from app.auth_inspect_activation(${hashToken(token)})
  `);

  if (!rows[0]) return { valid: false };
  return {
    valid: true,
    fullName: rows[0].full_name as string,
    email: rows[0].email as string,
    role: rows[0].role as Role,
  };
}

export async function activateAccount(
  _prev: ActivationState,
  form: FormData,
): Promise<ActivationState> {
  const token = String(form.get('token') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  if (!token) return { error: GENERIC };

  /* Peek first, so the password can be judged against the right rules — the
     Super Admin's 16-character floor differs from everyone else's 12 (SA-2) —
     and so a rejected password does not cost the token. */
  const found = await inspectToken(token);
  if (!found.valid || !found.role) return { error: GENERIC };

  if (password !== confirm) {
    return { error: 'The two passwords do not match.', fullName: found.fullName };
  }

  const check = validatePassword(password, {
    role: found.role,
    fullName: found.fullName,
    email: found.email,
  });
  if (!check.ok) {
    return {
      error: 'That password cannot be used yet.',
      failures: check.failures.map((f) => f.message),
      fullName: found.fullName,
    };
  }

  /* Hash before consuming: Argon2 takes ~100ms, and spending the token first
     would leave it burned if this process died mid-hash. */
  const passwordHash = await hashPassword(password);

  const consumed = await consumeToken(hashToken(token), 'activation');
  if (consumed.status !== 'ok' || !consumed.userId) {
    return { error: GENERIC, fullName: found.fullName };
  }

  /* Sets the hash, trims history to five, revokes every session, clears any
     lock — all inside app.auth_set_password (migration 010). */
  await setPassword(consumed.userId, passwordHash);

  /* ── ⚠️ DEFINER FUNCTION, NOT A DIRECT UPDATE — migration 045 ──────────────
     This was the bare UPDATE, and it matched zero rows every time: no
     `app.user_id` is set here (the caller is still anonymous — they are setting
     the credential that will give them an identity), and `users_update` is
     identity-scoped.

     An UPDATE matching nothing is not an error, so the flow carried on: token
     spent, password stored, session issued, welcome email sent, person
     redirected — with `account_state` still `pending_activation` and the
     invitation now unusable. */
  await withAppRole((tx) => tx`select app.auth_activate_account(${consumed.userId})`);

  /* Reported, never thrown: the account is already active, and a welcome email
     that fails to send must not make a successful activation look broken. */
  const message = welcomeEmail({
    fullName: found.fullName ?? 'there',
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4310').replace(/\/+$/, ''),
    roleLabel: ROLE_LABEL[found.role],
  });
  /* Spread whole — the template also carries the header mark as an inline
     attachment, and naming the fields individually drops it. */
  void sendEmail({ to: found.email ?? '', ...message });

  /* Straight in, rather than back to a sign-in form asking for the password they
     typed ten seconds ago. They proved possession of the invitation and just set
     the credential; a second challenge proves nothing and loses people. */
  await issueSession(consumed.userId, found.role, await requestFacts(), nowMs());

  redirect(
    MFA_REQUIRED_ROLES.includes(found.role)
      ? '/mfa-setup'
      : found.role === 'member'
        ? '/my-work'
        : '/dashboard',
  );
}
