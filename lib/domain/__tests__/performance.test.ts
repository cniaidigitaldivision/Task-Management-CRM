import { describe, expect, it } from 'vitest';

import {
  attentionFor,
  dayAccount,
  deadlineMoves,
  isSlip,
  onTime,
  qualityOfTask,
  qualityOfWork,
  rate,
  trend,
  type Move,
} from '../performance';

/* ============================================================================
 * THE RULES BEHIND A JUDGEMENT ABOUT SOMEBODY'S WORK
 * ----------------------------------------------------------------------------
 * These numbers end up in a conversation about a person, so each one has a test
 * naming the case it must not get wrong. The near-misses matter more than the
 * happy paths: a first-pass count that quietly includes resubmitted work still
 * LOOKS right, and nobody re-derives it.
 * ========================================================================= */

const move = (action: string, at: string, taskId = 't1'): Move => ({
  taskId,
  action,
  actorId: 'someone',
  at,
});

describe('quality of one task, read from the order of its moves', () => {
  it('through review, once, and out — a first pass', () => {
    const q = qualityOfTask([
      move('created', '2026-09-01T09:00Z'),
      move('in_review', '2026-09-02T09:00Z'),
      move('done', '2026-09-02T15:00Z'),
    ]);
    expect(q).toMatchObject({ firstPass: true, reviewed: true, resubmitted: false, reopened: false });
  });

  it('⚠️ submitted twice is NOT a first pass, however it ended', () => {
    const q = qualityOfTask([
      move('in_review', '2026-09-02T09:00Z'),
      move('revisions', '2026-09-02T10:00Z'),
      move('in_progress', '2026-09-02T11:00Z'),
      move('in_review', '2026-09-03T09:00Z'),
      move('done', '2026-09-03T12:00Z'),
    ]);
    expect(q.firstPass).toBe(false);
    expect(q.resubmitted).toBe(true);
    expect(q.sentBack).toBe(true);
    expect(q.completed).toBe(true);
  });

  it('⚠️ closed straight from the doer is completed but NOT reviewed', () => {
    /* Since 2026-09-08 the assignee may close their own work without review.
       Counting that as a first-pass approval would report a review that never
       happened — the one thing a quality figure must never do. */
    const q = qualityOfTask([move('in_progress', '2026-09-01T09:00Z'), move('done', '2026-09-01T17:00Z')]);
    expect(q).toMatchObject({ completed: true, reviewed: false, firstPass: false });
  });

  it('⚠️ back into the work AFTER it was done is a reopen; before it is just planning', () => {
    const reopened = qualityOfTask([
      move('done', '2026-09-01T17:00Z'),
      move('in_progress', '2026-09-02T09:00Z'),
    ]);
    expect(reopened.reopened).toBe(true);

    const planning = qualityOfTask([
      move('backlog', '2026-09-01T09:00Z'),
      move('todo', '2026-09-01T10:00Z'),
      move('in_progress', '2026-09-01T11:00Z'),
      move('done', '2026-09-01T17:00Z'),
    ]);
    expect(planning.reopened).toBe(false);
  });

  it('reads the moves in time order, not the order they arrive in', () => {
    const q = qualityOfTask([
      move('done', '2026-09-02T15:00Z'),
      move('in_review', '2026-09-02T09:00Z'),
    ]);
    expect(q.firstPass).toBe(true);
  });

  it('totals across tasks without double-counting one task', () => {
    const byTask = new Map<string, Move[]>([
      ['a', [move('in_review', '2026-09-01T09:00Z', 'a'), move('done', '2026-09-01T12:00Z', 'a')]],
      ['b', [move('in_review', '2026-09-01T09:00Z', 'b'), move('in_review', '2026-09-02T09:00Z', 'b')]],
      ['c', [move('done', '2026-09-01T12:00Z', 'c')]],
    ]);
    expect(qualityOfWork(byTask)).toMatchObject({
      firstPass: 1,
      resubmitted: 1,
      completed: 2,
      reviewed: 1,
    });
  });
});

describe('a rate refuses to invent a denominator', () => {
  it('⚠️ nothing to measure is null, never 0% — which reads as "bad"', () => {
    expect(rate(0, 0)).toEqual({ value: null, of: 0 });
  });

  it('and carries how many rows it was computed from', () => {
    expect(rate(7, 8)).toEqual({ value: 88, of: 8 });
  });
});

describe('deadline moves', () => {
  const entry = (before: unknown, after: unknown) => ({
    taskId: 't1',
    action: 'updated',
    actorId: 'kashif',
    at: '2026-09-02T09:00Z',
    before,
    after,
  });

  it('reports a date that actually moved, with who moved it', () => {
    const moves = deadlineMoves([entry({ dueDate: '2026-09-05' }, { dueDate: '2026-09-09' })]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: '2026-09-05', to: '2026-09-09', byId: 'kashif' });
    expect(isSlip(moves[0])).toBe(true);
  });

  it('⚠️ an edit that did not touch the date is not a deadline move', () => {
    /* Every save writes an `updated` entry. Counting those would make a person
       who fixes a typo look like somebody who keeps moving their deadlines. */
    expect(deadlineMoves([entry({ dueDate: '2026-09-05', priority: 'low' }, { dueDate: '2026-09-05', priority: 'high' })])).toHaveLength(0);
    expect(deadlineMoves([entry({ priority: 'low' }, { priority: 'high' })])).toHaveLength(0);
  });

  it('pulling a date EARLIER is a move but not a slip', () => {
    const moves = deadlineMoves([entry({ dueDate: '2026-09-09' }, { dueDate: '2026-09-05' })]);
    expect(moves).toHaveLength(1);
    expect(isSlip(moves[0])).toBe(false);
  });

  it('ignores anything that is not an edit', () => {
    expect(deadlineMoves([{ ...entry({ dueDate: 'x' }, { dueDate: 'y' }), action: 'done' }])).toHaveLength(0);
  });
});

describe("a person's day", () => {
  const T = '2026-09-23';
  const day = (over: Partial<Parameters<typeof dayAccount>[0][number]>) => ({
    dueDate: T,
    status: 'todo',
    completedOn: null,
    createdOn: '2026-09-20',
    assignedOn: null,
    ...over,
  });

  it('separates what was planned from what landed this morning', () => {
    const acc = dayAccount([day({}), day({ createdOn: T }), day({ assignedOn: T, createdOn: '2026-09-01' })], T);
    expect(acc.planned).toBe(1);
    expect(acc.unexpected).toBe(2);
  });

  it('counts what was finished today whenever it was due', () => {
    const acc = dayAccount([day({ dueDate: '2026-09-01', status: 'done', completedOn: T })], T);
    expect(acc.completed).toBe(1);
  });

  it('⚠️ separates today’s unfinished work from what was already late', () => {
    const acc = dayAccount(
      [day({ status: 'todo' }), day({ dueDate: '2026-09-20', status: 'in_progress' })],
      T,
    );
    expect(acc.unfinished).toBe(1);
    expect(acc.carriedForward).toBe(1);
  });

  it('a closed task from an earlier day is not carried forward', () => {
    expect(dayAccount([day({ dueDate: '2026-09-20', status: 'done', completedOn: '2026-09-20' })], T).carriedForward).toBe(0);
  });
});

describe('on time', () => {
  it('⚠️ judges only work that HAD a deadline', () => {
    const r = onTime([
      { dueDate: '2026-09-05', status: 'done', completedOn: '2026-09-04' },
      { dueDate: '2026-09-05', status: 'done', completedOn: '2026-09-07' },
      /* Undated work cannot be late — counting it as on time would let somebody
         raise ten undated tasks and look perfect. */
      { dueDate: null, status: 'done', completedOn: '2026-09-04' },
      { dueDate: '2026-09-05', status: 'todo', completedOn: null },
    ]);
    expect(r).toEqual({ onTime: 1, late: 1, judged: 2 });
  });

  it('finishing on the day itself is on time', () => {
    expect(onTime([{ dueDate: '2026-09-05', status: 'done', completedOn: '2026-09-05' }]).onTime).toBe(1);
  });
});

describe('a trend', () => {
  it('⚠️ never turns a week from nothing into a percentage', () => {
    expect(trend(8, 0)).toEqual({ now: 8, before: 0, changePct: null });
  });

  it('reports the change when there is something to compare', () => {
    expect(trend(12, 8)).toEqual({ now: 12, before: 8, changePct: 50 });
    expect(trend(4, 8)).toEqual({ now: 4, before: 8, changePct: -50 });
  });
});

describe('what needs somebody today', () => {
  const NOW = Date.parse('2026-09-23T10:00:00Z');
  const T = '2026-09-23';

  it('names the reviewer’s delay in hours once it passes 48', () => {
    const a = attentionFor(
      { status: 'in_review', dueDate: null, assigneeId: 'x', statusSince: '2026-09-21T06:00:00Z' },
      NOW,
      T,
    );
    expect(a?.kind).toBe('awaiting_review');
    expect(a?.text).toContain('52h');
    expect(a?.nextAction).toBe('Review work');
  });

  it('says nothing about a review that has only just been submitted', () => {
    expect(
      attentionFor({ status: 'in_review', dueDate: null, assigneeId: 'x', statusSince: '2026-09-23T08:00:00Z' }, NOW, T),
    ).toBeNull();
  });

  it('carries the blocked reason, because "blocked" alone is not actionable', () => {
    const a = attentionFor({ status: 'blocked', dueDate: null, assigneeId: 'x', blockedReason: 'client access' }, NOW, T);
    expect(a?.text).toBe('Blocked · client access');
  });

  it('closed work never needs attention', () => {
    expect(attentionFor({ status: 'done', dueDate: '2026-01-01', assigneeId: 'x' }, NOW, T)).toBeNull();
    expect(attentionFor({ status: 'cancelled', dueDate: '2026-01-01', assigneeId: 'x' }, NOW, T)).toBeNull();
  });

  it('tells overdue and due-today apart', () => {
    expect(attentionFor({ status: 'todo', dueDate: '2026-09-20', assigneeId: 'x' }, NOW, T)?.kind).toBe('overdue');
    expect(attentionFor({ status: 'todo', dueDate: T, assigneeId: 'x' }, NOW, T)?.kind).toBe('due_today');
  });

  it('and flags work nobody has picked up', () => {
    expect(attentionFor({ status: 'todo', dueDate: null, assigneeId: null }, NOW, T)?.kind).toBe('unassigned');
  });
});
