import { describe, expect, it } from 'vitest';

import type { MetricPoint, StudioAccount, StudioPost } from '@/lib/db/queries/meta-studio';

import {
  buildKpis,
  contentMix,
  compact,
  dailySeries,
  daysBetween,
  deltaBetween,
  formatDelta,
  latestMetric,
  niceScale,
  previousPeriod,
  sumMetric,
  topPosts,
} from '../meta-studio';

/* ============================================================================
 * THE STUDIO'S ARITHMETIC
 * ----------------------------------------------------------------------------
 * These numbers go in front of clients, so the sums are tested rather than
 * eyeballed. The cases below are the ones that produce a PLAUSIBLE wrong answer
 * — the kind that ships because nobody notices.
 * ========================================================================= */

const point = (
  onDate: string,
  platform: string,
  metricKey: string,
  value: number,
): MetricPoint => ({ onDate, platform, metricKey, value });

const post = (over: Partial<StudioPost> = {}): StudioPost => ({
  id: 'p1',
  platform: 'instagram',
  postedAt: '2026-09-01T10:00:00Z',
  caption: 'A post',
  mediaProductType: 'FEED',
  mediaType: 'IMAGE',
  permalink: 'https://example.test/p/1',
  thumbnailUrl: null,
  reach: 100,
  views: 200,
  likes: 10,
  comments: 2,
  shares: 1,
  saves: 3,
  totalInteractions: 16,
  ...over,
});

const account: StudioAccount = {
  id: 'a1',
  platform: 'instagram',
  username: 'someone',
  displayName: null,
  permalink: null,
  followers: 16,
  mediaCount: 49,
  lastSyncedAt: null,
  lastError: null,
};

describe('periods', () => {
  it('counts an inclusive range', () => {
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(30);
  });

  /* ⚠️ The "+1640%" bug, in a new place. A delta only means something when both
     sides span the same number of days. */
  it('gives the previous period the same length, ending the day before', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-08-02',
      to: '2026-08-31',
    });
    const p = previousPeriod('2026-09-01', '2026-09-30');
    expect(daysBetween(p.from, p.to)).toBe(daysBetween('2026-09-01', '2026-09-30'));
  });
});

describe('levels versus counts', () => {
  const followers = [
    point('2026-09-01', 'instagram', 'followers_count', 16),
    point('2026-09-02', 'instagram', 'followers_count', 16),
    point('2026-09-03', 'instagram', 'followers_count', 18),
  ];

  /* ⚠️ THE MOST DANGEROUS MISTAKE THIS FILE GUARDS. A follower count is a
     running total, so summing 29 daily snapshots of "16 followers" gives 464 and
     reads as spectacular growth on a client's report. */
  it('reads a follower count at its latest point, never summed', () => {
    expect(latestMetric(followers, 'followers_count')).toBe(18);
    expect(sumMetric(followers, 'followers_count')).toBe(50); // what NOT to show
  });

  it('sums a count, because views really do accumulate', () => {
    const views = [
      point('2026-09-01', 'instagram', 'views', 100),
      point('2026-09-02', 'instagram', 'views', 150),
    ];
    expect(sumMetric(views, 'views')).toBe(250);
  });

  it('keeps the platforms apart when asked', () => {
    const mixed = [
      point('2026-09-01', 'instagram', 'views', 100),
      point('2026-09-01', 'facebook', 'page_views_total', 40),
    ];
    expect(sumMetric(mixed, 'views', 'instagram')).toBe(100);
    expect(sumMetric(mixed, 'views', 'facebook')).toBe(0);
  });
});

describe('deltas', () => {
  it('reports direction and percentage', () => {
    expect(deltaBetween(120, 100).percent).toBeCloseTo(20);
    expect(deltaBetween(120, 100).direction).toBe('up');
    expect(deltaBetween(80, 100).direction).toBe('down');
  });

  /* ⚠️ Dividing by a previous period of zero is infinity, which renders as
     "+Infinity%" — the shape of the +1640% bug. */
  it('refuses to compute a percentage against nothing', () => {
    const d = deltaBetween(50, 0);
    expect(d.percent).toBeNull();
    expect(d.direction).toBe('up');
  });
});

describe('the series a chart is drawn from', () => {
  /* ⚠️ A gap must stay a gap. Plotting only the days that have rows draws a
     straight segment across a missing week and silently reshapes the trend. */
  it('emits every day in the range, with null where nothing was collected', () => {
    const series = dailySeries(
      [point('2026-09-01', 'instagram', 'reach', 10), point('2026-09-03', 'instagram', 'reach', 30)],
      { instagram: 'reach' },
      '2026-09-01',
      '2026-09-03',
    );

    expect(series).toHaveLength(3);
    expect(series.map((d) => d.instagram)).toEqual([10, null, 30]);
    expect(series[1].date).toBe('2026-09-02');
  });

  it('keeps the two platforms separate and also totals them', () => {
    const series = dailySeries(
      [
        point('2026-09-01', 'instagram', 'reach', 10),
        point('2026-09-01', 'facebook', 'page_views_total', 5),
      ],
      { instagram: 'reach', facebook: 'page_views_total' },
      '2026-09-01',
      '2026-09-01',
    );
    expect(series[0]).toMatchObject({ instagram: 10, facebook: 5, combined: 15 });
  });
});

describe('the headline cards', () => {
  const base = {
    accounts: [account],
    postsInPeriod: 8,
    cadence: { staticPerDay: null, reelsPerWeek: null, assetsMin: null, assetsMax: null, reelsMin: null },
    from: '2026-09-01',
    to: '2026-09-10',
    platform: 'all' as const,
  };

  it('adds the two platforms’ follower levels without summing over days', () => {
    const kpis = buildKpis({
      ...base,
      current: [
        point('2026-09-01', 'instagram', 'followers_count', 16),
        point('2026-09-02', 'instagram', 'followers_count', 18),
        point('2026-09-02', 'facebook', 'page_follows', 20),
      ],
      previous: [],
    });
    /* 18 (latest IG) + 20 (latest FB) = 38 — not 16+18+20. */
    expect(kpis.find((k) => k.key === 'followers')?.value).toBe(38);
  });

  /* ⚠️ Facebook has no working reach metric in v26.0, so a combined "reach"
     would quietly mean "Instagram only" and never reconcile against Meta's own
     dashboard. The card says so instead. */
  it('labels reach as Instagram-only rather than pretending it is both', () => {
    const kpis = buildKpis({
      ...base,
      current: [point('2026-09-01', 'instagram', 'reach', 500)],
      previous: [],
    });
    const reach = kpis.find((k) => k.key === 'reach');
    expect(reach?.value).toBe(500);
    expect(reach?.hint).toMatch(/Instagram only/i);
  });

  it('computes engagement rate from one platform’s own numerator and denominator', () => {
    const kpis = buildKpis({
      ...base,
      current: [
        point('2026-09-01', 'instagram', 'reach', 1000),
        point('2026-09-01', 'instagram', 'total_interactions', 50),
        /* Facebook engagement must NOT leak into an Instagram rate. */
        point('2026-09-01', 'facebook', 'page_post_engagements', 900),
      ],
      previous: [],
    });
    expect(kpis.find((k) => k.key === 'engagement_rate')?.value).toBeCloseTo(5);
  });

  /* ⚠️ A null target means "no rhythm agreed" and must never read as zero. */
  it('shows no target card when no cadence is set', () => {
    const kpis = buildKpis({ ...base, current: [], previous: [] });
    expect(kpis.find((k) => k.key === 'target')).toBeUndefined();
  });

  it('shows the target when there is one', () => {
    const kpis = buildKpis({
      ...base,
      current: [],
      previous: [],
      cadence: { staticPerDay: 1, reelsPerWeek: 2, assetsMin: null, assetsMax: null, reelsMin: null },
    });
    /* 10 days: 10 static + round(2*10/7)=3 reels = 13 */
    expect(kpis.find((k) => k.key === 'target')?.hint).toContain('13');
  });

  it('drops the other platform entirely when one is filtered to', () => {
    const kpis = buildKpis({
      ...base,
      platform: 'facebook',
      current: [
        point('2026-09-01', 'instagram', 'reach', 500),
        point('2026-09-01', 'facebook', 'page_views_total', 40),
      ],
      previous: [],
    });
    expect(kpis.find((k) => k.key === 'reach')).toBeUndefined();
    expect(kpis.find((k) => k.key === 'views')?.value).toBe(40);
  });
});

describe('posts', () => {
  it('ranks by engagement', () => {
    const ranked = topPosts([
      post({ id: 'a', totalInteractions: 5 }),
      post({ id: 'b', totalInteractions: 90 }),
      post({ id: 'c', totalInteractions: 40 }),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  /* ⚠️ Facebook does not report total_interactions, so a post with real likes
     would rank as zero if the fallback were missing. */
  it('falls back to the parts when the platform reports no total', () => {
    const ranked = topPosts([
      post({ id: 'fb', platform: 'facebook', totalInteractions: null, likes: 30, comments: 5, saves: null }),
      post({ id: 'ig', totalInteractions: 20 }),
    ]);
    expect(ranked[0].id).toBe('fb');
  });

  it('groups the content mix by what Meta calls it', () => {
    const mix = contentMix([
      post({ mediaProductType: 'REELS' }),
      post({ mediaProductType: 'REELS' }),
      post({ mediaProductType: 'FEED' }),
      post({ mediaProductType: null }),
    ]);
    expect(mix[0]).toEqual({ label: 'Reels', count: 2 });
    expect(mix.find((m) => m.label === 'Posts')?.count).toBe(2);
  });
});

describe('formatting', () => {
  it('compacts large numbers the way the cards show them', () => {
    expect(compact(950)).toBe('950');
    expect(compact(1_240)).toBe('1.2K');
    expect(compact(213_062)).toBe('213K');
    expect(compact(1_430_000)).toBe('1.4M');
  });

  /* ⚠️ A rate's change is in percentage POINTS. "Engagement rate rose 20%" when
     it went 5% → 6% is a different and much larger-sounding claim than "+1pp". */
  it('reports a rate’s movement in points, not percent', () => {
    const kpi = {
      key: 'engagement_rate',
      label: 'Engagement rate',
      value: 6,
      kind: 'rate' as const,
      delta: { percent: 20, direction: 'up' as const, previous: 5 },
    };
    expect(formatDelta(kpi)).toBe('+1.00pp');
  });
});

/* ============================================================================
 * AXIS SCALES
 * ----------------------------------------------------------------------------
 * Owner, with a daily chart open: *"you start from 0 and then directly jump to
 * 14k… should it start from 0, 5k, 10k, 15k as small figures."*
 * ========================================================================= */
describe('the axis a chart is drawn against', () => {
  const ticks = (max: number) => {
    const { ceiling, steps } = niceScale(max);
    return Array.from({ length: steps + 1 }, (_, i) => (ceiling * i) / steps);
  };

  it('lands on round numbers rather than quarters of the peak', () => {
    /* The exact case the owner screenshotted: dividing 57,000 into four gave
       0 · 14K · 29K · 43K · 57K, which is correct and unreadable. */
    expect(ticks(57_000)).toEqual([0, 15_000, 30_000, 45_000, 60_000]);
  });

  /* ⚠️ THE SERIOUS ONE. A step of 2.5 renders as "3" once shortened, so the
     axis prints a number where the gridline is not. An ugly axis is a nuisance;
     an axis whose labels disagree with its own gridlines is a lie. */
  it('never uses a fractional step where the labels would be rounded', () => {
    for (const peak of [9, 7, 12, 36, 45, 99]) {
      for (const t of ticks(peak)) {
        expect(Number.isInteger(t), `peak ${peak} produced a tick of ${t}`).toBe(true);
      }
    }
  });

  it('does not waste a quarter of the panel above the data', () => {
    for (const peak of [278, 437, 1_500, 57_000, 213_062, 229_477]) {
      const { ceiling } = niceScale(peak);
      expect(ceiling).toBeGreaterThanOrEqual(peak);
      expect((ceiling - peak) / ceiling, `peak ${peak} left too much headroom`).toBeLessThan(0.12);
    }
  });

  it('keeps the gridlines to a readable count', () => {
    for (const peak of [1, 9, 36, 437, 1_500, 57_000, 229_477, 1_430_000]) {
      const { steps } = niceScale(peak);
      expect(steps, `peak ${peak}`).toBeLessThanOrEqual(6);
      expect(steps).toBeGreaterThanOrEqual(1);
    }
  });

  it('survives the degenerate cases rather than dividing by zero', () => {
    expect(niceScale(0).ceiling).toBe(1);
    expect(niceScale(-5).ceiling).toBe(1);
    expect(niceScale(Number.NaN).ceiling).toBe(1);
    expect(niceScale(Number.POSITIVE_INFINITY).ceiling).toBe(1);
  });
});
