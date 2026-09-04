import { withAppRole } from '@/lib/db/client';
import { isoDateIn, nowMs } from '@/lib/now';

import {
  MAX_WINDOW_DAYS,
  MetaApiError,
  type DailyValue,
  type FetchedPost,
  fetchFbPosts,
  fetchIgPosts,
  fetchIgProfile,
  fetchSeries,
  fetchTotalValue,
  metaIsConfigured,
  pageAccessToken,
} from './client';

/* ============================================================================
 * THE SYNC
 * ----------------------------------------------------------------------------
 * Pulls each linked account's figures into Taskly's own tables. The Studio then
 * reads only those tables — owner: *"I will not fetch live things from the
 * database each time… We will fetch data from the database and show and draw a
 * graph there."*
 *
 * ── ⚠️ ONE ACCOUNT'S FAILURE MUST NOT STOP THE OTHERS ───────────────────────
 * The single most important property here. A client who revokes access, a page
 * that gets renamed, a token that loses a scope — each must produce ONE named
 * failure row and leave every other account synced. A sync that dies on the
 * first bad account means one broken client silently freezes everybody's
 * numbers, and the Studio would show stale data with no indication why.
 *
 * ── ⚠️ WHY IT RE-READS RECENT DAYS EVERY TIME ───────────────────────────────
 * Meta revises figures for a day or two after the fact — a reach number read at
 * 2pm is not final. So every run re-reads a trailing window and upserts, which
 * is safe because `app.record_meta_sync` is keyed to correct rather than
 * duplicate (migration 092's self-check asserts exactly this).
 * ========================================================================= */

/** How far back a routine run re-reads. Short: only recent days get revised. */
const ROUTINE_WINDOW_DAYS = 7;

/** The first sync for an account takes everything Meta will give. */
const BACKFILL_WINDOW_DAYS = MAX_WINDOW_DAYS;

export interface AccountSyncResult {
  readonly metaAccountId: string;
  readonly projectName: string;
  readonly platform: string;
  readonly objectId: string;
  readonly outcome: 'ok' | 'failed';
  readonly daysWritten: number;
  readonly postsWritten: number;
  readonly error: string | null;
}

interface LinkedAccount {
  readonly id: string;
  readonly projectName: string;
  readonly platformSlug: string;
  readonly objectId: string;
  readonly neverSynced: boolean;
}

interface CatalogueEntry {
  readonly metricKey: string;
  readonly fetchMode: 'series' | 'total_value' | 'profile';
}

/** yyyy-mm-dd, n days before the given day. */
function minusDays(isoDay: string, n: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The accounts to pull.
 *
 * ⚠️ THROUGH `app.meta_accounts_to_sync`, NOT A DIRECT SELECT, and the reason is
 * worth keeping: the first version queried `meta_accounts` directly and reported
 * a clean success having touched nothing. It found zero accounts, because this
 * job has no signed-in user and `meta_accounts_select` requires
 * `app.project_is_visible` — RLS failing closed, exactly as designed.
 *
 * The tempting fix — relaxing that policy — would expose every client's follower
 * numbers to any unauthenticated path reaching the table. `lib/db/client.ts`
 * warns against precisely this in its note on `withAppRole`. So the read goes
 * through a SECURITY DEFINER function that returns only what the sync needs
 * (migration 094), which is the same shape the attendance terminal uses.
 */
async function linkedAccounts(onlyAccountId?: string): Promise<LinkedAccount[]> {
  const rows = await withAppRole((tx) => tx`
    select * from app.meta_accounts_to_sync(${onlyAccountId ?? null}::uuid)
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    projectName: String(r.project_name),
    platformSlug: String(r.platform_slug),
    objectId: String(r.meta_object_id),
    neverSynced: Boolean(r.never_synced),
  }));
}

/**
 * ⚠️ THROUGH A FUNCTION, for the same reason as `linkedAccounts` — and this one
 * bit twice. A direct select here returned ZERO rows for the cron (no user, and
 * the catalogue's policy requires one), so the sync iterated an empty metric
 * list, fetched no series, and reported a clean success having written only
 * posts. A silent partial success is worse than a failure: the Studio would have
 * drawn empty graphs beside a full post list with nothing to explain it.
 */
async function catalogueFor(platform: string): Promise<CatalogueEntry[]> {
  const rows = await withAppRole((tx) => tx`
    select * from app.meta_catalogue_for(${platform})
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    metricKey: String(r.metric_key),
    fetchMode: String(r.fetch_mode) as CatalogueEntry['fetchMode'],
  }));
}

/* ---- Collecting one account's figures ------------------------------------ */

async function collectInstagram(
  objectId: string,
  since: string,
  until: string,
  metrics: CatalogueEntry[],
  wants: (category: string) => boolean,
): Promise<{
  values: DailyValue[];
  posts: FetchedPost[];
  followers: number | null;
  media: number | null;
  refused: string[];
}> {
  const token = process.env.META_SYSTEM_USER_TOKEN!.trim();
  const values: DailyValue[] = [];
  /* Days Meta would not serve. Reported, never silently dropped. */
  const refused: string[] = [];

  for (const m of metrics) {
    /* ⚠️ THE SCOPE IS APPLIED TO THE FETCH, NOT TO THE WRITE. Collecting
       everything and discarding it would burn the same Graph API budget while
       claiming to be narrower — which is the opposite of what a rule scoping to
       "posts only" is for. */
    if (!wants('metrics')) break;
    if (m.fetchMode === 'series') {
      values.push(...(await fetchSeries(objectId, m.metricKey, since, until, token)));
    } else if (m.fetchMode === 'total_value') {
      /* ⚠️ A DAY AT A TIME, and this is not wasteful — it is the only way.
         `metric_type=total_value` returns ONE number for the whole window, so
         asking for 30 days at once gives a 30-day total with no daily shape,
         and a graph cannot be drawn from it.

         ⚠️ AND THE WINDOW IS `D → D+1`, NOT `D → D`. `until` is EXCLUSIVE: a
         same-day window is zero-length and returns null, silently. A first
         version asked `since=D&until=D` for every day and wrote almost nothing
         while reporting success — 30 rows where ~300 were expected. Verified
         against the live API: 2026-09-02..2026-09-02 = null,
         2026-09-02..2026-09-03 = 617. */
      for (let d = since; d <= until; d = minusDays(d, -1)) {
        /* ⚠️ A REFUSED DAY IS SKIPPED, NOT FATAL, and this is the lesson from the
           `since` bug above: one day Meta would not serve threw out an entire
           month of collectable figures — 262 rows lost to a single bad request.

           The account-level try/catch further down exists so one client's
           failure cannot cost every other client their collection. This is the
           same principle one level lower: one DAY's failure must not cost the
           account its other twenty-nine. The day is recorded and the loop
           continues. */
        try {
          const v = await fetchTotalValue(objectId, m.metricKey, d, minusDays(d, -1), token);
          if (v !== null) values.push({ onDate: d, metricKey: m.metricKey, value: v });
        } catch (error) {
          refused.push(
            `${m.metricKey} on ${d}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }
    }
    /* 'profile' is not an insight — handled below, off the profile itself. */
  }

  const profile = wants('profile')
    ? await fetchIgProfile(objectId)
    : { followers: null, mediaCount: null };

  /* ⚠️ TODAY'S FOLLOWER TOTAL, SNAPSHOTTED BY US. `follower_count` as an insight
     returns nothing on a small account (verified: zero values at 16 followers).
     The profile field always reads, so we store it as today's row — and once
     stored daily it becomes the history Meta will not give us retroactively. */
  if (profile.followers !== null) {
    values.push({ onDate: until, metricKey: 'followers_count', value: profile.followers });
  }

  const posts = wants('posts') ? await fetchIgPosts(objectId) : [];
  return { values, posts, followers: profile.followers, media: profile.mediaCount, refused };
}

async function collectFacebook(
  objectId: string,
  since: string,
  until: string,
  metrics: CatalogueEntry[],
  wants: (category: string) => boolean,
): Promise<{
  values: DailyValue[];
  posts: FetchedPost[];
  followers: number | null;
  media: number | null;
  refused: string[];
}> {
  /* ⚠️ THE PAGE TOKEN, NOT THE SYSTEM USER TOKEN. Page insights refuse the
     system token with (#190). Derived per run; never stored. */
  const token = await pageAccessToken(objectId);

  const values: DailyValue[] = [];
  for (const m of metrics) {
    if (!wants('metrics')) break;
    if (m.fetchMode !== 'series') continue;
    values.push(...(await fetchSeries(objectId, m.metricKey, since, until, token)));
  }

  /* The page's follower total is `page_follows`, already collected above as a
     series. Read the last value for the account's headline figure. */
  const follows = values.filter((v) => v.metricKey === 'page_follows');
  const followers = follows.length > 0 ? follows[follows.length - 1].value : null;

  const posts = wants('posts') ? await fetchFbPosts(objectId, token) : [];
  /* Facebook asks for whole ranges, so there is no per-day refusal to collect. */
  return { values, posts, followers, media: null, refused: [] };
}

/* ---- The run ------------------------------------------------------------- */

/**
 * Sync every linked account, or one.
 *
 * `backfill` forces the full 30-day window regardless of whether the account has
 * been synced before — used by the first run and by a manual re-pull.
 */
export async function runMetaSync(options: {
  accountId?: string;
  backfill?: boolean;
  /**
   * Restrict the run to one project, by NAME.
   *
   * ⚠️ BY NAME AND NOT BY ID, which looks wrong and is not.
   * `app.meta_accounts_to_sync` returns `project_name` and no id, and changing
   * its shape means dropping and recreating a SECURITY DEFINER function the
   * live two-hourly cron depends on — a real risk to a working job, to avoid a
   * filter over a few dozen rows already in memory.
   *
   * It is safe here because both sides of the comparison are read from
   * `projects` within the same run: `app.meta_sync_rules_due` returns the name
   * and so does the account reader, so a rename between the two reads would
   * simply skip that project's rule for one cycle rather than sync the wrong
   * client's account.
   */
  projectName?: string;
  /**
   * Which parts to collect. Defaults to all three.
   *
   * ⚠️ EACH VALUE MAPS ONTO A REAL BRANCH BELOW, which is what lets a sync rule
   * genuinely narrow a pull rather than merely claim to. A category the runner
   * could not honour would be a checkbox in the UI that changes nothing.
   */
  categories?: readonly string[];
  /**
   * Restrict the run to these projects by name.
   *
   * ⚠️ WHAT STOPS A RULED PROJECT BEING PULLED TWICE. The cron runs the due
   * rules and then this; without the list, a project with a rule would be
   * collected by its rule and again by the default pull — double the Graph API
   * budget, and a rule narrowed to "posts only" silently widened back to
   * everything by the pull that followed it. Every upsert is idempotent, so no
   * figure would have been WRONG, which is exactly why it would not have been
   * noticed. Comes from `app.meta_projects_on_default_sync()` (migration 100).
   */
  onlyProjectNames?: readonly string[];
} = {}): Promise<AccountSyncResult[]> {
  if (!metaIsConfigured()) {
    throw new MetaApiError('Meta is not configured — META_SYSTEM_USER_TOKEN is missing.', null, null);
  }

  /* ⚠️ TWO DIFFERENT "TODAY"S, AND CONFUSING THEM BROKE INSTAGRAM FOR FIVE
     HOURS A NIGHT.

     `isoDateIn` gives the KARACHI date, which is right for everything this
     application stores — the division's day is the day. But Meta validates a
     `since` against ITS OWN clock, which is at or behind UTC. Karachi is UTC+5,
     so between 19:00 UTC and midnight UTC the Karachi date is already tomorrow
     from Meta's point of view, and it refuses:

         (#100) since param is not valid. Metrics data is available for the
         last 2 years

     — a message about two years, for a date one day too far forward. Verified
     against the live API on 2026-09-04 at 20:57 UTC: `since=2026-09-04` returned
     65 views and `since=2026-09-05` was rejected.

     Facebook never showed it because `fetchSeries` asks for a whole range and
     Meta simply returns fewer points. Instagram's `total_value` path asks for
     one specific day at a time, so the future day is a hard error that took the
     whole account's sync down with it.

     The collection window is therefore capped at the UTC date. Nothing is lost:
     Meta has no figures for a day that has not started in its own frame, and the
     next run picks it up. */
  const localToday = isoDateIn(nowMs());
  const utcToday = new Date(nowMs()).toISOString().slice(0, 10);
  const today = localToday < utcToday ? localToday : utcToday;
  const all = await linkedAccounts(options.accountId);

  /* ⚠️ BY PROJECT NAME, because that is what the reader returns — it has no
     project id column, and adding one is a migration to a function three
     callers depend on. Names are unique per project row here because the reader
     joins one project per account. */
  const accounts = options.projectName
    ? all.filter((a) => a.projectName === options.projectName)
    : options.onlyProjectNames
      ? all.filter((a) => options.onlyProjectNames!.includes(a.projectName))
      : all;

  const wants = (c: string) => !options.categories || options.categories.includes(c);
  const results: AccountSyncResult[] = [];

  /* ⚠️ SEQUENTIAL, NOT Promise.all. Meta rate-limits per app, and firing every
     account at once is how a fifteen-client division gets throttled into
     failures that look like permission errors. The volume here is tiny; the
     wall-clock cost is irrelevant against a two-hourly schedule. */
  for (const account of accounts) {
    const full = options.backfill || account.neverSynced;
    const until = today;
    const since = minusDays(today, full ? BACKFILL_WINDOW_DAYS - 1 : ROUTINE_WINDOW_DAYS - 1);

    try {
      const metrics = await catalogueFor(account.platformSlug);

      const collected =
        account.platformSlug === 'instagram'
          ? await collectInstagram(account.objectId, since, until, metrics, wants)
          : await collectFacebook(account.objectId, since, until, metrics, wants);

      const written = await withAppRole((tx) => tx`
        select * from app.record_meta_sync(
          ${account.id}::uuid,
          ${tx.json(collected.values.map((v) => ({
            on_date: v.onDate,
            metric_key: v.metricKey,
            value: v.value,
          })) as never)}::jsonb,
          ${tx.json(collected.posts.map((p) => ({
            meta_post_id: p.metaPostId,
            posted_at: p.postedAt,
            caption: p.caption,
            media_type: p.mediaType,
            media_product_type: p.mediaProductType,
            permalink: p.permalink,
            thumbnail_url: p.thumbnailUrl,
            metrics: p.metrics,
          })) as never)}::jsonb,
          ${collected.followers},
          ${collected.media},
          ${since}::date,
          ${until}::date
        )
      `);

      const row = (written as Array<Record<string, unknown>>)[0] ?? {};
      results.push({
        metaAccountId: account.id,
        projectName: account.projectName,
        platform: account.platformSlug,
        objectId: account.objectId,
        outcome: 'ok',
        daysWritten: Number(row.days_written ?? 0),
        postsWritten: Number(row.posts_written ?? 0),
        /* ⚠️ A RUN THAT COLLECTED MOST OF ITS DAYS IS `ok` AND SAYS WHAT IT
           MISSED. Marking it `failed` would put the account in the red on the
           Studio for a day Meta was never going to serve, and dropping the note
           entirely would hide a real gap. So: succeeded, with the refusals named
           — which is what `error` on an `ok` run is for. */
        error: collected.refused.length === 0
          ? null
          : `Collected, but Meta refused ${collected.refused.length} request(s): ${collected.refused[0]}`,
      });
    } catch (error) {
      /* ⚠️ CAUGHT PER ACCOUNT AND RECORDED, NEVER RETHROWN. This is the property
         the whole file exists to guarantee. The message is stored verbatim
         because Meta's own wording is the most useful thing anybody debugging
         this will have — "(#190) This method must be called with a Page Access
         Token" tells you exactly what is wrong, and a generic "sync failed"
         tells you nothing. */
      const message =
        error instanceof MetaApiError
          ? `${error.message}${error.code ? ` (code ${error.code})` : ''}`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      await withAppRole((tx) => tx`
        select app.record_meta_sync_failure(${account.id}::uuid, ${message})
      `);

      results.push({
        metaAccountId: account.id,
        projectName: account.projectName,
        platform: account.platformSlug,
        objectId: account.objectId,
        outcome: 'failed',
        daysWritten: 0,
        postsWritten: 0,
        error: message,
      });
    }
  }

  return results;
}
