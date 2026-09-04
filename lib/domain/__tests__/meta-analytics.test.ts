import { describe, expect, it } from 'vitest';

import type { MetricPoint, StudioPost } from '../meta-studio';

import {
  COMPARABLE,
  IG,
  bucketCount,
  bucketSeries,
  byWeekday,
  correlation,
  correlationWord,
  dateRange,
  engagementFunnel,
  followerLevelSeries,
  insights,
  interactionMix,
  measureOf,
  periodDeltas,
  platformRadar,
  postsPerDay,
  reachVsEngagement,
  series,
} from '../meta-analytics';

const DATES = dateRange('2026-09-01', '2026-09-07');

function metric(over: Partial<MetricPoint> = {}): MetricPoint {
  return {
    onDate: '2026-09-01',
    platform: 'instagram',
    metricKey: IG.reach,
    value: 100,
    ...over,
  } as MetricPoint;
}

function post(over: Partial<StudioPost> = {}): StudioPost {
  return {
    id: 'p1',
    platform: 'instagram',
    postedAt: '2026-09-01T10:00:00.000Z',
    caption: 'A post',
    permalink: 'https://instagram.com/p/1',
    mediaType: 'IMAGE',
    reach: 100,
    views: 120,
    likes: 5,
    comments: 1,
    shares: 0,
    saves: 0,
    ...over,
  } as StudioPost;
}

describe('the date range', () => {
  it('is inclusive at both ends', () => {
    expect(DATES).toHaveLength(7);
    expect(DATES[0]).toBe('2026-09-01');
    expect(DATES[6]).toBe('2026-09-07');
  });

  it('crosses a month boundary', () => {
    const r = dateRange('2026-08-30', '2026-09-02');
    expect(r).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('a metric series', () => {
  /* ⚠️ A DAY WITH NO ROW IS NULL, NOT 0 — the charts lift the pen on a null, so
     a gap in collection reads as a gap rather than as a day nobody engaged. */
  it('reports a missing day as null rather than zero', () => {
    const s = series([metric({ onDate: '2026-09-03', value: 50 })], IG.reach, 'instagram', DATES);
    expect(s[0].value).toBeNull();
    expect(s[2].value).toBe(50);
  });

  it('keeps a genuine zero as zero', () => {
    const s = series([metric({ onDate: '2026-09-01', value: 0 })], IG.reach, 'instagram', DATES);
    expect(s[0].value).toBe(0);
  });

  it('sums across accounts on the same platform and day', () => {
    const s = series(
      [
        metric({ onDate: '2026-09-01', value: 10 }),
        metric({ onDate: '2026-09-01', value: 15 }),
      ],
      IG.reach,
      'instagram',
      DATES,
    );
    expect(s[0].value).toBe(25);
  });

  it('excludes the other platform when one is named', () => {
    const s = series(
      [
        metric({ onDate: '2026-09-01', value: 10 }),
        metric({ onDate: '2026-09-01', value: 90, platform: 'facebook' }),
      ],
      IG.reach,
      'instagram',
      DATES,
    );
    expect(s[0].value).toBe(10);
  });
});

describe('the interaction mix', () => {
  /* ⚠️ META REALLY RETURNS A NEGATIVE SAVE COUNT — the collected data has a
     minimum of -1, because a save can be undone. A stacked area cannot draw a
     negative band: it would subtract from the layer below and silently
     misreport every layer above it. */
  it('clamps a negative save to zero rather than corrupting the stack', () => {
    const mix = interactionMix(
      [
        metric({ metricKey: IG.likes, value: 5, onDate: '2026-09-01' }),
        metric({ metricKey: IG.saves, value: -1, onDate: '2026-09-01' }),
      ],
      DATES,
    );
    const saves = mix.bands.find((b) => b.label === 'Saves');
    expect(saves?.values[0]).toBe(0);
    /* The day's height is the likes alone — not 4. */
    expect(mix.max).toBe(5);
  });

  it('stacks four bands and totals them', () => {
    const mix = interactionMix(
      [
        metric({ metricKey: IG.likes, value: 5, onDate: '2026-09-01' }),
        metric({ metricKey: IG.comments, value: 2, onDate: '2026-09-01' }),
        metric({ metricKey: IG.shares, value: 1, onDate: '2026-09-01' }),
        metric({ metricKey: IG.saves, value: 1, onDate: '2026-09-01' }),
      ],
      DATES,
    );
    expect(mix.bands).toHaveLength(4);
    expect(mix.max).toBe(9);
    expect(mix.total).toBe(9);
  });

  /* Facebook reports one lump `page_post_engagements` with no breakdown. */
  it('ignores Facebook entirely, having nothing to break down', () => {
    const mix = interactionMix(
      [metric({ platform: 'facebook', metricKey: IG.likes, value: 99, onDate: '2026-09-01' })],
      DATES,
    );
    expect(mix.total).toBe(0);
  });
});

describe('the platform radar', () => {
  it('draws the reference’s five axes', () => {
    expect(COMPARABLE.map((c) => c.key)).toEqual([
      'reach',
      'views',
      'engagements',
      'profile-views',
      'followers',
    ]);
  });

  /* ⚠️ FACEBOOK REPORTS NO REACH AT ALL, so its side of that axis is EMPTY —
     the chart breaks its shape there. A zero would draw a vertex at the centre
     and claim the figure was measured and found to be nothing. */
  it('leaves Facebook’s reach unset rather than zero', () => {
    const reach = COMPARABLE.find((c) => c.key === 'reach');
    expect(reach?.facebook).toBe('');
    expect(reach?.instagram).toBe('reach');

    const axes = platformRadar([metric({ metricKey: IG.reach, value: 500 })]);
    const axis = axes.find((a) => a.key === 'reach');
    expect(axis?.facebook).toBeNull();
    expect(axis?.facebookScaled).toBeNull();
    expect(axis?.instagram).toBe(500);
  });

  /* ⚠️ `views` IS ON THE CHART AND CARRIES ITS CAVEAT. Facebook counts VIDEO
     plays and Instagram counts every view — both real, both "views", different
     populations. The axis exists because the reference wants it; the tooltip
     says exactly what each side is counting. */
  it('keeps the views caveat on the axis rather than dropping the axis', () => {
    const views = COMPARABLE.find((c) => c.key === 'views');
    expect(views?.facebook).toBe('page_video_views');
    expect(views?.why).toMatch(/video plays/);
    expect(views?.why).toMatch(/not in definition/);
  });

  it('gives every axis a stated justification', () => {
    for (const c of COMPARABLE) expect(c.why.length).toBeGreaterThan(20);
  });

  /* ⚠️ FOLLOWERS ARE A LEVEL, NOT A FLOW. Summing thirty days of a follower
     count would report thirty times the followers. */
  it('takes the latest follower reading rather than summing the series', () => {
    const axes = platformRadar([
      metric({ platform: 'facebook', metricKey: 'page_follows', value: 18, onDate: '2026-09-01' }),
      metric({ platform: 'facebook', metricKey: 'page_follows', value: 20, onDate: '2026-09-02' }),
    ]);
    const followers = axes.find((a) => a.key === 'followers');
    expect(followers?.facebook).toBe(20);
  });

  it('sums a flow metric across the window', () => {
    const axes = platformRadar([
      metric({ metricKey: IG.interactions, value: 4, onDate: '2026-09-01' }),
      metric({ metricKey: IG.interactions, value: 6, onDate: '2026-09-02' }),
    ]);
    expect(axes.find((a) => a.key === 'engagements')?.instagram).toBe(10);
  });

  /* Followers in the tens and interactions in the hundreds on one global scale
     would flatten every small axis to nothing. */
  it('scales each axis against its own larger side', () => {
    const axes = platformRadar([
      metric({ platform: 'facebook', metricKey: 'page_follows', value: 20 }),
      metric({ platform: 'instagram', metricKey: IG.followers, value: 10 }),
    ]);
    const f = axes.find((a) => a.key === 'followers');
    expect(f?.facebookScaled).toBe(1);
    expect(f?.instagramScaled).toBe(0.5);
  });
});

describe('reach against engagement', () => {
  /* ⚠️ Only half the collected posts carry a reach figure. A column of the rest
     stacked on the y-axis would look like a real finding about posts that
     reached nobody. */
  it('excludes a post with no reach and counts it instead', () => {
    const d = reachVsEngagement([
      post({ id: 'a', reach: 100 }),
      post({ id: 'b', reach: null }),
      post({ id: 'c', reach: 0 }),
    ]);
    expect(d.points.map((p) => p.id)).toEqual(['a']);
    expect(d.excluded).toBe(2);
  });

  it('computes each point’s rate from its own reach', () => {
    const d = reachVsEngagement([post({ reach: 200, likes: 8, comments: 2, shares: 0, saves: 0 })]);
    expect(d.points[0].interactions).toBe(10);
    expect(d.points[0].rate).toBeCloseTo(5, 5);
  });
});

describe('the funnel', () => {
  const metrics = [
    metric({ metricKey: IG.reach, value: 1000 }),
    metric({ metricKey: IG.accountsEngaged, value: 100 }),
    metric({ metricKey: IG.interactions, value: 150 }),
    metric({ metricKey: IG.profileViews, value: 120 }),
  ];

  it('converts each stage against the one above it', () => {
    const f = engagementFunnel(metrics);
    expect(f.map((s) => s.key)).toEqual([
      'reach',
      'views',
      'engaged',
      'interactions',
      'profile',
      'follows',
    ]);
    expect(f[0].conversion).toBeNull();
    expect(f.find((s) => s.key === 'engaged')?.conversion).toBeCloseTo(10, 5);
  });

  /* ⚠️ VIEWS RANK BELOW REACH AND EXCEED IT. Reach counts accounts, views counts
     viewings, and one account can view repeatedly — so a conversion well over
     100% is the normal, interesting case rather than a fault. */
  it('lets views exceed reach, because they count different things', () => {
    const f = engagementFunnel([
      metric({ metricKey: IG.reach, value: 1000 }),
      metric({ metricKey: IG.views, value: 2500 }),
    ]);
    expect(f.find((s) => s.key === 'views')?.conversion).toBeCloseTo(250, 5);
  });

  /* ⚠️ Somebody can visit a profile without touching a post, so this genuinely
     exceeds 100% — capping it would hide a real fact about how people arrive. */
  it('reports a conversion above 100% rather than capping it', () => {
    const f = engagementFunnel(metrics);
    expect(f.find((s) => s.key === 'profile')?.conversion).toBeCloseTo(120, 5);
  });

  it('returns null rather than dividing by zero', () => {
    const f = engagementFunnel([]);
    expect(f.every((s) => s.conversion === null)).toBe(true);
  });
});

describe('by weekday', () => {
  /* ⚠️ THE DAY IS KARACHI'S. A post at 1am Karachi is the previous day in UTC,
     and this chart exists to say which day works. */
  it('files a post by its Karachi weekday, not its UTC one', () => {
    /* 2026-09-07 is a Monday. 20:00 UTC is 01:00 Tuesday in Karachi. */
    const bars = byWeekday([post({ postedAt: '2026-09-07T20:00:00.000Z' })]);
    expect(bars.find((b) => b.label === 'Tue')?.posts).toBe(1);
    expect(bars.find((b) => b.label === 'Mon')?.posts).toBe(0);
  });

  it('always returns all seven days, Monday first', () => {
    const bars = byWeekday([]);
    expect(bars.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  /* ⚠️ A day with no posts has no rate. Drawing 0% would make an untried day
     look like a failed one. */
  it('leaves the rate null on a day nothing was posted', () => {
    const bars = byWeekday([post({ postedAt: '2026-09-07T06:00:00.000Z' })]);
    expect(bars.find((b) => b.label === 'Sun')?.rate).toBeNull();
    expect(bars.find((b) => b.label === 'Mon')?.rate).not.toBeNull();
  });
});

describe('correlation', () => {
  const days = (values: (number | null)[]) =>
    values.map((v, i) => ({ date: DATES[i], value: v }));

  it('finds a perfect positive relationship', () => {
    expect(correlation(days([1, 2, 3, 4]), days([2, 4, 6, 8]))).toBeCloseTo(1, 5);
  });

  it('finds a perfect inverse one', () => {
    expect(correlation(days([1, 2, 3, 4]), days([8, 6, 4, 2]))).toBeCloseTo(-1, 5);
  });

  /* ⚠️ NULL, NOT ZERO. An r of 0 means "measured, and unrelated"; null means
     "not measurable", and printing 0 for the second is a claim not earned. */
  it('returns null rather than zero when it cannot be computed', () => {
    expect(correlation(days([1, 2]), days([2, 4]))).toBeNull();
    /* A flat series has no variance. */
    expect(correlation(days([5, 5, 5, 5]), days([1, 2, 3, 4]))).toBeNull();
  });

  it('skips a day either series is missing', () => {
    const r = correlation(days([1, null, 3, 4]), days([2, 8, 6, 8]));
    expect(r).toBeCloseTo(1, 5);
  });

  it('describes itself in words, and admits when it cannot', () => {
    expect(correlationWord(0.9)).toBe('strongly related');
    expect(correlationWord(-0.5)).toBe('moderately inversely related');
    expect(correlationWord(null)).toBe('not enough data to say');
  });
});

describe('the written insights', () => {
  /* ⚠️ NOT WRITTEN BY A MODEL — every one is derived, and one that cannot be
     earned is omitted rather than softened into a platitude. */
  it('says nothing at all when there is nothing to say', () => {
    expect(insights({ metrics: [], posts: [], dates: DATES })).toHaveLength(0);
  });

  it('names the best weekday only when it is genuinely ahead', () => {
    /* Monday 10%, the rest ~1% — a real difference. */
    const posts = [
      post({ id: 'a', postedAt: '2026-09-07T06:00:00.000Z', reach: 100, likes: 10 }),
      post({ id: 'b', postedAt: '2026-09-08T06:00:00.000Z', reach: 100, likes: 1 }),
      post({ id: 'c', postedAt: '2026-09-09T06:00:00.000Z', reach: 100, likes: 1 }),
    ];
    const found = insights({ metrics: [], posts, dates: DATES });
    expect(found.find((i) => i.key === 'best-day')?.title).toMatch(/Mon performs best/);
  });

  it('stays quiet when every day is within noise of the others', () => {
    const posts = [
      post({ id: 'a', postedAt: '2026-09-07T06:00:00.000Z', reach: 100, likes: 5 }),
      post({ id: 'b', postedAt: '2026-09-08T06:00:00.000Z', reach: 100, likes: 5 }),
    ];
    const found = insights({ metrics: [], posts, dates: DATES });
    expect(found.find((i) => i.key === 'best-day')).toBeUndefined();
  });

  it('reports a real trend across the halves of the window', () => {
    const metrics = DATES.map((d, i) =>
      metric({ onDate: d, metricKey: IG.reach, value: i < 3 ? 10 : 100 }),
    );
    const found = insights({ metrics, posts: [], dates: DATES });
    expect(found.find((i) => i.key === 'trend')?.title).toMatch(/Reach is up/);
  });
});

describe('against the previous period', () => {
  const now = [
    metric({ metricKey: IG.reach, value: 120 }),
    metric({ metricKey: IG.followers, value: 20, onDate: '2026-09-02' }),
  ];
  const before = [
    metric({ metricKey: IG.reach, value: 100 }),
    metric({ metricKey: IG.followers, value: 16, onDate: '2026-08-02' }),
  ];

  it('computes each metric against the same-length window before it', () => {
    const d = periodDeltas({ current: now, previous: before });
    expect(d.find((x) => x.key === 'reach')?.percent).toBeCloseTo(20, 5);
  });

  /* ⚠️ NULL, NEVER +100%. Growth from nothing has no percentage, and a made-up
     one is exactly the figure somebody quotes in a client meeting. */
  it('reports null rather than a percentage of nothing', () => {
    const d = periodDeltas({ current: now, previous: [] });
    for (const x of d) expect(x.percent).toBeNull();
  });

  /* Followers are a level: the change is between the two latest readings, not
     between two sums of thirty days each. */
  it('compares the latest follower readings rather than summing them', () => {
    const d = periodDeltas({
      current: [
        metric({ metricKey: IG.followers, value: 18, onDate: '2026-09-01' }),
        metric({ metricKey: IG.followers, value: 20, onDate: '2026-09-02' }),
      ],
      previous: [metric({ metricKey: IG.followers, value: 16, onDate: '2026-08-02' })],
    });
    const f = d.find((x) => x.key === 'followers');
    expect(f?.value).toBe(20);
    expect(f?.previous).toBe(16);
    expect(f?.percent).toBeCloseTo(25, 5);
  });

  it('reports a decline as a decline', () => {
    const d = periodDeltas({
      current: [metric({ metricKey: IG.reach, value: 80 })],
      previous: [metric({ metricKey: IG.reach, value: 100 })],
    });
    expect(d.find((x) => x.key === 'reach')?.percent).toBeCloseTo(-20, 5);
  });
});

describe('the follower line', () => {
  const fb = (date: string, value: number) =>
    metric({ platform: 'facebook', metricKey: 'page_follows', onDate: date, value });
  const ig = (date: string, value: number) =>
    metric({ platform: 'instagram', metricKey: IG.followers, onDate: date, value });

  /* ⚠️ A LEVEL IS CARRIED FORWARD, NOT ZEROED. The followers did not cease to
     exist on a day the sync did not run; treating a missing day as zero would
     draw a comb instead of a line. */
  it('carries the last reading forward across a day with no sync', () => {
    const s = followerLevelSeries([fb('2026-09-01', 10), fb('2026-09-04', 14)], DATES);
    expect(s.points.slice(0, 4)).toEqual([10, 10, 10, 14]);
  });

  /* Before a platform's first reading there is nothing to carry. */
  it('reports null before anything has been read at all', () => {
    const s = followerLevelSeries([fb('2026-09-03', 10), fb('2026-09-04', 12)], DATES);
    expect(s.points[0]).toBeNull();
    expect(s.points[1]).toBeNull();
    expect(s.points[2]).toBe(10);
  });

  /* ⚠️ THE BUG THIS FUNCTION EXISTS FOR. Instagram's follower count is a profile
     snapshot, so there is exactly one reading of it — taken today. Including it
     would step the line up on the final day and read as a day of extraordinary
     growth, when all that happened is that we began recording a number that had
     been true all along. */
  it('leaves out a platform with a single reading rather than stepping the line', () => {
    const s = followerLevelSeries(
      [fb('2026-09-01', 10), fb('2026-09-04', 20), ig('2026-09-04', 16)],
      DATES,
    );
    expect(s.platforms).toEqual(['Facebook']);
    expect(s.partial).toBe(true);
    expect(s.note).toMatch(/Instagram has one reading so far/);
    /* No 36 anywhere — the final day is Facebook's 20. */
    expect(s.points[6]).toBe(20);
    expect(s.points).not.toContain(36);
  });

  it('sums both platforms once each has a history', () => {
    const s = followerLevelSeries(
      [fb('2026-09-01', 10), fb('2026-09-04', 20), ig('2026-09-01', 5), ig('2026-09-04', 16)],
      DATES,
    );
    expect(s.platforms).toEqual(['Facebook', 'Instagram']);
    expect(s.partial).toBe(false);
    expect(s.points[0]).toBe(15);
    expect(s.points[6]).toBe(36);
  });

  it('says nothing at all when no platform reports followers', () => {
    const s = followerLevelSeries([], DATES);
    expect(s.platforms).toEqual([]);
    expect(s.points.every((p) => p === null)).toBe(true);
  });
});

describe('posts per day', () => {
  /* ⚠️ THE OPPOSITE RULE TO A METRIC SERIES, deliberately. A missing metric row
     means "we did not collect"; a day with no post inside a collected range
     means "nothing was published", which is a measurement. */
  it('reports a day with no post as zero rather than null', () => {
    const days = postsPerDay([post({ postedAt: '2026-09-03T06:00:00.000Z' })], DATES);
    expect(days[0]).toBe(0);
    expect(days[2]).toBe(1);
  });

  it('counts several posts on one day', () => {
    const days = postsPerDay(
      [
        post({ id: 'a', postedAt: '2026-09-03T06:00:00.000Z' }),
        post({ id: 'b', postedAt: '2026-09-03T11:00:00.000Z' }),
      ],
      DATES,
    );
    expect(days[2]).toBe(2);
  });

  /* A post at 1am Karachi is the previous day in UTC. */
  it('files a post by its Karachi day', () => {
    const days = postsPerDay([post({ postedAt: '2026-09-02T20:00:00.000Z' })], DATES);
    expect(days[1]).toBe(0);
    expect(days[2]).toBe(1);
  });
});

describe('the follower delta', () => {
  const fb = (date: string, value: number) =>
    metric({ platform: 'facebook', metricKey: 'page_follows', onDate: date, value });
  const ig = (date: string, value: number) =>
    metric({ platform: 'instagram', metricKey: IG.followers, onDate: date, value });

  /* ⚠️ A PLATFORM WE ONLY STARTED MEASURING IS NOT GROWTH. Instagram is absent
     from the earlier window entirely; counting its 16 on one side only would
     have reported a 80% rise that never happened. */
  it('excludes a platform the earlier window never measured', () => {
    const d = periodDeltas({
      current: [fb('2026-09-04', 20), ig('2026-09-04', 16)],
      previous: [fb('2026-08-04', 20)],
    });
    const f = d.find((x) => x.key === 'followers');
    /* Facebook did not move, so the percentage is zero — not +80%. */
    expect(f?.percent).toBeCloseTo(0, 5);
    /* ...and the headline figure is still the true total across platforms. */
    expect(f?.value).toBe(36);
  });

  it('compares both platforms once both windows have them', () => {
    const d = periodDeltas({
      current: [fb('2026-09-04', 20), ig('2026-09-04', 16)],
      previous: [fb('2026-08-04', 10), ig('2026-08-04', 10)],
    });
    const f = d.find((x) => x.key === 'followers');
    expect(f?.previous).toBe(20);
    expect(f?.percent).toBeCloseTo(80, 5);
  });
});

describe('bucketing a series', () => {
  /* Aug 31 is a Monday, so Aug 31 – Sep 6 is one ISO week and Sep 7 starts the
     next; Aug 30 (a Sunday) belongs to the week before. */
  const RANGE = dateRange('2026-08-30', '2026-09-08');

  it('leaves a daily series exactly as it was', () => {
    const b = bucketSeries(RANGE, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 'daily');
    expect(b.labels).toEqual([...RANGE]);
    expect(b.series[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('sums each ISO week, Monday-anchored', () => {
    const b = bucketSeries(RANGE, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 'weekly');
    /* Aug 30 alone; Aug 31–Sep 6 (2..8 = 35); Sep 7–8 (9+10 = 19). */
    expect(b.series[0]).toEqual([1, 35, 19]);
    expect(b.labels).toEqual(['2026-08-30', '2026-08-31', '2026-09-07']);
  });

  it('sums each calendar month', () => {
    const b = bucketSeries(RANGE, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 'monthly');
    /* Aug 30–31 = 3; Sep 1–8 = 52. */
    expect(b.series[0]).toEqual([3, 52]);
  });

  /* ⚠️ A BUCKET OF ONLY NULLS STAYS NULL. Summing a week nobody collected would
     produce a confident zero where the daily chart correctly showed a gap. */
  it('keeps a wholly uncollected bucket as null rather than zero', () => {
    const week = dateRange('2026-08-31', '2026-09-13');
    const points = week.map((_, i) => (i < 7 ? null : 1));
    const b = bucketSeries(week, [points], 'weekly');
    expect(b.series[0][0]).toBeNull();
    expect(b.series[0][1]).toBe(7);
  });

  it('sums the days it does have inside a partly-collected bucket', () => {
    const week = dateRange('2026-08-31', '2026-09-06');
    const b = bucketSeries(week, [[5, null, 5, null, null, null, null]], 'weekly');
    expect(b.series[0]).toEqual([10]);
  });

  it('names the dates a bucket covers, for the tooltip', () => {
    const b = bucketSeries(RANGE, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 'weekly');
    expect(b.tooltips[1]).toBe('2026-08-31 → 2026-09-06');
    /* A one-day bucket names one date, not a range from itself to itself. */
    expect(b.tooltips[0]).toBe('2026-08-30');
  });

  it('buckets every series against the same boundaries', () => {
    const b = bucketSeries(RANGE, [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]], 'weekly');
    expect(b.series[0]).toHaveLength(3);
    expect(b.series[1]).toHaveLength(3);
    expect(b.series[1]).toEqual([2, 14, 4]);
  });
});

describe('how many buckets a range holds', () => {
  /* ⚠️ THIS IS WHAT DISABLES A CHOICE RATHER THAN LETTING IT EMPTY THE PANEL. A
     seven-day window contains one week and one month, and a line through a
     single point is a dot. */
  it('reports one week and one month for a seven-day window inside a month', () => {
    /* Sep 7 is a Monday, so Sep 7–13 is exactly one ISO week and one month.
       An earlier version of this test used Aug 31 – Sep 6, which is one week but
       genuinely spans TWO calendar months — the code was right and the
       assertion was careless. */
    const week = dateRange('2026-09-07', '2026-09-13');
    expect(bucketCount(week, 'daily')).toBe(7);
    expect(bucketCount(week, 'weekly')).toBe(1);
    expect(bucketCount(week, 'monthly')).toBe(1);
  });

  it('reports enough buckets to plot across a month', () => {
    const month = dateRange('2026-08-06', '2026-09-04');
    expect(bucketCount(month, 'daily')).toBe(30);
    expect(bucketCount(month, 'weekly')).toBeGreaterThanOrEqual(4);
    expect(bucketCount(month, 'monthly')).toBe(2);
  });
});


describe('the funnel’s sixth stage', () => {
  /* ⚠️ THE ONLY FACEBOOK STAGE, and it carries no conversion. Instagram
     publishes no daily new-follow metric at all, so the last rung can only come
     from Facebook — and a percentage across two platforms would be arithmetic
     dressed up as a finding. */
  it('takes new follows from Facebook and claims no conversion for them', () => {
    const f = engagementFunnel([
      metric({ metricKey: IG.reach, value: 1000 }),
      metric({ platform: 'facebook', metricKey: 'page_daily_follows_unique', value: 20 }),
    ]);
    const follows = f.find((s) => s.key === 'follows');
    expect(follows?.value).toBe(20);
    expect(follows?.conversion).toBeNull();
    expect(follows?.note).toMatch(/^Facebook ·/);
  });

  it('names the platform on every stage', () => {
    for (const stage of engagementFunnel([])) {
      expect(stage.note).toMatch(/^(Instagram|Facebook) ·/);
    }
  });
});

describe('the shared post measure', () => {
  /* ⚠️ THE WEEKDAY BARS AND THE HEATMAP BOTH READ THROUGH THIS, so a word means
     the same thing on two charts sitting side by side. Two panels reading
     "Engagements" differently is the kind of quiet inconsistency nobody reports
     and everybody misreads. */
  it('counts a post as one under Posts, whatever it earned', () => {
    expect(measureOf(post({ reach: 9999, likes: 500 }), 'posts')).toBe(1);
  });

  it('sums the four interaction kinds under Engagements', () => {
    expect(
      measureOf(post({ likes: 5, comments: 2, shares: 1, saves: 1 }), 'engagements'),
    ).toBe(9);
  });

  it('takes reach alone under Reach', () => {
    expect(measureOf(post({ reach: 250, likes: 99 }), 'reach')).toBe(250);
  });

  /* A missing figure contributes nothing rather than crashing — half the
     collected posts carry no reach at all. */
  it('treats an absent figure as no contribution', () => {
    expect(measureOf(post({ reach: null }), 'reach')).toBe(0);
    expect(
      measureOf(post({ likes: null, comments: null, shares: null, saves: null }), 'engagements'),
    ).toBe(0);
  });
});
