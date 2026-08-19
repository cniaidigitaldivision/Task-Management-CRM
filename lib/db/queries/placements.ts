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
