import { describe, expect, it } from 'vitest';

import {
  NO_DASH_FILTERS,
  delta,
  filterDashTasks,
  isOpen,
  lastWeeks,
  needsDecision,
  periodTotals,
  platformTotals,
  projectColumns,
  topPerformers,
  type DashProject,
  type DashTask,
  type DashWeek,
} from '../dashboard-model';

/* ============================================================================
 * THE DASHBOARD MODEL
 * ----------------------------------------------------------------------------
 * Eight views are projected from one filtered array, and the fault worth
 * guarding against is any two of them describing different sets. Several tests
 * below assert that relationship rather than an individual figure.
 * ========================================================================= */

let seq = 0;
function task(over: Partial<DashTask> = {}): DashTask {
  seq += 1;
  return {
    id: `t${seq}`,
    reference: `TSK-${seq}`,
    title: `Task ${seq}`,
    projectId: 'p1',
    projectName: 'Website',
    projectType: 'client',
    assigneeId: 'u1',
    assignee: 'Kashif Ahmed',
    assigneeAvatarUrl: null,
    status: 'todo',
    priority: 'medium',
    effortPoints: 3,
    overdue: false,
    timeSpentMinutes: 0,
    timeLimitMinutes: 0,
    blockedReason: null,
    dueLabel: 'Due Friday',
    ...over,
  };
}

const PROJECTS: DashProject[] = [
  { id: 'p1', name: 'Website', taskCount: 0, openTaskCount: 0, doneTaskCount: 0, overdueTaskCount: 0, effortPoints: 0 },
  { id: 'p2', name: 'Campaign', taskCount: 0, openTaskCount: 0, doneTaskCount: 0, overdueTaskCount: 0, effortPoints: 0 },
];

describe('isOpen', () => {
  it('treats cancelled as closed, not as outstanding', () => {
    /* A backlog that counts abandoned work is a graveyard. */
    expect(isOpen(task({ status: 'cancelled' }))).toBe(false);
    expect(isOpen(task({ status: 'done' }))).toBe(false);
    expect(isOpen(task({ status: 'blocked' }))).toBe(true);
  });
});

describe('filterDashTasks', () => {
  const tasks = [
    task({ projectId: 'p1', status: 'done' }),
    task({ projectId: 'p2', status: 'todo' }),
    task({ projectId: 'p2', status: 'done' }),
  ];

  it('passes everything through when nothing is chosen', () => {
    expect(filterDashTasks(tasks, NO_DASH_FILTERS)).toHaveLength(3);
  });

  it('narrows by project and by status, and combines them', () => {
    expect(filterDashTasks(tasks, { ...NO_DASH_FILTERS, project: 'p2' })).toHaveLength(2);
    expect(filterDashTasks(tasks, { ...NO_DASH_FILTERS, status: 'done' })).toHaveLength(2);
    expect(
      filterDashTasks(tasks, { project: 'p2', status: 'done' }),
    ).toHaveLength(1);
  });

  it('returns nothing when nothing matches, rather than everything', () => {
    /* A filter that silently falls back to "all" is the worst failure here: the
       page would look filtered and be showing the division. */
    expect(filterDashTasks(tasks, { ...NO_DASH_FILTERS, project: 'nope' })).toEqual([]);
  });
});

describe('topPerformers', () => {
  it('ranks by work FINISHED, not by work held', () => {
    /* The fault this exists to prevent: grouping every task by assignee ranks
       whoever was given the most, which is close to the opposite of the heading. */
    const tasks = [
      ...Array.from({ length: 9 }, () => task({ assigneeId: 'hoarder', assignee: 'Hoarder', status: 'todo' })),
      task({ assigneeId: 'finisher', assignee: 'Finisher', status: 'done' }),
      task({ assigneeId: 'finisher', assignee: 'Finisher', status: 'done' }),
    ];
    const ranked = topPerformers(tasks);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe('Finisher');
    expect(ranked[0].done).toBe(2);
  });

  it('drops unassigned work from the board but keeps it in the shares', () => {
    const tasks = [
      task({ assigneeId: 'u1', assignee: 'Ana', status: 'done' }),
      task({ assigneeId: null, assignee: 'Unassigned', status: 'done' }),
    ];
    const ranked = topPerformers(tasks);
    expect(ranked.map((p) => p.userId)).toEqual(['u1']);
    /* One of two done tasks — NOT 100%. The shares describe the division, so
       they need not add up to a full ring, which is the honest reading. */
    expect(ranked[0].sharePct).toBe(50);
  });

  it('breaks a tie on points, then on name, so the order is never arbitrary', () => {
    const tasks = [
      task({ assigneeId: 'a', assignee: 'Ana', status: 'done', effortPoints: 1 }),
      task({ assigneeId: 'b', assignee: 'Ben', status: 'done', effortPoints: 8 }),
    ];
    expect(topPerformers(tasks).map((p) => p.name)).toEqual(['Ben', 'Ana']);
  });

  it('is empty, not broken, when nothing has been completed', () => {
    expect(topPerformers([task({ status: 'todo' })])).toEqual([]);
  });
});

describe('projectColumns', () => {
  it('stacks to the total without double-counting a late task', () => {
    /* ⚠️ An overdue task is still open. If `open` included it too, the column
       would be taller than the project has tasks. */
    const tasks = [
      task({ projectId: 'p1', status: 'done' }),
      task({ projectId: 'p1', status: 'todo', overdue: true }),
      task({ projectId: 'p1', status: 'todo' }),
    ];
    const [column] = projectColumns(tasks, PROJECTS);
    expect(column).toMatchObject({ done: 1, open: 1, overdue: 1, total: 3 });
    expect(column.done + column.open + column.overdue).toBe(column.total);
  });

  it('leaves cancelled work out of every bucket', () => {
    /* A column that grows when work is abandoned reads as progress. */
    const tasks = [
      task({ projectId: 'p1', status: 'done' }),
      task({ projectId: 'p1', status: 'cancelled' }),
    ];
    const [column] = projectColumns(tasks, PROJECTS);
    expect(column.total).toBe(1);
    expect(column.donePct).toBe(100);
  });

  it('names columns from the project list and orders them by size', () => {
    const tasks = [
      task({ projectId: 'p2' }),
      task({ projectId: 'p2' }),
      task({ projectId: 'p1' }),
    ];
    expect(projectColumns(tasks, PROJECTS).map((c) => c.name)).toEqual(['Campaign', 'Website']);
  });
});

describe('platformTotals', () => {
  it('counts only the tasks it is given, so the card follows the filter', () => {
    const kept = task({ id: 'keep' });
    const map = new Map([
      ['keep', ['facebook', 'instagram']],
      ['dropped', ['facebook']],
    ]);
    const totals = platformTotals(map, [kept]);
    expect(totals.find((t) => t.slug === 'facebook')?.count).toBe(1);
    expect(totals.reduce((a, t) => a + t.count, 0)).toBe(2);
  });

  it('is empty rather than dividing by zero when nothing was published', () => {
    expect(platformTotals(new Map(), [task()])).toEqual([]);
  });
});

describe('delta', () => {
  it('reports a rise as good or bad according to the metric, not the direction', () => {
    /* Completing more is good; creating more work is not. Colouring by direction
       alone is how a dashboard ends up lying. */
    expect(delta(12, 10, true).good).toBe(true);
    expect(delta(12, 10, false).good).toBe(false);
    expect(delta(8, 10, false).good).toBe(true);
  });

  it('prints a signed percentage', () => {
    expect(delta(12, 10, true).label).toBe('+20%');
    expect(delta(8, 10, true).label).toBe('-20%');
  });

  it('never invents a percentage for growth from zero', () => {
    /* "+100%" for 0 → 4 is wrong AND looks like a real figure, which is worse
       than saying nothing. */
    const fromZero = delta(4, 0, true);
    expect(fromZero.pct).toBe(0);
    expect(fromZero.label).toBe('new');
    expect(delta(0, 0, true).label).toBe('no change');
  });

  it('survives non-finite input rather than printing NaN%', () => {
    expect(delta(Number.NaN, 10, true).label).not.toContain('NaN');
    expect(delta(10, Number.NaN, true).label).not.toContain('NaN');
  });
});

describe('periodTotals', () => {
  const weeks: DashWeek[] = Array.from({ length: 8 }, (_, i) => ({
    weekStart: `2026-0${i + 1}-01`,
    created: 1,
    completed: i + 1,
  }));

  it('compares equal-length halves', () => {
    /* ⚠️ The fault: comparing the last 4 weeks against ALL earlier ones puts a
       4-week sum against a 20-week one and reports a collapse every time the
       history gets longer. */
    const { current, previous } = periodTotals(weeks, 4, (w) => w.completed);
    expect(current).toBe(5 + 6 + 7 + 8);
    expect(previous).toBe(1 + 2 + 3 + 4);
  });

  it('does not invent a previous period that has no data', () => {
    const short = weeks.slice(0, 3);
    const { current, previous } = periodTotals(short, 4, (w) => w.completed);
    expect(current).toBe(1 + 2 + 3);
    expect(previous).toBe(0);
  });
});

describe('lastWeeks', () => {
  const weeks: DashWeek[] = Array.from({ length: 8 }, (_, i) => ({
    weekStart: `w${i}`,
    created: 0,
    completed: 0,
  }));

  it('takes the most recent span and never more than exists', () => {
    expect(lastWeeks(weeks, 4).map((w) => w.weekStart)).toEqual(['w4', 'w5', 'w6', 'w7']);
    expect(lastWeeks(weeks, 99)).toHaveLength(8);
  });
});

describe('needsDecision', () => {
  it('puts blocked first, then overdue, then waiting on a review', () => {
    const review = task({ status: 'in_review' });
    const late = task({ status: 'todo', overdue: true });
    const stuck = task({ status: 'blocked' });
    expect(needsDecision([review, late, stuck]).map((t) => t.id)).toEqual([
      stuck.id,
      late.id,
      review.id,
    ]);
  });

  it('lists a task that is both blocked AND overdue exactly once', () => {
    const both = task({ status: 'blocked', overdue: true });
    expect(needsDecision([both])).toHaveLength(1);
  });

  it('never lists closed work, however late it was', () => {
    expect(needsDecision([task({ status: 'done', overdue: true })])).toEqual([]);
    expect(needsDecision([task({ status: 'cancelled', overdue: true })])).toEqual([]);
  });

  it('caps the list, because a list of everything is not a list of priorities', () => {
    const many = Array.from({ length: 30 }, () => task({ status: 'blocked' }));
    expect(needsDecision(many)).toHaveLength(8);
  });
});

describe('the projections agree with each other', () => {
  /* The real guarantee: every view is derived from ONE filtered array, so no two
     of them can be describing different sets. */
  const tasks = [
    task({ projectId: 'p1', status: 'done', assigneeId: 'u1' }),
    task({ projectId: 'p1', status: 'todo', overdue: true }),
    task({ projectId: 'p2', status: 'done', assigneeId: 'u2' }),
    task({ projectId: 'p2', status: 'cancelled' }),
  ];

  it('counts the same completed work in the ranking and in the columns', () => {
    for (const project of ['all', 'p1', 'p2']) {
      const shown = filterDashTasks(tasks, { ...NO_DASH_FILTERS, project });
      const ranked = topPerformers(shown).reduce((a, p) => a + p.done, 0);
      const columned = projectColumns(shown, PROJECTS).reduce((a, c) => a + c.done, 0);
      expect(ranked).toBe(columned);
    }
  });

  it('never shows a decision row that the filter has excluded', () => {
    const shown = filterDashTasks(tasks, { ...NO_DASH_FILTERS, project: 'p2' });
    expect(needsDecision(shown).every((t) => t.projectId === 'p2')).toBe(true);
  });
});

describe('delta, against a tiny base', () => {
  it('refuses to divide by a base too small to mean anything', () => {
    /* ⚠️ "+1680%" shipped to the dashboard: 18 created this period against 1 in
       the last. Arithmetically right, useless as a measurement — it describes
       how empty the old window was, not how the division is doing. */
    const d = delta(18, 1, true);
    expect(d.label).not.toContain('%');
    expect(d.label).toBe('up from few');
    expect(d.pct).toBe(0);
  });

  it('still reports the DIRECTION, and whether it is good news', () => {
    expect(delta(18, 1, true).good).toBe(true);
    /* More work arriving is not good news — the caller decides, as ever. */
    expect(delta(18, 1, false).good).toBe(false);
    expect(delta(1, 4, true).label).toBe('down from few');
  });

  it('reports a real percentage once the base is big enough', () => {
    expect(delta(12, 10, true).label).toBe('+20%');
    expect(delta(6, 5, true).label).toBe('+20%');
  });

  it('is about the BASE, not about the size of the answer', () => {
    /* A big move on a solid base is still REPORTED — the small-base rule must
       not swallow real growth. It is summarised as a multiple by the separate
       MAX_RATIO rule below, and the exact percentage survives on `pct`. */
    const d = delta(500, 50, true);
    expect(d.label).toBe('×10');
    expect(d.pct).toBe(900);
  });
});

describe('delta, on an extreme move', () => {
  it('prints a multiple rather than a four-digit percentage', () => {
    /* ⚠️ "+1680%" shipped: 267 created in four weeks against 15 in the four
       before. Correct, and unreadable on a tile. */
    const d = delta(267, 15, false);
    expect(d.label).toBe('×18');
    expect(d.label).not.toContain('%');
  });

  it('keeps the raw percentage for any caller that wants it', () => {
    /* The label is a summary, not a replacement for the figure. */
    expect(delta(267, 15, false).pct).toBe(1680);
  });

  it('does the same for a collapse', () => {
    expect(delta(15, 267, true).label).toBe('÷18');
  });

  it('leaves ordinary moves as percentages', () => {
    /* The guard must not swallow the everyday case it exists to protect. A
       fourfold rise is still readable as a percentage; the switch happens at
       five, which is where the digits start crowding the figure. */
    expect(delta(120, 100, true).label).toBe('+20%');
    expect(delta(400, 100, true).label).toBe('+300%');
    expect(delta(500, 100, true).label).toBe('×5');
  });
});
