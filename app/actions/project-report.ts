'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { deleteProjectReport } from '@/lib/db/queries/report-files';
import { can } from '@/lib/domain/permissions';
import { generateProjectReport, type GenerateResult } from '@/lib/reports/generate';

/* ============================================================================
 * GENERATING AND REMOVING A PROJECT REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * Two thin actions. Everything that computes the figures, assembles the content
 * and records the row lives in `lib/reports/generate.ts`, and the note at the
 * top of that file explains why it is not in this one:
 *
 * ── ⚠️ IN A `'use server'` FILE EVERY EXPORTED ASYNC FUNCTION IS AN ENDPOINT ─
 * the browser may call with arguments of its choosing. The generator takes its
 * actor as a parameter — the cron runs a scheduled report as whoever set it up —
 * and exporting THAT from here would let anybody generate a report as anybody.
 * These two read the session first and pass what it says.
 * ========================================================================= */

export type { GenerateResult };

export async function generateProjectReportAction(
  projectId: string,
  kind: string,
  from?: string,
  to?: string,
): Promise<GenerateResult> {
  const user = await requireUser();
  /* ⚠️ The permission check stays INSIDE the generator rather than being
     repeated here — one rule, applied to whichever actor arrives, so the cron
     path cannot accidentally skip it. */
  return generateProjectReport(user, projectId, kind, from, to);
}

export async function deleteProjectReportAction(
  reportId: string,
  projectId: string,
): Promise<GenerateResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only an Admin can remove a report.' };
  }

  /* ⚠️ The row goes; the stored PNG stays. Deliberate: a report may already have been
     sent to a client, and an orphaned private object costs nothing while a deleted one
     cannot be recovered if the deletion was a mistake. Sweeping them is a separate,
     deliberate job — not a side effect of tidying a list. */
  try {
    await deleteProjectReport(user.id, reportId);
  } catch {
    return { ok: false, error: 'That report could not be removed.' };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
