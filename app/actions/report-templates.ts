'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { getProject } from '@/lib/db/queries/projects';
import { metaMetricRowsForExport, metaPostRowsForExport } from '@/lib/db/queries/meta-studio';
import {
  deleteReportTemplate,
  deleteSchedule,
  getReportTemplate,
  insertReportTemplate,
  insertSchedule,
  recordExport,
  recordTemplateUse,
  setScheduleActive,
  toggleTemplateFavourite,
} from '@/lib/db/queries/report-templates';
import { exportFileName, toCsv } from '@/lib/domain/csv';
import { can } from '@/lib/domain/permissions';
import { isReportKind } from '@/lib/domain/report-periods';
import {
  CADENCES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_ENGINES,
  nextRunOn,
  type Cadence,
  type TemplateCategory,
  type ReportTemplate,
  type TemplateEngine,
} from '@/lib/domain/report-templates';
import { isoDateIn, nowMs } from '@/lib/now';

import { exportTasksAction, exportWorkloadAction } from './export';
import { generateProjectReportAction } from './project-report';

/* ============================================================================
 * RUNNING A REPORT TEMPLATE — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Everything should be working and live data will be added. Put everything in
 * logically and make it work."*
 *
 * ── ⚠️ THIS FILE DISPATCHES; IT DOES NOT GENERATE ───────────────────────────
 * Every engine below hands off to machinery that already existed and is already
 * proven — `generateProjectReportAction` for the drawn PDF, `exportTasksAction`
 * and `exportWorkloadAction` for the two CSVs. A second implementation of any of
 * them would be a second set of figures to disagree with the first, which is the
 * whole failure mode the report row was built to prevent.
 *
 * The only new writers are the two Meta CSVs, because nothing exported those
 * tables before.
 *
 * ── ⚠️ EVERY OUTCOME IS RECORDED, INCLUDING THE FAILURES ────────────────────
 * `recordExport` is called on both paths. A history of successes only would hide
 * the interesting half — the exports somebody tried and could not get — and once
 * a file is in a Downloads folder every access control in this system stops
 * applying to it, so when a spreadsheet of the division's work turns up
 * somewhere it should not be, this is the only thing that can answer when it
 * left and who took it. Same argument as the audit write in `export.ts`.
 * ========================================================================= */

export interface RunResult {
  readonly ok: boolean;
  readonly error?: string;
  /** For a PDF: open this. */
  readonly reportUrl?: string;
  /** For a CSV: the browser saves these. */
  readonly fileName?: string;
  readonly csv?: string;
  readonly rowCount?: number;
}

export async function runReportTemplateAction(
  templateId: string,
  projectId: string,
  range?: { readonly from: string; readonly to: string },
): Promise<RunResult> {
  const user = await requireUser();

  const template = await getReportTemplate(user.id, templateId);
  if (!template) return { ok: false, error: 'That template is no longer available.' };

  /* ⚠️ THE PROJECT IS FETCHED UNDER RLS RATHER THAN TRUSTED FROM THE FORM. The
     id arrives from a client component; without this, somebody could ask for a
     report on a project they cannot see and the engines below would happily
     build one. */
  const project = await getProject(user.id, projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  const result = await runEngine(user.id, template, projectId, range);

  /* ── Record it either way, then let the failure surface ────────────────── */
  await recordExport(user.id, {
    projectId,
    templateId: template.id,
    templateName: template.name,
    reportId: result.ok ? (result.reportId ?? null) : null,
    format: template.format,
    fileName: result.fileName ?? `${template.name}.${template.format}`,
    byteSize: result.csv ? Buffer.byteLength(result.csv, 'utf8') : null,
    rowCount: result.rowCount ?? null,
    status: result.ok ? 'ready' : 'failed',
    /* ⚠️ A FAILED ROW MUST CARRY A REASON — 096's check constraint enforces it,
       so a nullish error here would turn a failed export into a failed INSERT
       and lose the record of the failure entirely. */
    error: result.ok ? null : (result.error ?? 'The export failed for an unrecorded reason.'),
  }).catch(() => {
    /* The history write must never swallow the export the person asked for. But
       a failure here is worth knowing about, so it is deliberately not silent. */
    console.error('[report-templates] failed to record an export in the history');
  });

  if (!result.ok) return { ok: false, error: result.error };

  await recordTemplateUse(user.id, template.id).catch(() => {
    console.error('[report-templates] failed to bump the usage counter');
  });

  revalidatePath('/studio');

  return {
    ok: true,
    reportUrl: result.reportId ? `/api/project-report/${result.reportId}` : undefined,
    fileName: result.fileName,
    csv: result.csv,
    rowCount: result.rowCount,
  };
}

interface EngineResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly reportId?: string;
  readonly fileName?: string;
  readonly csv?: string;
  readonly rowCount?: number;
}

async function runEngine(
  actorId: string,
  template: ReportTemplate,
  projectId: string,
  range?: { readonly from: string; readonly to: string },
): Promise<EngineResult> {
  if (template.engine === 'project_report') {
    /* ⚠️ THE PROVEN PATH, CALLED AND NOT REIMPLEMENTED. This computes the
       figures, assembles the `ReportContent` and writes the append-only
       `project_reports` row that is the audit trail behind the document — and
       `/api/project-report/[id]` draws the PDF from that row on demand, so the
       same report opened twice is the same file.

       A second generator here would be a second set of figures, and the first
       time they disagreed the question "was that report right?" would become
       unanswerable. That row IS the answer. */
    const r = await generateProjectReportAction(projectId, template.kind ?? 'month');
    return r.ok
      ? {
          ok: true,
          reportId: r.reportId,
          /* Named for the history row. The PDF route sets the real download
             name from the project's CURRENT name, deliberately — see its
             header — so this is the history's label, not a promise about the
             file. */
          fileName: `${template.name}.pdf`,
        }
      : { ok: false, error: r.error };
  }

  return runCsvEngine(actorId, template.engine, projectId, range);
}

async function runCsvEngine(
  actorId: string,
  engine: TemplateEngine,
  projectId: string,
  range?: { readonly from: string; readonly to: string },
): Promise<EngineResult> {
  const stamp = new Date(nowMs()).toISOString();

  switch (engine) {
    case 'tasks_csv': {
      /* ⚠️ SCOPED TO THE PROJECT. `exportTasksAction` defaults to everything the
         person can see, which is right on the Tasks page and wrong here — this
         button sits inside one project and must not quietly hand over the
         division's whole board. */
      const r = await exportTasksAction({ projectId, includeClosed: true });
      return r.ok
        ? { ok: true, fileName: r.fileName, csv: r.csv, rowCount: r.rowCount }
        : { ok: false, error: r.error };
    }

    case 'workload_csv': {
      const r = await exportWorkloadAction();
      return r.ok
        ? { ok: true, fileName: r.fileName, csv: r.csv, rowCount: r.rowCount }
        : { ok: false, error: r.error };
    }

    case 'meta_metrics_csv': {
      const from = range?.from ?? isoDateIn(nowMs() - 29 * 24 * 3_600_000);
      const to = range?.to ?? isoDateIn(nowMs());
      const rows = await metaMetricRowsForExport(actorId, projectId, from, to);

      if (rows.length === 0) {
        return {
          ok: false,
          error:
            'No Meta figures have been collected for this project in that range. Connect an account, or widen the dates.',
        };
      }

      return {
        ok: true,
        fileName: exportFileName('cni-meta-metrics', stamp),
        csv: toCsv(['Date', 'Account', 'Platform', 'Metric key', 'Metric', 'Value'], rows),
        rowCount: rows.length,
      };
    }

    case 'meta_posts_csv': {
      const rows = await metaPostRowsForExport(actorId, projectId);

      if (rows.length === 0) {
        return {
          ok: false,
          error: 'No Meta posts have been collected for this project yet.',
        };
      }

      return {
        ok: true,
        fileName: exportFileName('cni-meta-posts', stamp),
        csv: toCsv(
          [
            'Published at',
            'Account',
            'Platform',
            'Surface',
            'Media type',
            'Caption',
            'Permalink',
            'Reach',
            'Views',
            'Likes',
            'Comments',
            'Shares',
            'Saves',
            'Interactions',
            'Engagement rate',
          ],
          rows,
        ),
        rowCount: rows.length,
      };
    }

    default:
      /* ⚠️ REFUSED, NOT IGNORED. An engine nobody implemented must fail loudly
         here rather than return an empty file — a zero-row CSV reads as "there
         was nothing to report", which is the worst possible way for this to
         break. 096's check constraint means a row cannot reach this line, and
         this is the second lock on the same door. */
      return { ok: false, error: `No generator exists for "${engine}".` };
  }
}

/* ---- Favourites ---------------------------------------------------------- */

export async function toggleTemplateFavouriteAction(
  templateId: string,
): Promise<{ readonly ok: boolean; readonly isFavourite?: boolean; readonly error?: string }> {
  const user = await requireUser();
  const isFavourite = await toggleTemplateFavourite(user.id, templateId);
  revalidatePath('/studio');
  return { ok: true, isFavourite };
}

/* ---- Custom templates ---------------------------------------------------- */

export interface SaveTemplateResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly templateId?: string;
}

export async function createCustomTemplateAction(input: {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly engine: string;
  readonly kind: string | null;
}): Promise<SaveTemplateResult> {
  const user = await requireUser();

  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Give the template a name between 2 and 80 characters.' };
  }

  if (!(TEMPLATE_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: 'That is not one of the categories.' };
  }

  /* ⚠️ THE ENGINE IS VALIDATED AGAINST THE LIST OF ONES THAT EXIST. Without
     this, a hand-crafted request could store a template whose button does
     nothing, which is precisely the thing this whole tab is built not to have.
     096's check constraint refuses it too — this returns a sentence instead of a
     database error. */
  if (!(TEMPLATE_ENGINES as readonly string[]).includes(input.engine)) {
    return { ok: false, error: 'That is not a report this system can produce.' };
  }
  const engine = input.engine as TemplateEngine;

  /* The PDF engine needs a period; the CSV engines must not carry one. */
  const kind = engine === 'project_report' ? input.kind : null;
  if (engine === 'project_report' && (!kind || !isReportKind(kind))) {
    return { ok: false, error: 'Choose which period the report should cover.' };
  }

  const format = engine === 'project_report' ? 'pdf' : 'csv';

  const templateId = await insertReportTemplate(user.id, {
    name,
    description: input.description.trim().slice(0, 400),
    category: input.category as TemplateCategory,
    engine,
    kind,
    format,
  });

  revalidatePath('/studio');
  return { ok: true, templateId };
}

export async function deleteCustomTemplateAction(
  templateId: string,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const user = await requireUser();

  const removed = await deleteReportTemplate(user.id, templateId);
  if (!removed) {
    /* ⚠️ THE POLICY IN 096 REFUSED IT, and the two reasons it could have are
       worth telling apart in the message: a built-in belongs to everyone, and
       somebody else's custom template is theirs. */
    return {
      ok: false,
      error: 'That template cannot be deleted — built-in templates are fixed, and a custom one can only be removed by its author or an Admin.',
    };
  }

  revalidatePath('/studio');
  return { ok: true };
}

/* ---- Schedules ----------------------------------------------------------- */

export async function createScheduleAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly cadence: string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can schedule a report.' };
  }

  if (!(CADENCES as readonly string[]).includes(input.cadence)) {
    return { ok: false, error: 'That is not one of the cadences.' };
  }
  const cadence = input.cadence as Cadence;

  const project = await getProject(user.id, input.projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  const template = await getReportTemplate(user.id, input.templateId);
  if (!template) return { ok: false, error: 'That template is no longer available.' };

  /* ⚠️ THE FIRST RUN IS THE NEXT ONE, NOT TODAY. Scheduling a daily report at
     four in the afternoon should not immediately file today's — the person
     pressing this can generate today's with one click if they want it, and a
     schedule that fires on creation makes the button feel like it did something
     twice. `isoDateIn` is the KARACHI date; `current_date` on this server is a
     different day for five hours each evening. */
  await insertSchedule(user.id, {
    projectId: input.projectId,
    templateId: input.templateId,
    cadence,
    nextRunOn: nextRunOn(cadence, isoDateIn(nowMs())),
  });

  revalidatePath('/studio');
  return { ok: true };
}

export async function setScheduleActiveAction(
  scheduleId: string,
  isActive: boolean,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const user = await requireUser();
  const changed = await setScheduleActive(user.id, scheduleId, isActive);
  if (!changed) return { ok: false, error: 'That schedule is no longer available.' };
  revalidatePath('/studio');
  return { ok: true };
}

export async function deleteScheduleAction(
  scheduleId: string,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const user = await requireUser();
  const removed = await deleteSchedule(user.id, scheduleId);
  if (!removed) return { ok: false, error: 'That schedule is no longer available.' };
  revalidatePath('/studio');
  return { ok: true };
}
