import { withUser } from '@/lib/db/client';
/* ⚠️ THE TYPES LIVE IN THE DOMAIN LAYER, AND THE ARROW POINTS THIS WAY ROUND.
   `lib/domain/` may not import from `lib/db/` — docs/20 §1, enforced by eslint —
   so the domain owns the vocabulary and this file produces it. A first draft had
   it backwards and the rule caught it. */
import type { ContentDraft } from '@/lib/domain/meta-content';
import type {
  MetricPoint,
  StudioAccount,
  StudioPost,
  StudioProject,
} from '@/lib/domain/meta-studio';

export type { ContentDraft, MetricPoint, StudioAccount, StudioPost, StudioProject };

/* ============================================================================
 * WHAT THE STUDIO READS
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY QUERY HERE READS TASKLY'S OWN TABLES AND NEVER CALLS META. Owner,
 * 2026-09-04: *"I will not fetch live things from the database each time… We
 * will fetch data from the database and show and draw a graph there."*
 *
 * That is not only a preference — it is what stops a slow or failing Graph API
 * from making this page slow or broken. Meta being down makes the Studio
 * *stale*, and the account's `last_error` says so.
 *
 * ── ⚠️ EVERYTHING GOES THROUGH `withUser`, SO RLS APPLIES ───────────────────
 * The opposite of the sync, which runs with no identity and needs SECURITY
 * DEFINER readers (migrations 094/095). Here there IS a signed-in person, so the
 * policies do exactly the right thing: a Coordinator sees the projects they can
 * see, and nobody sees a client they have no business seeing. Do not reach for
 * `withAppRole` in this file.
 * ========================================================================= */


/**
 * Every project the reader may see, flagged by whether it has Meta accounts.
 *
 * ⚠️ RETURNS ALL VISIBLE PROJECTS, not only linked ones. The dropdown lists them
 * all so an unlinked project can say "coming soon" — owner: *"when I select
 * other projects from the drop-down then show 'It's coming soon' type of a
 * message."* Filtering them out here would make the dropdown silently short and
 * leave somebody wondering where their project went.
 */
export async function listStudioProjects(actorId: string): Promise<StudioProject[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select p.id, p.name, p.code,
           exists (select 1 from public.meta_accounts a
                    where a.project_id = p.id and a.is_active) as has_accounts
      from public.projects p
     where p.is_draft = false
     order by has_accounts desc, p.name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: String(r.code),
    hasAccounts: Boolean(r.has_accounts),
  }));
}

export async function accountsForProject(
  actorId: string,
  projectId: string,
): Promise<StudioAccount[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, pl.slug as platform, a.username, a.display_name, a.permalink,
           a.followers, a.media_count, a.last_synced_at, a.last_error
      from public.meta_accounts a
      join public.platforms pl on pl.id = a.platform_id
     where a.project_id = ${projectId} and a.is_active
     order by pl.sort_order
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    platform: String(r.platform),
    username: (r.username as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    permalink: (r.permalink as string | null) ?? null,
    followers: r.followers === null ? null : Number(r.followers),
    mediaCount: r.media_count === null ? null : Number(r.media_count),
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at as string).toISOString() : null,
    lastError: (r.last_error as string | null) ?? null,
  }));
}

/**
 * The daily series for a project across a date range.
 *
 * ⚠️ ONE QUERY FOR EVERY METRIC AND BOTH PLATFORMS. The shaping into cards and
 * charts happens in `lib/domain/meta-studio.ts`, which is pure and testable. A
 * query per panel would be a dozen round trips to Singapore for one page — the
 * mistake `/finance` already makes with its ~27 queries per load.
 */
export async function metricsForProject(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<MetricPoint[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.on_date, pl.slug as platform, d.metric_key, d.value
      from public.meta_metric_days d
      join public.meta_accounts a on a.id = d.meta_account_id
      join public.platforms pl on pl.id = a.platform_id
     where a.project_id = ${projectId}
       and a.is_active
       and d.on_date between ${from} and ${to}
     order by d.on_date
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    /* ⚠️ `toISOString().slice(0,10)`, never `String(date).slice(0,10)`. postgres.js
       hands back a `date` column as a JS Date at UTC midnight, and stringifying
       that yields "Wed Sep 02 2026 …" — the trap that made the repeat runner
       silently create nothing every night. */
    onDate: new Date(r.on_date as string).toISOString().slice(0, 10),
    platform: String(r.platform),
    metricKey: String(r.metric_key),
    value: Number(r.value),
  }));
}

/** Posts in the range, newest first, with whatever metrics were reported. */
export async function postsForProject(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<StudioPost[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select p.id, pl.slug as platform, p.posted_at, p.caption,
           p.media_product_type, p.media_type, p.permalink, p.thumbnail_url,
           m.reach, m.views, m.likes, m.comments, m.shares, m.saves,
           m.total_interactions
      from public.meta_posts p
      join public.meta_accounts a on a.id = p.meta_account_id
      join public.platforms pl on pl.id = a.platform_id
      left join public.meta_post_metrics m on m.meta_post_id = p.id
     where a.project_id = ${projectId}
       and a.is_active
       and (p.posted_at at time zone 'Asia/Karachi')::date between ${from} and ${to}
     order by p.posted_at desc
  `);

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    platform: String(r.platform),
    postedAt: new Date(r.posted_at as string).toISOString(),
    caption: (r.caption as string | null) ?? null,
    mediaProductType: (r.media_product_type as string | null) ?? null,
    mediaType: (r.media_type as string | null) ?? null,
    permalink: (r.permalink as string | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    reach: num(r.reach),
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    saves: num(r.saves),
    totalInteractions: num(r.total_interactions),
  }));
}

/**
 * The project's agreed promise — what the client was actually sold.
 *
 * ⚠️ THE MONTHLY ASSET AND REEL TARGETS ARE THE POINT, not the daily rhythm.
 * Owner: *"it's a target, or the promise of that project: how many assets we
 * will provide, how many posts, and how many reels we will provide."*
 *
 * An earlier version read only `static_posts_per_day` and `reels_per_week` and
 * multiplied them out to a single blended number — 43 posts. That is a
 * DERIVED figure, and it hid the two numbers the contract is actually written
 * in: this project promises 36–42 assets and 12 reels a month. Delivering 50
 * posts while being three reels short is a fact the blended number cannot state.
 */
export async function cadenceForProject(
  actorId: string,
  projectId: string,
): Promise<{
  staticPerDay: number | null;
  reelsPerWeek: number | null;
  assetsMin: number | null;
  assetsMax: number | null;
  reelsMin: number | null;
}> {
  const rows = await withUser(actorId, (tx) => tx`
    select static_posts_per_day, reels_per_week,
           assets_target_min, assets_target_max, reels_target_min
      from public.projects where id = ${projectId}
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    staticPerDay: num(r?.static_posts_per_day),
    reelsPerWeek: num(r?.reels_per_week),
    assetsMin: num(r?.assets_target_min),
    assetsMax: num(r?.assets_target_max),
    reelsMin: num(r?.reels_target_min),
  };
}

/**
 * Content work that is planned but not yet published, inside the window.
 *
 * ⚠️ FROM TASKLY'S OWN TASKS, NOT FROM META — Meta has no concept of a post that
 * has not happened. It is the one figure available here that comes from the
 * division's own plan rather than from the platform, which is what lets a screen
 * distinguish "we are behind" from "we are behind and nothing is even written
 * yet".
 *
 * ⚠️ CURRENTLY UNUSED BY THE STUDIO. It fed the Delivery Progress card, which the
 * owner removed on 2026-09-04. Kept because the Content & Posts tab needs exactly
 * this and it is four lines; delete it if that tab lands without needing it.
 */
export async function scheduledForProject(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*)::int as n
      from public.tasks t
     where t.project_id = ${projectId}
       and t.deleted_at is null
       and t.content_kind is not null
       and t.status <> 'done'
       and t.due_date between ${from} and ${to}
  `);
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
}

/**
 * Content planned but not yet published — the Drafts tab.
 *
 * ⚠️ TASKLY'S OWN TASKS, NOT META. Meta has no concept of a post that has not
 * happened, so this is the only place the division's intent is visible beside
 * its output. Without it the Content tab could only show what already went out,
 * which is the half a coordinator does not need to be told about.
 *
 * ⚠️ NOT WINDOWED BY `due_date` the way `scheduledForProject` is: a draft whose
 * due date has passed is exactly the one worth seeing, and filtering to the
 * selected period would quietly hide it.
 */
export async function draftsForProject(
  actorId: string,
  projectId: string,
): Promise<ContentDraft[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.content_kind, t.due_date, t.status,
           u.full_name as assignee_name
      from public.tasks t
      left join public.users u on u.id = t.assignee_id
     where t.project_id = ${projectId}
       and t.deleted_at is null
       and t.content_kind is not null
       and t.status <> 'done'
     order by t.due_date nulls last, t.created_at
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    reference: String(r.reference),
    title: String(r.title),
    kind: (r.content_kind as string | null) ?? null,
    /* postgres.js hands a `date` back as a Date at UTC midnight — stringifying
       it yields "Wed Sep 02 2026", which is the trap that silently broke the
       repeat runner. */
    dueDate: r.due_date ? new Date(r.due_date as string).toISOString().slice(0, 10) : null,
    assigneeName: (r.assignee_name as string | null) ?? null,
    status: String(r.status),
  }));
}
