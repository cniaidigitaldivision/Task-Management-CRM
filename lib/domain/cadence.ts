/* ============================================================================
 * THE POSTING RHYTHM, AND WHAT IT ADDS UP TO
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: *"Daily 1 post or 2 posts or reels. If 1 reel then show a
 * month, show a week, and on which days you want."* And: *"if it's, say, 2 reels
 * in a week, then only 2 days of the week should be selectable."*
 *
 * Owner decision the same day, chosen over storing both: **the cadence is the
 * truth and the monthly figures are derived from it.** A human agrees a rhythm —
 * one static post a day, two reels a week on Monday and Wednesday, Sundays off —
 * and the monthly total is a consequence.
 *
 * Pure by contract: no clock, no database. Every function takes the month it is
 * asked about, which is what makes the arithmetic testable against a fixed
 * calendar rather than against whenever it happens to run (doc 20 §5).
 *
 * ── ⚠️ TWO DIFFERENT QUESTIONS, TWO DIFFERENT FUNCTIONS ───────────────────────
 * They are easy to conflate and the difference is the whole design:
 *
 *   contractTargets()  — "what did we promise, as one number?"  MONTH-INDEPENDENT.
 *                        Stored on the project. Must never move.
 *   monthPlan()        — "what goes out in September, exactly?"  MONTH-SPECIFIC.
 *                        Recomputed whenever asked. Feeds the schedule generator.
 *
 * The contract cannot be month-specific. February has four Mondays and March may
 * have five, and a client's agreed minimum must not shrink because the month is
 * short — so `contractTargets` deliberately uses the FLOOR that every month
 * satisfies. That is the same principle as migration 033's: the project holds what
 * was agreed, and the calendar is not allowed to rewrite it.
 * ========================================================================= */

/** ISO weekday. 1 = Monday … 7 = Sunday, matching Postgres `isodow`. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Short labels, Monday first — the week as this division reads it. */
export const WEEKDAY_LABEL: Readonly<Record<Weekday, string>> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export const WEEKDAY_FULL: Readonly<Record<Weekday, string>> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export interface Cadence {
  /** Static posts on each posting day. Null = no daily rhythm agreed. */
  readonly staticPostsPerDay: number | null;
  /** Reels each week. `reelDays` must name exactly this many days. */
  readonly reelsPerWeek: number | null;
  readonly reelDays: readonly Weekday[];
  /** Days anything is published. Days absent from this are off days. */
  readonly postingDays: readonly Weekday[];
}

/* Every month contains at least four of each weekday — 28 days is four whole
   weeks, and no month is shorter. So four is the floor a rhythm always delivers,
   and therefore the only honest basis for a promise. */
const GUARANTEED_WEEKS = 4;

/* The longest month is 31 days: four whole weeks plus three days. Those three
   spare days give three of the seven weekdays a fifth occurrence — which is the
   most any month can ever contain. */
const LONGEST_MONTH_SPARE_DAYS = 3;

export interface ContractTargets {
  /** The promise. Null when no rhythm was agreed — not 0, which would be a promise
   *  to publish nothing. */
  readonly assetsMin: number | null;
  /** The ceiling a long month could reach. Anything above it is worth checking. */
  readonly assetsMax: number | null;
  readonly reelsMin: number | null;
  /** The parts, so a form can show its working rather than a bare total. */
  readonly staticPerMonthMin: number | null;
  readonly reelsPerMonthMin: number | null;
}

/**
 * The month-independent figures to store on the project.
 *
 * ⚠️ Returns nulls when nothing was agreed, and that distinction is load-bearing:
 * `projectProgress` treats a null minimum as "cannot be missed" and a zero minimum
 * as "met by publishing nothing". Collapsing them would paint an untargeted project
 * red, which is rule 2 of `project-progress.ts`.
 */
export function contractTargets(cadence: Cadence): ContractTargets {
  const { staticPostsPerDay, reelsPerWeek, postingDays, reelDays } = cadence;

  const hasStatic = staticPostsPerDay !== null;
  const hasReels = reelsPerWeek !== null;

  if (!hasStatic && !hasReels) {
    return {
      assetsMin: null,
      assetsMax: null,
      reelsMin: null,
      staticPerMonthMin: null,
      reelsPerMonthMin: null,
    };
  }

  /* Static: the rate times the number of working days in a week, times the four
     weeks every month is guaranteed to contain. */
  const staticPerWeek = hasStatic ? staticPostsPerDay * postingDays.length : 0;
  const staticMin = hasStatic ? staticPerWeek * GUARANTEED_WEEKS : null;

  /* Reels: the agreed weekly count, four times. `reelDays` is not consulted for
     the total — the count IS the commitment and the days only say when. The
     database constraint keeps them consistent. */
  const reelsMin = hasReels ? reelsPerWeek * GUARANTEED_WEEKS : null;

  const assetsMin = (staticMin ?? 0) + (reelsMin ?? 0);

  /* The ceiling. At most three weekdays get a fifth occurrence in a 31-day month,
     so a rhythm can exceed its floor by at most three days' worth of static posts
     and three of the reel days. */
  const staticBonus = hasStatic
    ? staticPostsPerDay * Math.min(LONGEST_MONTH_SPARE_DAYS, postingDays.length)
    : 0;
  const reelsBonus = hasReels
    ? Math.min(LONGEST_MONTH_SPARE_DAYS, reelDays.length)
    : 0;

  return {
    assetsMin,
    assetsMax: assetsMin + staticBonus + reelsBonus,
    reelsMin,
    staticPerMonthMin: staticMin,
    reelsPerMonthMin: reelsMin,
  };
}

/* ----------------------------------------------------------------------------
 * TURNING A PACKAGE'S MONTHLY FIGURES INTO A STARTING RHYTHM
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE TWO MODELS DO NOT DIVIDE EVENLY, AND THIS IS HONEST ABOUT IT ───────
 * The eight packages were written as MONTHLY quantities — SPARK is "14–16 content
 * assets, at least 2 reels". The cadence is weekly and integral. Two reels a month
 * is half a reel a week, which cannot be entered.
 *
 * So this returns a SUGGESTION, not a translation, and the form shows the resulting
 * monthly figures next to the package's own so any gap is visible rather than
 * quietly absorbed. The alternative — silently rounding 0.5 up to 1 and committing
 * the division to 4 reels a month against 2 sold — is the kind of error that only
 * surfaces as an unexplained cost months later.
 *
 * The static rate is held at one a day and the number of POSTING DAYS is what
 * flexes. That is the right way round: agencies do not post three times on a Monday
 * to hit a monthly number, they post on more days.
 * ------------------------------------------------------------------------- */

/** Monday, Wednesday, Friday, Tuesday, Thursday, Saturday, Sunday — the order days
 *  get added as a rhythm widens, so a 3-day week is spread rather than consecutive. */
const SPREAD_ORDER: readonly Weekday[] = [1, 3, 5, 2, 4, 6, 7];

export interface PackageShape {
  readonly assetsMin: number | null;
  readonly reelsMin: number | null;
}

/**
 * A rhythm that lands near what a package lists. Never authoritative — the human
 * adjusts it, and `contractTargets` then reports what they actually agreed.
 */
export function suggestCadence(pkg: PackageShape): Cadence {
  /* No stated minimum means nothing to aim at — an "up to N" package has no floor,
     so suggesting a rhythm would be inventing a commitment. */
  if (pkg.assetsMin === null) {
    return {
      staticPostsPerDay: null,
      reelsPerWeek: null,
      reelDays: [],
      postingDays: [1, 2, 3, 4, 5, 6],
    };
  }

  /* Reels first, because they come out of the asset total rather than sitting on
     top of it — rule 3 of project-progress.ts. */
  /* Clamped to a week: a package listing 100 reels a month would otherwise suggest
     25 a week, which no set of seven days can carry. */
  const reelsPerWeek = Math.min(
    7,
    Math.max(0, Math.round((pkg.reelsMin ?? 0) / GUARANTEED_WEEKS)),
  );
  const staticPerMonth = Math.max(0, pkg.assetsMin - (pkg.reelsMin ?? 0));

  /* One post a day, over however many days it takes. Clamped to a real week, and to
     at least as many days as there are reels — a reel needs a day to sit on. */
  const wantedDays = Math.round(staticPerMonth / GUARANTEED_WEEKS);
  const postingDayCount = Math.min(7, Math.max(reelsPerWeek, Math.max(1, wantedDays)));

  const postingDays = SPREAD_ORDER.slice(0, postingDayCount).sort((a, b) => a - b);

  return {
    staticPostsPerDay: staticPerMonth > 0 ? 1 : 0,
    reelsPerWeek,
    /* Reels land on the earliest posting days, spread by SPREAD_ORDER. */
    reelDays: SPREAD_ORDER.slice(0, postingDayCount)
      .slice(0, reelsPerWeek)
      .sort((a, b) => a - b),
    postingDays,
  };
}

/* ----------------------------------------------------------------------------
 * ONE ACTUAL MONTH
 * ------------------------------------------------------------------------- */

export interface PlannedDay {
  /** 'YYYY-MM-DD'. */
  readonly date: string;
  readonly weekday: Weekday;
  /** How many static posts this date carries. 0 on an off day. */
  readonly staticPosts: number;
  /** How many reels. 0 unless this weekday is a reel day. */
  readonly reels: number;
  /** True where the project does not post at all. Owner: *"mention that this is
   *  Sunday… today is off, that's why no post today."* */
  readonly isOff: boolean;
}

export interface MonthPlan {
  /** 'YYYY-MM-01'. */
  readonly monthStart: string;
  readonly days: readonly PlannedDay[];
  readonly staticPosts: number;
  readonly reels: number;
  readonly assets: number;
  readonly offDayCount: number;
}

/**
 * Every date in a month, with what the rhythm puts on it.
 *
 * ⚠️ Built from UTC parts, never by parsing and mutating a Date. `new
 * Date('2026-09-01')` is UTC midnight, so `getMonth()` returns August anywhere
 * behind UTC — and `setDate(d + 1)` across a DST boundary can repeat or skip a day.
 * Iterating an integer day counter against `Date.UTC` has neither failure mode.
 * `lib/now.ts` documents the same trap.
 */
export function monthPlan(cadence: Cadence, monthStart: string): MonthPlan {
  const [yearText, monthText] = monthStart.split('-');
  const year = Number(yearText);
  const month = Number(monthText); // 1-12

  const posting = new Set(cadence.postingDays);
  const reelSet = new Set(cadence.reelDays);
  const perDay = cadence.staticPostsPerDay ?? 0;

  /* Day 0 of the NEXT month is the last day of this one — the standard way to get
     a month's length without a table of 30s and 31s or a leap-year rule. */
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const days: PlannedDay[] = [];
  let staticPosts = 0;
  let reels = 0;
  let offDayCount = 0;

  for (let day = 1; day <= dayCount; day += 1) {
    const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
    const weekday = (jsDay === 0 ? 7 : jsDay) as Weekday;

    const isOff = !posting.has(weekday);
    const dayStatic = isOff ? 0 : perDay;
    const dayReels = !isOff && reelSet.has(weekday) ? 1 : 0;

    staticPosts += dayStatic;
    reels += dayReels;
    if (isOff) offDayCount += 1;

    days.push({
      date: `${yearText}-${monthText}-${String(day).padStart(2, '0')}`,
      weekday,
      staticPosts: dayStatic,
      reels: dayReels,
      isOff,
    });
  }

  return {
    monthStart,
    days,
    staticPosts,
    reels,
    assets: staticPosts + reels,
    offDayCount,
  };
}

/* ----------------------------------------------------------------------------
 * VALIDATION, SHARED BY THE FORM AND THE ACTION
 * ----------------------------------------------------------------------------
 * The same rules the database enforces in migration 036, so the form can say what
 * is wrong before a round trip instead of surfacing a constraint violation. The
 * database remains the authority — this exists to be polite, not to be trusted.
 * ------------------------------------------------------------------------- */

/** Null when the cadence is coherent, otherwise one sentence naming the problem. */
export function cadenceProblem(cadence: Cadence): string | null {
  const { staticPostsPerDay, reelsPerWeek, reelDays, postingDays } = cadence;

  if (staticPostsPerDay !== null && (staticPostsPerDay < 0 || staticPostsPerDay > 20)) {
    return 'Static posts a day has to be between 0 and 20.';
  }
  /* ⚠️ 7, not 21. Every reel needs its own weekday and there are only seven, so a
     higher figure can never satisfy the reel-day rule below. Migration 036 was
     written with a 0–21 range first and that range was unreachable — a property test
     asserting "a suggested cadence always passes its own validator" is what exposed
     it. */
  if (reelsPerWeek !== null && (reelsPerWeek < 0 || reelsPerWeek > 7)) {
    return 'Reels a week has to be between 0 and 7 — each one needs its own day.';
  }

  if (postingDays.length === 0 && (staticPostsPerDay ?? 0) > 0) {
    return 'Pick at least one posting day, or set static posts a day to 0.';
  }

  if (reelsPerWeek !== null && reelsPerWeek > 0) {
    if (reelDays.length !== reelsPerWeek) {
      /* The owner's rule. Stated as a count mismatch rather than "pick more days",
         because either half may be the one that is wrong. */
      return `${reelsPerWeek} reels a week needs exactly ${reelsPerWeek} reel ${
        reelsPerWeek === 1 ? 'day' : 'days'
      } — ${reelDays.length} ${reelDays.length === 1 ? 'is' : 'are'} picked.`;
    }
    const stray = reelDays.filter((day) => !postingDays.includes(day));
    if (stray.length > 0) {
      return `${stray.map((d) => WEEKDAY_FULL[d]).join(' and ')} ${
        stray.length === 1 ? 'is' : 'are'
      } an off day — a reel cannot go out then.`;
    }
  }

  /* ⚠️ There was a fourth check here — "more reels a week than there are posting
     days" — and it was unreachable. Once the count check has established
     `reelDays.length === reelsPerWeek` and the subset check has established
     `reelDays ⊆ postingDays`, it follows that `reelsPerWeek <= postingDays.length`.
     A test written to exercise it kept tripping one of the earlier two instead,
     which is what exposed it. Removed rather than left as a branch no input can
     reach: dead validation reads as a rule that is being enforced. */

  return null;
}
