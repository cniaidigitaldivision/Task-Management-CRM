import { describe, expect, it } from 'vitest';

import {
  decideHandoff,
  validateChain,
  type CompletedTask,
  type HandoffChain,
  type HandoffNode,
} from '../handoff';

/* ============================================================================
 * HANDOFF CHAINS — doc 12 E-004
 * ----------------------------------------------------------------------------
 * The failure that matters here is not an exception, it is a WRONG TASK arriving
 * in somebody's queue — or the right one never arriving. Both are silent. So the
 * no-op cases are tested as carefully as the spawning ones.
 * ========================================================================= */

const EDIT = 'skill-video-edit';
const DESIGN = 'skill-design';
const ADS = 'skill-ads';

function node(position: number, skillId: string, over: Partial<HandoffNode> = {}): HandoffNode {
  return {
    id: `node-${position}`,
    position,
    skillId,
    title: position === 0 ? null : `Step ${position}`,
    description: null,
    effortPoints: position === 0 ? null : 3,
    priority: 'medium',
    dueOffsetDays: null,
    ...over,
  };
}

/** Kashif's actual pipeline: edit → design → ads. */
function chain(over: Partial<HandoffChain> = {}): HandoffChain {
  return {
    id: 'chain-1',
    name: 'Client retainer',
    projectType: 'client',
    isActive: true,
    nodes: [node(0, EDIT), node(1, DESIGN), node(2, ADS)],
    ...over,
  };
}

function task(over: Partial<CompletedTask> = {}): CompletedTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    projectType: 'client',
    handoffNodeId: null,
    skillIds: [EDIT],
    ...over,
  };
}

describe('decideHandoff — entering a chain', () => {
  it('starts the chain when a human-raised task carries the trigger skill', () => {
    const result = decideHandoff(task(), chain(), '2026-08-15');
    expect(result.kind).toBe('spawn');
    if (result.kind !== 'spawn') return;
    expect(result.spawn.nodeId).toBe('node-1');
    expect(result.spawn.skillId).toBe(DESIGN);
    expect(result.spawn.title).toBe('Step 1');
  });

  it('does nothing when the completed task does not carry the trigger skill', () => {
    const result = decideHandoff(task({ skillIds: [ADS] }), chain(), '2026-08-15');
    expect(result.kind).toBe('none');
  });

  it('does nothing when the task has no skills at all', () => {
    const result = decideHandoff(task({ skillIds: [] }), chain(), '2026-08-15');
    expect(result.kind).toBe('none');
  });
});

describe('decideHandoff — moving along a chain', () => {
  it('uses the node pointer rather than the skill, and advances exactly one step', () => {
    /* The critical case for the "match on skill" alternative I rejected: this
       task was made by step 1, so it hands to step 2 — even though it also
       carries the TRIGGER's skill, which naive matching would restart from. */
    const result = decideHandoff(
      task({ handoffNodeId: 'node-1', skillIds: [EDIT, DESIGN] }),
      chain(),
      '2026-08-15',
    );
    expect(result.kind).toBe('spawn');
    if (result.kind !== 'spawn') return;
    expect(result.spawn.nodeId).toBe('node-2');
    expect(result.spawn.skillId).toBe(ADS);
  });

  it('stops at the end of the chain instead of wrapping round', () => {
    const result = decideHandoff(task({ handoffNodeId: 'node-2' }), chain(), '2026-08-15');
    expect(result.kind).toBe('none');
  });

  it('stops when the creating node has been deleted, rather than guessing', () => {
    const result = decideHandoff(task({ handoffNodeId: 'node-deleted' }), chain(), '2026-08-15');
    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.reason).toMatch(/no longer exists/i);
  });
});

describe('decideHandoff — when nothing should happen', () => {
  it('does nothing without a chain', () => {
    expect(decideHandoff(task(), null, '2026-08-15').kind).toBe('none');
  });

  it('does nothing when the chain is switched off', () => {
    expect(decideHandoff(task(), chain({ isActive: false }), '2026-08-15').kind).toBe('none');
  });

  it('does nothing when the chain is for another project type', () => {
    const result = decideHandoff(task({ projectType: 'event' }), chain(), '2026-08-15');
    expect(result.kind).toBe('none');
  });

  it('does nothing when the chain is only a trigger with nowhere to hand off', () => {
    const result = decideHandoff(task(), chain({ nodes: [node(0, EDIT)] }), '2026-08-15');
    expect(result.kind).toBe('none');
  });

  it('refuses a next step with no title rather than creating a nameless task', () => {
    const broken = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { title: '  ' })] });
    const result = decideHandoff(task(), broken, '2026-08-15');
    expect(result.kind).toBe('none');
  });

  it('refuses a next step with no effort rather than creating unweighted work', () => {
    const broken = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { effortPoints: 0 })] });
    expect(decideHandoff(task(), broken, '2026-08-15').kind).toBe('none');
  });
});

describe('decideHandoff — the due date', () => {
  it('leaves the task undated when the node sets no offset', () => {
    const result = decideHandoff(task(), chain(), '2026-08-15');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.dueDate).toBeNull();
  });

  it('adds the offset in UTC', () => {
    const c = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { dueOffsetDays: 3 })] });
    const result = decideHandoff(task(), c, '2026-08-15');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.dueDate).toBe('2026-08-18');
  });

  it('crosses a month boundary correctly', () => {
    const c = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { dueOffsetDays: 5 })] });
    const result = decideHandoff(task(), c, '2026-08-30');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.dueDate).toBe('2026-09-04');
  });

  it('crosses a leap day correctly', () => {
    /* 2028 is a leap year. A naive +N days on a local Date would drift here. */
    const c = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { dueOffsetDays: 1 })] });
    const result = decideHandoff(task(), c, '2028-02-28');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.dueDate).toBe('2028-02-29');
  });

  it('an offset of 0 means due the same day, not undated', () => {
    const c = chain({ nodes: [node(0, EDIT), node(1, DESIGN, { dueOffsetDays: 0 })] });
    const result = decideHandoff(task(), c, '2026-08-15');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.dueDate).toBe('2026-08-15');
  });
});

describe('decideHandoff — nodes given out of order', () => {
  it('sorts by position rather than trusting the array order', () => {
    const scrambled = chain({ nodes: [node(2, ADS), node(0, EDIT), node(1, DESIGN)] });
    const result = decideHandoff(task(), scrambled, '2026-08-15');
    if (result.kind !== 'spawn') throw new Error('expected a spawn');
    expect(result.spawn.nodeId).toBe('node-1');
  });
});

describe('validateChain', () => {
  it('accepts a well-formed chain', () => {
    expect(validateChain([node(0, EDIT), node(1, DESIGN), node(2, ADS)])).toEqual([]);
  });

  it('asks for a trigger when there is nothing at all', () => {
    expect(validateChain([])).toHaveLength(1);
  });

  it('rejects a chain that is only a trigger', () => {
    const problems = validateChain([node(0, EDIT)]);
    expect(problems.some((p) => /hand off/i.test(p))).toBe(true);
  });

  it('catches a gap in the positions', () => {
    const problems = validateChain([node(0, EDIT), node(2, ADS)]);
    expect(problems.some((p) => /out of order|gaps/i.test(p))).toBe(true);
  });

  it('catches a step with no title', () => {
    const problems = validateChain([node(0, EDIT), node(1, DESIGN, { title: '' })]);
    expect(problems.some((p) => /needs a title/i.test(p))).toBe(true);
  });

  it('catches a step with no effort', () => {
    const problems = validateChain([node(0, EDIT), node(1, DESIGN, { effortPoints: null })]);
    expect(problems.some((p) => /effort/i.test(p))).toBe(true);
  });

  it('warns once when a skill repeats, not once per repeat', () => {
    const problems = validateChain([node(0, EDIT), node(1, EDIT), node(2, EDIT)]);
    expect(problems.filter((p) => /same skill/i.test(p))).toHaveLength(1);
  });
});
