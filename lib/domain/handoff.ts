import type { Priority, ProjectType } from './constants';

/* ============================================================================
 * HANDOFF CHAINS — doc 12 E-004, owner rule R4a
 * ----------------------------------------------------------------------------
 * *"Kashif finishes the reel → the system automatically creates 'Schedule reel
 *  across Meta + TikTok' and assigns it to Yusra using the smart engine."*
 *
 * This module decides ONE thing: given a task that has just been completed, and
 * the chain for its project type, what — if anything — should be created next.
 *
 * ── IT IS PURE, AND THAT IS THE POINT ────────────────────────────────────────
 * No database, no clock, no assignment engine. `todayIso` is passed in, the
 * chain is passed in, and the answer is a description of a task rather than a
 * task. Everything this file decides is therefore testable by writing down an
 * input and an expected output, which is how the lockout rule, the recurrence
 * engine and the permission matrix are all tested here.
 *
 * The assignment itself is deliberately NOT here. A node stores a required
 * SKILL, and `lib/domain/recommendation.ts` already knows how to turn a skill
 * plus a team into a person — including capacity, availability and concurrency
 * limits. Reimplementing any of that would be a second scoring engine that
 * disagrees with the first one the first time somebody is on leave.
 *
 * ── WHAT A NODE CAN DO, EXHAUSTIVELY ─────────────────────────────────────────
 * Create a task. That is the whole list, and migration 026 is written so there
 * is no column in which anything else could be stored. The reference editor
 * this UI is modelled on has Shell Script and HTTP Request nodes; those are
 * arbitrary code execution and outbound SSRF, and R4a's carve-out exists to
 * keep them out. If a `command` or `url` field ever appears, this stopped being
 * the feature that was approved.
 * ========================================================================= */

export interface HandoffNode {
  readonly id: string;
  /** 0 is the trigger and creates nothing. 1..n each create one task. */
  readonly position: number;
  /** What this step needs. The engine matches a person to it. */
  readonly skillId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly effortPoints: number | null;
  readonly priority: Priority;
  /** Days after creation. NULL leaves the task undated rather than inventing one. */
  readonly dueOffsetDays: number | null;
}

export interface HandoffChain {
  readonly id: string;
  readonly name: string;
  readonly projectType: ProjectType;
  readonly isActive: boolean;
  /** Ordered by position ascending. */
  readonly nodes: readonly HandoffNode[];
}

/** The task that has just reached `done`. */
export interface CompletedTask {
  readonly id: string;
  readonly projectId: string;
  readonly projectType: ProjectType;
  /** The node that created it, if a chain did. NULL when a person raised it. */
  readonly handoffNodeId: string | null;
  /** Its tagged skills — how a human-raised task can enter a chain at the trigger. */
  readonly skillIds: readonly string[];
}

/** What the caller should create. Not a task — a description of one. */
export interface HandoffSpawn {
  readonly chainId: string;
  readonly chainName: string;
  readonly nodeId: string;
  readonly title: string;
  readonly description: string | null;
  readonly skillId: string;
  readonly effortPoints: number;
  readonly priority: Priority;
  /** ISO day, or null when the node sets no offset. */
  readonly dueDate: string | null;
}

export type HandoffDecision =
  | { readonly kind: 'spawn'; readonly spawn: HandoffSpawn }
  /** Nothing to do. `reason` is for the activity log and for explaining a no-op. */
  | { readonly kind: 'none'; readonly reason: string };

const none = (reason: string): HandoffDecision => ({ kind: 'none', reason });

/* ── UTC, for the same reason every other date in this codebase is ───────────
   A due date is a DAY. `new Date('2026-08-07')` is midnight UTC and `getDate()`
   answers in the local zone, so west of Greenwich every date lands a day early.
   That trap has already been hit twice here — the recurrence engine and the
   calendar — so this does the arithmetic in UTC milliseconds and formats by
   hand. */
function addDaysUtc(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/**
 * Decide what a completed task hands off to.
 *
 * ── HOW THE CHAIN KNOWS WHERE IT IS ──────────────────────────────────────────
 * Two ways in, and they are not interchangeable:
 *
 *   · the task was CREATED BY a node → its position is known exactly, from
 *     `tasks.handoff_node_id`. This is the normal case for steps 2..n.
 *
 *   · a person raised the task → it can only enter at the TRIGGER, and only if
 *     it carries the trigger's skill. This is how Kashif's reel — which nobody
 *     generated — starts the chain.
 *
 * Matching on skill is used ONLY for that first hop. Using it throughout would
 * misfire the moment a chain names one skill twice, or a task carries two.
 */
export function decideHandoff(
  task: CompletedTask,
  chain: HandoffChain | null,
  todayIso: string,
): HandoffDecision {
  if (!chain) return none('No chain is configured for this project type.');
  if (!chain.isActive) return none(`The ${chain.name} chain is switched off.`);
  if (chain.projectType !== task.projectType) {
    /* Defensive: the query scopes by type, so reaching here means a caller
       handed over a mismatched pair rather than that the data is wrong. */
    return none('That chain belongs to a different project type.');
  }

  const ordered = [...chain.nodes].sort((a, b) => a.position - b.position);
  if (ordered.length < 2) return none(`The ${chain.name} chain has no steps yet.`);

  let currentPosition: number;

  if (task.handoffNodeId) {
    const from = ordered.find((n) => n.id === task.handoffNodeId);
    /* The node was deleted after the task was made. `on delete set null` in
       migration 026 normally prevents this, so it means the chain was rebuilt
       under a live task. Stopping is right: guessing where it belongs could
       skip a step or repeat one. */
    if (!from) return none('The step that created this task no longer exists.');
    currentPosition = from.position;
  } else {
    const trigger = ordered[0];
    if (trigger.position !== 0) return none(`The ${chain.name} chain has no trigger step.`);
    if (!task.skillIds.includes(trigger.skillId)) {
      return none('This task does not carry the skill that starts the chain.');
    }
    currentPosition = 0;
  }

  const next = ordered.find((n) => n.position === currentPosition + 1);
  if (!next) return none(`The ${chain.name} chain ends here.`);

  /* The shape constraint in migration 026 already guarantees these for any
     position > 0. Checked anyway rather than asserted: this module is pure and
     someone will eventually call it with hand-built data in a test.
     ⚠️ TRIMMED, not just truthy — '  ' is a truthy string, so `!next.title`
     would let a whitespace-only title through and create a task with a blank
     name. The database's own constraint uses `btrim` for exactly this reason;
     this has to agree with it or the two disagree about what "has a title"
     means. Caught by a test, not by review. */
  const title = next.title?.trim() ?? '';
  if (title === '' || next.effortPoints === null || next.effortPoints <= 0) {
    return none('The next step is incomplete — it needs a title and an effort estimate.');
  }

  return {
    kind: 'spawn',
    spawn: {
      chainId: chain.id,
      chainName: chain.name,
      nodeId: next.id,
      title,
      description: next.description,
      skillId: next.skillId,
      effortPoints: next.effortPoints,
      priority: next.priority,
      dueDate:
        next.dueOffsetDays === null ? null : addDaysUtc(todayIso, next.dueOffsetDays),
    },
  };
}

/**
 * Is this chain safe to switch on?
 *
 * Used by the editor before saving, so a half-built chain cannot go live and
 * then silently create nothing — or worse, create a nameless task. Returns the
 * problems in the order somebody would fix them.
 */
export function validateChain(nodes: readonly HandoffNode[]): readonly string[] {
  const problems: string[] = [];
  const ordered = [...nodes].sort((a, b) => a.position - b.position);

  if (ordered.length === 0) {
    problems.push('Add a trigger step to start the chain.');
    return problems;
  }
  if (ordered[0].position !== 0) problems.push('The chain needs a trigger step.');
  if (ordered.length < 2) problems.push('Add at least one step for the trigger to hand off to.');

  ordered.forEach((node, index) => {
    if (node.position !== index) {
      problems.push(`Step ${index + 1} is out of order — positions must run 0, 1, 2 with no gaps.`);
    }
    if (node.position > 0) {
      if (!node.title || node.title.trim() === '') {
        problems.push(`Step ${node.position} needs a title.`);
      }
      if (node.effortPoints === null || node.effortPoints <= 0) {
        problems.push(`Step ${node.position} needs an effort estimate above zero.`);
      }
    }
  });

  /* A chain that names the same skill twice cannot be reasoned about by a
     reader — "which of these two does my task match?" — even though the
     position pointer means the ENGINE never has to guess. Flagged rather than
     refused: it is a smell, not a contradiction. */
  const seen = new Set<string>();
  for (const node of ordered) {
    if (seen.has(node.skillId)) {
      problems.push('The same skill appears twice — that makes the chain hard to follow.');
      break;
    }
    seen.add(node.skillId);
  }

  return problems;
}
