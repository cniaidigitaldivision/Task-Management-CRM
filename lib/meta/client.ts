/* ============================================================================
 * THE META GRAPH CLIENT
 * ----------------------------------------------------------------------------
 * Every call to Meta goes through here. Nothing else in the application may
 * construct a Graph URL or read `META_SYSTEM_USER_TOKEN`.
 *
 * ── ⚠️ EVERYTHING BELOW WAS VERIFIED AGAINST THE LIVE API ON 2026-09-04 ─────
 * Not read from documentation. See docs/meta-integration/01-VERIFIED-API-FACTS.md
 * for the transcript. Three findings shape this whole file, and each one is a
 * silent failure if you get it wrong:
 *
 *   1. FACEBOOK PAGE INSIGHTS REFUSE THE SYSTEM USER TOKEN with
 *      `(#190) This method must be called with a Page Access Token`. Instagram
 *      accepts it directly. So there are two token paths, not one.
 *
 *   2. MOST INSTAGRAM METRICS NEED `metric_type=total_value`, and the answer
 *      then arrives at `data[0].total_value.value` — NOT in the `values[]` array
 *      the other shape uses. Without the parameter Meta returns `(#100)`.
 *
 *   3. FOUR FACEBOOK METRICS ARE DEAD in v26.0 — `page_impressions`,
 *      `page_impressions_unique`, `page_fans`, `page_fan_adds`. They fail with
 *      `(#100) The value must be a valid insights metric`, which reads like a
 *      typo. The catalogue in migration 091 is the allow-list; never hardcode a
 *      metric name here.
 * ========================================================================= */

const GRAPH = 'https://graph.facebook.com';

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/** The API version, from the environment. Never hardcoded — Meta ships a new one
 *  every few months and a version pinned in code is one nobody remembers to move. */
function version(): string {
  const v = process.env.META_API_VERSION?.trim();
  if (!v) throw new MetaApiError('META_API_VERSION is not set.', null, null);
  return v;
}

function systemToken(): string {
  const t = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!t) throw new MetaApiError('META_SYSTEM_USER_TOKEN is not set.', null, null);
  return t;
}

/** True when the integration is configured at all. Lets a screen say "not set
 *  up" instead of throwing on a missing variable. */
export function metaIsConfigured(): boolean {
  return Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim() && process.env.META_API_VERSION?.trim());
}

/* ---- The one request function ------------------------------------------- */

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${version()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url, {
      /* ⚠️ Never cached. Next.js caches `fetch` by default in a server context,
         and a cached insights response would freeze the Studio's numbers at
         whatever the first sync saw. */
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    /* A timeout or DNS failure is not a Meta error — it has no code, and the
       distinction matters to the caller deciding whether to retry. */
    throw new MetaApiError(
      cause instanceof Error ? `Could not reach Meta: ${cause.message}` : 'Could not reach Meta.',
      null,
      null,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: number; error_subcode?: number } }
    | null;

  if (!response.ok || body?.error) {
    const e = body?.error;
    throw new MetaApiError(
      e?.message ?? `Meta returned ${response.status}.`,
      e?.code ?? null,
      e?.error_subcode ?? null,
    );
  }

  return body as T;
}

/* ---- Discovery ----------------------------------------------------------- */

export interface DiscoveredPage {
  readonly pageId: string;
  readonly name: string;
  readonly followers: number | null;
  readonly instagram: {
    readonly igUserId: string;
    readonly username: string;
    readonly name: string | null;
    readonly followers: number | null;
    readonly mediaCount: number | null;
  } | null;
}

/**
 * Every page this token can act on, with any Instagram account attached.
 *
 * ⚠️ `me/businesses` returns EMPTY for a system user token — assets hang off
 * `me/accounts`, not off the business. Verified; do not "fix" it by adding a
 * business lookup.
 */
export async function discoverPages(): Promise<DiscoveredPage[]> {
  const body = await call<{
    data?: Array<{
      id: string;
      name?: string;
      followers_count?: number;
      fan_count?: number;
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        followers_count?: number;
        media_count?: number;
      };
    }>;
  }>('me/accounts', {
    access_token: systemToken(),
    fields:
      'id,name,fan_count,followers_count,' +
      'instagram_business_account{id,username,name,followers_count,media_count}',
    limit: '100',
  });

  return (body.data ?? []).map((p) => ({
    pageId: p.id,
    name: p.name ?? '(unnamed page)',
    followers: p.followers_count ?? p.fan_count ?? null,
    instagram: p.instagram_business_account
      ? {
          igUserId: p.instagram_business_account.id,
          username: p.instagram_business_account.username ?? '',
          name: p.instagram_business_account.name ?? null,
          followers: p.instagram_business_account.followers_count ?? null,
          mediaCount: p.instagram_business_account.media_count ?? null,
        }
      : null,
  }));
}

/**
 * A Page access token, derived from the system user token.
 *
 * ⚠️ NOT CACHED ACROSS RUNS, and not stored. It is one cheap call, the system
 * user token never expires so the derivation always works, and storing it would
 * mean an encrypted secret in a table that has to be kept fresh. See migration
 * 091's header.
 */
export async function pageAccessToken(pageId: string): Promise<string> {
  const body = await call<{ access_token?: string }>(pageId, {
    access_token: systemToken(),
    fields: 'access_token',
  });
  if (!body.access_token) {
    throw new MetaApiError(`No page access token available for ${pageId}.`, null, null);
  }
  return body.access_token;
}

/* ---- Metrics ------------------------------------------------------------- */

export interface DailyValue {
  readonly onDate: string; // yyyy-mm-dd
  readonly metricKey: string;
  readonly value: number;
}

/** How the catalogue says a metric must be fetched. Migration 091. */
export type FetchMode = 'series' | 'total_value' | 'profile';

/**
 * ⚠️ 30 DAYS IS A HARD CAP PER REQUEST.
 * `(#100) There cannot be more than 30 days (2592000 s) between since and until.`
 * Callers wanting more must page backwards in windows; `lib/meta/sync.ts` does.
 */
export const MAX_WINDOW_DAYS = 30;

/**
 * A metric as a daily series. `period=day`, read from `values[]`.
 * Facebook needs a page token here; Instagram accepts the system token.
 */
export async function fetchSeries(
  objectId: string,
  metricKey: string,
  since: string,
  until: string,
  token: string,
): Promise<DailyValue[]> {
  const body = await call<{
    data?: Array<{ name?: string; values?: Array<{ value?: unknown; end_time?: string }> }>;
  }>(`${objectId}/insights`, {
    access_token: token,
    metric: metricKey,
    period: 'day',
    since,
    until,
  });

  const out: DailyValue[] = [];
  for (const entry of body.data ?? []) {
    for (const v of entry.values ?? []) {
      /* ⚠️ Meta returns an OBJECT for breakdown metrics and a number for plain
         ones. Only plain numbers belong in a numeric column; a breakdown stored
         as `[object Object]` is worse than absent. */
      if (typeof v.value !== 'number' || !v.end_time) continue;
      out.push({
        /* `end_time` is the START of the following day in UTC, which is how Meta
           marks a daily bucket. The date part is the day being reported. */
        onDate: v.end_time.slice(0, 10),
        metricKey,
        value: v.value,
      });
    }
  }
  return out;
}

/**
 * A metric that only answers to `metric_type=total_value`.
 *
 * ⚠️ ONE NUMBER FOR THE WHOLE WINDOW, not a series — the result is at
 * `data[0].total_value.value`. So the caller must ask a day at a time to build a
 * daily series, which is what `sync.ts` does for recent days.
 */
export async function fetchTotalValue(
  objectId: string,
  metricKey: string,
  since: string,
  until: string,
  token: string,
): Promise<number | null> {
  const body = await call<{
    data?: Array<{ total_value?: { value?: number } }>;
  }>(`${objectId}/insights`, {
    access_token: token,
    metric: metricKey,
    metric_type: 'total_value',
    period: 'day',
    since,
    until,
  });
  const v = body.data?.[0]?.total_value?.value;
  return typeof v === 'number' ? v : null;
}

/** The Instagram profile's own fields — the follower total that insights refuse
 *  to give on a small account. See the catalogue's `followers_count` note. */
export async function fetchIgProfile(
  igUserId: string,
): Promise<{ followers: number | null; mediaCount: number | null }> {
  const body = await call<{ followers_count?: number; media_count?: number }>(igUserId, {
    access_token: systemToken(),
    fields: 'followers_count,media_count',
  });
  return {
    followers: body.followers_count ?? null,
    mediaCount: body.media_count ?? null,
  };
}

/* ---- Posts --------------------------------------------------------------- */

export interface FetchedPost {
  readonly metaPostId: string;
  readonly postedAt: string;
  readonly caption: string | null;
  readonly mediaType: string | null;
  readonly mediaProductType: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly metrics: Record<string, number | null>;
}

/** Instagram media, newest first, with per-post insights. */
export async function fetchIgPosts(igUserId: string, limit = 25): Promise<FetchedPost[]> {
  const body = await call<{
    data?: Array<{
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
      thumbnail_url?: string;
      media_url?: string;
    }>;
  }>(`${igUserId}/media`, {
    access_token: systemToken(),
    fields:
      'id,caption,media_type,media_product_type,permalink,timestamp,' +
      'like_count,comments_count,thumbnail_url,media_url',
    limit: String(limit),
  });

  const posts: FetchedPost[] = [];
  for (const m of body.data ?? []) {
    if (!m.timestamp) continue;

    /* Per-post insights, one call each. ⚠️ A failure here must not lose the
       post: a story older than 24 hours stops reporting, and an unpublished
       reel refuses entirely. The post is still real and still worth listing. */
    let insights: Record<string, number | null> = {};
    try {
      const ins = await call<{ data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> }>(
        `${m.id}/insights`,
        {
          access_token: systemToken(),
          metric: 'reach,likes,comments,saved,shares,total_interactions,views',
        },
      );
      for (const entry of ins.data ?? []) {
        const v = entry.values?.[0]?.value;
        if (entry.name && typeof v === 'number') insights[entry.name] = v;
      }
    } catch {
      insights = {};
    }

    posts.push({
      metaPostId: m.id,
      postedAt: m.timestamp,
      caption: m.caption ?? null,
      mediaType: m.media_type ?? null,
      mediaProductType: m.media_product_type ?? null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      metrics: {
        reach: insights.reach ?? null,
        views: insights.views ?? null,
        /* The list counts are more reliable than the insight for likes and
           comments, and are present on every post regardless of age. */
        likes: m.like_count ?? insights.likes ?? null,
        comments: m.comments_count ?? insights.comments ?? null,
        shares: insights.shares ?? null,
        saves: insights.saved ?? null,
        total_interactions: insights.total_interactions ?? null,
      },
    });
  }
  return posts;
}

/** Facebook page posts. Requires a PAGE token. */
export async function fetchFbPosts(
  pageId: string,
  pageToken: string,
  limit = 25,
): Promise<FetchedPost[]> {
  const body = await call<{
    data?: Array<{
      id: string;
      message?: string;
      created_time?: string;
      permalink_url?: string;
      full_picture?: string;
      shares?: { count?: number };
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
    }>;
  }>(`${pageId}/posts`, {
    access_token: pageToken,
    fields:
      'id,message,created_time,permalink_url,full_picture,shares,' +
      'likes.summary(true).limit(0),comments.summary(true).limit(0)',
    limit: String(limit),
  });

  return (body.data ?? [])
    .filter((p) => p.created_time)
    .map((p) => ({
      metaPostId: p.id,
      postedAt: p.created_time as string,
      caption: p.message ?? null,
      mediaType: null,
      mediaProductType: 'FEED',
      permalink: p.permalink_url ?? null,
      thumbnailUrl: p.full_picture ?? null,
      metrics: {
        /* ⚠️ `reach`, `views` and `saves` stay NULL for Facebook, deliberately.
           No working page-level reach metric exists in v26.0 and Facebook does
           not report saves. Writing 0 would tell a reader nobody reached or
           saved the post — see migration 093's note on nulls. */
        reach: null,
        views: null,
        likes: p.likes?.summary?.total_count ?? null,
        comments: p.comments?.summary?.total_count ?? null,
        shares: p.shares?.count ?? null,
        saves: null,
        total_interactions: null,
      },
    }));
}
