import {
  CONTENT_KIND_LABEL,
  PRIORITY_WEIGHT,
  PUBLISH_PROOF_KINDS,
  STATUS_META,
  type ContentKind,
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
 * ── THE TWO RULES THAT ARE NOT ABOUT ROLES ───────────────────────────────────
 * BR-002 is about *identity*, not rank. An Admin may approve work — unless the
 * work is theirs. `evaluateTransition` therefore takes the actor AND the task's
 * assignee, and no amount of privilege satisfies it: a reviewer who can approve
 * their own submission is not a reviewer.
 *
 * The publish gate (added 2026-08-24) is about *evidence*. A static post or a
 * reel cannot enter Done until a placement carries a link, whoever is asking —
 * because an Admin marking an unpublished post as done produces exactly the
 * delivery figure a client is shown and cannot check. See the check at the foot
 * of `evaluateTransition` and `PUBLISH_PROOF_KINDS` in ./constants.ts.
 *
 * Both are rules a Super Admin cannot override, and that is deliberate.
 *
 * ── ⚠️ WHO CLOSES A TASK — REVISED 2026-08-24 ────────────────────────────────
 * Owner:
 *
 *   *"If a team member created his task, he is showing its status and then he
 *   does it. He knows that it's done, right? If … the team coordinator Kashif
 *   creates or raises some task and assigns it to some team member, the team
 *   member can only put it in Review. Kashif … can only move that task to Done
 *   because it was raised by him. Tasks that are created by a team member
 *   themselves can be moved to any status."*
 *
 * So closing a task belongs to WHOEVER RAISED IT, not to whoever outranks the
 * room. Before this, `in_review → done` was `['coordinator']` plus
 * `forbidsAssignee`, which produced the complaint exactly: a Member could not
 * complete even a task they had invented for themselves, because they were not
 * a Coordinator and they were the assignee.
 *
 * ⚠️ AND IT NARROWS BR-002 RATHER THAN BREAKING IT. Read the rule again — its
 * point is separating the person who ASKED for the work from the person who DID
 * it. Delegated work still gets a second pair of eyes, and no privilege buys a
 * way around it. But when you raised the task yourself there is no second party
 * to protect: the requester and the doer are the same person by construction,
 * and refusing them is not a control, it is a dead end. So the assignee bar now
 * lifts for the creator, and only for the creator.
 *
 * The consequence worth stating plainly: a Coordinator who raises a task and
 * assigns it to themselves can now approve it. That is the cost of the carve-out
 * and it is accepted knowingly — anybody senior enough to assign their own work
 * could already have reassigned it to get the same result, so the rule was
 * costing honest people friction while stopping nobody determined.
 * ========================================================================= */

/** Who may perform a transition, in the vocabulary of doc 05 §2's table. */
export type TransitionActor =
  /** The person the task is assigned to. */
  | 'assignee'
  /** Team Coordinator and above. */
  | 'coordinator'
  /** Admin and above. */
  | 'admin'
  /**
   * The person who raised the task.
   *
   * ⚠️ Was "only relevant for Any → Cancelled". Since 2026-08-24 it also decides
   * who may close a task — see the header. Whoever asked for the work signs it
   * off, which for a self-raised task is the person doing it.
   */
  | 'creator';

export interface TransitionRule {
  readonly to: TaskStatus;
  /** Any one of these is sufficient. */
  readonly allow: readonly TransitionActor[];
  /** A written reason must accompany the change. FR-043. */
  readonly requiresReason?: boolean;
  /**
   * BR-002 — the assignee may not be the one who performs it.
   *
   * ⚠️ EXCEPT WHEN THE ASSIGNEE ALSO RAISED THE TASK. The rule separates the
   * requester from the doer; where they are the same person by construction
   * there is nothing to separate, and enforcing it only blocks somebody from
   * finishing their own to-do item. See the header, and `satisfies`/the check in
   * `evaluateTransition`.
   */
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
    /* ── ⚠️ STRAIGHT TO REVIEW, ADDED 2026-09-02 ────────────────────────────
       Owner, on the daily content board: *"if I move it to Review and if I skip
       the In Progress part, it should be working, right?"* It was not — To Do
       reached In Progress, Backlog, Done or Cancelled, and Review was
       unreachable without passing through In Progress first.

       For a static post or a reel that is ceremony with no information in it:
       the work is done in Canva and on the platform, not in this tool, so "In
       Progress" is a state nobody was ever going to sit in. Publishing submits
       the work, and submitting means Review.

       Allowed for the assignee — which, since 083, is whoever pasted the live
       link — or any Coordinator. NOT the creator as such: this is submitting
       work, not signing it off, and the sign-off rule lives on in_review below
       where it forbids the assignee. */
    { to: 'in_review', allow: ['assignee', 'coordinator'] },
    { to: 'backlog', allow: ['coordinator'], note: 'Deprioritised' },
    /* ⚠️ Straight to Done, and only for the person who raised it — owner,
       2026-08-24: *"Tasks that are created by a team member themselves can be
       moved to any status."* Routing a personal to-do through In Progress and
       Review so its author can approve their own submission is ceremony that
       teaches people the tool is in the way. No review step, because there is
       nobody to review it for. */
    { to: 'done', allow: ['creator'], note: 'Your own task — no review needed' },
    { to: 'cancelled', allow: ['coordinator', 'creator'], requiresReason: true },
  ],

  in_progress: [
    { to: 'blocked', allow: ['assignee', 'coordinator'], requiresReason: true },
    { to: 'in_review', allow: ['assignee', 'coordinator'] },
    { to: 'todo', allow: ['assignee', 'coordinator'] },
    { to: 'backlog', allow: ['coordinator'], note: 'Deprioritised' },
    /* Same carve-out as `todo → done`. Note this also lets a Coordinator close
       work they raised and delegated without a review pass — the requester
       saying "this is fine" is what approval means, and they are the requester. */
    { to: 'done', allow: ['creator'], note: 'Raised by you — close it directly' },
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
    /* ⚠️ `creator` first, and it is what fixes the owner's report: whoever
       raised the task approves it. A Coordinator who raised nothing here still
       qualifies on rank — somebody has to be able to close work when the person
       who asked for it is on leave. */
    {
      to: 'done',
      allow: ['creator', 'coordinator'],
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

  /* ── WHAT THE DELIVERABLE IS, AND WHETHER IT IS DEMONSTRABLY LIVE ──────────
     Both optional, and that is a decision rather than convenience. Three of the
     four call sites ask about moves that have nothing to do with publishing —
     "can this start?", "can this be blocked?" — and forcing them to supply a
     content kind they do not need would be ceremony. Absent means "no proof
     required", which is the correct answer for the whole of non-content work.

     ⚠️ A caller that CAN reach a `→ done` move must pass both. Omitting them
     there does not fail loudly; it silently waves the post through. The two
     places that matter are `changeStatusAction` and the board's `canMove`, and
     both are covered by tests naming this risk. */
  /** Null for work that is not a deliverable — a coordinator's admin task. */
  readonly contentKind?: ContentKind | null;
  /** Placements carrying a URL. `TaskRow.placementLiveCount` is exactly this. */
  readonly placementUrlCount?: number;
}

export type TransitionVerdict =
  | { readonly ok: true; readonly rule: TransitionRule }
  | { readonly ok: false; readonly code: TransitionRefusal; readonly message: string };

export type TransitionRefusal =
  | 'not_allowed'
  | 'same_status'
  | 'insufficient_role'
  | 'own_work'
  | 'reason_required'
  | 'publish_proof_required';

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
     reason rather than an incidental one.

     ⚠️ `&& !isCreator` since 2026-08-24 — the carve-out described in the header.
     The rule separates the person who asked for the work from the person who did
     it; when you raised it yourself there are not two people to separate, and
     the bar was stopping somebody completing their own to-do item. Delegated
     work is untouched: if somebody else raised it, being the assignee still
     disqualifies you from approving it, at every rank. */
  const isAssignee = ctx.assigneeId !== null && ctx.assigneeId === ctx.actorId;
  const isCreator = ctx.createdById === ctx.actorId;

  if (rule.forbidsAssignee && isAssignee && !isCreator) {
    return {
      ok: false,
      code: 'own_work',
      /* Names the person who can, rather than only the person who cannot — the
         previous wording ("somebody else has to approve it") left the assignee
         guessing who to chase. */
      message:
        'You cannot approve work somebody else asked you to do — whoever raised this task has to close it.',
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

  /* ── ⚠️ A STATIC POST OR A REEL IS CLOSED BY A LINK, NOT BY A CLAIM ────────
     Owner, 2026-08-24: *"it cannot be marked as done unless he says he has
     published the static post and pastes the URL of that post. Until then that
     task will not be moved to the done category."*

     ── WHY THIS IS LAST, AFTER THE ROLE AND REASON CHECKS ────────────────────
     The other refusals are about authority; this one is about evidence. Somebody
     with no business closing the task should be told THAT, not sent off to fetch
     a link they were never going to be allowed to use. So the checks run in the
     order a person can act on them: may you close this at all, then have you
     shown that it went out.

     ── AND NO RANK BUYS PAST IT ──────────────────────────────────────────────
     Like BR-002, deliberately not role-gated. An Admin marking an unpublished
     post as done produces exactly the number a client is shown and cannot
     verify, which is the failure this exists to prevent. `PUBLISH_PROOF_KINDS`
     is the whole scope — everything else reaches this line and passes. */
  if (
    STATUS_META[to].category === 'done' &&
    ctx.contentKind != null &&
    PUBLISH_PROOF_KINDS.includes(ctx.contentKind) &&
    (ctx.placementUrlCount ?? 0) < 1
  ) {
    return {
      ok: false,
      code: 'publish_proof_required',
      /* Names the kind, so the sentence is about the thing in front of them, and
         says where to go — a refusal that does not say what to do next reads as
         a broken control rather than a rule. */
      message:
        `A ${CONTENT_KIND_LABEL[ctx.contentKind].toLowerCase()} cannot be marked as done until it is published. ` +
        'Add where it went and paste the post link under "Where it went" on the task, then close it.',
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
