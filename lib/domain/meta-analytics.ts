/* ⚠️ FROM THE DOMAIN LAYER, NEVER FROM `lib/db`. An eslint rule forbids the
   latter and it is not a style preference: a domain module that imports a query
   file drags `server-only` into anything that imports IT, and this file is read
   by a client component. Both types already live here — see meta-studio.ts. */
import type { MetricPoint, StudioPost } from './meta-studio';

/* ============================================================================
 * ANALYTICS & INSIGHTS — the Studio's last tab, owner 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Proper graphs, donuts, vertical bars, and all these things but very
 * beautifully. Also add any other type of graph."*
 *
 * Pure. Every function takes its data and its clock; the charts draw what these
 * return and decide nothing themselves.
 *
 * ── ⚠️ THE TRAP THIS FILE EXISTS TO AVOID ──────────────────────────────────
 * Facebook and Instagram BARELY SHARE A METRIC NAME. Facebook reports
 * `page_post_engagements`, `page_views_total`, `page_video_views`; Instagram
 * reports `reach`, `views`, `total_interactions`, `profile_views`. Putting both
 * on one axis because both are called "views" would compare Facebook's VIDEO
 * views against Instagram's ALL views and draw a confident, wrong picture.
 *
 * So every cross-platform comparison here goes through `COMPARABLE`, which pairs
 * only metrics that genuinely mean the same thing and says why in each case.
 * Anything Facebook does not report — reach, most notably — is absent rather
 * than zero, because zero is a measurement and absence is not.
 * ========================================================================= */

export const FB = {
  followers: 'page_follows',
  newFollows: 'page_daily_follows_unique',
  pageViews: 'page_views_total',
  engagements: 'page_post_engagements',
  videoViews: 'page_video_views',
} as const;

export const IG = {
  followers: 'followers_count',
  reach: 'reach',
  views: 'views',
  profileViews: 'profile_views',
  accountsEngaged: 'accounts_engaged',
  interactions: 'total_interactions',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
} as const;

/**
 * The radar's axes.
 *
 * ── ⚠️ AN AXIS DECLARES WHICH PLATFORMS ACTUALLY REPORT IT ─────────────────
 * The owner's reference draws a pentagon, and five axes are genuinely available
 * — but not five SHARED ones. Facebook publishes no reach figure at all: it
 * retired `page_impressions_unique` and offers no replacement. So Reach is an
 * Instagram-only axis, and the chart draws Facebook's shape with a visible break
 * there rather than a vertex at the centre. A vertex at zero would say "nobody
 * saw it"; a break says "we cannot know", which is the truth.
 *
 * ⚠️ AND `views` CARRIES A CAVEAT RATHER THAN BEING DROPPED. Facebook's
 * `page_video_views` counts VIDEO plays; Instagram's `views` counts every view
 * of anything. Both are real, both are "views", and they measure different
 * populations — so the axis exists (the reference wants it) and its tooltip says
 * exactly what each side is counting. Silently averaging them onto one label is
 * the thing this file exists to prevent.
 */
export const COMPARABLE: readonly {
  readonly key: string;
  readonly label: string;
  /** Empty when the platform does not report this at all. */
  readonly facebook: string;
  readonly instagram: string;
  readonly why: string;
}[] = [
  {
    key: 'reach',
    label: 'Reach',
    /* ⚠️ Deliberately empty — see the header. */
    facebook: '',
    instagram: IG.reach,
    why: 'Instagram only. Facebook retired its unique-reach metric and offers no replacement, so its shape breaks here rather than sitting at zero.',
  },
  {
    key: 'views',
    label: 'Views',
    facebook: FB.videoViews,
    instagram: IG.views,
    why: 'Different populations: Facebook counts video plays, Instagram counts every view. Comparable in spirit, not in definition.',
  },
  {
    key: 'engagements',
    label: 'Engagements',
    facebook: FB.engagements,
    instagram: IG.interactions,
    why: 'Both count actions taken on posts — likes, comments, shares and saves.',
  },
  {
    key: 'profile-views',
    label: 'Profile visits',
    facebook: FB.pageViews,
    instagram: IG.profileViews,
    why: 'Both count visits to the account’s own page rather than to a post.',
  },
  {
    key: 'followers',
    label: 'Followers',
    facebook: FB.followers,
    instagram: IG.followers,
    why: 'Both are the account’s follower total on the day.',
  },
];

/* ---- Shaping the series -------------------------------------------------- */

export interface DayPoint {
  readonly date: string;
  readonly value: number | null;
}

/**
 * One metric's daily series across a date range.
 *
 * ⚠️ A DAY WITH NO ROW IS `null`, NEVER 0. The charts lift the pen on a null, so
 * a gap in collection reads as a gap rather than as a day nobody engaged. This
 * is the same rule the Overview's chart follows and it is the difference between
 * "we did not collect" and "it was zero".
 */
export function series(
  metrics: readonly MetricPoint[],
  metricKey: string,
  platform: string | null,
  dates: readonly string[],
): readonly DayPoint[] {
  const byDate = new Map<string, number>();

  for (const m of metrics) {
    if (m.metricKey !== metricKey) continue;
    if (platform !== null && m.platform !== platform) continue;
    byDate.set(m.onDate, (byDate.get(m.onDate) ?? 0) + m.value);
  }

  return dates.map((date) => ({
    date,
    value: byDate.has(date) ? byDate.get(date)! : null,
  }));
}

/** Every date in the window, oldest first — the x-axis every chart shares. */
export function dateRange(from: string, to: string): readonly string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDay(d)) out.push(d);
  return out;
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function sumOf(
  metrics: readonly MetricPoint[],
  metricKey: string,
  platform: string | null = null,
): number {
  return metrics.reduce(
    (n, m) =>
      m.metricKey === metricKey && (platform === null || m.platform === platform)
        ? n + m.value
        : n,
    0,
  );
}

/* ---- The interaction mix ------------------------------------------------- */

export interface StackBand {
  readonly key: string;
  readonly label: string;
  readonly token: string;
  readonly values: readonly number[];
}

export interface StackedSeries {
  readonly dates: readonly string[];
  readonly bands: readonly StackBand[];
  readonly total: number;
  readonly max: number;
}

/**
 * Likes, comments, shares and saves stacked per day.
 *
 * ⚠️ A NEGATIVE VALUE IS CLAMPED TO ZERO, AND THIS IS NOT DEFENSIVE PADDING —
 * Meta really does return one. `saves` has a minimum of **-1** in the collected
 * data, because a save can be undone and the daily delta goes negative. A
 * stacked area cannot draw a negative band: it would subtract from the band
 * below it and silently misreport every layer above. Clamping loses one unit of
 * information; not clamping corrupts the whole chart.
 *
 * ⚠️ INSTAGRAM ONLY, by construction. Facebook reports a single
 * `page_post_engagements` total with no breakdown, so there is nothing to stack.
 * The chart says so rather than drawing one platform's data under a title that
 * implies both.
 */
export function interactionMix(
  metrics: readonly MetricPoint[],
  dates: readonly string[],
): StackedSeries {
  /* The reference's palette: likes rose, comments blue, shares cyan, saves
     amber — and in that order bottom-to-top, so the largest band (likes, by an
     order of magnitude on the live data) is the base the others sit on. */
  const bands: readonly { key: string; label: string; token: string }[] = [
    { key: IG.likes, label: 'Likes', token: 'chart-2' },
    { key: IG.comments, label: 'Comments', token: 'chart-1' },
    { key: IG.shares, label: 'Shares', token: 'chart-7' },
    { key: IG.saves, label: 'Saves', token: 'chart-6' },
  ];

  const built = bands.map((b) => ({
    ...b,
    values: series(metrics, b.key, 'instagram', dates).map((p) =>
      p.value === null ? 0 : Math.max(0, p.value),
    ),
  }));

  let max = 0;
  let total = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const day = built.reduce((n, b) => n + b.values[i], 0);
    total += day;
    if (day > max) max = day;
  }

  return { dates, bands: built, total, max };
}

/* ---- Platform comparison ------------------------------------------------- */

export interface RadarAxis {
  readonly key: string;
  readonly label: string;
  readonly why: string;
  /** Null when the platform does not report this metric at all. */
  readonly facebook: number | null;
  readonly instagram: number | null;
  /** Each value as a share of the larger, so the two sit on one shape. */
  readonly facebookScaled: number | null;
  readonly instagramScaled: number | null;
}

/**
 * The radar's axes.
 *
 * ⚠️ SCALED PER AXIS, NOT GLOBALLY, and the reason is arithmetic: followers are
 * in the tens and interactions in the hundreds, so one global scale would flatten
 * every small axis to nothing and the shape would carry no information. Each axis
 * is normalised against its own larger value, which is what makes the shape
 * readable — and it means the radar shows PROPORTION, never magnitude. The
 * figures are printed beside it for that reason.
 */
export function platformRadar(metrics: readonly MetricPoint[]): readonly RadarAxis[] {
  return COMPARABLE.map((c) => {
    /* Followers are a level, not a flow: summing thirty days of a follower count
       would report thirty times the followers. The latest reading is the figure. */
    const isLevel = c.key === 'followers';

    const read = (key: string, platform: string) =>
      key === ''
        ? null
        : isLevel
          ? latest(metrics, key, platform)
          : sumOf(metrics, key, platform);

    const fb = read(c.facebook, 'facebook');
    const ig = read(c.instagram, 'instagram');

    const larger = Math.max(fb ?? 0, ig ?? 0, 1);

    return {
      key: c.key,
      label: c.label,
      why: c.why,
      facebook: fb,
      instagram: ig,
      /* ⚠️ NULL, NOT 0, WHERE A PLATFORM DOES NOT REPORT THE METRIC. The chart
         breaks its shape on a null; a zero would draw a vertex at the centre and
         claim the figure was measured and found to be nothing. */
      facebookScaled: fb === null ? null : fb / larger,
      instagramScaled: ig === null ? null : ig / larger,
    };
  });
}

function latest(
  metrics: readonly MetricPoint[],
  metricKey: string,
  platform: string,
): number {
  const rows = metrics
    .filter((m) => m.metricKey === metricKey && m.platform === platform)
    .sort((a, b) => a.onDate.localeCompare(b.onDate));
  return rows.length === 0 ? 0 : rows[rows.length - 1].value;
}

/* ---- Reach against engagement -------------------------------------------- */

export interface ScatterPoint {
  readonly id: string;
  readonly label: string;
  readonly platform: string;
  readonly surface: string;
  readonly reach: number;
  readonly interactions: number;
  readonly rate: number;
  readonly permalink: string | null;
}

export const SCATTER_MEASURES = ['interactions', 'reach', 'rate'] as const;
export type ScatterMeasure = (typeof SCATTER_MEASURES)[number];

export const MEASURE_LABEL: Readonly<Record<ScatterMeasure, string>> = {
  interactions: 'By engagements',
  reach: 'By reach',
  rate: 'By engagement rate',
};

export interface ScatterData {
  readonly points: readonly ScatterPoint[];
  readonly maxReach: number;
  readonly maxInteractions: number;
  /** Posts we hold but cannot place, because Meta gave no reach for them. */
  readonly excluded: number;
}

/**
 * Every post as a point: reach across, interactions up.
 *
 * ⚠️ A POST WITH NO REACH IS EXCLUDED AND COUNTED, never plotted at x=0. Only 25
 * of the 50 collected posts carry a reach figure — Facebook posts largely do not
 * — and a column of them stacked on the y-axis would look like a real finding
 * about posts that reached nobody. The count is shown under the chart so the
 * absence is visible rather than silent.
 */
export function reachVsEngagement(posts: readonly StudioPost[]): ScatterData {
  const points: ScatterPoint[] = [];
  let excluded = 0;

  for (const p of posts) {
    const reach = p.reach ?? 0;
    if (!p.reach || reach <= 0) {
      excluded += 1;
      continue;
    }

    const interactions =
      (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);

    points.push({
      id: p.id,
      label: (p.caption ?? '').slice(0, 60) || 'Untitled post',
      platform: p.platform,
      surface: p.mediaType ?? 'post',
      reach,
      interactions,
      rate: (interactions / reach) * 100,
      permalink: p.permalink,
    });
  }

  return {
    points,
    maxReach: points.reduce((n, p) => Math.max(n, p.reach), 0),
    maxInteractions: points.reduce((n, p) => Math.max(n, p.interactions), 0),
    excluded,
  };
}

/* ---- The funnel ---------------------------------------------------------- */

export interface FunnelStage {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly token: string;
  /** Share of the stage above, or null for the first. */
  readonly conversion: number | null;
  readonly note: string;
}

/**
 * Reach → engaged → interactions → profile views.
 *
 * ⚠️ INSTAGRAM ONLY, AND THE STAGES ARE A REAL SEQUENCE. Every one of these four
 * is an Instagram metric measuring a narrower population than the one above it,
 * which is what makes a funnel the right shape. Adding Facebook would mean
 * inventing a reach it does not report.
 *
 * ⚠️ A CONVERSION ABOVE 100% IS SHOWN AS IT IS, not capped. `profile_views` can
 * exceed `accounts_engaged` — somebody can visit the profile without touching a
 * post — and quietly capping it at 100% would hide a genuine and interesting
 * fact about how people arrive.
 */
export function engagementFunnel(metrics: readonly MetricPoint[]): readonly FunnelStage[] {
  const reach = sumOf(metrics, IG.reach, 'instagram');
  const views = sumOf(metrics, IG.views, 'instagram');
  const engaged = sumOf(metrics, IG.accountsEngaged, 'instagram');
  const interactions = sumOf(metrics, IG.interactions, 'instagram');
  const profile = sumOf(metrics, IG.profileViews, 'instagram');
  const newFollows = sumOf(metrics, FB.newFollows, 'facebook');

  const share = (v: number, of: number) => (of === 0 ? null : (v / of) * 100);

  return [
    {
      key: 'reach',
      label: 'Reached',
      value: reach,
      token: 'chart-1',
      conversion: null,
      note: 'Instagram · accounts that saw a post at least once.',
    },
    {
      /* ⚠️ VIEWS SIT *BELOW* REACH IN THE LIST AND ABOVE IT IN VALUE, which
         looks like an error and is not: reach counts accounts, views counts
         viewings, and one account can view repeatedly. Its conversion is
         therefore normally well over 100% and that is the interesting figure —
         it is how many times the average reached account came back. */
      key: 'views',
      label: 'Views',
      value: views,
      token: 'chart-4',
      conversion: share(views, reach),
      note: 'Instagram · total viewings. One account can view more than once.',
    },
    {
      key: 'engaged',
      label: 'Engaged',
      value: engaged,
      token: 'chart-4',
      conversion: share(engaged, reach),
      note: 'Instagram · of those, the accounts that did something.',
    },
    {
      key: 'interactions',
      label: 'Interactions',
      value: interactions,
      token: 'chart-2',
      conversion: share(interactions, engaged),
      note: 'Instagram · total actions taken. One account can act more than once.',
    },
    {
      key: 'profile',
      label: 'Profile views',
      value: profile,
      token: 'chart-3',
      conversion: share(profile, engaged),
      note: 'Instagram · visits to the profile itself. Can exceed engagement — people arrive from elsewhere.',
    },
    {
      /* ⚠️ THE ONLY FACEBOOK STAGE, AND ITS NOTE SAYS SO. Instagram publishes no
         daily new-follow metric at all, so the last rung of the ladder can only
         come from Facebook. Every other figure here is Instagram's. Leaving the
         stage out would be tidier and would hide the one number that says
         whether any of this turned into an audience; labelling it plainly is the
         better trade, and it is why the panel is a ladder of stages rather than
         a strict funnel. */
      key: 'follows',
      label: 'New follows',
      value: newFollows,
      token: 'chart-6',
      /* No conversion: it is not a subset of the stage above, and a percentage
         across two platforms would be arithmetic dressed up as a finding. */
      conversion: null,
      note: 'Facebook · accounts that followed during the period. Instagram publishes no daily equivalent.',
    },
  ];
}

/* ---- By weekday ---------------------------------------------------------- */

export interface WeekdayBar {
  readonly weekday: number;
  readonly label: string;
  readonly posts: number;
  readonly reach: number;
  readonly interactions: number;
  readonly rate: number | null;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Posting and performance by day of week.
 *
 * ⚠️ THE DAY IS KARACHI'S, NOT UTC'S. A post published at 1am Karachi is the
 * previous day in UTC, so a UTC weekday would file a Monday-morning post under
 * Sunday — and the whole point of this chart is to say which day works.
 *
 * ⚠️ AND THE RATE IS NULL WHERE NOTHING WAS POSTED, never 0%. A day with no
 * posts has no engagement rate; drawing it as zero would make an untried day
 * look like a failed one.
 */
export function byWeekday(posts: readonly StudioPost[]): readonly WeekdayBar[] {
  const buckets = WEEKDAY_LABELS.map((label, i) => ({
    weekday: i,
    label,
    posts: 0,
    reach: 0,
    interactions: 0,
  }));

  for (const p of posts) {
    const local = new Date(Date.parse(p.postedAt) + 5 * 3_600_000);
    /* getUTCDay on the shifted instant gives the Karachi weekday; 0 = Sunday. */
    const idx = (local.getUTCDay() + 6) % 7;
    const b = buckets[idx];
    b.posts += 1;
    b.reach += p.reach ?? 0;
    b.interactions += (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
  }

  return buckets.map((b) => ({
    ...b,
    rate: b.posts === 0 || b.reach === 0 ? null : (b.interactions / b.reach) * 100,
  }));
}

/* ---- Correlation --------------------------------------------------------- */

/**
 * Pearson's r between two daily series.
 *
 * ⚠️ NULL RATHER THAN ZERO when it cannot be computed — fewer than three shared
 * days, or one series flat. An r of 0 means "measured, and unrelated"; a null
 * means "not measurable", and a chart that printed 0 for the second would be
 * making a claim it has not earned.
 */
export function correlation(
  a: readonly DayPoint[],
  b: readonly DayPoint[],
): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    /* Bound to locals: TypeScript cannot narrow an indexed access across a
       guard, because `a[i]` could in principle be a different object each read. */
    const x = a[i].value;
    const y = b[i].value;
    if (x === null || y === null) continue;
    pairs.push([x, y]);
  }
  if (pairs.length < 3) return null;

  const n = pairs.length;
  const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;

  let num = 0;
  let devA = 0;
  let devB = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanA;
    const dy = y - meanB;
    num += dx * dy;
    devA += dx * dx;
    devB += dy * dy;
  }

  /* A flat series has no variance, so r is undefined rather than 0. */
  if (devA === 0 || devB === 0) return null;
  return num / Math.sqrt(devA * devB);
}

export function correlationWord(r: number | null): string {
  if (r === null) return 'not enough data to say';
  const abs = Math.abs(r);
  const strength = abs > 0.7 ? 'strongly' : abs > 0.4 ? 'moderately' : abs > 0.2 ? 'weakly' : 'barely';
  return `${strength} ${r < 0 ? 'inversely ' : ''}related`;
}

/* ---- The headline insights ----------------------------------------------- */

export interface Insight {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly token: string;
}

/**
 * The written observations above the charts.
 *
 * ⚠️ EVERY ONE IS DERIVED, AND ONE IS DELIBERATELY ABSENT WHEN IT CANNOT BE
 * EARNED. These are not written by a model: the single AI pass this feature ever
 * had returned a client's name as "NAYA MARKITING", which is why every figure in
 * this product is typeset from columns. An insight that cannot be computed is
 * omitted rather than softened into a platitude — a list of four confident
 * sentences where one is filler teaches the reader to trust none of them.
 */
export function insights(input: {
  readonly metrics: readonly MetricPoint[];
  readonly posts: readonly StudioPost[];
  readonly dates: readonly string[];
}): readonly Insight[] {
  const { metrics, posts, dates } = input;
  const out: Insight[] = [];

  /* 1 · The best weekday, only if one is genuinely ahead. */
  const days = byWeekday(posts).filter((d) => d.rate !== null);
  if (days.length >= 2) {
    const sorted = [...days].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    const best = sorted[0];
    const rest = sorted.slice(1);
    const restAvg = rest.reduce((n, d) => n + (d.rate ?? 0), 0) / rest.length;

    /* A tenth of a percent ahead is noise, not a finding. */
    if ((best.rate ?? 0) > restAvg * 1.15) {
      out.push({
        key: 'best-day',
        title: `${best.label} performs best`,
        detail: `${(best.rate ?? 0).toFixed(2)}% engagement across ${best.posts} ${best.posts === 1 ? 'post' : 'posts'}, against ${restAvg.toFixed(2)}% on other days.`,
        token: 'chart-3',
      });
    }
  }

  /* 2 · Reach against interactions — does more reach mean more engagement? */
  const r = correlation(
    series(metrics, IG.reach, 'instagram', dates),
    series(metrics, IG.interactions, 'instagram', dates),
  );
  if (r !== null) {
    out.push({
      key: 'correlation',
      title: `Reach and interactions are ${correlationWord(r)}`,
      detail:
        Math.abs(r) > 0.4
          ? 'Days that reached more accounts also saw more actions, so widening reach is worth the effort.'
          : 'Reaching more accounts has not reliably produced more actions — the content, not the audience size, is deciding.',
      token: Math.abs(r) > 0.4 ? 'chart-1' : 'chart-6',
    });
  }

  /* 3 · Which surface earns its place. */
  const bySurface = new Map<string, { posts: number; reach: number; inter: number }>();
  for (const p of posts) {
    const key = p.mediaType ?? 'post';
    const b = bySurface.get(key) ?? { posts: 0, reach: 0, inter: 0 };
    b.posts += 1;
    b.reach += p.reach ?? 0;
    b.inter += (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
    bySurface.set(key, b);
  }
  const surfaces = [...bySurface.entries()]
    .filter(([, b]) => b.posts >= 2 && b.reach > 0)
    .map(([k, b]) => ({ key: k, avgReach: b.reach / b.posts }))
    .sort((a, b) => b.avgReach - a.avgReach);

  if (surfaces.length >= 2) {
    const multiple = surfaces[0].avgReach / Math.max(1, surfaces[surfaces.length - 1].avgReach);
    if (multiple >= 1.2) {
      out.push({
        key: 'surface',
        title: `${surfaces[0].key} reaches ${multiple.toFixed(1)}× further`,
        detail: `Average reach per ${surfaces[0].key} is ${Math.round(surfaces[0].avgReach)}, against ${Math.round(surfaces[surfaces.length - 1].avgReach)} for a ${surfaces[surfaces.length - 1].key}.`,
        token: 'chart-2',
      });
    }
  }

  /* 4 · Whether the trend is up, over halves of the window. */
  const reach = series(metrics, IG.reach, 'instagram', dates);
  const half = Math.floor(reach.length / 2);
  const sumHalf = (from: number, to: number) =>
    reach.slice(from, to).reduce((n, p) => n + (p.value ?? 0), 0);
  const first = sumHalf(0, half);
  const second = sumHalf(half, reach.length);

  if (first > 0 && half >= 3) {
    const change = ((second - first) / first) * 100;
    if (Math.abs(change) >= 10) {
      out.push({
        key: 'trend',
        title: `Reach is ${change > 0 ? 'up' : 'down'} ${Math.abs(Math.round(change))}% across the period`,
        detail: `The second half reached ${Math.round(second).toLocaleString()} against ${Math.round(first).toLocaleString()} in the first.`,
        token: change > 0 ? 'chart-3' : 'chart-8',
      });
    }
  }

  return out;
}


/* ---- Against the previous period ----------------------------------------- */

export interface Delta {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly previous: number;
  /** Null when there is no earlier figure to compare against. */
  readonly percent: number | null;
  readonly token: string;
}

/**
 * Each headline metric against the same-length window before it.
 *
 * ⚠️ NULL WHEN THE EARLIER PERIOD IS EMPTY, never +100%. Growth from nothing has
 * no percentage — the first month of collection would otherwise show every card
 * up by infinity or by a made-up hundred, which is the reading somebody would
 * quote in a client meeting.
 *
 * ⚠️ AND THE COMPARISON WINDOW IS THE CALLER'S, not this function's. The page
 * fetches the previous period with the same number of days; computing it here
 * from a clock would put a second definition of "the period before" in the
 * codebase, and the two would disagree the first time somebody picked a custom
 * range.
 */
export function periodDeltas(input: {
  readonly current: readonly MetricPoint[];
  readonly previous: readonly MetricPoint[];
}): readonly Delta[] {
  const { current, previous } = input;

  const pair = (
    key: string,
    label: string,
    token: string,
    read: (m: readonly MetricPoint[]) => number,
  ): Delta => {
    const now = read(current);
    const before = read(previous);
    return {
      key,
      label,
      value: now,
      previous: before,
      percent: before === 0 ? null : ((now - before) / before) * 100,
      token,
    };
  };

  /* Followers are a level: the change is the difference between the two latest
     readings, not between two sums.

     ⚠️ AND ONLY PLATFORMS PRESENT IN BOTH WINDOWS MAY ENTER THE COMPARISON.
     Instagram's follower count began being collected today, so the earlier
     window has no reading for it at all — counting it on one side only would
     have added sixteen followers to "now" and none to "before", and reported
     that as growth. It is not growth; it is a platform we started measuring.
     The headline VALUE still counts every platform, because that total is
     true. */
  const followersNow = latestShared(current, previous, [IG.followers, FB.followers]);
  const followersBefore = latestShared(previous, current, [IG.followers, FB.followers]);

  return [
    pair('reach', 'Total reach', 'chart-1', (m) => sumOf(m, IG.reach, 'instagram')),
    {
      key: 'followers',
      label: 'Followers',
      /* The true current total, across every linked platform. */
      value: latestAny(current, [IG.followers, FB.followers]),
      previous: followersBefore,
      /* ...but the PERCENTAGE compares only what both windows measured. */
      percent:
        followersBefore === 0
          ? null
          : ((followersNow - followersBefore) / followersBefore) * 100,
      token: 'chart-3',
    },
    pair(
      'engagements',
      'Engagements',
      'chart-2',
      (m) => sumOf(m, IG.interactions, 'instagram') + sumOf(m, FB.engagements, 'facebook'),
    ),
    pair('engaged', 'Accounts engaged', 'chart-4', (m) =>
      sumOf(m, IG.accountsEngaged, 'instagram'),
    ),
    pair(
      'profile',
      'Profile visits',
      'chart-6',
      (m) => sumOf(m, IG.profileViews, 'instagram') + sumOf(m, FB.pageViews, 'facebook'),
    ),
  ];
}

/**
 * The latest reading of each key, counting only keys the OTHER window also has.
 *
 * ⚠️ THIS IS WHAT STOPS A NEWLY-COLLECTED PLATFORM READING AS GROWTH. A metric
 * present in one window and absent from the other cannot be compared at all, so
 * it is excluded from both sides rather than counted on one.
 */
function latestShared(
  from: readonly MetricPoint[],
  other: readonly MetricPoint[],
  keys: readonly string[],
): number {
  let total = 0;
  for (const key of keys) {
    if (!other.some((m) => m.metricKey === key)) continue;
    const rows = from
      .filter((m) => m.metricKey === key)
      .sort((a, b) => a.onDate.localeCompare(b.onDate));
    if (rows.length > 0) total += rows[rows.length - 1].value;
  }
  return total;
}

/** The latest reading of whichever of these keys the platform reports. */
function latestAny(metrics: readonly MetricPoint[], keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    const rows = metrics
      .filter((m) => m.metricKey === key)
      .sort((a, b) => a.onDate.localeCompare(b.onDate));
    if (rows.length > 0) total += rows[rows.length - 1].value;
  }
  return total;
}

/* ---- Followers over time, and posts per day ------------------------------ */

export interface LevelSeries {
  readonly points: readonly (number | null)[];
  /** Which platforms the line actually includes. */
  readonly platforms: readonly string[];
  /** True when a linked platform had to be left out for want of history. */
  readonly partial: boolean;
  readonly note: string;
}

/**
 * The follower total over time.
 *
 * ⚠️ FOLLOWERS ARE A LEVEL, SO EACH PLATFORM'S LAST KNOWN READING IS CARRIED
 * FORWARD. A flow metric is zero on a day nothing happened; a follower count is
 * not — the followers did not cease to exist on a day the sync did not run.
 * Treating a missing day as zero would draw a comb.
 *
 * ⚠️ AND A PLATFORM WITH FEWER THAN TWO READINGS IS LEFT OUT ENTIRELY, which is
 * the bug this function exists to fix. Instagram's `followers_count` is a
 * profile snapshot, so today there is exactly ONE reading of it, taken today.
 * Including it would step the line up by sixteen on the final day and read as a
 * day of extraordinary growth — when all that happened is that we started
 * recording a number that had been true all along. Absence is not zero, and a
 * step is not growth.
 *
 * The card's headline figure still counts every platform; `partial` is how the
 * tile knows to say the line is narrower than the number above it.
 */
export function followerLevelSeries(
  metrics: readonly MetricPoint[],
  dates: readonly string[],
): LevelSeries {
  const sources: readonly { platform: string; key: string; label: string }[] = [
    { platform: 'facebook', key: FB.followers, label: 'Facebook' },
    { platform: 'instagram', key: IG.followers, label: 'Instagram' },
  ];

  const included: string[] = [];
  const excluded: string[] = [];
  const carried: number[][] = [];

  for (const src of sources) {
    const byDate = new Map<string, number>();
    for (const m of metrics) {
      if (m.metricKey !== src.key || m.platform !== src.platform) continue;
      byDate.set(m.onDate, m.value);
    }

    /* Nothing at all for this platform: it is simply not linked, or not yet
       collected. Either way it is neither included nor a caveat worth naming. */
    if (byDate.size === 0) continue;

    if (byDate.size < 2) {
      excluded.push(src.label);
      continue;
    }

    included.push(src.label);

    let last: number | null = null;
    carried.push(
      dates.map((d) => {
        if (byDate.has(d)) last = byDate.get(d)!;
        /* Before this platform's first reading there is nothing to carry, so the
           day contributes nothing rather than a zero. */
        return last ?? Number.NaN;
      }),
    );
  }

  const points = dates.map((_, i) => {
    let sum = 0;
    let known = false;
    for (const line of carried) {
      if (Number.isNaN(line[i])) continue;
      sum += line[i];
      known = true;
    }
    return known ? sum : null;
  });

  return {
    points,
    platforms: included,
    partial: excluded.length > 0,
    note:
      excluded.length === 0
        ? included.join(' and ')
        : `${included.join(' and ') || 'No platform'} only — ${excluded.join(' and ')} ${excluded.length === 1 ? 'has' : 'have'} one reading so far`,
  };
}

/**
 * Posts published per day.
 *
 * ⚠️ A DAY WITH NO POST IS 0, NOT NULL, and this is the opposite of the rule
 * every metric series follows — deliberately. A missing metric row means "we did
 * not collect"; a day with no post in a collected range means "nothing was
 * published", which is a measurement and belongs on the line as a zero.
 *
 * ⚠️ THE DAY IS KARACHI'S. A post at 1am Karachi is the previous day in UTC.
 */
export function postsPerDay(
  posts: readonly StudioPost[],
  dates: readonly string[],
): readonly number[] {
  const byDate = new Map<string, number>();

  for (const p of posts) {
    const local = new Date(Date.parse(p.postedAt) + 5 * 3_600_000);
    const key = local.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }

  return dates.map((d) => byDate.get(d) ?? 0);
}

/* ---- Granularity --------------------------------------------------------- */

export const GRANULARITIES = ['daily', 'weekly', 'monthly'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface Bucketed {
  readonly labels: readonly string[];
  readonly tooltips: readonly string[];
  /** One array per input series, in the order they were given. */
  readonly series: readonly (readonly (number | null)[])[];
}

/**
 * Re-bucket daily series into weeks or months.
 *
 * ⚠️ A BUCKET IS THE SUM OF ITS DAYS, AND A BUCKET OF ONLY NULLS STAYS NULL.
 * Summing a week in which nothing was collected would produce a confident zero
 * where the daily chart correctly showed a gap — the same "absence is not zero"
 * rule the rest of this file follows, applied one level up.
 *
 * ⚠️ AND A PARTIAL BUCKET IS NOT MARKED SPECIAL. The last week of a window is
 * usually a few days short, so its total is genuinely lower — that is a fact
 * about the window, not about performance. The tooltip names the dates the
 * bucket covers so a reader can see it for themselves rather than being told a
 * number is "incomplete" and left to guess by how much.
 */
export function bucketSeries(
  dates: readonly string[],
  series: readonly (readonly (number | null)[])[],
  granularity: Granularity,
): Bucketed {
  if (granularity === 'daily') {
    return {
      labels: [...dates],
      tooltips: [...dates],
      series: series.map((s) => [...s]),
    };
  }

  /* Which bucket each day belongs to, as an index into the bucket list. */
  const keyOf = (iso: string) =>
    granularity === 'monthly' ? iso.slice(0, 7) : isoWeekKey(iso);

  const order: string[] = [];
  const members = new Map<string, number[]>();

  dates.forEach((d, i) => {
    const key = keyOf(d);
    if (!members.has(key)) {
      members.set(key, []);
      order.push(key);
    }
    members.get(key)!.push(i);
  });

  const bucketed = series.map((s) =>
    order.map((key) => {
      const idx = members.get(key)!;
      let sum = 0;
      let known = false;
      for (const i of idx) {
        const v = s[i];
        if (v === null || v === undefined) continue;
        sum += v;
        known = true;
      }
      return known ? sum : null;
    }),
  );

  return {
    labels: order.map((key) => {
      const idx = members.get(key)!;
      return dates[idx[0]];
    }),
    tooltips: order.map((key) => {
      const idx = members.get(key)!;
      const first = dates[idx[0]];
      const last = dates[idx[idx.length - 1]];
      return first === last ? first : `${first} → ${last}`;
    }),
    series: bucketed,
  };
}

/**
 * How many buckets a granularity would produce.
 *
 * ⚠️ USED TO DISABLE A CHOICE RATHER THAN LET IT DRAW A USELESS CHART. A
 * seven-day window has one week and one month in it, and a line through a single
 * point is a dot — so the control greys those out and says why, instead of
 * letting somebody pick an option that silently empties the panel.
 */
export function bucketCount(dates: readonly string[], granularity: Granularity): number {
  if (granularity === 'daily') return dates.length;
  const keys = new Set(
    dates.map((d) => (granularity === 'monthly' ? d.slice(0, 7) : isoWeekKey(d))),
  );
  return keys.size;
}

/** The Monday-anchored week a date falls in, as a sortable key. */
function isoWeekKey(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  /* Back up to Monday. getUTCDay is 0 for Sunday. */
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

/* ---- What a post-shaped chart is measuring ------------------------------- */

export const POST_MEASURES = ['posts', 'engagements', 'reach'] as const;
export type PostMeasure = (typeof POST_MEASURES)[number];

export const POST_MEASURE_LABEL: Readonly<Record<PostMeasure, string>> = {
  posts: 'Posts',
  engagements: 'Engagements',
  reach: 'Reach',
};

/**
 * The value one post contributes under a given measure.
 *
 * ⚠️ SHARED BY THE WEEKDAY BARS AND THE HEATMAP, so "Engagements" means the same
 * thing on both. Two charts side by side reading the same word differently is
 * the kind of quiet inconsistency nobody reports and everybody misreads.
 */
export function measureOf(
  post: Pick<StudioPost, 'reach' | 'likes' | 'comments' | 'shares' | 'saves'>,
  measure: PostMeasure,
): number {
  if (measure === 'posts') return 1;
  if (measure === 'reach') return post.reach ?? 0;
  return (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0) + (post.saves ?? 0);
}

