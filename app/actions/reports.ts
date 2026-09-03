'use server';

import { requireRole } from '@/lib/auth/current-user';
import { CONTENT_KINDS, CONTENT_KIND_LABEL, STATUS_META } from '@/lib/domain/constants';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { listPeople, projectRolesByPerson } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { placementLinksByTask, platformSlugsByTask } from '@/lib/db/queries/placements';
import { teamWorkload } from '@/lib/db/queries/workload';
import { computeWorkload, weekWindow } from '@/lib/domain/workload';
import {
  EMPTY_FILTERS,
  NATURAL_SORT,
  PERIOD_PRESETS,
  REPORT_TYPES,
  buildReport,
  presetPeriod,
  reportFileStem,
  weeksInPeriod,
  type PeriodPreset,
  type Report,
  type ReportPeriod,
  type ReportFilters,
  type ReportInput,
  type ReportSort,
  type ReportTask,
  type ReportType,
} from '@/lib/domain/reports';
import { chartsFor, type ChartSpec } from '@/lib/domain/report-charts';
import {
  WORK_SORTS,
  buildWorkReport,
  workReportToReport,
  type WorkReport,
  type WorkSort,
} from '@/lib/domain/work-report';
import { composeReportSheet } from '@/lib/pdf/report-sheet';
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
  /**
   * Optional so every existing caller — the page's initial request, the export
   * action, the tests — keeps working unchanged and means "no filters". A
   * required field here would have been a wider change for the same behaviour.
   */
  readonly filters?: ReportFilters;
  readonly sort?: ReportSort;
  /**
   * The mockup's report-type dropdown reads "Work reports", and that is this:
   * a row per project-and-person. The four analytical types in lib/domain/reports.ts
   * sit alongside it in the same control.
   *
   * ⚠️ A SEPARATE FIELD rather than a fifth `ReportType`. `ReportType` is the
   * argument to `buildReport`, which is exhaustively switched over in three
   * places and tested against all four — adding a fifth member that one of those
   * switches cannot build would have made the type lie.
   */
  readonly work?: boolean;
  readonly workSort?: WorkSort;
  readonly workDirection?: 'asc' | 'desc';
}

export interface ReportResponse {
  readonly ok: true;
  readonly report: Report;
  /** Everybody the reader may narrow to. Empty for a Member — see below. */
  readonly people: ReadonlyArray<{ id: string; name: string }>;
  /**
   * The analytical view of the same rows.
   *
   * Alongside the report rather than inside it: `Report` is the type both export
   * writers and all of their tests already speak, and neither has any use for a
   * chart. See lib/domain/report-charts.ts.
   */
  readonly charts: readonly ChartSpec[];
  /** Everything the filter controls need to offer, from what the reader can see. */
  readonly options: FilterOptions;
  /** Present only when `work` was asked for. Null for the analytical types. */
  readonly work: WorkReport | null;
}

/**
 * What the filter dropdowns can offer.
 *
 * ⚠️ Built from the reader's OWN visible rows, not from a constant. A Coordinator
 * who can see three projects gets three in the dropdown — so the control cannot
 * offer a filter that would return an empty report and look broken, and it cannot
 * be used to discover the existence of a project outside their scope.
 */
export interface FilterOptions {
  readonly projects: ReadonlyArray<{ id: string; name: string; code: string }>;
  readonly platforms: ReadonlyArray<{ slug: string; label: string }>;
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

  const [taskRows, projectRows, people, platformsByTask, linksByTask] = await Promise.all([
    /* 5000 matches the CSV export's ceiling. A report over a period will be far
       under it; the bound exists so one enormous query cannot be provoked. */
    listTasks(user.id, { includeClosed: true, limit: 5000 }),
    listProjects(user.id, { includeArchived: true }),
    listPeople(user.id, { includeInactive: true }),
    /* In parallel with the tasks, not after them: it does not depend on which
       tasks came back, because RLS narrows both to the same reader. */
    platformSlugsByTask(user.id),
    /* Read alongside the slugs rather than after them — see the note above. The
       detail panel needs the platform NAME and the live link, which a slug
       cannot supply. */
    placementLinksByTask(user.id),
  ]);

  const subjectId = request.subjectId?.trim() || null;
  const subject = subjectId ? people.find((p) => p.id === subjectId) ?? null : null;
  /* An unknown id is refused rather than quietly widened to everybody. Silently
     ignoring it would hand somebody the whole division's figures when they had
     asked for one person's, which is the wrong direction to fail in. */
  if (subjectId && !subject) {
    return { ok: false, error: 'That person is not somebody you can report on.' };
  }

  const input = {
    type: request.type,
    period,
    subjectId,
    subjectName: subject?.fullName ?? null,
    /* Today from the server's clock, so "overdue" cannot be shifted by a wrong
       clock on the reader's machine. See ReportInput.today. */
    today: new Date(now).toISOString().slice(0, 10),
    tasks: taskRows.map((row) =>
      toReportTask({
        ...row,
        platforms: platformsByTask.get(row.id) ?? [],
        links: linksByTask.get(row.id) ?? [],
      }),
    ),
    people: await reportPeople(user.id, period, now),
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      status: p.status,
    })),
    /* ⚠️ Sanitised, not trusted. These arrive from a form and reach a pure
       function, a file name and an audit row — an unknown project id here would
       silently produce an empty report, which reads as "nothing happened" rather
       than as a bad request. See `cleanFilters`. */
    filters: cleanFilters(request.filters, projectRows.map((p) => p.id)),
    sort: request.sort ?? NATURAL_SORT,
  } satisfies ReportInput;

  /* ⚠️ ONE input, TWO consumers. The table and the charts must be computed from
     the identical object — building a second one "the same way" is how a chart
     comes to show 47 published while the table under it totals 45, and a reader
     who catches that stops trusting every other figure on the page. */
  const report = buildReport(input);

  /* ⚠️ Only queried when it is going to be used. `projectRolesByPerson` is a whole
     extra round trip, and the four analytical reports have no Role column — paying
     for it on every request would slow the reports nobody asked it for. */
  const work = request.work
    ? buildWorkReport(input, {
        roles: await projectRolesByPerson(user.id),
        sort: WORK_SORTS.includes(request.workSort as WorkSort)
          ? (request.workSort as WorkSort)
          : 'posts',
        direction: request.workDirection === 'asc' ? 'asc' : 'desc',
        weekStart: startOfWeek(now),
      })
    : null;

  /* Platform slugs the reader can actually see any placement for, so the filter
     never offers a platform that would return nothing. Sorted for a stable
     dropdown order — a list whose order changes between requests makes the
     control feel like it is moving under the cursor. */
  const slugs = [...new Set([...platformsByTask.values()].flat())].sort();

  return {
    ok: true,
    /* The work report is exported through the SAME typed-cell shape as the other
       four, so CSV, .xlsx and the PDF need no special case. See work-report.ts. */
    report: work ? workReportToReport(work, input, new Date(now).toISOString()) : report,
    work,
    /* ⚠️ No charts on the work report. The owner's mockup has none, and it is a
       table of pairings — a chart of it would be a chart of a join. The
       analytical types keep theirs. */
    charts: request.work ? [] : chartsFor(input),
    people: people
      .filter((p) => p.isActive)
      .map((p) => ({ id: p.id, name: p.fullName })),
    options: {
      projects: projectRows.map((p) => ({ id: p.id, name: p.name, code: p.code })),
      platforms: slugs.map((slug) => ({
        slug,
        label: slug.charAt(0).toUpperCase() + slug.slice(1),
      })),
    },
  };
}

/**
 * Keep only values this reader could legitimately have chosen.
 *
 * ── ⚠️ AN UNKNOWN VALUE IS DROPPED, NOT REFUSED, AND THAT IS DELIBERATE ─────
 * A person id is refused above, because widening "one person" to "everybody"
 * hands over more than was asked for — failing open in the dangerous direction.
 * These four fail the other way: an unrecognised project id, status, platform or
 * content kind can only ever REMOVE rows, so honouring it would show LESS than
 * the reader may see. Dropping it shows exactly what they asked for minus a
 * meaningless term.
 *
 * The practical case is not an attack, it is a bookmark: somebody saves a link
 * with a project in the filter, that project is later archived and deleted, and
 * the link should still open a report rather than an error page.
 *
 * ⚠️ Project ids are checked against what the reader can SEE, so a filter naming
 * a project outside their scope is dropped rather than being used to confirm the
 * project exists. Statuses and content kinds are checked against the enums;
 * platform slugs are not checked at all, because an unknown slug simply matches
 * no placement and the platform list is data rather than a closed set.
 */
function cleanFilters(
  filters: ReportFilters | undefined,
  visibleProjectIds: readonly string[],
): ReportFilters {
  if (!filters) return EMPTY_FILTERS;
  const visible = new Set(visibleProjectIds);
  return {
    projectIds: filters.projectIds.filter((id) => visible.has(id)),
    statuses: filters.statuses.filter((s) => s in STATUS_META),
    platforms: filters.platforms.filter((slug) => /^[a-z0-9_-]{1,40}$/.test(slug)),
    contentKinds: filters.contentKinds.filter(
      (k) => k === 'none' || (CONTENT_KINDS as readonly string[]).includes(k),
    ),
  };
}

/**
 * The filters, as prose for the PDF header.
 *
 * ⚠️ ON THE PRINTED SHEET, NOT OPTIONAL. A report of one project and a report of
 * thirteen look identical once they are on paper, and the reader holding it has no
 * control panel to check. This is the line that stops a filtered figure being
 * quoted in a meeting as the division's total.
 *
 * Names, not ids — the point is that a person can read it. A project whose id is
 * no longer resolvable is skipped rather than printed as a UUID, because the
 * summary is either useful or it is noise.
 */
/**
 * Monday, as `yyyy-mm-dd`.
 *
 * ⚠️ MONDAY, not Sunday. `getUTCDay()` calls Sunday 0, and taking it as the week
 * start would put Monday's posts in the previous week for every reader in a
 * country that does not work Sunday-to-Saturday — which is this one. The same
 * choice the posting calendar makes.
 *
 * For the work report's "This week" column only. The report's own period is
 * whatever the reader picked; this column is deliberately always the current week,
 * so a monthly report still shows what has happened in the last few days.
 */
function startOfWeek(nowMs: number): string {
  const now = new Date(nowMs);
  const day = now.getUTCDay();
  const backToMonday = day === 0 ? 6 : day - 1;
  return new Date(nowMs - backToMonday * 86_400_000).toISOString().slice(0, 10);
}

function describeFilters(filters: ReportFilters, options: FilterOptions): string[] {
  const out: string[] = [];

  if (filters.projectIds.length > 0) {
    const names = filters.projectIds
      .map((id) => options.projects.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    if (names.length > 0) out.push(`Projects: ${names.join(', ')}`);
  }

  if (filters.statuses.length > 0) {
    out.push(`Status: ${filters.statuses.map((s) => STATUS_META[s].label).join(', ')}`);
  }

  if (filters.platforms.length > 0) {
    const labels = filters.platforms.map(
      (slug) => options.platforms.find((p) => p.slug === slug)?.label ?? slug,
    );
    out.push(`Platform: ${labels.join(', ')}`);
  }

  if (filters.contentKinds.length > 0) {
    const labels = filters.contentKinds.map((k) =>
      k === 'none' ? 'Not content' : CONTENT_KIND_LABEL[k],
    );
    out.push(`Content: ${labels.join(', ')}`);
  }

  /* ⚠️ The PERSON filter is deliberately absent from this list. It is already in
     `report.subtitle` — "Najmulla · 2026-08-01 to 2026-08-31" — which the masthead
     prints at the top right of every page. Repeating it in the filter band would
     be the same fact twice, and the band exists to carry what nothing else says. */

  return out;
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
  contentKind: ReportTask['contentKind'];
  platforms: readonly string[];
  publishedOn: string | null;
  assigneeAvatarUrl: string | null;
  updatedAt: string;
  description: string | null;
  links: readonly ReportTask['links'][number][];
}): ReportTask {
  return {
    reference: row.reference,
    title: row.title,
    description: row.description,
    links: row.links,
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
    contentKind: row.contentKind,
    platforms: row.platforms,
    publishedOn: row.publishedOn,
    assigneeAvatarUrl: row.assigneeAvatarUrl,
    updatedAt: row.updatedAt,
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
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<ReportExport | ReportFailure> {
  const user = await requireRole('team_coordinator');

  if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
    return { ok: false, error: 'Unknown export format.' };
  }

  const built = await buildReportAction(request);
  if (!built.ok) return built;

  const { report } = built;
  const stem = reportFileStem(report);

  const file =
    format === 'csv'
      ? { content: reportToCsv(report), encoding: 'text' as const }
      : format === 'xlsx'
        ? {
            content: (await reportToXlsx(report)).toString('base64'),
            encoding: 'base64' as const,
          }
        : {
            content: Buffer.from(
              await composeReportSheet({
                report,
                /* ⚠️ The rich rows, so the PDF can draw avatars, brand marks and
                   status pills. `Report` is typed cells and cannot express any of
                   the three — see lib/pdf/report-sheet.ts. Null for the four
                   analytical types, which fall back to the generic table. */
                work: built.work,
                /* ⚠️ The SAME charts the screen is showing, from the same build.
                   Re-deriving them here would let a reader export a PDF whose
                   graphs differ from the ones they were just looking at. */
                charts: built.charts,
                filterSummary: describeFilters(
                  cleanFilters(request.filters, built.options.projects.map((p) => p.id)),
                  built.options,
                ),
                /* The server's clock, formatted as a date only — see the note on
                   determinism in lib/pdf/report-sheet.ts. */
                generatedOn: new Date(nowMs()).toISOString().slice(0, 10),
                generatedBy: user.fullName,
              }),
            ).toString('base64'),
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
        /* ⚠️ The FILTERS are part of what left the building. "A spreadsheet of the
           division's work turned up somewhere it should not have" is answerable
           only if the audit says which slice of it was taken — an export of one
           project and an export of everything are very different disclosures. */
        filters: request.filters ?? null,
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
