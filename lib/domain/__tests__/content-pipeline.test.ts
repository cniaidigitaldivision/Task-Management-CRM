import { describe, expect, it } from 'vitest';

import {
  PIPELINE_STAGES,
  attention,
  deliveryCounts,
  mondayOf,
  pipeline,
  stageOf,
  weekOf,
  type PipelineTask,
} from '../content-pipeline';

/* ============================================================================
 * What these tests protect
 * ----------------------------------------------------------------------------
 * The project page's KPI row, pipeline and week strip are all derived from the same
 * task list. If the derivation is wrong the page shows a client's delivery
 * incorrectly — overstating it is the dangerous direction, and the `done`-without-a-
 * publish-date case is exactly where that happens.
 * ========================================================================= */

const TODAY = '2026-08-20'; // a Thursday

function task(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    id: 't1',
    title: 'A post',
    status: 'todo',
    contentKind: 'static',
    publishedOn: null,
    dueDate: null,
    dueTime: null,
    assigneeName: 'Someone',
    ...over,
  };
}

describe('stageOf', () => {
  it('maps each status to its stage', () => {
    expect(stageOf(task({ status: 'backlog' }), TODAY)).toBe('ideas');
    expect(stageOf(task({ status: 'todo' }), TODAY)).toBe('design');
    expect(stageOf(task({ status: 'in_progress' }), TODAY)).toBe('design');
    expect(stageOf(task({ status: 'blocked' }), TODAY)).toBe('design');
    expect(stageOf(task({ status: 'in_review' }), TODAY)).toBe('review');
    expect(stageOf(task({ status: 'revisions' }), TODAY)).toBe('review');
  });

  it('splits Scheduled from Published on the publish date', () => {
    expect(stageOf(task({ publishedOn: '2026-08-19' }), TODAY)).toBe('published');
    expect(stageOf(task({ publishedOn: TODAY }), TODAY)).toBe('published');
    expect(stageOf(task({ publishedOn: '2026-08-21' }), TODAY)).toBe('scheduled');
  });

  it('lets the publish date win over the status', () => {
    /* ⚠️ Order matters. A task can be in_review AND carry a publish date; once a date
       is set the schedule is the more useful truth. Checking status first would leave
       scheduled work stuck in Review for ever. */
    expect(stageOf(task({ status: 'in_review', publishedOn: '2026-08-25' }), TODAY)).toBe(
      'scheduled',
    );
    expect(stageOf(task({ status: 'backlog', publishedOn: '2026-08-01' }), TODAY)).toBe(
      'published',
    );
  });

  it('⚠️ does NOT call a finished-but-unpublished task Published', () => {
    /* The dangerous case. `status = 'done'` means the work is finished; it does not
       mean it is live. Putting it in Published would overstate delivery to a client —
       the same error the old task-completion progress bar made. */
    expect(stageOf(task({ status: 'done', publishedOn: null }), TODAY)).toBeNull();
  });

  it('excludes work that was never a deliverable', () => {
    /* A coordinator's admin task is real work but was never part of "22 assets a
       month", so it must not appear in a pipeline the client is judged by. */
    expect(stageOf(task({ contentKind: null, status: 'in_review' }), TODAY)).toBeNull();
  });

  it('excludes cancelled work', () => {
    expect(stageOf(task({ status: 'cancelled' }), TODAY)).toBeNull();
    /* Even with a publish date — a cancelled post did not go out. */
    expect(stageOf(task({ status: 'cancelled', publishedOn: '2026-08-01' }), TODAY)).toBeNull();
  });
});

describe('pipeline', () => {
  it('always returns all five stages, in order, including empty ones', () => {
    /* A pipeline that hid empty columns would change shape as work moved through it,
       and the reader would lose the ability to see where the gap is. */
    const buckets = pipeline([], TODAY);
    expect(buckets.map((b) => b.stage)).toEqual([...PIPELINE_STAGES]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('sorts tasks into their columns and counts them', () => {
    const buckets = pipeline(
      [
        task({ id: 'a', status: 'backlog' }),
        task({ id: 'b', status: 'backlog' }),
        task({ id: 'c', status: 'in_progress' }),
        task({ id: 'd', status: 'in_review' }),
        task({ id: 'e', publishedOn: '2026-08-30' }),
        task({ id: 'f', publishedOn: '2026-08-01' }),
        task({ id: 'g', contentKind: null }),
        task({ id: 'h', status: 'cancelled' }),
      ],
      TODAY,
    );
    const by = (s: string) => buckets.find((b) => b.stage === s)!;
    expect(by('ideas').count).toBe(2);
    expect(by('design').count).toBe(1);
    expect(by('review').count).toBe(1);
    expect(by('scheduled').count).toBe(1);
    expect(by('published').count).toBe(1);
    /* The two excluded tasks appear nowhere. */
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(6);
  });
});

describe('deliveryCounts', () => {
  const MONTH = '2026-08-01';

  it('counts published for THIS MONTH only', () => {
    /* ⚠️ The pipeline's Published column counts everything ever; this card is headed
       "assets this month". They legitimately differ and must not be conflated. */
    const counts = deliveryCounts(
      [
        task({ id: 'a', publishedOn: '2026-08-05' }),
        task({ id: 'b', publishedOn: '2026-08-19' }),
        task({ id: 'c', publishedOn: '2026-07-31' }), // last month
      ],
      22,
      MONTH,
      TODAY,
    );
    expect(counts.published).toBe(2);
  });

  it('excludes next month from this month', () => {
    const counts = deliveryCounts([task({ publishedOn: '2026-09-01' })], 22, MONTH, TODAY);
    expect(counts.published).toBe(0);
    /* It is scheduled, though. */
    expect(counts.scheduled).toBe(1);
  });

  it('handles December rolling into January', () => {
    /* The month bound is built from parts; a naive month + 1 would produce '2026-13'. */
    const counts = deliveryCounts(
      [task({ publishedOn: '2026-12-31' }), task({ publishedOn: '2027-01-01' })],
      10,
      '2026-12-01',
      '2027-01-15',
    );
    expect(counts.published).toBe(1);
  });

  it('computes what is remaining, and clamps at zero', () => {
    expect(deliveryCounts([], 22, MONTH, TODAY).remaining).toBe(22);
    const over = deliveryCounts(
      Array.from({ length: 25 }, (_, i) => task({ id: `t${i}`, publishedOn: '2026-08-05' })),
      22,
      MONTH,
      TODAY,
    );
    expect(over.published).toBe(25);
    expect(over.remaining).toBe(0);
  });

  it('returns null remaining when no target was agreed', () => {
    /* ⚠️ Null, not 0. "Nothing left to do" and "nothing was agreed" are different
       statements, and rule 2 of project-progress depends on the difference. */
    const counts = deliveryCounts([task({ publishedOn: '2026-08-05' })], null, MONTH, TODAY);
    expect(counts.remaining).toBeNull();
    expect(counts.target).toBeNull();
  });

  it('counts review and scheduled regardless of month', () => {
    const counts = deliveryCounts(
      [
        task({ id: 'a', status: 'in_review' }),
        task({ id: 'b', status: 'revisions' }),
        task({ id: 'c', publishedOn: '2026-12-25' }),
      ],
      22,
      MONTH,
      TODAY,
    );
    expect(counts.inReview).toBe(2);
    expect(counts.scheduled).toBe(1);
  });
});

describe('mondayOf', () => {
  it('finds the Monday of the containing ISO week', () => {
    expect(mondayOf('2026-08-20')).toBe('2026-08-17'); // Thu -> Mon
    expect(mondayOf('2026-08-17')).toBe('2026-08-17'); // Mon -> itself
  });

  it('treats Sunday as the END of its week, not the start', () => {
    /* ⚠️ ISO weeks run Monday to Sunday. JavaScript's `getUTCDay()` calls Sunday 0,
       so the naive version jumps forward a week on Sundays. */
    expect(mondayOf('2026-08-23')).toBe('2026-08-17'); // Sun -> the Mon before
  });

  it('crosses a month and a year boundary', () => {
    expect(mondayOf('2026-09-01')).toBe('2026-08-31');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weekOf', () => {
  it('lays out the week from Monday, marking today', () => {
    const week = weekOf([], TODAY, 6);
    expect(week).toHaveLength(6);
    expect(week[0]!.date).toBe('2026-08-17');
    expect(week[5]!.date).toBe('2026-08-22');
    expect(week.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY]);
  });

  it('places a task on its publish date, or its due date if unscheduled', () => {
    const week = weekOf(
      [
        task({ id: 'sched', publishedOn: '2026-08-21' }),
        task({ id: 'due', dueDate: '2026-08-18' }),
        /* Both set: the publish date wins, because that is the day it goes out. */
        task({ id: 'both', publishedOn: '2026-08-19', dueDate: '2026-08-17' }),
      ],
      TODAY,
      6,
    );
    const on = (date: string) => week.find((d) => d.date === date)!.tasks.map((t) => t.id);
    expect(on('2026-08-21')).toEqual(['sched']);
    expect(on('2026-08-18')).toEqual(['due']);
    expect(on('2026-08-19')).toEqual(['both']);
    expect(on('2026-08-17')).toEqual([]);
  });

  it('leaves out non-deliverables and cancelled work', () => {
    const week = weekOf(
      [
        task({ id: 'admin', contentKind: null, dueDate: '2026-08-18' }),
        task({ id: 'dead', status: 'cancelled', dueDate: '2026-08-18' }),
      ],
      TODAY,
      6,
    );
    expect(week.flatMap((d) => d.tasks)).toEqual([]);
  });

  it('ignores work outside the window', () => {
    const week = weekOf([task({ dueDate: '2026-09-15' })], TODAY, 6);
    expect(week.flatMap((d) => d.tasks)).toEqual([]);
  });
});

describe('attention', () => {
  it('reports nothing when there is nothing to attend to', () => {
    /* ⚠️ A panel headed "Attention Needed" listing "0 overdue items" is telling you to
       attend to nothing. Empty rows are dropped rather than shown as zeroes. */
    expect(attention([], TODAY)).toEqual([]);
  });

  it('counts overdue deliverables', () => {
    const items = attention(
      [
        task({ id: 'late', dueDate: '2026-08-10' }),
        task({ id: 'fine', dueDate: '2026-08-30' }),
        /* Scheduled work is not overdue — it has a date and is waiting for it. */
        task({ id: 'sched', dueDate: '2026-08-10', publishedOn: '2026-08-25' }),
        /* Nor is finished work. */
        task({ id: 'done', dueDate: '2026-08-10', status: 'done' }),
      ],
      TODAY,
    );
    expect(items.find((i) => i.key === 'overdue')?.count).toBe(1);
  });

  it('counts what is awaiting approval and scheduled within the week', () => {
    const items = attention(
      [
        task({ id: 'r1', status: 'in_review' }),
        task({ id: 'r2', status: 'revisions' }),
        task({ id: 's1', publishedOn: '2026-08-22' }),
        /* Far future — scheduled, but not "this week". */
        task({ id: 's2', publishedOn: '2026-10-01' }),
      ],
      TODAY,
    );
    expect(items.find((i) => i.key === 'approval')?.count).toBe(2);
    expect(items.find((i) => i.key === 'scheduled')?.count).toBe(1);
  });
});
