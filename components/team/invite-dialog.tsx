'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Copy, Loader2, Mail, UserPlus } from 'lucide-react';

import { invitePersonAction, type TeamActionResult } from '@/app/actions/team';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OFFICE_TEAMS, OFFICE_TEAM_KEYS } from '@/lib/domain/attendance';
import { ROLE_LABEL, SYSTEM_DEFAULTS, type Role } from '@/lib/domain/constants';

/* ============================================================================
 * ADD SOMEBODY TO THE TEAM
 * ----------------------------------------------------------------------------
 * ── THERE IS NO PASSWORD FIELD, AND THAT IS THE FEATURE ──────────────────────
 * The obvious form has one. This one cannot: the account is created with no
 * credential at all, and the invitee sets their own through a single-use link.
 * Nothing to leak, because nothing exists to leak (doc 16 §3).
 *
 * ── THE LINK IS ALWAYS SHOWN, EVEN WHEN THE EMAIL WORKED ─────────────────────
 * Because on the free Resend sender it very often has not arrived, whatever the
 * API said. The sandbox address only delivers to the Resend account's own
 * mailbox and drops everything else with a cheerful 200. Showing the link makes
 * that a shrug rather than a mystery, and means a mail outage never blocks
 * onboarding.
 * ========================================================================= */

const EMPTY: TeamActionResult = { ok: false };

export function InviteDialog({
  open,
  onClose,
  assignableRoles,
  actorRoleLabel,
  canSetPay,
}: {
  open: boolean;
  onClose: () => void;
  assignableRoles: readonly Role[];
  actorRoleLabel: string;
  /** Admin and above. See the note at the salary field. */
  canSetPay: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(invitePersonAction, EMPTY);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  /* ---- Invited: hand over the link ---- */
  if (state.ok && state.activationUrl) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Invitation created"
        description="The account exists but cannot be signed into until they set their own password."
        size="md"
        footer={
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
            }}
          >
            <Mail
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-secondary">{state.emailNote}</p>
          </div>

          <div>
            <p className="mb-1.5 text-caption font-semibold text-text-primary">
              Their activation link
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2.5 font-mono text-micro break-all text-text-secondary">
                {state.activationUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(state.activationUrl!);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2500);
                  } catch {
                    /* The link is on screen regardless. */
                  }
                }}
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1.5 text-micro text-text-tertiary">
              Works once, expires in {SYSTEM_DEFAULTS.activationTokenTtlHours} hours. Send it however
              you like — WhatsApp is fine. It is single-use, so it stops working the moment they use
              it.
            </p>
          </div>
        </div>
      </Dialog>
    );
  }

  /* ---- The form ---- */
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a member"
      description="They get a link and choose their own password. No password is generated, sent, or shown to you."
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" variant="primary" size="md" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            {pending ? 'Creating…' : 'Create and invite'}
          </Button>
        </>
      }
    >
      <form id="invite-form" action={formAction} className="space-y-4">
        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{state.error}</p>
          </div>
        )}

        <Field label="Their full name" htmlFor="fullName">
          <Input id="fullName" name="fullName" placeholder="Kashif Ahmed" required autoFocus />
        </Field>

        <Field
          label="Their email"
          htmlFor="email"
          hint="This becomes their sign-in address, and where the invitation goes."
        >
          <Input id="email" name="email" type="email" inputMode="email" required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Role"
            htmlFor="role"
            hint={`As ${actorRoleLabel} you can appoint these.`}
          >
            <Select size="md" id="role" name="role" defaultValue={assignableRoles.at(-1)} required>
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Job title" htmlFor="roleTitle" hint="What they actually do.">
            <Input id="roleTitle" name="roleTitle" placeholder="Graphic Designer" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ── ⚠️ THE OFFICE IS NOT COSMETIC ────────────────────────────────
              `office_team` decides which weekdays count as an absence — Blue
              Area rests on Sunday, Wah on Friday. Until this field existed the
              form could not set it, so everybody landed on the default and a
              Wah hire was marked absent every Friday. */}
          <Field
            label="Which office"
            htmlFor="officeTeam"
            hint="Decides their day off, and their attendance."
          >
            <Select size="md" id="officeTeam" name="officeTeam" defaultValue="blue_area" required>
              {OFFICE_TEAM_KEYS.map((key) => (
                <option key={key} value={key}>
                  {OFFICE_TEAMS[key].label} — {OFFICE_TEAMS[key].where} ({OFFICE_TEAMS[key].restDay})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Phone" htmlFor="phone" hint="Optional.">
            <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="+92 300 1234567" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Weekly capacity"
            htmlFor="weeklyCapacityPoints"
            hint={`${SYSTEM_DEFAULTS.defaultWeeklyCapacity} points is the default — 75% of a 48-hour week, because attendance hours are not productive hours.`}
          >
            <Input
              id="weeklyCapacityPoints"
              name="weeklyCapacityPoints"
              type="number"
              min="1"
              max="48"
              defaultValue={SYSTEM_DEFAULTS.defaultWeeklyCapacity}
            />
          </Field>

          <Field
            label="Concurrent tasks"
            htmlFor="maxConcurrentTasks"
            hint="The second guard: attention, not volume."
          >
            <Input
              id="maxConcurrentTasks"
              name="maxConcurrentTasks"
              type="number"
              min="1"
              max="20"
              defaultValue={SYSTEM_DEFAULTS.defaultMaxConcurrentTasks}
            />
          </Field>
        </div>

        {/* ── ⚠️ SHOWN ONLY TO AN ADMIN, AND THAT IS THE SECOND LOCK ────────
            `employee_compensation` is Admin+ by its own RLS policy, so a
            Coordinator who submitted this field would simply be refused by the
            database. Hiding it is therefore not the security boundary — it is
            an honesty measure, so nobody is offered a control that cannot work.
            The boundary is in migration 062. */}
        {canSetPay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Monthly salary"
              htmlFor="monthlySalary"
              hint="Optional — can be set later. Visible to Admins only."
            >
              <Input
                id="monthlySalary"
                name="monthlySalary"
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                placeholder="120000"
              />
            </Field>
          </div>
        )}

        <p className="text-micro text-text-tertiary">
          The account is created with no password at all. They set one through a single-use link
          that expires in {SYSTEM_DEFAULTS.activationTokenTtlHours} hours, so there is never a
          credential in an email or in anybody else&rsquo;s hands (doc 16 §3).
        </p>
      </form>
    </Dialog>
  );
}
