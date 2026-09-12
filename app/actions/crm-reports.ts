'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { computeCrmReport, storeCrmReport } from '@/lib/db/queries/crm-reports';
/* The guard lives in `lib/domain/` with the vocabulary it guards — see the note
   at the top of that file. */
import { isReportKind } from '@/lib/domain/crm-reports';
import { withUser } from '@/lib/db/client';

/* ============================================================================
 * GENERATING A CRM REPORT — Step 10
 * ----------------------------------------------------------------------------
 * Compute from the live tables, then freeze it. Two steps, in that order, and
 * the frozen copy is what anybody ever reads afterwards.
 *
 * ── ⚠️ NO ROLE CHECK, FOR THE THIRD TIME IN THIS FOLDER ────────────────────
 * 128's four report functions each check `app.crm_manages_project` inside
 * themselves, and its insert policy refuses anybody else. A `can(...)` here
 * would be a third rule to keep in step with two that cannot be forgotten.
 * ========================================================================= */

export interface ReportResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly reportId?: string;
}

/** `YYYY-MM-DD`, and nothing else reaches a `::date` cast. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateReportAction(
  kind: string,
  projectId: string,
  projectName: string,
  from: string,
  to: string,
): Promise<ReportResult> {
  const user = await requireUser();

  if (!isReportKind(kind)) return { ok: false, error: 'That is not a report.' };
  if (!DATE.test(from) || !DATE.test(to)) {
    return { ok: false, error: 'Those dates could not be read.' };
  }
  /* ⚠️ Refused rather than swapped. Somebody who typed the dates the wrong way
     round should be told, not handed a report for a period they did not ask
     for and might not notice. */
  if (from > to) {
    return { ok: false, error: 'The start of the period is after its end.' };
  }

  try {
    const report = await computeCrmReport(user.id, kind, projectId, {
      projectName,
      from,
      to,
    });

    /* ⚠️ AN EMPTY REPORT IS STILL STORED, and that is deliberate. "We looked in
       September and there was nothing" is a finding, and refusing to save it
       would leave no record that anybody looked. The builders each say in their
       notes what an empty result means. */
    const reportId = await storeCrmReport(user.id, kind, projectId, report);
    if (!reportId) {
      return { ok: false, error: 'That report could not be saved.' };
    }

    revalidatePath('/lead-reports');
    return { ok: true, reportId };
  } catch {
    /* 128's insert policy raises for anybody but a manager or an Admin. */
    return {
      ok: false,
      error: "Only this department's manager or an Admin can generate a lead report.",
    };
  }
}

/**
 * ⚠️ THERE IS NO DELETE ACTION, AND THERE WILL NOT BE ONE. `crm_reports` has no
 * DELETE policy at any rank — see 128's header. A report somebody can withdraw
 * after it was read is not evidence of anything, which is the same rule
 * `report_exports` and the activity log already follow.
 */
export async function reportCountAction(projectId: string): Promise<number> {
  const user = await requireUser();
  try {
    const rows = await withUser(user.id, (tx) => tx`
      select count(*) as n from public.crm_reports where project_id = ${projectId}::uuid
    `);
    return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
