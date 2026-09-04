import { describe, expect, it } from 'vitest';

import type { StudioPost } from '../meta-studio';
import {
  accountHealth,
  classifyPost,
  contentDistribution,
  contentInsights,
  contentKpis,
  contentTabs,
  filterPosts,
  rankPosts,
} from '../meta-content';

/* ============================================================================
 * THE CONTENT & POSTS TAB
 * ----------------------------------------------------------------------------
 * The cases below are the ones that produce a PLAUSIBLE wrong answer — a tab
 * that reads zero when it should not, a rate halved by a platform that reports
 * nothing, a "best time" that is really "most frequent time".
 * ========================================================================= */

const post = (over: Partial<StudioPost> = {}): StudioPost => ({
  id: Math.random().toString(36).slice(2),
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

describe('what kind of thing a post is', () => {
  /* ⚠️ THE ASSERTION THIS FILE EXISTS FOR. A reel IS a VIDEO in the REELS
     surface, so reading `media_type` first files every reel under Video and the
     Reels tab reads zero for ever. */
  it('calls a reel a reel, not a video', () => {
    expect(classifyPost(post({ mediaProductType: 'REELS', mediaType: 'VIDEO' }))).toBe('Reel');
  });

  it('reads the surface before the medium for stories too', () => {
    expect(classifyPost(post({ mediaProductType: 'STORY', mediaType: 'IMAGE' }))).toBe('Story');
  });

  it('classifies the ordinary feed kinds', () => {
    expect(classifyPost(post({ mediaProductType: 'FEED', mediaType: 'IMAGE' }))).toBe('Image');
    expect(classifyPost(post({ mediaProductType: 'FEED', mediaType: 'VIDEO' }))).toBe('Video');
    expect(classifyPost(post({ mediaProductType: 'FEED', mediaType: 'CAROUSEL_ALBUM' }))).toBe(
      'Carousel',
    );
  });

  /* ⚠️ Facebook returns no `media_type` at all — verified against the live
     account. That must be a Post, not a crash and not an empty label. */
  it('falls back to Post when the platform reports no medium', () => {
    expect(classifyPost(post({ platform: 'facebook', mediaProductType: 'FEED', mediaType: null }))).toBe(
      'Post',
    );
    expect(classifyPost(post({ mediaProductType: null, mediaType: null }))).toBe('Post');
  });
});

describe('the tab strip', () => {
  const posts = [
    post({ mediaProductType: 'REELS', mediaType: 'VIDEO' }),
    post({ mediaProductType: 'REELS', mediaType: 'VIDEO' }),
    post({ mediaType: 'IMAGE' }),
    post({ platform: 'facebook', mediaType: null }),
  ];

  it('counts each kind and the whole', () => {
    const tabs = contentTabs(posts, 3);
    const count = (key: string) => tabs.find((t) => t.key === key)?.count;
    expect(count('all')).toBe(4);
    expect(count('reels')).toBe(2);
    expect(count('images')).toBe(1);
    expect(count('drafts')).toBe(3);
  });

  /* ⚠️ A strip that hides empty tabs cannot say "no stories went out", which is
     the gap somebody opens this tab to find. It also reflows as content is
     published, moving a tab the reader had learned the position of. */
  it('keeps a tab that has nothing in it', () => {
    const tabs = contentTabs(posts, 0);
    expect(tabs.find((t) => t.key === 'stories')).toEqual({
      key: 'stories',
      label: 'Stories',
      count: 0,
    });
    expect(tabs).toHaveLength(7);
  });
});

describe('filtering', () => {
  const posts = [
    post({ id: 'r1', mediaProductType: 'REELS', mediaType: 'VIDEO' }),
    post({ id: 'i1', mediaType: 'IMAGE' }),
    post({ id: 'f1', platform: 'facebook', mediaType: null }),
  ];

  it('narrows by kind', () => {
    expect(filterPosts(posts, 'reels', 'all').map((p) => p.id)).toEqual(['r1']);
  });

  it('narrows by platform', () => {
    expect(filterPosts(posts, 'all', 'facebook').map((p) => p.id)).toEqual(['f1']);
  });

  it('applies both at once', () => {
    expect(filterPosts(posts, 'reels', 'facebook')).toHaveLength(0);
  });

  it('leaves everything alone on the All tab', () => {
    expect(filterPosts(posts, 'all', 'all')).toHaveLength(3);
  });
});

describe('the headline figures', () => {
  it('counts drafts into the total but not into published', () => {
    const kpis = contentKpis({ posts: [post(), post()], previousPosts: [], draftCount: 3 });
    expect(kpis.find((k) => k.key === 'total')?.value).toBe(5);
    expect(kpis.find((k) => k.key === 'published')?.value).toBe(2);
  });

  /* ⚠️ THE RATE'S DENOMINATOR IS ONLY THE POSTS THAT REPORT REACH. Facebook
     returns none, so dividing by every post halves the rate for a reason
     invisible on screen. */
  it('computes the rate over posts that actually report reach', () => {
    const kpis = contentKpis({
      posts: [
        post({ reach: 1000, totalInteractions: 50 }),
        post({ platform: 'facebook', reach: null, totalInteractions: null, likes: 5, comments: 0, shares: 0, saves: null }),
      ],
      previousPosts: [],
      draftCount: 0,
    });
    /* 50 / 1000 = 5%, not 55/1000 and not 50/2000. */
    expect(kpis.find((k) => k.key === 'rate')?.value).toBeCloseTo(5);
  });

  it('reports no delta against an empty previous period rather than infinity', () => {
    const kpis = contentKpis({ posts: [post()], previousPosts: [], draftCount: 0 });
    for (const k of kpis) expect(k.deltaPercent).toBeNull();
  });

  it('measures average reach over the posts that have it', () => {
    const kpis = contentKpis({
      posts: [post({ reach: 300 }), post({ reach: 100 }), post({ reach: null })],
      previousPosts: [],
      draftCount: 0,
    });
    /* 400 / 2 reporting posts = 200, not 400/3. */
    expect(kpis.find((k) => k.key === 'avg_reach')?.value).toBe(200);
  });

  /* ⚠️ There is no "Content Score" in this system; the reference's sixth card
     would have to be invented. A test pins that it stayed out. */
  it('offers no invented score', () => {
    const kpis = contentKpis({ posts: [post()], previousPosts: [], draftCount: 0 });
    expect(kpis.some((k) => /score/i.test(k.label))).toBe(false);
  });
});

describe('insights, all of them measured', () => {
  /* ⚠️ AVERAGE PER POST, NOT THE TOTAL. Eight ordinary posts in one slot would
     otherwise beat one excellent post in another, and the question is "when
     should I post", not "when have I posted most". */
  it('picks the slot with the best engagement per post, not the busiest', () => {
    const busy = Array.from({ length: 6 }, () =>
      post({ postedAt: '2026-09-01T09:00:00Z', totalInteractions: 10 }),
    );
    const strong = post({ postedAt: '2026-09-03T20:00:00Z', totalInteractions: 400 });

    const insights = contentInsights([...busy, strong], 'UTC');
    const slot = insights.find((i) => i.key === 'best_time');
    expect(slot?.title).toMatch(/Thursday/);
    expect(slot?.title).toMatch(/8pm/);
  });

  it('names the strongest format and how far ahead it is', () => {
    const insights = contentInsights(
      [
        post({ mediaProductType: 'REELS', mediaType: 'VIDEO', totalInteractions: 100 }),
        post({ mediaType: 'IMAGE', totalInteractions: 10 }),
      ],
      'UTC',
    );
    const kind = insights.find((i) => i.key === 'best_kind');
    expect(kind?.title).toMatch(/Reels/);
    expect(kind?.detail).toMatch(/×/);
  });

  it('flags a post with no live link', () => {
    const insights = contentInsights([post(), post({ permalink: null })], 'UTC');
    expect(insights.find((i) => i.key === 'no_link')?.title).toMatch(/1 post has no live link/);
  });

  it('says nothing at all rather than guessing from an empty period', () => {
    expect(contentInsights([], 'UTC')).toEqual([]);
  });
});

describe('distribution and ranking', () => {
  it('shares sum to one across the kinds present', () => {
    const dist = contentDistribution([
      post({ mediaProductType: 'REELS', mediaType: 'VIDEO' }),
      post({ mediaType: 'IMAGE' }),
      post({ mediaType: 'IMAGE' }),
    ]);
    expect(dist[0]).toMatchObject({ kind: 'Image', count: 2 });
    expect(dist.reduce((n, d) => n + d.share, 0)).toBeCloseTo(1);
  });

  it('ranks by engagement, reach or recency', () => {
    const a = post({ id: 'a', totalInteractions: 5, reach: 900, postedAt: '2026-09-01T00:00:00Z' });
    const b = post({ id: 'b', totalInteractions: 90, reach: 100, postedAt: '2026-09-05T00:00:00Z' });

    expect(rankPosts([a, b], 'engagement')[0].id).toBe('b');
    expect(rankPosts([a, b], 'reach')[0].id).toBe('a');
    expect(rankPosts([a, b], 'recent')[0].id).toBe('b');
  });

  /* Facebook reports no `total_interactions`, so a post with real likes would
     rank as zero without the fallback in `postEngagement`. */
  it('ranks a Facebook post on its parts', () => {
    const fb = post({ id: 'fb', platform: 'facebook', totalInteractions: null, likes: 40, comments: 3, saves: null });
    const ig = post({ id: 'ig', totalInteractions: 20 });
    expect(rankPosts([ig, fb], 'engagement')[0].id).toBe('fb');
  });
});

describe('account health', () => {
  const HOUR = 3_600_000;
  const now = Date.parse('2026-09-04T12:00:00Z');
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();

  /* ⚠️ THE ASSERTION THAT MATTERS. A client who revoked access yesterday has a
     `last_synced_at` from yesterday and is still broken today — so a recorded
     error must beat a recent successful pull, or the tab reports "Syncing" on a
     connection that is dead. */
  it('lets a recorded error beat a recent successful sync', () => {
    const v = accountHealth({
      lastSyncedAt: at(1),
      lastError: 'access revoked by the client',
      metricDays: 29,
      nowMs: now,
    });
    expect(v.state).toBe('error');
    expect(v.detail).toBe('access revoked by the client');
  });

  it('calls a fresh sync healthy', () => {
    expect(accountHealth({ lastSyncedAt: at(1), lastError: null, metricDays: 29, nowMs: now }).state).toBe(
      'healthy',
    );
  });

  /* The thresholds come from the schedule, not from taste: the cron is every two
     hours, so six hours is three missed runs. */
  it('flags three missed runs as behind, and a day as stale', () => {
    expect(accountHealth({ lastSyncedAt: at(7), lastError: null, metricDays: 5, nowMs: now }).state).toBe(
      'quiet',
    );
    expect(accountHealth({ lastSyncedAt: at(30), lastError: null, metricDays: 5, nowMs: now }).state).toBe(
      'stale',
    );
  });

  it('separates "never synced" from "stopped syncing"', () => {
    const v = accountHealth({ lastSyncedAt: null, lastError: null, metricDays: 0, nowMs: now });
    expect(v.state).toBe('never');
    expect(v.label).toMatch(/first sync/i);
  });
});
