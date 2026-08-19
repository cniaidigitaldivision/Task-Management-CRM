import type { Metadata } from 'next';

import { ceoReportAction } from '@/app/actions/ceo-report';
import { CeoReportWorkspace } from '@/components/report/ceo-report-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { chatgptKey } from '@/lib/ai/narrative';
import { requireRole } from '@/lib/auth/current-user';
import { currentMonthStart, recentMonths } from '@/lib/domain/ceo-report';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Monthly report' };

/* ============================================================================
 * THE CEO REPORT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"When I give a report to a super admin…"* — one page, one month, every project,
 * what was promised against what went out, and who did it.
 *
 * ── THE PAGE ARRIVES WITH THE ANSWER ON IT ───────────────────────────────────
 * The figures are computed on the server, as on `/reports`. The written analysis is
 * NOT: it is a button, because it costs money per press and depends on OpenAI being
 * up. See `app/actions/ceo-report.ts` for that reasoning in full.
 *
 * ── ADMIN, NOT COORDINATOR ───────────────────────────────────────────────────
 * `/reports` admits a Coordinator. This one totals recurring fees across every
 * client, so it starts at Admin.
 *
 * ⚠️ It is a TOP-LEVEL segment rather than living under `/reports` for that
 * reason and not for tidiness: nested there, a Coordinator received HTTP 200
 * instead of a redirect, because the parent's `loading.tsx` put this refusal inside
 * a Suspense boundary. The full measurement is in `layout.tsx`. Do not move this
 * back under `/reports`, and do not add a `loading.tsx` here.
 * ========================================================================= */

export default async function CeoReportPage() {
  await requireRole('admin');

  const now = nowMs();
  const built = await ceoReportAction(currentMonthStart(now));

  /* The action refuses only a malformed month, and this one comes from our own
     clock — so a failure here is a fault, not a user error. Saying so beats
     rendering an empty report, which reads as a quiet month. */
  if (!built.ok) {
    return (
      <div className="mx-auto max-w-[var(--content-max)] space-y-8">
        <PageHeader
          eyebrow="AI & Digital Division"
          title="Monthly report"
          description={built.error}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Monthly report"
        description={
          <>
            Every active project for one month: what the package promised, what was actually
            published, where it went and who published it. Every figure is computed from the
            records you are allowed to see. The written analysis is generated on request from
            these same totals — the model is never asked to work out a number.
          </>
        }
      />

      <CeoReportWorkspace
        initialReport={built.report}
        months={recentMonths(now)}
        /* Checked on the server: the key must not reach the browser, so the
           browser is told only whether one exists. */
        canAnalyse={chatgptKey() !== null}
      />
    </div>
  );
}
