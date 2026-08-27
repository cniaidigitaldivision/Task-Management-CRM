import type { Metadata } from 'next';
import { KeyRound, ShieldAlert } from 'lucide-react';

import { VaultWorkspace } from '@/components/vault/vault-workspace';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listCredentials } from '@/lib/db/queries/credentials';
import { listAssignablepeople, listPeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Vault' };

/* ============================================================================
 * THE VAULT — owner request 2026-08-12
 * ----------------------------------------------------------------------------
 * *"Let the superadmin see all credentials for every member and project
 * credentials if held, client credentials and other credentials which can be
 * added here."*
 *
 * ── THE ONE PART OF THAT REQUEST THAT CANNOT BE BUILT ────────────────────────
 * Member CRM passwords. They are Argon2id digests — there is no key, no admin
 * view, and no way to reverse one. That is not a gap to be closed later: making
 * them viewable would mean storing them recoverably, so a single compromised
 * Super Admin account would expose every person's password, including ones they
 * have reused elsewhere.
 *
 * The page says so in as many words, because somebody who came here looking for a
 * member's password needs pointing at the thing that does work — forcing a reset
 * (CHANGE-PLAN 4.1) — rather than left to conclude the screen is broken.
 *
 * ── WHY `requireUser` AND NOT `requireRole` ──────────────────────────────────
 * Every role may open this, and row-level security decides what is in it
 * (migration 023). A Member sees only credentials issued to them, which is
 * usually none — the same shape as the calendar. Gating by role here would put a
 * second, weaker copy of the visibility rule in front of the real one.
 * ========================================================================= */

export default async function VaultPage() {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const [credentials, projects, people, everyone] = await Promise.all([
    listCredentials(user.id),
    listProjects(user.id, { includeArchived: true }),
    listAssignablepeople(user.id),
    /* ⚠️ TWO PEOPLE LISTS, AND THEY ARE NOT INTERCHANGEABLE ──────────────────
       `listAssignablepeople` answers "who may be given this" — it hides anybody
       ranked above the viewer, because work flows downward (see its header). That
       is right for custody: the Issued-to picker should not offer to hand an
       Admin's login to the Super Admin.

       It is WRONG for "who can see this credential". Read access is Coordinator
       and above, so the Super Admin can always open it — but is filtered out of
       the assignable list for an Admin viewer. Feeding that list to the access
       dialogue would print a list headed "who can open this" with a name missing
       from it, which is worse than no list. */
    listPeople(user.id),
  ]);

  const canManage = can(actor, 'credential.manage');
  const canDelete = can(actor, 'credential.delete');
  const expiring = credentials.filter(
    (c) => c.expiresAt !== null && c.expiresAt <= new Date().toISOString().slice(0, 10),
  ).length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Vault"
        description={
          <>
            The logins the division holds{' '}
            <span className="font-semibold text-text-primary">on behalf of clients and
            projects</span>{' '}
            {/* ⚠️ Was "reading one needs your password and authenticator again".
                Removed on the owner's instruction, 2026-08-25 — so the sentence
                went with it rather than being left to mislead. */}
            — portals, hosting, ad managers, API keys. Passwords are encrypted before they are
            stored, and every reveal is written to the security log against the person who did
            it.
            {expiring > 0 && (
              <>
                {' '}
                <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                  {expiring} need rotating.
                </span>
              </>
            )}
          </>
        }
      />

      {/* Stated once, prominently, rather than left for somebody to work out. */}
      <Card>
        <CardBody className="flex items-start gap-3 p-4">
          <IconTile icon={ShieldAlert} token="feedback-warning" size="lg" />
          <div className="min-w-0 space-y-1">
            <p className="text-body-sm font-semibold text-text-primary">
              This does not hold anybody&rsquo;s CNI sign-in password
            </p>
            <p className="text-caption text-text-secondary">
              Those are stored as one-way fingerprints, so nobody can read them — not an Admin, not
              the Super Admin, not the database. That is deliberate: it is what makes a stolen
              database useless. If you need to get somebody back into their account, use{' '}
              <span className="font-semibold text-text-primary">Force a password reset</span> on the
              Team screen, which emails them a single-use link and shows you how far it got.
            </p>
          </div>
        </CardBody>
      </Card>

      {credentials.length === 0 && !canManage ? (
        <Card>
          <CardBody className="px-6 py-14 text-center">
            <IconTile icon={KeyRound} token="accent-primary" size="xl" className="mx-auto" />
            <p className="mt-3 text-body-sm font-semibold text-text-primary">
              Nothing has been shared with you
            </p>
            {/* ⚠️ NOT "when one is issued to you". That was true before migration
                047 and is the exact bug 047 removed: being ISSUED a credential used
                to let you read it, so a custody field granted a permission as a side
                effect. Owning a project stopped being a route in 058. Telling
                somebody to wait for the wrong thing leaves them waiting. */}
            <p className="mx-auto mt-1 max-w-[38rem] text-caption text-text-secondary">
              You will see a credential here when an Admin names you on one. Being the person who
              holds an account is recorded separately and does not open it.
            </p>
          </CardBody>
        </Card>
      ) : (
        <VaultWorkspace
          credentials={credentials}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          people={people.map((p) => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl }))}
          readers={everyone.map((p) => ({
            id: p.id,
            name: p.fullName,
            role: p.role,
            avatarUrl: p.avatarUrl,
          }))}
          canManage={canManage}
          canDelete={canDelete}
          canGrant={can(actor, 'credential.grant')}
          canOversee={can(actor, 'credential.view')}
          nowMs={nowMs()}
        />
      )}
    </div>
  );
}
