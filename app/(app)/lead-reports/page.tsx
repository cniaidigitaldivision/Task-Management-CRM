import type { Metadata } from 'next';

import { LeadReports } from '@/components/crm/lead-reports';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmProjectRoster, listCrmProjects } from '@/lib/db/queries/crm-leads';
import { getStoredReport, listStoredReports } from '@/lib/db/queries/crm-reports';
import { nowMs } from '@/lib/now';

/**
 * ⚠️ THE DEFAULT PERIOD IS THE LAST 90 DAYS, NOT THIS MONTH — and it is computed
 * HERE rather than in the component, because a render may not read the clock
 * (see the note on the component's props).
 *
 * Ninety days because the oldest lead is 90 days old and Meta deletes at 90: a
 * report defaulting to "this month" would silently exclude the leads closest to
 * being gone, which are the ones somebody opening this page most needs.
 */
function defaultPeriod(now: number): { from: string; to: string } {
  return {
    from: new Date(now - 90 * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

export const metadata: Metadata = { title: 'Lead reports' };

/* ============================================================================
 * LEAD REPORTS — Step 10
 * ----------------------------------------------------------------------------
 * ⚠️ THE PAGE READS STORAGE, NOT THE LEADS. Nothing here recomputes anything:
 * the list and the open report both come from `crm_reports`, which is the whole
 * point of the owner's rule — *"first save in a database and always fetch from
 * the database."* The only live query is the project dropdown.
 * ========================================================================= */

export default async function LeadReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* ⚠️ ONE WAVE — Rule Zero, law 4 (docs/20-UI-RESPONSIVENESS.md). */
  const [{ user }, params] = await Promise.all([requireCrmAccess(), searchParams]);
  const now = nowMs();
  const period = defaultPeriod(now);

  /* ⚠️ THE OPEN REPORT LEAVES WITH THE PROJECT LIST. Its id comes from the URL,
     so it never needed the list first. Read only from storage, and an id that is
     not theirs comes back null through RLS — the page then shows the list rather
     than an error, the same reasoning as the lead record's 404. */
  const [projects, open] = await Promise.all([
    listCrmProjects(user.id),
    params.report ? getStoredReport(user.id, params.report) : Promise.resolve(null),
  ]);
  const selected =
    projects.find((p) => p.id === params.project) ??
    projects.find((p) => p.connection === 'live') ??
    projects[0] ??
    null;

  if (!selected) {
    return (
      <LeadReports
        projects={projects}
        selected={null}
        reports={[]}
        open={null}
        canGenerate={false}
        defaultFrom={period.from}
        defaultTo={period.to}
        nowMs={now}
      />
    );
  }

  const [reports, roster] = await Promise.all([
    listStoredReports(user.id, selected.id),
    /* ⚠️ EMPTY FOR SOMEBODY WHO DOES NOT MANAGE THIS PROJECT — migration 124's
       guard. The same signal the desk uses to decide whether to offer sharing
       out, reused here to decide whether to offer generating. The insert policy
       refuses them regardless. */
    crmProjectRoster(user.id, selected.id),
  ]);

  return (
    <LeadReports
      projects={projects}
      selected={selected}
      reports={reports}
      open={open}
      canGenerate={roster.length > 0}
      defaultFrom={period.from}
      defaultTo={period.to}
      nowMs={now}
    />
  );
}
