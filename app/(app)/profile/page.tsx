import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, Shield, ShieldCheck, Smartphone } from 'lucide-react';

import { ThemeSetting } from '@/components/brand/theme-toggle';
import { EmailForm } from '@/components/team/email-form';
import { ProfileForm } from '@/components/team/profile-form';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { getMyPrefsAction } from '@/app/actions/notification-prefs';
import { NotificationPrefsPanel } from '@/components/settings/notification-prefs';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress';
import { requireUser } from '@/lib/auth/current-user';
import { listUserSkills } from '@/lib/db/queries/people';
import { teamWorkload } from '@/lib/db/queries/workload';
import { MFA_REQUIRED_ROLES, ROLE_LABEL, WORKLOAD_BAND_META } from '@/lib/domain/constants';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Your profile' };

/* ============================================================================
 * PROFILE — FR-202, doc 10 §9
 * ----------------------------------------------------------------------------
 * Your details, your appearance, your skills, your load, and the state of your
 * own security. Everything on this page is about the person reading it, which is
 * why it needs no permission checks: RLS on `users` already restricts a member to
 * their own row, and this only ever edits `app.current_user_id()`.
 *
 * ── WHY THE THEME IS SAVED TWICE ─────────────────────────────────────────────
 * localStorage AND the database, deliberately. The pre-paint script has to know
 * the theme before the first paint or the page flashes the wrong colour, and it
 * cannot query Postgres to find out. So localStorage drives the paint and the
 * database makes the choice follow the person to a new device (FR-202).
 * ========================================================================= */

export default async function ProfilePage() {
  const prefs = await getMyPrefsAction();
  const user = await requireUser();
  const now = nowMs();

  const [{ people }, skills] = await Promise.all([
    teamWorkload(user.id, now),
    listUserSkills(user.id),
  ]);

  const mine = people.find((p) => p.userId === user.id);
  const band = mine ? WORKLOAD_BAND_META[mine.workload.band] : null;
  const mySkills = skills.filter((s) => s.userId === user.id);
  const mfaRequired = MFA_REQUIRED_ROLES.includes(user.role);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow={ROLE_LABEL[user.role]}
        title="Your profile"
        description="Your details, how the interface looks, and the state of your account security."
      />

      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
          <Avatar name={user.fullName} size="xl" />
          <div className="min-w-[12rem] flex-1">
            <p className="text-h3 text-text-primary">{user.fullName}</p>
            <p className="text-caption text-text-secondary">{user.roleTitle ?? '—'}</p>
            <p className="text-micro text-text-tertiary">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge
                token={
                  user.role === 'super_admin'
                    ? 'accent-gold'
                    : user.role === 'admin'
                      ? 'accent-primary'
                      : user.role === 'team_coordinator'
                        ? 'accent-secondary'
                        : 'neutral-500'
                }
                size="sm"
              >
                {ROLE_LABEL[user.role]}
              </Badge>
              <Badge token="neutral-500" size="sm" variant="outline">
                {user.timezone}
              </Badge>
            </div>
          </div>

          {mine && band && (
            <div className="min-w-[14rem] flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-micro text-text-tertiary">Your load this week</span>
                <span
                  className="tabular text-h3 font-semibold"
                  style={{ color: `var(--${band.token})` }}
                >
                  {mine.workload.isFullyUnavailable ? 'On leave' : `${mine.workload.utilisationPct}%`}
                </span>
              </div>
              <ProgressBar
                value={Math.min(mine.workload.utilisationPct, 100)}
                token={band.token}
                size="lg"
                label={`Your load: ${mine.workload.utilisationPct}% of capacity`}
              />
              <p className="tabular mt-1.5 text-micro text-text-tertiary">
                {mine.workload.loadPoints} of {mine.workload.effectiveCapacityPoints} points ·{' '}
                {mine.workload.openTaskCount} open
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <PageSection step={1} title="Your details">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardToolbar title="Name, phone and timezone" />
            <CardBody className="p-5">
              <ProfileForm
                defaults={{
                  fullName: user.fullName,
                  phone: '',
                  timezone: user.timezone,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardToolbar title="Appearance" />
            <CardBody className="space-y-3 p-5">
              <ThemeSetting />
              <p className="text-micro text-text-tertiary">
                The navigation rail stays dark in both themes, by design — a white rail beside a
                near-white page has no edge, so the whole interface reads as one flat sheet. That is
                also what ClickUp, Linear, Asana and Notion all do (doc 18 §6a).
              </p>
            </CardBody>
          </Card>
        </div>
      </PageSection>

      <PageSection
        step={2}
        title="Your skills"
        description="What the assignment engine matches a task against. Only an Admin can change these — a self-declared expertise level is not one the engine can trust (doc 03 §3.1)."
      >
        <Card>
          <CardBody className="p-5">
            {mySkills.length === 0 ? (
              <p className="text-caption text-text-secondary">
                None recorded yet. Ask an Admin to add them, or the engine can only match your work
                by keyword (FR-055).
              </p>
            ) : (
              <ul className="space-y-2.5">
                {mySkills.map((skill) => (
                  <li key={skill.skillId} className="flex items-center gap-3">
                    <span className="min-w-[10rem] flex-1 text-caption font-medium text-text-primary">
                      {skill.skillLabel}
                      {skill.isPrimary && (
                        <span className="ml-1.5 text-micro font-semibold text-text-brand">
                          headline
                        </span>
                      )}
                    </span>
                    <div className="w-32">
                      <ProgressBar
                        value={skill.proficiency * 20}
                        token="accent-primary"
                        size="md"
                        label={`${skill.skillLabel}: level ${skill.proficiency} of 5`}
                      />
                    </div>
                    <span className="tabular w-8 text-right text-caption font-semibold text-text-primary">
                      {skill.proficiency}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </PageSection>

      <PageSection step={3} title="Security">
        {/* The email card sits full width above the other three because it is the
            only one here you can act on — the rest report a state. */}
        <div className="space-y-4">
          <Card>
            <CardToolbar title="Your sign-in email address" />
            <CardBody className="p-5">
              <EmailForm currentEmail={user.email} isSuperAdmin={user.role === 'super_admin'} />
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardBody className="space-y-2 p-5">
              <IconTile icon={KeyRound} token="accent-primary" size="lg" />
              <h3 className="text-body-sm font-semibold text-text-primary">Password</h3>
              <p className="text-caption text-text-secondary">
                Argon2id, and the last five hashes are kept so an old one cannot be reused. Changing
                it signs out every other session (FR-155c).
              </p>
              <Link
                href="/forgot-password"
                className="inline-block text-caption font-semibold text-text-brand hover:underline"
              >
                Change your password
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2 p-5">
              <IconTile
                icon={mfaRequired ? ShieldCheck : Smartphone}
                token={mfaRequired ? 'accent-gold' : 'accent-secondary'}
                size="lg"
              />
              <h3 className="text-body-sm font-semibold text-text-primary">
                Two-factor authentication
              </h3>
              <p className="text-caption text-text-secondary">
                {mfaRequired ? (
                  <>
                    Mandatory for {ROLE_LABEL[user.role]} and it cannot be turned off (FR-145). The
                    Super Admin&rsquo;s factor cannot be removed by anybody, enforced by a database
                    trigger.
                  </>
                ) : (
                  <>
                    Optional for your role, and worth having. A stolen password alone then gets
                    nobody in.
                  </>
                )}
              </p>
              <Link
                href="/mfa-setup"
                className="inline-block text-caption font-semibold text-text-brand hover:underline"
              >
                Manage your authenticator
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2 p-5">
              <IconTile icon={Shield} token="feedback-info" size="lg" />
              <h3 className="text-body-sm font-semibold text-text-primary">Sessions</h3>
              <p className="text-caption text-text-secondary">
                Your session is bound to this device and expires on a schedule set by your role —{' '}
                {user.role === 'super_admin'
                  ? '8 hours, inside a 12-hour cap, with a 30-minute idle timeout'
                  : user.role === 'admin'
                    ? '24 hours with a 2-hour idle timeout'
                    : '7 days, inside a 30-day cap'}{' '}
                (doc 16 §4).
              </p>
              <p className="text-micro text-text-tertiary">
                The session list with instant revoke arrives with Step 5.6 (FR-154).
              </p>
            </CardBody>
          </Card>
          </div>
        </div>
      </PageSection>

      <PageSection
        step={4}
        title="What reaches you"
        description="A feed nobody can quieten becomes wallpaper, and wallpaper is how the important one gets missed. A few cannot be turned off — each says why."
      >
        <NotificationPrefsPanel initial={prefs} />
      </PageSection>
    </div>
  );
}
