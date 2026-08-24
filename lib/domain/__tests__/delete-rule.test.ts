import { describe, expect, it } from 'vitest';

import { TASK_STATUSES, type Role, type TaskStatus } from '../constants';
import { canDeleteTask, deleteRefusal, DELETABLE_STATUSES } from '../permissions';

/* ============================================================================
 * WHO MAY DELETE A TASK
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23, in three parts:
 *
 *   1. *"everyone can delete his own task that he raised or created by
 *      himself."*
 *   2. *"tasks assigned by someone else would not be deletable unless that
 *      person deletes them."*
 *   3. *"that task will not be deletable unless it is in the To Do or In
 *      Progress status. Once it is in [Blocked], Done, Cancel, or Backlog
 *      status, the delete option will only be available to admin."*
 *
 * ── WHY THE STATUS SWEEP IS EXHAUSTIVE ──────────────────────────────────────
 * Rule 3 is a whitelist, and the danger of a whitelist is a status nobody
 * thought about. `in_review` and `revisions` were not named either way by the
 * owner — the tests below assert they are REFUSED, which is the deliberate
 * reading: work somebody else is currently reviewing is the worst case for a
 * quiet delete, because the reviewer's screen empties with no explanation.
 *
 * Iterating `TASK_STATUSES` rather than listing them means a status added later
 * arrives refused-by-default and fails here until somebody decides otherwise.
 * ========================================================================= */

const ME = 'me';
const SOMEBODY_ELSE = 'them';

const actor = (role: Role, id = ME) => ({ id, role });
const task = (createdById: string, status: TaskStatus) => ({ createdById, status });

describe('rule 1 — you may delete what you raised', () => {
  it('lets a Member delete their own To Do task', () => {
    expect(canDeleteTask(actor('member'), task(ME, 'todo'))).toBe(true);
  });

  it('lets a Coordinator delete their own To Do task', () => {
    /* Was `deny` for a Coordinator until 2026-08-23 — they had to ask an Admin
       to remove a task they had raised by mistake. */
    expect(canDeleteTask(actor('team_coordinator'), task(ME, 'todo'))).toBe(true);
  });
});

describe('rule 2 — somebody else’s task is theirs to delete', () => {
  it('refuses a Member a task raised by somebody else', () => {
    expect(deleteRefusal(actor('member'), task(SOMEBODY_ELSE, 'todo'))).toBe('not_yours');
  });

  it('refuses a Coordinator a task raised by somebody else', () => {
    expect(deleteRefusal(actor('team_coordinator'), task(SOMEBODY_ELSE, 'todo'))).toBe('not_yours');
  });

  it('still refuses when it is assigned TO them — raising is what counts', () => {
    /* The distinction the owner drew: being given work does not make it yours to
       destroy. `self_created`, not `own_task`. */
    expect(
      deleteRefusal(actor('member'), { createdById: SOMEBODY_ELSE, assigneeId: ME, status: 'todo' }),
    ).toBe('not_yours');
  });
});

describe('rule 3 — only while the work is still early', () => {
  it('names To Do and In Progress as the window', () => {
    expect([...DELETABLE_STATUSES].sort()).toEqual(['in_progress', 'todo']);
  });

  for (const status of TASK_STATUSES) {
    const allowed = (DELETABLE_STATUSES as readonly string[]).includes(status);

    it(`${allowed ? 'allows' : 'refuses'} a Coordinator deleting their own ${status} task`, () => {
      const verdict = deleteRefusal(actor('team_coordinator'), task(ME, status));
      expect(verdict).toBe(allowed ? null : 'too_far_along');
    });
  }

  it('refuses in_review and revisions, which the owner did not name either way', () => {
    /* Deliberate: a whitelist fails closed, and a task under review is the worst
       case for a silent delete. Asserted explicitly so reversing it is a choice. */
    expect(deleteRefusal(actor('member'), task(ME, 'in_review'))).toBe('too_far_along');
    expect(deleteRefusal(actor('member'), task(ME, 'revisions'))).toBe('too_far_along');
  });
});

describe('"admin" means Admin and Super Admin', () => {
  for (const role of ['admin', 'super_admin'] as const) {
    it(`lets ${role} delete anybody's task in any status`, () => {
      for (const status of TASK_STATUSES) {
        expect(
          canDeleteTask(actor(role), task(SOMEBODY_ELSE, status)),
          `${role} / ${status}`,
        ).toBe(true);
      }
    });
  }

  it('is the only escape from both rules at once', () => {
    /* Somebody else's Done task: refused for everyone below Admin. */
    expect(canDeleteTask(actor('team_coordinator'), task(SOMEBODY_ELSE, 'done'))).toBe(false);
    expect(canDeleteTask(actor('member'), task(SOMEBODY_ELSE, 'done'))).toBe(false);
    expect(canDeleteTask(actor('admin'), task(SOMEBODY_ELSE, 'done'))).toBe(true);
  });
});

describe('the refusal says WHICH rule applied', () => {
  it('distinguishes "not yours" from "too far along"', () => {
    /* The two need different responses: one means ask the person who raised it,
       the other means ask an Admin. "No permission" would mean neither. */
    expect(deleteRefusal(actor('member'), task(SOMEBODY_ELSE, 'todo'))).toBe('not_yours');
    expect(deleteRefusal(actor('member'), task(ME, 'done'))).toBe('too_far_along');
  });

  it('returns null when allowed', () => {
    expect(deleteRefusal(actor('member'), task(ME, 'in_progress'))).toBeNull();
  });
});
