import { describe, expect, it } from 'vitest';

import {
  cadenceProblem,
  contractTargets,
  monthPlan,
  suggestCadence,
  type Cadence,
  type Weekday,
} from '../cadence';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * The cadence is now the only place a posting commitment is entered, and the
 * monthly contract figures every report judges against are derived from it. A
 * mistake here silently changes what a client is recorded as having been promised —
 * so the arithmetic is pinned exhaustively, and so is the null-vs-zero distinction
 * that `project-progress.ts` depends on.
 * ========================================================================= */

const MON = 1 as Weekday;
const TUE = 2 as Weekday;
const WED = 3 as Weekday;
const THU = 4 as Weekday;
const FRI = 5 as Weekday;
const SAT = 6 as Weekday;
const SUN = 7 as Weekday;

const MON_TO_SAT = [MON, TUE, WED, THU, FRI, SAT];

function cadence(over: Partial<Cadence> = {}): Cadence {
  return {
    staticPostsPerDay: 1,
    reelsPerWeek: 2,
    reelDays: [MON, WED],
    postingDays: MON_TO_SAT,
    ...over,
  };
}

describe('contractTargets', () => {
  it('derives the monthly promise from the weekly rhythm', () => {
    /* 1 static × 6 posting days × 4 guaranteed weeks = 24 static.
       2 reels × 4 weeks = 8 reels. 32 assets in total. */
    const t = contractTargets(cadence());
    expect(t.staticPerMonthMin).toBe(24);
    expect(t.reelsPerMonthMin).toBe(8);
    expect(t.assetsMin).toBe(32);
    expect(t.reelsMin).toBe(8);
  });

  it('uses four weeks, not 4.3, because a promise must hold in February', () => {
    /* ⚠️ The load-bearing decision. Every month contains at least four of each
       weekday, so four is the only multiplier a client can rely on. Using an
       average would make the recorded promise unachievable in a short month, and
       the project would read as "behind" through no fault of anybody's. */
    const t = contractTargets(cadence({ postingDays: [MON], reelsPerWeek: 0, reelDays: [] }));
    expect(t.staticPerMonthMin).toBe(4);
  });

  it('gives a ceiling that a 31-day month can actually reach', () => {
    /* A 31-day month is four weeks plus three days, so at most three weekdays get a
       fifth occurrence. With 6 posting days that is +3 static, and with 2 reel days
       +2 reels. */
    const t = contractTargets(cadence());
    expect(t.assetsMax).toBe(32 + 3 + 2);
  });

  it('does not let the ceiling exceed what the posting days allow', () => {
    /* Two posting days cannot pick up three bonus days. `Math.min` is what stops
       the ceiling drifting above anything reachable. */
    const t = contractTargets(
      cadence({ postingDays: [MON, WED], reelDays: [MON, WED], reelsPerWeek: 2 }),
    );
    expect(t.staticPerMonthMin).toBe(8);
    // 8 static + 8 reels = 16 floor; bonus is min(3,2)=2 static and min(3,2)=2 reels
    expect(t.assetsMin).toBe(16);
    expect(t.assetsMax).toBe(16 + 2 + 2);
  });

  it('returns null — not zero — when nothing was agreed', () => {
    /* ⚠️ `projectProgress` treats a null minimum as "cannot be missed" and zero as
       "met by publishing nothing". Collapsing them paints an untargeted project
       red, which is rule 2 of project-progress.ts. */
    const t = contractTargets(
      cadence({ staticPostsPerDay: null, reelsPerWeek: null, reelDays: [] }),
    );
    expect(t.assetsMin).toBeNull();
    expect(t.assetsMax).toBeNull();
    expect(t.reelsMin).toBeNull();
  });

  it('keeps an explicit zero as a real commitment', () => {
    const t = contractTargets(
      cadence({ staticPostsPerDay: 0, reelsPerWeek: 0, reelDays: [] }),
    );
    expect(t.assetsMin).toBe(0);
    expect(t.reelsMin).toBe(0);
  });

  it('handles reels with no static posts, and static with no reels', () => {
    const reelsOnly = contractTargets(
      cadence({ staticPostsPerDay: null, reelsPerWeek: 3, reelDays: [MON, WED, FRI] }),
    );
    expect(reelsOnly.staticPerMonthMin).toBeNull();
    expect(reelsOnly.reelsMin).toBe(12);
    expect(reelsOnly.assetsMin).toBe(12);

    const staticOnly = contractTargets(
      cadence({ staticPostsPerDay: 2, reelsPerWeek: null, reelDays: [] }),
    );
    expect(staticOnly.reelsMin).toBeNull();
    expect(staticOnly.assetsMin).toBe(2 * 6 * 4);
  });

  it('counts reels from the weekly figure, not from the day list', () => {
    /* The count IS the commitment; the days only say when. The database keeps them
       equal, so this asserts the total does not double-count. */
    const t = contractTargets(cadence({ reelsPerWeek: 2, reelDays: [MON, WED] }));
    expect(t.reelsMin).toBe(8);
  });
});

describe('monthPlan', () => {
  it('lays out every date in the month', () => {
    const plan = monthPlan(cadence(), '2026-09-01');
    expect(plan.days).toHaveLength(30);
    expect(plan.days[0]!.date).toBe('2026-09-01');
    expect(plan.days[29]!.date).toBe('2026-09-30');
  });

  it('gets the weekday right, in UTC, for the first of the month', () => {
    /* ⚠️ 1 September 2026 is a Tuesday. Parsing '2026-09-01' with `new Date` and
       reading local parts returns 31 August anywhere behind UTC, which would shift
       every weekday in the plan by one and put reels on the wrong days. */
    const plan = monthPlan(cadence(), '2026-09-01');
    expect(plan.days[0]!.weekday).toBe(TUE);
  });

  it('marks off days as off and puts nothing on them', () => {
    const plan = monthPlan(cadence(), '2026-09-01');
    const sundays = plan.days.filter((d) => d.weekday === SUN);
    expect(sundays).toHaveLength(4); // September 2026: 6, 13, 20, 27
    for (const day of sundays) {
      expect(day.isOff).toBe(true);
      expect(day.staticPosts).toBe(0);
      expect(day.reels).toBe(0);
    }
    expect(plan.offDayCount).toBe(4);
  });

  it('counts exactly what the month contains, not the guaranteed floor', () => {
    /* September 2026 has 30 days: 4 Sundays off, 26 posting days at 1 static each,
       and reels on 4 Mondays + 5 Wednesdays = 9. This is where monthPlan and
       contractTargets legitimately differ — 35 actual against a 32 promise. */
    const plan = monthPlan(cadence(), '2026-09-01');
    expect(plan.staticPosts).toBe(26);
    expect(plan.reels).toBe(9);
    expect(plan.assets).toBe(35);
    expect(plan.assets).toBeGreaterThan(contractTargets(cadence()).assetsMin!);
  });

  it('handles February, and a leap February', () => {
    const feb2026 = monthPlan(cadence(), '2026-02-01');
    expect(feb2026.days).toHaveLength(28);
    /* 2028 is a leap year — the day count must come from the calendar, not a table. */
    const feb2028 = monthPlan(cadence(), '2028-02-01');
    expect(feb2028.days).toHaveLength(29);
  });

  it('handles a 31-day month', () => {
    expect(monthPlan(cadence(), '2026-12-01').days).toHaveLength(31);
    expect(monthPlan(cadence(), '2026-01-01').days).toHaveLength(31);
  });

  it('puts multiple static posts on a day when the rate says so', () => {
    const plan = monthPlan(cadence({ staticPostsPerDay: 3 }), '2026-09-01');
    const working = plan.days.find((d) => !d.isOff)!;
    expect(working.staticPosts).toBe(3);
    expect(plan.staticPosts).toBe(26 * 3);
  });

  it('schedules nothing at all when there are no posting days', () => {
    const plan = monthPlan(cadence({ postingDays: [], reelDays: [], reelsPerWeek: 0 }), '2026-09-01');
    expect(plan.staticPosts).toBe(0);
    expect(plan.reels).toBe(0);
    expect(plan.offDayCount).toBe(30);
    expect(plan.days.every((d) => d.isOff)).toBe(true);
  });

  it('never puts a reel on an off day even if the day list says to', () => {
    /* The database refuses this combination, but the generator must not produce
       phantom work if a row ever slips through — a reel on a day nobody works is a
       task assigned to nobody on a day the client was told is quiet. */
    const plan = monthPlan(
      cadence({ reelDays: [SUN], reelsPerWeek: 1, postingDays: MON_TO_SAT }),
      '2026-09-01',
    );
    expect(plan.reels).toBe(0);
  });

  it('produces dates that are all valid and in order', () => {
    const plan = monthPlan(cadence(), '2026-02-01');
    const dates = plan.days.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe('suggestCadence', () => {
  it('always suggests something the form and the database will accept', () => {
    /* ⚠️ The property that matters most. A suggestion that trips its own validator
       would hand somebody a form that is broken before they have touched it. Run
       across all eight seeded packages plus the awkward edges. */
    const shapes = [
      { assetsMin: 14, reelsMin: 2 }, // SPARK
      { assetsMin: 22, reelsMin: null }, // STARTER
      { assetsMin: 30, reelsMin: null }, // GROWTH
      { assetsMin: 40, reelsMin: null }, // MOMENTUM
      { assetsMin: null, reelsMin: null }, // PERFORMANCE — "up to 75", no floor
      { assetsMin: 0, reelsMin: 0 },
      { assetsMin: 1, reelsMin: 0 },
      { assetsMin: 200, reelsMin: 100 }, // absurd, must still be coherent
    ];
    for (const shape of shapes) {
      const suggested = suggestCadence(shape);
      expect(cadenceProblem(suggested), JSON.stringify(shape)).toBeNull();
    }
  });

  it('suggests nothing to aim at when the package has no floor', () => {
    /* "Up to 75 assets" has no minimum, so inventing a rhythm would be inventing a
       commitment — rule 2 of project-progress.ts in a different costume. */
    const suggested = suggestCadence({ assetsMin: null, reelsMin: null });
    expect(suggested.staticPostsPerDay).toBeNull();
    expect(suggested.reelsPerWeek).toBeNull();
    expect(suggested.reelDays).toEqual([]);
  });

  it('flexes the number of posting days rather than posting twice a day', () => {
    /* SPARK: 14 assets of which 2 reels leaves 12 static, which at one a day over
       four weeks is three posting days. Not "3 posts on one day". */
    const spark = suggestCadence({ assetsMin: 14, reelsMin: 2 });
    expect(spark.staticPostsPerDay).toBe(1);
    expect(spark.postingDays).toHaveLength(3);
  });

  it('spreads the days instead of bunching them at the start of the week', () => {
    const spark = suggestCadence({ assetsMin: 14, reelsMin: 2 });
    /* Mon, Wed, Fri — not Mon, Tue, Wed. A client posting three times a week does
       not post on three consecutive days and then go quiet for four. */
    expect(spark.postingDays).toEqual([1, 3, 5]);
  });

  it('keeps every reel day inside the posting days', () => {
    for (const shape of [
      { assetsMin: 14, reelsMin: 2 },
      { assetsMin: 8, reelsMin: 8 },
      { assetsMin: 30, reelsMin: 4 },
    ]) {
      const s = suggestCadence(shape);
      for (const day of s.reelDays) {
        expect(s.postingDays, JSON.stringify(shape)).toContain(day);
      }
    }
  });

  it('gives a reel-heavy package enough days to put them on', () => {
    /* 8 reels a month is 2 a week, and 2 reel days cannot fit in a 1-day week. */
    const s = suggestCadence({ assetsMin: 8, reelsMin: 8 });
    expect(s.reelsPerWeek).toBe(2);
    expect(s.postingDays.length).toBeGreaterThanOrEqual(2);
    expect(s.reelDays).toHaveLength(2);
  });

  it('never suggests more than a seven-day week', () => {
    const s = suggestCadence({ assetsMin: 200, reelsMin: 100 });
    expect(s.postingDays.length).toBeLessThanOrEqual(7);
    expect(s.reelDays.length).toBeLessThanOrEqual(7);
  });

  it('does not pretend to hit a monthly figure it cannot express', () => {
    /* ⚠️ SPARK sells 2 reels a MONTH. That is half a reel a week, which cannot be
       entered — so the suggestion rounds to 1 a week and therefore proposes 4 a
       month. This test exists to record that the gap is REAL and deliberate: the
       form shows the derived monthly figures beside the package's own so a human
       sees it and decides, rather than the code quietly committing to double. */
    const s = suggestCadence({ assetsMin: 14, reelsMin: 2 });
    expect(s.reelsPerWeek).toBe(1);
    expect(contractTargets(s).reelsMin).toBe(4);
    expect(contractTargets(s).reelsMin).not.toBe(2);
  });
});

describe('cadenceProblem', () => {
  it('accepts a coherent rhythm', () => {
    expect(cadenceProblem(cadence())).toBeNull();
  });

  it('accepts a rhythm with nothing agreed yet', () => {
    expect(
      cadenceProblem(cadence({ staticPostsPerDay: null, reelsPerWeek: null, reelDays: [] })),
    ).toBeNull();
  });

  it('refuses a reel count that does not match its day list', () => {
    /* ⚠️ The owner's rule: *"if it's, say, 2 reels in a week, then only 2 days of
       the week should be selectable."* */
    expect(cadenceProblem(cadence({ reelsPerWeek: 2, reelDays: [MON] }))).toMatch(
      /needs exactly 2 reel days/,
    );
    expect(cadenceProblem(cadence({ reelsPerWeek: 2, reelDays: [MON, WED, FRI] }))).toMatch(
      /needs exactly 2 reel days/,
    );
  });

  it('uses singular wording for one reel', () => {
    expect(cadenceProblem(cadence({ reelsPerWeek: 1, reelDays: [] }))).toMatch(
      /needs exactly 1 reel day — 0 are picked/,
    );
  });

  it('refuses a reel on an off day, and names the day', () => {
    expect(
      cadenceProblem(cadence({ reelsPerWeek: 2, reelDays: [MON, SUN] })),
    ).toMatch(/Sunday is an off day/);
  });

  it('catches an over-booked week through the count and off-day rules', () => {
    /* ⚠️ There is deliberately no separate "more reels than posting days" check —
       it is unreachable, because a matching count plus every reel day being a
       posting day already implies it. Trying to write a test for it is what proved
       that. Both routes to the same mistake are asserted here instead. */
    expect(
      cadenceProblem(cadence({ postingDays: [MON, WED], reelsPerWeek: 3, reelDays: [MON, WED] })),
    ).toMatch(/needs exactly 3 reel days/);

    expect(
      cadenceProblem(
        cadence({ postingDays: [MON, WED], reelsPerWeek: 3, reelDays: [MON, WED, FRI] }),
      ),
    ).toMatch(/Friday is an off day/);
  });

  it('refuses static posts with no posting days', () => {
    expect(
      cadenceProblem(cadence({ postingDays: [], staticPostsPerDay: 1, reelsPerWeek: 0, reelDays: [] })),
    ).toMatch(/at least one posting day/);
  });

  it('allows no posting days when nothing is being posted', () => {
    expect(
      cadenceProblem(
        cadence({ postingDays: [], staticPostsPerDay: 0, reelsPerWeek: 0, reelDays: [] }),
      ),
    ).toBeNull();
  });

  it('refuses figures outside a sane range', () => {
    expect(cadenceProblem(cadence({ staticPostsPerDay: 21 }))).toMatch(/between 0 and 20/);
    expect(cadenceProblem(cadence({ staticPostsPerDay: -1 }))).toMatch(/between 0 and 20/);
    expect(cadenceProblem(cadence({ reelsPerWeek: 8, reelDays: [] }))).toMatch(/between 0 and 7/);
  });

  it('agrees with what migration 036 enforces', () => {
    /* The database is the authority; this is the polite copy. Cases the constraint
       refuses must be refused here too, or the form lets somebody submit into a
       constraint violation they cannot interpret. */
    const refusedByDatabase: Cadence[] = [
      cadence({ reelsPerWeek: 2, reelDays: [MON, WED, FRI] }), // count mismatch
      cadence({ reelsPerWeek: 2, reelDays: [MON, SUN] }), // reel on an off day
      cadence({ staticPostsPerDay: 99 }), // out of range
    ];
    for (const bad of refusedByDatabase) {
      expect(cadenceProblem(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });
});
