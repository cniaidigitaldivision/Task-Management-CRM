import 'server-only';

import { withUser } from '@/lib/db/client';
import { isoWeekBounds, type ContentCounts } from '@/lib/domain/content-tracker';

/* ============================================================================
 * WHAT A PROJECT ALREADY HAS, FOR THE TRACKER TO COMPARE AGAINST
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"you will put a tracker that will just check whether a one
 * static post task today is created or not related to this project, right? If
 * someone of the project of the team members who is working in that project is
 * created a static post at that day. For example… on a three September, someone
 * created a task of a static post. If one member created, then that will be
 * log. No other static post task will be created for that project on a same day
 * by any other member of that project."*
 *
 * ── ⚠️ COUNTED FROM EVERY MEMBER'S WORK, NOT THE CALLER'S ───────────────────
 * The whole point is that ONE person's static post settles the day for the
 * WHOLE project. Since migration 084 a Member can no longer see a colleague's
 * task, so a count run through their own eyes would return zero for a day
 * somebody else had already covered — and the cap would never fire.
 *
 * So the count deliberately does NOT ask "what can you see". It asks "what does
 * this project have", through `app.count_project_content`, which is
 * SECURITY DEFINER for exactly that reason. It returns COUNTS AND NAMES ONLY —
 * never a task id, never a title — so it cannot become a way to read a
 * colleague's work. Migration 087 has the argument in full.
 * ========================================================================= */

/**
 * Static posts on `day` and reels in `day`'s ISO week, for one project.
 *
 * The window is computed here rather than in SQL so that the tracker, the cap
 * and this query all agree on where a week starts — `isoWeekBounds` is
 * Monday-first, like every other week in the product.
 */
export async function contentCountsFor(
  actorId: string,
  projectId: string,
  day: string,
): Promise<ContentCounts> {
  const week = isoWeekBounds(day);

  const rows = await withUser(
    actorId,
    (tx) => tx`
      select static_on_day, reels_in_week, static_raised_by, reels_raised_by
        from app.count_project_content(${projectId}::uuid, ${day}::date,
                                       ${week.from}::date, ${week.to}::date)
    `,
  );

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    staticOnDay: Number(row.static_on_day ?? 0),
    reelsInWeek: Number(row.reels_in_week ?? 0),
    staticRaisedBy: (row.static_raised_by as string[] | null) ?? [],
    reelsRaisedBy: (row.reels_raised_by as string[] | null) ?? [],
  };
}

/** One row per project, for the "owed today" list on My Work. */
export interface ProjectCadenceRow {
  readonly projectId: string;
  readonly projectName: string;
  readonly staticPostsPerDay: number | null;
  readonly reelsPerWeek: number | null;
  readonly reelDays: readonly number[];
  readonly postingDays: readonly number[];
  readonly counts: ContentCounts;
}

/**
 * Every project the caller is a member of, with its rhythm and today's counts.
 *
 * ⚠️ Membership, not visibility. A person's own projects are the ones they are
 * on the team of — `project_members`, the same table the Team tab writes and
 * `app.project_is_visible` already consults. Basing this on task visibility
 * would show an Admin every project in the division on their own to-do list.
 */
export async function projectsOwingToday(
  actorId: string,
  day: string,
): Promise<ProjectCadenceRow[]> {
  const week = isoWeekBounds(day);

  const rows = await withUser(
    actorId,
    (tx) => tx`
      select p.id, p.name, p.static_posts_per_day, p.reels_per_week,
             p.reel_days, p.posting_days,
             c.static_on_day, c.reels_in_week, c.static_raised_by, c.reels_raised_by
        from public.projects p
        join public.project_members m
          on m.project_id = p.id and m.user_id = ${actorId}
        cross join lateral app.count_project_content(
          p.id, ${day}::date, ${week.from}::date, ${week.to}::date
        ) c
       where p.status = 'active'
         and p.is_draft = false
         /* No agreed rhythm means nothing is owed — a website build or a one-off
            event has no daily number to miss. */
         and (p.static_posts_per_day is not null or p.reels_per_week is not null)
       order by p.name
    `,
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    projectId: row.id as string,
    projectName: row.name as string,
    staticPostsPerDay:
      row.static_posts_per_day === null || row.static_posts_per_day === undefined
        ? null
        : Number(row.static_posts_per_day),
    reelsPerWeek:
      row.reels_per_week === null || row.reels_per_week === undefined
        ? null
        : Number(row.reels_per_week),
    reelDays: ((row.reel_days as number[] | null) ?? []).map(Number),
    postingDays: ((row.posting_days as number[] | null) ?? []).map(Number),
    counts: {
      staticOnDay: Number(row.static_on_day ?? 0),
      reelsInWeek: Number(row.reels_in_week ?? 0),
      staticRaisedBy: (row.static_raised_by as string[] | null) ?? [],
      reelsRaisedBy: (row.reels_raised_by as string[] | null) ?? [],
    },
  }));
}
