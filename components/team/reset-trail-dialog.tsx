'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MailX,
  MousePointerClick,
  Send,
  ShieldOff,
} from 'lucide-react';

import {
  resendResetAction,
  revokeResetLinkAction,
  type ResetTrailView,
} from '@/app/actions/team';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* ============================================================================
 * FORCED-RESET STATUS — CHANGE-PLAN 4.1
 * ----------------------------------------------------------------------------
 * Owner: *"give me the status for the Super Admin."*
 *
 * ── THE WHOLE VALUE OF THIS PANEL IS THAT IT DOES NOT OVERSTATE ──────────────
 * A status screen that says "delivered" when nothing was delivered is worse than
 * no status screen, because somebody will wait on it. So each row shows only
 * what is actually known:
 *
 *   Sent        a token was issued — certain, it is a row in the database
 *   Accepted    the mail provider took it. NOT delivery. See the warning below
 *   Opened      the reset page was loaded with this live link — server-side fact
 *   Completed   the code was consumed and a new password set — certain
 *
 * ── WHY THERE IS NO "DELIVERED" AND NO "READ THE EMAIL" ──────────────────────
 * Delivery would need Resend to call a webhook back, which is worth nothing
 * until a sending domain is verified. An email *open* would need a tracking
 * pixel, and most clients block images — a missing open would mean nothing and a
 * present one would be a guess. The link being opened is a stronger fact than
 * either and needs no pixel, so it is what is shown.
 *
 * ── ⚠️ THE SANDBOX WARNING IS THE MOST IMPORTANT THING HERE ──────────────────
 * `onboarding@resend.dev` accepts mail for anybody with a 200 and delivers only
 * to the address that owns the Resend account. So "accepted" plus sandbox means
 * **it never arrived**, and this panel says exactly that. `emailSandbox` is read
 * from the row rather than from the environment, so a domain verified next month
 * cannot retroactively make an old dropped message look fine.
 * ========================================================================= */

export function ResetTrailDialog({
  open,
  onClose,
  person,
  trail,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  person: { id: string; fullName: string };
  /** Rendered from the page's own data. See `getForcedResetTrails`. */
  trail: ResetTrailView | null;
  /** Asks the caller to re-fetch the page so `trail` reflects what just changed. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<null | 'resend' | 'revoke'>(null);
  const [note, setNote] = React.useState<{ tone: 'good' | 'warn'; text: string } | null>(null);

  const act = async (kind: 'resend' | 'revoke') => {
    setBusy(kind);
    try {
      const result =
        kind === 'resend'
          ? await resendResetAction(person.id)
          : await revokeResetLinkAction(person.id);

      if (!result.ok) setNote({ tone: 'warn', text: result.error ?? 'That did not work.' });
      else if (result.warning) setNote({ tone: 'warn', text: result.warning });
      else setNote({ tone: 'good', text: result.message ?? 'Done.' });

      /* Refreshed either way: a REFUSED send still issued a new code and still
         moved the expiry, so the panel must not go on showing the old one. */
      if (result.ok) onChanged();
    } catch {
      setNote({
        tone: 'warn',
        text: 'The server did not answer, so nothing is confirmed. Reopen this to see the real state.',
      });
    } finally {
      setBusy(null);
    }
  };

  const live =
    trail !== null &&
    !trail.completedAt &&
    !trail.revokedAt &&
    !trail.expired;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`Password reset · ${person.fullName}`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy !== null}>
            Close
          </Button>
          {trail && !trail.completedAt && (
            <>
              <Button
                variant="ghost"
                size="md"
                disabled={busy !== null || !live}
                onClick={() => void act('revoke')}
                title={live ? undefined : 'There is no live link to revoke.'}
              >
                {busy === 'revoke' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Revoke link
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={busy !== null}
                onClick={() => void act('resend')}
              >
                {busy === 'resend' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                )}
                Resend
              </Button>
            </>
          )}
        </>
      }
    >
      {!trail ? (
        <p className="text-caption text-text-secondary">
          No reset has been forced for {person.fullName}. If they have simply forgotten their
          password they can use{' '}
          <span className="font-semibold text-text-primary">Forgot your password?</span> themselves —
          forcing one is for when you need them locked out until they change it.
        </p>
      ) : (
        <div className="space-y-4">
          {note && (
            <p
              className="rounded-lg px-3 py-2 text-caption"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                color: note.tone === 'good' ? 'var(--feedback-success)' : 'var(--feedback-warning)',
              }}
            >
              {note.text}
            </p>
          )}

          <Trail trail={trail} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-subtle pt-3 text-caption">
            <Fact label="Sent to" value={trail.sentToEmail} />
            <Fact label="Forced by" value={trail.forcedByName ?? 'unknown'} />
            <Fact
              label={trail.expired ? 'Expired' : 'Expires'}
              value={when(trail.expiresAt)}
              tone={trail.expired && live === false && !trail.completedAt ? 'warn' : undefined}
            />
            <Fact
              label="Wrong codes entered"
              value={`${trail.attemptCount} of 5`}
              tone={trail.attemptCount >= 4 ? 'warn' : undefined}
            />
          </dl>

          {/* The caveat, worded for the state it is actually in. */}
          {trail.emailState === 'accepted' && trail.emailSandbox && (
            <Caveat>
              Resend accepted this and <strong>did not deliver it</strong>. Until a sending domain is
              verified, only the address that owns the Resend account receives mail — everything else
              is taken with a 200 and dropped. Treat &ldquo;accepted&rdquo; as
              &ldquo;queued into a void&rdquo; and give {person.fullName} the link another way.
            </Caveat>
          )}
          {trail.emailState === 'not_configured' && (
            <Caveat>
              No email was attempted, because <code>RESEND_API_KEY</code> is not set. The reset is
              real and the code exists — it just has not been sent to anybody.
            </Caveat>
          )}
          {(trail.emailState === 'refused' || trail.emailState === 'unreachable') && (
            <Caveat>
              The mail provider did not take it: {trail.emailDetail}
            </Caveat>
          )}
          {trail.emailState === 'accepted' && !trail.emailSandbox && !trail.openedAt && (
            <p className="text-micro text-text-tertiary">
              Accepted by the mail provider means it left here, not that it arrived — a bounce would
              not be visible without a delivery webhook. If the link is never opened, resend it and
              check the address.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ---- The four steps ------------------------------------------------------ */

function Trail({ trail }: { trail: ResetTrailView }) {
  const steps = [
    {
      icon: Send,
      label: 'Reset forced',
      at: trail.sentAt,
      done: true,
      note: null as string | null,
    },
    {
      icon: trail.emailState === 'accepted' ? Mail : MailX,
      label:
        trail.emailState === 'accepted'
          ? trail.emailSandbox
            ? 'Accepted by Resend — not delivered'
            : 'Accepted by the mail provider'
          : trail.emailState === 'not_configured'
            ? 'Not sent — no mail provider configured'
            : trail.emailState === null
              ? 'Sending not recorded'
              : 'The mail provider refused it',
      at: null,
      done: trail.emailState === 'accepted' && !trail.emailSandbox,
      note: trail.emailState === 'accepted' && trail.emailSandbox ? 'no verified domain' : null,
    },
    {
      icon: MousePointerClick,
      label: trail.openedAt ? 'Link opened' : 'Link not opened yet',
      at: trail.openedAt,
      done: trail.openedAt !== null,
      note: null,
    },
    {
      icon: trail.revokedAt ? ShieldOff : Check,
      label: trail.revokedAt
        ? 'Link revoked — no password was set'
        : trail.completedAt
          ? 'New password set'
          : trail.expired
            ? 'Expired before they used it'
            : 'Waiting for them to set a password',
      at: trail.revokedAt ?? trail.completedAt,
      done: trail.completedAt !== null,
      note: null,
    },
  ];

  return (
    <ol className="space-y-2.5">
      {steps.map((step) => {
        const Icon = step.icon;
        return (
          <li key={step.label} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                step.done ? 'text-text-inverse' : 'text-text-tertiary',
              )}
              style={step.done ? { backgroundColor: 'var(--feedback-success)' } : { backgroundColor: 'var(--bg-active)' }}
            >
              <Icon className="h-3 w-3" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-caption',
                  step.done ? 'font-semibold text-text-primary' : 'text-text-secondary',
                )}
              >
                {step.label}
              </p>
              {step.at && <p className="tabular text-micro text-text-tertiary">{when(step.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-text-tertiary">{label}</dt>
      <dd
        className="truncate font-medium"
        style={tone === 'warn' ? { color: 'var(--feedback-warning)' } : { color: 'var(--text-primary)' }}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
    >
      <AlertTriangle
        className="mt-px h-4 w-4 shrink-0"
        strokeWidth={2.25}
        aria-hidden="true"
        style={{ color: 'var(--feedback-warning)' }}
      />
      <span>{children}</span>
    </p>
  );
}

/* Rendered from the ISO string the action returns. `undefined` locale so it
   follows the reader's own formatting rather than a hard-coded one. */
function when(iso: string): string {
  const at = new Date(iso);
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

