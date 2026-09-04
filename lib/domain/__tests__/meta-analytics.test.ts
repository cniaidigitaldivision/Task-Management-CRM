import { describe, expect, it } from 'vitest';

import type { MetricPoint, StudioPost } from '../meta-studio';

import {
  COMPARABLE,
  IG,
  byWeekday,
  correlation,
  correlationWord,
  dateRange,
  engagementFunnel,
  insights,
  interactionMix,
  platformRadar,
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
  /* ⚠️ THE WHOLE POINT OF THE FILE. Facebook's `page_video_views` counts VIDEO
     plays and Instagram's `views` counts everything — putting them on one axis
     because both are called "views" would draw a confident, wrong picture. */
  it('compares only metrics that mean the same thing', () => {
    expect(COMPARABLE.map((c) => c.key)).toEqual([
      'followers',
      'engagements',
      'profile-views',
    ]);
    expect(COMPARABLE.some((c) => c.facebook === 'page_video_views')).toBe(false);
    expect(COMPARABLE.some((c) => c.instagram === 'reach')).toBe(false);
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
    expect(f[0].conversion).toBeNull();
    expect(f[1].conversion).toBeCloseTo(10, 5);
    expect(f[2].conversion).toBeCloseTo(150, 5);
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
