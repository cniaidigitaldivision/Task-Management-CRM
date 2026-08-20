import { describe, expect, it } from 'vitest';

import { buildProjectReport, type ReportCadence } from '../project-report';
import { reportPeriod } from '../report-periods';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * These figures go into a PDF a client reads, and nobody re-checks a PDF. The two
 * dangerous directions are both covered: counting placements as assets (which would
 * inflate delivery threefold) and pro-rating a target by dividing rather than by
 * walking the actual days (which would give a Sunday a target on a project that does
 * not post on Sundays).
 * ========================================================================= */

const TODAY = '2026-08-20'; // Thursday

/** 1 static a day Mon–Sat, 2 reels a week on Mon and Wed, Sundays off. */
const CADENCE: ReportCadence = {
  staticPostsPerDay: 1,
  reelsPerWeek: 2,
  reelDays: [1, 3],
  postingDays: [1, 2, 3, 4, 5, 6],
};

function asset(over: Partial<Parameters<typeof buildProjectReport>[1][number]> = {}) {
  return {
    id: 't1',
    title: 'A post',
    publishedOn: TODAY,
    contentKind: 'static',
    assigneeName: 'Someone',
    ...over,
  };
}

function placement(
  over: Partial<Parameters<typeof buildProjectReport>[2][number]> = {},
) {
  return {
    platformId: 'fb',
    platformName: 'Facebook',
    platformSlug: 'facebook',
    publishedOn: TODAY,
    contentKind: 'static',
    url: 'https://facebook.com/p/1',
    ...over,
  };
}

describe('assets versus placements', () => {
  it('⚠️ counts one cross-posted asset as ONE asset and THREE placements', () => {
    /* The single easiest way to make a client report flattering and wrong. The package
       target is measured in assets; reach is measured in placements. */
    const report = buildProjectReport(
      reportPeriod('today', TODAY),
      [asset()],
      [
        placement({ platformId: 'fb', platformName: 'Facebook', platformSlug: 'facebook' }),
        placement({ platformId: 'ig', platformName: 'Instagram', platformSlug: 'instagram' }),
        placement({ platformId: 'tt', platformName: 'TikTok', platformSlug: 'tiktok' }),
      ],
      CADENCE,
    );
    expect(report.totalAssets).toBe(1);
    expect(report.totalPlacements).toBe(3);
    expect(report.platforms).toHaveLength(3);
  });

  it('counts a placement without a link as reach but not as verifiable', () => {
    const report = buildProjectReport(
      reportPeriod('today', TODAY),
      [asset()],
      [placement({ url: null }), placement({ url: 'https://x/1' })],
      CADENCE,
    );
    expect(report.totalPlacements).toBe(2);
    expect(report.totalWithLinks).toBe(1);
  });

  it('groups platforms by id, never by name', () => {
    /* "X (Twitter)" has been reworded once already; a grouping keyed on the label
       splits into two rows the day somebody edits it again. */
    const report = buildProjectReport(
      reportPeriod('week', TODAY),
      [],
      [
        placement({ platformId: 'x', platformName: 'X (Twitter)', platformSlug: 'x' }),
        placement({ platformId: 'x', platformName: 'X', platformSlug: 'x' }),
      ],
      CADENCE,
    );
    expect(report.platforms).toHaveLength(1);
    expect(report.platforms[0]!.placements).toBe(2);
  });

  it('orders platforms by reach', () => {
    const report = buildProjectReport(
      reportPeriod('week', TODAY),
      [],
      [
        placement({ platformId: 'ig', platformName: 'Instagram', platformSlug: 'instagram' }),
        placement({ platformId: 'fb' }),
        placement({ platformId: 'fb' }),
      ],
      CADENCE,
    );
    expect(report.platforms.map((p) => p.platformId)).toEqual(['fb', 'ig']);
  });
});

describe('static versus reels', () => {
  it('⚠️ treats everything that is not a reel as a static post', () => {
    /* A carousel and a story are static posts as far as a client's feed is concerned.
       Counting only `contentKind === 'static'` would under-report a project that
       posts carousels — and reels are the category separately promised. */
    const report = buildProjectReport(
      reportPeriod('today', TODAY),
      [
        asset({ id: 'a', contentKind: 'static' }),
        asset({ id: 'b', contentKind: 'carousel' }),
        asset({ id: 'c', contentKind: 'story' }),
        asset({ id: 'd', contentKind: 'reel' }),
      ],
      [],
      CADENCE,
    );
    expect(report.totalStatic).toBe(3);
    expect(report.totalReels).toBe(1);
    expect(report.totalAssets).toBe(4);
  });
});

describe('bucketing', () => {
  it('puts each asset in the right day of a week report', () => {
    const report = buildProjectReport(
      reportPeriod('week', TODAY), // Mon 17 – Sun 23
      [
        asset({ id: 'a', publishedOn: '2026-08-17' }),
        asset({ id: 'b', publishedOn: '2026-08-17' }),
        asset({ id: 'c', publishedOn: '2026-08-20', contentKind: 'reel' }),
      ],
      [],
      CADENCE,
    );
    const by = (label: string) => report.buckets.find((b) => b.label.startsWith(label))!;
    expect(by('Monday').assets).toBe(2);
    expect(by('Thursday').reels).toBe(1);
    expect(by('Friday').assets).toBe(0);
  });

  it('ignores anything outside the period', () => {
    /* The query bounds the range too, but a report must not depend on that: a caller
       passing a wider set must not smear it across the buckets. */
    const report = buildProjectReport(
      reportPeriod('week', TODAY),
      [asset({ publishedOn: '2026-09-15' })],
      [],
      CADENCE,
    );
    expect(report.buckets.every((b) => b.assets === 0)).toBe(true);
  });

  it('buckets a month by week, and the weeks add up to the total', () => {
    const period = reportPeriod('month', TODAY);
    const assets = [
      asset({ id: 'a', publishedOn: '2026-08-01' }),
      asset({ id: 'b', publishedOn: '2026-08-05' }),
      asset({ id: 'c', publishedOn: '2026-08-19' }),
      asset({ id: 'd', publishedOn: '2026-08-31' }),
    ];
    const report = buildProjectReport(period, assets, [], CADENCE);
    expect(report.buckets.reduce((n, b) => n + b.assets, 0)).toBe(4);
    expect(report.totalAssets).toBe(4);
  });

  it('buckets a year by month', () => {
    const report = buildProjectReport(
      reportPeriod('year', TODAY, '2026-06-01', '2026-08-01'),
      [
        asset({ id: 'a', publishedOn: '2026-06-10' }),
        asset({ id: 'b', publishedOn: '2026-08-02' }),
        asset({ id: 'c', publishedOn: '2026-08-03' }),
      ],
      [],
      CADENCE,
    );
    expect(report.buckets.map((b) => b.assets)).toEqual([1, 0, 2]);
  });
});

describe('the target, pro-rated from the cadence', () => {
  it('⚠️ walks the real days rather than dividing a monthly figure', () => {
    /* Mon–Sat at 1 static, plus a reel on Mon and Wed. The week Mon 17 – Sun 23 has
       six posting days and both reel days, so 6 + 2 = 8. Dividing a monthly number by
       four would give a different answer, and would give Sunday a target. */
    const report = buildProjectReport(reportPeriod('week', TODAY), [], [], CADENCE);
    expect(report.target).toBe(8);
    expect(report.offDays).toBe(1);
  });

  it('gives an off day a target of zero, and says it is off', () => {
    /* Sunday 23 August. */
    const report = buildProjectReport(
      reportPeriod('yesterday', '2026-08-24'),
      [],
      [],
      CADENCE,
    );
    expect(report.target).toBe(0);
    expect(report.offDays).toBe(1);
  });

  it('gives a posting day its own small target', () => {
    /* Monday: 1 static + 1 reel. */
    const monday = buildProjectReport(reportPeriod('today', '2026-08-17'), [], [], CADENCE);
    expect(monday.target).toBe(2);
    /* Tuesday: 1 static, no reel. */
    const tuesday = buildProjectReport(reportPeriod('today', '2026-08-18'), [], [], CADENCE);
    expect(tuesday.target).toBe(1);
  });

  it('is zero when no rhythm was agreed', () => {
    const report = buildProjectReport(reportPeriod('week', TODAY), [], [], {
      staticPostsPerDay: null,
      reelsPerWeek: null,
      reelDays: [],
      postingDays: [],
    });
    expect(report.target).toBe(0);
    /* Every day is an off day when nothing is scheduled — which is true, and better
       than claiming a target of zero was met. */
    expect(report.offDays).toBe(7);
  });

  it('never reports a negative remaining', () => {
    /* Publishing above target is a good outcome; "-4 remaining" is not a thing. */
    const report = buildProjectReport(
      reportPeriod('today', '2026-08-18'), // target 1
      [asset({ publishedOn: '2026-08-18' }), asset({ id: 'b', publishedOn: '2026-08-18' })],
      [],
      CADENCE,
    );
    expect(report.target).toBe(1);
    expect(report.totalAssets).toBe(2);
    expect(report.remaining).toBe(0);
  });

  it('bucket targets sum to the period target', () => {
    /* Otherwise the breakdown table and the headline disagree, and a reader trusts
       whichever they read second. */
    for (const kind of ['week', 'month'] as const) {
      const report = buildProjectReport(reportPeriod(kind, TODAY), [], [], CADENCE);
      expect(report.buckets.reduce((n, b) => n + b.target, 0), kind).toBe(report.target);
    }
  });
});

describe('empty periods', () => {
  it('says it is empty rather than reporting zeroes as an achievement', () => {
    const report = buildProjectReport(reportPeriod('week', TODAY), [], [], CADENCE);
    expect(report.isEmpty).toBe(true);
    expect(report.totalAssets).toBe(0);
    /* The target is still real — that is the point of an empty report. */
    expect(report.target).toBeGreaterThan(0);
    expect(report.remaining).toBe(report.target);
  });

  it('is not empty once anything went out', () => {
    const report = buildProjectReport(reportPeriod('week', TODAY), [asset()], [], CADENCE);
    expect(report.isEmpty).toBe(false);
  });
});
