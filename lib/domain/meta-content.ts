import type { StudioPost } from './meta-studio';
import { postEngagement } from './meta-studio';

/* ============================================================================
 * THE CONTENT & POSTS TAB
 * ----------------------------------------------------------------------------
 * Pure. Classifying, counting and ranking what was published, so the arithmetic
 * behind a client-facing figure is testable rather than eyeballed on screen.
 * ========================================================================= */

/** A planned piece of content that has not gone out yet — a Taskly task. */
export interface ContentDraft {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly kind: string | null;
  readonly dueDate: string | null;
  readonly assigneeName: string | null;
  readonly status: string;
}

export type ContentKind = 'Reel' | 'Story' | 'Carousel' | 'Video' | 'Image' | 'Post';

/**
 * What kind of thing a post is.
 *
 * ── ⚠️ TWO META FIELDS, IN THIS ORDER, AND IT MATTERS ───────────────────────
 * `media_product_type` says WHERE it lives (FEED / REELS / STORY) and
 * `media_type` says WHAT it is (IMAGE / VIDEO / CAROUSEL_ALBUM). A reel is a
 * VIDEO in the REELS surface, so checking `media_type` first would file every
 * reel under "Video" and the Reels tab would always read zero.
 *
 * Verified against the live account: it returns FEED and REELS for
 * `media_product_type`, and IMAGE, VIDEO or null for `media_type` — Facebook
 * posts carry no `media_type` at all, which is why the fallback is 'Post'
 * rather than an error.
 */
export function classifyPost(post: StudioPost): ContentKind {
  const surface = (post.mediaProductType ?? '').toUpperCase();
  if (surface === 'REELS') return 'Reel';
  if (surface === 'STORY') return 'Story';

  const media = (post.mediaType ?? '').toUpperCase();
  if (media === 'CAROUSEL_ALBUM') return 'Carousel';
  if (media === 'VIDEO') return 'Video';
  if (media === 'IMAGE') return 'Image';

  return 'Post';
}

/* ---- The tab strip ------------------------------------------------------- */

export type ContentTab = 'all' | 'reels' | 'stories' | 'carousels' | 'videos' | 'images' | 'drafts';

export interface TabCount {
  readonly key: ContentTab;
  readonly label: string;
  readonly count: number;
}

const TAB_KIND: Partial<Record<ContentTab, ContentKind>> = {
  reels: 'Reel',
  stories: 'Story',
  carousels: 'Carousel',
  videos: 'Video',
  images: 'Image',
};

/**
 * Every tab, with its real count.
 *
 * ⚠️ TABS AT ZERO ARE KEPT, NOT HIDDEN. A strip that shows only what exists
 * cannot say "no stories went out this period", which is the very gap somebody
 * opens this tab to find. It also means the strip does not reflow as content is
 * published, so a tab a reader has learned the position of stays put.
 */
export function contentTabs(
  posts: readonly StudioPost[],
  draftCount: number,
): TabCount[] {
  const counts = new Map<ContentKind, number>();
  for (const p of posts) {
    const kind = classifyPost(p);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  /* "Posts" folds in anything that is a plain feed item — an IMAGE in the feed
     is both an Image and a Post, and the reference lists both, so the Images tab
     is a subset rather than a rival. */
  return [
    { key: 'all', label: 'All Posts', count: posts.length },
    { key: 'reels', label: 'Reels', count: counts.get('Reel') ?? 0 },
    { key: 'stories', label: 'Stories', count: counts.get('Story') ?? 0 },
    { key: 'carousels', label: 'Carousels', count: counts.get('Carousel') ?? 0 },
    { key: 'videos', label: 'Videos', count: counts.get('Video') ?? 0 },
    { key: 'images', label: 'Images', count: counts.get('Image') ?? 0 },
    { key: 'drafts', label: 'Drafts', count: draftCount },
  ];
}

export function filterPosts(
  posts: readonly StudioPost[],
  tab: ContentTab,
  platform: 'all' | 'facebook' | 'instagram',
): StudioPost[] {
  const kind = TAB_KIND[tab];
  return posts.filter((p) => {
    if (platform !== 'all' && p.platform !== platform) return false;
    if (kind && classifyPost(p) !== kind) return false;
    return true;
  });
}

/* ---- The headline cards ------------------------------------------------- */

export interface ContentKpi {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly kind: 'count' | 'rate';
  /** Percent change against the previous period, or null with nothing to compare. */
  readonly deltaPercent: number | null;
  readonly hint?: string;
}

export function contentKpis(input: {
  readonly posts: readonly StudioPost[];
  readonly previousPosts: readonly StudioPost[];
  readonly draftCount: number;
}): ContentKpi[] {
  const { posts, previousPosts, draftCount } = input;

  const sum = (list: readonly StudioPost[], pick: (p: StudioPost) => number | null) =>
    list.reduce((n, p) => n + (pick(p) ?? 0), 0);

  const change = (now: number, before: number): number | null =>
    before === 0 ? null : ((now - before) / before) * 100;

  const reach = sum(posts, (p) => p.reach);
  const reachBefore = sum(previousPosts, (p) => p.reach);

  const engagement = sum(posts, (p) => postEngagement(p));
  const engagementBefore = sum(previousPosts, (p) => postEngagement(p));

  /* ⚠️ Rate over the posts that actually REPORT reach, not over all of them.
     Facebook returns no per-post reach, so dividing by every post would halve
     the rate for a reason nobody could see on screen. */
  const withReach = posts.filter((p) => p.reach !== null && p.reach > 0);
  const rate =
    withReach.length === 0
      ? 0
      : (sum(withReach, (p) => postEngagement(p)) / sum(withReach, (p) => p.reach)) * 100;

  const withReachBefore = previousPosts.filter((p) => p.reach !== null && p.reach > 0);
  const rateBefore =
    withReachBefore.length === 0
      ? 0
      : (sum(withReachBefore, (p) => postEngagement(p)) / sum(withReachBefore, (p) => p.reach)) *
        100;

  return [
    {
      key: 'total',
      label: 'Total posts',
      value: posts.length + draftCount,
      kind: 'count',
      deltaPercent: change(posts.length, previousPosts.length),
      hint: draftCount > 0 ? `${draftCount} still in draft` : undefined,
    },
    {
      key: 'published',
      label: 'Published',
      value: posts.length,
      kind: 'count',
      deltaPercent: change(posts.length, previousPosts.length),
    },
    {
      key: 'reach',
      label: 'Reach',
      value: reach,
      kind: 'count',
      deltaPercent: change(reach, reachBefore),
      hint: 'Instagram only',
    },
    {
      key: 'engagement',
      label: 'Engagement',
      value: engagement,
      kind: 'count',
      deltaPercent: change(engagement, engagementBefore),
    },
    {
      key: 'rate',
      label: 'Avg. engagement rate',
      value: rate,
      kind: 'rate',
      deltaPercent: rateBefore === 0 ? null : rate - rateBefore,
      hint: 'Per post reached',
    },
    {
      /* ── ⚠️ NOT THE REFERENCE'S "CONTENT SCORE" ────────────────────────────
         The drawing's sixth card is a score of 89 out of some unstated scale.
         There is no such measure in this system and inventing one — a weighted
         blend of reach and engagement, say — would put a number on a client's
         screen that means only whatever formula I happened to choose that
         afternoon, with no way for anyone to check it.

         Average reach per post is a real quantity, answers a question somebody
         actually has, and fills the same slot. */
      key: 'avg_reach',
      label: 'Avg. reach / post',
      value: withReach.length === 0 ? 0 : Math.round(reach / withReach.length),
      kind: 'count',
      deltaPercent:
        withReachBefore.length === 0
          ? null
          : change(
              withReach.length === 0 ? 0 : reach / withReach.length,
              reachBefore / withReachBefore.length,
            ),
    },
  ];
}

/* ---- Derived insights, all measured ------------------------------------- */

export interface ContentInsight {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Facts about the account's own posting, computed from what it published.
 *
 * ── ⚠️ WHY THIS IS NOT THE REFERENCE'S "AI SUGGESTIONS" ─────────────────────
 * The drawing offers three: a best time to post, a content idea, and a
 * repurposing tip. Only the FIRST is derivable from data this system holds; the
 * other two are generated prose, and a panel that mixes one measured fact with
 * two invented ones teaches a reader to trust all three equally.
 *
 * So the panel keeps its shape and every line in it is measured: when this
 * account's posts have actually done best, which kind performs best, and how the
 * period compares. Each names the figure it came from, so a reader can disagree
 * with it.
 */
export function contentInsights(
  posts: readonly StudioPost[],
  timeZone = 'Asia/Karachi',
): ContentInsight[] {
  const out: ContentInsight[] = [];
  if (posts.length === 0) return out;

  /* ── Best slot, weighted by engagement ─────────────────────────────────── */
  const slots = new Map<string, { total: number; posts: number }>();
  for (const p of posts) {
    const local = new Date(new Date(p.postedAt).toLocaleString('en-US', { timeZone }));
    const key = `${local.getDay()}|${Math.floor(local.getHours() / 2) * 2}`;
    const slot = slots.get(key) ?? { total: 0, posts: 0 };
    slot.total += postEngagement(p);
    slot.posts += 1;
    slots.set(key, slot);
  }

  /* ⚠️ AVERAGE PER POST, not the total. A slot with eight ordinary posts would
     otherwise beat a slot with one excellent one, and the question being asked
     is "when should I post", not "when have I posted most". */
  let best: { key: string; mean: number; posts: number } | null = null;
  for (const [key, slot] of slots) {
    const mean = slot.total / slot.posts;
    if (!best || mean > best.mean) best = { key, mean, posts: slot.posts };
  }

  if (best && best.mean > 0) {
    const [day, hour] = best.key.split('|').map(Number);
    out.push({
      key: 'best_time',
      title: `Best slot: ${DAY_NAMES[day]}, ${formatHour(hour)}`,
      detail: `${Math.round(best.mean)} engagements per post across ${best.posts} ${
        best.posts === 1 ? 'post' : 'posts'
      } published then.`,
    });
  }

  /* ── Which kind performs best ──────────────────────────────────────────── */
  const kinds = new Map<ContentKind, { total: number; posts: number }>();
  for (const p of posts) {
    const kind = classifyPost(p);
    const entry = kinds.get(kind) ?? { total: 0, posts: 0 };
    entry.total += postEngagement(p);
    entry.posts += 1;
    kinds.set(kind, entry);
  }

  const ranked = [...kinds.entries()]
    .map(([kind, e]) => ({ kind, mean: e.total / e.posts, posts: e.posts }))
    .sort((a, b) => b.mean - a.mean);

  if (ranked.length > 1 && ranked[0].mean > 0) {
    const top = ranked[0];
    const next = ranked[1];
    const times = next.mean > 0 ? top.mean / next.mean : null;
    out.push({
      key: 'best_kind',
      title: `${top.kind}s are your strongest format`,
      detail:
        times && times >= 1.15
          ? `${Math.round(top.mean)} engagements per ${top.kind.toLowerCase()} — ${times.toFixed(1)}× a ${next.kind.toLowerCase()}.`
          : `${Math.round(top.mean)} engagements per ${top.kind.toLowerCase()}, just ahead of ${next.kind.toLowerCase()}s.`,
    });
  }

  /* ── Anything published without a live link ────────────────────────────── */
  const noLink = posts.filter((p) => !p.permalink).length;
  if (noLink > 0) {
    out.push({
      key: 'no_link',
      title: `${noLink} ${noLink === 1 ? 'post has' : 'posts have'} no live link`,
      detail: 'A post without its link cannot be checked by the client.',
    });
  }

  /* ── The quietest stretch ──────────────────────────────────────────────── */
  const days = [...new Set(posts.map((p) => p.postedAt.slice(0, 10)))].sort();
  if (days.length > 1) {
    let widest = 0;
    let after = '';
    for (let i = 1; i < days.length; i += 1) {
      const gap = Math.round(
        (Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`)) / 86_400_000,
      );
      if (gap > widest) {
        widest = gap;
        after = days[i - 1];
      }
    }
    if (widest > 2) {
      out.push({
        key: 'gap',
        title: `Longest quiet stretch: ${widest} days`,
        detail: `Nothing went out between ${after} and the next post.`,
      });
    }
  }

  return out;
}

function formatHour(hour: number): string {
  const to12 = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
  return `${to12(hour)}–${to12((hour + 2) % 24)}`;
}

/* ---- Distribution ------------------------------------------------------- */

export interface KindShare {
  readonly kind: ContentKind;
  readonly count: number;
  readonly share: number;
}

/** Every kind that appears, largest first, with its share of the total. */
export function contentDistribution(posts: readonly StudioPost[]): KindShare[] {
  const counts = new Map<ContentKind, number>();
  for (const p of posts) {
    const kind = classifyPost(p);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const total = posts.length || 1;
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count, share: count / total }))
    .sort((a, b) => b.count - a.count);
}

/** The strongest posts by engagement. */
export function rankPosts(
  posts: readonly StudioPost[],
  by: 'engagement' | 'reach' | 'recent',
  limit = 5,
): StudioPost[] {
  const list = [...posts];
  if (by === 'reach') list.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  else if (by === 'recent') list.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  else list.sort((a, b) => postEngagement(b) - postEngagement(a));
  return list.slice(0, limit);
}

/* ============================================================================
 * ACCOUNT HEALTH
 * ----------------------------------------------------------------------------
 * ⚠️ "CONNECTED" IS NOT THE QUESTION. A row in `meta_accounts` proves somebody
 * linked a page once; it says nothing about whether figures are still arriving.
 * An account that linked cleanly and has failed every sync since looks identical
 * to a healthy one on the strength of its own row.
 *
 * So health is judged on the LAST SUCCESSFUL PULL, and the thresholds come from
 * the schedule rather than from taste: the cron runs every two hours, so six
 * hours is three missed runs — enough to be a fault rather than a blip — and
 * twenty-four hours is a connection nobody should still be trusting.
 * ========================================================================= */

export type AccountHealth = 'error' | 'stale' | 'quiet' | 'healthy' | 'never';

export interface HealthVerdict {
  readonly state: AccountHealth;
  readonly label: string;
  readonly detail: string;
  /** A chart-palette token, or a feedback token for the two bad states. */
  readonly token: string;
}

export function accountHealth(input: {
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly metricDays: number;
  readonly nowMs: number;
}): HealthVerdict {
  const { lastSyncedAt, lastError, metricDays, nowMs } = input;

  /* ⚠️ THE ERROR WINS OVER EVERYTHING, including a recent successful sync. A
     client who revoked access yesterday has a `last_synced_at` from yesterday
     and is still broken today. */
  if (lastError) {
    return {
      state: 'error',
      label: 'Not syncing',
      detail: lastError,
      token: 'feedback-error',
    };
  }

  if (!lastSyncedAt) {
    return {
      state: 'never',
      label: 'Awaiting first sync',
      detail: 'Connected, but no figures have been collected yet.',
      token: 'chart-6',
    };
  }

  const hours = (nowMs - Date.parse(lastSyncedAt)) / 3_600_000;

  if (hours >= 24) {
    return {
      state: 'stale',
      label: 'Stale',
      detail: `Last pulled ${Math.round(hours / 24)} ${Math.round(hours / 24) === 1 ? 'day' : 'days'} ago — the two-hourly sync is not reaching this account.`,
      token: 'feedback-error',
    };
  }

  if (hours >= 6) {
    return {
      state: 'quiet',
      label: 'Behind',
      detail: `Last pulled ${Math.round(hours)} hours ago; the schedule is every two.`,
      token: 'feedback-warning',
    };
  }

  return {
    state: 'healthy',
    label: 'Syncing',
    detail:
      metricDays > 0
        ? `${metricDays} ${metricDays === 1 ? 'day' : 'days'} of history collected.`
        : 'Connected and up to date.',
    token: 'feedback-success',
  };
}

/* ---- The fleet, not one account ----------------------------------------- */

export interface SyncSummary {
  readonly healthy: number;
  readonly warning: number;
  readonly issues: number;
  readonly total: number;
  /** "Excellent" / "Needs attention" / … — the Sync Health card's word. */
  readonly verdict: string;
  readonly detail: string;
  readonly token: string;
}

/**
 * One verdict over every connected account.
 *
 * ⚠️ THE WORST ACCOUNT SETS THE VERDICT, not the average. Nine healthy
 * connections and one revoked is not "90% excellent" — it is one client whose
 * numbers are silently frozen, and a summary that rounds that away reassures
 * somebody at the exact moment they need not to be. The reference's card reads
 * "Excellent · All systems operational", which is only allowed to appear here
 * when it is literally true.
 */
export function syncHealthSummary(
  accounts: readonly {
    lastSyncedAt: string | null;
    lastError: string | null;
    metricDays: number;
  }[],
  nowMs: number,
): SyncSummary {
  let healthy = 0;
  let warning = 0;
  let issues = 0;

  for (const a of accounts) {
    const state = accountHealth({ ...a, nowMs }).state;
    if (state === 'error' || state === 'stale') issues += 1;
    else if (state === 'quiet' || state === 'never') warning += 1;
    else healthy += 1;
  }

  const total = accounts.length;

  if (total === 0) {
    return {
      healthy,
      warning,
      issues,
      total,
      verdict: 'No accounts',
      detail: 'Nothing is connected to this project yet.',
      token: 'text-tertiary',
    };
  }

  if (issues > 0) {
    return {
      healthy,
      warning,
      issues,
      total,
      verdict: 'Needs attention',
      detail: `${issues} of ${total} ${issues === 1 ? 'account is' : 'accounts are'} not syncing.`,
      token: 'feedback-error',
    };
  }

  if (warning > 0) {
    return {
      healthy,
      warning,
      issues,
      total,
      verdict: 'Falling behind',
      detail: `${warning} of ${total} ${warning === 1 ? 'account is' : 'accounts are'} overdue a pull.`,
      token: 'feedback-warning',
    };
  }

  return {
    healthy,
    warning,
    issues,
    total,
    verdict: 'Excellent',
    detail: 'All systems operational.',
    token: 'feedback-success',
  };
}

export interface FleetBanner {
  readonly tone: 'good' | 'mixed' | 'bad';
  readonly title: string;
  readonly detail: string;
}

/**
 * The banner at the foot of the tab.
 *
 * ⚠️ IT IS ALLOWED TO SAY THE ACCOUNTS ARE NOT DOING WELL. The reference reads
 * "Your accounts are performing great!" as FIXED TEXT — a congratulation that
 * keeps congratulating while followers fall and a connection dies. A banner
 * that cannot report bad news is decoration, and worse than decoration: it
 * actively reassures somebody at the moment they most need not to be.
 *
 * So the tone is derived. It needs the sync clean AND nothing falling before it
 * will celebrate, and it names the figures either way.
 */
export function fleetBanner(input: {
  readonly sync: SyncSummary;
  readonly followerDeltaPercent: number | null;
  readonly postDeltaPercent: number | null;
}): FleetBanner {
  const { sync, followerDeltaPercent, postDeltaPercent } = input;

  if (sync.issues > 0) {
    return {
      tone: 'bad',
      title: `${sync.issues} ${sync.issues === 1 ? 'account needs' : 'accounts need'} attention`,
      detail:
        'Figures for those accounts stopped updating, so anything on this page about them is out of date.',
    };
  }

  if (sync.warning > 0) {
    return {
      tone: 'mixed',
      title: 'Collection is running behind',
      detail: `${sync.warning} of ${sync.total} accounts have not been pulled on schedule. The figures are real but not current.`,
    };
  }

  /* ⚠️ A null delta means "no earlier period", NOT zero growth. Reporting
     "up 0%" about a first month would be a claim about data that does not
     exist. */
  if (followerDeltaPercent === null && postDeltaPercent === null) {
    return {
      tone: 'good',
      title: 'Collection is healthy',
      detail:
        'Every account is syncing on schedule. Comparisons against a previous period begin once there is one.',
    };
  }

  const growing = (followerDeltaPercent ?? 0) >= 0;
  const posting = (postDeltaPercent ?? 0) >= 0;

  if (growing && posting) {
    const parts = [
      postDeltaPercent !== null ? `${fmtPct(postDeltaPercent)} more posts collected` : null,
      followerDeltaPercent !== null ? `followers ${fmtPct(followerDeltaPercent)}` : null,
    ].filter((x): x is string => x !== null);

    return {
      tone: 'good',
      title: 'Your accounts are performing well',
      detail: `${parts.join(' and ')} compared with the previous period.`,
    };
  }

  const said = [
    followerDeltaPercent !== null ? `followers ${fmtPct(followerDeltaPercent)}` : null,
    postDeltaPercent !== null ? `posts collected ${fmtPct(postDeltaPercent)}` : null,
  ].filter((x): x is string => x !== null);

  return {
    tone: 'mixed',
    title: 'Mixed period',
    detail: `${said.join(', ')} against the previous period.`,
  };
}

function fmtPct(n: number): string {
  const rounded = Math.abs(n) >= 10 ? Math.round(n) : Number(n.toFixed(1));
  return `${n > 0 ? 'up ' : n < 0 ? 'down ' : ''}${Math.abs(rounded)}%`;
}
