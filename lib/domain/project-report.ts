import type { ReportBucket, ReportPeriod } from './report-periods';

/* ============================================================================
 * SHAPING A PROJECT REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"If today, then show today's social media platform. This is done. This is the whole
 * month or this week's target. This is achieved. This is remaining."*
 * *"If I want a week-wise report, show day-wise: Monday: this post…"*
 * *"month-wise… This week: 4 static posts, 2 reels. Second week: this."*
 * *"year… give a report month-wise."*
 *
 * Pure by contract: rows in, a finished report model out. No clock, no database, no
 * network — which is what lets the arithmetic be tested against a fixed calendar, and
 * what keeps the figures out of the hands of anything that could invent them.
 *
 * ── ⚠️ ASSETS AND PLACEMENTS ARE COUNTED SEPARATELY, ON PURPOSE ────────────────
 * One asset cross-posted to Facebook, Instagram and TikTok is ONE asset and THREE
 * placements. The package target is measured in assets; reach is measured in
 * placements. Adding them together — or using placements where the target is
 * concerned — inflates delivery threefold, and it is the single easiest way to make a
 * client report flattering and wrong.
 *
 * ── THE TARGET FOR A PERIOD IS PRO-RATED FROM THE CADENCE ─────────────────────
 * A month has a stored contract figure; a Tuesday does not. So a period's target is
 * computed from the rhythm — what the project agreed to publish on the days the period
 * actually contains — rather than by dividing a monthly number by 30. Dividing would
 * give a Sunday a target on a project that does not post on Sundays.
 * ========================================================================= */

export interface ReportAssetInput {
  readonly id: string;
  readonly title: string;
  readonly publishedOn: string;
  readonly contentKind: string;
  readonly assigneeName: string | null;
}

export interface ReportPlacementInput {
  readonly platformId: string;
  readonly platformName: string;
  readonly platformSlug: string;
  readonly publishedOn: string;
  readonly contentKind: string;
  readonly url: string | null;
}

/** What the project agreed, so a period's target can be pro-rated from it. */
export interface ReportCadence {
  readonly staticPostsPerDay: number | null;
  readonly reelsPerWeek: number | null;
  readonly reelDays: readonly number[];
  readonly postingDays: readonly number[];
}

export interface BucketRow {
  readonly key: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly staticPosts: number;
  readonly reels: number;
  readonly assets: number;
  /** What the rhythm says this bucket should have contained. */
  readonly target: number;
  /** Working days in the bucket — so a row can say "3 off days" honestly. */
  readonly offDays: number;
}

export interface PlatformRow {
  readonly platformId: string;
  readonly name: string;
  readonly slug: string;
  readonly placements: number;
  readonly withLinks: number;
}

export interface ProjectReport {
  readonly period: ReportPeriod;
  readonly buckets: readonly BucketRow[];
  readonly platforms: readonly PlatformRow[];
  /** Assets, not placements. */
  readonly totalStatic: number;
  readonly totalReels: number;
  readonly totalAssets: number;
  /** Pro-rated from the cadence across the whole period. */
  readonly target: number;
  /** Never negative — publishing above target is `exceeded`, not "-4 remaining". */
  readonly remaining: number;
  readonly totalPlacements: number;
  readonly totalWithLinks: number;
  readonly offDays: number;
  /** True when the project published nothing at all in the period. */
  readonly isEmpty: boolean;
}

const DAY_MS = 86_400_000;

function ms(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
function isoWeekday(date: string): number {
  const jsDay = new Date(ms(date)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * What the rhythm says a date range should contain, and how many of its days are off.
 *
 * ⚠️ Walked day by day rather than multiplied. A range of 17 days is not 2.43 weeks,
 * and a project posting on Mondays and Wednesdays gets a different total depending on
 * which weekdays the range happens to include. Walking is exact; the arithmetic
 * shortcut is only ever approximately right.
 */
function planFor(
  cadence: ReportCadence,
  start: string,
  end: string,
): { target: number; offDays: number } {
  const posting = new Set(cadence.postingDays);
  const reelSet = new Set(cadence.reelDays);
  const perDay = cadence.staticPostsPerDay ?? 0;

  let target = 0;
  let offDays = 0;

  /* Bounded by the range itself; both ends are inclusive. */
  for (let at = ms(start); at <= ms(end); at += DAY_MS) {
    const date = isoOf(at);
    const weekday = isoWeekday(date);

    if (!posting.has(weekday)) {
      offDays += 1;
      continue;
    }
    target += perDay;
    /* A reel only counts where the project actually posts that day — the same rule
       the calendar grid follows, and the database refuses the contradiction anyway. */
    if (reelSet.has(weekday)) target += 1;
  }

  return { target, offDays };
}

function isoOf(value: number): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function inBucket(date: string, bucket: ReportBucket): boolean {
  /* String comparison is exact for ISO dates and avoids building two Dates per row. */
  return date >= bucket.start && date <= bucket.end;
}

export function buildProjectReport(
  period: ReportPeriod,
  assets: readonly ReportAssetInput[],
  placements: readonly ReportPlacementInput[],
  cadence: ReportCadence,
): ProjectReport {
  const buckets: BucketRow[] = period.buckets.map((bucket) => {
    const inside = assets.filter((asset) => inBucket(asset.publishedOn, bucket));
    const reels = inside.filter((asset) => asset.contentKind === 'reel').length;
    const plan = planFor(cadence, bucket.start, bucket.end);

    return {
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      /* ⚠️ Static is everything that is NOT a reel, not `contentKind === 'static'`.
         A carousel and a story are static posts as far as a client's feed is
         concerned, and counting only 'static' would under-report a project that
         posts carousels. Reels are the category that is separately promised. */
      staticPosts: inside.length - reels,
      reels,
      assets: inside.length,
      target: plan.target,
      offDays: plan.offDays,
    };
  });

  /* ── Per platform, from placements ─────────────────────────────────────────
     Grouped by id rather than by name: "X (Twitter)" has already been reworded once,
     and a grouping keyed on a label silently splits into two rows the day somebody
     edits it. */
  const byPlatform = new Map<string, PlatformRow>();
  for (const placement of placements) {
    const existing = byPlatform.get(placement.platformId);
    if (existing) {
      byPlatform.set(placement.platformId, {
        ...existing,
        placements: existing.placements + 1,
        withLinks: existing.withLinks + (placement.url ? 1 : 0),
      });
    } else {
      byPlatform.set(placement.platformId, {
        platformId: placement.platformId,
        name: placement.platformName,
        slug: placement.platformSlug,
        placements: 1,
        withLinks: placement.url ? 1 : 0,
      });
    }
  }

  const totalReels = assets.filter((asset) => asset.contentKind === 'reel').length;
  const whole = planFor(cadence, period.start, period.end);

  return {
    period,
    buckets,
    platforms: [...byPlatform.values()].sort((a, b) => b.placements - a.placements),
    totalStatic: assets.length - totalReels,
    totalReels,
    totalAssets: assets.length,
    target: whole.target,
    /* ⚠️ Clamped. "-4 remaining" is not a thing; publishing above target is a good
       outcome and the report says so by showing achieved above the target. */
    remaining: Math.max(0, whole.target - assets.length),
    totalPlacements: placements.length,
    totalWithLinks: placements.filter((placement) => placement.url !== null).length,
    offDays: whole.offDays,
    isEmpty: assets.length === 0,
  };
}
