import { describe, expect, it } from 'vitest';

import { buildProjectReport, type ReportCadence, type ReportTaskInput } from '../project-report';
import { reportPeriod } from '../report-periods';

/* ============================================================================
 * THE ACTIVITY HALF OF A PROJECT REPORT — owner request, 2026-09-03
 * ----------------------------------------------------------------------------
 * *"you will tell me how many tasks were created today, who created them, what
 * task name, what their description is, what their category is, whether they are
 * done or pending"*, and *"what task has been done in this whole week, Monday,
 * Tuesday, Wednesday, and who does which task."*
 *
 * Plus the reading: *"the target is this one: achieve this one, left this one,
 * you are lagging… Any suggestion should be mentioned below."*
 *
 * Delivery (assets against the package) is covered in project-report.test.ts.
 * This file is only the activity axis and the verdict.
 * ========================================================================= */

/* 2026-08-20 is a Thursday, so a week period runs Mon 17 to Sun 23 August. */
const THURSDAY = '2026-08-20';

/** 1 static a day Mon–Sat, 2 reels a week, Sundays off. */
const CADENCE: ReportCadence = {
  staticPostsPerDay: 1,
  reelsPerWeek: 2,
  reelDays: [1, 3],
  postingDays: [1, 2, 3, 4, 5, 6],
};

const NO_RHYTHM: ReportCadence = {
  staticPostsPerDay: null,
  reelsPerWeek: null,
  reelDays: [],
  postingDays: [1, 2, 3, 4, 5],
};

const task = (over: Partial<ReportTaskInput> = {}): ReportTaskInput => ({
  id: 'x1',
  reference: 'CLI-1',
  title: 'A task',
  description: null,
  contentKind: null,
  status: 'todo',
  createdByName: 'Kashif',
  assigneeName: 'Abdul Moiz',
  createdOn: THURSDAY,
  dueDate: null,
  completedOn: null,
  ...over,
});

const build = (
  kind: 'today' | 'week' | 'month',
  tasks: readonly ReportTaskInput[],
  cadence: ReportCadence = CADENCE,
  assets: Parameters<typeof buildProjectReport>[1] = [],
) =>
  buildProjectReport(reportPeriod(kind as never, THURSDAY), assets, [], cadence, tasks);

describe('counting what was raised', () => {
  it('splits raised into done, open and cancelled', () => {
    const report = build('week', [
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'todo' }),
      task({ id: '3', status: 'in_progress' }),
      task({ id: '4', status: 'cancelled' }),
    ]);

    expect(report.tasksCreated).toBe(4);
    expect(report.tasksDone).toBe(1);
    expect(report.tasksCancelled).toBe(1);
    /* ⚠️ Open is everything neither done nor cancelled — NOT "created minus
       done". Counting it the other way files cancelled work as outstanding and
       makes a tidy week look like a backlog. */
    expect(report.tasksOpen).toBe(2);
  });

  it('reports an empty period without inventing a row', () => {
    const report = build('today', []);
    expect(report.tasksCreated).toBe(0);
    expect(report.taskDays.every((day) => day.tasks.length === 0)).toBe(true);
  });
});

describe('the day-by-day breakdown', () => {
  /* The owner's own example: which task on Monday, which on Tuesday, and who. */
  it('files each task under the day it was raised', () => {
    const report = build('week', [
      task({ id: 'mon', createdOn: '2026-08-17', title: 'Monday post' }),
      task({ id: 'tue', createdOn: '2026-08-18', title: 'Tuesday reel' }),
      task({ id: 'tue2', createdOn: '2026-08-18', title: 'Tuesday second' }),
    ]);

    const withWork = report.taskDays.filter((day) => day.tasks.length > 0);
    expect(withWork).toHaveLength(2);
    expect(withWork[0].tasks.map((t) => t.title)).toEqual(['Monday post']);
    expect(withWork[1].tasks.map((t) => t.title)).toEqual(['Tuesday reel', 'Tuesday second']);
  });

  it('counts done and open within each day', () => {
    const report = build('week', [
      task({ id: 'a', createdOn: '2026-08-18', status: 'done' }),
      task({ id: 'b', createdOn: '2026-08-18', status: 'todo' }),
      task({ id: 'c', createdOn: '2026-08-18', status: 'cancelled' }),
    ]);

    const day = report.taskDays.find((d) => d.tasks.length > 0);
    expect(day?.done).toBe(1);
    expect(day?.open).toBe(1);
  });

  /* A task raised outside the period must not appear, or a week report would
     quietly include work from the week before. */
  it('excludes a task raised outside the period', () => {
    const report = build('week', [task({ id: 'old', createdOn: '2026-08-10' })]);
    expect(report.taskDays.every((day) => day.tasks.length === 0)).toBe(true);
  });

  /* One bucket, so it reads as a plain list rather than a special case. */
  it('gives a day report a single bucket', () => {
    const report = build('today', [task()]);
    expect(report.taskDays).toHaveLength(1);
    expect(report.taskDays[0].tasks).toHaveLength(1);
  });
});

describe('the monthly promise', () => {
  /* 1/day over 6 posting days x 4 weeks = 24, plus 2 reels x 4 = 8. */
  it('states the whole month even on a daily report', () => {
    expect(build('today', []).monthlyPromise).toBe(32);
  });

  /* ⚠️ Null, never 0. A zero promise is a promise to publish nothing, which no
     client signs — the same distinction contractTargets depends on. */
  it('is null when no rhythm was agreed', () => {
    expect(build('today', [], NO_RHYTHM).monthlyPromise).toBeNull();
  });
});

describe('the verdict', () => {
  const asset = (id: string) => ({
    id,
    title: 'post',
    publishedOn: THURSDAY,
    contentKind: 'static',
    assigneeName: 'Someone',
  });

  it('says untargeted rather than failing an untargeted project', () => {
    const report = build('today', [], NO_RHYTHM);
    expect(report.verdict.tone).toBe('untargeted');
    expect(report.verdict.suggestions.length).toBeGreaterThan(0);
  });

  it('calls a met target met', () => {
    /* A single Thursday: 1 static a day, so the target is 1. */
    const report = build('today', [], CADENCE, [asset('a')]);
    expect(report.target).toBe(1);
    expect(report.verdict.tone).toBe('ahead');
    expect(report.verdict.headline).toContain('met');
  });

  it('calls an empty targeted day behind, and says how many are owed', () => {
    const report = build('today', [], CADENCE, []);
    expect(report.verdict.tone).toBe('behind');
    expect(report.verdict.headline).toContain('1');
  });

  /* ⚠️ Every suggestion names a figure from this report. A line like "improve
     consistency" survives review and helps nobody. */
  it('raises open work as something to act on, with the count in it', () => {
    const report = build('week', [task({ id: '1' }), task({ id: '2' })]);
    const line = report.verdict.suggestions.find((s) => s.includes('still open'));
    expect(line).toBeDefined();
    expect(line).toContain('2');
  });

  it('mentions cancelled work only when there is some', () => {
    const clean = build('week', [task({ status: 'done' })]);
    expect(clean.verdict.suggestions.some((s) => s.includes('cancelled'))).toBe(false);

    const messy = build('week', [task({ status: 'cancelled' })]);
    expect(messy.verdict.suggestions.some((s) => s.includes('cancelled'))).toBe(true);
  });
});
