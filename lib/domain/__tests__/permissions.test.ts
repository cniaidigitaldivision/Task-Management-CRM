import { describe, expect, it } from 'vitest';

import { ROLES, ROLE_RANK, type Role } from '../constants';
import {
  ACTIONS,
  PERMISSIONS,
  STEP_UP_ACTIONS,
  actionsFor,
  can,
  requiresStepUp,
  ruleFor,
  type Action,
  type Actor,
  type ResourceContext,
  type Rule,
} from '../permissions';

/* ============================================================================
 * PERMISSION MATRIX — EXHAUSTIVE TESTS
 * ----------------------------------------------------------------------------
 * GATE (doc 20 §9, step 3): "100% of doc 03 §3 covered by passing tests."
 *
 * ── HOW THIS SUITE IS BUILT, AND WHY IT IS WORTH ANYTHING ─────────────────
 *
 * A test that imports PERMISSIONS and checks can() against it proves only that
 * can() can read a table. It would pass just as happily if the table were
 * wrong, which is the failure that actually matters here.
 *
 * So the suite has three independent layers:
 *
 *   1. TRANSCRIPTION   EXPECTED below is docs/03 §3 written out a SECOND time,
 *                      from the document, without consulting permissions.ts.
 *                      Comparing the two catches a mistake in either, and
 *                      catches drift the moment someone edits one of them.
 *
 *   2. BEHAVIOUR       The full action × role cross product, driven through
 *                      can() with contexts constructed to satisfy and to
 *                      violate each conditional rule. This is what proves the
 *                      conditions are evaluated, not merely stored.
 *
 *   3. PROSE           Named scenarios written from the document's sentences
 *                      rather than its tables — "nobody approves their own
 *                      work", "no account changes its own role". If the tables
 *                      in both layer 1 and layer 2 were transcribed wrongly in
 *                      the same way, these are what still fail.
 * ========================================================================= */

const SUPER_ADMIN: Actor = { id: 'u-super', role: 'super_admin' };
const ADMIN: Actor = { id: 'u-admin', role: 'admin' };
const COORDINATOR: Actor = { id: 'u-coord', role: 'team_coordinator' };
const MEMBER: Actor = { id: 'u-member', role: 'member' };

const ACTOR_BY_ROLE: Readonly<Record<Role, Actor>> = {
  super_admin: SUPER_ADMIN,
  admin: ADMIN,
  team_coordinator: COORDINATOR,
  member: MEMBER,
};

const SOMEONE_ELSE = 'u-other';

/* ==========================================================================
 * LAYER 1 — docs/03 §3 transcribed independently
 * ==========================================================================
 * Order: [super_admin, admin, team_coordinator, member]
 * Read alongside docs/03-ROLES-AND-PERMISSIONS.md §3. Every row below is one
 * row of that document.
 */

type Row = readonly [Rule, Rule, Rule, Rule];

const EXPECTED: Readonly<Record<Action, Row>> = {
  /* Account & team management */
  'admin.create': ['allow', 'deny', 'deny', 'deny'],
  'admin.manage': ['allow', 'deny', 'deny', 'deny'],
  'user.create': ['allow', 'allow', 'deny', 'deny'],
  'user.edit_profile': ['allow', 'allow', 'self', 'self'],
  'user.set_capacity_and_skills': ['allow', 'allow', 'deny', 'deny'],
  'user.deactivate': ['allow', 'allow', 'deny', 'deny'],
  'user.purge': ['allow', 'deny', 'deny', 'deny'],
  'user.change_role': ['allow', 'allow', 'deny', 'deny'],
  'user.promote_to_admin': ['allow', 'deny', 'deny', 'deny'],
  'user.promote_to_super_admin': ['deny', 'deny', 'deny', 'deny'],
  'user.change_own_role': ['deny', 'deny', 'deny', 'deny'],
  'super_admin.edit': ['self', 'deny', 'deny', 'deny'],
  'super_admin.self_destruct': ['deny', 'deny', 'deny', 'deny'],
  'super_admin.disable_mfa': ['deny', 'deny', 'deny', 'deny'],
  'invitation.resend': ['allow', 'allow', 'deny', 'deny'],
  'user.force_password_reset': ['allow', 'outranks', 'deny', 'deny'],
  'user.reset_mfa': ['allow', 'outranks', 'deny', 'deny'],
  'user.view_profile': ['allow', 'allow', 'allow', 'deny'],
  'user.view_directory_entry': ['allow', 'allow', 'allow', 'allow'],

  /* Projects */
  'project.create': ['allow', 'allow', 'deny', 'deny'],
  'project.set_type': ['allow', 'allow', 'deny', 'deny'],
  'project.edit': ['allow', 'allow', 'deny', 'deny'],
  'project.change_status': ['allow', 'allow', 'deny', 'deny'],
  'project.soft_delete': ['allow', 'allow', 'deny', 'deny'],
  'project.purge': ['allow', 'deny', 'deny', 'deny'],
  'project.view_all': ['allow', 'allow', 'allow', 'deny'],
  'project.view_member_of': ['allow', 'allow', 'allow', 'in_project'],
  'task.create_in_project': ['allow', 'allow', 'allow', 'in_project'],
  'task.promote_other_to_project': ['allow', 'allow', 'deny', 'deny'],

  /* Tasks */
  'task.create_for_self': ['allow', 'allow', 'allow', 'allow'],
  'task.create_for_other': ['allow', 'allow', 'allow', 'deny'],
  'task.assign': ['allow', 'allow', 'allow', 'deny'],
  'task.override_capacity_block': ['allow', 'allow', 'deny', 'deny'],
  'task.edit_content': ['allow', 'allow', 'allow', 'own_task'],
  'task.edit_planning': ['allow', 'allow', 'allow', 'self_created'],
  'task.change_status_own': ['allow', 'allow', 'allow', 'allow'],
  'task.change_status_any': ['allow', 'allow', 'allow', 'deny'],
  'task.approve_review': ['not_assignee', 'not_assignee', 'not_assignee', 'deny'],
  'task.request_revisions': ['not_assignee', 'not_assignee', 'not_assignee', 'deny'],
  'task.cancel': ['allow', 'allow', 'allow', 'self_created'],
  'task.soft_delete': ['allow', 'allow', 'deny', 'deny'],
  'task.purge': ['allow', 'deny', 'deny', 'deny'],
  'task.restore': ['allow', 'allow', 'deny', 'deny'],
  'task.comment': ['allow', 'allow', 'allow', 'own_task'],
  'task.log_time': ['allow', 'allow', 'allow', 'own_task'],

  /* Time limits & extensions */
  'time_limit.set': ['allow', 'allow', 'allow', 'deny'],
  'time_limit.edit_before_start': ['allow', 'allow', 'allow', 'deny'],
  'time_limit.edit_after_start': ['allow', 'allow', 'deny', 'deny'],
  'extension.grant': ['allow', 'allow', 'deny', 'deny'],
  'extension.decline': ['allow', 'allow', 'deny', 'deny'],
  'extension.request_own': ['allow', 'allow', 'allow', 'allow'],
  'extension.view_all_pending': ['allow', 'allow', 'allow', 'deny'],
  'extension.view_own_pending': ['allow', 'allow', 'allow', 'allow'],
  'timer.control_own': ['allow', 'allow', 'allow', 'allow'],
  'timer.pause_other': ['allow', 'allow', 'allow', 'deny'],
  'time_entry.adjust_own': ['allow', 'allow', 'allow', 'allow'],
  'time_entry.adjust_other': ['allow', 'allow', 'deny', 'deny'],
  'time_data.view_any': ['allow', 'allow', 'allow', 'deny'],

  /* Visibility */
  'task.view_all': ['allow', 'allow', 'allow', 'deny'],
  'task.view_own': ['allow', 'allow', 'allow', 'allow'],
  'workload.view_team': ['allow', 'allow', 'allow', 'deny'],
  'workload.view_own': ['allow', 'allow', 'allow', 'allow'],
  'user.view_role': ['allow', 'allow', 'allow', 'deny'],
  'user.view_skills_and_capacity': ['allow', 'allow', 'allow', 'deny'],
  'member_activity_preview.view': ['allow', 'allow', 'allow', 'deny'],
  'dashboard.view': ['allow', 'allow', 'allow', 'deny'],
  'reports.view_per_member': ['allow', 'allow', 'allow', 'deny'],
  'reports.view_own': ['allow', 'allow', 'allow', 'allow'],
  'rebalance_advisor.view': ['allow', 'allow', 'allow', 'deny'],
  'audit_log.view': ['allow', 'allow', 'deny', 'deny'],
  'security_dashboard.view': ['allow', 'deny', 'deny', 'deny'],

  /* System settings */
  'settings.capacity_thresholds': ['allow', 'deny', 'deny', 'deny'],
  'settings.default_capacity': ['allow', 'deny', 'deny', 'deny'],
  'settings.status_workflow': ['allow', 'deny', 'deny', 'deny'],
  'settings.skills_library': ['allow', 'allow', 'deny', 'deny'],
  'settings.scoring_weights': ['allow', 'deny', 'deny', 'deny'],
  'settings.other_work_threshold': ['allow', 'allow', 'deny', 'deny'],
  'settings.project_type_priority': ['allow', 'deny', 'deny', 'deny'],
  'settings.notification_defaults': ['allow', 'allow', 'deny', 'deny'],
  'settings.own_notification_prefs': ['allow', 'allow', 'allow', 'allow'],
  'settings.security': ['allow', 'deny', 'deny', 'deny'],
  'data.export_all': ['allow', 'deny', 'deny', 'deny'],
  'sessions.view_and_revoke_own': ['allow', 'allow', 'allow', 'allow'],

  /* The credentials vault. `view` and `reveal` are open to every role because the
     real restriction is relational — a project you own, or a login issued to you
     — and row-level security enforces it (migration 023). A Member opening the
     vault sees only what was issued to them, usually nothing. Same shape as the
     calendar. `manage` and `delete` ARE role-decidable, so they are stated. */
  'credential.view': ['allow', 'allow', 'allow', 'allow'],
  'credential.reveal': ['allow', 'allow', 'allow', 'allow'],
  'credential.manage': ['allow', 'allow', 'allow', 'deny'],
  'credential.delete': ['allow', 'allow', 'deny', 'deny'],

  /* Drive documents. `request` is open to everybody because a pending upload is
     not in Drive — the approval is the gate. `approve` stops at Admin, so a
     Coordinator cannot wave through their own upload. `view` is open for the same
     reason as the vault: the real rule is relational and RLS enforces it. */
  'document.view': ['allow', 'allow', 'allow', 'allow'],
  'document.request': ['allow', 'allow', 'allow', 'allow'],
  'document.approve': ['allow', 'allow', 'deny', 'deny'],
  'document.manage': ['allow', 'allow', 'allow', 'deny'],
  'drive.configure': ['allow', 'allow', 'deny', 'deny'],
};

const ROLE_ORDER: readonly Role[] = ['super_admin', 'admin', 'team_coordinator', 'member'];

/* ==========================================================================
 * Context builders
 * ========================================================================== */

/** A context under which `rule` should permit the action. */
function satisfying(rule: Rule, actor: Actor): ResourceContext | null {
  switch (rule) {
    case 'allow':
      return {};
    case 'self':
      return { ownerId: actor.id };
    case 'own_task':
      return { assigneeId: actor.id };
    case 'self_created':
      return { createdById: actor.id };
    case 'not_assignee':
      return { assigneeId: SOMEONE_ELSE };
    case 'outranks': {
      const lower = ROLE_ORDER.find((r) => ROLE_RANK[r] < ROLE_RANK[actor.role]);
      return lower ? { ownerRole: lower } : null;
    }
    case 'in_project':
      return { isProjectMember: true };
    case 'deny':
      return null;
  }
}

/** Contexts under which `rule` should refuse the action. */
function violating(rule: Rule, actor: Actor): ResourceContext[] {
  switch (rule) {
    case 'allow':
      return [];
    case 'deny':
      return [{}, { ownerId: actor.id }, { assigneeId: actor.id }, { createdById: actor.id }];
    case 'self':
      return [{}, { ownerId: SOMEONE_ELSE }];
    case 'own_task':
      return [{}, { assigneeId: SOMEONE_ELSE }];
    case 'self_created':
      return [{}, { createdById: SOMEONE_ELSE }];
    case 'not_assignee':
      return [{}, { assigneeId: actor.id }];
    case 'outranks': {
      const notLower = ROLE_ORDER.filter((r) => ROLE_RANK[r] >= ROLE_RANK[actor.role]);
      return [{}, ...notLower.map((ownerRole) => ({ ownerRole }))];
    }
    case 'in_project':
      return [{}, { isProjectMember: false }];
  }
}

/* ==========================================================================
 * LAYER 1 — the table matches the document
 * ========================================================================== */

describe('the matrix matches docs/03 §3', () => {
  it('covers every action exactly once, with no extras and none missing', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('defines a rule for all four roles on every action', () => {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        expect(ruleFor(role, action), `${action} / ${role}`).toBeDefined();
      }
    }
  });

  it.each(Object.keys(EXPECTED) as Action[])('%s matches the document', (action) => {
    const expectedRow = EXPECTED[action];
    ROLE_ORDER.forEach((role, index) => {
      expect(PERMISSIONS[action][role], `${action} / ${role}`).toBe(expectedRow[index]);
    });
  });
});

/* ==========================================================================
 * LAYER 2 — the full cross product, driven through can()
 * ========================================================================== */

describe('can() — every action against every role', () => {
  const cases = ACTIONS.flatMap((action) =>
    ROLE_ORDER.map((role) => ({ action, role, rule: PERMISSIONS[action][role] })),
  );

  it('exercises the whole matrix', () => {
    expect(cases).toHaveLength(ACTIONS.length * 4);
    expect(ACTIONS.length).toBeGreaterThan(75);
  });

  it.each(cases)('$role · $action ($rule)', ({ action, role, rule }) => {
    const actor = ACTOR_BY_ROLE[role];

    const permits = satisfying(rule, actor);
    if (permits) {
      expect(can(actor, action, permits), `${role} should be allowed ${action}`).toBe(true);
    }

    for (const refuses of violating(rule, actor)) {
      expect(
        can(actor, action, refuses),
        `${role} should be refused ${action} given ${JSON.stringify(refuses)}`,
      ).toBe(false);
    }
  });

  it('fails closed when a conditional rule gets no context at all', () => {
    const conditional = ACTIONS.flatMap((action) =>
      ROLE_ORDER.filter((role) => {
        const rule = PERMISSIONS[action][role];
        return rule !== 'allow' && rule !== 'deny';
      }).map((role) => ({ action, role })),
    );

    expect(conditional.length).toBeGreaterThan(0);
    for (const { action, role } of conditional) {
      expect(can(ACTOR_BY_ROLE[role], action), `${role} / ${action}`).toBe(false);
    }
  });

  it('refuses an unknown action rather than throwing', () => {
    expect(can(ADMIN, 'not.a.real.action' as Action)).toBe(false);
  });

  it('refuses an unknown role rather than throwing', () => {
    expect(can({ id: 'x', role: 'auditor' as Role }, 'dashboard.view')).toBe(false);
  });
});

/* ==========================================================================
 * LAYER 3 — the document's sentences, as scenarios
 * ========================================================================== */

describe('BR-002 — nobody approves their own work', () => {
  it.each([SUPER_ADMIN, ADMIN, COORDINATOR])(
    '$role cannot approve a task assigned to themselves',
    (actor) => {
      expect(can(actor, 'task.approve_review', { assigneeId: actor.id })).toBe(false);
      expect(can(actor, 'task.request_revisions', { assigneeId: actor.id })).toBe(false);
    },
  );

  it.each([SUPER_ADMIN, ADMIN, COORDINATOR])(
    '$role can approve someone else’s task',
    (actor) => {
      expect(can(actor, 'task.approve_review', { assigneeId: SOMEONE_ELSE })).toBe(true);
    },
  );

  it('a Member cannot approve at all, even work that is not theirs', () => {
    expect(can(MEMBER, 'task.approve_review', { assigneeId: SOMEONE_ELSE })).toBe(false);
  });
});

describe('BR-028 / doc 03 §2 — the Super Admin is unreachable', () => {
  it('no role can promote anyone to Super Admin, including the Super Admin', () => {
    for (const role of ROLES) {
      expect(can(ACTOR_BY_ROLE[role], 'user.promote_to_super_admin')).toBe(false);
    }
  });

  it('nobody but the Super Admin may edit the Super Admin', () => {
    for (const role of ['admin', 'team_coordinator', 'member'] as Role[]) {
      expect(can(ACTOR_BY_ROLE[role], 'super_admin.edit', { ownerId: SUPER_ADMIN.id })).toBe(false);
    }
  });

  it('the Super Admin may edit their own record and no one else’s', () => {
    expect(can(SUPER_ADMIN, 'super_admin.edit', { ownerId: SUPER_ADMIN.id })).toBe(true);
    expect(can(SUPER_ADMIN, 'super_admin.edit', { ownerId: SOMEONE_ELSE })).toBe(false);
  });

  it('FR-156 — the Super Admin cannot destroy their own account', () => {
    expect(can(SUPER_ADMIN, 'super_admin.self_destruct', { ownerId: SUPER_ADMIN.id })).toBe(false);
  });

  it('FR-146 — nobody can disable the Super Admin’s MFA', () => {
    for (const role of ROLES) {
      expect(can(ACTOR_BY_ROLE[role], 'super_admin.disable_mfa')).toBe(false);
    }
  });
});

describe('doc 03 §5 — no self-elevation, at any level', () => {
  it.each(ROLES)('%s cannot change their own role', (role) => {
    expect(can(ACTOR_BY_ROLE[role], 'user.change_own_role', { ownerId: ACTOR_BY_ROLE[role].id })).toBe(
      false,
    );
  });

  it('only the Super Admin may grant the Admin role', () => {
    expect(can(SUPER_ADMIN, 'user.promote_to_admin')).toBe(true);
    expect(can(ADMIN, 'user.promote_to_admin')).toBe(false);
  });
});

describe('doc 03 §3 — Admins manage downward only', () => {
  it('an Admin may force a password reset on a Coordinator or a Member', () => {
    expect(can(ADMIN, 'user.force_password_reset', { ownerRole: 'team_coordinator' })).toBe(true);
    expect(can(ADMIN, 'user.force_password_reset', { ownerRole: 'member' })).toBe(true);
  });

  it('an Admin may not reset another Admin or the Super Admin', () => {
    expect(can(ADMIN, 'user.force_password_reset', { ownerRole: 'admin' })).toBe(false);
    expect(can(ADMIN, 'user.force_password_reset', { ownerRole: 'super_admin' })).toBe(false);
    expect(can(ADMIN, 'user.reset_mfa', { ownerRole: 'admin' })).toBe(false);
  });

  it('the Super Admin may reset anyone', () => {
    for (const ownerRole of ROLES) {
      expect(can(SUPER_ADMIN, 'user.reset_mfa', { ownerRole })).toBe(true);
    }
  });
});

describe('ADR-003 — a Member sees only their own work', () => {
  const forbidden: Action[] = [
    'task.view_all',
    'workload.view_team',
    'user.view_role',
    'user.view_skills_and_capacity',
    'user.view_profile',
    'member_activity_preview.view',
    'dashboard.view',
    'reports.view_per_member',
    'rebalance_advisor.view',
    'time_data.view_any',
    'project.view_all',
    'audit_log.view',
    'security_dashboard.view',
  ];

  it.each(forbidden)('a Member is refused %s', (action) => {
    expect(can(MEMBER, action, { ownerId: MEMBER.id, assigneeId: MEMBER.id })).toBe(false);
  });

  const permitted: Action[] = [
    'task.view_own',
    'workload.view_own',
    'reports.view_own',
    'user.view_directory_entry',
    'sessions.view_and_revoke_own',
    'settings.own_notification_prefs',
    'extension.request_own',
    'timer.control_own',
  ];

  it.each(permitted)('a Member is allowed %s', (action) => {
    expect(can(MEMBER, action)).toBe(true);
  });

  it('a Member may act on their own task but not on someone else’s', () => {
    expect(can(MEMBER, 'task.comment', { assigneeId: MEMBER.id })).toBe(true);
    expect(can(MEMBER, 'task.comment', { assigneeId: SOMEONE_ELSE })).toBe(false);
    expect(can(MEMBER, 'task.log_time', { assigneeId: MEMBER.id })).toBe(true);
    expect(can(MEMBER, 'task.log_time', { assigneeId: SOMEONE_ELSE })).toBe(false);
  });

  it('a Member may re-plan only a task they created themselves', () => {
    expect(can(MEMBER, 'task.edit_planning', { createdById: MEMBER.id })).toBe(true);
    // Assigned to them, created by an Admin — they may edit content, not planning.
    expect(
      can(MEMBER, 'task.edit_planning', { assigneeId: MEMBER.id, createdById: 'u-admin' }),
    ).toBe(false);
    expect(can(MEMBER, 'task.edit_content', { assigneeId: MEMBER.id })).toBe(true);
  });

  it('BR-016 — a Member sees a project only once they have work in it', () => {
    expect(can(MEMBER, 'project.view_member_of', { isProjectMember: true })).toBe(true);
    expect(can(MEMBER, 'project.view_member_of', { isProjectMember: false })).toBe(false);
  });
});

describe('doc 03 §3.4 / ADR-010 — the Coordinator sets the budget, the Admin spends it', () => {
  it('a Coordinator may set a time limit before work starts', () => {
    expect(can(COORDINATOR, 'time_limit.set')).toBe(true);
    expect(can(COORDINATOR, 'time_limit.edit_before_start')).toBe(true);
  });

  it('a Coordinator may not change it once work has started', () => {
    expect(can(COORDINATOR, 'time_limit.edit_after_start')).toBe(false);
    expect(can(ADMIN, 'time_limit.edit_after_start')).toBe(true);
  });

  it('a Coordinator may not grant or decline an extension', () => {
    expect(can(COORDINATOR, 'extension.grant')).toBe(false);
    expect(can(COORDINATOR, 'extension.decline')).toBe(false);
  });

  it('a Coordinator may still see pending requests — read-only, not blind', () => {
    expect(can(COORDINATOR, 'extension.view_all_pending')).toBe(true);
  });

  it('everyone may request an extension on their own work', () => {
    for (const role of ROLES) {
      expect(can(ACTOR_BY_ROLE[role], 'extension.request_own')).toBe(true);
    }
  });
});

describe('BR-003 — only Admin+ may override a capacity block', () => {
  it('the Coordinator plans but cannot overrule the hard threshold', () => {
    expect(can(COORDINATOR, 'task.assign')).toBe(true);
    expect(can(COORDINATOR, 'task.override_capacity_block')).toBe(false);
  });

  it.each([SUPER_ADMIN, ADMIN])('$role may override with a reason', (actor) => {
    expect(can(actor, 'task.override_capacity_block')).toBe(true);
  });
});

describe('doc 03 §3.2 — the Coordinator assigns within projects but does not own them', () => {
  it('cannot create, edit or delete a project', () => {
    for (const action of [
      'project.create',
      'project.edit',
      'project.set_type',
      'project.change_status',
      'project.soft_delete',
      'project.purge',
    ] as Action[]) {
      expect(can(COORDINATOR, action), action).toBe(false);
    }
  });

  it('can see them all and create work inside them', () => {
    expect(can(COORDINATOR, 'project.view_all')).toBe(true);
    expect(can(COORDINATOR, 'task.create_in_project')).toBe(true);
  });

  it('an Admin soft-deletes; only the Super Admin purges', () => {
    expect(can(ADMIN, 'project.soft_delete')).toBe(true);
    expect(can(ADMIN, 'project.purge')).toBe(false);
    expect(can(SUPER_ADMIN, 'project.purge')).toBe(true);
  });
});

/* ==========================================================================
 * Step-up re-authentication — FR-149
 * ========================================================================== */

describe('requiresStepUp — every 🔒 in doc 03 §3', () => {
  it.each(STEP_UP_ACTIONS)('%s requires step-up', (action) => {
    expect(requiresStepUp(action)).toBe(true);
  });

  it('every step-up action is a real action', () => {
    for (const action of STEP_UP_ACTIONS) {
      expect(ACTIONS).toContain(action);
    }
  });

  it('ordinary actions do not require it', () => {
    for (const action of [
      'task.view_own',
      'task.comment',
      'timer.control_own',
      'dashboard.view',
      'settings.skills_library',
    ] as Action[]) {
      expect(requiresStepUp(action), action).toBe(false);
    }
  });

  it('destructive and credential-changing actions are all covered', () => {
    for (const action of [
      'user.purge',
      'task.purge',
      'project.purge',
      'user.change_role',
      'user.promote_to_admin',
      'user.reset_mfa',
      'data.export_all',
      'settings.security',
    ] as Action[]) {
      expect(requiresStepUp(action), action).toBe(true);
    }
  });
});

/* ==========================================================================
 * Helpers and layer-2 contract
 * ========================================================================== */

describe('actionsFor', () => {
  it('gives the Super Admin the widest surface and the Member the narrowest', () => {
    const counts = ROLE_ORDER.map((role) => actionsFor(role).length);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
  });

  it('never includes an action the role is denied', () => {
    for (const role of ROLES) {
      for (const action of actionsFor(role)) {
        expect(ruleFor(role, action)).not.toBe('deny');
      }
    }
  });
});

describe('doc 20 §5 — the contract holds', () => {
  it('is deterministic: the same question always gets the same answer', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(can(ADMIN, 'task.approve_review', { assigneeId: SOMEONE_ELSE })).toBe(true);
      expect(can(MEMBER, 'dashboard.view')).toBe(false);
    }
  });

  it('does not mutate the context it is given', () => {
    const context: ResourceContext = { ownerId: 'u-1', assigneeId: 'u-2' };
    const snapshot = JSON.stringify(context);
    can(ADMIN, 'task.approve_review', context);
    can(MEMBER, 'task.comment', context);
    expect(JSON.stringify(context)).toBe(snapshot);
  });

  it('an empty actor id never satisfies an ownership check', () => {
    const ghost: Actor = { id: '', role: 'member' };
    expect(can(ghost, 'task.comment', { assigneeId: '' })).toBe(false);
    expect(can(ghost, 'user.edit_profile', { ownerId: '' })).toBe(false);
  });
});
