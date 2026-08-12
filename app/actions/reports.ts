'use server';

import { requireRole } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { listPeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { teamWorkload } from '@/lib/db/queries/workload';
import { computeWorkload, weekWindow } from '@/lib/domain/workload';
import {
  PERIOD_PRESETS,
  REPORT_TYPES,
  buildReport,
  presetPeriod,
  reportFileStem,
  weeksInPeriod,
  type PeriodPreset,
  type Report,
  type ReportPeriod,
  type ReportTask,
  type ReportType,
} from '@/lib/domain/reports';
import { reportFileName, reportToCsv, reportToXlsx } from '@/lib/export/report-writers';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * REPORTS — CHANGE-PLAN 5.1 and 5.2
 * ----------------------------------------------------------------------------
 * Gathers the rows, hands them to the pure engine in lib/domain/reports.ts, and
 * writes the result out. No arithmetic lives here — that is the point of the
 * split, and it is why the figures can be tested without a database.
 *
 * ── SCOPE IS ROW-LEVEL SECURITY, NOT A FILTER ────────────────────────────────
 * Every query runs through `withUser`, so a Coordinator's report covers their
 * people and a Member's covers themselves — from the same code, with no `if`
 * anywhere (ADR-003). The `subjectId` a reader picks narrows what they can
 * already see. It is not what stops them seeing more.
 *
 * ── AN EXPORT IS A COPY THAT LEAVES THE BUILDING ─────────────────────────────
 * Same rule as `app/actions/export.ts`: once a file is in Downloads, no access
 * control in this system applies to it any more. So every export is audited with
 * its type, period, scope and row count. Not to catch anybody — so that when a
 * spreadsheet of the division's work turns up somewhere it should not be, the
 * question "when did this leave, and who took it" has an answer.
 * ========================================================================= */

export interface ReportRequest {
  readonly type: ReportType;
  readonly preset: PeriodPreset | 'custom';
  /** Used only when `preset` is 'custom'. */
  readonly start?: string;
  readonly end?: string;
  readonly subjectId?: string | null;
}

export interface ReportResponse {
  readonly ok: true;
  readonly report: Report;
  /** Everybody the reader may narrow to. Empty for a Member — see below. */
  readonly people: ReadonlyArray<{ id: string; name: string }>;
}

export interface ReportFailure {
  readonly ok: false;
  readonly error: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the requested period.
 *
 * A custom range is validated rather than trusted: these values arrive from a
 * form, reach a SQL-free pure function, and end up in a file name. A malformed
 * date would silently produce an empty report, which reads as "no work happened"
 * — a wrong answer is worse than a refusal.
 */
function resolvePeriod(request: ReportRequest, now: number): ReportPeriod | null {
  if (request.preset !== 'custom') {
    if (!PERIOD_PRESETS.includes(request.preset)) return null;
    return presetPeriod(request.preset, now);
  }

  const { start, end } = request;
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end)) return null;
  if (Number.isNaN(Date.parse(`${start}T00:00:00Z`))) return null;
  if (Number.isNaN(Date.parse(`${end}T00:00:00Z`))) return null;
  /* Swapped rather than refused: somebody who picks the dates the wrong way
     round meant the range between them, and an error message here would be
     pedantry rather than help. */
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Build a report.
 *
 * Coordinator and above — the same floor the Reports page has always had. A
 * Member has no reporting screen, so there is no per-person report for them to
 * ask for; their own work is `/my-work`.
 */
export async function buildReportAction(
  request: ReportRequest,
): Promise<ReportResponse | ReportFailure> {
  const user = await requireRole('team_coordinator');
  const now = nowMs();

  if (!REPORT_TYPES.includes(request.type)) return { ok: false, error: 'Unknown report type.' };

  const period = resolvePeriod(request, now);
  if (!period) {
    return { ok: false, error: 'That period is not a valid pair of dates. Pick a start and an end.' };
  }

  const [taskRows, projectRows, people] = await Promise.all([
    /* 5000 matches the CSV export's ceiling. A report over a period will be far
       under it; the bound exists so one enormous query cannot be provoked. */
    listTasks(user.id, { includeClosed: true, limit: 5000 }),
    listProjects(user.id, { includeArchived: true }),
    listPeople(user.id, { includeInactive: true }),
  ]);

  const subjectId = request.subjectId?.trim() || null;
  const subject = subjectId ? people.find((p) => p.id === subjectId) ?? null : null;
  /* An unknown id is refused rather than quietly widened to everybody. Silently
     ignoring it would hand somebody the whole division's figures when they had
     asked for one person's, which is the wrong direction to fail in. */
  if (subjectId && !subject) {
    return { ok: false, error: 'That person is not somebody you can report on.' };
  }

  const report = buildReport({
    type: request.type,
    period,
    subjectId,
    subjectName: subject?.fullName ?? null,
    /* Today from the server's clock, so "overdue" cannot be shifted by a wrong
       clock on the reader's machine. See ReportInput.today. */
    today: new Date(now).toISOString().slice(0, 10),
    tasks: taskRows.map(toReportTask),
    people: await reportPeople(user.id, period, now),
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      status: p.status,
    })),
  });

  return {
    ok: true,
    report,
    people: people
      .filter((p) => p.isActive)
      .map((p) => ({ id: p.id, name: p.fullName })),
  };
}

function toReportTask(row: {
  reference: string;
  title: string;
  projectId: string;
  projectName: string;
  projectType: ReportTask['projectType'];
  projectCode: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: ReportTask['status'];
  effortPoints: number;
  dueDate: string | null;
  completedAt: string | null;
  timeLimitMinutes: number | null;
  timeSpentMinutes: number;
  extensionMinutesGranted: number;
}): ReportTask {
  return {
    reference: row.reference,
    title: row.title,
    projectId: row.projectId,
    projectName: row.projectName,
    projectType: row.projectType,
    projectCode: row.projectCode,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    status: row.status,
    effortPoints: row.effortPoints,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    timeLimitMinutes: row.timeLimitMinutes,
    timeSpentMinutes: row.timeSpentMinutes,
    extensionMinutesGranted: row.extensionMinutesGranted,
  };
}

/**
 * Workload figures for the report's period.
 *
 * ── WHY THIS RECOMPUTES RATHER THAN REUSING `teamWorkload` DIRECTLY ──────────
 * `teamWorkload` answers "this week", because that is what the Workload screen
 * asks. A report over a fortnight or a quarter needs the same arithmetic against
 * a different window, and capacity scaled to match — capacity is defined per
 * week (ADR-004), so a fortnight allows twice a week's points.
 *
 * `computeWorkload` already accepts an arbitrary window, so this is the same
 * function with a different argument, not a second implementation. When the
 * period IS the current week the two agree exactly, which is the property that
 * matters: two screens quoting different utilisation for the same week would be
 * worse than either.
 */
async function reportPeople(
  actorId: string,
  period: ReportPeriod,
  now: number,
) {
  const { people } = await teamWorkload(actorId, now);
  const currentWeek = weekWindow(now);

  /* The common case — "this week" — is already computed, so it is reused rather
     than recalculated. Guarantees the agreement rather than hoping for it. */
  if (period.start === currentWeek.start && period.end === currentWeek.end) {
    return people.map((p) => ({
      userId: p.userId,
      name: p.name,
      roleTitle: p.roleTitle,
      role: p.role,
      loadPoints: p.workload.loadPoints,
      capacityPoints: p.workload.capacityPoints,
      utilisationPct: p.workload.utilisationPct,
      bandLabel: p.workload.bandLabel,
      activeTaskCount: p.workload.activeTaskCount,
      maxConcurrentTasks: p.workload.maxConcurrentTasks,
      otherWorkPct: p.otherWorkPct,
    }));
  }

  const weeks = Math.max(weeksInPeriod(period), 0.01);
  const tasks = await listTasks(actorId, { includeClosed: true, limit: 5000 });

  return people.map((p) => {
    /* Exactly `WorkloadTaskInput` — four fields, the same four the Workload
       screen feeds in, so the two cannot diverge. */
    const theirs = tasks
      .filter((t) => t.assigneeId === p.userId)
      .map((t) => ({
        status: t.status,
        priority: t.priority,
        effortPoints: t.effortPoints,
        dueDate: t.dueDate,
      }));

    const result = computeWorkload({
      tasks: theirs,
      /* Scaled, and stated in the report's notes so the number is not mistaken
         for a weekly one. */
      capacityPoints: p.workload.capacityPoints * weeks,
      maxConcurrentTasks: p.workload.maxConcurrentTasks,
      window: period,
    });

    return {
      userId: p.userId,
      name: p.name,
      roleTitle: p.roleTitle,
      role: p.role,
      loadPoints: result.loadPoints,
      capacityPoints: Math.round(result.capacityPoints * 10) / 10,
      utilisationPct: result.utilisationPct,
      bandLabel: result.bandLabel,
      activeTaskCount: result.activeTaskCount,
      maxConcurrentTasks: result.maxConcurrentTasks,
      otherWorkPct: p.otherWorkPct,
    };
  });
}

/* ==========================================================================
 * EXPORT
 * ========================================================================== */

export interface ReportExport {
  readonly ok: true;
  readonly fileName: string;
  /** CSV text, or base64 for the spreadsheet. */
  readonly content: string;
  readonly encoding: 'text' | 'base64';
  readonly rowCount: number;
}

/**
 * The same report, as a file.
 *
 * Rebuilt server-side from the request rather than taking a `Report` from the
 * client. A report posted back could claim any figures at all, and the export is
 * the artefact that leaves the building with the division's name on it.
 *
 * base64 for the spreadsheet because a server action returns JSON, and .xlsx is
 * a zip — bytes do not survive being treated as a string.
 */
export async function exportReportAction(
  request: ReportRequest,
  format: 'csv' | 'xlsx',
): Promise<ReportExport | ReportFailure> {
  const user = await requireRole('team_coordinator');

  if (format !== 'csv' && format !== 'xlsx') {
    return { ok: false, error: 'Unknown export format.' };
  }

  const built = await buildReportAction(request);
  if (!built.ok) return built;

  const { report } = built;
  const stem = reportFileStem(report);

  const file =
    format === 'csv'
      ? { content: reportToCsv(report), encoding: 'text' as const }
      : {
          content: (await reportToXlsx(report)).toString('base64'),
          encoding: 'base64' as const,
        };

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'report',
      entityId: null,
      action: `export.report.${format}`,
      after: {
        reportType: report.type,
        period: report.period,
        subjectId: request.subjectId ?? null,
        rowCount: report.rows.length,
      },
    }),
  ).catch(() => {
    /* The audit write must not swallow the export, but a failure is worth
       knowing about — same decision as app/actions/export.ts. */
    console.error('[reports] audit write failed for a report export');
  });

  return {
    ok: true,
    fileName: reportFileName(stem, format),
    content: file.content,
    encoding: file.encoding,
    rowCount: report.rows.length,
  };
}
