import { describe, expect, it } from 'vitest';

import { monthPlan, type Cadence, type Weekday } from '../cadence';
import {
  describeShortfall,
  monthsSpanning,
  scheduleShortfall,
  type DayTally,
  type ScheduledTask,
} from '../schedule';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * This generator WRITES TASKS. Every other domain module computes a number that
 * a screen displays; a mistake here puts rows in the database that somebody has
 * to find and delete by hand.
 *
 * Two properties carry that risk and are pinned hardest:
 *
 *   1. IDEMPOTENCE — applying the result and asking again must yield nothing.
 *      Without it, a nightly job that retries after a timeout doubles a day,
 *      and the button doubles a month every time it is pressed.
 *
 *   2. THE WINDOW — nothing is ever produced outside [from, to]. Backdating
 *      manufactures overdue work that nobody was asked to do, and a month
 *      boundary is exactly where an off-by-one hides.
 * ========================================================================= */

/* August 2026: the 1st is a Saturday. Mon–Sat posting, one static a day, one
   reel on Wednesdays — close to the Daniyal Marketing project this was built
   for, so the numbers are recognisable rather than abstract. */
const CADENCE: Cadence = {
  staticPostsPerDay: 1,
  reelsPerWeek: 1,
  reelDays: [3] as Weekday[],
  postingDays: [1, 2, 3, 4, 5, 6] as Weekday[],
};

const AUGUST = '2026-08-01';
const plan = monthPlan(CADENCE, AUGUST);

/** The generator's own output, folded back into a tally — how the database would
 *  look after the tasks were created. This is what makes the idempotence test a
 *  real round trip rather than a restatement of the expectation. */
function applied(tasks: readonly ScheduledTask[], seed: readonly DayTally[] = []): DayTally[] {
  const byDate = new Map<string, DayTally>();
  for (const day of seed) byDate.set(day.date, { ...day });

  for (const task of tasks) {
    const current = byDate.get(task.date) ?? { date: task.date, staticPosts: 0, reels: 0 };
    byDate.set(task.date, {
      date: task.date,
      staticPosts: current.staticPosts + (task.contentKind === 'static' ? 1 : 0),
      reels: current.reels + (task.contentKind === 'reel' ? 1 : 0),
    });
  }

  return [...byDate.values()];
}

describe('scheduleShortfall — an empty calendar', () => {
  const tasks = scheduleShortfall({
    plan,
    existing: [],
    from: '2026-08-01',
    to: '2026-08-31',
  });

  it('produces one task per planned slot for the whole month', () => {
    expect(tasks).toHaveLength(plan.assets);
  });

  it('splits them exactly as the plan does', () => {
    const statics = tasks.filter((t) => t.contentKind === 'static').length;
    const reels = tasks.filter((t) => t.contentKind === 'reel').length;
    expect(statics).toBe(plan.staticPosts);
    expect(reels).toBe(plan.reels);
  });

  it('never lands on an off day', () => {
    const offDays = new Set(plan.days.filter((d) => d.isOff).map((d) => d.date));
    expect(tasks.filter((t) => offDays.has(t.date))).toEqual([]);
  });

  it('returns them in date order', () => {
    const dates = tasks.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('sizes a reel above a static post, because it is more work', () => {
    const aStatic = tasks.find((t) => t.contentKind === 'static');
    const aReel = tasks.find((t) => t.contentKind === 'reel');
    expect(aStatic?.effortPoints).toBeLessThan(aReel?.effortPoints ?? 0);
  });
});

describe('scheduleShortfall — idempotence', () => {
  it('asks for nothing once its own output has been applied', () => {
    const first = scheduleShortfall({ plan, existing: [], from: AUGUST, to: '2026-08-31' });

    const second = scheduleShortfall({
      plan,
      existing: applied(first),
      from: AUGUST,
      to: '2026-08-31',
    });

    expect(second).toEqual([]);
  });

  it('holds for a partial window too', () => {
    const first = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-10',
      to: '2026-08-16',
    });
    const second = scheduleShortfall({
      plan,
      existing: applied(first),
      from: '2026-08-10',
      to: '2026-08-16',
    });

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });
});

describe('scheduleShortfall — topping up rather than duplicating', () => {
  /* Three static posts a day is the case that exposes an off-by-one: a day that
     already holds one must receive two, numbered 2 and 3. */
  const busy = monthPlan({ ...CADENCE, staticPostsPerDay: 3, reelsPerWeek: 0, reelDays: [] }, AUGUST);

  it('creates only the difference when a day is partly filled', () => {
    const tasks = scheduleShortfall({
      plan: busy,
      existing: [{ date: '2026-08-03', staticPosts: 1, reels: 0 }],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(tasks).toHaveLength(2);
  });

  it('numbers the new ones after what is already there', () => {
    const tasks = scheduleShortfall({
      plan: busy,
      existing: [{ date: '2026-08-03', staticPosts: 1, reels: 0 }],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(tasks.map((t) => t.title)).toEqual([
      'Static post 2 of 3 — 3 Aug',
      'Static post 3 of 3 — 3 Aug',
    ]);
  });

  it('creates nothing for a day that is already full', () => {
    const tasks = scheduleShortfall({
      plan: busy,
      existing: [{ date: '2026-08-03', staticPosts: 3, reels: 0 }],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(tasks).toEqual([]);
  });

  it('never tries to remove work when a day holds more than the rhythm asks', () => {
    const tasks = scheduleShortfall({
      plan: busy,
      existing: [{ date: '2026-08-03', staticPosts: 9, reels: 0 }],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(tasks).toEqual([]);
  });
});

describe('scheduleShortfall — the window', () => {
  it('produces nothing before `from`', () => {
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-15',
      to: '2026-08-31',
    });

    expect(tasks.every((t) => t.date >= '2026-08-15')).toBe(true);
  });

  it('produces nothing after `to`', () => {
    const tasks = scheduleShortfall({ plan, existing: [], from: AUGUST, to: '2026-08-10' });
    expect(tasks.every((t) => t.date <= '2026-08-10')).toBe(true);
  });

  it('includes both endpoints', () => {
    /* 3 and 4 August are Monday and Tuesday — both posting days, so both must
       appear when they are the exact bounds. */
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-03',
      to: '2026-08-04',
    });

    expect(new Set(tasks.map((t) => t.date))).toEqual(new Set(['2026-08-03', '2026-08-04']));
  });

  it('is empty when the window closes before it opens', () => {
    expect(
      scheduleShortfall({ plan, existing: [], from: '2026-08-20', to: '2026-08-10' }),
    ).toEqual([]);
  });
});

describe('scheduleShortfall — titles', () => {
  it('omits the position when a day carries only one of a kind', () => {
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(tasks[0].title).toBe('Static post — 3 Aug');
  });

  it('names the reel by its own label', () => {
    /* 5 August 2026 is a Wednesday — the reel day in this cadence. */
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-05',
      to: '2026-08-05',
    });

    expect(tasks.some((t) => t.contentKind === 'reel')).toBe(true);
    expect(tasks.find((t) => t.contentKind === 'reel')?.title).toContain('5 Aug');
  });
});

describe('describeShortfall', () => {
  it('says nothing happened rather than reporting a zero', () => {
    expect(describeShortfall([])).toBe('Already up to date — nothing to add.');
  });

  it('counts both kinds', () => {
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-03',
      to: '2026-08-05',
    });

    expect(describeShortfall(tasks)).toBe('Added 3 static posts and 1 reel.');
  });

  it('uses the singular for one', () => {
    const tasks = scheduleShortfall({
      plan,
      existing: [],
      from: '2026-08-03',
      to: '2026-08-03',
    });

    expect(describeShortfall(tasks)).toBe('Added 1 static post.');
  });
});

describe('monthsSpanning — the nightly job crosses month boundaries', () => {
  it('returns one month when the range sits inside it', () => {
    expect(monthsSpanning('2026-08-03', '2026-08-21')).toEqual(['2026-08-01']);
  });

  it('returns both when the range straddles a boundary', () => {
    /* The case the cron actually hits: late in the month plus a fortnight. */
    expect(monthsSpanning('2026-08-25', '2026-09-08')).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('crosses a year end', () => {
    expect(monthsSpanning('2026-12-28', '2027-01-11')).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('spans several months', () => {
    expect(monthsSpanning('2026-10-15', '2027-01-02')).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('is empty when the range is inverted', () => {
    expect(monthsSpanning('2026-09-10', '2026-08-01')).toEqual([]);
  });

  it('handles a single day', () => {
    expect(monthsSpanning('2026-08-22', '2026-08-22')).toEqual(['2026-08-01']);
  });

  it('does not skip a month when the start is the 31st', () => {
    /* `setMonth` on 31 January gives 3 March. Integer year/month arithmetic is
       what keeps February in this list. */
    expect(monthsSpanning('2027-01-31', '2027-03-01')).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ]);
  });
});

describe('the fortnight window the cron uses', () => {
  it('fills across a month boundary when both plans are applied', () => {
    const from = '2026-08-25';
    const to = '2026-09-08';

    const tasks = monthsSpanning(from, to).flatMap((monthStart) =>
      scheduleShortfall({ plan: monthPlan(CADENCE, monthStart), existing: [], from, to }),
    );

    const august = tasks.filter((t) => t.date.startsWith('2026-08'));
    const september = tasks.filter((t) => t.date.startsWith('2026-09'));

    expect(august.length).toBeGreaterThan(0);
    expect(september.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.date >= from && t.date <= to)).toBe(true);
  });

  it('is still idempotent across the boundary', () => {
    const from = '2026-08-25';
    const to = '2026-09-08';
    const plans = monthsSpanning(from, to).map((m) => monthPlan(CADENCE, m));

    const first = plans.flatMap((plan) =>
      scheduleShortfall({ plan, existing: [], from, to }),
    );
    const second = plans.flatMap((plan) =>
      scheduleShortfall({ plan, existing: applied(first), from, to }),
    );

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });
});
