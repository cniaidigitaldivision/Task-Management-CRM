import { describe, expect, it } from 'vitest';

import {
  buildReport,
  cellText,
  daysLate,
  formatMinutes,
  presetPeriod,
  reportFileStem,
  taskInPeriod,
  weeksInPeriod,
  type Cell,
  type ReportPerson,
  type ReportProject,
  type ReportTask,
} from '../reports';

/* ============================================================================
 * REPORTS
 * ----------------------------------------------------------------------------
 * The figures are the product here, so the tests are arithmetic against
 * hand-worked numbers rather than "it returned an object".
 *
 * The cases that matter most are the ones where a plausible implementation is
 * wrong: an undated completion counted as on time, a cancelled task counted as a
 * failure, an early delivery clamped to zero days late, a task with no limit
 * reported as within budget. Each of those reads perfectly on screen and is a
 * lie, so each has a test.
 * ========================================================================= */

const AUG: { start: string; end: string } = { start: '2026-08-01', end: '2026-08-31' };

function task(over: Partial<ReportTask> = {}): ReportTask {
  return {
    reference: 'CNI-001',
    title: 'A task',
    projectId: 'p1',
    projectName: 'Project One',
    projectType: 'client',
    projectCode: 'P1',
    assigneeId: 'u1',
    assigneeName: 'Ayesha Siddiqui',
    status: 'done',
    effortPoints: 3,
    dueDate: '2026-08-10',
    completedAt: '2026-08-09T12:00:00Z',
    timeLimitMinutes: 120,
    timeSpentMinutes: 90,
    extensionMinutesGranted: 0,
    ...over,
  };
}

function person(over: Partial<ReportPerson> = {}): ReportPerson {
  return {
    userId: 'u1',
    name: 'Ayesha Siddiqui',
    roleTitle: 'Designer',
    role: 'member',
    loadPoints: 18,
    capacityPoints: 36,
    utilisationPct: 50,
    bandLabel: 'Healthy',
    activeTaskCount: 2,
    maxConcurrentTasks: 5,
    otherWorkPct: 10,
    ...over,
  };
}

const project: ReportProject = {
  id: 'p1',
  name: 'Project One',
  code: 'P1',
  type: 'client',
  status: 'active',
};

/** Reads one row's cell by column key, so a reordered column cannot silently
 *  make a test assert on the wrong number. */
function cellOf(
  report: ReturnType<typeof buildReport>,
  rowIndex: number,
  key: string,
): Cell {
  const col = report.columns.findIndex((c) => c.key === key);
  expect(col, `no column "${key}"`).toBeGreaterThanOrEqual(0);
  return report.rows[rowIndex][col];
}

function figure(report: ReturnType<typeof buildReport>, label: string): Cell {
  const found = report.figures.find((f) => f.label === label);
  expect(found, `no figure "${label}"`).toBeDefined();
  return found!.value;
}

/* 'today' is 12 August 2026 throughout, so 'overdue' has a fixed meaning across
   every test in this file rather than following the machine's clock. */
const TODAY = '2026-08-12';

const base = {
  people: [person()],
  projects: [project],
  subjectId: null,
  subjectName: null,
  today: TODAY,
};

/* ==========================================================================
 * The period rule
 * ========================================================================== */

describe('taskInPeriod', () => {
  it('includes a closed task by when it was COMPLETED, not when it was due', () => {
    /* Due in July, finished in August: it is August's delivery. Judging a closed
       task by its due date would move work into the period it was promised for
       rather than the period it happened in. */
    const t = task({ dueDate: '2026-07-15', completedAt: '2026-08-03T09:00:00Z' });
    expect(taskInPeriod(t, AUG)).toBe(true);
  });

  it('excludes a task completed before the period even if it is still due in it', () => {
    const t = task({ dueDate: '2026-08-20', completedAt: '2026-07-30T09:00:00Z' });
    expect(taskInPeriod(t, AUG)).toBe(false);
  });

  it('includes an OPEN task by its due date', () => {
    const t = task({ status: 'in_progress', completedAt: null, dueDate: '2026-08-20' });
    expect(taskInPeriod(t, AUG)).toBe(true);
  });

  it('excludes an open task with no due date from every period', () => {
    /* It was never promised for a window, so counting it in one would make every
       denominator depend on how diligently people set dates. */
    const t = task({ status: 'in_progress', completedAt: null, dueDate: null });
    expect(taskInPeriod(t, AUG)).toBe(false);
    expect(taskInPeriod(t, { start: '2020-01-01', end: '2030-12-31' })).toBe(false);
  });

  it('treats both period bounds as inclusive', () => {
    expect(taskInPeriod(task({ completedAt: '2026-08-01T00:00:00Z' }), AUG)).toBe(true);
    expect(taskInPeriod(task({ completedAt: '2026-08-31T23:59:00Z' }), AUG)).toBe(true);
    expect(taskInPeriod(task({ completedAt: '2026-07-31T23:59:00Z' }), AUG)).toBe(false);
    expect(taskInPeriod(task({ completedAt: '2026-09-01T00:01:00Z' }), AUG)).toBe(false);
  });
});

describe('daysLate', () => {
  it('is 0 when finished exactly on the due date', () => {
    expect(daysLate(task({ dueDate: '2026-08-10', completedAt: '2026-08-10T23:00:00Z' }))).toBe(0);
  });

  it('is positive when late and NEGATIVE when early', () => {
    expect(daysLate(task({ dueDate: '2026-08-10', completedAt: '2026-08-13T09:00:00Z' }))).toBe(3);
    /* Not clamped: an average that floors early at zero reports a team that is
       habitually early as merely punctual. */
    expect(daysLate(task({ dueDate: '2026-08-10', completedAt: '2026-08-07T09:00:00Z' }))).toBe(-3);
  });

  it('is null when either date is missing, rather than guessing', () => {
    expect(daysLate(task({ dueDate: null }))).toBeNull();
    expect(daysLate(task({ completedAt: null }))).toBeNull();
  });
});

describe('weeksInPeriod', () => {
  it('counts a Monday-to-Sunday week as exactly one', () => {
    expect(weeksInPeriod({ start: '2026-08-03', end: '2026-08-09' })).toBe(1);
  });

  it('counts a fortnight as two', () => {
    expect(weeksInPeriod({ start: '2026-08-03', end: '2026-08-16' })).toBe(2);
  });

  it('reports a part week as a fraction rather than rounding to a whole', () => {
    /* 10 days. Rounding up to 2 would hand out a week of capacity nobody has. */
    expect(weeksInPeriod({ start: '2026-08-03', end: '2026-08-12' })).toBeCloseTo(1.43, 2);
  });
});

/* ==========================================================================
 * 1 · Completion
 * ========================================================================== */

describe('completion report', () => {
  it('does not count an undated completion as on time', () => {
    /* THE test in this file. Two tasks done: one late, one with no due date. A
       naive implementation reports 50% on time. The honest answer is 0% — the
       undated one cannot be judged, so it leaves the denominator entirely. */
    const report = buildReport({
      ...base,
      type: 'completion',
      period: AUG,
      tasks: [
        task({ reference: 'A', dueDate: '2026-08-05', completedAt: '2026-08-09T09:00:00Z' }),
        task({ reference: 'B', dueDate: null, completedAt: '2026-08-09T09:00:00Z' }),
      ],
    });

    expect(cellOf(report, 0, 'done')).toEqual({ kind: 'number', value: 2 });
    expect(cellOf(report, 0, 'onTime')).toEqual({ kind: 'number', value: 0 });
    expect(cellOf(report, 0, 'late')).toEqual({ kind: 'number', value: 1 });
    expect(cellOf(report, 0, 'onTimePct')).toEqual({ kind: 'percent', value: 0 });
    expect(figure(report, 'On-time rate')).toEqual({ kind: 'percent', value: 0 });
  });

  it('keeps cancelled work out of both success and failure', () => {
    const report = buildReport({
      ...base,
      type: 'completion',
      period: AUG,
      tasks: [
        task({ reference: 'A', completedAt: '2026-08-09T09:00:00Z' }),
        task({ reference: 'B', status: 'cancelled', completedAt: '2026-08-10T09:00:00Z' }),
      ],
    });

    expect(cellOf(report, 0, 'done')).toEqual({ kind: 'number', value: 1 });
    expect(cellOf(report, 0, 'cancelled')).toEqual({ kind: 'number', value: 1 });
    expect(cellOf(report, 0, 'late')).toEqual({ kind: 'number', value: 0 });
    expect(cellOf(report, 0, 'onTimePct')).toEqual({ kind: 'percent', value: 100 });
  });

  it('averages days late over LATE tasks only, not over everything finished', () => {
    /* Three done: 4 days late, on time, 2 days early. The average lateness is 4
       — the mean over all three (0.67) would describe nobody. */
    const report = buildReport({
      ...base,
      type: 'completion',
      period: AUG,
      tasks: [
        task({ reference: 'A', dueDate: '2026-08-05', completedAt: '2026-08-09T09:00:00Z' }),
        task({ reference: 'B', dueDate: '2026-08-10', completedAt: '2026-08-10T09:00:00Z' }),
        task({ reference: 'C', dueDate: '2026-08-20', completedAt: '2026-08-18T09:00:00Z' }),
      ],
    });

    expect(cellOf(report, 0, 'avgDaysLate')).toEqual({ kind: 'number', value: 4 });
    expect(cellOf(report, 0, 'onTimePct')).toEqual({ kind: 'percent', value: 67 });
  });

  it('gives unassigned work its own row instead of dropping it', () => {
    const report = buildReport({
      ...base,
      type: 'completion',
      period: AUG,
      tasks: [
        task({ reference: 'A' }),
        task({ reference: 'B', assigneeId: null, assigneeName: null, status: 'todo', completedAt: null, dueDate: '2026-08-15' }),
      ],
    });

    const names = report.rows.map((r) => cellText(r[0]));
    expect(names).toContain('Unassigned');
    expect(report.rows).toHaveLength(2);
  });

  it('narrows to one person when a subject is given', () => {
    const report = buildReport({
      ...base,
      type: 'completion',
      period: AUG,
      subjectId: 'u2',
      subjectName: 'Danish Raza',
      tasks: [
        task({ reference: 'A', assigneeId: 'u1', assigneeName: 'Ayesha' }),
        task({ reference: 'B', assigneeId: 'u2', assigneeName: 'Danish Raza' }),
      ],
    });

    expect(report.rows).toHaveLength(1);
    expect(cellText(report.rows[0][0])).toBe('Danish Raza');
    expect(report.subtitle).toContain('Danish Raza');
  });

  it('reports zeroes rather than throwing when nothing is in the period', () => {
    const report = buildReport({ ...base, type: 'completion', period: AUG, tasks: [] });
    expect(report.rows).toHaveLength(0);
    expect(figure(report, 'On-time rate')).toEqual({ kind: 'percent', value: 0 });
    expect(figure(report, 'Average days late')).toEqual({ kind: 'number', value: 0 });
  });
});

/* ==========================================================================
 * 2 · Workload
 * ========================================================================== */

describe('workload report', () => {
  it('orders the most loaded person first and names who is over', () => {
    const report = buildReport({
      ...base,
      type: 'workload',
      period: { start: '2026-08-03', end: '2026-08-09' },
      tasks: [],
      people: [
        person({ userId: 'u1', name: 'Ayesha', utilisationPct: 40, loadPoints: 14, capacityPoints: 36 }),
        person({ userId: 'u2', name: 'Danish', utilisationPct: 120, loadPoints: 43, capacityPoints: 36 }),
      ],
    });

    expect(cellText(report.rows[0][0])).toBe('Danish');
    expect(figure(report, 'Over capacity')).toEqual({ kind: 'number', value: 1 });
    expect(report.figures.find((f) => f.label === 'Over capacity')?.hint).toBe('Danish');
  });

  it('computes team utilisation from the totals, not by averaging percentages', () => {
    /* Averaging the two percentages gives 80%. The truth is 57/72 = 79% — close
       here, and badly wrong as soon as capacities differ. */
    const report = buildReport({
      ...base,
      type: 'workload',
      period: { start: '2026-08-03', end: '2026-08-09' },
      tasks: [],
      people: [
        person({ userId: 'u1', loadPoints: 18, capacityPoints: 36, utilisationPct: 50 }),
        person({ userId: 'u2', loadPoints: 39, capacityPoints: 36, utilisationPct: 110 }),
      ],
    });

    expect(figure(report, 'Team utilisation')).toEqual({ kind: 'percent', value: 79 });
  });

  it('says how many weeks the period is, because capacity is weekly', () => {
    const report = buildReport({
      ...base,
      type: 'workload',
      period: { start: '2026-08-03', end: '2026-08-16' },
      tasks: [],
    });
    expect(figure(report, 'Weeks in period')).toEqual({ kind: 'number', value: 2 });
  });
});

/* ==========================================================================
 * 3 · Project status
 * ========================================================================== */

describe('project status report', () => {
  it('lists a project with no activity rather than hiding it', () => {
    const quiet: ReportProject = { ...project, id: 'p2', name: 'Quiet Project', code: 'P2' };
    const report = buildReport({
      ...base,
      type: 'project_status',
      period: AUG,
      projects: [project, quiet],
      tasks: [task()],
    });

    expect(report.rows).toHaveLength(2);
    const quietRow = report.rows.find((r) => cellText(r[0]) === 'Quiet Project');
    expect(quietRow).toBeDefined();
    expect(quietRow![report.columns.findIndex((c) => c.key === 'tasks')]).toEqual({
      kind: 'number',
      value: 0,
    });
  });

  it('measures overdue against TODAY, not against the end of the period', () => {
    /* This test found a real error in the first implementation, which compared
       the due date with the period's end. Asking for August's report on the 12th
       then reported everything due later in August as already late — a page of
       red for work that is not late at all.
       A is five days past. B is due in eighteen days. Only A is overdue. */
    const report = buildReport({
      ...base,
      type: 'project_status',
      period: AUG,
      tasks: [
        task({ reference: 'A', status: 'in_progress', completedAt: null, dueDate: '2026-08-05' }),
        task({ reference: 'B', status: 'in_progress', completedAt: null, dueDate: '2026-08-30' }),
      ],
    });

    expect(cellOf(report, 0, 'open')).toEqual({ kind: 'number', value: 2 });
    expect(cellOf(report, 0, 'overdue')).toEqual({ kind: 'number', value: 1 });
    expect(figure(report, 'Overdue')).toEqual({ kind: 'number', value: 1 });
  });

  it('reports last month’s unfinished work as overdue, because it is', () => {
    /* The same rule read the other way: for a period that has already ended,
       anything still open and dated genuinely is late. */
    const report = buildReport({
      ...base,
      type: 'project_status',
      period: { start: '2026-07-01', end: '2026-07-31' },
      tasks: [
        task({ reference: 'A', status: 'in_progress', completedAt: null, dueDate: '2026-07-20' }),
      ],
    });

    expect(cellOf(report, 0, 'overdue')).toEqual({ kind: 'number', value: 1 });
  });

  it('never calls an undated open task overdue', () => {
    /* It was never promised for a day, so there is no day it is late against.
       (It is also outside the period rule, so this is belt and braces.) */
    const report = buildReport({
      ...base,
      type: 'project_status',
      period: AUG,
      tasks: [
        task({ reference: 'A', status: 'in_progress', completedAt: null, dueDate: null }),
      ],
    });

    expect(cellOf(report, 0, 'overdue')).toEqual({ kind: 'number', value: 0 });
  });

  it('sums time spent as a duration, in minutes', () => {
    const report = buildReport({
      ...base,
      type: 'project_status',
      period: AUG,
      tasks: [task({ reference: 'A', timeSpentMinutes: 90 }), task({ reference: 'B', timeSpentMinutes: 45 })],
    });
    expect(cellOf(report, 0, 'spent')).toEqual({ kind: 'duration', value: 135 });
  });
});

/* ==========================================================================
 * 4 · Time & overrun
 * ========================================================================== */

describe('time and overrun report', () => {
  it('does not treat a task with NO limit as within budget', () => {
    /* It cannot overrun, so it must not appear in "over the limit" — and the
       denominator must count only tasks that had a limit at all. */
    const report = buildReport({
      ...base,
      type: 'time',
      period: AUG,
      tasks: [
        task({ reference: 'A', timeLimitMinutes: null, timeSpentMinutes: 600 }),
        task({ reference: 'B', timeLimitMinutes: 60, timeSpentMinutes: 90 }),
      ],
    });

    expect(figure(report, 'Over the limit')).toEqual({ kind: 'number', value: 1 });
    expect(report.figures.find((f) => f.label === 'Over the limit')?.hint).toBe(
      'of 1 tasks that had one',
    );
  });

  it('never reports a negative overrun for a task finished under its limit', () => {
    const report = buildReport({
      ...base,
      type: 'time',
      period: AUG,
      tasks: [task({ timeLimitMinutes: 120, timeSpentMinutes: 45 })],
    });

    expect(cellOf(report, 0, 'overrun')).toEqual({ kind: 'duration', value: 0 });
    expect(cellOf(report, 0, 'usedPct')).toEqual({ kind: 'percent', value: 38 });
  });

  it('orders the worst overrun first', () => {
    const report = buildReport({
      ...base,
      type: 'time',
      period: AUG,
      tasks: [
        task({ reference: 'SMALL', timeLimitMinutes: 60, timeSpentMinutes: 70 }),
        task({ reference: 'BIG', timeLimitMinutes: 60, timeSpentMinutes: 200 }),
      ],
    });
    expect(cellText(report.rows[0][0])).toBe('BIG');
  });

  it('leaves out tasks with neither time logged nor a limit', () => {
    const report = buildReport({
      ...base,
      type: 'time',
      period: AUG,
      tasks: [task({ timeLimitMinutes: null, timeSpentMinutes: 0 })],
    });
    expect(report.rows).toHaveLength(0);
  });
});

/* ==========================================================================
 * Periods, names and formatting
 * ========================================================================== */

describe('presetPeriod', () => {
  /* Wednesday 12 August 2026. */
  const now = Date.parse('2026-08-12T10:00:00Z');

  it('runs this week Monday to Sunday, matching the Workload screen', () => {
    expect(presetPeriod('this_week', now)).toEqual({ start: '2026-08-10', end: '2026-08-16' });
  });

  it('runs last week as the seven days before that', () => {
    expect(presetPeriod('last_week', now)).toEqual({ start: '2026-08-03', end: '2026-08-09' });
  });

  it('ends a month on its real last day, not on the 30th', () => {
    expect(presetPeriod('this_month', now)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(presetPeriod('last_month', now)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('handles a February in a non-leap year', () => {
    const march = Date.parse('2026-03-15T00:00:00Z');
    expect(presetPeriod('last_month', march)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('crosses a year boundary backwards without landing in month -1', () => {
    const jan = Date.parse('2026-01-10T00:00:00Z');
    expect(presetPeriod('last_month', jan)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('runs the quarter August sits in as July to September', () => {
    expect(presetPeriod('this_quarter', now)).toEqual({ start: '2026-07-01', end: '2026-09-30' });
  });

  it('runs the year end to end', () => {
    expect(presetPeriod('this_year', now)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});

describe('reportFileStem', () => {
  it('carries the type and the period, so downloads stay tellable apart', () => {
    const report = buildReport({ ...base, type: 'completion', period: AUG, tasks: [] });
    expect(reportFileStem(report)).toBe('cni-completion-2026-08-01-to-2026-08-31');
  });

  it('does not repeat a single day twice', () => {
    const one = { start: '2026-08-12', end: '2026-08-12' };
    const report = buildReport({ ...base, type: 'time', period: one, tasks: [] });
    expect(reportFileStem(report)).toBe('cni-time-2026-08-12');
  });
});

describe('formatMinutes', () => {
  it('reads as hours and minutes', () => {
    expect(formatMinutes(0)).toBe('—');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(135)).toBe('2h 15m');
    expect(formatMinutes(1440)).toBe('24h');
  });

  it('never shows a negative duration', () => {
    expect(formatMinutes(-30)).toBe('—');
  });
});

describe('cellText', () => {
  it('renders every kind, so no cell can reach a screen as [object Object]', () => {
    expect(cellText({ kind: 'text', value: 'Ayesha' })).toBe('Ayesha');
    expect(cellText({ kind: 'number', value: 12 })).toBe('12');
    expect(cellText({ kind: 'percent', value: 83 })).toBe('83%');
    expect(cellText({ kind: 'date', value: '2026-08-12' })).toBe('2026-08-12');
    expect(cellText({ kind: 'date', value: null })).toBe('');
    expect(cellText({ kind: 'duration', value: 135 })).toBe('2h 15m');
    expect(cellText({ kind: 'bool', value: true })).toBe('Yes');
    expect(cellText({ kind: 'bool', value: false })).toBe('No');
  });
});

/* ==========================================================================
 * Every report, structurally
 * ========================================================================== */

describe('every report type', () => {
  const types = ['completion', 'workload', 'project_status', 'time'] as const;

  it.each(types)('%s builds with real data and has rows the width of its columns', (type) => {
    const report = buildReport({
      ...base,
      type,
      period: AUG,
      tasks: [task({ reference: 'A' }), task({ reference: 'B', timeSpentMinutes: 200 })],
    });

    expect(report.title.length).toBeGreaterThan(0);
    expect(report.columns.length).toBeGreaterThan(0);
    expect(report.figures.length).toBeGreaterThan(0);
    /* Notes are not decoration: a figure without its definition is how two
       people read one report and disagree. */
    expect(report.notes.length).toBeGreaterThan(0);

    for (const row of report.rows) {
      expect(row).toHaveLength(report.columns.length);
    }
  });

  it.each(types)('%s declares a cell kind that matches every value in its column', (type) => {
    const report = buildReport({
      ...base,
      type,
      period: AUG,
      tasks: [task({ reference: 'A' })],
    });

    /* The whole design rests on this: the xlsx writer trusts the column kind to
       decide whether to write a number or a string. A mismatch would produce a
       spreadsheet whose columns cannot be summed. */
    report.rows.forEach((row) => {
      row.forEach((cell, i) => {
        expect(cell.kind, `${type} column "${report.columns[i].key}"`).toBe(
          report.columns[i].kind,
        );
      });
    });
  });

  it.each(types)('%s survives completely empty inputs', (type) => {
    const report = buildReport({
      type,
      period: AUG,
      subjectId: null,
      subjectName: null,
      today: TODAY,
      tasks: [],
      people: [],
      projects: [],
    });
    expect(report.rows).toHaveLength(0);
    expect(report.figures.length).toBeGreaterThan(0);
  });
});
