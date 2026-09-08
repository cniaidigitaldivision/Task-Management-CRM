import { describe, expect, it } from 'vitest';

import { statusNotifyPlan, taskNotice } from '../task-notice';
import type { NotifyTarget } from '../task-notice';
import type { TaskStatus } from '../constants';

/* ============================================================================
 * BOTH EXITS REACH WHOEVER ASKED FOR THE WORK — owner, 2026-09-08
 * ----------------------------------------------------------------------------
 *   *"if he puts it in Review, then the reviewer … will move it to Done. If a
 *   team member thinks that he doesn't need a review, he can just put it in
 *   Done… The notification is sent in both cases… Make sure that nothing will
 *   break please. It's very critical."*
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. The assignee may now close delegated work
 * themselves (see task-machine.ts), which removed a gate. What replaced the
 * gate is the requester being TOLD — so a notification that silently stops
 * arriving is no longer a cosmetic bug, it is work being closed with nobody
 * the wiser. The rule used to live inline in a transaction callback inside a
 * 1,900-line action, where nothing could reach it.
 *
 * The cast of characters is deliberately small and fixed, because almost every
 * bug in this area is a confusion between two of the three roles.
 * ========================================================================= */

const DOER = 'user-doer';
const BOSS = 'user-boss';
const SOMEBODY = 'user-third-party';

/** Delegated: the boss raised it, the doer is doing it. */
const delegated = (to: TaskStatus, actorId: string, reason: string | null = null) =>
  statusNotifyPlan({
    to,
    actorId,
    assigneeId: DOER,
    createdById: BOSS,
    reason,
    statusLabel: 'Whatever',
  });

/** Self-raised: one person invented the task and is doing it. */
const ownWork = (to: TaskStatus, actorId: string = DOER) =>
  statusNotifyPlan({
    to,
    actorId,
    assigneeId: DOER,
    createdById: DOER,
    reason: null,
    statusLabel: 'Whatever',
  });

const who = (plan: readonly NotifyTarget[]) => plan.map((t) => t.who);
const find = (plan: readonly NotifyTarget[], w: NotifyTarget['who']) =>
  plan.find((t) => t.who === w);

describe('the two exits from delegated work', () => {
  it('DONE straight from To Do tells the person who asked for it', () => {
    /* The exit that had no notification at all before 2026-09-08, and the one
       that matters most: the assignee closed the work and the requester found
       out by going to look. */
    const plan = delegated('done', DOER);
    expect(who(plan)).toEqual(['requester']);
    expect(find(plan, 'requester')?.notice).toEqual({ event: 'completed' });
  });

  it('DONE straight from In Progress does the same', () => {
    /* Same rule from either starting point — the machine allows both, so both
       are asserted rather than one standing in for the other. */
    expect(who(delegated('done', DOER))).toEqual(['requester']);
  });

  it('REVIEW tells the person who asked for it, and asks for the review', () => {
    const plan = delegated('in_review', DOER);
    expect(who(plan)).toEqual(['requester']);
    expect(find(plan, 'requester')?.kind).toBe('review_requested');
    expect(find(plan, 'requester')?.notice).toEqual({ event: 'review_requested' });
  });

  it('⚠️ neither exit broadcasts to every Admin in the division', () => {
    /* What this replaced: In Review went to every Admin and Coordinator EXCEPT
       the one who assigned the task. */
    expect(who(delegated('in_review', DOER))).not.toContain('reviewers');
    expect(who(delegated('done', DOER))).not.toContain('reviewers');
  });

  it('and the doer is never notified about their own click', () => {
    for (const to of ['done', 'in_review'] as TaskStatus[]) {
      expect(who(delegated(to, DOER))).not.toContain('assignee');
    }
  });
});

describe('the review round trip', () => {
  it('approving tells the person who did the work that it was approved', () => {
    /* The boss closes what was submitted to them. The doer hears "approved",
       not "moved to Done" — the word is the difference between a decision and
       a status change. */
    const plan = delegated('done', BOSS);
    expect(who(plan)).toContain('assignee');
    expect(find(plan, 'assignee')?.kind).toBe('review_approved');
    expect(find(plan, 'assignee')?.notice).toEqual({ event: 'approved' });
  });

  it('and does not also tell the boss about their own approval', () => {
    expect(who(delegated('done', BOSS))).toEqual(['assignee']);
  });

  it('sending it back carries the brief, to the person who has to act on it', () => {
    const plan = delegated('revisions', BOSS, 'The logo is the old one');
    expect(find(plan, 'assignee')?.kind).toBe('revisions_requested');
    expect(find(plan, 'assignee')?.notice).toEqual({
      event: 'revisions',
      reason: 'The logo is the old one',
    });
  });

  it('a third party closing it tells BOTH the doer and the requester', () => {
    /* A Coordinator who neither raised nor did the work can still close it
       (task-machine.ts keeps `coordinator` on `in_review → done`, so an absent
       requester is not a dead end). Both other parties have a stake. */
    const plan = delegated('done', SOMEBODY);
    expect(who(plan)).toEqual(['assignee', 'requester']);
  });
});

describe('work somebody raised for themselves', () => {
  it('closing it notifies nobody — there is no second party', () => {
    expect(ownWork('done')).toEqual([]);
  });

  it('⚠️ but submitting it still finds a reviewer', () => {
    /* The one surviving broadcast. Without it a self-raised submission would
       sit in review with nobody told it exists — there is no requester to ask,
       because the requester is the person who just submitted. */
    const plan = ownWork('in_review');
    expect(who(plan)).toEqual(['reviewers']);
    expect(find(plan, 'reviewers')?.kind).toBe('review_requested');
  });
});

describe('the ordinary moves in between', () => {
  it('starting work tells nobody when you are the one doing it', () => {
    expect(delegated('in_progress', DOER)).toEqual([]);
  });

  it('but somebody else moving your task tells you', () => {
    const plan = delegated('in_progress', BOSS);
    expect(who(plan)).toEqual(['assignee']);
    expect(find(plan, 'assignee')?.kind).toBe('task_status_changed');
  });

  it('blocking carries the reason to the person it blocks', () => {
    const plan = delegated('blocked', BOSS, 'Waiting on the client');
    expect(find(plan, 'assignee')?.kind).toBe('task_blocked');
    expect(find(plan, 'assignee')?.notice).toEqual({
      event: 'blocked',
      reason: 'Waiting on the client',
    });
  });

  it('an unassigned task still tells its requester when it is finished', () => {
    /* Nobody to notify as assignee, and the requester still cares. An earlier
       shape of this code hung the whole block off `task.assigneeId`, which
       would have dropped this one silently. */
    const plan = statusNotifyPlan({
      to: 'done',
      actorId: SOMEBODY,
      assigneeId: null,
      createdById: BOSS,
      reason: null,
      statusLabel: 'Done',
    });
    expect(who(plan)).toEqual(['requester']);
  });
});

describe('every planned notification is a sentence somebody can read', () => {
  const SUBJECT = {
    taskId: 'task-1',
    taskTitle: 'Eid sale post',
    projectName: 'Chitral Royal Homes',
    actorName: 'Ayesha Khan',
  };

  it('renders for every audience of every status, with no code and no gap', () => {
    /* Ties the two halves together: a plan naming an audience whose notice does
       not render is a notification that arrives blank. */
    const statuses: TaskStatus[] = [
      'todo',
      'in_progress',
      'in_review',
      'revisions',
      'blocked',
      'done',
      'cancelled',
    ];

    for (const to of statuses) {
      for (const actor of [DOER, BOSS, SOMEBODY]) {
        for (const target of delegated(to, actor, 'a reason')) {
          const notice = taskNotice(SUBJECT, target.notice);
          expect(notice.title.trim().length).toBeGreaterThan(0);
          expect(notice.body.trim().length).toBeGreaterThan(0);
          expect(notice.title).not.toMatch(/\b[A-Z]{2,4}-\d+\b/);
          expect(notice.linkTo).toBe('/tasks?task=task-1');
        }
      }
    }
  });
});
