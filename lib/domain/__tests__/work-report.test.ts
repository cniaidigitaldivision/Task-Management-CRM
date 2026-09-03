import { describe, expect, it } from 'vitest';

import { buildWorkReport, workReportToReport, type WorkReportOptions } from '../work-report';
import {
  EMPTY_FILTERS,
  NATURAL_SORT,
  type ReportInput,
  type ReportPerson,
  type ReportProject,
  type ReportTask,
} from '../reports';

/* ============================================================================
 * THE WORK REPORT
 * ----------------------------------------------------------------------------
 * The owner's mockup, against their own database. The figures here are the
 * product, so these are arithmetic against hand-worked numbers.
 *
 * The cases that matter are the ones where a plausible implementation is wrong
 * and looks completely right on screen:
 *
 *   · Posts Published counted from the COMPLETION date rather than the published
 *     date — the exact bug migration 055 was written to fix
 *   · a cross-posted asset counted once per platform, inflating every total
 *   · the Top poster badge awarded on a tie
 *   · Status guessed from the counts rather than read from the open tasks
 * ========================================================================= */

const AUG = { start: '2026-08-01', end: '2026-08-31' };
const TODAY = '2026-08-20';

function task(over: Partial<ReportTask> = {}): ReportTask {
  return {
    reference: 'CNI-001',
    title: 'A task',
    /* Added 2026-09-03 with the report's row detail — see `ReportTask`. */
    description: null,
    links: [],
    projectId: 'p1',
    projectName: 'GC Royal Emporium',
    projectType: 'client',
    projectCode: 'GC',
    assigneeId: 'u1',
    assigneeName: 'Kashif Ahmed',
    status: 'done',
    effortPoints: 3,
    dueDate: '2026-08-10',
    completedAt: '2026-08-09T12:00:00Z',
    timeLimitMinutes: 120,
    timeSpentMinutes: 90,
    extensionMinutesGranted: 0,
    contentKind: 'static',
    platforms: ['facebook'],
    publishedOn: '2026-08-09',
    assigneeAvatarUrl: null,
    updatedAt: '2026-08-09T12:00:00Z',
    ...over,
  };
}

const person: ReportPerson = {
  userId: 'u1',
  name: 'Kashif Ahmed',
  roleTitle: 'Team Coordinator',
  role: 'team_coordinator',
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
  name: 'GC Royal Emporium',
  code: 'GC',
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

const options = (over: Partial<WorkReportOptions> = {}): WorkReportOptions => ({
  roles: new Map([['p1:u1', 'manager']]),
  sort: 'posts',
  direction: 'desc',
  weekStart: '2026-08-17',
  ...over,
});

describe('work report rows', () => {
  it('makes one row per project and person, not one per person', () => {
    /* Kashif on two projects is two rows. Merging them would answer "what is
       Kashif doing" and lose "what is Kashif doing HERE", which is the column
       layout's entire premise. */
    const work = buildWorkReport(
      input({
        tasks: [
          task({ projectId: 'p1', projectName: 'GC Royal' }),
          task({ projectId: 'p2', projectName: 'Daniyal Marketing' }),
          task({ projectId: 'p2', projectName: 'Daniyal Marketing', reference: 'B' }),
        ],
      }),
      options(),
    );

    expect(work.rows).toHaveLength(2);
    expect(work.rows.map((r) => r.projectName).sort()).toEqual(['Daniyal Marketing', 'GC Royal']);
  });

  it('counts Posts Published on the PUBLISHED date, never the completion date', () => {
    /* ⚠️ THE test in this file. Migration 055 exists because every report was
       reading the wrong column and a division that had published for months
       reported ACHIEVED 0. A task finished inside the period but not published is
       done work and is not a post. */
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', publishedOn: '2026-08-09' }),
          task({ reference: 'B', publishedOn: null, completedAt: '2026-08-09T12:00:00Z' }),
        ],
      }),
      options(),
    );

    expect(work.rows[0].tasksDone).toBe(2);
    expect(work.rows[0].postsPublished).toBe(1);
  });

  it('counts a cross-posted asset once, and lists all its platforms', () => {
    /* One video on four platforms is ONE asset (the owner's rule) and four
       placements. Counting placements here would inflate every project's output
       three- or fourfold. */
    const work = buildWorkReport(
      input({ tasks: [task({ platforms: ['facebook', 'instagram', 'tiktok'] })] }),
      options(),
    );

    expect(work.rows[0].postsPublished).toBe(1);
    expect(work.rows[0].platforms).toEqual(['facebook', 'instagram', 'tiktok']);
  });

  it('never counts non-content work as a post', () => {
    /* The executives' oversight items are work with no content kind. They belong
       in Tasks Assigned and must never reach Posts Published. */
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', contentKind: null, publishedOn: null, platforms: [] }),
          task({ reference: 'B' }),
        ],
      }),
      options(),
    );

    expect(work.rows[0].tasksAssigned).toBe(2);
    expect(work.rows[0].postsPublished).toBe(1);
  });

  it('writes the activity summary largest first', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', contentKind: 'story' }),
          task({ reference: 'B', contentKind: 'static' }),
          task({ reference: 'C', contentKind: 'static' }),
          task({ reference: 'D', contentKind: 'static' }),
          task({ reference: 'E', contentKind: 'reel' }),
          task({ reference: 'F', contentKind: 'reel' }),
        ],
      }),
      options(),
    );

    /* Plural words, not the dropdown labels: "3 Static posts, 2 Reel / short
       videos" is not a sentence anybody reads. */
    expect(work.rows[0].activitySummary).toBe('3 posts, 2 reels, 1 story');
  });

  /* ── ⚠️ REPLACED ON 2026-09-03 ────────────────────────────────────────────
     This asserted the project role resolved for the pairing. The column is gone:
     owner, *"Instead of a role I don't need roles right? Role and top poster
     here should mention the task."* The role was the same word on every row a
     person appeared in and told a reader nothing they could act on.

     What replaces it is the work itself, which is what the row was always
     missing — "3 assigned, 2 done" never said what the three were. */
  it('carries every one of the pairing\'s tasks, finished first', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', title: 'Open one', status: 'todo' }),
          task({ reference: 'B', title: 'Finished one', status: 'done' }),
        ],
      }),
      options(),
    );

    expect(work.rows[0].tasks.map((t) => t.title)).toEqual(['Finished one', 'Open one']);
  });

  it('calls work with no content kind a Task rather than leaving it blank', () => {
    const work = buildWorkReport(
      input({ tasks: [task({ reference: 'A', contentKind: null })] }),
      options(),
    );
    expect(work.rows[0].tasks[0].category).toBe('Task');
  });
});

describe('work report status', () => {
  const statusOf = (tasks: ReportTask[]) =>
    buildWorkReport(input({ tasks }), options()).rows[0].status;

  it('is completed when nothing is open', () => {
    expect(statusOf([task({ status: 'done' })])).toBe('completed');
  });

  it('is overdue when something open is already past its due date', () => {
    /* Measured against TODAY, not the period end. Ask for August's report on the
       20th and work due on the 25th is not late. */
    expect(
      statusOf([task({ status: 'todo', completedAt: null, dueDate: '2026-08-10' })]),
    ).toBe('overdue');
    expect(
      statusOf([task({ status: 'todo', completedAt: null, dueDate: '2026-08-25' })]),
    ).not.toBe('overdue');
  });

  it('is active when something is in progress and pending when nothing is moving', () => {
    /* ⚠️ The distinction the column exists for. "8 assigned, 6 done, 2 pending"
       is the same on both rows; whether those two are being worked on or sitting
       untouched is a different conversation in a meeting. */
    expect(
      statusOf([task({ status: 'in_progress', completedAt: null, dueDate: '2026-08-25' })]),
    ).toBe('active');
    expect(
      statusOf([task({ status: 'todo', completedAt: null, dueDate: '2026-08-25' })]),
    ).toBe('pending');
  });
});

describe('posting performance by member', () => {
  it('groups across projects and ranks by total posts', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', projectId: 'p1', projectName: 'GC Royal' }),
          task({ reference: 'B', projectId: 'p2', projectName: 'Daniyal' }),
          task({
            reference: 'C',
            projectId: 'p1',
            projectName: 'GC Royal',
            assigneeId: 'u2',
            assigneeName: 'Najmulla',
          }),
        ],
      }),
      options(),
    );

    expect(work.posters[0].personName).toBe('Kashif Ahmed');
    expect(work.posters[0].totalPosts).toBe(2);
    expect([...new Set(work.posters[0].projects)].sort()).toEqual(['Daniyal', 'GC Royal']);
    expect(work.posters[1].totalPosts).toBe(1);
  });

  /* ── ⚠️ THE TOP-POSTER TEST IS GONE WITH THE BADGE, 2026-09-03 ──────────
     It asserted that one person carried a "Top poster" badge and that a tie
     gave it to nobody. Both were correct about a superlative computed over a
     report somebody had already FILTERED — so "top" meant "top of what is left
     on screen", which changed with the filter and was never a fact about the
     division. The ranking still exists as the order of `posters`. */


  it('counts This Week from the current week, not from the report period', () => {
    /* The period may be a whole quarter; the column is deliberately always the
       last seven days, so a monthly report still shows what just happened. */
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', publishedOn: '2026-08-03' }),
          task({ reference: 'B', publishedOn: '2026-08-19' }),
        ],
      }),
      options({ weekStart: '2026-08-17' }),
    );

    expect(work.posters[0].totalPosts).toBe(2);
    expect(work.posters[0].thisWeek).toBe(1);
  });

  it('still counts This Week when the period is LAST week', () => {
    /* ⚠️ REGRESSION. The owner caught this: *"if I select Last Week then why is
       This Week 0?"* It was computed from the period-scoped rows, and "published
       last week" and "published this week" are mutually exclusive by definition —
       so the column could only ever be zero for any period but the current one. A
       number with one possible answer is not a column.

       Reviewing last week and seeing what has gone out since is the whole point of
       having both figures side by side. */
    const lastWeek = { start: '2026-08-10', end: '2026-08-16' };
    const work = buildWorkReport(
      input({
        period: lastWeek,
        tasks: [
          /* Inside the reviewed period. */
          task({ reference: 'A', publishedOn: '2026-08-12', completedAt: '2026-08-12T09:00:00Z', dueDate: '2026-08-12' }),
          task({ reference: 'B', publishedOn: '2026-08-13', completedAt: '2026-08-13T09:00:00Z', dueDate: '2026-08-13' }),
          /* This week — outside the period, and the whole question. */
          task({ reference: 'C', publishedOn: '2026-08-18', completedAt: '2026-08-18T09:00:00Z', dueDate: '2026-08-18' }),
        ],
      }),
      options({ weekStart: '2026-08-17' }),
    );

    /* The table above still reports only the period. */
    expect(work.posters[0].totalPosts).toBe(2);
    /* And This Week reports now, not zero. */
    expect(work.posters[0].thisWeek).toBe(1);
  });

  it('keeps every filter except the period on the This Week count', () => {
    /* It lifts the PERIOD, not the project — a report filtered to one project must
       not have a column quietly counting all of them. */
    const work = buildWorkReport(
      input({
        period: { start: '2026-08-10', end: '2026-08-16' },
        filters: { ...EMPTY_FILTERS, projectIds: ['p1'] },
        tasks: [
          /* Inside the period, so the person has a row at all — the posters table
             is built from the period's rows, so somebody with nothing in the period
             is legitimately absent from it rather than listed with zeroes. */
          task({ reference: 'IN', projectId: 'p1', publishedOn: '2026-08-12', completedAt: '2026-08-12T09:00:00Z', dueDate: '2026-08-12' }),
          /* This week, on the filtered project — counted. */
          task({ reference: 'A', projectId: 'p1', publishedOn: '2026-08-18', completedAt: '2026-08-18T09:00:00Z', dueDate: '2026-08-18' }),
          /* This week, on a project the filter excludes — must NOT be counted. */
          task({ reference: 'B', projectId: 'p2', projectName: 'Other', publishedOn: '2026-08-18', completedAt: '2026-08-18T09:00:00Z', dueDate: '2026-08-18' }),
        ],
      }),
      options({ weekStart: '2026-08-17' }),
    );

    expect(work.posters[0].thisWeek).toBe(1);
  });

  it('names the most used platform', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', platforms: ['facebook'] }),
          task({ reference: 'B', platforms: ['facebook'] }),
          task({ reference: 'C', platforms: ['tiktok'] }),
        ],
      }),
      options(),
    );
    expect(work.posters[0].mostUsedPlatform).toBe('facebook');
  });
});

describe('filters and sorting', () => {
  const three = [
    task({ reference: 'A', projectId: 'p1', projectName: 'GC Royal' }),
    task({
      reference: 'B',
      projectId: 'p2',
      projectName: 'Daniyal',
      platforms: ['tiktok'],
    }),
    task({
      reference: 'C',
      projectId: 'p2',
      projectName: 'Daniyal',
      platforms: ['tiktok'],
      assigneeId: 'u2',
      assigneeName: 'Najmulla',
    }),
  ];

  it('honours the project filter', () => {
    const work = buildWorkReport(
      input({ tasks: three, filters: { ...EMPTY_FILTERS, projectIds: ['p2'] } }),
      options(),
    );
    expect(work.rows).toHaveLength(2);
  });

  it('honours the platform filter as ANY, not ALL', () => {
    const work = buildWorkReport(
      input({ tasks: three, filters: { ...EMPTY_FILTERS, platforms: ['tiktok'] } }),
      options(),
    );
    expect(work.rows.every((r) => r.projectName === 'Daniyal')).toBe(true);
  });

  it('sorts by the chosen column in both directions', () => {
    const tasks = [
      task({ reference: 'A', projectId: 'p1', projectName: 'Alpha' }),
      task({ reference: 'B', projectId: 'p2', projectName: 'Zulu' }),
      task({ reference: 'C', projectId: 'p2', projectName: 'Zulu' }),
    ];

    const desc = buildWorkReport(input({ tasks }), options({ sort: 'posts', direction: 'desc' }));
    expect(desc.rows[0].projectName).toBe('Zulu');

    const asc = buildWorkReport(input({ tasks }), options({ sort: 'project', direction: 'asc' }));
    expect(asc.rows[0].projectName).toBe('Alpha');
  });
});

describe('the export shape', () => {
  it('carries every visible column into the typed-cell report', () => {
    /* The exports work because the work report becomes a `Report`. A column that
       exists on screen and not here is a column missing from the spreadsheet. */
    const shaped = input();
    const work = buildWorkReport(shaped, options());
    const report = workReportToReport(work, shaped, '2026-08-25T09:00:00Z');

    expect(report.columns.map((c) => c.label)).toEqual([
      'Project',
      'Person',
      'Role',
      'Platform',
      'Tasks Assigned',
      'Tasks Done',
      'Tasks Pending',
      'Posts Published',
      'Content Type',
      'Activity Summary',
      'Status',
      'Last Active',
    ]);
    expect(report.rows).toHaveLength(work.rows.length);
    expect(report.rows[0]).toHaveLength(report.columns.length);
  });

  it('writes platform slugs as words, since a spreadsheet has no brand marks', () => {
    const shaped = input({ tasks: [task({ platforms: ['facebook', 'instagram'] })] });
    const report = workReportToReport(
      buildWorkReport(shaped, options()),
      shaped,
      '2026-08-25T09:00:00Z',
    );
    expect(report.rows[0][3]).toEqual({ kind: 'text', value: 'Facebook, Instagram' });
  });
});

/* ============================================================================
 * THE TASK LINES A ROW CARRIES — owner request, 2026-09-03
 * ----------------------------------------------------------------------------
 * *"Task name should mention a list of all tasks names that should display…
 * each row should display the task related to that person"*, and for the row
 * detail: *"the task description must display over there. Don't just put dummy
 * data in the pop-up."*
 * ========================================================================= */
describe('task lines on a work row', () => {
  it('carries the description and the live links the detail panel needs', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({
            description: 'Two frames, teal on white, Eid greeting.',
            links: [
              { slug: 'facebook', platformName: 'Facebook', url: 'https://facebook.com/p/1' },
              /* A destination with no link. The panel must not offer this as
                 something to open — that is the "dummy data" to avoid. */
              { slug: 'tiktok', platformName: 'TikTok', url: null },
            ],
          }),
        ],
      }),
      options(),
    );

    const line = work.rows[0].tasks[0];
    expect(line.description).toBe('Two frames, teal on white, Eid greeting.');
    expect(line.links.filter((link) => link.url)).toHaveLength(1);
  });

  /* Seen on CLI-1556: the same sentence in the title box and the description box.
     The panel printed it twice, once bold and once not. */
  it('drops a description that is only the title typed again', () => {
    const work = buildWorkReport(
      input({
        tasks: [task({ title: 'Set up meta ad account', description: '  Set up  META ad account ' })],
      }),
      options(),
    );
    expect(work.rows[0].tasks[0].description).toBeNull();
  });

  it('keeps a description that merely starts with the title', () => {
    const work = buildWorkReport(
      input({
        tasks: [task({ title: 'AI video', description: 'AI video about home space, uploaded to socials.' })],
      }),
      options(),
    );
    expect(work.rows[0].tasks[0].description).toBe('AI video about home space, uploaded to socials.');
  });

  /* ⚠️ Uncapped. The screen shows three and a "+N more" because the detail panel
     is one click behind it; the PDF has nothing behind it and prints them all,
     so the row has to carry them all. */
  it('lists every task rather than a capped few', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      task({ reference: `CNI-10${i}`, title: `Task ${i}` }),
    );
    const work = buildWorkReport(input({ tasks: many }), options());
    expect(work.rows[0].tasks).toHaveLength(7);
  });

  it('puts finished work first, which is what a row is opened to see', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', title: 'Still going', status: 'in_progress', completedAt: null }),
          task({ reference: 'B', title: 'Delivered', status: 'done' }),
        ],
      }),
      options(),
    );
    expect(work.rows[0].tasks[0].title).toBe('Delivered');
  });

  it('calls work with no content kind a Task rather than leaving it blank', () => {
    const work = buildWorkReport(
      input({ tasks: [task({ contentKind: null, publishedOn: null })] }),
      options(),
    );
    expect(work.rows[0].tasks[0].category).toBe('Task');
  });

  /* A row is one project-and-person pairing, so its task list must not leak a
     colleague's work into it. */
  it('keeps one person’s tasks out of another’s row', () => {
    const work = buildWorkReport(
      input({
        tasks: [
          task({ reference: 'A', title: 'Kashif work' }),
          task({ reference: 'B', title: 'Moiz work', assigneeId: 'u2', assigneeName: 'Abdul Moiz' }),
        ],
      }),
      options(),
    );

    expect(work.rows).toHaveLength(2);
    for (const row of work.rows) expect(row.tasks).toHaveLength(1);
  });
});
