import { describe, expect, it } from 'vitest';

import type { TaskStatus } from '../constants';
import {
  canHaveSubtask,
  dependencyWarning,
  isSettled,
  parentCompletionWarning,
  rollUpSubtasks,
  unfinishedBlockers,
  wouldCreateCycle,
  type BlockerSummary,
  type DependencyEdge,
} from '../dependencies';

/* ============================================================================
 * DEPENDENCIES AND SUBTASKS — BR-008
 * ----------------------------------------------------------------------------
 * The cycle tests are the ones that matter. A → B → C → A is easy to build one
 * reasonable edge at a time, nothing in the schema rejects it, and the first
 * symptom is a page that never finishes loading.
 * ========================================================================= */

const blocks = (taskId: string, dependsOnTaskId: string): DependencyEdge => ({
  taskId,
  dependsOnTaskId,
  type: 'blocks',
});

describe('wouldCreateCycle', () => {
  it('refuses an edge from a task to itself', () => {
    expect(wouldCreateCycle([], 'A', 'A').wouldCycle).toBe(true);
  });

  it('allows the first edge in an empty graph', () => {
    expect(wouldCreateCycle([], 'A', 'B').wouldCycle).toBe(false);
  });

  it('refuses the direct reverse of an existing edge', () => {
    expect(wouldCreateCycle([blocks('A', 'B')], 'B', 'A').wouldCycle).toBe(true);
  });

  it('refuses a three-step loop', () => {
    const edges = [blocks('A', 'B'), blocks('B', 'C')];
    expect(wouldCreateCycle(edges, 'C', 'A').wouldCycle).toBe(true);
  });

  it('refuses a long loop', () => {
    const edges = ['B', 'C', 'D', 'E', 'F'].map((to, i) =>
      blocks(['A', 'B', 'C', 'D', 'E'][i], to),
    );
    expect(wouldCreateCycle(edges, 'F', 'A').wouldCycle).toBe(true);
  });

  it('names the path that closes the loop', () => {
    const edges = [blocks('A', 'B'), blocks('B', 'C')];
    const result = wouldCreateCycle(edges, 'C', 'A');
    expect(result.path[0]).toBe('C');
    expect(result.path[result.path.length - 1]).toBe('C');
    expect(result.path).toContain('A');
  });

  it('allows a diamond, which is not a cycle', () => {
    /* A waits on B and C; both wait on D. Perfectly ordinary, and a naive
       "have I seen this node" check without direction would reject it. */
    const edges = [blocks('A', 'B'), blocks('A', 'C'), blocks('B', 'D'), blocks('C', 'D')];
    expect(wouldCreateCycle(edges, 'A', 'D').wouldCycle).toBe(false);
  });

  it('allows a second edge between the same pair in the same direction', () => {
    expect(wouldCreateCycle([blocks('A', 'B')], 'A', 'B').wouldCycle).toBe(false);
  });

  it('ignores relates_to edges, which carry no order', () => {
    const edges: DependencyEdge[] = [{ taskId: 'A', dependsOnTaskId: 'B', type: 'relates_to' }];
    expect(wouldCreateCycle(edges, 'B', 'A').wouldCycle).toBe(false);
  });

  it('terminates on a graph that is already cyclic', () => {
    /* Written directly to the database, or predating this check. The search
       must still answer rather than hang — this test would time out if `seen`
       were removed. */
    const edges = [blocks('X', 'Y'), blocks('Y', 'X')];
    expect(() => wouldCreateCycle(edges, 'A', 'X')).not.toThrow();
    expect(wouldCreateCycle(edges, 'A', 'X').wouldCycle).toBe(false);
  });

  it('handles a wide graph without stack overflow', () => {
    const edges = Array.from({ length: 2000 }, (_, i) => blocks(`T${i}`, `T${i + 1}`));
    expect(wouldCreateCycle(edges, 'T2000', 'T0').wouldCycle).toBe(true);
  });
});

describe('unfinishedBlockers', () => {
  const summary = (id: string, status: TaskStatus): BlockerSummary => ({
    taskId: id,
    reference: `EVT-${id}`,
    title: `Task ${id}`,
    status,
  });

  const tasks = new Map<string, BlockerSummary>([
    ['B', summary('B', 'in_progress')],
    ['C', summary('C', 'done')],
    ['D', summary('D', 'cancelled')],
  ]);

  it('returns only the unsettled ones', () => {
    const edges = [blocks('A', 'B'), blocks('A', 'C'), blocks('A', 'D')];
    expect(unfinishedBlockers(edges, 'A', tasks).map((b) => b.taskId)).toEqual(['B']);
  });

  it('treats cancelled as settled — it is not coming', () => {
    expect(isSettled('cancelled')).toBe(true);
    expect(isSettled('done')).toBe(true);
    expect(isSettled('blocked')).toBe(false);
  });

  it('ignores edges belonging to another task', () => {
    const edges = [blocks('Z', 'B')];
    expect(unfinishedBlockers(edges, 'A', tasks)).toHaveLength(0);
  });

  it('ignores relates_to, which does not hold anything up', () => {
    const edges: DependencyEdge[] = [{ taskId: 'A', dependsOnTaskId: 'B', type: 'relates_to' }];
    expect(unfinishedBlockers(edges, 'A', tasks)).toHaveLength(0);
  });

  it('counts a blocker the actor cannot see, without naming it', () => {
    /* RLS hides it. Saying "1 task you cannot see" is honest and leaks nothing;
       dropping it silently would tell somebody they are clear when they are
       not. */
    const found = unfinishedBlockers([blocks('A', 'SECRET')], 'A', tasks);
    expect(found).toHaveLength(1);
    expect(found[0].title).not.toContain('SECRET');
    expect(found[0].reference).toBe('—');
  });
});

describe('dependencyWarning', () => {
  const summary = (id: string): BlockerSummary => ({
    taskId: id,
    reference: `EVT-${id}`,
    title: `Task ${id}`,
    status: 'in_progress',
  });

  it('says nothing when there is nothing to say', () => {
    expect(dependencyWarning([])).toBeNull();
  });

  it('names the single blocker', () => {
    const message = dependencyWarning([summary('1')]);
    expect(message).toContain('EVT-1');
    expect(message).toContain('warning, not a block');
  });

  it('summarises several without listing all of them', () => {
    const message = dependencyWarning(['1', '2', '3', '4', '5'].map(summary))!;
    expect(message).toContain('5 tasks');
    expect(message).toContain('and 2 more');
    expect(message).not.toContain('EVT-5');
  });
});

describe('rollUpSubtasks', () => {
  it('is zero percent for a parent with no subtasks, not a hundred', () => {
    expect(rollUpSubtasks([])).toEqual({ total: 0, done: 0, openCount: 0, percentComplete: 0 });
  });

  it('counts done against the total', () => {
    const rollup = rollUpSubtasks([
      { id: '1', status: 'done' },
      { id: '2', status: 'in_progress' },
    ]);
    expect(rollup).toMatchObject({ total: 2, done: 1, openCount: 1, percentComplete: 50 });
  });

  it('treats a cancelled subtask as settled but not done', () => {
    /* It is not an achievement and it is not outstanding. A parent held open by
       a subtask somebody deliberately cancelled would be nonsense. */
    const rollup = rollUpSubtasks([
      { id: '1', status: 'done' },
      { id: '2', status: 'cancelled' },
    ]);
    expect(rollup.done).toBe(1);
    expect(rollup.openCount).toBe(0);
    expect(rollup.percentComplete).toBe(100);
  });

  it('rounds rather than truncating', () => {
    const rollup = rollUpSubtasks([
      { id: '1', status: 'done' },
      { id: '2', status: 'done' },
      { id: '3', status: 'todo' },
    ]);
    expect(rollup.percentComplete).toBe(67);
  });
});

describe('parentCompletionWarning', () => {
  it('is silent when everything is settled', () => {
    expect(parentCompletionWarning(rollUpSubtasks([{ id: '1', status: 'done' }]))).toBeNull();
  });

  it('warns in the singular for one', () => {
    const warning = parentCompletionWarning(rollUpSubtasks([{ id: '1', status: 'todo' }]));
    expect(warning).toContain('One subtask');
  });

  it('warns with a count for several', () => {
    const warning = parentCompletionWarning(
      rollUpSubtasks([
        { id: '1', status: 'todo' },
        { id: '2', status: 'in_progress' },
      ]),
    );
    expect(warning).toContain('2 subtasks');
  });
});

describe('subtask depth', () => {
  it('allows a subtask under a top-level task', () => {
    expect(canHaveSubtask(0)).toBe(true);
  });

  it('refuses a subtask under a subtask', () => {
    /* `parent_task_id` cascades on delete, so an unbounded chain turns one
       delete into an unbounded cascade. One level is the checklist's job
       beyond. */
    expect(canHaveSubtask(1)).toBe(false);
  });
});
