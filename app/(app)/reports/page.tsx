import type { Metadata } from 'next';

import { ReportWorkspace } from '@/components/report/report-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { buildReportAction, type ReportRequest } from '@/app/actions/reports';
import { REPORT_META } from '@/lib/domain/reports';

export const metadata: Metadata = { title: 'Reports' };

/* ============================================================================
 * REPORTS — doc 10 §8, CHANGE-PLAN 5.1
 * ----------------------------------------------------------------------------
 * Four report types, each for one person or everybody, over a chosen period.
 * Owner decision 5: all four, because each answers a different question and
 * three of them were previously only inferable by reading the task list.
 *
 * ── THE PAGE COMPUTES THE FIRST REPORT, THE CLIENT ASKS FOR THE REST ─────────
 * Rendering "this month, completion, everybody" on the server means the screen
 * arrives with an answer on it. Fetching on mount would put a spinner on a page
 * whose entire job is to already know, and would need an effect that sets state
 * — which `react-hooks/set-state-in-effect` refuses, correctly.
 *
 * ── SCOPE IS ROW-LEVEL SECURITY, NOT THIS FILE ───────────────────────────────
 * `requireRole('team_coordinator')` is the floor for having a reporting screen at
 * all. What a reader then sees inside it is decided by RLS on every query, so a
 * Coordinator's report covers their people and nobody has to remember to filter
 * (ADR-003). Hiding the nav item is convenience, not security (NFR-006).
 * ========================================================================= */

export default async function ReportsPage() {
  const user = await requireRole('team_coordinator');

  /* This month rather than this week: a week is a workload question, and the
     Workload screen already answers it. A report is asked for at month end. */
  const initialRequest: ReportRequest = {
    type: 'completion',
    preset: 'this_month',
    subjectId: null,
  };

  const built = await buildReportAction(initialRequest);

  /* The action refuses only an invalid request, and this one is a literal — so a
     failure here is a fault, not a user error, and saying so beats rendering an
     empty screen that looks like a quiet month. */
  if (!built.ok) {
    return (
      <div className="mx-auto max-w-[var(--content-max)] space-y-8">
        <PageHeader eyebrow="AI & Digital Division" title="Reports" description={built.error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Reports"
        description={
          <>
            {REPORT_META.completion.question} Pick a type, a period and whether it covers one
            person or everybody. Every figure is computed from the rows you are allowed to see, so
            a report never shows more than the screens it came from
            {user.role === 'team_coordinator' ? ' — yours covers your people.' : '.'}
          </>
        }
      />

      <ReportWorkspace
        initialReport={built.report}
        initialRequest={initialRequest}
        people={built.people}
      />
    </div>
  );
}
