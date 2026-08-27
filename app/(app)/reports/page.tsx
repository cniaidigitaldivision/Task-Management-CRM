import type { Metadata } from 'next';

import { ReportWorkspace } from '@/components/report/report-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { buildReportAction, type ReportRequest } from '@/app/actions/reports';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Reports' };

/* ============================================================================
 * REPORTS
 * ----------------------------------------------------------------------------
 * The owner's mockup: a heading, one line under it, a card of filters, the work
 * table, posting performance by member, and a record count.
 *
 * The Report-type control carries five things — "Work reports", which is the
 * mockup and the default, and the four analytical types (Completion, Workload,
 * Project status, Time) which bring their own charts. See the workspace.
 *
 * ── THE PAGE COMPUTES THE FIRST REPORT, THE CLIENT ASKS FOR THE REST ─────────
 * Rendering it on the server means the screen arrives with an answer on it.
 * Fetching on mount would put a spinner on a page whose entire job is to already
 * know, and would need an effect that sets state — which
 * `react-hooks/set-state-in-effect` refuses, correctly.
 *
 * ── SCOPE IS ROW-LEVEL SECURITY, NOT THIS FILE ───────────────────────────────
 * `requireRole('team_coordinator')` is the floor for having a reporting screen at
 * all. What a reader then sees inside it is decided by RLS on every query, so a
 * Coordinator's report covers their people and nobody has to remember to filter
 * (ADR-003). Hiding the nav item is convenience, not security (NFR-006).
 * ========================================================================= */

export default async function ReportsPage() {
  const user = await requireRole('team_coordinator');

  /* ── ⚠️ `this_month`, THOUGH THE MOCKUP'S PERIOD READS "THIS WEEK" ────────
     The one place this deliberately departs from the drawing, and the reason is
     the drawing's own data: it shows a rich week — 18 tasks, 22 posts a person —
     because its numbers were invented. Against the real database a Tuesday-morning
     "this week" is Monday and today, which is a table of ones and zeroes.

     A reporting page that opens looking empty reads as broken, and the owner's
     actual instruction was that the numbers be real: *"make sure that the data is
     according to my database."* A month is also what this page is for — *"At the
     end of the month… every meeting is held in which we put a report on the front
     of the table."*

     "This week" is the next option in the same dropdown and one click away. */
  const initialRequest: ReportRequest = {
    work: true,
    type: 'completion',
    preset: 'this_month',
    subjectId: null,
    workSort: 'posts',
    workDirection: 'desc',
  };

  const built = await buildReportAction(initialRequest);

  /* The action refuses only an invalid request, and this one is a literal — so a
     failure here is a fault, not a user error, and saying so beats rendering an
     empty screen that looks like a quiet week. */
  if (!built.ok) {
    return (
      <div className="mx-auto max-w-[var(--content-max)] space-y-8">
        <PageHeader eyebrow="AI & Digital Division" title="Reports" description={built.error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      {/* ⚠️ ONE line, as asked: *"The report and the one line are enough."* The
          eyebrow and the longer explanation that used to sit here are gone. */}
      <PageHeader
        title="Reports"
        description={
          <>
            Filter and explore work reports across projects, people, platforms and content types
            {user.role === 'team_coordinator' ? ' — yours covers your people.' : '.'}
          </>
        }
      />

      <ReportWorkspace
        initialReport={built.report}
        initialRequest={initialRequest}
        initialCharts={built.charts}
        initialWork={built.work}
        options={built.options}
        people={built.people}
        /* The server's clock, so every "1h ago" on the page is measured from one
           instant and nothing re-reads a clock during render. See lib/now.ts. */
        nowMs={nowMs()}
      />
    </div>
  );
}
