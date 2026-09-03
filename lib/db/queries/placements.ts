import 'server-only';

import type { ContentKind } from '@/lib/domain/constants';

import { withUser } from '../client';
import { dateOnly } from '../row-values';

/* ============================================================================
 * WHERE A DELIVERABLE WAS PUBLISHED — migration 034
 * ----------------------------------------------------------------------------
 * The coordinator's sheet keeps a column per destination: Facebook post link,
 * Facebook reel link, Instagram post link, Instagram reel link, TikTok, YouTube.
 * These are those columns, as rows.
 *
 * Owner, 2026-08-19: *"When I give a report to a super admin, he can click on
 * that link and directly go to that page or that exact post."* That sentence is
 * why the table exists at all — a count is a claim, a link is evidence.
 *
 * ── ⚠️ NEVER COUNT ASSETS FROM THIS TABLE ────────────────────────────────────
 * One video cross-posted to four platforms is ONE asset (owner's rule) and four
 * rows here. Counting rows would inflate every project's progress against its
 * package target three- or fourfold. Asset counts come from `tasks`.
 *
 * ── VISIBILITY AND WRITES BOTH FOLLOW THE TASK ───────────────────────────────
 * `app.task_is_visible` decides reads, and writes are open to anybody who can
 * see the task — the person who published it is usually the assignee, and making
 * them ask a coordinator to paste a link is how links stop being recorded.
 * ========================================================================= */

export interface PlacementRow {
  readonly id: string;
  readonly taskId: string;
  readonly platformId: string;
  readonly platformName: string;
  readonly platformSlug: string;
  /** What it was published AS here — a video is a "post" in the Facebook feed
   *  and a "reel" in Facebook Reels. Two placements, two links. */
  readonly contentKind: ContentKind;
  readonly url: string | null;
  readonly publishedOn: string | null;
  readonly notes: string | null;
}

function toRow(row: Record<string, unknown>): PlacementRow {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    platformId: row.platform_id as string,
    platformName: (row.platform_name as string | null) ?? 'Unknown',
    platformSlug: (row.platform_slug as string | null) ?? '',
    contentKind: row.content_kind as ContentKind,
    url: (row.url as string | null) ?? null,
    publishedOn: dateOnly(row.published_on),
    notes: (row.notes as string | null) ?? null,
  };
}

export async function listPlacements(
  actorId: string,
  taskId: string,
): Promise<PlacementRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select tp.*, pl.name as platform_name, pl.slug as platform_slug
      from public.task_placements tp
      join public.platforms pl on pl.id = tp.platform_id
     where tp.task_id = ${taskId}
     order by pl.sort_order, tp.content_kind
  `);
  return rows.map((r) => toRow(r as Record<string, unknown>));
}

/**
 * Add a destination, or update the one already there.
 *
 * Upserted on (task, platform, content_kind) — the table's own unique key. That
 * is deliberate rather than an insert that can fail: the realistic sequence is
 * "plan the Facebook reel today, paste its link on Friday", which is the same
 * row twice, not an error.
 */
export async function upsertPlacement(
  actorId: string,
  input: {
    taskId: string;
    platformId: string;
    contentKind: ContentKind;
    url?: string | null;
    publishedOn?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.task_placements
      (task_id, platform_id, content_kind, url, published_on, notes)
    values (
      ${input.taskId}, ${input.platformId},
      ${input.contentKind}::public.content_kind,
      ${input.url?.trim() || null},
      ${input.publishedOn || null},
      ${input.notes?.trim() || null}
    )
    on conflict (task_id, platform_id, content_kind) do update
       set url          = excluded.url,
           published_on = excluded.published_on,
           notes        = excluded.notes
  `);
}

export async function removePlacement(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.task_placements where id = ${id} returning id
  `);
  return rows.length > 0;
}

/* ============================================================================
 * EVERY PLACEMENT ON A PROJECT'S POSTS, IN ONE READ
 * ----------------------------------------------------------------------------
 * The daily board shows a day's posts with a URL box per platform. Calling
 * `listPlacements` once per task would be one round trip per post — on a project
 * posting twice a day that is a dozen queries to draw one screen, each of them
 * paying the ~100ms to Singapore that `lib/db/client.ts` documents.
 *
 * Bounded by date rather than fetching the project's whole history: a board
 * showing today plus the last week has no use for March.
 * ========================================================================= */
export async function listPlacementsForProject(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<PlacementRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select tp.*, pl.name as platform_name, pl.slug as platform_slug
      from public.task_placements tp
      join public.platforms pl on pl.id = tp.platform_id
      join public.tasks t on t.id = tp.task_id
     where t.project_id = ${projectId}
       and t.is_deleted = false
       and t.due_date between ${from}::date and ${to}::date
     order by pl.sort_order, tp.content_kind
  `);
  return rows.map((r) => toRow(r as Record<string, unknown>));
}

/**
 * Every platform a task reached, for every task the reader can see.
 *
 * ── WHY A SEPARATE QUERY AND NOT A COLUMN ON `TaskRow` ───────────────────────
 * The Platform filter on the reports page needs the slugs per task, and
 * `listTasks` is used by six screens that do not. Aggregating a subquery onto the
 * task list to serve one page would make every task query pay for it — and
 * `TaskRow` already carries `placementCount`, which is what the others actually
 * want.
 *
 * ── ⚠️ ONE QUERY, NOT ONE PER TASK ──────────────────────────────────────────
 * A report covers up to 5000 tasks. Asking per task would be 5000 round trips
 * for a filter dropdown, so this returns the whole visible set at once and the
 * caller indexes it. RLS (`app.task_is_visible`, via the join on `tasks`) narrows
 * it to what the reader may see, exactly as `listPlacements` does — so there is
 * no `if` here deciding scope, which is ADR-003's whole point.
 *
 * Returns a Map so the caller does no grouping. Absent means no placements, which
 * is the common case for anything unpublished — the caller should read a missing
 * key as an empty list, not as unknown.
 */
/** One placement, with enough to name it and open it. */
export interface TaskLink {
  readonly slug: string;
  readonly platformName: string;
  /** Null where the destination is recorded but the link has not been. */
  readonly url: string | null;
}

/**
 * Every placement, grouped by task, with its platform name and live link.
 *
 * ── ⚠️ WHY THIS EXISTS BESIDE `platformSlugsByTask` ─────────────────────────
 * That one returns slugs, which is all the work report's Platform column needs —
 * it draws icons. Owner, 2026-09-03, asked the report's row detail to show
 * *"these are the platforms, these are the platform URLs"*, and a slug cannot
 * be opened or read aloud.
 *
 * Kept as a separate function rather than widening the other: the table renders
 * for every row on every load and wants the narrow shape, while this is read
 * once for a detail panel. Making the common path carry the rare path's columns
 * is how a list query gets slow.
 */
export async function placementLinksByTask(actorId: string): Promise<Map<string, TaskLink[]>> {
  const rows = await withUser(actorId, (tx) => tx`
    select tp.task_id, pl.slug, pl.name, tp.url
      from public.task_placements tp
      join public.platforms pl on pl.id = tp.platform_id
      join public.tasks t on t.id = tp.task_id
     where t.is_deleted = false
     order by tp.task_id, pl.sort_order
  `);

  const byTask = new Map<string, TaskLink[]>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const id = row.task_id as string;
    const list = byTask.get(id) ?? [];
    list.push({
      slug: row.slug as string,
      platformName: row.name as string,
      url: (row.url as string | null) ?? null,
    });
    byTask.set(id, list);
  }
  return byTask;
}

export async function platformSlugsByTask(actorId: string): Promise<Map<string, string[]>> {
  const rows = await withUser(actorId, (tx) => tx`
    select tp.task_id, pl.slug
      from public.task_placements tp
      join public.platforms pl on pl.id = tp.platform_id
      join public.tasks t on t.id = tp.task_id
     where t.is_deleted = false
     order by tp.task_id, pl.sort_order
  `);

  const byTask = new Map<string, string[]>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const id = row.task_id as string;
    const slug = row.slug as string;
    const list = byTask.get(id);
    /* ⚠️ De-duplicated. A task published to Facebook as both a post and a reel is
       TWO placements on ONE platform, and a filter that matched it twice would be
       harmless while a chart counting slugs would double it. */
    if (!list) byTask.set(id, [slug]);
    else if (!list.includes(slug)) list.push(slug);
  }
  return byTask;
}
