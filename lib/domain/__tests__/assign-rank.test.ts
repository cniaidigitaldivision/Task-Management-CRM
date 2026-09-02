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
    /* ── ⚠️ member → member BECAME FALSE, 2026-09-03 ────────────────────────
       Owner: *"all the team members who is creating their task they will not
       assign to anyone as they have to do by there by himself."* Equal ranks
       used to make this true, so one Member could put work on another — rank
       was the wrong instrument for that pair.

       Raising your OWN work is unaffected: that is settled by identity before
       rank is consulted (`rankGate` returns early on assigneeId === actorId),
       and a function given only two roles cannot tell "me" from "a peer". */
    member: {
      super_admin: false,
      admin: false,
      team_coordinator: false,
      member: false,
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

  /* ── ⚠️ THIS ASSERTION WAS REVERSED, 2026-09-03 ─────────────────────────
     It read: *"a Member may still take their own work"*, asserting
     canAssignTo('member','member') === true, and reasoned that the rank rule
     must not be the thing that stops a Member owning a task.

     Sound while rank was the only gate. It is not any more: `rankGate` settles
     self-assignment by IDENTITY and returns before rank is consulted, so rank
     refusing the member/member PAIR no longer refuses a Member their own work
     — it refuses one Member putting work on another, which is what the owner
     asked for: *"all the team members who is creating their task they will not
     assign to anyone as they have to do by there by himself."*

     `assignableTo` below proves the other half: a Member is still offered
     themselves, and only themselves. */
  it('one Member may not put work on another', () => {
    expect(canAssignTo('member', 'member')).toBe(false);
  });
});

describe('assignableTo', () => {
  const people = [
    { id: '1', name: 'Ammar', role: 'super_admin' as Role },
    { id: '2', name: 'Umm-e-Habiba', role: 'admin' as Role },
    { id: '3', name: 'Kashif', role: 'team_coordinator' as Role },
    { id: '4', name: 'Najmulla', role: 'member' as Role },
    { id: '5', name: 'Rafay', role: 'member' as Role },
  ];

  const KASHIF = { id: '3', role: 'team_coordinator' as Role };
  const HABIBA = { id: '2', role: 'admin' as Role };
  const AMMAR = { id: '1', role: 'super_admin' as Role };
  const NAJMULLA = { id: '4', role: 'member' as Role };

  it('offers a Coordinator everyone at or below them', () => {
    expect(assignableTo(KASHIF, people).map((p) => p.name)).toEqual([
      'Kashif',
      'Najmulla',
      'Rafay',
    ]);
  });

  it('hides the Super Admin from an Admin', () => {
    expect(assignableTo(HABIBA, people).map((p) => p.name)).toEqual([
      'Umm-e-Habiba',
      'Kashif',
      'Najmulla',
      'Rafay',
    ]);
  });

  it('offers the Super Admin everybody', () => {
    expect(assignableTo(AMMAR, people)).toHaveLength(5);
  });

  /* ⚠️ THEMSELVES, AND NOBODY ELSE — not "everybody at their own rank". Rafay is
     the same rank as Najmulla and must not be offered; without the identity
     arm the list would be empty and a Member could not raise their own work. */
  it('leaves a Member with only themselves', () => {
    expect(assignableTo(NAJMULLA, people).map((p) => p.name)).toEqual(['Najmulla']);
  });
});
