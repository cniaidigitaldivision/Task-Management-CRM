/* ============================================================================
 * SHAPING META FIGURES FOR THE STUDIO
 * ----------------------------------------------------------------------------
 * Pure. No database, no fetch, no clock of its own — every function takes what
 * it needs and returns what it computed, so the arithmetic behind a client-facing
 * number can be tested rather than eyeballed on a screen.
 * ========================================================================= */

export interface StudioProject {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  /** False for a project with no linked Meta account — the "coming soon" case. */
  readonly hasAccounts: boolean;
}

export interface StudioAccount {
  readonly id: string;
  readonly platform: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly permalink: string | null;
  readonly followers: number | null;
  readonly mediaCount: number | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

export interface MetricPoint {
  readonly onDate: string;
  readonly platform: string;
  readonly metricKey: string;
  readonly value: number;
}

export interface StudioPost {
  readonly id: string;
  readonly platform: string;
  readonly postedAt: string;
  readonly caption: string | null;
  readonly mediaProductType: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly reach: number | null;
  readonly views: number | null;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly shares: number | null;
  readonly saves: number | null;
  readonly totalInteractions: number | null;
}

/** Instagram reports `reach`; Facebook has no working page-level reach metric in
 *  v26.0, so its card is deliberately absent rather than wrong. */
export const PLATFORM_METRICS = {
  instagram: {
    followers: 'followers_count',
    reach: 'reach',
    views: 'views',
    interactions: 'total_interactions',
    profileViews: 'profile_views',
  },
  facebook: {
    followers: 'page_follows',
    views: 'page_views_total',
    interactions: 'page_post_engagements',
    videoViews: 'page_video_views',
  },
} as const;

export interface Delta {
  /** Percent change, or null when the previous period had nothing to compare. */
  readonly percent: number | null;
  readonly direction: 'up' | 'down' | 'flat';
  readonly previous: number;
}

export interface Kpi {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A count that is summed, or a level that is read at its latest point. */
  readonly kind: 'total' | 'latest' | 'rate';
  readonly delta: Delta | null;
  readonly hint?: string;
}

/* ---- Dates --------------------------------------------------------------- */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The period immediately before this one, of the same length.
 *
 * ⚠️ THE SAME LENGTH IS THE WHOLE POINT. The dashboard once showed "+1640%" by
 * comparing an all-time total against a four-week window — two different
 * measures stacked in one tile. A delta is only meaningful when both sides span
 * the same number of days.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/* ---- Series -------------------------------------------------------------- */

/** Sum of one metric across a platform (or both) within the points given. */
export function sumMetric(
  points: readonly MetricPoint[],
  metricKey: string,
  platform?: string,
): number {
  let total = 0;
  for (const p of points) {
    if (p.metricKey !== metricKey) continue;
    if (platform && p.platform !== platform) continue;
    total += p.value;
  }
  return total;
}

/**
 * The most recent value of a metric — for a LEVEL such as a follower count.
 *
 * ⚠️ NEVER SUM A FOLLOWER COUNT. It is a running total already: adding 29 daily
 * snapshots of "16 followers" gives 464 and reads as spectacular growth. Levels
 * are read at their latest point; only counts are summed.
 */
export function latestMetric(
  points: readonly MetricPoint[],
  metricKey: string,
  platform?: string,
): number | null {
  let best: MetricPoint | null = null;
  for (const p of points) {
    if (p.metricKey !== metricKey) continue;
    if (platform && p.platform !== platform) continue;
    if (!best || p.onDate > best.onDate) best = p;
  }
  return best ? best.value : null;
}

export function deltaBetween(current: number, previous: number): Delta {
  if (previous === 0) {
    return { percent: null, direction: current > 0 ? 'up' : 'flat', previous };
  }
  const percent = ((current - previous) / previous) * 100;
  return {
    percent,
    direction: percent > 0.05 ? 'up' : percent < -0.05 ? 'down' : 'flat',
    previous,
  };
}

/** One point per day, with a value per platform — what a line chart wants. */
export interface DayPoint {
  readonly date: string;
  readonly facebook: number | null;
  readonly instagram: number | null;
  readonly combined: number;
}

export function dailySeries(
  points: readonly MetricPoint[],
  metricByPlatform: { facebook?: string; instagram?: string },
  from: string,
  to: string,
): DayPoint[] {
  const fb = new Map<string, number>();
  const ig = new Map<string, number>();

  for (const p of points) {
    if (p.platform === 'facebook' && p.metricKey === metricByPlatform.facebook) {
      fb.set(p.onDate, (fb.get(p.onDate) ?? 0) + p.value);
    } else if (p.platform === 'instagram' && p.metricKey === metricByPlatform.instagram) {
      ig.set(p.onDate, (ig.get(p.onDate) ?? 0) + p.value);
    }
  }

  /* ⚠️ EVERY DAY IN THE RANGE, INCLUDING THE MISSING ONES. Plotting only the
     days that have rows draws a line that skips gaps, which silently reshapes a
     trend — a week with no data would appear as a straight segment rather than
     as the hole it is. */
  const out: DayPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const f = fb.has(d) ? fb.get(d)! : null;
    const i = ig.has(d) ? ig.get(d)! : null;
    out.push({ date: d, facebook: f, instagram: i, combined: (f ?? 0) + (i ?? 0) });
  }
  return out;
}

/* ---- The headline cards -------------------------------------------------- */

export function buildKpis(input: {
  readonly current: readonly MetricPoint[];
  readonly previous: readonly MetricPoint[];
  readonly accounts: readonly StudioAccount[];
  readonly postsInPeriod: number;
  readonly cadence: { staticPerDay: number | null; reelsPerWeek: number | null };
  readonly from: string;
  readonly to: string;
  readonly platform: 'all' | 'facebook' | 'instagram';
}): Kpi[] {
  const kpis: Kpi[] = [];

  const wantFb = input.platform !== 'instagram';
  const wantIg = input.platform !== 'facebook';

  /* ── Followers. A LEVEL, summed ACROSS platforms but never across days. ──
     Facebook's page_follows and Instagram's followers_count are different
     metrics measuring the same thing, so each is read at its latest point and
     the two are added. */
  const fbNow = wantFb ? latestMetric(input.current, 'page_follows', 'facebook') : null;
  const igNow = wantIg ? latestMetric(input.current, 'followers_count', 'instagram') : null;
  const followersNow = (fbNow ?? 0) + (igNow ?? 0);

  const fbWas = wantFb ? latestMetric(input.previous, 'page_follows', 'facebook') : null;
  const igWas = wantIg ? latestMetric(input.previous, 'followers_count', 'instagram') : null;
  const followersWas = (fbWas ?? 0) + (igWas ?? 0);

  if (fbNow !== null || igNow !== null) {
    kpis.push({
      key: 'followers',
      label: 'Total followers',
      value: followersNow,
      kind: 'latest',
      delta: followersWas > 0 ? deltaBetween(followersNow, followersWas) : null,
    });
  }

  /* ── Views. A COUNT, so summed. */
  const viewsNow =
    (wantIg ? sumMetric(input.current, 'views', 'instagram') : 0) +
    (wantFb ? sumMetric(input.current, 'page_views_total', 'facebook') : 0);
  const viewsWas =
    (wantIg ? sumMetric(input.previous, 'views', 'instagram') : 0) +
    (wantFb ? sumMetric(input.previous, 'page_views_total', 'facebook') : 0);

  kpis.push({
    key: 'views',
    label: 'Total views',
    value: viewsNow,
    kind: 'total',
    delta: deltaBetween(viewsNow, viewsWas),
  });

  /* ── Reach. ⚠️ INSTAGRAM ONLY, and the hint says so.
     No working page-level reach metric exists on Facebook in v26.0
     (page_impressions and page_impressions_unique are both retired). Showing a
     combined "reach" that quietly means "Instagram only" would be a number
     nobody could reconcile. */
  if (wantIg) {
    const reachNow = sumMetric(input.current, 'reach', 'instagram');
    const reachWas = sumMetric(input.previous, 'reach', 'instagram');
    kpis.push({
      key: 'reach',
      label: 'Total reach',
      value: reachNow,
      kind: 'total',
      delta: deltaBetween(reachNow, reachWas),
      hint: 'Instagram only — Facebook no longer reports page reach',
    });
  }

  /* ── Engagement. */
  const engNow =
    (wantIg ? sumMetric(input.current, 'total_interactions', 'instagram') : 0) +
    (wantFb ? sumMetric(input.current, 'page_post_engagements', 'facebook') : 0);
  const engWas =
    (wantIg ? sumMetric(input.previous, 'total_interactions', 'instagram') : 0) +
    (wantFb ? sumMetric(input.previous, 'page_post_engagements', 'facebook') : 0);

  kpis.push({
    key: 'engagement',
    label: 'Engagements',
    value: engNow,
    kind: 'total',
    delta: deltaBetween(engNow, engWas),
  });

  /* ── Engagement rate — interactions per person reached.
     ⚠️ Instagram only, because it is engagement ÷ REACH and Facebook has no
     reach. A rate whose numerator and denominator came from different platforms
     would be arithmetic nonsense. */
  if (wantIg) {
    const reachNow = sumMetric(input.current, 'reach', 'instagram');
    const igEng = sumMetric(input.current, 'total_interactions', 'instagram');
    const rateNow = reachNow > 0 ? (igEng / reachNow) * 100 : 0;

    const reachWas = sumMetric(input.previous, 'reach', 'instagram');
    const igEngWas = sumMetric(input.previous, 'total_interactions', 'instagram');
    const rateWas = reachWas > 0 ? (igEngWas / reachWas) * 100 : 0;

    kpis.push({
      key: 'engagement_rate',
      label: 'Engagement rate',
      value: rateNow,
      kind: 'rate',
      delta: rateWas > 0 ? deltaBetween(rateNow, rateWas) : null,
      hint: 'Interactions per person reached, Instagram',
    });
  }

  /* ── The promise, and what came of it. Only when a rhythm is agreed: a null
     target means "no cadence set", which must never read as a target of zero. */
  const { staticPerDay, reelsPerWeek } = input.cadence;
  if (staticPerDay !== null || reelsPerWeek !== null) {
    const days = daysBetween(input.from, input.to);
    const target =
      (staticPerDay ?? 0) * days + Math.round(((reelsPerWeek ?? 0) * days) / 7);

    kpis.push({
      key: 'target',
      label: 'Posts vs target',
      value: input.postsInPeriod,
      kind: 'total',
      delta: null,
      hint: target > 0 ? `${input.postsInPeriod} of ${target} planned` : undefined,
    });
  }

  return kpis;
}

/* ---- Posts --------------------------------------------------------------- */

/** Engagement for ranking. Falls back to the parts when the total is absent —
 *  Facebook does not report `total_interactions`. */
export function postEngagement(post: StudioPost): number {
  if (post.totalInteractions !== null) return post.totalInteractions;
  return (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0) + (post.saves ?? 0);
}

export function topPosts(posts: readonly StudioPost[], limit = 5): StudioPost[] {
  return [...posts].sort((a, b) => postEngagement(b) - postEngagement(a)).slice(0, limit);
}

/** Reels / Posts / Stories, from `media_product_type`. */
export function contentMix(posts: readonly StudioPost[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const raw = (p.mediaProductType ?? 'POST').toUpperCase();
    const label =
      raw === 'REELS' ? 'Reels' : raw === 'STORY' ? 'Stories' : raw === 'AD' ? 'Ads' : 'Posts';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/* ---- Formatting ---------------------------------------------------------- */

export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function formatKpi(kpi: Kpi): string {
  return kpi.kind === 'rate' ? `${kpi.value.toFixed(2)}%` : compact(kpi.value);
}

/** "+12.4%" / "−3.1%" / "—". Percentage POINTS for a rate, because a percentage
 *  change of a percentage is a different and easily-misread quantity. */
export function formatDelta(kpi: Kpi): string | null {
  if (!kpi.delta || kpi.delta.percent === null) return null;
  const p = kpi.delta.percent;
  const sign = p > 0 ? '+' : '';
  if (kpi.kind === 'rate') {
    const points = kpi.value - kpi.delta.previous;
    return `${points > 0 ? '+' : ''}${points.toFixed(2)}pp`;
  }
  return `${sign}${p.toFixed(1)}%`;
}

/* ---- Axis scales --------------------------------------------------------- */

/**
 * A round ceiling and a step count for an axis.
 *
 * ⚠️ IT SEARCHES CANDIDATE STEPS RATHER THAN PICKING ONE FROM THE MAGNITUDE.
 * A first version took the first "nice" number above `max / 4`, and two of the
 * real cases came out badly:
 *
 *   229,477 → 0 · 75K · 150K · 225K · 300K   a QUARTER of the panel left empty
 *         9 → 0 · 3 · 5 · 8 · 10             steps of 2.5, rounded in the label,
 *                                            so the axis printed numbers that
 *                                            were not where the gridlines were
 *
 * The second is the serious one: an axis whose labels disagree with its own
 * gridlines is worse than an ugly axis. So candidates are scored — 3 to 6
 * intervals, least wasted headroom wins, and a fractional step is refused
 * outright below a ceiling of 100 where every real value is a whole count.
 */
export function niceScale(max: number, minSteps = 3, maxSteps = 6): { ceiling: number; steps: number } {
  if (!Number.isFinite(max) || max <= 0) return { ceiling: 1, steps: 1 };

  const MULTIPLES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  const magnitude = 10 ** Math.floor(Math.log10(max / maxSteps));

  let best: { ceiling: number; steps: number; waste: number } | null = null;

  for (const scale of [magnitude, magnitude * 10]) {
    for (const m of MULTIPLES) {
      const step = m * scale;
      if (step <= 0) continue;

      const steps = Math.ceil(max / step);
      if (steps < minSteps || steps > maxSteps) continue;

      const ceiling = step * steps;
      /* A step of 2.5 renders as "3" once shortened, putting the label
         somewhere the gridline is not. Only tolerated when the numbers are
         large enough that the shortening keeps a decimal. */
      if (!Number.isInteger(step) && ceiling < 100) continue;

      /* ⚠️ SCORED, NOT JUST LEAST-WASTE. Minimising headroom alone always
         prefers MORE gridlines, because finer steps waste less — which produced
         seven labels on a 250px chart. A small penalty per step away from four
         keeps the axis at the reference's density unless the numbers genuinely
         need otherwise. */
      const waste = (ceiling - max) / ceiling + Math.abs(steps - 4) * 0.015;
      if (!best || waste < best.waste) best = { ceiling, steps, waste };
    }
  }

  /* Nothing scored — a very small or very odd maximum. Fall back to whole
     numbers, which is always readable even if it is not pretty. */
  if (!best) {
    const steps = Math.min(maxSteps, Math.max(1, Math.ceil(max)));
    return { ceiling: Math.ceil(max), steps };
  }

  return { ceiling: best.ceiling, steps: best.steps };
}
