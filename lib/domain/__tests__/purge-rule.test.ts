import { describe, expect, it } from 'vitest';

import {
  EMPTY_FOOTPRINT,
  canPurgePerson,
  purgeBlockers,
  purgeRefusal,
  type PersonFootprint,
} from '../permissions';
import type { Role } from '../constants';

/* ============================================================================
 * DELETING A PERSON
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23: *"I'm adding someone and I couldn't delete it. I don't
 * want to dump my database with the testing or dummy data."*
 *
 * Two rules are being held apart here, and conflating them is what made this
 * look like one immovable law for so long:
 *
 *   · a person who has authored NOTHING can be removed — there is nothing to
 *     protect, and a mistyped invitation should not be permanent;
 *   · a person who has authored ANYTHING cannot, by anybody, Super Admin
 *     included, because the alternative is destroying or orphaning their work.
 *
 * The second is also enforced by thirteen RESTRICT foreign keys, so these tests
 * are about the interface being honest rather than about safety — the database
 * refuses regardless. What they really guard is that the refusal arrives as a
 * sentence naming the cause, instead of a foreign key violation.
 * ========================================================================= */

const actor = (role: Role, id = 'actor-1') => ({ role, id });
const target = (role: Role, id = 'target-1') => ({ id, role });

const withWork = (over: Partial<PersonFootprint>): PersonFootprint => ({
  ...EMPTY_FOOTPRINT,
  ...over,
});

describe('who may delete whom', () => {
  it('lets an Admin delete a Member who has made nothing', () => {
    expect(purgeRefusal(actor('admin'), target('member'), EMPTY_FOOTPRINT)).toBeNull();
  });

  it('lets an Admin delete a Coordinator who has made nothing', () => {
    expect(purgeRefusal(actor('admin'), target('team_coordinator'), EMPTY_FOOTPRINT)).toBeNull();
  });

  it('lets the Super Admin delete an Admin who has made nothing', () => {
    expect(purgeRefusal(actor('super_admin'), target('admin'), EMPTY_FOOTPRINT)).toBeNull();
  });

  it('refuses a Coordinator entirely', () => {
    expect(purgeRefusal(actor('team_coordinator'), target('member'), EMPTY_FOOTPRINT)).toBe(
      'not_permitted',
    );
  });

  it('refuses a Member entirely', () => {
    expect(purgeRefusal(actor('member'), target('member', 'other'), EMPTY_FOOTPRINT)).toBe(
      'not_permitted',
    );
  });
});

describe('rank', () => {
  it('refuses an Admin deleting another Admin', () => {
    /* Equal rank, not lower. Two Admins being able to remove each other is a
       standoff nobody wants to discover during an argument. */
    expect(purgeRefusal(actor('admin'), target('admin', 'other-admin'), EMPTY_FOOTPRINT)).toBe(
      'outranked',
    );
  });

  it('refuses an Admin deleting the Super Admin', () => {
    expect(purgeRefusal(actor('admin'), target('super_admin'), EMPTY_FOOTPRINT)).toBe('outranked');
  });

  it('refuses the Super Admin deleting the Super Admin', () => {
    /* Rank is never strictly greater than itself, so the row is undeletable by
       construction rather than by a special case. */
    expect(
      purgeRefusal(actor('super_admin'), target('super_admin', 'other'), EMPTY_FOOTPRINT),
    ).toBe('outranked');
  });
});

describe('self', () => {
  it('refuses deleting your own account, and says so before rank', () => {
    /* ⚠️ The ordering matters. An Admin outranks nobody less than themselves,
       so a rank check alone would let them through — and unlike deactivation,
       nobody could undo it for them. */
    expect(purgeRefusal(actor('admin', 'me'), target('admin', 'me'), EMPTY_FOOTPRINT)).toBe(
      'self',
    );
    expect(
      purgeRefusal(actor('super_admin', 'me'), target('super_admin', 'me'), EMPTY_FOOTPRINT),
    ).toBe('self');
  });
});

describe('a person who has done work stays', () => {
  const cases: [string, Partial<PersonFootprint>][] = [
    ['created a task', { tasksCreated: 1 }],
    ['written a comment', { comments: 1 }],
    ['owns a project', { projects: 1 }],
    ['logged time', { timeEntries: 1 }],
    ['uploaded something', { uploads: 1 }],
  ];

  for (const [what, over] of cases) {
    it(`refuses somebody who has ${what}, even for the Super Admin`, () => {
      expect(purgeRefusal(actor('super_admin'), target('member'), withWork(over))).toBe(
        'has_work',
      );
    });
  }

  it('a single row is enough — the threshold is one, not some', () => {
    expect(canPurgePerson(actor('admin'), target('member'), withWork({ comments: 1 }))).toBe(false);
    expect(canPurgePerson(actor('admin'), target('member'), EMPTY_FOOTPRINT)).toBe(true);
  });
});

describe('what the refusal tells them', () => {
  it('says nothing when there is nothing holding the person', () => {
    expect(purgeBlockers(EMPTY_FOOTPRINT)).toEqual([]);
  });

  it('names every category, in a readable order', () => {
    expect(
      purgeBlockers(withWork({ tasksCreated: 32, comments: 4, projects: 2, uploads: 1 })),
    ).toEqual(['32 tasks', '4 comments', '2 projects', '1 upload']);
  });

  it('gets the singular right, which is the half everybody skips', () => {
    expect(purgeBlockers(withWork({ tasksCreated: 1 }))).toEqual(['1 task']);
    expect(purgeBlockers(withWork({ timeEntries: 1 }))).toEqual(['1 time entry']);
    expect(purgeBlockers(withWork({ timeEntries: 3 }))).toEqual(['3 time entries']);
  });
});
