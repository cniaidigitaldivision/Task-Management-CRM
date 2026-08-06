import type { Metadata } from 'next';
import { Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { TeamWorkspace } from '@/components/team/team-workspace';
import { Card, CardBody } from '@/components/ui/card';
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
import { teamWorkload } from '@/lib/db/queries/workload';
import { ROLE_LABEL } from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Team' };

/* ============================================================================
 * TEAM — doc 10 §6, FR-010 to FR-017
 * ----------------------------------------------------------------------------
 * Who is here, what they are good at, how much they can carry, and whether they
 * are actually available this week. Those four facts are what every assignment
 * decision in the system reads.
 *
 * ── PROVISIONING IS NOT HERE, AND THE PAGE SAYS SO ───────────────────────────
 * ADR-009: the system ships with no roster and the Admin creates each member
 * in-app. That chain needs an invitation token, a 48-hour single-use expiry, an
 * activation ceremony and an email that arrives (FR-141 to FR-144, doc 16 §3) —
 * Step 5.2, and blocked on the Resend account.
 *
 * Shipping half of it would create rows that look like colleagues and cannot be
 * signed into. The page states the position rather than offering a button that
 * produces a broken account.
 * ========================================================================= */

export default async function TeamPage() {
  // doc 03 §3.1: the roster is Admin+. Hiding the nav item is convenience, not security (NFR-006).
  const user = await requireRole('admin');
  const now = nowMs();

  const [people, { window, people: workload }, skills, userSkills] = await Promise.all([
    listPeople(user.id, { includeInactive: true }),
    teamWorkload(user.id, now),
    listSkills(user.id),
    listUserSkills(user.id),
  ]);

  const availability = await listAvailability(user.id, window);

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

      {/* ---- What this screen cannot do yet, stated plainly ---- */}
      {canManage && (
        <Card>
          <CardBody className="flex flex-wrap items-start gap-3 p-4">
            <IconTile icon={UserPlus} token="accent-gold" size="lg" />
            <div className="min-w-[16rem] flex-1">
              <p className="text-body-sm font-semibold text-text-primary">
                Adding a person needs the invitation chain, which is the next step
              </p>
              <p className="mt-1 text-caption text-text-secondary">
                Passwords are never emailed (doc 16 §3). Provisioning issues a hashed, single-use
                token that expires in 48 hours, and the person sets their own password on
                activation. Creating a row here without that would produce an account nobody can
                sign in to — so it waits for Step 5.2 and the Resend account.
              </p>
              <p className="mt-1.5 text-micro text-text-tertiary">
                Everything else about a person is editable now: capacity, concurrency, job title,
                skills and time away.
              </p>
            </div>
          </CardBody>
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
        />
      </PageSection>
    </div>
  );
}
