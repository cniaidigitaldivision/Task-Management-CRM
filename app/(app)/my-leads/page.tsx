import type { Metadata } from 'next';

import { MyLeads } from '@/components/crm/my-leads';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmMyDay, listCrmProjects } from '@/lib/db/queries/crm-leads';

export const metadata: Metadata = { title: 'My leads' };

/* ============================================================================
 * WHAT IS MINE TODAY — step 5 of the nine
 * ----------------------------------------------------------------------------
 * ⚠️ THE COUNTERPART TO `/lead-overview`, NOT A SMALLER COPY OF IT. That one
 * asks "what is wrong across the team" and belongs to the manager. This asks
 * "what is mine, and how am I doing", and every definition on it — overdue,
 * gone quiet, response time — is the SAME one the manager's screen uses.
 *
 * Two screens counting "overdue" slightly differently is how somebody comes to
 * distrust both, and the person most likely to spot the discrepancy is the one
 * being measured by it.
 * ========================================================================= */

export default async function MyLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmAccess();
  const params = await searchParams;

  const projects = await listCrmProjects(user.id);

  /* ⚠️ Defaults to a project that HAS leads rather than the first alphabetically
     — opening on "AGC Construction — 0" reads as a broken page rather than as
     the wrong project. */
  const selected =
    projects.find((p) => p.id === params.project) ??
    projects.find((p) => p.leads > 0) ??
    projects[0] ??
    null;

  const day = selected ? await crmMyDay(user.id, selected.id) : null;

  return (
    <MyLeads
      projects={projects}
      selected={selected}
      day={day}
      firstName={user.fullName.split(' ')[0] ?? user.fullName}
    />
  );
}
