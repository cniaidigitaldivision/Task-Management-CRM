import { describe, expect, it } from 'vitest';

import {
  assignableRolesFor,
  canAssignTo,
  managesWork,
  PERMISSIONS,
  type Actor,
} from '@/lib/domain/permissions';
import { ROLE_RANK, ROLES, type Role } from '@/lib/domain/constants';

/* ============================================================================
 * WHAT AN EXECUTIVE MAY DO — owner, 2026-09-25
 * ----------------------------------------------------------------------------
 * *"All the settings and all the editing will not be allowed for the executive
 * role. Only admin and super admin."*
 *
 * ⚠️ THE POINT OF THIS FILE IS THE LAST TEST IN IT. Listing the eleven reads
 * they were granted proves only that somebody typed them. Asserting that
 * EVERYTHING ELSE is refused is what catches the permission a future change
 * hands them by accident — which is exactly how the rank change nearly handed
 * them a Coordinator's writes before migration 256 caught it.
 * ========================================================================= */

const EXEC: Actor = { id: 'u-exec', role: 'executive' };

/** Read from the matrix, so the list cannot drift from the thing it describes. */
const granted = Object.entries(PERMISSIONS)
  .filter(([, rule]) => (rule as Record<Role, unknown>).executive === 'allow')
  .map(([key]) => key)
  .sort();

describe('the Executive sits between Admin and Team Coordinator', () => {
  it('ranks below an Admin and above a Coordinator', () => {
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.executive);
    expect(ROLE_RANK.executive).toBeGreaterThan(ROLE_RANK.team_coordinator);
  });

  it('is handed out by an Admin and a Super Admin, and by nobody else', () => {
    expect(assignableRolesFor('super_admin')).toContain('executive');
    expect(assignableRolesFor('admin')).toContain('executive');
    expect(assignableRolesFor('team_coordinator')).toEqual([]);
    expect(assignableRolesFor('member')).toEqual([]);
    expect(assignableRolesFor('executive')).toEqual([]);
  });
});

describe('the Executive changes nothing', () => {
  it('does not manage work', () => {
    expect(managesWork('executive')).toBe(false);
    /* And nobody else was caught by that helper. */
    expect(managesWork('super_admin')).toBe(true);
    expect(managesWork('admin')).toBe(true);
    expect(managesWork('team_coordinator')).toBe(true);
    expect(managesWork('member')).toBe(false);
  });

  it('cannot put work on anybody, at any rank', () => {
    for (const role of ROLES) {
      expect(canAssignTo('executive', role)).toBe(false);
    }
  });

  /* ⚠️ THE LIST IS ASSERTED WHOLE. A twelfth `'allow'` added to the matrix
     fails here, which is the only way a silent grant gets noticed. */
  it('is allowed exactly twelve things, and every one of them is a read or the assistant', () => {
    expect(granted).toEqual([
      /* ⚠️ The assistant is not a read, and it is the one exception the owner
         named outright: *"AI assistance, he will have it."* It writes nothing
         to the record — a question and an answer. */
      'assistant.use',
      'attendance.view_all',
      'dashboard.view',
      'data.export_all',
      'project.view_all',
      'reports.view_per_member',
      'task.view_all',
      'time_data.view_any',
      'user.view_profile',
      'user.view_role',
      'user.view_skills_and_capacity',
      'workload.view_team',
    ]);
  });

  /* Each with the owner's own reason for the refusal. */
  it.each([
    ['finance.view', 'the Finance page is hidden — "right now hide it"'],
    ['project.view_finance', 'same reason'],
    ['credential.view', 'the Vault is hidden — "definitely hide it"'],
    ['audit_log.view', 'Security is Admin and Super Admin only'],
    ['security_dashboard.view', 'Security is Admin and Super Admin only'],
    ['user.create', 'they cannot add a team member'],
    ['user.deactivate', 'they cannot remove a team member'],
    ['user.set_capacity_and_skills', 'they cannot edit a team member'],
    ['task.approve_review', 'approvals were never granted'],
    ['attendance.edit', '"he cannot edit it"'],
  ])('refuses %s — %s', (key) => {
    expect(PERMISSIONS[key as keyof typeof PERMISSIONS].executive).toBe('deny');
  });

  it('refuses everything the matrix was not explicitly told to allow', () => {
    const allowed = new Set(granted);
    for (const [key, rule] of Object.entries(PERMISSIONS)) {
      if (allowed.has(key)) continue;
      expect((rule as Record<Role, unknown>).executive).toBe('deny');
    }
  });
});

describe('nobody else moved', () => {
  /* ⚠️ THE WHOLE MATRIX, ROLE BY ROLE. Adding a fifth argument to `M()` is the
     kind of change that can shift a positional list by one, which would silently
     rewrite every other role's rights. This is the check that would catch it. */
  it.each(['super_admin', 'admin', 'team_coordinator', 'member'] as const)(
    'a %s keeps the rights it had',
    (role) => {
      expect(PERMISSIONS['user.create'][role]).toBe(
        role === 'super_admin' || role === 'admin' ? 'allow' : 'deny',
      );
      expect(PERMISSIONS['dashboard.view'][role]).toBe(role === 'member' ? 'deny' : 'allow');
      expect(PERMISSIONS['finance.view'][role]).toBe(
        role === 'super_admin' || role === 'admin' ? 'allow' : 'deny',
      );
      expect(PERMISSIONS['attendance.view_all'][role]).toBe(role === 'member' ? 'deny' : 'allow');
    },
  );

  it('still lets an Admin assign work down the ladder', () => {
    expect(canAssignTo('admin', 'team_coordinator')).toBe(true);
    expect(canAssignTo('admin', 'member')).toBe(true);
    expect(canAssignTo('team_coordinator', 'member')).toBe(true);
    expect(canAssignTo('member', 'member')).toBe(false);
  });

  it('never lets anybody assign work TO an Executive', () => {
    for (const role of ROLES) {
      expect(canAssignTo(role, 'executive')).toBe(role === 'super_admin' || role === 'admin');
    }
  });
});

describe('the actor shape', () => {
  it('is a role the matrix knows', () => {
    expect(ROLES).toContain(EXEC.role);
  });
});
