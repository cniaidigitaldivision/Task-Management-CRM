import {
  PRIORITY_WEIGHT,
  STATUS_META,
  type Priority,
  type Role,
  type TaskStatus,
} from './constants';

/* ============================================================================
 * TASK STATE MACHINE — doc 05 §2 as data
 * ----------------------------------------------------------------------------
 * LAYER 2. Pure: no database, no clock, no framework.
 *
 * Doc 05 §2 ends with a sentence that decides this file's whole shape:
 *
 *     "Anything not in this table is not permitted and the UI will not offer it."
 *
 * A closed set, not an open one. So the table below is the *allowlist*, and
 * `canTransition()` returns false for anything absent. The alternative — a list
 * of forbidden moves — fails the moment somebody adds a ninth status, because a
 * status nobody wrote a rule about would silently be able to go anywhere.
 *
 * ── WHY THE RULES ARE NOT IN THE COMPONENT THAT DRAWS THE BOARD ──────────────
 * The board offers a drag from column to column; the task detail offers a
 * dropdown; a bulk action offers "mark these done". Three call sites. If the
 * rules lived in the board, the other two would be free of them — and a
 * requirement like BR-002 ("the assignee cannot approve their own work") would
 * hold in the place it was written and nowhere else.
 *
 * ── THE ONE RULE THAT IS NOT ABOUT ROLES ─────────────────────────────────────
 * BR-002 is about *identity*, not rank. An Admin may approve work — unless the
 * work is theirs. `evaluateTransition` therefore takes the actor AND the task's
 * assignee, and no amount of privilege satisfies it. It is the only rule here
 * that a Super Admin cannot override, and that is deliberate: a reviewer who can
 * approve their own submission is not a reviewer.
 * ========================================================================= */

/** Who may perform a transition, in the vocabulary of doc 05 §2's table. */
export type TransitionActor =
  /** The person the task is assigned to. */
  | 'assignee'
  /** Team Coordinator and above. */
  | 'coordinator'
  /** Admin and above. */
  | 'admin'
  /** The person who raised the task — only relevant for Any → Cancelled. */
  | 'creator';

export interface TransitionRule {
  readonly to: TaskStatus;
  /** Any one of these is sufficient. */
  readonly allow: readonly TransitionActor[];
  /** A written reason must accompany the change. FR-043. */
  readonly requiresReason?: boolean;
  /** BR-002 — the assignee may never be the one who performs it. */
  readonly forbidsAssignee?: boolean;
  /** Shown in the UI before the move, and logged after it. */
  readonly note?: string;
}

/* Read this as doc 05 §2's table, row for row. Where the document says
 * "Assignee, Lead, Admin+", `admin` is implied by `coordinator` at the check —
 * ranks are compared, not enumerated, so an Admin satisfies a coordinator
 * requirement without every row having to say so twice. */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TransitionRule[]>> = {
  backlog: [
    { to: 'todo', allow: ['assignee', 'coordinator'], note: 'Needs an assignee and an estimate' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  todo: [
    { to: 'in_progress', allow: ['assignee', 'coordinator'] },
    { to: 'backlog', allow: ['coordinator'], note: 'Deprioritised' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  in_progress: [
    { to: 'blocked', allow: ['assignee', 'coordinator'], requiresReason: true },
    { to: 'in_review', allow: ['assignee', 'coordinator'] },
    { to: 'todo', allow: ['assignee', 'coordinator'] },
    { to: 'backlog', allow: ['coordinator'], note: 'Deprioritised' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  blocked: [
    { to: 'in_progress', allow: ['assignee', 'coordinator'], note: 'Clears the blocked reason' },
    { to: 'backlog', allow: ['coordinator'], note: 'Deprioritised' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  in_review: [
    /* ── BR-002, the rule this file exists for ──────────────────────────────
       Approval and rejection are BOTH reviewer-only, and both forbid the
       assignee. Forbidding only approval would leave the obvious hole: send it
       back to yourself with an empty note, then approve the resubmission. */
    {
      to: 'done',
      allow: ['coordinator'],
      forbidsAssignee: true,
      note: 'Approving releases the load and stamps completion',
    },
    {
      to: 'revisions',
      allow: ['coordinator'],
      forbidsAssignee: true,
      requiresReason: true,
      note: 'Say what needs changing — the reason is the brief',
    },
    { to: 'cancelled', allow: ['coordinator'], requiresReason: true },
  ],

  revisions: [
    { to: 'in_progress', allow: ['assignee', 'coordinator'] },
    { to: 'in_review', allow: ['assignee', 'coordinator'], note: 'Resubmit' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  /* Reopening is Admin-only and is logged as a reopen, because it changes an
     on-time metric that has already been reported. */
  done: [
    { to: 'in_progress', allow: ['admin'], note: 'Reopen — affects on-time metrics' },
  ],

  /* A cancelled task is not resurrected. Raise a new one; the history of what
     was dropped and why stays intact. */
  cancelled: [],
} as const;

export interface TransitionContext {
  readonly actorRole: Role;
  readonly actorId: string;
  readonly assigneeId: string | null;
  readonly createdById: string;
  /** Trimmed. Presence, not length, is what `requiresReason` tests. */
  readonly reason?: string;
}

export type TransitionVerdict =
  | { readonly ok: true; readonly rule: TransitionRule }
  | { readonly ok: false; readonly code: TransitionRefusal; readonly message: string };

export type TransitionRefusal =
  | 'not_allowed'
  | 'same_status'
  | 'insufficient_role'
  | 'own_work'
  | 'reason_required';

const RANK: Readonly<Record<Role, number>> = {
  super_admin: 4,
  admin: 3,
  team_coordinator: 2,
  member: 1,
};

function satisfies(actor: TransitionActor, ctx: TransitionContext): boolean {
  switch (actor) {
    case 'assignee':
      return ctx.assigneeId !== null && ctx.assigneeId === ctx.actorId;
    case 'coordinator':
      return RANK[ctx.actorRole] >= RANK.team_coordinator;
    case 'admin':
      return RANK[ctx.actorRole] >= RANK.admin;
    case 'creator':
      return ctx.createdById === ctx.actorId;
    default:
      /* An unknown actor kind means someone added a vocabulary word and did not
         teach this function about it. Refuse. */
      return false;
  }
}

/**
 * The one place a status change is judged.
 *
 * Returns a *reason* for refusal, not a bare false. The UI needs to say "only a
 * reviewer can approve this" rather than greying out a control with no
 * explanation — an interface that silently refuses teaches people that it is
 * broken.
 */
export function evaluateTransition(
  from: TaskStatus,
  to: TaskStatus,
  ctx: TransitionContext,
): TransitionVerdict {
  if (from === to) {
    return { ok: false, code: 'same_status', message: 'The task is already in that status.' };
  }

  const rule = TRANSITIONS[from]?.find((r) => r.to === to);
  if (!rule) {
    return {
      ok: false,
      code: 'not_allowed',
      message: `${STATUS_META[from].label} cannot move directly to ${STATUS_META[to].label}.`,
    };
  }

  /* BR-002 first. It outranks everything, including a Super Admin's authority,
     so checking it before the role test means the refusal message is the true
     reason rather than an incidental one. */
  if (rule.forbidsAssignee && ctx.assigneeId !== null && ctx.assigneeId === ctx.actorId) {
    return {
      ok: false,
      code: 'own_work',
      message: 'You cannot review your own work — somebody else has to approve it.',
    };
  }

  if (!rule.allow.some((actor) => satisfies(actor, ctx))) {
    return {
      ok: false,
      code: 'insufficient_role',
      message: `You do not have permission to move this to ${STATUS_META[to].label}.`,
    };
  }

  if (rule.requiresReason && !(ctx.reason ?? '').trim()) {
    return {
      ok: false,
      code: 'reason_required',
      message: `Moving to ${STATUS_META[to].label} requires a written reason.`,
    };
  }

  return { ok: true, rule };
}

/** Convenience for the UI: which columns should this card be draggable to? */
export function allowedTransitions(from: TaskStatus, ctx: TransitionContext): TaskStatus[] {
  return (TRANSITIONS[from] ?? [])
    .filter((rule) => evaluateTransition(from, rule.to, { ...ctx, reason: 'x' }).ok)
    .map((rule) => rule.to);
}

export function transitionNeedsReason(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.find((r) => r.to === to)?.requiresReason === true;
}

/* ==========================================================================
 * LOAD — doc 06 §2 step 1
 * ==========================================================================
 * Here rather than in workload.ts because it is a property of a single task,
 * and the board colours a card by it without knowing anything about a person.
 * Deliberately not stored on the row: it is a function of three columns, and a
 * stored copy would need every status change and every priority edit to
 * remember to recompute it. */
export function taskLoad(input: {
  effortPoints: number;
  priority: Priority;
  status: TaskStatus;
}): number {
  return (
    input.effortPoints * PRIORITY_WEIGHT[input.priority] * STATUS_META[input.status].loadWeight
  );
}

/** Statuses that represent live work. Everything else is history. */
export function isOpen(status: TaskStatus): boolean {
  const category = STATUS_META[status].category;
  return category !== 'done' && category !== 'cancelled';
}
