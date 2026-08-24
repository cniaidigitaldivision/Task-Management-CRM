import { describe, expect, it } from 'vitest';

import { ROLES, type Role } from '../constants';
import { assignableTo, canAssignTo } from '../permissions';

/* ============================================================================
 * WORK FLOWS DOWNWARD
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23: *"a lower-level person could not assign a task to an
 * upper-level person… The flow will always move from up to down."*
 *
 * ── WHY THIS NEEDED ITS OWN RULE ────────────────────────────────────────────
 * `task.create_for_other` already answered "may this person assign work at all"
 * — yes for Coordinator and above. It said nothing about WHO, so a Coordinator
 * could put a task on the Super Admin and the matrix would permit it. The two
 * checks are asking different questions and both have to pass.
 *
 * The cross product below is exhaustive on purpose: sixteen pairs is small
 * enough to state completely, and a rank rule that is right for three pairs and
 * wrong for one is the kind of thing that only surfaces when somebody senior
 * finds work on their board that they never agreed to.
 * ========================================================================= */

describe('canAssignTo — the full cross product', () => {
  /* Read down the rows for the actor, across for the assignee. */
  const EXPECTED: Readonly<Record<Role, Readonly<Record<Role, boolean>>>> = {
    super_admin: {
      super_admin: true,
      admin: true,
      team_coordinator: true,
      member: true,
    },
    admin: {
      super_admin: false,
      admin: true,
      team_coordinator: true,
      member: true,
    },
    team_coordinator: {
      super_admin: false,
      admin: false,
      team_coordinator: true,
      member: true,
    },
    member: {
      super_admin: false,
      admin: false,
      team_coordinator: false,
      member: true,
    },
  };

  for (const actor of ROLES) {
    for (const assignee of ROLES) {
      const allowed = EXPECTED[actor][assignee];
      it(`${actor} → ${assignee} is ${allowed ? 'allowed' : 'refused'}`, () => {
        expect(canAssignTo(actor, assignee)).toBe(allowed);
      });
    }
  }
});

describe('the rules the owner stated in words', () => {
  it('nobody below the Super Admin may put work on them', () => {
    expect(canAssignTo('admin', 'super_admin')).toBe(false);
    expect(canAssignTo('team_coordinator', 'super_admin')).toBe(false);
    expect(canAssignTo('member', 'super_admin')).toBe(false);
  });

  it('a Coordinator may not assign to an Admin', () => {
    expect(canAssignTo('team_coordinator', 'admin')).toBe(false);
  });

  it('a Coordinator may assign to any team member', () => {
    expect(canAssignTo('team_coordinator', 'member')).toBe(true);
  });

  it('equal rank is allowed — the exclusions are upward, not sideways', () => {
    /* Two Coordinators planning between themselves is ordinary work. A strict
       `>` would have refused it, and nobody asked for that. */
    expect(canAssignTo('team_coordinator', 'team_coordinator')).toBe(true);
    expect(canAssignTo('admin', 'admin')).toBe(true);
  });

  it('a Member may still take their own work', () => {
    /* They are denied `task.create_for_other` separately, so in practice this
       only ever resolves to themselves — but the rank rule must not be the thing
       that stops a Member owning a task. */
    expect(canAssignTo('member', 'member')).toBe(true);
  });
});

describe('assignableTo', () => {
  const people = [
    { id: '1', name: 'Ammar', role: 'super_admin' as Role },
    { id: '2', name: 'Umm-e-Habiba', role: 'admin' as Role },
    { id: '3', name: 'Kashif', role: 'team_coordinator' as Role },
    { id: '4', name: 'Najmulla', role: 'member' as Role },
  ];

  it('offers a Coordinator everyone at or below them', () => {
    expect(assignableTo('team_coordinator', people).map((p) => p.name)).toEqual([
      'Kashif',
      'Najmulla',
    ]);
  });

  it('hides the Super Admin from an Admin', () => {
    expect(assignableTo('admin', people).map((p) => p.name)).toEqual([
      'Umm-e-Habiba',
      'Kashif',
      'Najmulla',
    ]);
  });

  it('offers the Super Admin everybody', () => {
    expect(assignableTo('super_admin', people)).toHaveLength(4);
  });

  it('leaves a Member with only their own rank', () => {
    expect(assignableTo('member', people).map((p) => p.name)).toEqual(['Najmulla']);
  });
});
