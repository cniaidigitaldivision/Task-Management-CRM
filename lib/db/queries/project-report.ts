import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE FIGURES BEHIND A PROJECT REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"Generate Report is for reports related to this project."* One project, one date
 * range, whatever went out inside it.
 *
 * ── ⚠️ TWO READS, THEN ALL BUCKETING HAPPENS IN THE DOMAIN LAYER ──────────────
 * A week report has seven buckets, a month has four or five, a year up to sixty. The
 * obvious shape is one query per bucket — and that is sixty round trips to Singapore
 * for a year report, on a database this office is not next to.
 *
 * So: every published asset in the range, and every placement in the range, come back
 * once. `lib/domain/project-report.ts` sorts them into buckets. Which also means the
 * bucketing is pure and exhaustively testable, rather than being asserted against a
 * live database sixty times.
 *
 * ── ⚠️ COUNTED ON `published_on`, NEVER ON COMPLETION ─────────────────────────
 * A reel finished on Monday and posted on Friday belongs to Friday, and therefore to
 * Friday's week and Friday's month. Every report in this system already counts this
 * way (migration 033) and a project report that counted completion would disagree with
 * the CEO report about the same work.
 * ========================================================================= */

export interface ReportAsset {
  readonly id: string;
  readonly title: string;
  /** 'YYYY-MM-DD'. Never null — the query only returns published rows. */
  readonly publishedOn: string;
  readonly contentKind: string;
  readonly assigneeName: string | null;
  /* ── ⚠️ ADDED 2026-09-03, FOR THE PDF ─────────────────────────────────────
     Owner: *"if today's post should mention who did this post, what the post
     task name is… their status, and if it's a static post then their URL."*
     The PDF's published table listed PLACEMENTS — platform, type, time, link —
     and so could not name the task, the person or where it had got to. */
  readonly reference: string;
  readonly status: string;
  /** Whoever raised it, for the rare asset with no assignee. */
  readonly createdByName: string | null;
}

export interface ReportPlacement {
  /** Which task it belongs to, so a report can list one row per TASK and hang
   *  its platforms and link off that rather than one row per placement. */
  readonly taskId: string;
  readonly platformId: string;
  readonly platformName: string;
  readonly platformSlug: string;
  readonly publishedOn: string;
  readonly contentKind: string;
  /** Null where the placement is recorded but the link has not been. */
  readonly url: string | null;
}

/* ── ⚠️ A TASK ROW, WHICH IS NOT THE SAME THING AS AN ASSET ────────────────
   Owner, 2026-09-03: *"you will tell me how many tasks were created today, who
   created them, what task name, what their description is, what their category
   is, whether they are done or pending."*

   `ReportAsset` above answers "what went out" — published deliverables, counted
   on `published_on` against the package target. This answers "what was worked
   on", which is a different question with a different date and a different
   audience: the first is what a client is shown, the second is what a manager
   reads on a Monday morning. Keeping them apart is what stops a task that was
   raised and abandoned counting as delivery. */
export interface ReportTask {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  /** The deliverable kind, or null for ordinary work. The report's "category". */
  readonly contentKind: string | null;
  readonly status: string;
  readonly createdByName: string | null;
  readonly assigneeName: string | null;
  /** 'YYYY-MM-DD', the day it was RAISED — what the day-by-day table groups on. */
  readonly createdOn: string;
  readonly dueDate: string | null;
  readonly completedOn: string | null;
}

export interface ProjectReportData {
  readonly assets: readonly ReportAsset[];
  readonly placements: readonly ReportPlacement[];
  readonly tasks: readonly ReportTask[];
}

/**
 * Everything published by one project between two dates, inclusive.
 *
 * Runs as the caller, so row-level security applies — a report shows only what the
 * person generating it could already see on the project page. That is deliberate: a
 * report is the same data arranged differently, and one that revealed more than the
 * screens it came from would be a leak wearing a letterhead.
 */
export async function projectReportData(
  actorId: string,
  projectId: string,
  start: string,
  end: string,
): Promise<ProjectReportData> {
  return withUser(actorId, async (tx) => {
    const assets = await tx`
      select t.id, t.reference, t.title, t.published_on, t.content_kind, t.status,
             u.full_name as assignee_name, c.full_name as created_by_name
        from public.tasks t
        left join public.users u on u.id = t.assignee_id
        left join public.users c on c.id = t.created_by_id
       where t.project_id = ${projectId}
         and not t.is_deleted
         and t.content_kind is not null
         and t.status <> 'cancelled'
         and t.published_on is not null
         and t.published_on >= ${start}::date
         and t.published_on <= ${end}::date
       order by t.published_on, t.title
    `;

    /* ⚠️ Placements are counted separately and are NOT a substitute for assets. One
       asset cross-posted to four platforms is one asset and four placements — the
       first is what the package target is measured against, the second is reach.
       Conflating them inflates delivery three- or four-fold. */
    const placements = await tx`
      select t.id as task_id,
             tp.platform_id, pl.name as platform_name, pl.slug as platform_slug,
             tp.published_on, tp.content_kind, tp.url
        from public.task_placements tp
        join public.tasks t on t.id = tp.task_id
        join public.platforms pl on pl.id = tp.platform_id
       where t.project_id = ${projectId}
         and not t.is_deleted
         and t.status <> 'cancelled'
         and tp.published_on is not null
         and tp.published_on >= ${start}::date
         and tp.published_on <= ${end}::date
       order by pl.sort_order, tp.published_on
    `;

    /* ⚠️ ON `created_at`, NOT `due_date` — the owner asked for tasks CREATED in
       the period, and the two answer different questions. A task raised on Monday
       for Friday belongs to Monday's report as work that was taken on, and to
       Friday's board as work that is due. Reported in the division's own zone so
       a task raised at 9pm in Karachi is not filed under the previous day.

       ⚠️ Cancelled work is kept, unlike the asset query above. An asset that was
       cancelled did not go out and must not count as delivery; a task that was
       cancelled IS part of the week's story — somebody raised it and it was
       dropped, which is exactly the sort of thing a report exists to surface. */
    const tasks = await tx`
      select t.id, t.reference, t.title, t.description, t.content_kind, t.status,
             creator.full_name as created_by_name,
             assignee.full_name as assignee_name,
             (t.created_at at time zone 'Asia/Karachi')::date as created_on,
             t.due_date,
             (t.completed_at at time zone 'Asia/Karachi')::date as completed_on
        from public.tasks t
        left join public.users creator  on creator.id  = t.created_by_id
        left join public.users assignee on assignee.id = t.assignee_id
       where t.project_id = ${projectId}
         and not t.is_deleted
         and (t.created_at at time zone 'Asia/Karachi')::date >= ${start}::date
         and (t.created_at at time zone 'Asia/Karachi')::date <= ${end}::date
       order by (t.created_at at time zone 'Asia/Karachi')::date, t.reference
    `;

    return {
      tasks: (tasks as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        reference: row.reference as string,
        title: row.title as string,
        description: (row.description as string | null) ?? null,
        contentKind: (row.content_kind as string | null) ?? null,
        status: row.status as string,
        createdByName: (row.created_by_name as string | null) ?? null,
        assigneeName: (row.assignee_name as string | null) ?? null,
        createdOn: dateOnly(row.created_on),
        dueDate: row.due_date ? dateOnly(row.due_date) : null,
        completedOn: row.completed_on ? dateOnly(row.completed_on) : null,
      })),
      assets: assets.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        publishedOn: dateText(row.published_on),
        contentKind: row.content_kind as string,
        assigneeName: (row.assignee_name as string | null) ?? null,
        reference: row.reference as string,
        status: row.status as string,
        createdByName: (row.created_by_name as string | null) ?? null,
      })),
      placements: placements.map((row) => ({
        taskId: row.task_id as string,
        platformId: row.platform_id as string,
        platformName: row.platform_name as string,
        platformSlug: row.platform_slug as string,
        publishedOn: dateText(row.published_on),
        contentKind: row.content_kind as string,
        url: (row.url as string | null) ?? null,
      })),
    };
  });
}

/**
 * A `date` column as 'YYYY-MM-DD'.
 *
 * ⚠️ `toISOString()` would be wrong. postgres.js hands back a Date at UTC midnight, and
 * `toISOString().slice(0, 10)` happens to work for that — but the moment a driver or a
 * column type changes to a timestamp, the same call starts returning the previous day
 * west of Greenwich. Reading the UTC parts says what is meant and cannot drift.
 */
function dateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  return String(value).slice(0, 10);
}

/** A `date` column as 'YYYY-MM-DD'.
 *
 *  ⚠️ postgres.js hands a `date` back as a JS Date at UTC midnight, so
 *  `String(value).slice(0, 10)` gives 'Wed Sep 02'. That exact mistake made the
 *  repeat runner recognise no day as a repeat day on 2026-09-03 — it fails
 *  silently, which is why this helper exists rather than an inline slice. */
function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}
