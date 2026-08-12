import type { ResetTrail } from '@/lib/db/queries/auth';

/* ============================================================================
 * RESET TRAIL VIEW MODEL — CHANGE-PLAN 4.1
 * ----------------------------------------------------------------------------
 * What the forced-reset status panel renders, as distinct from `ResetTrail`
 * (what the database returns). Two differences, both deliberate:
 *
 * ── DATES CROSS AS ISO STRINGS ───────────────────────────────────────────────
 * A server component may hand a `Date` to a client component, but the boundary
 * is clearer when the shape says so, and it is the same reason `task-view.ts`
 * exists: whatever crosses should be plainly serialisable rather than relying on
 * what the framework happens to allow this version.
 *
 * ── `expired` IS DECIDED ON THE SERVER ───────────────────────────────────────
 * Not by comparing dates in the browser. A machine with a wrong clock would
 * otherwise report a live link as expired, or — worse — an expired one as live,
 * and the panel's whole job is to be trustworthy about exactly that.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
 * Because it has two callers — the Team page renders the whole team's trails,
 * and the single-person action reads one — and the first version of it existed
 * twice. Two copies of a function that decides whether a security link reads as
 * expired will drift, and the drift would be silent.
 * ========================================================================= */

export interface ResetTrailView {
  readonly id: string;
  readonly sentToEmail: string;
  readonly sentAt: string;
  readonly expiresAt: string;
  readonly expired: boolean;
  readonly openedAt: string | null;
  readonly completedAt: string | null;
  readonly revokedAt: string | null;
  readonly attemptCount: number;
  /**
   * What the mail provider said when asked to send — **not** proof of delivery.
   * `accepted` means Resend took it. See `emailSandbox`.
   */
  readonly emailState: 'accepted' | 'refused' | 'unreachable' | 'not_configured' | null;
  readonly emailDetail: string | null;
  /**
   * Whether the sandbox sender was in use **when this was sent**, read from the
   * row rather than from the environment now. Verifying a sending domain next
   * month must not retroactively make an old, silently-dropped message look as
   * though it arrived.
   */
  readonly emailSandbox: boolean | null;
  readonly forcedByName: string | null;
}

/**
 * One readable sentence for a failed send.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `email_detail` stores what the provider actually said, verbatim, because that
 * is the record and it must not be lossy. But what Resend says is a JSON blob:
 *
 *     Resend refused it (403). {"statusCode":403,"name":"validation_error",
 *     "message":"You can only send testing emails to your own email address…"}
 *
 * Rendering that raw — which the first version did — puts a wall of punctuation
 * in front of somebody trying to find out whether an email reached their
 * colleague. The raw text is kept and still shown on request; this is what the
 * panel leads with.
 *
 * The sandbox case is recognised specifically because it is not a fault to
 * investigate — it is a known, expected state with one known fix, and saying so
 * saves reading the JSON to work that out.
 */
export function describeEmailFailure(detail: string | null): {
  readonly summary: string;
  /** True when the cause is the unverified sending domain, not a real fault. */
  readonly isSandboxLimit: boolean;
} {
  const text = detail ?? '';

  /* Matched on Resend's own error name plus the phrase, not on the 403 alone: a
     403 could later mean a revoked key, which is a different problem with a
     different fix and must not be described as the domain limit. */
  if (/validation_error/.test(text) && /only send testing emails/i.test(text)) {
    return {
      summary:
        'Resend refused it: no sending domain has been verified yet, so it will only deliver to the address that owns the Resend account. Nobody else can receive mail until a domain is added.',
      isSandboxLimit: true,
    };
  }

  if (/^\s*$/.test(text)) return { summary: 'The provider gave no reason.', isSandboxLimit: false };

  /* Anything else: lead with the provider's own message if one can be found in
     the blob, and fall back to the blob itself rather than hiding it. */
  const message = text.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  return {
    summary: message ? `Resend refused it: ${message}` : text,
    isSandboxLimit: false,
  };
}

/** `now` is passed in rather than read here, so this stays pure and testable. */
export function toResetTrailView(trail: ResetTrail, now: number): ResetTrailView {
  return {
    id: trail.id,
    sentToEmail: trail.sentToEmail,
    sentAt: trail.createdAt.toISOString(),
    expiresAt: trail.expiresAt.toISOString(),
    expired: trail.expiresAt.getTime() <= now,
    openedAt: trail.linkOpenedAt?.toISOString() ?? null,
    completedAt: trail.consumedAt?.toISOString() ?? null,
    revokedAt: trail.invalidatedAt?.toISOString() ?? null,
    attemptCount: trail.attemptCount,
    emailState: trail.emailState,
    emailDetail: trail.emailDetail,
    emailSandbox: trail.emailSandbox,
    forcedByName: trail.forcedByName,
  };
}
