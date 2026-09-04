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

/**
 * Everything the Meta Accounts tab shows about one connection.
 *
 * ⚠️ IT REPORTS THE COLLECTION, NOT JUST THE LINK. An account row on its own can
 * only say "connected"; what somebody opening this tab actually needs to know is
 * whether data is still arriving — so the counts of metric rows, posts and sync
 * attempts are joined in. A connection that linked cleanly in August and has
 * failed every night since looks identical to a healthy one without them.
 */
export interface AccountDetail {
  readonly id: string;
  readonly platform: string;
  readonly objectId: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly permalink: string | null;
  readonly followers: number | null;
  readonly mediaCount: number | null;
  readonly linkedAt: string;
  readonly linkedBy: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly metricDays: number;
  readonly postCount: number;
  readonly firstMetricDate: string | null;
  readonly lastMetricDate: string | null;
  readonly syncRuns: number;
  readonly failedRuns: number;
  /**
   * Daily follower level, oldest first — the sparkline under "Followers".
   *
   * ⚠️ TWO DIFFERENT METRIC KEYS MEAN THE SAME THING. Facebook reports
   * `page_follows` and Instagram `followers_count`, so the query coalesces them
   * rather than the caller having to know which platform it is holding.
   */
  readonly followerSeries: readonly number[];
  /** Posts published per day, oldest first. */
  readonly postSeries: readonly number[];
  /** The dates that have any metric row at all — reveals gaps in coverage. */
  readonly coveredDates: readonly string[];
}

export async function accountDetailsForProject(
  actorId: string,
  projectId: string,
): Promise<AccountDetail[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, pl.slug as platform, a.meta_object_id, a.username, a.display_name,
           a.permalink, a.followers, a.media_count,
           a.linked_at, u.full_name as linked_by,
           a.last_synced_at, a.last_error,
           (select count(distinct d.on_date) from public.meta_metric_days d
             where d.meta_account_id = a.id)                        as metric_days,
           (select min(d.on_date) from public.meta_metric_days d
             where d.meta_account_id = a.id)                        as first_metric,
           (select max(d.on_date) from public.meta_metric_days d
             where d.meta_account_id = a.id)                        as last_metric,
           (select count(*) from public.meta_posts p
             where p.meta_account_id = a.id)                        as post_count,
           (select count(*) from public.meta_sync_runs r
             where r.meta_account_id = a.id)                        as sync_runs,
           (select count(*) from public.meta_sync_runs r
             where r.meta_account_id = a.id and r.outcome = 'failed') as failed_runs
      from public.meta_accounts a
      join public.platforms pl on pl.id = a.platform_id
      left join public.users u on u.id = a.linked_by_id
     where a.project_id = ${projectId} and a.is_active
     order by pl.sort_order
  `);

  const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

  /* ── ⚠️ THE SERIES COME FROM TWO GROUPED QUERIES, NOT N+1 ────────────────
     Three sparklines on each of two cards is six series. Fetching them per
     account would be six round trips to Singapore for one tab — the mistake
     `/finance` already makes with its ~27 queries a load. These are two queries
     regardless of how many accounts a project has. */
  const ids = (rows as Array<Record<string, unknown>>).map((r) => String(r.id));

  const [followerRows, postRows] = ids.length === 0
    ? [[], []]
    : await Promise.all([
        withUser(actorId, (tx) => tx`
          select d.meta_account_id, d.on_date, d.value
            from public.meta_metric_days d
           where d.meta_account_id = any(${ids}::uuid[])
             and d.metric_key in ('page_follows', 'followers_count')
           order by d.on_date
        `),
        withUser(actorId, (tx) => tx`
          select p.meta_account_id,
                 (p.posted_at at time zone 'Asia/Karachi')::date as on_date,
                 count(*)::int as n
            from public.meta_posts p
           where p.meta_account_id = any(${ids}::uuid[])
           group by 1, 2
           order by 2
        `),
      ]);

  const byAccount = <T,>(list: readonly Record<string, unknown>[], pick: (r: Record<string, unknown>) => T) => {
    const map = new Map<string, T[]>();
    for (const r of list) {
      const key = String(r.meta_account_id);
      const bucket = map.get(key) ?? [];
      bucket.push(pick(r));
      map.set(key, bucket);
    }
    return map;
  };

  const followers = byAccount(followerRows as Record<string, unknown>[], (r) => Number(r.value));
  const dates = byAccount(followerRows as Record<string, unknown>[], (r) =>
    new Date(r.on_date as string).toISOString().slice(0, 10),
  );
  const posts = byAccount(postRows as Record<string, unknown>[], (r) => Number(r.n));

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    platform: String(r.platform),
    objectId: String(r.meta_object_id),
    username: (r.username as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    permalink: (r.permalink as string | null) ?? null,
    followers: r.followers === null ? null : Number(r.followers),
    mediaCount: r.media_count === null ? null : Number(r.media_count),
    linkedAt: new Date(r.linked_at as string).toISOString(),
    linkedBy: (r.linked_by as string | null) ?? null,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at as string).toISOString() : null,
    lastError: (r.last_error as string | null) ?? null,
    metricDays: Number(r.metric_days ?? 0),
    postCount: Number(r.post_count ?? 0),
    firstMetricDate: day(r.first_metric),
    lastMetricDate: day(r.last_metric),
    syncRuns: Number(r.sync_runs ?? 0),
    failedRuns: Number(r.failed_runs ?? 0),
    followerSeries: followers.get(String(r.id)) ?? [],
    postSeries: posts.get(String(r.id)) ?? [],
    coveredDates: dates.get(String(r.id)) ?? [],
  }));
}

/* ============================================================================
 * THE TWO META CSV EXPORTS — the Studio's Reports & Exports tab, 2026-09-04
 * ----------------------------------------------------------------------------
 * ⚠️ THESE RETURN ROWS ALREADY SHAPED FOR A SPREADSHEET, and that is why they
 * are here rather than reusing `metricsForProject` and `postsForProject`. Those
 * two are shaped for CHARTS — a metric series keyed for a line, posts narrowed
 * to what a card shows. A spreadsheet wants the opposite: one flat row per
 * observation, every column present, nothing pivoted, and the account named on
 * every line so the file makes sense on its own once it has left the building.
 * ========================================================================= */

/** One row per account per day per metric, oldest first. */
export async function metaMetricRowsForExport(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<readonly (readonly (string | number)[])[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select d.on_date,
             coalesce(a.display_name, a.username, a.meta_object_id) as account,
             p.slug          as platform,
             d.metric_key,
             coalesce(c.label, d.metric_key) as metric_label,
             d.value
        from public.meta_metric_days d
        join public.meta_accounts a on a.id = d.meta_account_id
        join public.platforms     p on p.id = a.platform_id
        left join public.meta_metric_catalogue c on c.metric_key = d.metric_key
       where a.project_id = ${projectId}::uuid
         and d.on_date between ${from}::date and ${to}::date
       order by d.on_date, account, d.metric_key
    `;
    return rows.map((r) => [
      /* ⚠️ `toISOString().slice(0,10)` — postgres.js hands a `date` back as a JS
         Date at UTC midnight, and any local formatting shifts a Karachi date
         back a day for five hours each evening. */
      r.on_date instanceof Date
        ? r.on_date.toISOString().slice(0, 10)
        : String(r.on_date),
      r.account as string,
      r.platform as string,
      r.metric_key as string,
      r.metric_label as string,
      Number(r.value ?? 0),
    ]);
  });
}

/** One row per collected post with its metrics flattened out. */
export async function metaPostRowsForExport(
  actorId: string,
  projectId: string,
): Promise<readonly (readonly (string | number)[])[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select po.posted_at,
             coalesce(a.display_name, a.username, a.meta_object_id) as account,
             p.slug              as platform,
             po.media_product_type,
             po.media_type,
             po.caption,
             po.permalink,
             m.reach, m.views, m.likes, m.comments, m.shares, m.saves,
             m.total_interactions
        from public.meta_posts po
        join public.meta_accounts a on a.id = po.meta_account_id
        join public.platforms     p on p.id = a.platform_id
        left join public.meta_post_metrics m on m.meta_post_id = po.id
       where a.project_id = ${projectId}::uuid
       order by po.posted_at desc
    `;
    return rows.map((r) => {
      const reach = r.reach === null || r.reach === undefined ? null : Number(r.reach);
      const inter =
        r.total_interactions === null || r.total_interactions === undefined
          ? null
          : Number(r.total_interactions);

      return [
        r.posted_at instanceof Date ? r.posted_at.toISOString() : String(r.posted_at ?? ''),
        r.account as string,
        r.platform as string,
        (r.media_product_type as string | null) ?? '',
        (r.media_type as string | null) ?? '',
        /* ⚠️ NEWLINES FLATTENED. `toCsv` quotes correctly, so a multi-line
           caption is valid CSV — but Excel still shows it as a row that spills
           over several visible lines and makes the sheet unreadable. */
        ((r.caption as string | null) ?? '').replace(/\s*\n+\s*/g, ' ').trim(),
        (r.permalink as string | null) ?? '',
        reach ?? '',
        r.views === null || r.views === undefined ? '' : Number(r.views),
        r.likes === null || r.likes === undefined ? '' : Number(r.likes),
        r.comments === null || r.comments === undefined ? '' : Number(r.comments),
        r.shares === null || r.shares === undefined ? '' : Number(r.shares),
        r.saves === null || r.saves === undefined ? '' : Number(r.saves),
        inter ?? '',
        /* ⚠️ BLANK, NOT ZERO, WHEN REACH IS UNKNOWN. A rate of 0% is a claim
           that nobody engaged; an empty cell says we do not know, which is what
           a missing reach actually means. */
        reach && reach > 0 && inter !== null ? `${((inter / reach) * 100).toFixed(2)}%` : '',
      ];
    });
  });
}
