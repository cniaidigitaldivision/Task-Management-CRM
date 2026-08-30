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
  /* Widened to Admin 2026-08-23 — see the note in permissions.ts. Transcribed
     here independently, as every row in this table is. */
  'user.purge': ['allow', 'allow', 'deny', 'deny'],
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
  /* Coordinator gained all four on 2026-08-23 — owner: *"a team coordinator can
     create a new project and can add social media accounts, their credentials,
     and their documentation."* Note `project.view_finance` two lines down did
     NOT move: they run the project without seeing what it bills. */
  'project.create': ['allow', 'allow', 'allow', 'deny'],
  'project.set_type': ['allow', 'allow', 'allow', 'deny'],
  'project.edit': ['allow', 'allow', 'allow', 'deny'],
  'project.change_status': ['allow', 'allow', 'allow', 'deny'],
  'project.soft_delete': ['allow', 'allow', 'deny', 'deny'],
  'project.purge': ['allow', 'deny', 'deny', 'deny'],
  'project.view_all': ['allow', 'allow', 'allow', 'deny'],
  /* Owner, 2026-08-19: *"this monthly fee or any financial thing should only be
     visible to super admin and admin only. It will not be visible to any coordinator
     or anyone else on the team."* Note the Coordinator is DENIED here while being
     allowed `project.view_all` on the line above — seeing the project is not seeing
     what it bills. */
  'project.view_finance': ['allow', 'allow', 'deny', 'deny'],
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
  /* `self_created` for BOTH lower roles since 2026-08-23 — everyone may remove
     what they raised, nobody may remove work handed to them. This row is only
     the coarse half: the status window ("To Do or In Progress, else Admin") is
     in `canDeleteTask`, because no Rule kind takes a status. See delete-rule.test.ts. */
  'task.soft_delete': ['allow', 'allow', 'self_created', 'self_created'],
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
  /* Admin from 2026-08-22 — owner decision. The row-level policies on
     `security_events` and `sessions` moved with it in migration 040; this
     entry alone would render the screen with empty panels. */
  'security_dashboard.view': ['allow', 'allow', 'deny', 'deny'],

  /* System settings — every one of these reached Admin on 2026-08-22 by owner
     decision. See the note beside the block in permissions.ts: what the Super
     Admin keeps is control of the SYSTEM (appointing Admins, purging, their own
     account), not the knobs that run the team. */
  'settings.capacity_thresholds': ['allow', 'allow', 'deny', 'deny'],
  'settings.default_capacity': ['allow', 'allow', 'deny', 'deny'],
  'settings.status_workflow': ['allow', 'allow', 'deny', 'deny'],
  'settings.skills_library': ['allow', 'allow', 'deny', 'deny'],
  'settings.scoring_weights': ['allow', 'allow', 'deny', 'deny'],
  'settings.other_work_threshold': ['allow', 'allow', 'deny', 'deny'],
  'settings.project_type_priority': ['allow', 'allow', 'deny', 'deny'],
  'settings.notification_defaults': ['allow', 'allow', 'deny', 'deny'],
  'settings.own_notification_prefs': ['allow', 'allow', 'allow', 'allow'],
  'settings.security': ['allow', 'allow', 'deny', 'deny'],
  'data.export_all': ['allow', 'allow', 'deny', 'deny'],
  'sessions.view_and_revoke_own': ['allow', 'allow', 'allow', 'allow'],

  /* ── THE CREDENTIALS VAULT — COORDINATOR AND ABOVE, REVISED 2026-08-24 ─────
     `view` and `reveal` used to be open to every role, deferring the real
     restriction to row-level security: a project you own, or a login issued to
     you (migration 023). Owner withdrew that rule — *"not even the person who is
     working on this project can show that credential to them"* — so migration
     047 replaces `app.can_read_credential` with this same rank test and the two
     layers now say the same thing.

     ⚠️ If this row is ever widened again, migration 047 has to be revisited in
     the same commit. A Member allowed here and refused by the database would see
     an empty vault with no explanation, which is the confusing half of a leak
     without the leak. */
  'credential.view': ['allow', 'allow', 'allow', 'deny'],
  'credential.reveal': ['allow', 'allow', 'allow', 'deny'],
  /* ── ⚠️ ADMIN AND ABOVE SINCE 2026-08-25 ─────────────────────────────────
     Owner: *"only the admin is able to assign, add, delete, or manage who can
     view this whole project: credential plus any specific credential."* This
     reverses 2026-08-23 (*"he can also manage all these things"*), which is why
     the previous value was Coordinator.

     It also closed a mismatch that predated both: `credentials_delete` in the
     database has been admin-only since migration 023, so a Coordinator was shown
     a Delete button the policy then refused. Migration 058 brought insert and
     update into line. Reading is untouched — a Coordinator can still see a
     credential and can no longer change one. */
  'credential.manage': ['allow', 'allow', 'deny', 'deny'],
  'credential.delete': ['allow', 'allow', 'deny', 'deny'],
  /* ⚠️ THE ONE CREDENTIAL PERMISSION A COORDINATOR DOES NOT HAVE. Owner,
     2026-08-24: *"only admins and super admins can add someone and can delete
     someone from here."* Editing a password is reversible; handing it to a third
     person is not — they have seen it. Migration 050's RLS agrees. */
  'credential.grant': ['allow', 'allow', 'deny', 'deny'],

  /* Drive documents. `request` is open to everybody because a pending upload is
     not in Drive — the approval is the gate. `approve` stops at Admin, so a
     Coordinator cannot wave through their own upload. `view` is open for the same
     reason as the vault: the real rule is relational and RLS enforces it. */
  'document.view': ['allow', 'allow', 'allow', 'allow'],
  'document.request': ['allow', 'allow', 'allow', 'allow'],
  /* Reached Coordinator on 2026-08-16, by the owner's decision when asked. They
     can therefore approve their own upload — the accepted trade for fewer
     bottlenecks, recorded here so a future reader does not "fix" it. */
  'document.approve': ['allow', 'allow', 'allow', 'deny'],
  'document.manage': ['allow', 'allow', 'allow', 'deny'],
  /* Owner, 2026-08-16. One rung lower than `approve` on purpose: a Coordinator
     may decide who reads a folder without being able to wave a file into Drive. */
  'document.share': ['allow', 'allow', 'allow', 'deny'],
  'drive.configure': ['allow', 'allow', 'deny', 'deny'],

  /* The company library — owner request 2026-08-29. Admin+, one rung ABOVE
     `document.manage`, because this is the agency's own collateral read by
     everybody with no approval step in front of it, not one project's upload
     queue. Mirrors `library_documents_write` in migration 035, which is the
     enforcement; a Coordinator granted this here would get a button whose only
     possible outcome is a database refusal. */
  'library.manage': ['allow', 'allow', 'deny', 'deny'],

  /* Attendance — owner instruction, 2026-08-25, transcribed from the request and
     not from permissions.ts:
       "the check-in button appearing throughout this whole dashboard"  → everyone
       "the super admin or admin, and the team coordinator can see who is
        coming on time and who is coming late"                          → not members
       "he can add their checkout time but you can say Kashif or any team
        coordinator could not do that"                                  → not the Coordinator */
  'attendance.check_in': ['allow', 'allow', 'allow', 'allow'],
  'attendance.view_all': ['allow', 'allow', 'allow', 'deny'],

  /* Owner, 2026-08-30, on where the terminal mapping screen should live: *"only
     in admin and superadmin."* Deliberately one rung narrower than
     `attendance.view_all` — reading who was late is not the same act as deciding
     whose attendance a face opens. Migration 079 narrows the tables to match. */
  'attendance.manage_devices': ['allow', 'allow', 'deny', 'deny'],
  'attendance.edit': ['allow', 'allow', 'deny', 'deny'],

  /* Finance — owner instruction, 2026-08-26, transcribed from the request and
     not from permissions.ts:
       "in the admin panel the admin and the super admin can view where we have
        spent and what we have spent"                                → not below Admin
       "the team coordinator can also add expenses"                  → filing only
       "the list of expenses, their report, or their analysis should
        only be visible to the admin and the super admin"            → reading is Admin+
       "each person can see which subscriptions they have"           → everyone
       "the subscription cost is not compulsory to show them"        → managing is Admin+ */
  'finance.view': ['allow', 'allow', 'deny', 'deny'],
  'finance.record_expense': ['allow', 'allow', 'allow', 'deny'],
  'finance.manage': ['allow', 'allow', 'deny', 'deny'],

  /* Invoicing — owner, 2026-08-29: *"only super admin and admin can generate an
     invoice over here. For right now — later on, maybe I will add some other
     people."* Three actions with the same row today, on purpose: the owner said
     this list will change, and widening "who may bill a client" must not drag
     "who may read what everyone is paid" along with it. Voiding is deliberately
     no wider than issuing — somebody who may not bill must not un-bill. */
  'invoice.issue': ['allow', 'allow', 'deny', 'deny'],
  'invoice.send': ['allow', 'allow', 'deny', 'deny'],
  'invoice.void': ['allow', 'allow', 'deny', 'deny'],
  'subscription.view_own': ['allow', 'allow', 'allow', 'allow'],
  'subscription.manage': ['allow', 'allow', 'deny', 'deny'],

  /* The assistant — owner instruction, 2026-08-26, transcribed from the request
     and not from permissions.ts:
       "this facility will only be provided to upper levels, like this super
        admin, admin, or team coordinator"                    → not a Member
       "later on maybe I can have a radio button for each member [...] that I
        can switch on and off at my choice"                   → a row overrides
       "on admin or super admin choice"                       → managing is Admin+
       "maybe one person uses all the credits [...] I should have some check
        and balance"                                          → usage is Admin+

     ⚠️ `assistant.use` is the ROLE DEFAULT only. A row in
     `public.assistant_access` wins over it in either direction, which is what
     the owner's radio button writes. The composed answer is tested separately
     in lib/domain/__tests__/assistant-access.test.ts — asserting this line
     alone would prove the floor and not the rule. */
  'assistant.use': ['allow', 'allow', 'allow', 'deny'],
  'assistant.manage_access': ['allow', 'allow', 'deny', 'deny'],
  'assistant.view_usage': ['allow', 'allow', 'deny', 'deny'],
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

describe('doc 03 §3.2 — the Coordinator runs projects but cannot destroy them', () => {
  /* ⚠️ THIS BLOCK WAS REVERSED ON 2026-08-23, NOT RELAXED TO GO GREEN.
     It asserted the Coordinator could not create, edit or delete a project —
     doc 03 §3.2 as originally written. Owner: *"a team coordinator can create a
     new project and can add social media accounts, their credentials, and their
     documentation. He can also manage all these things."*

     The line the owner did NOT move is the one that matters: destruction. So
     the test splits in two, and the second half is the part still worth
     asserting. */
  it('can create, edit and run a project', () => {
    for (const action of [
      'project.create',
      'project.edit',
      'project.set_type',
      'project.change_status',
    ] as Action[]) {
      expect(can(COORDINATOR, action), action).toBe(true);
    }
  });

  it('still cannot delete or purge one', () => {
    for (const action of ['project.soft_delete', 'project.purge'] as Action[]) {
      expect(can(COORDINATOR, action), action).toBe(false);
    }
  });

  it('and still cannot see what it bills', () => {
    /* The two instructions held together: they run the project without the
       money. Owner, 2026-08-19, unchanged by the widening above. */
    expect(can(COORDINATOR, 'project.view_finance')).toBe(false);
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

  it('deleting a person asks for a password, but not through session step-up', () => {
    /* ⚠️ Deliberately absent from STEP_UP_ACTIONS since 2026-08-23.
       `purgePersonAction` verifies the password inline and does NOT stamp the
       session, so the proof is spent on that one delete instead of unlocking
       every other 🔒 action for ten minutes. See the note in permissions.ts —
       this is a narrowing, and the assertion is here so nobody "fixes" it by
       adding the action back. */
    expect(requiresStepUp('user.purge')).toBe(false);
  });

  it('destructive and credential-changing actions are all covered', () => {
    for (const action of [
      'task.purge',
      'project.purge',
      'user.change_role',
      'user.promote_to_admin',
      'user.reset_mfa',
      'data.export_all',
      'settings.security',
      /* ⚠️ Granting somebody access to a stored password is MORE dangerous than
         reading one — it is standing rather than momentary — so it would be an
         odd thing to protect less than `credential.reveal`. Migration 050. */
      'credential.grant',
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
