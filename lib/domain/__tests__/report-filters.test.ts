import { describe, expect, it } from 'vitest';

import { bucketsFor, chartsFor, __testing } from '../report-charts';
import {
  EMPTY_FILTERS,
  NATURAL_SORT,
  buildReport,
  type ReportFilters,
  type ReportInput,
  type ReportPerson,
  type ReportProject,
  type ReportSort,
  type ReportTask,
} from '../reports';

/* ============================================================================
 * FILTERS, SORTING AND CHARTS
 * ----------------------------------------------------------------------------
 * Owner: *"I want a proper filter and each and everything should properly
 * implement the filters… the data should be accurate."*
 *
 * The cases here are the ones where a plausible implementation is wrong and
 * LOOKS right on screen:
 *
 *   · an empty filter array read as "show nothing" rather than "no opinion"
 *   · a platform filter that requires ALL platforms instead of any
 *   · a content filter that cannot express "not content at all"
 *   · a sort that puts blank dates at the top as if they were 1970
 *   · charts computed from a different set of rows than the table under them
 *
 * The last is the one that matters most and has no visible symptom until
 * somebody adds up a column and finds it does not match the graph.
 * ========================================================================= */

const AUG = { start: '2026-08-01', end: '2026-08-31' };
const TODAY = '2026-08-20';

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
    contentKind: 'static',
    platforms: ['facebook'],
    publishedOn: null,
    assigneeAvatarUrl: null,
    updatedAt: '2026-08-09T12:00:00Z',
    ...over,
  };
}

const person: ReportPerson = {
  userId: 'u1',
  name: 'Ayesha Siddiqui',
  roleTitle: 'Designer',
  role: 'member',
  loadPoints: 18,
  capacityPoints: 30,
  utilisationPct: 60,
  bandLabel: 'Comfortable',
  activeTaskCount: 4,
  maxConcurrentTasks: 8,
  otherWorkPct: 0,
};

const project: ReportProject = {
  id: 'p1',
  name: 'Project One',
  code: 'P1',
  type: 'client',
  status: 'active',
};

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    type: 'completion',
    period: AUG,
    subjectId: null,
    subjectName: null,
    today: TODAY,
    tasks: [task()],
    people: [person],
    projects: [project],
    filters: EMPTY_FILTERS,
    sort: NATURAL_SORT,
    ...over,
  };
}

const withFilters = (over: Partial<ReportFilters>): ReportFilters => ({
  ...EMPTY_FILTERS,
  ...over,
});

/* ==========================================================================
 * Filters
 * ========================================================================== */

describe('report filters', () => {
  it('treats an empty filter as "everything", not as "nothing"', () => {
    /* THE test for the empty-array convention. If `[]` were read as a literal
       set to match against, every report would come back blank the moment a
       filter object was passed at all — and it would look like a quiet month. */
    const tasks = [task({ reference: 'A' }), task({ reference: 'B', projectId: 'p2' })];
    const report = buildReport(input({ tasks, filters: EMPTY_FILTERS }));

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0][1]).toEqual({ kind: 'number', value: 2 });
  });

  it('narrows to the chosen projects', () => {
    const tasks = [
      task({ reference: 'A', projectId: 'p1' }),
      task({ reference: 'B', projectId: 'p2' }),
      task({ reference: 'C', projectId: 'p3' }),
    ];
    const report = buildReport(
      input({ tasks, filters: withFilters({ projectIds: ['p1', 'p3'] }) }),
    );

    expect(report.rows[0][1]).toEqual({ kind: 'number', value: 2 });
  });

  it('matches ANY of the chosen platforms, not all of them', () => {
    /* A cross-posted asset must match a filter for either platform. Requiring
       every selected platform would report almost nothing for a division whose
       whole workflow is posting one asset to three places. */
    const tasks = [
      task({ reference: 'A', platforms: ['facebook', 'instagram'] }),
      task({ reference: 'B', platforms: ['tiktok'] }),
      task({ reference: 'C', platforms: [] }),
    ];
    const report = buildReport(
      input({ tasks, filters: withFilters({ platforms: ['instagram', 'tiktok'] }) }),
    );

    expect(report.rows[0][1]).toEqual({ kind: 'number', value: 2 });
  });

  it("selects work that is NOT content with the 'none' kind", () => {
    /* The executives' oversight items have no content kind at all, so no list of
       real kinds can select them. Without 'none' the CEO and CTO would be
       unreachable by the content filter entirely. */
    const tasks = [
      task({ reference: 'A', contentKind: 'static' }),
      task({ reference: 'B', contentKind: 'reel' }),
      task({ reference: 'C', contentKind: null }),
      task({ reference: 'D', contentKind: null }),
    ];
    const report = buildReport(input({ tasks, filters: withFilters({ contentKinds: ['none'] }) }));

    expect(report.rows[0][1]).toEqual({ kind: 'number', value: 2 });
  });

  it('combines filters as AND across dimensions', () => {
    const tasks = [
      task({ reference: 'A', projectId: 'p1', platforms: ['facebook'] }),
      task({ reference: 'B', projectId: 'p1', platforms: ['tiktok'] }),
      task({ reference: 'C', projectId: 'p2', platforms: ['facebook'] }),
    ];
    const report = buildReport(
      input({
        tasks,
        filters: withFilters({ projectIds: ['p1'], platforms: ['facebook'] }),
      }),
    );

    expect(report.rows[0][1]).toEqual({ kind: 'number', value: 1 });
  });

  it('narrows which people appear on a workload report without altering their load', () => {
    /* Capacity is a property of a person, not of a project. Filtering must not
       invent "60% of Ayesha within this project" — a number you cannot plan
       against. She either appears whole or does not appear. */
    const withWork = buildReport(
      input({
        type: 'workload',
        tasks: [task({ assigneeId: 'u1', projectId: 'p1' })],
        filters: withFilters({ projectIds: ['p1'] }),
      }),
    );
    expect(withWork.rows).toHaveLength(1);
    /* Load points, unchanged by the filter. */
    expect(withWork.rows[0][2]).toEqual({ kind: 'number', value: 18 });

    const withoutWork = buildReport(
      input({
        type: 'workload',
        tasks: [task({ assigneeId: 'u1', projectId: 'p1' })],
        filters: withFilters({ projectIds: ['p2'] }),
      }),
    );
    expect(withoutWork.rows).toHaveLength(0);
  });
});

/* ==========================================================================
 * Sorting
 * ========================================================================== */

describe('report sorting', () => {
  const threePeople = [
    task({ reference: 'A', assigneeId: 'u1', assigneeName: 'Zara' }),
    task({ reference: 'B', assigneeId: 'u2', assigneeName: 'Ali' }),
    task({ reference: 'C', assigneeId: 'u2', assigneeName: 'Ali' }),
    task({ reference: 'D', assigneeId: 'u3', assigneeName: 'Mina' }),
    task({ reference: 'E', assigneeId: 'u3', assigneeName: 'Mina' }),
    task({ reference: 'F', assigneeId: 'u3', assigneeName: 'Mina' }),
  ];

  const sortBy = (sort: ReportSort) =>
    buildReport(input({ tasks: threePeople, sort })).rows.map((r) =>
      r[0].kind === 'text' ? r[0].value : '',
    );

  it('leaves the report in its own order when no column is chosen', () => {
    /* The natural order has to stay expressible — a control that cannot get back
       to the default is a control people avoid using. */
    expect(sortBy(NATURAL_SORT)).toEqual(['Ali', 'Mina', 'Zara']);
  });

  it('sorts a number column descending', () => {
    expect(sortBy({ key: 'done', direction: 'desc' })).toEqual(['Mina', 'Ali', 'Zara']);
  });

  it('sorts a text column ascending', () => {
    expect(sortBy({ key: 'person', direction: 'asc' })).toEqual(['Ali', 'Mina', 'Zara']);
  });

  it('falls back to the natural order for a column that no longer exists', () => {
    /* A bookmarked link whose column was renamed must still render a report
       rather than an error. */
    expect(sortBy({ key: 'a-column-that-was-removed', direction: 'desc' })).toEqual([
      'Ali',
      'Mina',
      'Zara',
    ]);
  });
});

/* ==========================================================================
 * Buckets
 * ========================================================================== */

describe('bucketsFor', () => {
  it('uses days for a short period', () => {
    const buckets = bucketsFor({ start: '2026-08-01', end: '2026-08-07' });
    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toEqual({ label: '1 Aug', start: '2026-08-01', end: '2026-08-01' });
  });

  it('uses weeks for a month and clamps the last one to the period end', () => {
    /* The final bucket must not reach past the period, or it counts work from
       outside the range the reader asked for. */
    const buckets = bucketsFor(AUG);
    expect(buckets.length).toBeGreaterThan(3);
    expect(buckets[buckets.length - 1].end).toBe('2026-08-31');
  });

  it('still uses weeks for a full quarter', () => {
    /* 83 days is inside the weekly threshold on purpose: twelve weekly points
       answer "is this improving" better than three monthly ones, and a quarter is
       the longest period the page offers below a year. */
    const buckets = bucketsFor({ start: '2026-06-10', end: '2026-08-31' });
    expect(buckets).toHaveLength(12);
    expect(buckets[0].label).toBe('10 Jun');
  });

  it('uses months for a year and starts the first bucket at the period start', () => {
    const buckets = bucketsFor({ start: '2026-03-10', end: '2027-02-28' });
    expect(buckets.map((b) => b.label)).toEqual([
      'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26',
      'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Jan 27', 'Feb 27',
    ]);
    /* Not 2026-03-01: a report from 10 March onwards must not count the first
       nine days of the month. */
    expect(buckets[0].start).toBe('2026-03-10');
    expect(buckets[11].end).toBe('2027-02-28');
  });

  it('covers every day exactly once, at every granularity', () => {
    for (const period of [
      { start: '2026-08-01', end: '2026-08-07' },
      AUG,
      { start: '2026-01-01', end: '2026-12-31' },
    ]) {
      const buckets = bucketsFor(period);
      expect(buckets[0].start).toBe(period.start);
      expect(buckets[buckets.length - 1].end).toBe(period.end);
      /* No gaps and no overlaps: each bucket starts the day after the previous
         one ended. A gap silently drops work out of every trend. */
      for (let i = 1; i < buckets.length; i += 1) {
        const previousEnd = Date.parse(`${buckets[i - 1].end}T00:00:00Z`);
        const thisStart = Date.parse(`${buckets[i].start}T00:00:00Z`);
        expect(thisStart - previousEnd).toBe(86_400_000);
      }
    }
  });
});

/* ==========================================================================
 * Charts
 * ==========================================================================
 * The invariant, and the reason this file exists.
 * ========================================================================== */

describe('charts and the table agree', () => {
  const mixed = [
    task({ reference: 'A', projectId: 'p1', status: 'done', platforms: ['facebook'] }),
    task({
      reference: 'B',
      projectId: 'p2',
      status: 'todo',
      completedAt: null,
      platforms: ['instagram'],
    }),
    task({ reference: 'C', projectId: 'p1', status: 'done', platforms: ['facebook', 'instagram'] }),
    task({ reference: 'D', projectId: 'p2', status: 'done', contentKind: null, platforms: [] }),
  ];

  it('scopes charts to exactly the rows the table counts', () => {
    /* ⚠️ THE test in this file. `report-charts.ts` re-implements the scoping that
       `reports.ts` does privately, and this is what stops the two drifting: if a
       sixth filter is ever added to one and not the other, this fails. */
    for (const filters of [
      EMPTY_FILTERS,
      withFilters({ projectIds: ['p1'] }),
      withFilters({ platforms: ['instagram'] }),
      withFilters({ contentKinds: ['none'] }),
      withFilters({ statuses: ['done'] }),
      withFilters({ projectIds: ['p2'], statuses: ['done'] }),
    ]) {
      const shaped = input({ tasks: mixed, filters });
      const report = buildReport(shaped);

      /* The completion table's per-person "Completed" column, totalled. */
      const tableDone = report.rows.reduce(
        (sum, row) => sum + (row[1].kind === 'number' ? row[1].value : 0),
        0,
      );

      const charts = chartsFor(shaped);
      const perPerson = charts.find((c) => c.kind === 'bars');
      const chartDone =
        perPerson && perPerson.kind === 'bars'
          ? perPerson.bars.reduce((sum, bar) => sum + bar.value, 0)
          : 0;

      expect(chartDone).toBe(tableDone);
    }
  });

  it('gives every report type a chart set', () => {
    for (const type of ['completion', 'workload', 'project_status', 'time'] as const) {
      const charts = chartsFor(input({ type, tasks: mixed }));
      expect(charts.length).toBeGreaterThan(0);
      for (const chart of charts) {
        /* Every chart states the question it answers — that is what makes four
           charts on a page tellable apart at a glance. */
        expect(chart.question.length).toBeGreaterThan(0);
        expect(chart.title.length).toBeGreaterThan(0);
      }
    }
  });

  it('survives completely empty inputs for every type', () => {
    for (const type of ['completion', 'workload', 'project_status', 'time'] as const) {
      const charts = chartsFor(
        input({ type, tasks: [], people: [], projects: [] }),
      );
      expect(Array.isArray(charts)).toBe(true);
    }
  });
});

describe('chart derivations', () => {
  it('counts a cross-posted asset once per platform, never twice on one', () => {
    /* Placements, not assets — the total exceeds the task count on purpose, and
       the donut's centre says "Placements" for exactly this reason. */
    const mix = __testing.platformMix([
      task({ platforms: ['facebook', 'instagram'] }),
      task({ platforms: ['facebook'] }),
    ]);

    expect(mix.find((s) => s.label === 'Facebook')?.value).toBe(2);
    expect(mix.find((s) => s.label === 'Instagram')?.value).toBe(1);
  });

  it('names non-content work rather than dropping it', () => {
    /* If this were omitted, the two executives — whose only assigned work has no
       content kind — would show as doing nothing at all. */
    const mix = __testing.contentMix([task({ contentKind: null }), task({ contentKind: 'reel' })]);
    expect(mix.map((s) => s.label)).toContain('Not content');
  });

  it('gathers the tail into an "others" bar instead of discarding it', () => {
    /* A top-ten that silently drops the eleventh reports a total that does not
       match the sum of what is drawn — and the owner expects to pass thirteen
       projects soon. */
    const many = Array.from({ length: 15 }, (_, i) => ({
      label: `P${i}`,
      value: 15 - i,
      token: 'accent-primary',
    }));
    const bars = __testing.topBars(many);

    expect(bars).toHaveLength(10);
    expect(bars[bars.length - 1].label).toBe('6 others');
    /* Nothing lost. */
    expect(bars.reduce((sum, b) => sum + b.value, 0)).toBe(
      many.reduce((sum, b) => sum + b.value, 0),
    );
  });
});
