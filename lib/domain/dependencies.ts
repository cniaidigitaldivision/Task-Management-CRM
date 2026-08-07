import { STATUS_META, type TaskStatus } from './constants';

/* ============================================================================
 * DEPENDENCIES AND SUBTASKS — BR-008, doc 05
 * ----------------------------------------------------------------------------
 * Two different relationships that people constantly conflate, kept separate
 * here because they behave differently:
 *
 *   A DEPENDENCY is about ORDER.      "Edit cannot start until Shoot finishes."
 *   A SUBTASK is about DECOMPOSITION. "Edit is part of Showreel."
 *
 * A dependency does not make one task part of another, and a subtask does not
 * impose an order — two subtasks of the same parent may run at the same time.
 * Storing them in one table, as several tools do, forces both to behave the
 * same way and neither ends up right.
 *
 * ── BR-008 WARNS, IT DOES NOT BLOCK ──────────────────────────────────────────
 * Starting a task whose blocker is unfinished produces a warning, not a
 * refusal. The rule exists because people genuinely do start the edit while the
 * last shot is still rendering, and that is often correct. A hard block would
 * teach them to delete the dependency rather than record the reality, and then
 * the graph — the thing the warning is drawn from — becomes fiction.
 * ========================================================================= */

export type DependencyType = 'blocks' | 'relates_to';

export interface DependencyEdge {
  /** The task that is held up. */
  readonly taskId: string;
  /** The task it is waiting on. */
  readonly dependsOnTaskId: string;
  readonly type: DependencyType;
}

/** The statuses that mean a blocker is out of the way. */
const SETTLED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled']);

export function isSettled(status: TaskStatus): boolean {
  return SETTLED.has(status);
}

/* ==========================================================================
 * CYCLES
 * ========================================================================== */

export interface CycleResult {
  readonly wouldCycle: boolean;
  /** The path that closes the loop, for a message somebody can act on. */
  readonly path: readonly string[];
}

/**
 * Would adding `taskId depends on dependsOnTaskId` create a loop?
 *
 * ── WHY THIS IS NOT OPTIONAL ─────────────────────────────────────────────────
 * A → B → C → A is trivially easy to build one edge at a time, with three
 * different people each adding something reasonable. Nothing rejects it at the
 * database level: `task_dependencies` forbids only the self-edge. Once it
 * exists, every "what is blocking this?" walk runs forever, and the first thing
 * anybody notices is the page not loading.
 *
 * The search runs FORWARD from the proposed blocker along the blocks-edges,
 * looking for the task being blocked. If the blocker already waits on the task
 * — directly or through any chain — the new edge closes the loop.
 *
 * `relates_to` edges are excluded: they carry no ordering, so they cannot form
 * a deadlock, and treating them as if they did would refuse perfectly sensible
 * cross-references.
 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  dependsOnTaskId: string,
): CycleResult {
  if (taskId === dependsOnTaskId) {
    return { wouldCycle: true, path: [taskId, taskId] };
  }

  const blockers = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type !== 'blocks') continue;
    blockers.set(edge.taskId, [...(blockers.get(edge.taskId) ?? []), edge.dependsOnTaskId]);
  }

  /* Depth-first from the proposed blocker. `seen` is what makes this terminate
     even if the graph is ALREADY cyclic — which it can be, if a cycle predates
     this check or was written directly to the database. */
  const seen = new Set<string>();
  const stack: Array<{ node: string; path: string[] }> = [
    { node: dependsOnTaskId, path: [taskId, dependsOnTaskId] },
  ];

  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === taskId) return { wouldCycle: true, path };
    if (seen.has(node)) continue;
    seen.add(node);

    for (const next of blockers.get(node) ?? []) {
      stack.push({ node: next, path: [...path, next] });
    }
  }

  return { wouldCycle: false, path: [] };
}

/* ==========================================================================
 * WHAT IS HOLDING THIS UP
 * ========================================================================== */

export interface BlockerSummary {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
}

/**
 * The blockers of `taskId` that have not finished yet.
 *
 * Only direct edges. A transitive walk would be more complete and much less
 * useful: being told the eleven things somewhere upstream is noise when the one
 * actionable fact is "Shoot is still In Progress".
 */
export function unfinishedBlockers(
  edges: readonly DependencyEdge[],
  taskId: string,
  tasksById: ReadonlyMap<string, BlockerSummary>,
): BlockerSummary[] {
  const out: BlockerSummary[] = [];
  for (const edge of edges) {
    if (edge.taskId !== taskId || edge.type !== 'blocks') continue;
    const blocker = tasksById.get(edge.dependsOnTaskId);
    /* Absent means invisible to this actor under RLS, not missing. Saying
       "1 task you cannot see is blocking this" leaks less than naming it and is
       still honest, so it is counted as a blocker without a name. */
    if (!blocker) {
      out.push({
        taskId: edge.dependsOnTaskId,
        reference: '—',
        title: 'A task you cannot see',
        status: 'todo',
      });
      continue;
    }
    if (!isSettled(blocker.status)) out.push(blocker);
  }
  return out;
}

/** BR-008. Null when there is nothing to say — never an empty string. */
export function dependencyWarning(blockers: readonly BlockerSummary[]): string | null {
  if (blockers.length === 0) return null;

  if (blockers.length === 1) {
    const [only] = blockers;
    return `${only.reference} “${only.title}” is still ${STATUS_META[only.status].label.toLowerCase()}. You can start anyway — this is a warning, not a block.`;
  }

  const named = blockers
    .slice(0, 3)
    .map((b) => b.reference)
    .join(', ');
  const rest = blockers.length > 3 ? ` and ${blockers.length - 3} more` : '';
  return `${blockers.length} tasks this depends on are unfinished (${named}${rest}). You can start anyway — this is a warning, not a block.`;
}

/* ==========================================================================
 * SUBTASKS
 * ========================================================================== */

export interface SubtaskSummary {
  readonly id: string;
  readonly status: TaskStatus;
}

export interface SubtaskRollup {
  readonly total: number;
  readonly done: number;
  readonly openCount: number;
  /** 0–100. 100 with a total of 0 would be a lie, so an empty parent is 0. */
  readonly percentComplete: number;
}

export function rollUpSubtasks(subtasks: readonly SubtaskSummary[]): SubtaskRollup {
  const total = subtasks.length;
  const done = subtasks.filter((s) => s.status === 'done').length;
  /* Cancelled subtasks are not "done", but they are also not outstanding — a
     parent held open by a subtask somebody explicitly cancelled would be
     nonsense. They are excluded from both sides. */
  const openCount = subtasks.filter((s) => !isSettled(s.status)).length;
  const settled = subtasks.filter((s) => isSettled(s.status)).length;

  return {
    total,
    done,
    openCount,
    percentComplete: total === 0 ? 0 : Math.round((settled / total) * 100),
  };
}

/**
 * May this parent be marked done while subtasks are still open?
 *
 * Yes, with a warning — the same reasoning as BR-008. A parent is a container
 * somebody chose to draw, and the person closing it can see the children. What
 * matters is that nobody closes one by accident and leaves three tasks orphaned
 * in a list nobody opens again.
 */
export function parentCompletionWarning(rollup: SubtaskRollup): string | null {
  if (rollup.openCount === 0) return null;
  return rollup.openCount === 1
    ? 'One subtask is still open. Closing the parent will not close it.'
    : `${rollup.openCount} subtasks are still open. Closing the parent will not close them.`;
}

/**
 * Depth. Not a taste question — `parent_task_id` is self-referential with
 * ON DELETE CASCADE, so a deep chain turns one delete into an unbounded
 * cascade, and every recursive read has to walk it.
 *
 * One level of nesting is what a checklist is for beyond; doc 05 §5 already
 * suggests splitting an XL task into subtasks, not into a tree.
 */
export const MAX_SUBTASK_DEPTH = 1;

export function canHaveSubtask(parentDepth: number): boolean {
  return parentDepth < MAX_SUBTASK_DEPTH;
}
