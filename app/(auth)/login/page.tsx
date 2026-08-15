import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardBody } from '@/components/ui/card';

import { LoginForm } from './login-form';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = {
  title: 'Sign in',
};

/* ============================================================================
 * SIGN IN — FR-001, doc 16 §3, §4
 * ----------------------------------------------------------------------------
 * A Server Component wrapping one client form. The form holds no rules; every
 * decision — lockout, constant-time failure, whether MFA is required — is made
 * by the server action in ./actions.ts, which in turn defers to lib/domain/.
 *
 * The whole flow is now live: identity lookup, Argon2id verification, the
 * 3-attempt lockout with its 30-minute auto-clear, TOTP, and a device-bound
 * session with role-scoped lifetimes.
 *
 * ── WHY `?reason=` IS WORDED HERE ────────────────────────────────────────────
 * `requireUser()` has always redirected here with a reason, and nothing ever
 * displayed it. So being signed out mid-session dropped somebody on a sign-in
 * page that looked identical whether their session had simply idled out or an
 * Admin had locked their account until they change their password. That is the
 * same complaint as B2 — *"I don't see what happens"* — and CHANGE-PLAN 4.1
 * makes it common, because forcing a reset signs the person out everywhere.
 *
 * ── IT REVEALS NOTHING (FR-155e) ─────────────────────────────────────────────
 * Every message here describes the session that has just ended, which the reader
 * necessarily had. None of them says whether an account exists, so this cannot
 * be used to enumerate anybody: an unknown address still gets nothing but the
 * plain form, because there is no session to have a reason about.
 * ========================================================================= */

/** Only these are worded. Anything else falls through to no banner at all. */
const REASONS: Readonly<Record<string, { title: string; detail: string }>> = {
  inactive: {
    title: 'Your account needs attention before you can sign in',
    detail:
      'It may be waiting for a new password, for an authenticator to be set up, or it may have been suspended. If an administrator asked you to reset your password, use “Forgot your password?” below and the code will let you set a new one.',
  },
  revoked: {
    title: 'You were signed out',
    detail:
      'This can happen because your password changed, or because an administrator ended your sessions. Signing in again is all that is needed.',
  },
  expired: {
    title: 'That session had expired',
    detail: 'Sessions do not last indefinitely. Sign in again to carry on.',
  },
  idle: {
    title: 'You were signed out after a period of inactivity',
    detail: 'A session that goes unused is ended on purpose. Sign in again to carry on.',
  },
  unlocked: {
    title: 'Your account is unlocked',
    detail: 'Your password has not changed — sign in with the one you already had.',
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const [{ reason }, settings] = await Promise.all([searchParams, getSettings()]);
  const lockAfter = Number(settings.failedLoginsToLock);
  const notice = reason ? REASONS[reason] : undefined;

  return (
    /* ── STEP 9: THE ORBITING BORDER ──────────────────────────────────────────
       `video_3bf300fd145b` — two arcs travelling the perimeter 180° apart. Ours
       are teal and gold rather than the video's cyan and magenta, per the
       owner's standing constraint on the whole redesign.

       Only the SIGN-IN card gets it. It is the one screen with a single thing to
       do and nothing to read, which is exactly where a moving accent costs
       nothing; the same border around a form somebody is trying to fill in would
       be a distraction. Activation, reset and setup deliberately keep the plain
       card.

       `.glass` is right here for the same reason it is right on the top bar: this
       is chrome, not a data panel, and the page behind it is the brand gradient
       rather than text. */
    <Card className="orbit-border glass shadow-lg">
      <CardBody className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-h2 text-text-primary">Sign in</h1>
          <p className="text-caption text-text-secondary">
            Use the email address your administrator set your account up with.
          </p>
        </div>

        {notice && (
          <div
            className="space-y-1 rounded-lg px-3 py-2.5"
            style={{ backgroundColor: 'var(--bg-subtle)' }}
          >
            <p className="text-caption font-semibold text-text-primary">{notice.title}</p>
            <p className="text-micro text-text-secondary">{notice.detail}</p>
          </div>
        )}

        <LoginForm />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-subtle pt-4">
          <Link
            href="/forgot-password"
            className="text-caption font-semibold text-text-brand hover:underline focus-visible:outline-none"
          >
            Forgot your password?
          </Link>
          <span className="text-micro text-text-tertiary">
            {lockAfter} failed attempts locks the account
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
