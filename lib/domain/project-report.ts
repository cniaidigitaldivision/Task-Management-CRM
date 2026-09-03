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

/* ── ⚠️ TASK ROWS, AND WHY THEY ARE A SEPARATE AXIS ───────────────────────
   Owner, 2026-09-03: *"what task has been done in this whole week, Monday,
   Tuesday, Wednesday, and who does which task."*

   The buckets above count DELIVERY — what went out, against the package target.
   These count ACTIVITY — what was raised and what became of it. A report that
   showed only the first says nothing about a week where the team worked hard on
   things that are not yet published, which is most weeks. */
export interface ReportTaskInput {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  readonly contentKind: string | null;
  readonly status: string;
  readonly createdByName: string | null;
  readonly assigneeName: string | null;
  readonly createdOn: string;
  readonly dueDate: string | null;
  readonly completedOn: string | null;
}

/** One day (or week, or month) of activity, for the breakdown table. */
export interface TaskDayRow {
  readonly key: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly tasks: readonly ReportTaskInput[];
  readonly done: number;
  readonly open: number;
}

/** The report's own reading of how the period went, in words. */
export interface Verdict {
  readonly tone: 'ahead' | 'on_track' | 'behind' | 'untargeted';
  readonly headline: string;
  /** Acted on, not admired — each is something somebody could do next. */
  readonly suggestions: readonly string[];
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

  /* ── Activity, alongside delivery ─────────────────────────────────────── */
  readonly tasks: readonly ReportTaskInput[];
  /** The same tasks arranged by the period's own buckets — the day-by-day table. */
  readonly taskDays: readonly TaskDayRow[];
  readonly tasksCreated: number;
  readonly tasksDone: number;
  readonly tasksOpen: number;
  readonly tasksCancelled: number;
  /** What the cadence promises in a WHOLE month, whatever period this is. The
   *  owner asked for the monthly promise to be stated even on a daily report. */
  readonly monthlyPromise: number | null;
  readonly verdict: Verdict;
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
  tasks: readonly ReportTaskInput[] = [],
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

  /* ── The same buckets, filled with activity instead of delivery ───────────
     Reusing `period.buckets` rather than grouping by raw date is what makes a
     week report read Monday-to-Sunday and a month report read week-by-week
     without this function knowing which it is. */
  const taskDays: TaskDayRow[] = period.buckets.map((bucket) => {
    const inside = tasks.filter((task) => inBucket(task.createdOn, bucket));
    return {
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      tasks: inside,
      done: inside.filter((task) => task.status === 'done').length,
      open: inside.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length,
    };
  });

  const tasksDone = tasks.filter((task) => task.status === 'done').length;
  const tasksCancelled = tasks.filter((task) => task.status === 'cancelled').length;
  const tasksOpen = tasks.length - tasksDone - tasksCancelled;

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

    tasks,
    taskDays,
    tasksCreated: tasks.length,
    tasksDone,
    tasksOpen,
    tasksCancelled,
    monthlyPromise: monthlyPromise(cadence),
    verdict: readVerdict({
      target: whole.target,
      achieved: assets.length,
      tasksOpen,
      tasksCancelled,
      withoutLinks: placements.filter((placement) => placement.url === null).length,
    }),
  };
}

/**
 * What the cadence promises across a WHOLE month, whatever period is being
 * reported.
 *
 * ⚠️ Stated even on a daily report, because the owner asked for it: *"that
 * project name should mention their monthly promise, like they are targeted."* A
 * day's figure means little without the commitment it is a day of.
 *
 * ⚠️ Null, never 0, when nothing was agreed. `contractTargets` and
 * `projectProgress` already depend on that distinction: a zero promise is a
 * promise to publish nothing, which no client ever signs.
 */
function monthlyPromise(cadence: ReportCadence): number | null {
  const hasStatic = cadence.staticPostsPerDay !== null;
  const hasReels = cadence.reelsPerWeek !== null;
  if (!hasStatic && !hasReels) return null;

  /* Four whole weeks is the floor every month clears — 28 days — so it is the
     only honest basis for a promise. The same reasoning and the same constant as
     `contractTargets` in cadence.ts. */
  const WEEKS = 4;
  const postingDays = cadence.postingDays.length;
  const staticPerMonth = hasStatic ? (cadence.staticPostsPerDay ?? 0) * postingDays * WEEKS : 0;
  const reelsPerMonth = hasReels ? (cadence.reelsPerWeek ?? 0) * WEEKS : 0;
  return staticPerMonth + reelsPerMonth;
}

/**
 * The report's own reading, in words, with something to do about it.
 *
 * Owner, 2026-09-03: *"the target is this one: achieve this one, left this one,
 * you are lagging, you are completing your own time, you are progressing. Any
 * suggestion should be mentioned below."*
 *
 * ⚠️ EVERY SUGGESTION NAMES A NUMBER FROM THIS REPORT. A line like "consider
 * improving consistency" is filler that survives review and helps nobody; each
 * of these is a thing somebody could act on before lunch, and none appears
 * unless the figure behind it says so.
 */
function readVerdict(input: {
  target: number;
  achieved: number;
  tasksOpen: number;
  tasksCancelled: number;
  withoutLinks: number;
}): Verdict {
  /* ⚠️ JUDGED AGAINST THE PERIOD, NEVER AGAINST THE WALL CLOCK. A report is a
     document about a span that has been chosen, and one that read "today" would
     say something different every time it was opened — including calling a month
     that finished last year "behind schedule". `target` is already pro-rated to
     the period by `planFor`, so the comparison below is complete as it stands.
     (An earlier draft carried an `elapsedFraction` helper for this and it always
     returned 1, which is a stub wearing a comment; it is gone.) */
  const { target, achieved, tasksOpen, tasksCancelled, withoutLinks } = input;
  const suggestions: string[] = [];

  if (withoutLinks > 0) {
    suggestions.push(
      `${withoutLinks} ${withoutLinks === 1 ? 'post has' : 'posts have'} no live link recorded. Paste the link on each, or the delivery figure a client is shown cannot be checked.`,
    );
  }
  if (tasksOpen > 0) {
    suggestions.push(
      `${tasksOpen} ${tasksOpen === 1 ? 'task is' : 'tasks are'} still open from this period. Close what is finished so the next report starts clean.`,
    );
  }
  if (tasksCancelled > 0) {
    suggestions.push(
      `${tasksCancelled} ${tasksCancelled === 1 ? 'task was' : 'tasks were'} cancelled. Worth a look if that is more than usual — cancelled work is effort that produced nothing.`,
    );
  }

  if (target <= 0) {
    return {
      tone: 'untargeted',
      headline:
        'No posting rhythm is agreed for this project, so there is nothing to measure delivery against.',
      suggestions: suggestions.length > 0
        ? suggestions
        : ['Set a rhythm under Edit project and this report will start scoring against it.'],
    };
  }

  const short = target - achieved;

  if (short <= 0) {
    return {
      tone: 'ahead',
      headline:
        achieved === target
          ? `Target met: ${achieved} of ${target}.`
          : `Target beaten: ${achieved} published against a target of ${target}.`,
      suggestions,
    };
  }

  /* ── ⚠️ THE TOLERANCE ONLY EXISTS WHERE A TENTH MEANS SOMETHING ──────────
     Within a tenth of the promise is "nearly there" rather than "behind": a
     report that calls one post short of thirty a failure gets ignored, and then
     so does the one that matters.

     But it must NOT round up on small targets. The first version read
     `Math.max(1, round(target * 0.1))`, which gives a tolerance of 1 when the
     target IS 1 — so a single day with nothing published at all was reported as
     "on track". A day that was entirely missed is not nearly anything. Caught by
     the test named for that case.

     So: no tolerance below a target of ten, where a tenth cannot round to a
     whole post without swallowing the entire target. */
  const tolerance = target >= 10 ? Math.round(target * 0.1) : 0;

  if (short <= tolerance) {
    return {
      tone: 'on_track',
      headline: `On track: ${achieved} of ${target}, ${short} to go.`,
      suggestions,
    };
  }

  return {
    tone: 'behind',
    headline: `Behind: ${achieved} of ${target}, ${short} still owed.`,
    suggestions: [
      `${short} more ${short === 1 ? 'post' : 'posts'} would meet the target for this period.`,
      ...suggestions,
    ],
  };
}
