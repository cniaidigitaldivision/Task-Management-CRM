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

  /* ── ⚠️ `today`, CHANGED FROM `this_month` ON 2026-09-03 ──────────────────
     Owner: *"report page should display Today record by default."*

     ── WHY IT USED TO BE A MONTH, AND WHY THAT ARGUMENT NO LONGER HOLDS ─────
     The note replaced here reasoned that a short period against the real
     database is "a table of ones and zeroes", and that a reporting page opening
     empty reads as broken. That was written when the shortest option in the
     dropdown was "This week" — `today` and `yesterday` did not exist as presets
     until earlier today. The argument was really about the DEFAULT being a
     period nobody had asked for; it is not a reason to override a period the
     owner has now asked for by name.

     It also matches how the rest of the system now opens. Tasks default to
     today, attendance defaults to today (`lib/view/task-window.ts`, same
     instruction), and a reports page that alone opened on a month made the
     division's own screens disagree about what "now" means.

     ⚠️ THE HONEST COST: a quiet morning shows a short table, and the month is
     two clicks away rather than zero. That trade is the owner's to make and they
     have made it — and unlike the old default, a reader who sees three rows today
     is seeing the truth about today rather than a month's worth of rows that
     answer a question they did not ask. */
  const initialRequest: ReportRequest = {
    work: true,
    type: 'completion',
    preset: 'today',
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
