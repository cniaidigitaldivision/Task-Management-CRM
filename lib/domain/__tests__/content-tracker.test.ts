import { describe, expect, it } from 'vitest';

import {
  contentCapRefusal,
  dayStanding,
  isoWeekBounds,
  owedLines,
  type ContentCounts,
} from '../content-tracker';
import type { Cadence, Weekday } from '../cadence';

/* ============================================================================
 * THE CONTENT TRACKER — owner rules, 2026-09-03
 * ----------------------------------------------------------------------------
 * *"one static post daily, then the tracker will just observe that a daily one
 * static post task should create… No other static post task will be created for
 * that project on a same day by any other member."*
 *
 * *"if someone… is trying to create a third reel task. It would not let them
 * create and give them a message or a error that the target of a week is
 * achieved."*
 *
 * Dates used below: 2026-09-03 is a THURSDAY, so its ISO week is Mon 31 Aug to
 * Sun 6 Sep. Chosen because it straddles a month boundary, which is where
 * week arithmetic usually breaks.
 * ========================================================================= */

const THURSDAY = '2026-09-03';
const SUNDAY = '2026-09-06';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

/** 1 static a day Mon–Fri, 2 reels a week on Tue and Thu. */
const CADENCE: Cadence = {
  staticPostsPerDay: 1,
  reelsPerWeek: 2,
  reelDays: [2, 4],
  postingDays: WEEKDAYS,
};

/** A project with no agreed rhythm — a website build, a one-off event. */
const NO_RHYTHM: Cadence = {
  staticPostsPerDay: null,
  reelsPerWeek: null,
  reelDays: [],
  postingDays: WEEKDAYS,
};

const counts = (over: Partial<ContentCounts> = {}): ContentCounts => ({
  staticOnDay: 0,
  reelsInWeek: 0,
  staticRaisedBy: [],
  reelsRaisedBy: [],
  ...over,
});

describe('isoWeekBounds', () => {
  /* Monday-first, like reel_days, the attendance board and the calendar. A
     Sunday-first week would file a Sunday reel in the wrong week and quietly
     allow a third. */
  it('runs Monday to Sunday, across a month boundary', () => {
    expect(isoWeekBounds(THURSDAY)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });

  it('keeps Sunday in the week that began the previous Monday', () => {
    expect(isoWeekBounds(SUNDAY)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });

  it('treats Monday as the start of its own week', () => {
    expect(isoWeekBounds('2026-08-31')).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });
});

describe('dayStanding', () => {
  it('owes a static post on a posting day with nothing raised', () => {
    const s = dayStanding(CADENCE, counts(), THURSDAY);
    expect(s.isOffDay).toBe(false);
    expect(s.staticTarget).toBe(1);
    expect(s.staticOwed).toBe(1);
    expect(s.settled).toBe(false);
  });

  it('settles the day once somebody has raised it', () => {
    const s = dayStanding(CADENCE, counts({ staticOnDay: 1, reelsInWeek: 2 }), THURSDAY);
    expect(s.staticOwed).toBe(0);
    expect(s.reelsOwedThisWeek).toBe(0);
    expect(s.settled).toBe(true);
  });

  it('owes nothing on an off day', () => {
    /* Sunday is not in postingDays. */
    const s = dayStanding(CADENCE, counts(), SUNDAY);
    expect(s.isOffDay).toBe(true);
    expect(s.staticOwed).toBe(0);
  });

  /* ⚠️ A null target must never read as a target of zero — the distinction
     projectProgress and contractTargets already depend on. An untargeted
     project is neither behind nor met. */
  it('reports no target at all for a project with no rhythm', () => {
    const s = dayStanding(NO_RHYTHM, counts(), THURSDAY);
    expect(s.staticTarget).toBeNull();
    expect(s.staticOwed).toBe(0);
    expect(s.reelWeekTarget).toBeNull();
  });

  it('tracks the week’s reels against the weekly promise', () => {
    const s = dayStanding(CADENCE, counts({ reelsInWeek: 1 }), THURSDAY);
    expect(s.reelWeekTarget).toBe(2);
    expect(s.reelsInWeek).toBe(1);
    expect(s.reelsOwedThisWeek).toBe(1);
  });

  it('never reports a negative debt when somebody overshot', () => {
    const s = dayStanding(CADENCE, counts({ staticOnDay: 3, reelsInWeek: 5 }), THURSDAY);
    expect(s.staticOwed).toBe(0);
    expect(s.reelsOwedThisWeek).toBe(0);
  });
});

describe('contentCapRefusal — the static post of the day', () => {
  it('allows the first', () => {
    expect(
      contentCapRefusal({
        cadence: CADENCE,
        contentKind: 'static',
        dueDate: THURSDAY,
        counts: counts(),
        projectName: 'Daniyal Marketing',
      }),
    ).toBeNull();
  });

  it('refuses the second, and names who raised the first', () => {
    const refusal = contentCapRefusal({
      cadence: CADENCE,
      contentKind: 'static',
      dueDate: THURSDAY,
      counts: counts({ staticOnDay: 1, staticRaisedBy: ['Abdul Moiz'] }),
      projectName: 'Daniyal Marketing',
    });
    expect(refusal).toContain('Daniyal Marketing');
    expect(refusal).toContain('Abdul Moiz');
  });

  it('respects a target above one', () => {
    const twoADay: Cadence = { ...CADENCE, staticPostsPerDay: 2 };
    expect(
      contentCapRefusal({
        cadence: twoADay,
        contentKind: 'static',
        dueDate: THURSDAY,
        counts: counts({ staticOnDay: 1 }),
        projectName: 'X',
      }),
    ).toBeNull();
    expect(
      contentCapRefusal({
        cadence: twoADay,
        contentKind: 'static',
        dueDate: THURSDAY,
        counts: counts({ staticOnDay: 2 }),
        projectName: 'X',
      }),
    ).not.toBeNull();
  });
});

describe('contentCapRefusal — the week’s reels', () => {
  it('allows the second reel of a two-a-week project', () => {
    expect(
      contentCapRefusal({
        cadence: CADENCE,
        contentKind: 'reel',
        dueDate: THURSDAY,
        counts: counts({ reelsInWeek: 1 }),
        projectName: 'ETEMAAD100',
      }),
    ).toBeNull();
  });

  /* The owner's own example, in their own words. */
  it('refuses the third and says the week’s target is achieved', () => {
    const refusal = contentCapRefusal({
      cadence: CADENCE,
      contentKind: 'reel',
      dueDate: THURSDAY,
      counts: counts({ reelsInWeek: 2, reelsRaisedBy: ['Unzela'] }),
      projectName: 'ETEMAAD100',
    });
    expect(refusal).toContain('target of the week is achieved');
    expect(refusal).toContain('ETEMAAD100');
    /* And points at the Monday the next reel belongs to, so the refusal tells
       them what to do rather than only what they cannot do. */
    expect(refusal).toContain('2026-09-07');
  });
});

describe('contentCapRefusal — what it deliberately does not cap', () => {
  it('never refuses a project with no agreed rhythm', () => {
    expect(
      contentCapRefusal({
        cadence: NO_RHYTHM,
        contentKind: 'static',
        dueDate: THURSDAY,
        counts: counts({ staticOnDay: 9 }),
        projectName: 'Website rebuild',
      }),
    ).toBeNull();
  });

  /* Only static and reel carry agreed numbers. A carousel, a story or an
     untyped task is work somebody decided to do, with no quantity to exceed. */
  it.each(['carousel', 'story', 'video', null] as const)(
    'never refuses content of kind %s',
    (kind) => {
      expect(
        contentCapRefusal({
          cadence: CADENCE,
          contentKind: kind,
          dueDate: THURSDAY,
          counts: counts({ staticOnDay: 5, reelsInWeek: 5 }),
          projectName: 'X',
        }),
      ).toBeNull();
    },
  );

  it('never refuses a task with no due date — it is on no day’s quota', () => {
    expect(
      contentCapRefusal({
        cadence: CADENCE,
        contentKind: 'static',
        dueDate: null,
        counts: counts({ staticOnDay: 4 }),
        projectName: 'X',
      }),
    ).toBeNull();
  });
});

describe('owedLines — what the person is shown', () => {
  it('offers the day’s static post and the week’s reels', () => {
    const lines = owedLines(CADENCE, counts(), THURSDAY);
    expect(lines.map((l) => l.kind)).toEqual(['static', 'reel']);
    expect(lines[1].note).toBe('0 of 2 done this week');
  });

  it('drops the static line once the day is covered', () => {
    const lines = owedLines(CADENCE, counts({ staticOnDay: 1 }), THURSDAY);
    expect(lines.map((l) => l.kind)).toEqual(['reel']);
  });

  it('says nothing is owed when the rhythm is met', () => {
    expect(owedLines(CADENCE, counts({ staticOnDay: 1, reelsInWeek: 2 }), THURSDAY)).toEqual([]);
  });

  it('owes nothing on an off day', () => {
    /* Sunday: not a posting day, and the week's reels are already done. */
    expect(owedLines(CADENCE, counts({ reelsInWeek: 2 }), SUNDAY)).toEqual([]);
  });

  it('owes nothing at all for a project with no agreed rhythm', () => {
    expect(owedLines(NO_RHYTHM, counts(), THURSDAY)).toEqual([]);
  });

  /* ⚠️ Weekly, not only on reel days. A week where both pencilled days were
     missed must still be catchable — the target is the week's, so the offer is
     too. Friday is not a reel day for this cadence. */
  it('still offers an outstanding reel on a day that is not a reel day', () => {
    const friday = '2026-09-04';
    const lines = owedLines(CADENCE, counts({ staticOnDay: 1, reelsInWeek: 1 }), friday);
    expect(lines.map((l) => l.kind)).toEqual(['reel']);
    expect(lines[0].count).toBe(1);
  });

  it('reports a plural debt when more than one is outstanding', () => {
    const twoADay: Cadence = { ...CADENCE, staticPostsPerDay: 2 };
    const lines = owedLines(twoADay, counts({ reelsInWeek: 2 }), THURSDAY);
    expect(lines[0]).toEqual({ kind: 'static', count: 2, note: null });
  });
});
