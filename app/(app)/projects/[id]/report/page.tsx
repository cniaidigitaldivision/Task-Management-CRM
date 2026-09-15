import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProjectReportSheet } from '@/components/project/project-report-sheet';
import { requireUser } from '@/lib/auth/current-user';
import { getProject } from '@/lib/db/queries/projects';
import { projectReportData } from '@/lib/db/queries/project-report';
import { buildProjectReport } from '@/lib/domain/project-report';
import {
  MONTH_START,
  isReportKind,
  reportPeriod,
} from '@/lib/domain/report-periods';
import { can } from '@/lib/domain/permissions';
import { redactOne } from '@/lib/view/project-finance';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Project report' };

/* ============================================================================
 * ONE PROJECT'S REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"Generate Report is for reports related to this project."* Explicitly not the
 * division-wide CEO report, which lives at /monthly-report and is a different
 * audience: that one totals every client's fees, this one covers one client's work.
 *
 * ── ⚠️ THE KIND AND THE RANGE ARE VALIDATED, NOT TRUSTED ──────────────────────
 * All three arrive in a URL somebody can edit, and all three end up in date
 * comparisons. A malformed value would produce an empty report — which reads as "we
 * published nothing" rather than as the fault it is, and that is the worst possible
 * failure for a page a client may see. So an unrecognised kind is a 404 and a
 * malformed month is ignored in favour of the default span.
 *
 * ── PRINT IS THE PDF ────────────────────────────────────────────────────────
 * Same decision as /reports and /monthly-report (globals.css §PRINT): the browser's
 * own print dialogue saves as PDF on every platform, the print stylesheet already
 * turns this into ink-on-white with repeating table headers, and there is no second
 * renderer to drift from the screen. `@page` is landscape there, which suits the
 * breakdown tables.
 * ========================================================================= */

export default async function ProjectReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; from?: string; to?: string }>;
}) {
  /* ⚠️ ONE WAVE — Rule Zero, law 4 (docs/20-UI-RESPONSIVENESS.md). None of these
     three needs an answer from the other two, so awaiting them in a row was
     three trips for data that could have left together. */
  const [{ id }, { kind: rawKind, from: rawFrom, to: rawTo }, user] = await Promise.all([
    params,
    searchParams,
    requireUser(),
  ]);
  const actor = { role: user.role, id: user.id };

  /* Default to this month rather than 404ing a bare /report — somebody who types the
     URL should get the most useful report, not an error. */
  const kind = rawKind && isReportKind(rawKind) ? rawKind : 'month';

  const now = new Date(nowMs());
  const pad = (n: number) => String(n).padStart(2, '0');
  /* UTC parts, so which report you get does not depend on where the server runs. */
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const period = reportPeriod(
    kind,
    today,
    rawFrom && MONTH_START.test(rawFrom) ? rawFrom : undefined,
    rawTo && MONTH_START.test(rawTo) ? rawTo : undefined,
  );

  /* ⚠️ AND THESE TWO TOGETHER. The report reads nothing from `project` — it needs
     the id and the period, both known already — so waiting for one before asking
     for the other was a whole round trip spent on nothing.

     ⚠️ ASKING FOR THE DATA BEFORE THE PROJECT IS CONFIRMED IS SAFE: both run
     under `withUser`, so RLS answers for this person either way and a report for
     a project they cannot see comes back empty and is discarded below. */
  const [project, data] = await Promise.all([
    getProject(user.id, id),
    projectReportData(user.id, id, period.start, period.end),
  ]);

  /* ⚠️ 404 for both "no such project" and "not yours" — `getProject` runs under RLS, and
     distinguishing them would confirm that a project they may not see exists. */
  if (!project) notFound();

  const report = buildProjectReport(
    period,
    data.assets,
    data.placements,
    {
      staticPostsPerDay: project.staticPostsPerDay,
      reelsPerWeek: project.reelsPerWeek,
      reelDays: project.reelDays,
      postingDays: project.postingDays,
    },
    /* Activity alongside delivery — owner, 2026-09-03. See `ReportTaskInput`. */
    data.tasks,
  );

  const canSeeFinance = can(actor, 'project.view_finance');

  return (
    <ProjectReportSheet
      /* Money stripped on the server — the sheet is a Client Component, so anything on
         the row is serialised into the payload whether it is rendered or not. See
         lib/view/project-finance.ts for the leak this closes. */
      project={redactOne(project, canSeeFinance)}
      report={report}
      assets={data.assets}
      canSeeFinance={canSeeFinance}
      generatedOn={today}
      generatedBy={user.fullName ?? user.email}
    />
  );
}
