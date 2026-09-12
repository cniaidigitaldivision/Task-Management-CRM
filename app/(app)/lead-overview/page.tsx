import type { Metadata } from 'next';

import { LeadOverview } from '@/components/crm/lead-overview';
import { requireCrmReports } from '@/lib/auth/current-user';
import {
  crmLeadArrivals,
  crmLeadAttention,
  crmProjectRoster,
  listCrmProjects,
} from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Live overview' };

/* ============================================================================
 * THE MANAGER'S LIVE OVERVIEW — step 4 of the nine
 * ----------------------------------------------------------------------------
 * ⚠️ THE COMPANION TO `/lead-reports`, AND DELIBERATELY ITS OPPOSITE. Those
 * reports are FROZEN — computed once, stored whole, never refreshed, because a
 * report is a statement made on a date. This page stores nothing: every figure
 * is computed on read and is true at the moment it is drawn.
 *
 * Both are correct answers to different questions. *"What did we report in
 * September"* needs the snapshot. *"What is wrong this morning"* needs this,
 * and a stored snapshot answering it would be correct and out of date — which
 * is worse than either.
 *
 * ⚠️ AND IT KEEPS UP BY ITSELF. `LiveRefresh` polls the pulse every 25 seconds
 * and the pulse now carries a lead count (migration-free, 2026-09-13), so a
 * lead arriving moves these numbers without anybody pressing anything.
 * ========================================================================= */

export default async function LeadOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmReports();
  const params = await searchParams;

  const projects = await listCrmProjects(user.id);

  /* ⚠️ DEFAULTS TO THE PROJECT WITH LEADS, not to the first alphabetically. A
     manager opening this on "AGC Construction — 0 leads" would conclude the
     page was broken rather than that they were looking at the wrong project. */
  const selected =
    projects.find((p) => p.id === params.project) ??
    projects.find((p) => p.leads > 0) ??
    projects[0] ??
    null;

  if (!selected) {
    return <LeadOverview projects={[]} selected={null} attention={null} arrivals={[]} team={[]} nowMs={nowMs()} />;
  }

  /* ⚠️ One wave, not three sequential awaits. Three round trips to Singapore is
     most of this page's time budget, and none of them depends on another. */
  const [attention, arrivals, team] = await Promise.all([
    crmLeadAttention(user.id, selected.id),
    crmLeadArrivals(user.id, selected.id, 14),
    crmProjectRoster(user.id, selected.id),
  ]);

  return (
    <LeadOverview
      projects={projects}
      selected={selected}
      attention={attention}
      arrivals={arrivals}
      team={team}
      /* ⚠️ The clock is read HERE and passed down. A render that reads it is not
         a pure function of its props, so the server and the browser disagree and
         React reports a hydration mismatch rather than the clock problem. The
         same lesson `lib/view/relative-age.ts` already documents. */
      nowMs={nowMs()}
    />
  );
}
