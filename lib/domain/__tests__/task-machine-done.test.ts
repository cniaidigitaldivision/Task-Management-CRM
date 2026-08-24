import { describe, expect, it } from 'vitest';

import { allowedTransitions, evaluateTransition } from '../task-machine';
import type { Role, TaskStatus } from '../constants';

/* ============================================================================
 * WHO MAY CLOSE A TASK — owner rule, 2026-08-24
 * ----------------------------------------------------------------------------
 * *"If a team member created his task … he knows that it's done, right? If …
 * the team coordinator Kashif creates or raises some task and assigns it to
 * some team member, the team member can only put it in Review. Kashif … can
 * only move that task to Done because it was raised by him."*
 *
 * One sentence: WHOEVER RAISED IT CLOSES IT.
 *
 * ⚠️ There was no unit test file for the state machine at all before this — the
 * only coverage was one integration test needing a live database and a seed,
 * which is why a Member being unable to finish their own task went unnoticed
 * until somebody hit it. These are pure-domain and run in the default suite.
 *
 * The rule interacts with BR-002 ("the assignee may not approve their own
 * work"), and the interaction is the whole subtlety, so it is asserted from
 * both directions: delegated work still needs a second pair of eyes, self-raised
 * work does not.
 * ========================================================================= */

const ME = 'user-me';
const SOMEBODY_ELSE = 'user-other';

/** A task I raised and I am doing — the personal to-do case. */
const mine = (role: Role) => ({
  actorRole: role,
  actorId: ME,
  assigneeId: ME,
  createdById: ME,
});

/** Somebody else raised it and gave it to me — the delegated case. */
const delegatedToMe = (role: Role) => ({
  actorRole: role,
  actorId: ME,
  assigneeId: ME,
  createdById: SOMEBODY_ELSE,
});

/** I raised it and gave it to somebody else. */
const iDelegated = (role: Role) => ({
  actorRole: role,
  actorId: ME,
  assigneeId: SOMEBODY_ELSE,
  createdById: ME,
});

describe('a task you raised yourself', () => {
  it('a Member can take their own task straight from To Do to Done', () => {
    /* The exact thing the owner could not do. No review step, because there is
       nobody to review it for. */
    expect(evaluateTransition('todo', 'done', mine('member')).ok).toBe(true);
  });

  it('a Member can close their own task from In Progress', () => {
    expect(evaluateTransition('in_progress', 'done', mine('member')).ok).toBe(true);
  });

  it('a Member can approve their own task out of Review', () => {
    /* BR-002 would have refused this on `forbidsAssignee` before 2026-08-24.
       The requester and the doer are the same person, so there is nothing for
       the rule to separate. */
    expect(evaluateTransition('in_review', 'done', mine('member')).ok).toBe(true);
  });

  it('offers Done as a real option on the board, not just via the API', () => {
    /* `allowedTransitions` is what the UI draws from. A rule the server accepts
       but the board never offers is still a broken feature. */
    expect(allowedTransitions('todo', mine('member'))).toContain('done');
    expect(allowedTransitions('in_progress', mine('member'))).toContain('done');
    expect(allowedTransitions('in_review', mine('member'))).toContain('done');
  });
});

describe('a task somebody else asked you to do', () => {
  it('a Member cannot close it — Review is as far as they go', () => {
    expect(evaluateTransition('in_review', 'done', delegatedToMe('member')).ok).toBe(false);
    expect(evaluateTransition('todo', 'done', delegatedToMe('member')).ok).toBe(false);
    expect(evaluateTransition('in_progress', 'done', delegatedToMe('member')).ok).toBe(false);
  });

  it('can still be moved INTO Review by the person doing it', () => {
    /* The half that must keep working — otherwise the work has nowhere to go. */
    expect(evaluateTransition('in_progress', 'in_review', delegatedToMe('member')).ok).toBe(true);
  });

  it('the board never offers Done to the assignee', () => {
    expect(allowedTransitions('in_review', delegatedToMe('member'))).not.toContain('done');
    expect(allowedTransitions('in_progress', delegatedToMe('member'))).toContain('in_review');
  });

  it('says who CAN close it, rather than only that you cannot', () => {
    const verdict = evaluateTransition('in_review', 'done', delegatedToMe('member'));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('own_work');
      expect(verdict.message).toContain('whoever raised this task');
    }
  });

  it('⚠️ BR-002 still binds a Coordinator, and an Admin, and the Super Admin', () => {
    /* Rank buys nothing here. The rule is about identity: if you did the work
       and somebody else asked for it, you are not the one who signs it off. */
    for (const role of ['team_coordinator', 'admin', 'super_admin'] as Role[]) {
      const verdict = evaluateTransition('in_review', 'done', delegatedToMe(role));
      expect(verdict.ok, role).toBe(false);
      if (!verdict.ok) expect(verdict.code, role).toBe('own_work');
    }
  });
});

describe('the requester closes work they handed out', () => {
  it('a Coordinator can approve out of Review what they raised', () => {
    expect(evaluateTransition('in_review', 'done', iDelegated('team_coordinator')).ok).toBe(true);
  });

  it('a Member who raised a task for somebody else can close it too', () => {
    /* Rank is not what confers this — raising the task is. */
    expect(evaluateTransition('in_review', 'done', iDelegated('member')).ok).toBe(true);
  });

  it('a Coordinator uninvolved in the task can still close it', () => {
    /* Somebody has to be able to finish work when whoever asked for it is on
       leave. Rank remains a second, independent path — but only for a reviewer
       who is not the assignee. */
    const bystander = {
      actorRole: 'team_coordinator' as Role,
      actorId: 'user-third',
      assigneeId: ME,
      createdById: SOMEBODY_ELSE,
    };
    expect(evaluateTransition('in_review', 'done', bystander).ok).toBe(true);
  });

  it('a Member uninvolved in the task cannot', () => {
    const bystander = {
      actorRole: 'member' as Role,
      actorId: 'user-third',
      assigneeId: ME,
      createdById: SOMEBODY_ELSE,
    };
    const verdict = evaluateTransition('in_review', 'done', bystander);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('insufficient_role');
  });
});

describe('what the change did NOT touch', () => {
  it('Done is still final for everybody except an Admin reopening it', () => {
    /* Owner, earlier: nobody undoes Done. Reopening stays Admin-only and stays
       logged, because it moves an on-time number that has been reported. */
    expect(evaluateTransition('done', 'todo', mine('member')).ok).toBe(false);
    expect(evaluateTransition('done', 'in_progress', mine('member')).ok).toBe(false);
    expect(evaluateTransition('done', 'in_progress', mine('team_coordinator')).ok).toBe(false);
    expect(evaluateTransition('done', 'in_progress', mine('admin')).ok).toBe(true);
  });

  it('Blocked still cannot jump to Done, even for the creator', () => {
    /* The owner was explicit: *"I'm not talking about overdue tasks or blocked
       tasks."* Blocked means something is in the way; closing it from there
       would hide the thing that was in the way. Unblock first. */
    expect(evaluateTransition('blocked', 'done', mine('member')).ok).toBe(false);
    expect(evaluateTransition('blocked', 'done', mine('admin')).ok).toBe(false);
  });

  it('Backlog still cannot jump to Done', () => {
    expect(evaluateTransition('backlog', 'done', mine('member')).ok).toBe(false);
  });

  it('a cancelled task is never resurrected', () => {
    for (const to of ['todo', 'in_progress', 'done'] as TaskStatus[]) {
      expect(evaluateTransition('cancelled', to, mine('admin')).ok).toBe(false);
    }
  });

  it('moving to the same status is still refused as such', () => {
    const verdict = evaluateTransition('done', 'done', mine('admin'));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('same_status');
  });

  it('a reason is still demanded where it was before', () => {
    const noReason = evaluateTransition('in_progress', 'blocked', mine('member'));
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe('reason_required');

    expect(
      evaluateTransition('in_progress', 'blocked', { ...mine('member'), reason: 'waiting on copy' })
        .ok,
    ).toBe(true);
  });

  it('closing a task never demands a reason', () => {
    /* Approving is the expected outcome; making somebody justify it would put a
       dialog between them and the thing they came to do. */
    expect(evaluateTransition('todo', 'done', mine('member')).ok).toBe(true);
    expect(evaluateTransition('in_review', 'done', iDelegated('team_coordinator')).ok).toBe(true);
  });
});
