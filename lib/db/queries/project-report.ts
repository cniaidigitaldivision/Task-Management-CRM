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
}

export interface ReportPlacement {
  readonly platformId: string;
  readonly platformName: string;
  readonly platformSlug: string;
  readonly publishedOn: string;
  readonly contentKind: string;
  /** Null where the placement is recorded but the link has not been. */
  readonly url: string | null;
}

export interface ProjectReportData {
  readonly assets: readonly ReportAsset[];
  readonly placements: readonly ReportPlacement[];
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
      select t.id, t.title, t.published_on, t.content_kind, u.full_name as assignee_name
        from public.tasks t
        left join public.users u on u.id = t.assignee_id
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
      select tp.platform_id, pl.name as platform_name, pl.slug as platform_slug,
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

    return {
      assets: assets.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        publishedOn: dateText(row.published_on),
        contentKind: row.content_kind as string,
        assigneeName: (row.assignee_name as string | null) ?? null,
      })),
      placements: placements.map((row) => ({
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
