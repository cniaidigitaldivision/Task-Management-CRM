import { describe, expect, it } from 'vitest';

import {
  canChangeStatus,
  canComplete,
  dailyBoard,
  dailyState,
  isDailyDeliverable,
  type DailyTask,
} from '../daily';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * Two owner rules, both of which are easy to implement as a LABEL and wrong that
 * way:
 *
 *   1. "Once 12 pm has gone, that task would be considered incomplete." A missed
 *      day must stop being fillable, not merely look different. If it can still
 *      be ticked a week later, the monthly delivery figures stop meaning
 *      anything — and they are what a client is shown.
 *
 *   2. "Nobody can undo it… the status would not be changed once it's done."
 *      Not the author, not an Admin. Asked directly and answered directly.
 * ========================================================================= */

const TODAY = '2026-08-22';

const post = (over: Partial<DailyTask> = {}): DailyTask => ({
  id: 't1',
  status: 'todo',
  dueDate: TODAY,
  contentKind: 'static',
  ...over,
});

describe('isDailyDeliverable', () => {
  it('accepts a dated post', () => {
    expect(isDailyDeliverable(post())).toBe(true);
    expect(isDailyDeliverable(post({ contentKind: 'reel' }))).toBe(true);
  });

  it('rejects work with no publishing day', () => {
    expect(isDailyDeliverable(post({ dueDate: null }))).toBe(false);
  });

  it('rejects work that is not a deliverable at all', () => {
    expect(isDailyDeliverable(post({ contentKind: null }))).toBe(false);
  });

  it('rejects website work and reports, which have no post to link', () => {
    /* They are real work and belong on the task list — just not on a board whose
       whole purpose is pasting the link to what went out. */
    expect(isDailyDeliverable(post({ contentKind: 'website' }))).toBe(false);
    expect(isDailyDeliverable(post({ contentKind: 'report' }))).toBe(false);
  });
});

describe('dailyState', () => {
  it('is pending on its own day', () => {
    expect(dailyState(post(), TODAY)).toBe('pending');
  });

  it('is upcoming before its day', () => {
    expect(dailyState(post({ dueDate: '2026-08-25' }), TODAY)).toBe('upcoming');
  });

  it('is missed after its day', () => {
    expect(dailyState(post({ dueDate: '2026-08-21' }), TODAY)).toBe('missed');
  });

  it('is done whatever the date, including long after', () => {
    expect(dailyState(post({ status: 'done', dueDate: '2026-07-01' }), TODAY)).toBe('done');
  });
});

describe('canComplete — the midnight cutoff', () => {
  it('allows it all day on the day itself', () => {
    expect(canComplete(post(), TODAY)).toBe(true);
  });

  it('refuses it the day after — the day is blank and stays blank', () => {
    /* The rule with teeth. Without this, "missed" is a colour somebody can clear
       by ticking a box, and a client report can be back-filled to look complete. */
    expect(canComplete(post({ dueDate: '2026-08-21' }), TODAY)).toBe(false);
  });

  it('refuses it before the day arrives', () => {
    expect(canComplete(post({ dueDate: '2026-08-23' }), TODAY)).toBe(false);
  });

  it('refuses a second completion, so the first person keeps the credit', () => {
    expect(canComplete(post({ status: 'done' }), TODAY)).toBe(false);
  });
});

describe('canChangeStatus — done is final', () => {
  it('allows a change while the work is open', () => {
    expect(canChangeStatus(post())).toBe(true);
    expect(canChangeStatus(post({ status: 'in_progress' }))).toBe(true);
  });

  it('refuses any change once done, for everybody', () => {
    /* Owner, asked whether a Coordinator or Admin should be able to reopen it:
       "definitely nobody can undo it." */
    expect(canChangeStatus(post({ status: 'done' }))).toBe(false);
  });
});

describe('dailyBoard', () => {
  const tasks: DailyTask[] = [
    post({ id: 'a', dueDate: TODAY }),
    post({ id: 'b', dueDate: TODAY, status: 'done' }),
    post({ id: 'c', dueDate: '2026-08-20' }),
    post({ id: 'd', dueDate: '2026-08-19', status: 'done' }),
    post({ id: 'e', dueDate: '2026-08-25' }),
    post({ id: 'f', dueDate: TODAY, contentKind: 'website' }),
    post({ id: 'g', dueDate: '2026-08-01' }),
  ];

  const board = dailyBoard(tasks, TODAY, '2026-08-16');

  it('puts today’s unfilled posts in pending', () => {
    expect(board.pending.map((t) => t.id)).toEqual(['a']);
  });

  it('shows only today’s completions, not every post ever', () => {
    /* 'd' is done but from three days ago — it belongs to that day's board, not
       to a running archive on this one. */
    expect(board.done.map((t) => t.id)).toEqual(['b']);
  });

  it('reaches back for missed days, so a blank Monday is visible on Wednesday', () => {
    expect(board.missed.map((t) => t.id)).toEqual(['c']);
  });

  it('does not reach back past the window', () => {
    expect(board.missed.map((t) => t.id)).not.toContain('g');
  });

  it('leaves website work off the board entirely', () => {
    const all = [...board.pending, ...board.done, ...board.missed].map((t) => t.id);
    expect(all).not.toContain('f');
  });

  it('leaves upcoming days off today’s board', () => {
    const all = [...board.pending, ...board.done, ...board.missed].map((t) => t.id);
    expect(all).not.toContain('e');
  });
});
