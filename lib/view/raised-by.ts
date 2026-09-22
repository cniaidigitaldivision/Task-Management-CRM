/* ============================================================================
 * WHO ASKED FOR THE WORK
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"there is no option for me to see all the assigned tasks
 * … All Assigned Tasks, Any Specific Assigned Task, or Self-Created Tasks. … If
 * I say Assigned Tasks, show a further category: All Assigned Tasks or Some
 * Specific Person's Assigned Tasks."*
 *
 * The task toolbar answered *who does it* and never *who asked for it*, although
 * every row already carries the person who raised it.
 *
 * ── WHY THIS IS A FILE AND NOT THREE LINES IN THE COMPONENT ────────────────
 * Because the three cases are each other's near-misses, and getting one wrong
 * looks like working software: "assigned by me" that quietly includes my own
 * to-do list answers a different question from the one asked, and nobody would
 * notice until they counted. Out here each case has a test naming it.
 * ========================================================================= */

/** The options, in the order the control offers them. */
export type RaisedBy =
  /** Everything the person can see. */
  | 'all'
  /** I raised it and somebody ELSE does it — what I have handed out. */
  | 'by_me'
  /** I raised it and I do it — my own list. */
  | 'mine'
  /** Somebody else raised it and I do it — what has been handed to me. */
  | 'to_me';

export const RAISED_BY_OPTIONS: ReadonlyArray<{ value: RaisedBy; label: string }> = [
  { value: 'all', label: 'Anyone' },
  { value: 'by_me', label: 'Assigned by me' },
  { value: 'mine', label: 'Created by me' },
  { value: 'to_me', label: 'Assigned to me' },
];

export interface RaisedByTask {
  readonly createdById: string;
  readonly assigneeId: string | null;
}

/**
 * Does this task answer the question?
 *
 * ⚠️ `by_me` AND `mine` ARE DISJOINT, DELIBERATELY. "What did I hand out" and
 * "what am I doing" are different questions, and folding self-raised work into
 * the first would make it useless for the thing it was asked for — a manager
 * checking on the team would be reading their own to-do list back.
 *
 * ⚠️ AND UNASSIGNED WORK IS "BY ME". A task I raised and left for somebody to
 * pick up has been handed out — it just has not been caught yet. Treating it as
 * mine would hide it from the only view that asks after it.
 */
export function matchesRaisedBy(task: RaisedByTask, raisedBy: RaisedBy, viewerId: string): boolean {
  switch (raisedBy) {
    case 'all':
      return true;
    case 'by_me':
      return task.createdById === viewerId && task.assigneeId !== viewerId;
    case 'mine':
      return task.createdById === viewerId && task.assigneeId === viewerId;
    case 'to_me':
      return task.assigneeId === viewerId && task.createdById !== viewerId;
    default:
      /* An unknown option means somebody added a word to the type and not to
         this function. Show everything rather than silently emptying the board. */
      return true;
  }
}
