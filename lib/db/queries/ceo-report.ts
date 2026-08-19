import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE FIGURES BEHIND THE CEO REPORT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"I want to see how many projects we are maintaining… who is working on that
 * project, how many posts are being published on a social media platform on a
 * daily basis by managing or tracking all tasks related to that project."*
 *
 * ── ⚠️ EVERY NUMBER IN THE REPORT COMES FROM HERE, AND ONLY FROM HERE ─────────
 * The report is composed with help from a language model. The model writes
 * SENTENCES; it is never asked to add anything up. An LLM asked to total a column
 * is occasionally wrong and always confident, and a board report is the last place
 * for that. So the arithmetic is SQL, and the prose is downstream of it.
 *
 * ── THE MONTH IS A PARAMETER, NOT `current_date` ──────────────────────────────
 * A report run on the 2nd about last month must be able to say so. Every count is
 * bounded by the passed month, which also makes the query testable against a fixed
 * period rather than against whenever it happens to run.
 *
 * ── COUNTED ON `published_on` ─────────────────────────────────────────────────
 * Not on completion. A reel finished on Monday and posted on Friday belongs to
 * Friday, and therefore to Friday's month. Counting completion would misfile
 * deliverables at every month boundary, invisibly.
 * ========================================================================= */

export interface ReportProjectRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly clientKind: 'internal' | 'external' | null;
  readonly clientName: string | null;
  readonly packageName: string | null;
  readonly status: string;
  readonly ownerName: string | null;
  readonly monthlyFeePkr: number | null;
  readonly assetsTargetMin: number | null;
  readonly assetsTargetMax: number | null;
  readonly reelsTargetMin: number | null;
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  /** Named on the project, not merely holding a task — migration 033. */
  readonly team: readonly string[];
  readonly platforms: readonly string[];
  /** Placements with a live URL, so the report can say how much is verifiable. */
  readonly liveLinks: number;
}

export interface ReportPersonRow {
  readonly name: string;
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  readonly projectCount: number;
}

export interface ReportPlatformRow {
  readonly name: string;
  readonly placements: number;
  readonly withLinks: number;
}

export interface CeoReportData {
  /** 'YYYY-MM-01' — the first day of the month reported on. */
  readonly monthStart: string;
  readonly projects: readonly ReportProjectRow[];
  readonly people: readonly ReportPersonRow[];
  readonly platforms: readonly ReportPlatformRow[];
}

/**
 * Everything the report needs, for one month, in three queries.
 *
 * Runs as the caller, so row-level security applies: a Coordinator sees every
 * project and a Member would see only their own. That is deliberate — the report
 * is not a privileged view, it is the same data arranged differently, and a report
 * that showed a Member more than the application does would be a leak.
 */
export async function ceoReportData(
  actorId: string,
  monthStart: string,
): Promise<CeoReportData> {
  return withUser(actorId, async (tx) => {
    /* One row per project, with its agreed targets and what actually went out.
       `filter (where …)` rather than three correlated subqueries: one pass over
       the tasks for each project instead of three. */
    const projects = await tx`
      select
        p.id, p.name, p.code, p.status, p.client_kind, p.monthly_fee_pkr,
        p.assets_target_min, p.assets_target_max, p.reels_target_min,
        c.name  as client_name,
        pk.name as package_name,
        u.full_name as owner_name,
        coalesce((
          select array_agg(mu.full_name order by m.role, mu.full_name)
            from public.project_members m
            join public.users mu on mu.id = m.user_id
           where m.project_id = p.id
        ), '{}') as team,
        coalesce((
          select array_agg(pl.name order by pl.sort_order)
            from public.project_platforms pp
            join public.platforms pl on pl.id = pp.platform_id
           where pp.project_id = p.id
        ), '{}') as platforms,
        (
          select count(*) from public.tasks t
           where t.project_id = p.id and not t.is_deleted
             and t.content_kind is not null
             and t.published_on >= ${monthStart}::date
             and t.published_on <  (${monthStart}::date + interval '1 month')
        ) as assets_published,
        (
          select count(*) from public.tasks t
           where t.project_id = p.id and not t.is_deleted
             and t.content_kind = 'reel'
             and t.published_on >= ${monthStart}::date
             and t.published_on <  (${monthStart}::date + interval '1 month')
        ) as reels_published,
        (
          select count(*) from public.task_placements tp
            join public.tasks t on t.id = tp.task_id
           where t.project_id = p.id and not t.is_deleted
             and tp.url is not null
             and tp.published_on >= ${monthStart}::date
             and tp.published_on <  (${monthStart}::date + interval '1 month')
        ) as live_links
      from public.projects p
      left join public.clients  c  on c.id  = p.client_id
      left join public.packages pk on pk.id = p.package_id
      left join public.users    u  on u.id  = p.owner_id
      where p.status not in ('archived', 'cancelled')
      order by p.client_kind nulls last, p.name
    `;

    /* Who published what. Attributed to the ASSIGNEE — the person who did it —
       not the creator, who is usually the coordinator raising the task. */
    const people = await tx`
      select u.full_name as name,
             count(*) as assets_published,
             count(*) filter (where t.content_kind = 'reel') as reels_published,
             count(distinct t.project_id) as project_count
        from public.tasks t
        join public.users u on u.id = t.assignee_id
       where not t.is_deleted
         and t.content_kind is not null
         and t.published_on >= ${monthStart}::date
         and t.published_on <  (${monthStart}::date + interval '1 month')
       group by u.full_name
       order by count(*) desc, u.full_name
    `;

    /* Reach per platform. Counted from PLACEMENTS, which is the one place that is
       correct — an asset cross-posted four times is one asset and four
       placements, and "how many posts went to Instagram" is the placement
       question. */
    const platforms = await tx`
      select pl.name,
             count(*) as placements,
             count(*) filter (where tp.url is not null) as with_links
        from public.task_placements tp
        join public.platforms pl on pl.id = tp.platform_id
        join public.tasks t on t.id = tp.task_id
       where not t.is_deleted
         and tp.published_on >= ${monthStart}::date
         and tp.published_on <  (${monthStart}::date + interval '1 month')
       group by pl.name, pl.sort_order
       order by count(*) desc, pl.sort_order
    `;

    return {
      monthStart,
      projects: projects.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        code: r.code as string,
        status: r.status as string,
        clientKind: (r.client_kind as 'internal' | 'external' | null) ?? null,
        clientName: (r.client_name as string | null) ?? null,
        packageName: (r.package_name as string | null) ?? null,
        ownerName: (r.owner_name as string | null) ?? null,
        monthlyFeePkr:
          r.monthly_fee_pkr === null || r.monthly_fee_pkr === undefined
            ? null
            : Number(r.monthly_fee_pkr),
        /* ⚠️ null and 0 stay distinct: null is "nothing agreed", 0 is "agreed to
           publish nothing", and the verdict differs. */
        assetsTargetMin: r.assets_target_min === null ? null : Number(r.assets_target_min),
        assetsTargetMax: r.assets_target_max === null ? null : Number(r.assets_target_max),
        reelsTargetMin: r.reels_target_min === null ? null : Number(r.reels_target_min),
        assetsPublished: Number(r.assets_published ?? 0),
        reelsPublished: Number(r.reels_published ?? 0),
        team: (r.team as string[] | null) ?? [],
        platforms: (r.platforms as string[] | null) ?? [],
        liveLinks: Number(r.live_links ?? 0),
      })),
      people: people.map((r) => ({
        name: (r.name as string | null) ?? 'Unknown',
        assetsPublished: Number(r.assets_published ?? 0),
        reelsPublished: Number(r.reels_published ?? 0),
        projectCount: Number(r.project_count ?? 0),
      })),
      platforms: platforms.map((r) => ({
        name: r.name as string,
        placements: Number(r.placements ?? 0),
        withLinks: Number(r.with_links ?? 0),
      })),
    };
  });
}
