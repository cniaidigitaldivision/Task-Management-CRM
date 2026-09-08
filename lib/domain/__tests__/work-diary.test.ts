import { describe, expect, it } from 'vitest';

import { buildWorkDiary, dayFor, daysInRange, diaryToReport } from '../work-diary';
import type { ReportPeriod, ReportTask } from '../reports';

/* ============================================================================
 * THE WORK DIARY
 * ----------------------------------------------------------------------------
 * The owner will read this report to judge what somebody did on a given day, so
 * the two failures that matter are a task filed under the wrong day and a task
 * that does not appear at all. Both are asserted directly.
 * ========================================================================= */

const PERIOD: ReportPeriod = { start: '2026-09-01', end: '2026-09-05' };

function task(over: Partial<ReportTask> = {}): ReportTask {
  return {
    reference: 'CLI-1',
    title: 'Eid sale post',
    projectId: 'p1',
    projectName: 'Chitral Royal Homes',
    projectType: 'client',
    projectCode: 'CLI',
    assigneeId: 'u1',
    assigneeName: 'Abdul Moiz',
    status: 'done',
    effortPoints: 3,
    dueDate: '2026-09-02',
    completedAt: null,
    timeLimitMinutes: null,
    timeSpentMinutes: 0,
    extensionMinutesGranted: 0,
    contentKind: 'static',
    platforms: [],
    publishedOn: null,
    assigneeAvatarUrl: null,
    updatedAt: '2026-09-02T10:00:00.000Z',
    description: 'Square graphic, Urdu copy, tag the client',
    links: [],
    ...over,
  } as ReportTask;
}

describe('which day a task is filed under', () => {
  it('⚠️ prefers the day it was PUBLISHED over the day it was finished', () => {
    /* Migration 055 exists because every report once read `completedAt` here. A
       reel finished Monday and posted Friday belongs to Friday. */
    const t = task({ publishedOn: '2026-09-04', completedAt: '2026-09-01T09:00:00.000Z' });
    expect(dayFor(t)).toEqual({ date: '2026-09-04', basis: 'published' });
  });

  it('falls back to the day it was completed', () => {
    const t = task({ publishedOn: null, completedAt: '2026-09-03T18:30:00.000Z' });
    expect(dayFor(t)).toEqual({ date: '2026-09-03', basis: 'completed' });
  });

  it('and then to the day it was due, for work still open', () => {
    const t = task({ publishedOn: null, completedAt: null, dueDate: '2026-09-05' });
    expect(dayFor(t)).toEqual({ date: '2026-09-05', basis: 'due' });
  });

  it('returns nothing for a task carrying no date at all', () => {
    expect(dayFor(task({ publishedOn: null, completedAt: null, dueDate: null }))).toBeNull();
  });
});

describe('the range of days', () => {
  it('runs from the first to the last, inclusive and ascending', () => {
    expect(daysInRange('2026-09-01', '2026-09-05')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('crosses a month boundary without losing a day', () => {
    expect(daysInRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('is one day for a single-day period, and empty when the range is backwards', () => {
    expect(daysInRange('2026-09-01', '2026-09-01')).toEqual(['2026-09-01']);
    expect(daysInRange('2026-09-05', '2026-09-01')).toEqual([]);
  });

  it('⚠️ is capped, so a mistyped year cannot hang the page', () => {
    expect(daysInRange('2026-09-01', '2999-09-01')).toHaveLength(400);
  });
});

describe('grouped by member', () => {
  const diary = buildWorkDiary({
    grouping: 'member',
    period: PERIOD,
    tasks: [
      task({ reference: 'CLI-1', assigneeName: 'Abdul Moiz', publishedOn: '2026-09-01' }),
      task({ reference: 'CLI-2', assigneeName: 'Abdul Moiz', publishedOn: '2026-09-03' }),
      task({
        reference: 'CLI-3',
        assigneeId: 'u2',
        assigneeName: 'Yusra',
        publishedOn: '2026-09-03',
      }),
    ],
  });

  it('makes one group per person, alphabetically', () => {
    expect(diary.groups.map((g) => g.title)).toEqual(['Abdul Moiz', 'Yusra']);
  });

  it('⚠️ lists EVERY day of the period, including the empty ones', () => {
    /* Owner: *"I want to see that on every day and the day increases properly in
       proper ascending order."* A diary that skips 2 September reads as though
       nothing was asked of that day. */
    const moiz = diary.groups[0];
    expect(moiz.days.map((d) => d.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(moiz.days[1].entries).toEqual([]);
  });

  it('puts each task on its own day', () => {
    const moiz = diary.groups[0];
    expect(moiz.days[0].entries.map((e) => e.reference)).toEqual(['CLI-1']);
    expect(moiz.days[2].entries.map((e) => e.reference)).toEqual(['CLI-2']);
  });

  it("names the PROJECT beside each task, because the table is already the person's", () => {
    expect(diary.groups[0].days[0].entries[0].counterpart).toBe('Chitral Royal Homes');
  });

  it('carries the description, which is the column the report exists for', () => {
    expect(diary.groups[0].days[0].entries[0].description).toBe(
      'Square graphic, Urdu copy, tag the client',
    );
  });

  it('counts what each person was given and finished, and how many days they worked', () => {
    const moiz = diary.groups[0];
    expect(moiz.tasksAssigned).toBe(2);
    expect(moiz.tasksDone).toBe(2);
    expect(moiz.activeDays).toBe(2);
  });
});

describe('grouped by project', () => {
  const diary = buildWorkDiary({
    grouping: 'project',
    period: PERIOD,
    tasks: [
      task({ reference: 'CLI-1', assigneeName: 'Abdul Moiz', publishedOn: '2026-09-02' }),
      task({ reference: 'CLI-2', assigneeName: 'Yusra', publishedOn: '2026-09-02' }),
      task({
        reference: 'AGC-1',
        projectId: 'p2',
        projectName: 'Attari Group',
        publishedOn: '2026-09-02',
      }),
    ],
  });

  it('makes one group per project', () => {
    expect(diary.groups.map((g) => g.title)).toEqual(['Attari Group', 'Chitral Royal Homes']);
  });

  it("puts everybody's tasks for that project on the same day — owner, 2026-09-08", () => {
    /* *"2 September: all persons' tasks."* */
    const chitral = diary.groups[1];
    const secondOfSeptember = chitral.days.find((d) => d.date === '2026-09-02');
    expect(secondOfSeptember?.entries.map((e) => e.counterpart)).toEqual(['Abdul Moiz', 'Yusra']);
  });

  it('names the PERSON beside each task, the mirror of the member grouping', () => {
    expect(diary.groups[0].days[1].entries[0].counterpart).toBe('Abdul Moiz');
  });
});

describe('nothing disappears', () => {
  it('⚠️ a task with no date is kept aside rather than dropped', () => {
    const diary = buildWorkDiary({
      grouping: 'member',
      period: PERIOD,
      tasks: [task({ publishedOn: null, completedAt: null, dueDate: null })],
    });
    expect(diary.groups[0].undated.map((e) => e.reference)).toEqual(['CLI-1']);
    expect(diary.groups[0].days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('⚠️ so is one whose date falls outside the range it was selected by', () => {
    /* `taskInPeriod` decides membership on due-or-completed; a task published
       later than the range still belongs to the report and has no row to sit
       on. It must not vanish between the two rules. */
    const diary = buildWorkDiary({
      grouping: 'member',
      period: PERIOD,
      tasks: [task({ publishedOn: '2026-09-30' })],
    });
    expect(diary.groups[0].undated).toHaveLength(1);
  });

  it('work nobody owns gets its own heading rather than being lost', () => {
    const diary = buildWorkDiary({
      grouping: 'member',
      period: PERIOD,
      tasks: [task({ assigneeId: null, assigneeName: null, publishedOn: '2026-09-01' })],
    });
    expect(diary.groups.map((g) => g.title)).toEqual(['Unassigned']);
  });
});

describe('the exported sheet', () => {
  const diary = buildWorkDiary({
    grouping: 'member',
    period: PERIOD,
    tasks: [task({ publishedOn: '2026-09-01' })],
  });
  const report = diaryToReport(diary, PERIOD);

  it('carries a Description column, which the owner called the important part', () => {
    expect(report.columns.map((c) => c.label)).toEqual([
      'Member',
      'Date',
      'Project',
      'Task',
      'Description',
      'Status',
    ]);
  });

  it('⚠️ writes the empty days out too, so the file reads like the screen', () => {
    /* Five days, one of which has the task: five rows. A spreadsheet that
       skipped the gaps could not be read as a diary. */
    expect(report.rows).toHaveLength(5);
    expect(report.rows[0][4]).toEqual({
      kind: 'text',
      value: 'Square graphic, Urdu copy, tag the client',
    });
    expect(report.rows[1][3]).toEqual({ kind: 'text', value: '—' });
  });

  it('says how it counts, because a number without its definition gets argued about', () => {
    expect(report.notes.join(' ')).toContain('including days with nothing recorded');
  });
});
