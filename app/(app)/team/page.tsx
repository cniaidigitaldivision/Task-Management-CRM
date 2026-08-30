import type { Metadata } from 'next';
import { Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { TerminalMapping } from '@/components/attendance/terminal-panel';
import { TeamWorkspace } from '@/components/team/team-workspace';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import {
  listAvailability,
  listPeople,
  listSkills,
  listUserSkills,
} from '@/lib/db/queries/people';
import { getForcedResetTrails, type ResetTrail } from '@/lib/db/queries/auth';
import { toResetTrailView } from '@/lib/view/reset-trail';
import { teamWorkload } from '@/lib/db/queries/workload';
import { ROLE_LABEL } from '@/lib/domain/constants';
import { listPendingInvitations } from '@/lib/db/queries/provisioning';
import { assignableRolesFor } from '@/app/actions/team';
import { describeSender } from '@/lib/email/send';
import {
  listEnrolments,
  listUnmatched,
} from '@/lib/db/queries/attendance-devices';
import { can } from '@/lib/domain/permissions';
import { weekWindow } from '@/lib/domain/workload';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Team' };

/* ============================================================================
 * TEAM — doc 10 §6, FR-010 to FR-017
 * ----------------------------------------------------------------------------
 * Who is here, what they are good at, how much they can carry, and whether they
 * are actually available this week. Those four facts are what every assignment
 * decision in the system reads.
 *
 * ── PROVISIONING (FR-141 to FR-144, doc 16 §3) ───────────────────────────────
 * ADR-009: the system ships with no roster, and the Admin builds the team here.
 * Adding somebody creates an account with no credential at all and issues a
 * hashed, single-use token valid 48 hours; they choose their own password on
 * activation. No password is ever generated, emailed, or shown to the person
 * doing the inviting.
 *
 * The page states plainly how mail is configured, because Resend's shared sender
 * accepts an invitation for anybody and delivers it only to the account owner —
 * which otherwise looks exactly like success.
 * ========================================================================= */

export default async function TeamPage() {
  // doc 03 §3.1: the roster is Admin+. Hiding the nav item is convenience, not security (NFR-006).
  const user = await requireRole('admin');
  const now = nowMs();

  /* ── ONE WAVE ──────────────────────────────────────────────────────────────
     This was three: the list, then availability, then invitations. Only
     availability genuinely depended on anything — it needed the week window
     from teamWorkload — and that window is `weekWindow(now)`, a pure function
     of the clock, so it can be computed here without waiting for a query. */
  const canProvision = can({ role: user.role, id: user.id }, 'user.create');
  /* Owner, 2026-08-30: *"the mapping should be on the team page"* — and *"only in
     admin and superadmin"*. One rung narrower than `attendance.view_all`;
     migration 079 narrows the tables to match, so this only decides whether the
     section is drawn. */
  const canManageTerminals = can({ role: user.role, id: user.id }, 'attendance.manage_devices');
  const window = weekWindow(now);

  const [
    people,
    { people: workload },
    skills,
    userSkills,
    availability,
    pending,
    assignableRoles,
    trails,
    unmatchedScans,
    enrolments,
  ] = await Promise.all([
    listPeople(user.id, { includeInactive: true }),
    teamWorkload(user.id, now),
    listSkills(user.id),
    listUserSkills(user.id),
    listAvailability(user.id, window),
    canProvision ? listPendingInvitations(user.id) : Promise.resolve([]),
    assignableRolesFor(user.role),
    /* Admin and above only. A reset trail records when an account was locked out
       of itself and which address the link went to — that is not general team
       information, so a Coordinator or Member gets nothing and the panel simply
       reports that no reset has been forced. In the same `Promise.all` as
       everything else so it costs no extra wait. */
    canProvision
      ? getForcedResetTrails(user.id)
      : Promise.resolve(new Map<string, ResetTrail>()),
    /* The terminal mapping. Admin+ only, and not even queried otherwise — RLS
       would return empty (079), but a round trip for data the page will not draw
       is a round trip for nothing. */
    canManageTerminals ? listUnmatched(user.id) : Promise.resolve([]),
    canManageTerminals ? listEnrolments(user.id) : Promise.resolve([]),
  ]);
  const pendingUserIds = pending.map((p) => p.userId);

  /* Mapped once, here, rather than per person in the client: `expired` has to be
     decided against the server's clock (see lib/view/reset-trail.ts). */
  const resetTrails = Object.fromEntries(
    [...trails].map(([id, trail]) => [id, toResetTrailView(trail, now)]),
  );
  const mail = describeSender();

  const canManage = can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills');
  const active = people.filter((p) => p.isActive);
  const withoutSkills = active.filter((p) => !userSkills.some((s) => s.userId === p.id)).length;
  const awayThisWeek = new Set(availability.map((a) => a.userId)).size;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Team"
        description={
          <>
            <span className="tabular font-semibold text-text-primary">{active.length}</span> active
            people. Capacity, concurrency limit and skills are the inputs every assignment decision
            reads — a person with no skills recorded can only be matched by keyword guessing
            (FR-055).
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} token="accent-primary" label="Active people" value={active.length} />
        <StatCard
          icon={ShieldCheck}
          token="accent-gold"
          label="Privileged accounts"
          value={active.filter((p) => p.role === 'super_admin' || p.role === 'admin').length}
          hint="MFA is mandatory for these (FR-145)"
        />
        <StatCard
          icon={UserPlus}
          token={withoutSkills > 0 ? 'load-warning' : 'load-healthy'}
          label="Without skills"
          value={withoutSkills}
          hint={withoutSkills > 0 ? 'The engine cannot match them properly' : 'Everybody is mapped'}
        />
        <StatCard
          icon={Mail}
          token="feedback-info"
          label="Away this week"
          value={awayThisWeek}
          hint="Capacity reduced accordingly"
        />
      </div>

      {/* ── How email is actually configured, said before it bites ────────────
          The sandbox sender accepts mail for anybody and delivers it only to the
          Resend account's own address. Without this notice, inviting a colleague
          looks like it worked and quietly did not — the worst failure mode for
          onboarding, because nobody finds out until they wonder why there was no
          reply. */}
      {canProvision && (mail.sandbox || !mail.configured) && (
        <Card>
          <CardBody className="flex flex-wrap items-start gap-3 p-4">
            <IconTile icon={Mail} token="accent-gold" size="lg" />
            <div className="min-w-[16rem] flex-1">
              {!mail.configured ? (
                <>
                  <p className="text-body-sm font-semibold text-text-primary">
                    Email is not configured, so invitations are not sent
                  </p>
                  <p className="mt-1 text-caption text-text-secondary">
                    Everything else works — creating somebody gives you an activation link on
                    screen to pass on however you like. Set{' '}
                    <span className="font-mono text-micro">RESEND_API_KEY</span> to have it emailed
                    instead.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-body-sm font-semibold text-text-primary">
                    Using Resend&rsquo;s shared sender — it only reaches your own inbox
                  </p>
                  <p className="mt-1 text-caption text-text-secondary">
                    <span className="font-mono text-micro">{mail.from}</span> delivers only to the
                    address that owns your Resend account. Invitations to anybody else are accepted
                    and silently dropped, so{' '}
                    <span className="font-semibold text-text-primary">
                      copy the link on screen and send it to them yourself
                    </span>{' '}
                    until a domain of yours is verified in Resend.
                  </p>
                </>
              )}
              <p className="mt-1.5 text-micro text-text-tertiary">
                The invitation is real either way: hashed, single-use, and it expires in 48 hours.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ---- Waiting to accept ---- */}
      {canProvision && pending.length > 0 && (
        <Card>
          <CardToolbar title={`${pending.length} waiting to accept`} />
          <ul className="divide-y divide-border-subtle">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="text-caption font-semibold text-text-primary">{invite.fullName}</p>
                  <p className="text-micro text-text-tertiary">
                    {invite.email} · invited by {invite.invitedByName ?? 'somebody'}
                  </p>
                </div>
                <Badge token={invite.isExpired ? 'feedback-error' : 'feedback-warning'} size="sm">
                  {invite.isExpired ? 'Link expired' : 'Not accepted yet'}
                </Badge>
                <span className="text-micro text-text-tertiary">
                  {invite.isExpired
                    ? 'Re-send from their row for a fresh one'
                    : `Expires ${new Date(invite.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PageSection
        step={1}
        title="Everybody"
        description={`Ordered by rank. You are signed in as ${ROLE_LABEL[user.role]}${canManage ? ' and can edit capacity, skills and leave.' : ' — capacity and skills are Admin-only.'}`}
      >
        <TeamWorkspace
          people={people}
          workload={workload}
          skills={skills}
          userSkills={userSkills}
          availability={availability}
          currentUser={{ id: user.id, role: user.role }}
          canManage={canManage}
          canProvision={canProvision}
          assignableRoles={assignableRoles}
          pendingUserIds={pendingUserIds}
          resetTrails={resetTrails}
        />
      </PageSection>

      {/* ── THE ATTENDANCE TERMINAL ──────────────────────────────────────────
          Owner, 2026-08-30: *"the mapping should be on the team page."* Right —
          linking somebody to a terminal is done once when they join, in the same
          sitting as creating their account and setting their role. The wall's own
          health stays on Attendance, where it explains the record.

          ⚠️ A SECTION OF ITS OWN, AFTER the team list rather than inside it. The
          first attempt nested it in "Everybody", which put two panels between that
          heading and the people it names — the page announced the team and then
          showed something else. It is also the right order by frequency: the
          roster is read constantly, this is touched when somebody joins. */}
      {canManageTerminals && (
        <PageSection
          step={2}
          title="Attendance terminal"
          description="Who the terminal knows, and who it does not. Anybody working remotely does not need to be on it."
        >
          <TerminalMapping unmatched={unmatchedScans} enrolments={enrolments} nowMs={now} />
        </PageSection>
      )}
    </div>
  );
}
